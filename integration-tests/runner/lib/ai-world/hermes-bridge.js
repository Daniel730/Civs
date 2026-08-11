/**
 * Hermes Bridge — bidirectional NPC <-> external intelligence (Hermes).
 *
 * Phase 5 of the Living AI World audit (docs/AIWORLD_AUDIT.md). Implements the brief:
 *   §12-§17 Hermes as external mentor/orchestrator (ask when unsure, coordinate, never
 *            per-tick, local policy stays in charge)
 *   §13-§14 Minecraft <-> Hermes Bridge with a clean AI_QUERY / AI_RESPONSE protocol
 *   §15 When to consult: confidence / novelty / goal_conflict / failed_attempts / explicit ask
 *   §18 WorldMemory (shared, may be stale) — supported via shareMemory()
 *   §31 Hermes DOWN must not break the agent — every call has timeout + local fallback
 *
 * Design:
 *   - The ConsultGate (consult-planner.js) already owns the *when* policy (escalation +
 *     cooldown + per-goalKey cache). HermesBridge supplies the *what* — a planner that
 *     talks to Hermes — behind the SAME propose(ctx) interface the StubPlanner uses.
 *   - Transport is pluggable (HermesTransport). Default is LocalHermesStub (deterministic
 *     answers) so the whole loop runs and is unit-tested with NO external dependency. A
 *     real HTTP/WebSocket transport drops in later without touching callers.
 *   - AgentMessage (§11) is the structured envelope for NPC<->NPC and Hermes<->NPC comms.
 */

const { EVENT, emitAgentEvent } = require('./events');

// ---------------------------------------------------------------------------
// Structured message envelope (brief §11 / §14)
// ---------------------------------------------------------------------------

/**
 * @param {object} m
 * @param {string} m.sender
 * @param {string} m.receiver  'hermes' | agent name | '@world'
 * @param {string} m.intent    e.g. 'query' | 'answer' | 'share' | 'coordinate' | 'ask_help'
 * @param {string} [m.content]
 * @param {number} [m.priority] 0..1
 * @param {object} [m.context]
 * @param {string} [m.type]     'AI_QUERY' | 'AI_RESPONSE' | 'AGENT_MSG'
 */
function makeMessage(m) {
  return {
    sender: m.sender,
    receiver: m.receiver || 'hermes',
    intent: m.intent || 'query',
    type: m.type || (m.receiver === 'hermes' ? 'AI_QUERY' : 'AGENT_MSG'),
    content: m.content || '',
    priority: typeof m.priority === 'number' ? m.priority : 0.5,
    context: m.context || {},
    timestamp: Date.now(),
  };
}

// ---------------------------------------------------------------------------
// Transport interface (brief §13) — pluggable Minecraft <-> Hermes channel.
// Implementations: LocalHermesStub (default), and later HttpHermesTransport.
// ---------------------------------------------------------------------------

/**
 * Local deterministic stand-in for Hermes. Lets the full consult loop run and be
 * tested with zero external I/O. Replace with a real transport by passing
 * `transport` to HermesBridge / HermesPlanner.
 *
 * Answers are intentionally OPERATIONAL only (brief §14): a decision summary +
 * a short action list — never raw chain-of-thought.
 */
class LocalHermesStub {
  constructor(opts = {}) {
    this.now = typeof opts.now === 'function' ? opts.now : () => Date.now();
    this.latencyMs = opts.latencyMs || 0;
    this.calls = [];
  }

  /** @param {object} queryMsg an AI_QUERY message */
  async query(queryMsg) {
    this.calls.push(queryMsg);
    if (this.latencyMs) await new Promise((r) => setTimeout(r, this.latencyMs));
    const ctx = queryMsg.context || {};
    const urgency = ctx.urgency || 'normal';
    // Deterministic, operational advice derived from the structured context only.
    const decision = ctx.novelty > 0.6 ? 'explore_cautiously' : 'continue_current_plan';
    const summary =
      `Local mentor: ${decision}. ` +
      `Health ${ctx.healthPct != null ? Math.round(ctx.healthPct * 100) : 100}%, ` +
      `confidence ${ctx.confidence != null ? ctx.confidence.toFixed(2) : 'unknown'}.`;
    return {
      type: 'AI_RESPONSE',
      agent: queryMsg.sender,
      decision,
      reasoning_summary: summary,
      actions:
        decision === 'explore_cautiously'
          ? ['prepare_torches', 'store_valuables', 'scout_area']
          : ['keep_working', 'recheck_objective'],
      source: 'local_stub',
      at: this.now(),
    };
  }

  /** Hermes -> agent push (brief §16): Hermes can ask the agent questions. */
  async push(message) {
    this.calls.push(message);
    return { delivered: true };
  }
}

// ---------------------------------------------------------------------------
// When-to-consult triggers (brief §15)
// ---------------------------------------------------------------------------

const TRIGGERS = {
  confidenceThreshold: 0.35, // below -> uncertain
  noveltyThreshold: 0.6, // above -> unprecedented
  failedAttemptsThreshold: 3, // >= -> repeated failure
};

