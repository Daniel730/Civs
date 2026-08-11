const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  nextJob,
  nextPlaceAttempt,
  workCoords,
  siteForJob,
  JOBS,
  JOB_SITE_AFFINITY,
  JOB_CAMERA_MODE,
  PLACE_ATTEMPTS,
  EXCLUSIVE_PAIRS,
  radiusFor,
} = require('../lib/village');

describe('village jobs planner', () => {
  it('rotates visible work jobs including lumberjack and guard', () => {
    const seen = new Set();
    for (let t = 1; t <= 40; t++) {
      if (t % 8 === 0) continue;
      const j = nextJob(t);
      seen.add(j.job);
      assert.ok(JOBS.includes(j.job) || j.job === 'placeregion');
    }
    assert.ok(seen.has('patrol'));
    assert.ok(seen.has('builder'));
    assert.ok(seen.has('miner'));
    assert.ok(seen.has('lumberjack'));
    assert.ok(seen.has('guard'));
  });

  it('keeps job-site affinity (farmer never at barracks)', () => {
    for (let t = 1; t <= 70; t++) {
      if (t % 8 === 0) continue;
      const j = nextJob(t);
      if (j.job === 'placeregion') continue;
      const allowed = JOB_SITE_AFFINITY[j.job];
      assert.ok(allowed, `missing affinity for ${j.job}`);
      assert.ok(allowed.includes(j.site), `${j.job} at ${j.site} not in ${allowed}`);
      if (j.job === 'farmer') assert.equal(j.site, 'farm');
      if (j.job === 'guard') assert.ok(['barracks', 'center'].includes(j.site));
    }
  });

  it('siteForJob respects affinity lists', () => {
    assert.equal(siteForJob('farmer', 3), 'farm');
    assert.ok(['quarry', 'hovel'].includes(siteForJob('miner', 1)));
    assert.ok(['barracks', 'center'].includes(siteForJob('guard', 2)));
  });

  it('maps jobs to camera modes for director polish', () => {
    assert.equal(JOB_CAMERA_MODE.farmer, 'wide');
    assert.equal(JOB_CAMERA_MODE.guard, 'orbit');
    assert.equal(JOB_CAMERA_MODE.lumberjack, 'follow');
    assert.equal(JOB_CAMERA_MODE.miner, 'poi');
  });

  it('schedules placeregion every 8 ticks when attempts remain', () => {
    const j = nextJob(8, {});
    assert.equal(j.job, 'placeregion');
    assert.equal(j.type, PLACE_ATTEMPTS[0].type);
  });

  it('skips blocked placeregion types', () => {
    const a = nextPlaceAttempt({
      blocked: { shack: true, potato_farm: true },
      completedPlaces: {},
    });
    assert.equal(a.type, 'inn');
  });

  it('returns null when all place attempts exhausted', () => {
    const blocked = Object.fromEntries(PLACE_ATTEMPTS.map((p) => [p.type, true]));
    assert.equal(nextPlaceAttempt({ blocked, completedPlaces: {} }), null);
  });

  it('workCoords yields stand/target for miner, lumberjack, guard, patrol', () => {
    const origin = { x: 5200, y: 80, z: 5200 };
    const miner = workCoords(origin, { job: 'miner', dx: -14, dz: 14, tick: 1 });
    assert.ok(miner.stand);
    assert.ok(miner.target);
    assert.ok(miner.place);
    const lumber = workCoords(origin, { job: 'lumberjack', dx: -14, dz: 14, tick: 2 });
    assert.equal(lumber.place.material, 'oak_planks');
    const guard = workCoords(origin, { job: 'guard', dx: 24, dz: -18, tick: 4 });
    assert.ok(guard.stand);
    assert.equal(guard.place, null);
    const patrol = workCoords(origin, { job: 'patrol', tick: 3 });
    assert.ok(patrol.stand);
    assert.equal(patrol.place, null);
  });

  it('uses dedicated inn/barracks stockpile profiles', () => {
    assert.equal(PLACE_ATTEMPTS.find((p) => p.type === 'inn').stockpile, 'inn');
    assert.equal(PLACE_ATTEMPTS.find((p) => p.type === 'barracks').stockpile, 'barracks');
  });

  it('exclusive pairs map inn ↔ barracks', () => {
    assert.equal(EXCLUSIVE_PAIRS.inn, 'barracks');
    assert.equal(EXCLUSIVE_PAIRS.barracks, 'inn');
  });

  it('stockpile radius matches build footprint', () => {
    assert.equal(radiusFor('inn'), 9);
    assert.equal(radiusFor('barracks'), 7);
    assert.equal(radiusFor('farm'), 4);
  });
});
