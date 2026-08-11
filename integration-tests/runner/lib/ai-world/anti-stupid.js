/**
 * Anti-stupidity: retry budgets, stuck detection, cooldowns, plan invalidation.
 * Never allow infinite retry loops.
 */

const DEFAULTS = Object.freeze({
  maxRetries: 3,
  stuckDistanceEpsilon: 0.75,
  stuckTicks: 4,
  actionTimeoutMs: 45_000,
  goalOscillationWindow: 6,
  cooldownMs: 5_000,
});

function createGuard(opts = {}) {
  return {
    opts: { ...DEFAULTS, ...opts },
    retries: {},
    lastPositions: [],
    lastActions: [],
    lastGoals: [],
    cooldowns: {},
    invalidatedPlans: new Set(),
  };
}

/**
 * @param {ReturnType<typeof createGuard>} guard
 * @param {string} key
 * @returns {{ ok: boolean, reason?: string, remaining: number }}
 */
function tryRetry(guard, key) {
  const n = (guard.retries[key] || 0) + 1;
  guard.retries[key] = n;
  const max = guard.opts.maxRetries;
  if (n > max) {
    return { ok: false, reason: 'retry_budget_exhausted', remaining: 0 };
  }
  return { ok: true, remaining: max - n };
}

function resetRetry(guard, key) {
  delete guard.retries[key];
}

/**
 * Track position; return stuck if nearly motionless for stuckTicks samples.
 * @param {ReturnType<typeof createGuard>} guard
 * @param {{ x: number, y: number, z: number }} pos
 */
function notePosition(guard, pos) {
  guard.lastPositions.push({ ...pos, at: Date.now() });
  const keep = guard.opts.stuckTicks + 2;
  if (guard.lastPositions.length > keep) {
    guard.lastPositions.splice(0, guard.lastPositions.length - keep);
  }
  if (guard.lastPositions.length < guard.opts.stuckTicks) {
    return { stuck: false };
  }
  const recent = guard.lastPositions.slice(-guard.opts.stuckTicks);
  const first = recent[0];
  const last = recent[recent.length - 1];
  const dx = last.x - first.x;
  const dy = last.y - first.y;
  const dz = last.z - first.z;
  const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (dist < guard.opts.stuckDistanceEpsilon) {
    return { stuck: true, reason: 'no_progress', dist };
  }
  return { stuck: false, dist };
}

/**
 * Detect A↔B goal oscillation.
 * @param {ReturnType<typeof createGuard>} guard
 * @param {string} goalId
 */
function noteGoal(guard, goalId) {
  guard.lastGoals.push(goalId);
  const w = guard.opts.goalOscillationWindow;
  if (guard.lastGoals.length > w) {
    guard.lastGoals.splice(0, guard.lastGoals.length - w);
  }
  if (guard.lastGoals.length < 4) return { oscillating: false };
  const a = guard.lastGoals[guard.lastGoals.length - 1];
  const b = guard.lastGoals[guard.lastGoals.length - 2];
  if (a === b) return { oscillating: false };
  let flips = 0;
  for (let i = 1; i < guard.lastGoals.length; i++) {
    if (guard.lastGoals[i] !== guard.lastGoals[i - 1]) flips++;
  }
  if (flips >= w - 1 && new Set(guard.lastGoals).size <= 2) {
    return { oscillating: true, reason: 'goal_oscillation', goals: [a, b] };
  }
  return { oscillating: false };
}

/**
 * Deduplicate identical actions within cooldown.
 * @param {ReturnType<typeof createGuard>} guard
 * @param {string} actionKey
 */
function allowAction(guard, actionKey) {
  const now = Date.now();
  const until = guard.cooldowns[actionKey] || 0;
  if (now < until) {
    return { ok: false, reason: 'cooldown', retryInMs: until - now };
  }
  guard.cooldowns[actionKey] = now + guard.opts.cooldownMs;
  guard.lastActions.push({ key: actionKey, at: now });
  if (guard.lastActions.length > 32) guard.lastActions.shift();
  return { ok: true };
}

function invalidatePlan(guard, planId) {
  guard.invalidatedPlans.add(planId);
}

function isPlanValid(guard, planId) {
  return !guard.invalidatedPlans.has(planId);
}

/**
 * @param {number} startedAt
 * @param {number} [timeoutMs]
 */
function isTimedOut(startedAt, timeoutMs = DEFAULTS.actionTimeoutMs) {
  return Date.now() - startedAt > timeoutMs;
}

module.exports = {
  DEFAULTS,
  createGuard,
  tryRetry,
  resetRetry,
  notePosition,
  noteGoal,
  allowAction,
  invalidatePlan,
  isPlanValid,
  isTimedOut,
};
