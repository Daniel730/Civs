const JOBS = Object.freeze([
  'patrol',
  'builder',
  'miner',
  'farmer',
  'stockpile',
  'lumberjack',
  'guard',
  'placeregion',
]);

/** Sites relative to village origin (matches village-builder pad layout). */
const SITES = Object.freeze({
  center: { dx: 0, dz: 0, label: 'council' },
  shelter: { dx: -10, dz: 0, label: 'shelter' },
  hovel: { dx: 0, dz: 14, label: 'hovel' },
  quarry: { dx: -14, dz: 14, label: 'cobble_quarry' },
  smithy: { dx: -14, dz: -10, label: 'smithy' },
  farm: { dx: 0, dz: -14, label: 'farm_pad' },
  inn: { dx: 24, dz: 24, label: 'inn_pad' },
  barracks: { dx: 24, dz: -18, label: 'barracks_pad' },
  shack: { dx: 10, dz: 0, label: 'shack_pad' },
});

/**
 * Preferred work sites per job so camera shows coherent activity
 * (farmer at farm, not barracks).
 */
const JOB_SITE_AFFINITY = Object.freeze({
  patrol: ['center'],
  builder: ['shelter', 'hovel', 'smithy', 'shack'],
  miner: ['quarry', 'hovel'],
  farmer: ['farm'],
  stockpile: ['shack', 'shelter'],
  lumberjack: ['quarry', 'shelter', 'hovel'],
  guard: ['barracks', 'center'],
});

/** Preferred FallbackDirector / ShotPlanner modes when a job succeeds. */
const JOB_CAMERA_MODE = Object.freeze({
  patrol: 'orbit',
  builder: 'event',
  miner: 'poi',
  farmer: 'wide',
  stockpile: 'follow',
  lumberjack: 'follow',
  guard: 'orbit',
  placeregion: 'event',
});

/** Settlement-tier retries (honest stockpile + placeregion). */
const PLACE_ATTEMPTS = Object.freeze([
  { type: 'shack', site: 'shack', stockpile: 'hovel' },
  { type: 'potato_farm', site: 'farm', stockpile: 'farm' },
  { type: 'inn', site: 'inn', stockpile: 'inn' },
  { type: 'barracks', site: 'barracks', stockpile: 'barracks' },
]);

/** Civs exclusive: pairs — placing one blocks the other in the same town. */
const EXCLUSIVE_PAIRS = Object.freeze({
  inn: 'barracks',
  barracks: 'inn',
});

/**
 * Pick a site key for a job using affinity, falling back to all sites.
 * @param {string} job
 * @param {number} tick
 */
function siteForJob(job, tick) {
  const n = Math.max(0, Math.floor(tick));
  const affinity = JOB_SITE_AFFINITY[job];
  const keys = affinity && affinity.length ? affinity : Object.keys(SITES);
  return keys[n % keys.length];
}

/**
 * @param {number} tick
 * @param {{ blocked?: Record<string, boolean>, completedPlaces?: Record<string, boolean> }} [state]
 */
function nextJob(tick, state = {}) {
  const n = Math.max(0, Math.floor(tick));
  // Every 8th job try placeregion for next unlocked structure.
  if (n > 0 && n % 8 === 0) {
    const attempt = nextPlaceAttempt(state);
    if (attempt) return { job: 'placeregion', ...attempt };
  }
  const rotate = JOBS.filter((j) => j !== 'placeregion');
  const job = rotate[n % rotate.length];
  const siteKey = siteForJob(job, n);
  return { job, site: siteKey, ...SITES[siteKey] };
}

/**
 * @param {{ blocked?: Record<string, boolean>, completedPlaces?: Record<string, boolean> }} state
 */
function nextPlaceAttempt(state) {
  const blocked = state.blocked || {};
  const done = state.completedPlaces || {};
  for (const a of PLACE_ATTEMPTS) {
    if (done[a.type] || blocked[a.type]) continue;
    return { ...a, ...SITES[a.site] };
  }
  return null;
}

/**
 * Absolute work coordinates for a job at origin.
 * @param {{ x:number,y:number,z:number }} origin
 * @param {{ dx?:number, dz?:number, job?:string, tick?:number }} step
 */
function workCoords(origin, step) {
  const ox = origin.x + (step.dx || 0);
  const oz = origin.z + (step.dz || 0);
  const oy = origin.y;
  const tick = step.tick || 0;
  switch (step.job) {
    case 'miner':
      return {
        stand: { x: ox + 2, y: oy + 1, z: oz + 2 },
        target: { x: ox + 3, y: oy, z: oz + 2 },
        place: { x: ox + 4, y: oy + 1, z: oz + 2, material: 'cobblestone' },
      };
    case 'farmer':
      return {
        stand: { x: ox, y: oy + 1, z: oz - 2 },
        target: { x: ox + (tick % 3) - 1, y: oy, z: oz - 3 },
        place: {
          x: ox + (tick % 3) - 1,
          y: oy + 1,
          z: oz - 3,
          material: 'potatoes',
        },
      };
    case 'lumberjack':
      return {
        stand: { x: ox + 2, y: oy + 1, z: oz - 1 },
        target: { x: ox + 3, y: oy, z: oz - 1 },
        place: { x: ox + 4, y: oy + 1, z: oz - 1, material: 'oak_planks' },
      };
    case 'guard':
      return {
        stand: {
          x: ox + Math.cos(tick * 0.7) * 4,
          y: oy + 1,
          z: oz + Math.sin(tick * 0.7) * 4,
        },
        target: { x: ox, y: oy + 1, z: oz },
        place: null,
      };
    case 'builder':
    case 'stockpile':
      return {
        stand: { x: ox + 1, y: oy + 1, z: oz + 1 },
        target: { x: ox + 2, y: oy + 1, z: oz },
        place: {
          x: ox + 2 + (tick % 2),
          y: oy + 1,
          z: oz + (tick % 3),
          material: 'stone_bricks',
        },
      };
    default: {
      const a = tick * 0.55;
      return {
        stand: {
          x: origin.x + Math.cos(a) * 8,
          y: oy + 1,
          z: origin.z + Math.sin(a) * 8,
        },
        target: { x: origin.x, y: oy, z: origin.z },
        place: null,
      };
    }
  }
}

module.exports = {
  JOBS,
  SITES,
  JOB_SITE_AFFINITY,
  JOB_CAMERA_MODE,
  PLACE_ATTEMPTS,
  EXCLUSIVE_PAIRS,
  siteForJob,
  nextJob,
  nextPlaceAttempt,
  workCoords,
};
