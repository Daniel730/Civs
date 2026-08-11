/**
 * Explicit finite state machine for the cinematic director (issue #72).
 *
 * The behaviour already existed in `cinematic.js` (subject scoring, dwell windows, event
 * priority, fallback orbit) — this module names the editorial modes and makes every change of
 * mode an explicit, observable transition:
 *
 *   IDLE          director constructed / stopped
 *   SEARCHING     ticking but no subject selected yet
 *   ESTABLISHING  first shot on a newly committed subject
 *   FOLLOWING     steady coverage of an active subject
 *   ACTION        shot driven by a high-priority event (priority >= ACTION_PRIORITY)
 *   DRAMATIC      shot driven by a survival-grade event (priority >= DRAMATIC_PRIORITY)
 *   OBSERVING     steady coverage of an idle / low-interest subject
 *   TRANSITIONING momentary state while a cut (new shot) is being issued
 *   RECOVERING    camera offline or every subject offline → fallback orbit
 *
 * Deterministic and clock-injectable; NOT coupled to any LLM — transitions derive purely from
 * observed world state (issue #72 / D-AP-021). Transitions emit an OTel counter
 * (`camera_fsm_transition_count`) and a log entry.
 */

const { METRIC, countMetric } = require('../metrics');

const STATES = Object.freeze([
  'IDLE',
  'SEARCHING',
  'ESTABLISHING',
  'FOLLOWING',
  'ACTION',
  'DRAMATIC',
  'OBSERVING',
  'TRANSITIONING',
  'RECOVERING',
]);

/** Event priority thresholds (mirror subject-scoring: >=70 preempts dwell, >=90 is survival). */
const ACTION_PRIORITY = 70;
const DRAMATIC_PRIORITY = 90;

/**
 * Allowed edges. The FSM is deliberately forgiving — an unexpected edge is logged as DEGRADED
 * and still taken (a 24/7 stream must never wedge on a state assertion) — but the map documents
 * the intended editorial grammar and tests assert the main paths stay legal.
 */
const TRANSITIONS = Object.freeze({
  IDLE: ['SEARCHING', 'RECOVERING'],
  SEARCHING: ['SEARCHING', 'TRANSITIONING', 'RECOVERING', 'IDLE'],
  ESTABLISHING: [
    'FOLLOWING',
    'OBSERVING',
    'ACTION',
    'DRAMATIC',
    'TRANSITIONING',
    'SEARCHING',
    'RECOVERING',
    'IDLE',
  ],
  FOLLOWING: ['FOLLOWING', 'OBSERVING', 'TRANSITIONING', 'SEARCHING', 'RECOVERING', 'IDLE'],
  ACTION: ['ACTION', 'FOLLOWING', 'OBSERVING', 'TRANSITIONING', 'SEARCHING', 'RECOVERING', 'IDLE'],
  DRAMATIC: [
    'DRAMATIC',
    'ACTION',
    'FOLLOWING',
    'OBSERVING',
    'TRANSITIONING',
    'SEARCHING',
    'RECOVERING',
    'IDLE',
  ],
  OBSERVING: ['OBSERVING', 'FOLLOWING', 'TRANSITIONING', 'SEARCHING', 'RECOVERING', 'IDLE'],
  TRANSITIONING: [
    'ESTABLISHING',
    'FOLLOWING',
    'ACTION',
    'DRAMATIC',
    'OBSERVING',
    'SEARCHING',
    'RECOVERING',
    'IDLE',
  ],
  RECOVERING: ['RECOVERING', 'SEARCHING', 'TRANSITIONING', 'IDLE'],
});

/** Activities considered low-interest enough that steady coverage is OBSERVING, not FOLLOWING. */
const OBSERVING_ACTIVITIES = Object.freeze(['idle', 'stockpile']);

/**
 * Pick the steady/coverage state for a subject given its live event and activity.
 * @param {{event?: {priority:number}|null, activity?: string|null, isNewSubject?: boolean}} ctx
 */
function coverageState(ctx = {}) {
  const priority = ctx.event ? ctx.event.priority : 0;
  if (priority >= DRAMATIC_PRIORITY) return 'DRAMATIC';
  if (priority >= ACTION_PRIORITY) return 'ACTION';
  if (ctx.isNewSubject) return 'ESTABLISHING';
  if (ctx.activity && OBSERVING_ACTIVITIES.includes(ctx.activity)) return 'OBSERVING';
  return 'FOLLOWING';
}

class DirectorFSM {
  /**
   * @param {{ camera?: string, onLog?: (entry: object) => void, now?: () => number }} opts
   */
  constructor(opts = {}) {
    this.cameraName = opts.camera || 'camera';
    this.onLog = typeof opts.onLog === 'function' ? opts.onLog : () => {};
    this.now = typeof opts.now === 'function' ? opts.now : () => Date.now();
    this.state = 'IDLE';
    this.stateSince = this.now();
    this.transitions = 0;
    this.invalidTransitions = 0;
    this.lastTransition = null;
    this.history = [];
  }

  is(state) {
    return this.state === state;
  }

  /**
   * Move to a state. No-op when already there. Records an OTel counter and a log line on every
   * real change; an edge outside TRANSITIONS is logged DEGRADED but still taken.
   * @param {string} to one of STATES
   * @param {string} reason machine-readable cause (e.g. 'dwell_expired', 'no_subjects_online')
   */
  transition(to, reason = 'unspecified') {
    if (!STATES.includes(to)) {
      throw new Error(`unknown FSM state: ${to}`);
    }
    if (to === this.state) return { changed: false, state: to };
    const from = this.state;
    const valid = (TRANSITIONS[from] || []).includes(to);
    const now = this.now();
    const heldMs = now - this.stateSince;
    this.state = to;
    this.stateSince = now;
    this.transitions += 1;
    if (!valid) this.invalidTransitions += 1;
    this.lastTransition = { from, to, reason, at: now, heldMs, valid };
    this.history.push(this.lastTransition);
    if (this.history.length > 32) this.history.shift();
    countMetric(METRIC.CAMERA_FSM_TRANSITION, { camera: this.cameraName, from, to, reason });
    this.onLog({
      status: valid ? 'PASS' : 'DEGRADED',
      action: 'director_fsm_transition',
      from,
      to,
      reason,
      heldMs,
      valid,
    });
    return { changed: true, from, to, reason, valid };
  }

  snapshot() {
    return {
      state: this.state,
      stateForMs: this.now() - this.stateSince,
      transitions: this.transitions,
      invalidTransitions: this.invalidTransitions,
      lastTransition: this.lastTransition,
    };
  }
}

module.exports = {
  DirectorFSM,
  STATES,
  TRANSITIONS,
  coverageState,
  ACTION_PRIORITY,
  DRAMATIC_PRIORITY,
  OBSERVING_ACTIVITIES,
};