/**
 * Decide whether an agent should consult Hermes right now. Pure + cheap (no I/O).
 * @param {object} agent
 * @param {object} observation enriched observe
 * @param {{ failedAttempts?: number, goalConflict?: boolean, explicitAsk?: boolean,
 *           confidence?: number, novelty?: number }} [signals]
 * @returns {{ consult: boolean, reasons: string[] }}
 */
function evaluateTriggers(agent, observation, signals = {}) {
  const reasons = [];
  const conf = signals.confidence != null ? signals.confidence : (agent._lastConfidence ?? 0.5);
  const nov = signals.novelty != null ? signals.novelty : 0;
  if (conf < TRIGGERS.confidenceThreshold) reasons.push('low_confidence');
  if (nov > TRIGGERS.noveltyThreshold) reasons.push('high_novelty');
  if (signals.goalConflict) reasons.push('goal_conflict');
  if ((signals.failedAttempts || 0) >= TRIGGERS.failedAttemptsThreshold)
    reasons.push('repeated_failure');
  if (signals.explicitAsk) reasons.push('explicit_ask');
  return { consult: reasons.length > 0, reasons };
}

// ---------------------------------------------------------------------------
// HermesPlanner — implements propose(ctx) for the ConsultGate (anti-stall ladder)
// ---------------------------------------------------------------------------

/**
 * Talks to Hermes (via transport) when the anti-stall ladder escalates to
 * CONSULT_LLM. Implements the same interface the StubPlanner uses:
 *   async propose(ctx) -> { focus, reason, ttlMs } | null
 */
class HermesPlanner {
  /**
   * @param {{ transport?: object, timeoutMs?: number, now?: ()=>number,
   *           onLog?: (e:object)=>void }} [opts]
   */
  constructor(opts = {}) {
    this.transport = opts.transport || new LocalHermesStub({ now: opts.now });
    this.timeoutMs = Number.isFinite(opts.timeoutMs) ? opts.timeoutMs : 5000;
    this.now = typeof opts.now === 'function' ? opts.now : () => Date.now();
    this.onLog = typeof opts.onLog === 'function' ? opts.onLog : () => {};
    this.lastResponse = null;
  }

  /**
   * @param {{ agentId:string, goalKey:string, stage:string, noProgressMs?:number,
   *   goalAgeMs?:number, focus?:string, job?:string, snapshot?:object }} ctx
   */
  async propose(ctx) {
    const query = makeMessage({
      sender: ctx.agentId,
      receiver: 'hermes',
      intent: 'query',
      type: 'AI_QUERY',
      content: ctx.focus || 'anti-stall consult',
      priority: 0.7,
      context: {
        goalKey: ctx.goalKey,
        stage: ctx.stage,
        noProgressMs: ctx.noProgressMs,
        goalAgeMs: ctx.goalAgeMs,
        focus: ctx.focus,
        job: ctx.job,
        urgency: 'high', // anti-stall already implies trouble
      },
    });
    try {
      const res = await this._withTimeout(this.transport.query(query));
      this.lastResponse = res;
      this.onLog({
        status: 'PASS',
        action: 'hermes_query',
        agent: ctx.agentId,
        decision: res && res.decision,
        source: res && res.source,
      });
      // Map the operational Hermes decision back into an intention suggestion.
      const focusMap = {
        explore_cautiously: 'explore',
        continue_current_plan: ctx.focus || 'maintain',
      };
      return {
        focus: (res && focusMap[res.decision]) || ctx.focus || 'maintain',
        reason: `hermes:${res ? res.decision : 'none'}`,
        ttlMs: 30_000,
        hermes: res,
      };
    } catch (err) {
      // §31: Hermes unavailable -> local policy keeps running. Do NOT throw.
      this.onLog({
        status: 'DEGRADED',
        action: 'hermes_unavailable',
        agent: ctx.agentId,
        error: String(err && err.message),
      });
      return null; // gate treats null as "no suggestion" -> deterministic ladder proceeds
    }
  }

  _withTimeout(promise) {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('hermes_timeout')), this.timeoutMs);
      promise.then(
        (v) => {
          clearTimeout(t);
          resolve(v);
        },
        (e) => {
          clearTimeout(t);
          reject(e);
        }
      );
    });
  }
}

// ---------------------------------------------------------------------------
// Bidirectional agent<->Hermes + agent<->agent messaging (brief §11 / §16)
// ---------------------------------------------------------------------------

/**
 * Lightweight in-process bus for AgentMessages. In a multi-process deployment this
 * would be backed by the event bus / a queue; here it is an in-memory pub/sub that
 * the worker can wire to Hermes push and to other agents.
 */
class AgentBus {
  constructor() {
    this._subs = new Map(); // receiver -> Set<fn>
    this._history = [];
    this.maxHistory = 200;
  }

  subscribe(receiver, fn) {
    if (!this._subs.has(receiver)) this._subs.set(receiver, new Set());
    this._subs.get(receiver).add(fn);
    return () => this._subs.get(receiver).delete(fn);
  }

