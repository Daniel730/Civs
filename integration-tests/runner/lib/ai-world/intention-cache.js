/**
 * Intention cache and anti-stall ladder.
 *
 * The design rule for the AI World is: the LLM supplies intent rarely, a deterministic controller
 * supplies everything else. That only holds if something enforces the cadence, so an intention is
 * cached for 20–60 s and is only re-derived when the world actually changed in a way that matters
 * (survival escalation, goal completed, or the agent stopped making progress).
 *
 * The anti-stall ladder is the other half: when progress stops we try the cheap local fix first and
 * only reach for a new plan — and last of all for the LLM — if the cheap fix failed. Recon measured
 * work ticks stalling for up to 324 s with nothing watching, so every stage is timed and counted.
 *
 * Both classes are pure with an injectable clock.
 */

const { METRIC, countMetric, observeMetric } = require('../metrics');

const CACHE_DEFAULTS = Object.freeze({
  minTtlMs: 20_000,
  maxTtlMs: 60_000,
  defaultTtlMs: 30_000,
});

/** Ordered escalation stages. Index is the stage number. */
const STALL_LADDER = Object.freeze([
  'CONTINUE',
  'LOCAL_RECOVERY',
  'REPLAN',
  'CONSULT_LLM',
  'ABANDON_GOAL',
]);

class IntentionCache {
  /**
   * @param {{ minTtlMs?:number, maxTtlMs?:number, defaultTtlMs?:number, now?:() => number }} [opts]
   */
  constructor(opts = {}) {
    this.cfg = { ...CACHE_DEFAULTS, ...opts };
    this.now = typeof opts.now === 'function' ? opts.now : () => Date.now();
    this.entries = new Map();
    this.hits = 0;
    this.misses = 0;
    this.invalidations = {};
  }

  _clampTtl(ttl) {
    const t = Number.isFinite(ttl) ? ttl : this.cfg.defaultTtlMs;
    return Math.min(this.cfg.maxTtlMs, Math.max(this.cfg.minTtlMs, t));
  }

  /**
   * Store an intention. `contextKey` is a caller-supplied digest of the facts the intention
   * depends on; a different digest is a miss even inside the TTL.
   */
  set(agentId, intention, { ttlMs, contextKey } = {}) {
    const entry = {
      intention,
      contextKey: contextKey || null,
      at: this.now(),
      ttlMs: this._clampTtl(ttlMs),
      uses: 0,
    };
    this.entries.set(agentId, entry);
    return entry;
  }

  /**
   * @returns {{ hit: boolean, intention: object|null, ageMs?: number, reason?: string }}
   */
  get(agentId, contextKey) {
    const entry = this.entries.get(agentId);
    if (!entry) {
      this.misses += 1;
      return { hit: false, intention: null, reason: 'cold' };
    }
    const age = this.now() - entry.at;
    if (age >= entry.ttlMs) {
      this.misses += 1;
      return { hit: false, intention: null, reason: 'expired', ageMs: age };
    }
    if (contextKey != null && entry.contextKey != null && contextKey !== entry.contextKey) {
      this.misses += 1;
      return { hit: false, intention: null, reason: 'context_changed', ageMs: age };
    }
    entry.uses += 1;
    this.hits += 1;
    return { hit: true, intention: entry.intention, ageMs: age };
  }

  /** Force a re-decision on the next `get`. */
  invalidate(agentId, reason = 'manual') {
    this.invalidations[reason] = (this.invalidations[reason] || 0) + 1;
    return this.entries.delete(agentId);
  }

  /**
   * Standard invalidation triggers, so callers do not each invent their own policy.
   * @param {string} agentId
   * @param {{ survivalEscalated?:boolean, goalCompleted?:boolean, noProgress?:boolean,
   *   goalAbandoned?:boolean }} signals
   */
  applySignals(agentId, signals = {}) {
    const reasons = [];
    if (signals.survivalEscalated) reasons.push('survival_escalated');
    if (signals.goalCompleted) reasons.push('goal_completed');
    if (signals.noProgress) reasons.push('no_progress');
    if (signals.goalAbandoned) reasons.push('goal_abandoned');
    for (const r of reasons) this.invalidate(agentId, r);
    return reasons;
  }

  snapshot() {
    const total = this.hits + this.misses;
    return {
      size: this.entries.size,
      hits: this.hits,
      misses: this.misses,
      hitRate: total ? Math.round((this.hits / total) * 1000) / 10 : null,
      invalidations: { ...this.invalidations },
      ttl: { minMs: this.cfg.minTtlMs, maxMs: this.cfg.maxTtlMs },
    };
  }
}

