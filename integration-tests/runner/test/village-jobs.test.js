const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  nextJob,
  nextPlaceAttempt,
  workCoords,
  siteForJob,
  apronStand,
  approachFrom,
  SITE_FOOTPRINT,
  JOBS,
  JOB_SITE_AFFINITY,
  JOB_CAMERA_MODE,
  PLACE_ATTEMPTS,
  EXCLUSIVE_PAIRS,
  radiusFor,
  blueprintFor,
  houseShell,
  cleanupTargets,
  paletteFor,
  horizDist,
  isNaturalSurface,
} = require('../lib/village');

describe('village jobs planner', () => {
  it('rotates visible work jobs including lumberjack, guard, beautify', () => {
    const seen = new Set();
    for (let t = 0; t <= 80; t++) {
      const j = nextJob(t);
      seen.add(j.job);
      assert.ok(JOBS.includes(j.job) || j.job === 'placeregion' || j.job === 'beautify');
    }
    assert.ok(seen.has('patrol'));
    assert.ok(seen.has('builder'));
    assert.ok(seen.has('miner'));
    assert.ok(seen.has('lumberjack'));
    assert.ok(seen.has('guard'));
    assert.ok(seen.has('beautify'));
    assert.ok(!seen.has('stockpile'), 'standalone stockpile terraform job must be gone');
  });

  it('does not schedule stockpile as a job id', () => {
    assert.ok(!JOBS.includes('stockpile'));
  });

  it('keeps job-site affinity (farmer never at barracks)', () => {
    for (let t = 1; t <= 70; t++) {
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
    assert.ok(['quarry'].includes(siteForJob('miner', 1)));
    assert.ok(['barracks', 'center'].includes(siteForJob('guard', 2)));
  });

  it('maps jobs to camera modes for director polish', () => {
    assert.equal(JOB_CAMERA_MODE.farmer, 'wide');
    assert.equal(JOB_CAMERA_MODE.guard, 'orbit');
    assert.equal(JOB_CAMERA_MODE.lumberjack, 'follow');
    assert.equal(JOB_CAMERA_MODE.miner, 'poi');
    assert.equal(JOB_CAMERA_MODE.beautify, 'poi');
  });

  it('schedules placeregion every 11 ticks when attempts remain', () => {
    const j = nextJob(11, {});
    assert.equal(j.job, 'placeregion');
    assert.equal(j.type, PLACE_ATTEMPTS[0].type);
  });

  it('injects extra beautify on %4 ticks', () => {
    const j = nextJob(4, {});
    assert.equal(j.job, 'beautify');
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

  it('workCoords yields stand/target without scatter place for miner/lumber/builder', () => {
    const origin = { x: 5200, y: 80, z: 5200 };
    const miner = workCoords(origin, { job: 'miner', dx: -14, dz: 14, tick: 1 });
    assert.ok(miner.stand);
    assert.ok(miner.target);
    assert.equal(miner.place, null);
    const lumber = workCoords(origin, { job: 'lumberjack', dx: -14, dz: 14, tick: 2 });
    assert.equal(lumber.place, null);
    const builder = workCoords(origin, {
      job: 'builder',
      site: 'shelter',
      dx: -10,
      dz: 0,
      tick: 3,
    });
    assert.equal(builder.place, null);
    assert.equal(builder.blueprint, true);
    const beautify = workCoords(origin, {
      job: 'beautify',
      site: 'shelter',
      dx: -10,
      dz: 0,
      tick: 4,
    });
    assert.equal(beautify.cleanup, true);
    const guard = workCoords(origin, { job: 'guard', dx: 24, dz: -18, tick: 4 });
    assert.ok(guard.stand);
    assert.equal(guard.place, null);
    assert.equal(guard.stand.x, Math.floor(guard.stand.x));
    assert.equal(guard.stand.z, Math.floor(guard.stand.z));
    const patrol = workCoords(origin, { job: 'patrol', tick: 3 });
    assert.ok(patrol.stand);
    assert.equal(patrol.place, null);
    assert.equal(patrol.stand.x, Math.floor(patrol.stand.x));
  });

  it('keeps farmer stand on apron outside potato_farm footprint', () => {
    const origin = { x: 5200, y: 80, z: 5200 };
    const farm = workCoords(origin, { job: 'farmer', site: 'farm', dx: 0, dz: -14, tick: 5 });
    const farmOz = origin.z - 14;
    const minOutside = farmOz - SITE_FOOTPRINT.farm;
    assert.ok(farm.stand.z <= minOutside, `stand ${farm.stand.z} must be <= ${minOutside}`);
    const expected = apronStand(origin.x, origin.y, farmOz, SITE_FOOTPRINT.farm, 2);
    assert.deepEqual(farm.stand, expected);
    const approach = approachFrom(farm.stand);
    assert.equal(approach.x, farm.stand.x - 2);
    assert.equal(approach.z, farm.stand.z - 2);
    assert.equal(farm.blueprint, true);
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

describe('village blueprints player-like (no platforms)', () => {
  it('cabin shell has floor+walls+roof with door gap for construction IR', () => {
    const origin = { x: 5200, y: 80, z: 5200 };
    const shell = houseShell(origin, { site: 'shelter', dx: -10, dz: 0, tick: 0 });
    const roles = new Set(shell.allBlocks.map((b) => b.role));
    assert.ok(roles.has('floor'), 'construction IR needs surface floor (not a flatten pad)');
    assert.ok(roles.has('wall'));
    assert.ok(roles.has('roof'));
    assert.ok(shell.allBlocks.length <= 120, 'footprint must stay small');
    assert.equal(paletteFor('shelter').wall, 'oak_planks');
    // Door gap: south mid at y+1/+2 absent (ax=ox-2, door x=ax+2)
    const doorCells = shell.allBlocks.filter(
      (b) => b.z === 5200 - 8 && b.x === 5200 - 10 - 2 + 2 && b.y >= 81 && b.y <= 82
    );
    assert.equal(doorCells.length, 0);
  });

  it('respects groundY for slopes', () => {
    const origin = { x: 5200, y: 80, z: 5200 };
    const shell = houseShell(origin, { site: 'shelter', dx: -10, dz: 0, tick: 0, groundY: 77 });
    assert.ok(shell.allBlocks.every((b) => b.y >= 77 && b.y <= 81));
  });

  it('blueprintFor farm returns fence posts; housing prefers path over cabin', () => {
    const origin = { x: 5200, y: 80, z: 5200 };
    const farm = blueprintFor(origin, { job: 'farmer', site: 'farm', dx: 0, dz: -14, tick: 1 });
    assert.equal(farm.id, 'farm_edge');
    assert.ok(farm.blocks.every((b) => b.material === 'oak_fence'));
    const path = blueprintFor(origin, { job: 'builder', site: 'shelter', dx: -10, dz: 0, tick: 1 });
    assert.ok(path.id.startsWith('path_'));
    const cabin = blueprintFor(origin, {
      job: 'builder',
      site: 'shelter',
      dx: -10,
      dz: 0,
      tick: 5,
    });
    assert.ok(cabin.id.startsWith('cabin_'));
  });

  it('cleanupTargets hit historic junk pad and former floor platform scars', () => {
    const origin = { x: 5200, y: 80, z: 5200 };
    const all = [];
    for (let tick = 0; tick < 40; tick++) {
      all.push(...cleanupTargets(origin, { dx: -10, dz: 0, tick }));
    }
    assert.ok(all.some((t) => t.x === 5196 && t.z >= 5195 && t.action === 'break'));
    assert.ok(all.some((t) => t.action === 'set_grass'));
    // Former 5×5 shell floor around (5188, 5192)
    assert.ok(all.some((t) => t.x === 5188 && t.z === 5192 && t.action === 'set_grass'));
  });

  it('isNaturalSurface recognizes grass/dirt/path', () => {
    assert.equal(isNaturalSurface('grass_block'), true);
    assert.equal(isNaturalSurface('oak_planks'), false);
  });

  it('horizDist is planar', () => {
    assert.equal(horizDist({ x: 0, z: 0 }, { x: 3, z: 4 }), 5);
  });
});