  /**
   * @param {object} msg a message from makeMessage()
   * @returns {Promise<{ delivered: boolean, subscribers: number }>}
   */
  async publish(msg) {
    const m = makeMessage(msg);
    this._history.push(m);
    if (this._history.length > this.maxHistory) this._history.shift();
    const subs = this._subs.get(m.receiver) || this._subs.get('@world') || new Set();
    for (const fn of subs) {
      try {
        await fn(m);
      } catch (_) {
        /* best-effort */
      }
    }
    return { delivered: subs.size > 0, subscribers: subs.size };
  }

  history(receiver) {
    if (!receiver) return this._history.slice();
    return this._history.filter((m) => m.receiver === receiver || m.sender === receiver);
  }
}

// ---------------------------------------------------------------------------
// Shared world knowledge (brief §18) — may be stale; agents can override locally.
// ---------------------------------------------------------------------------

function makeWorldMemory(opts = {}) {
  return {
    facts: opts.facts || {},
    lastUpdated: opts.lastUpdated || Date.now(),
    /**
     * @param {string} key
     * @param {*} value
     * @param {{ stale?: boolean }} [meta]
     */
    set(key, value, meta = {}) {
      this.facts[key] = { value, stale: !!meta.stale, at: Date.now() };
      this.lastUpdated = Date.now();
    },
    get(key) {
      const f = this.facts[key];
      return f ? { ...f } : null;
    },
    list() {
      return Object.keys(this.facts);
    },
  };
}

// ---------------------------------------------------------------------------
// High-level bridge: wires planner + bus + world memory + triggers together.
// ---------------------------------------------------------------------------

class HermesBridge {
  /**
   * @param {{ transport?: object, worldMemory?: object, bus?: AgentBus,
   *           timeoutMs?: number, now?: ()=>number, onLog?: (e:object)=>void }} [opts]
   */
  constructor(opts = {}) {
    this.transport = opts.transport || new LocalHermesStub({ now: opts.now });
    this.worldMemory = opts.worldMemory || makeWorldMemory();
    this.bus = opts.bus || new AgentBus();
    this.bridge = new HermesPlanner({
      transport: this.transport,
      timeoutMs: opts.timeoutMs,
      now: opts.now,
      onLog: opts.onLog,
    });
    this.now = typeof opts.now === 'function' ? opts.now : () => Date.now();
    this.onLog = typeof opts.onLog === 'function' ? opts.onLog : () => {};
  }

  /** Build the ConsultGate-compatible planner. */
  get planner() {
    return this.bridge;
  }

  /**
   * Direct NPC -> Hermes question (brief §12). Returns an operational response or
   * a safe fallback when Hermes is unavailable. Never throws.
   * @param {string} agentId
   * @param {string} question
   * @param {object} [context]
   */
  async ask(agentId, question, context = {}) {
    const res = await this.bridge.propose({
      agentId,
      goalKey: context.goalKey || `ask:${agentId}`,
      stage: 'CONSULT_LLM',
      escalated: true,
      focus: context.focus,
      job: context.job,
      noProgressMs: context.noProgressMs,
      goalAgeMs: context.goalAgeMs,
      snapshot: context.snapshot,
    });
    if (!res) {
      return {
        decision: 'local_fallback',
        reasoning_summary: 'Hermes unavailable — using local policy.',
        actions: ['keep_working'],
        source: 'fallback',
      };
    }
    return res.hermes || res;
  }

  /**
   * Hermes -> agent push (brief §16): Hermes can ask the agent to do/report something.
   * @param {string} agentId
   * @param {string} question
   * @param {object} [context]
   */
  async hermesAsks(agentId, question, context = {}) {
    const msg = makeMessage({
      sender: 'hermes',
      receiver: agentId,
      intent: 'ask',
      type: 'AI_RESPONSE',
      content: question,
      context,
    });
    return this.bus.publish(msg);
  }

  /**
   * NPC -> NPC semantic message (brief §11). e.g. Steve tells Alex about a cave.
   * Also mirrors into shared world memory when the intent is 'share'.
   * @param {string} from
   * @param {string} to
   * @param {string} intent
   * @param {string} content
   * @param {object} [context]
   */
  async tell(from, to, intent, content, context = {}) {
    const msg = makeMessage({ sender: from, receiver: to, intent, content, context });
    if (intent === 'share' && context.factKey) {
      this.worldMemory.set(context.factKey, content, { stale: false });
    }
    return this.bus.publish(msg);
  }

  snapshot() {
    return {
      planner: this.bridge.snapshot ? this.bridge.snapshot() : null,
      worldFacts: this.worldMemory.list(),
      busHistory: this.bus.history().length,
    };
  }
}

module.exports = {
  makeMessage,
  LocalHermesStub,
  HermesPlanner,
  AgentBus,
  makeWorldMemory,
  HermesBridge,
  evaluateTriggers,
  TRIGGERS,
  EVENT,
};