const STALL_DEFAULTS = Object.freeze({
  /** No measurable progress for this long escalates one stage. */
  noProgressMs: 12_000,
  /** Progress smaller than this does not count as progress. */
  epsilon: 0.5,
  /** Hard ceiling: a single goal may never occupy the agent longer than this. */
  goalBudgetMs: 120_000,
});

class AntiStall {
  /**
   * @param {{ noProgressMs?:number, epsilon?:number, goalBudgetMs?:number, now?:() => number }} [opts]
   */
  constructor(opts = {}) {
    this.cfg = { ...STALL_DEFAULTS, ...opts };
    this.now = typeof opts.now === 'function' ? opts.now : () => Date.now();
    this.agents = new Map();
  }

  _state(agentId) {
    if (!this.agents.has(agentId)) {
      const now = this.now();
      this.agents.set(agentId, {
        goalKey: null,
        goalStartedAt: now,
        best: null,
        lastImprovedAt: now,
        stage: 0,
        escalations: 0,
      });
    }
    return this.agents.get(agentId);
  }

  /** Start (or restart) a goal. Resets the ladder. */
  beginGoal(agentId, goalKey, progressValue) {
    const s = this._state(agentId);
    const now = this.now();
    s.goalKey = goalKey;
    s.goalStartedAt = now;
    s.best = Number.isFinite(progressValue) ? progressValue : null;
    s.lastImprovedAt = now;
    s.stage = 0;
    return { agentId, goalKey, stage: STALL_LADDER[0] };
  }

  /**
   * Report progress. `progressValue` is a metric that should *decrease* (distance to goal) —
   * pass `higherIsBetter: true` for counters that should increase.
   *
   * @param {string} agentId
   * @param {{ goalKey?:string, progressValue:number, higherIsBetter?:boolean }} report
   * @returns {{ stage:string, stageIndex:number, noProgressMs:number, escalated:boolean,
   *   goalAgeMs:number, reason:string|null }}
   */
  report(agentId, report = {}) {
    const s = this._state(agentId);
    const now = this.now();
    if (report.goalKey && report.goalKey !== s.goalKey) {
      this.beginGoal(agentId, report.goalKey, report.progressValue);
      return {
        stage: STALL_LADDER[0],
        stageIndex: 0,
        noProgressMs: 0,
        escalated: false,
        goalAgeMs: 0,
        reason: 'new_goal',
      };
    }

    const value = Number(report.progressValue);
    const better =
      s.best == null ||
      (report.higherIsBetter
        ? value > s.best + this.cfg.epsilon
        : value < s.best - this.cfg.epsilon);
    if (Number.isFinite(value) && better) {
      s.best = value;
      s.lastImprovedAt = now;
      if (s.stage > 0) s.stage = 0;
    }

    const noProgressMs = now - s.lastImprovedAt;
    const goalAgeMs = now - s.goalStartedAt;
    let escalated = false;
    let reason = null;

    if (goalAgeMs >= this.cfg.goalBudgetMs && s.stage < STALL_LADDER.length - 1) {
      s.stage = STALL_LADDER.length - 1;
      escalated = true;
      reason = 'goal_budget_exhausted';
    } else {
      const wanted = Math.min(
        STALL_LADDER.length - 1,
        Math.floor(noProgressMs / this.cfg.noProgressMs)
      );
      if (wanted > s.stage) {
        s.stage = wanted;
        escalated = true;
        reason = 'no_progress';
      }
    }

    if (escalated) {
      s.escalations += 1;
      observeMetric(METRIC.NO_PROGRESS, noProgressMs, { actor: agentId, stage: STALL_LADDER[s.stage] });
      if (STALL_LADDER[s.stage] === 'REPLAN') {
        countMetric(METRIC.REPLAN, { actor: agentId, reason: reason || 'no_progress' });
      }
      if (STALL_LADDER[s.stage] === 'ABANDON_GOAL') {
        countMetric(METRIC.GOAL_ABANDON, { actor: agentId, reason: reason || 'no_progress' });
      }
    }

    return {
      stage: STALL_LADDER[s.stage],
      stageIndex: s.stage,
      noProgressMs,
      goalAgeMs,
      escalated,
      reason,
    };
  }

  /** True when the ladder has reached the stage where an LLM call is justified. */
  needsLlm(agentId) {
    const s = this.agents.get(agentId);
    return !!s && STALL_LADDER[s.stage] === 'CONSULT_LLM';
  }

  snapshot() {
    const out = {};
    for (const [id, s] of this.agents) {
      out[id] = {
        goalKey: s.goalKey,
        stage: STALL_LADDER[s.stage],
        escalations: s.escalations,
        noProgressMs: this.now() - s.lastImprovedAt,
        goalAgeMs: this.now() - s.goalStartedAt,
      };
    }
    return out;
  }
}

module.exports = { IntentionCache, AntiStall, STALL_LADDER, CACHE_DEFAULTS, STALL_DEFAULTS };
