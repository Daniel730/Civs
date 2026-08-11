'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  nextJob,
  nextPlaceAttempt,
  workCoords,
  JOBS,
  PLACE_ATTEMPTS,
} = require('../lib/village/jobs');

describe('village jobs planner', () => {
  it('rotates visible work jobs', () => {
    const seen = new Set();
    for (let t = 1; t <= 20; t++) {
      if (t % 8 === 0) continue;
      const j = nextJob(t);
      seen.add(j.job);
      assert.ok(JOBS.includes(j.job) || j.job === 'placeregion');
    }
    assert.ok(seen.has('patrol'));
    assert.ok(seen.has('builder'));
    assert.ok(seen.has('miner'));
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

  it('workCoords yields stand/target for miner and patrol', () => {
    const origin = { x: 5200, y: 80, z: 5200 };
    const miner = workCoords(origin, { job: 'miner', dx: -14, dz: 14, tick: 1 });
    assert.ok(miner.stand);
    assert.ok(miner.target);
    assert.ok(miner.place);
    const patrol = workCoords(origin, { job: 'patrol', tick: 3 });
    assert.ok(patrol.stand);
    assert.equal(patrol.place, null);
  });
});
