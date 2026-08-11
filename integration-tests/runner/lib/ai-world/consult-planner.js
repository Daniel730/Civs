/**
 * CONSULT_LLM hook for the anti-stall ladder (D-AP-021 follow-up).
 *
 * Design constraints (docs/AI_WORLD.md, DECISIONS.md):
 *   - The planner is OPTIONAL and INJECTABLE. Default is OFF: with no planner configured
 *     the CONSULT_LLM stage keeps its old behaviour (log only) and the ladder proceeds
 *     to ABANDON_GOAL on its own timer.
 *   - The planner is NEVER called per-tick. `ConsultGate.maybeConsult` only fires when the
 *     ladder has just escalated into CONSULT_LLM for a goal, at most once per goalKey and
 *     never more often than `cooldownMs` per agent, whatever the tick rate is.
 *   - The planner returns an *intention suggestion*; the deterministic controller stays in
 *     charge of acting on it (typically via IntentionCache.set + applySignals).
 *
 * Selection: pass `planner` explicitly, or use `plannerFromEnv()` which reads
 * AI_WORLD_CONSULT_PLANNER: unset/'' /'off' → null (default), 'stub' → StubPlanner.
 * Real LLM planners plug in later behind the same interface.
 *
 * Planner interface:
 *   async propose(ctx) -> { focus: string, reason: string, ttlMs?: number } | null
 *   ctx: { agentId, goalKey, stage, noProgressMs, goalAgeMs, focus?, job?, snapshot? }
 */

const DEFAULT_COOLDOWN_MS = 90_000;

/**
 * Deterministic planner for tests and dry runs: no I/O, no clock, no randomness.
 * Suggests rotating away from the stalled focus using a fixed table.
 */
class StubPlanner {
  constructor(opts = {}) {
    this.rotation = opts.rotation || ['gather', 'build', 'patrol', 'farm'];
    this.calls = [];
  }

  async propose(ctx) {
    this.calls.push({ agentId: ctx.agentId, goalKey: ctx.goalKey });
    const cur = ctx.focus || '';
    const idx = this.rotation.indexOf(cur);
    const next = this.rotation[(idx + 1 + this.rotation.length) % this.rotation.length];
    return {
      focus: next,
      reason: `stub_rotate_from_${cur || 'unknown'}`,
      ttlMs: 30_000,
    };
  }
}

/**
 * Gate that owns the "when may the planner run" policy, so callers cannot
 * accidentally consult per-tick.
 */
class ConsultGate {
  /**
   * @param {{ planner?: { propose: Function }|null, cooldownMs?: number,
   *   now?: () => number, onLog?: (entry: object) => void }} [opts]
   */
  constructor(opts = {}) {
    this.planner = opts.planner || null;
    this.cooldownMs = Number.isFinite(opts.cooldownMs) ? opts.cooldownMs : DEFAULT_COOLDOWN_MS;
    this.now = typeof opts.now === 'function' ? opts.now : () => Date.now();
    this.onLog = typeof opts.onLog === 'function' ? opts.onLog : () => {};
    this._agents = new Map(); // agentId -> { lastConsultAt, lastGoalKey }
    this.stats = { attempts: 0, consulted: 0, suppressed: 0, errors: 0 };
  }

  get enabled() {
    return !!this.planner;
  }

  /**
   * Call once per anti-stall report. Consults the planner only when:
   * the report just escalated into CONSULT_LLM, a planner is configured,
   * this goalKey has not been consulted yet, and the per-agent cooldown elapsed.
   *
   * @param {{ stage: string, escalated: boolean, noProgressMs?: number, goalAgeMs?: number }} stall
   * @param {{ agentId: string, goalKey: string, focus?: string, job?: string, snapshot?: object }} ctx
   * @returns {Promise<{ consulted: boolean, reason: string, suggestion?: object|null }>}
   */
  async maybeConsult(stall, ctx) {
    if (!stall || stall.stage !== 'CONSULT_LLM' || !stall.escalated) {
      return { consulted: false, reason: 'not_consult_stage' };
    }
    this.stats.attempts += 1;
    if (!this.planner) {
      // Default-off behaviour: log only, exactly as before the hook existed.
      this.onLog({
        status: 'DEGRADED',
        action: 'consult_llm_skipped',
        reason: 'no_planner',
        ...ctx,
      });
      this.stats.suppressed += 1;
      return { consulted: false, reason: 'no_planner' };
    }
    const s = this._agents.get(ctx.agentId) || {
      lastConsultAt: Number.NEGATIVE_INFINITY,
      lastGoalKey: null,
    };
    const now = this.now();
    if (s.lastGoalKey === ctx.goalKey) {
      this.stats.suppressed += 1;
      return { consulted: false, reason: 'already_consulted_goal' };
    }
    if (now - s.lastConsultAt < this.cooldownMs) {
      this.stats.suppressed += 1;
      return { consulted: false, reason: 'cooldown' };
    }
    s.lastConsultAt = now;
    s.lastGoalKey = ctx.goalKey;
    this._agents.set(ctx.agentId, s);
    try {
      const suggestion = await this.planner.propose({
        agentId: ctx.agentId,
        goalKey: ctx.goalKey,
        stage: stall.stage,
        noProgressMs: stall.noProgressMs,
        goalAgeMs: stall.goalAgeMs,
        focus: ctx.focus,
        job: ctx.job,
        snapshot: ctx.snapshot,
      });
      this.stats.consulted += 1;
      this.onLog({ status: 'PASS', action: 'consult_llm', agentId: ctx.agentId, suggestion });
      return { consulted: true, reason: 'consulted', suggestion: suggestion || null };
    } catch (err) {
      this.stats.errors += 1;
      this.onLog({
        status: 'DEGRADED',
        action: 'consult_llm_error',
        error: String(err && err.message),
      });
      return { consulted: false, reason: 'planner_error' };
    }
  }

  snapshot() {
    return { enabled: this.enabled, cooldownMs: this.cooldownMs, ...this.stats };
  }
}

/**
 * Build a planner from environment configuration. Default off.
 * @param {NodeJS.ProcessEnv} [env]
 */
function plannerFromEnv(env = process.env) {
  const kind = String(env.AI_WORLD_CONSULT_PLANNER || '')
    .trim()
    .toLowerCase();
  if (!kind || kind === 'off' || kind === '0' || kind === 'false') return null;
  if (kind === 'stub') return new StubPlanner();
  if (kind === 'hermes') {
    // Phase 5: Hermes Bridge. Uses the local stub transport by default (no external
    // service required to run/test); swap in a real HTTP/WebSocket transport later
    // via the same HermesPlanner interface.
    const { HermesPlanner } = require('./hermes-bridge');
    return new HermesPlanner({ onLog: () => {} });
  }
  throw new Error(`Unknown AI_WORLD_CONSULT_PLANNER value: ${kind} (supported: off, stub, hermes)`);
}

module.exports = { ConsultGate, StubPlanner, plannerFromEnv, DEFAULT_COOLDOWN_MS };
