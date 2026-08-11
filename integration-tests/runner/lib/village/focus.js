/**
 * Settlement focus — the "intention" layer above the per-tick job rotation.
 *
 * The AI World contract is that a high-level intention changes rarely (20–60 s) while a
 * deterministic controller decides what to do each tick. `nextJob` is that controller; this is the
 * intention. Keeping them separate means the focus can be cached (see `IntentionCache`) without
 * freezing the job rotation, and an LLM — if one is ever wired in — only has to choose between a
 * handful of named focuses instead of driving movement.
 *
 * Pure: derived only from worker state and the survival verdict.
 */

const { nextPlaceAttempt } = require('./jobs');

const FOCUSES = Object.freeze(['survive', 'found', 'build', 'maintain', 'secure']);

/** Jobs that serve each focus. Used to bias, never to force. */
const FOCUS_JOBS = Object.freeze({
  survive: ['guard'],
  found: ['placeregion', 'stockpile', 'builder'],
  build: ['builder', 'miner', 'lumberjack'],
  maintain: ['beautify', 'farmer'],
  secure: ['guard', 'patrol'],
});

/**
 * @param {{ completedPlaces?:object, blocked?:object, construction?:object, failCounts?:object }} state
 * @param {{ survivalState?:string, townOk?:boolean }} [ctx]
 * @returns {{ focus:string, reason:string, contextKey:string }}
 */
function chooseFocus(state = {}, ctx = {}) {
  const survival = ctx.survivalState || 'SAFE';
  const completed = Object.keys(state.completedPlaces || {}).length;
  const construction = (state.construction && state.construction.status) || null;

  let focus;
  let reason;
  if (survival !== 'SAFE' && survival !== 'CAUTION') {
    focus = 'survive';
    reason = `survival:${survival}`;
  } else if (ctx.townOk === false) {
    focus = 'found';
    reason = 'town_missing';
  } else if (nextPlaceAttempt(state) && completed < 3) {
    focus = 'found';
    reason = 'regions_remaining';
  } else if (construction === 'PROJECT_PAUSED' || construction === 'PROJECT_ABORTED') {
    focus = 'build';
    reason = `construction:${construction}`;
  } else if (completed >= 3) {
    focus = 'maintain';
    reason = 'settlement_established';
  } else {
    focus = 'secure';
    reason = 'nothing_pending';
  }

  return {
    focus,
    reason,
    // Digest of the facts the focus depends on — a change here is a cache miss.
    contextKey: [survival === 'SAFE' || survival === 'CAUTION' ? 'ok' : survival, ctx.townOk !== false ? 'town' : 'no_town', completed, construction || 'none'].join('|'),
  };
}

/**
 * Nudge the rotation toward the focus without breaking it.
 *
 * The rotation exists so the camera sees varied activity, so at most one job in three is
 * substituted; the rest of the cycle plays out untouched.
 *
 * @param {{job:string}} step
 * @param {string} focus
 * @param {number} tick
 * @returns {{job:string, biasedFrom?:string, focus:string}}
 */
function biasJob(step, focus, tick) {
  if (!step || !focus) return step;
  const wanted = FOCUS_JOBS[focus] || [];
  if (!wanted.length) return { ...step, focus };
  if (wanted.includes(step.job)) return { ...step, focus };
  // Founding a region is never overridden: it is the most valuable action available.
  if (step.job === 'placeregion') return { ...step, focus };
  if (tick % 3 !== 0) return { ...step, focus };
  const target = wanted[Math.floor(tick / 3) % wanted.length];
  if (target === 'placeregion' || target === 'stockpile') return { ...step, focus };
  return { ...step, job: target, biasedFrom: step.job, focus };
}

module.exports = { FOCUSES, FOCUS_JOBS, chooseFocus, biasJob };
