/**
 * World-state representation for the AI World neural layer.
 *
 * This module is the single source of truth for turning a raw `observe` payload
 * (plus a small amount of agent context) into:
 *   1. a normalized numeric STATE VECTOR used by any future policy/embedding
 *   2. a structured EXPERIENCE record that the collector persists
 *
 * Design rules (per the MVP brief):
 *  - Pure functions only; injectable clock; no side effects; no network.
 *  - No heavy deps. Plain math.
 *  - Every field is named + bounded so the dataset stays interpretable.
 *
 * The vector is intentionally small and interpretable: a future shared policy
 * can be trained across NPCs because the schema is agent-agnostic; personality
 * and memory are passed separately, not baked into the vector.
 */

const { STATES } = require('./intention-cache'); // not used directly, kept for symmetry

// Canonical order of the numeric state vector. Indices are stable on purpose:
// adding a field = append + bump VERSION. Do NOT reorder.
const FIELDS = Object.freeze([
  'health_pct', // 0..1
  'food_pct', // 0..1
  'air_pct', // 0..1 (underwater breathing room)
  'hostiles_near', // count of hostiles within caution range (already normalized-ish)
  'nearest_hostile_dist', // blocks, clamped; far -> 1.0
  'danger_flag', // 0/1 (DANGER+)
  'escape_flag', // 0/1 (ESCAPE)
  'recover_flag', // 0/1 (dead / stranded)
  'distance_from_work', // normalized by leash radius (0..1, clamped)
  'current_goal_progress', // 0..1 (higher = closer to done)
  'no_progress_ms', // normalized by 60s
  'stall_stage', // 0..4 (AntiStall ladder index)
  'time_since_last_meal', // normalized by 10 min
  'has_armor', // 0/1 (survival gear equipped)
  'light_level', // 0..1 (darkness risk)
  'in_water', // 0/1
  'in_lava', // 0/1
]);

const VERSION = 1;
const VEC_LEN = FIELDS.length;

function clamp01(x) {
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

/**
 * @param {object} obs raw observe().data (health, food, hostiles, nearest_hostile, x,y,z, ...)
 * @param {object} ctx
 * @param {object} ctx.survival assessment from SurvivalMonitor (state, healthPct, distanceFromWork, ...)
 * @param {number} [ctx.leashRadius=120]
 * @param {number} [ctx.goalProgress] 0..1 current objective completion
 * @param {number} [ctx.noProgressMs]
 * @param {number} [ctx.stallStage] 0..4
 * @param {number} [ctx.hasArmor] 0/1
 * @param {number} [ctx.timeSinceMealMs]
 */
function encodeState(obs = {}, ctx = {}) {
  const o = obs || {};
  const health = Number(o.health);
  const maxHealth = Number(o.max_health) > 0 ? Number(o.max_health) : 20;
  const food = Number(o.food);
  const maxFood = 20;
  const air = Number(o.remaining_air != null ? o.remaining_air : 300);
  const maxAir = 300;

  const surv = ctx.survival || {};
  const stateRank = { SAFE: 0, CAUTION: 1, DANGER: 2, ESCAPE: 3, RECOVER: 4 };
  const s = String(surv.state || 'SAFE').toUpperCase();
  const stallStage = ctx.stallStage != null ? ctx.stallStage : 0;
  const leash = ctx.leashRadius || 120;
  const dist = Number.isFinite(surv.distanceFromWork) ? surv.distanceFromWork : 0;

  const vec = [
    clamp01(health / maxHealth),
    clamp01(food / maxFood),
    clamp01(air / maxAir),
    clamp01((Number(o.hostiles) || 0) / 4), // ~4+ hostiles saturates
    clamp01(
      Number(
        o.nearest_hostile && o.nearest_hostile.distance != null
          ? Number(o.nearest_hostile.distance) / 16
          : 1
      )
    ), // 16 blocks -> 0 (close), far -> 1
    s === 'DANGER' || s === 'ESCAPE' || s === 'RECOVER' ? 1 : 0,
    s === 'ESCAPE' ? 1 : 0,
    s === 'RECOVER' ? 1 : 0,
    clamp01(dist / leash),
    clamp01(ctx.goalProgress != null ? ctx.goalProgress : 0),
    clamp01((ctx.noProgressMs || 0) / 60000),
    clamp01(stallStage / 4),
    clamp01((ctx.timeSinceMealMs || 0) / (10 * 60 * 1000)),
    ctx.hasArmor ? 1 : 0,
    clamp01((Number(o.light_level) || 15) / 15),
    o.in_water ? 1 : 0,
    o.in_lava ? 1 : 0,
  ];

  return { version: VERSION, fields: FIELDS, vec, len: VEC_LEN };
}

/**
 * Build the structured experience record. This is what the collector persists.
 * It captures enough context to later investigate WHY a decision was good/bad.
 */
function buildExperience(rec = {}) {
  const {
    episodeId,
    agentId,
    at,
    observation = {},
    stateRep,
    personality = {},
    candidates = [],
    chosenIntent,
    deterministicScores = {},
    neuralScores = null, // null when policy != neural/shadow
    policyMode = 'deterministic',
    action = null,
    outcome = null, // attached later: { kind, reward, durationMs, progress, stalled, damaged, died, goalCompleted, goalFailed }
  } = rec;

  return {
    schema: 'aiworld.experience',
    version: VERSION,
    episodeId,
    agentId,
    at: at || Date.now(),
    observation,
    stateRep: stateRep || encodeState(observation, rec.ctx || {}),
    personality,
    candidates,
    chosenIntent,
    deterministicScores,
    neuralScores,
    policyMode,
    action,
    outcome: outcome || null,
    // convenience flat vector for offline tooling
    stateVec: (stateRep && stateRep.vec) || encodeState(observation, rec.ctx || {}).vec,
  };
}

/**
 * Compute an explicit, simple, configurable reward from an outcome.
 * Weights are documented and tunable via `weights`.
 */
function computeReward(outcome = {}, weights = {}) {
  const w = {
    goalCompleted: 1.0,
    progress: 0.1, // per 0.01 progress delta, scaled below
    death: -1.0,
    unnecessaryDamage: -0.1, // per 0.1 health lost without a kill
    stall: -0.2, // per stall event
    abandonUseful: -0.3,
    recoverySuccess: 0.4,
    ...weights,
  };

  let r = 0;
  const log = [];
  const add = (key, amount) => {
    if (!Number.isFinite(amount) || amount === 0) return;
    r += amount;
    log.push({ key, amount: Math.round(amount * 1000) / 1000 });
  };

  if (outcome.goalCompleted) add('goalCompleted', w.goalCompleted);
  if (typeof outcome.progressDelta === 'number') {
    add('progress', w.progress * (outcome.progressDelta / 0.01));
  }
  if (outcome.died) add('death', w.death);
  if (typeof outcome.damageTaken === 'number') {
    add('unnecessaryDamage', w.unnecessaryDamage * (outcome.damageTaken / 0.1));
  }
  if (outcome.stalled) add('stall', w.stall);
  if (outcome.abandonedUseful) add('abandonUseful', w.abandonUseful);
  if (outcome.recovered) add('recoverySuccess', w.recoverySuccess);

  r = Math.max(-2, Math.min(2, r)); // clamp for stability
  return { reward: Math.round(r * 1000) / 1000, components: log, weights: w };
}

module.exports = {
  FIELDS,
  VERSION,
  VEC_LEN,
  encodeState,
  buildExperience,
  computeReward,
  clamp01,
};
