const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { SurvivalMonitor, bucketCause } = require('../lib/survival/threat');
const { executeSurvival } = require('../lib/survival/execute');
const { METRIC, initMetrics, resetMetrics, metricsSnapshot, counterBreakdown } = require('../lib/metrics');

const WORK = { x: 5200, y: 80, z: 5200 };

function obs(over = {}) {
  return {
    x: WORK.x,
    y: WORK.y,
    z: WORK.z,
    health: 20,
    max_health: 20,
    food: 20,
    dead: false,
    in_water: false,
    in_lava: false,
    remaining_air: 300,
    fall_distance: 0,
    light_level: 15,
    hostiles: 0,
    nearest_hostile: null,
    last_damage_cause: null,
    deaths: 0,
    ...over,
  };
}

describe('SurvivalMonitor', () => {
  beforeEach(() => {
    initMetrics({ serviceName: 'test' });
    resetMetrics();
  });

  it('is SAFE and recommends work on a healthy tick', () => {
    const m = new SurvivalMonitor({ actor: 'Steve', workOrigin: WORK });
    const a = m.assess(obs());
    assert.equal(a.state, 'SAFE');
    assert.equal(a.action.kind, 'work');
    assert.equal(a.action.guarded, false);
  });

  it('escalates to CAUTION for a distant hostile without stopping work', () => {
    const m = new SurvivalMonitor({ actor: 'Steve', workOrigin: WORK });
    const a = m.assess(obs({ hostiles: 1, nearest_hostile: { type: 'ZOMBIE', distance: 12 } }));
    assert.equal(a.state, 'CAUTION');
    assert.equal(a.action.kind, 'work');
    assert.equal(a.action.guarded, true);
    assert.ok(a.threats.includes('hostile_nearby'));
  });

  it('escalates to DANGER and fights when a hostile is on top of the agent', () => {
    const m = new SurvivalMonitor({ actor: 'Steve', workOrigin: WORK });
    const a = m.assess(obs({ hostiles: 2, nearest_hostile: { type: 'ZOMBIE', distance: 3 } }));
    assert.equal(a.state, 'DANGER');
    assert.equal(a.action.kind, 'defend');
    assert.equal(a.action.target, 'ZOMBIE');
  });

  it('retreats instead of fighting when health is nearly gone', () => {
    const m = new SurvivalMonitor({ actor: 'Steve', workOrigin: WORK });
    const a = m.assess(obs({ health: 5, hostiles: 1, nearest_hostile: { type: 'ZOMBIE', distance: 3 } }));
    assert.equal(a.state, 'ESCAPE');
    assert.equal(a.action.kind, 'flee');
  });

  it('ESCAPEs out of lava', () => {
    const m = new SurvivalMonitor({ actor: 'Steve', workOrigin: WORK });
    const a = m.assess(obs({ in_lava: true }));
    assert.equal(a.state, 'ESCAPE');
    assert.equal(a.reason, 'lava');
  });

  it('ESCAPEs while drowning', () => {
    const m = new SurvivalMonitor({ actor: 'Steve', workOrigin: WORK });
    const a = m.assess(obs({ in_water: true, remaining_air: 40 }));
    assert.equal(a.state, 'ESCAPE');
    assert.equal(a.reason, 'drowning');
  });

  it('RECOVERs when stranded outside the work area (the 7.3 km respawn bug)', () => {
    const m = new SurvivalMonitor({ actor: 'Steve', workOrigin: WORK, leashRadius: 120 });
    const a = m.assess(obs({ x: 0, z: 0 }));
    assert.equal(a.state, 'RECOVER');
    assert.equal(a.reason, 'out_of_work_area');
    assert.equal(a.action.returnToWork, true);
    assert.ok(a.distanceFromWork > 7000);
  });

  it('RECOVERs and asks for a respawn when dead', () => {
    const m = new SurvivalMonitor({ actor: 'Steve', workOrigin: WORK });
    const a = m.assess(obs({ dead: true, health: 0, last_damage_cause: 'FALL' }));
    assert.equal(a.state, 'RECOVER');
    assert.equal(a.action.respawn, true);
    assert.equal(a.deathCause, 'fall');
  });

  it('counts each death once with a bucketed cause', () => {
    const m = new SurvivalMonitor({ actor: 'Steve', workOrigin: WORK });
    m.assess(obs({ deaths: 0 }));
    m.assess(obs({ dead: true, health: 0, deaths: 1, last_damage_cause: 'LAVA' }));
    m.assess(obs({ dead: true, health: 0, deaths: 1, last_damage_cause: 'LAVA' }));
    m.assess(obs({ deaths: 1 }));
    m.assess(obs({ dead: true, health: 0, deaths: 2, last_damage_cause: 'ENTITY_ATTACK' }));
    assert.equal(m.deaths, 2);
    assert.deepEqual(m.deathCauses, { lava: 1, mob: 1 });
    assert.equal(metricsSnapshot().counters[METRIC.DEATH], 2);
    assert.equal(counterBreakdown(METRIC.DEATH)['actor=Steve,cause=lava'], 1);
  });

  it('holds an escalated state for the calm window before relaxing', () => {
    let now = 1_000_000;
    const m = new SurvivalMonitor({
      actor: 'Steve',
      workOrigin: WORK,
      calmMs: 6000,
      now: () => now,
    });
    m.assess(obs({ hostiles: 1, nearest_hostile: { type: 'ZOMBIE', distance: 3 } }));
    assert.equal(m.state, 'DANGER');

    now += 1000;
    const stillDanger = m.assess(obs());
    assert.equal(stillDanger.state, 'DANGER', 'must not relax inside the calm window');
    assert.equal(stillDanger.rawState, 'SAFE');

    now += 7000;
    const relaxed = m.assess(obs());
    assert.equal(relaxed.state, 'SAFE');
  });

  it('escalates immediately even inside the calm window', () => {
    let now = 0;
    const m = new SurvivalMonitor({ actor: 'Steve', workOrigin: WORK, calmMs: 10_000, now: () => now });
    m.assess(obs({ food: 3 }));
    assert.equal(m.state, 'CAUTION');
    now += 100;
    const a = m.assess(obs({ in_lava: true }));
    assert.equal(a.state, 'ESCAPE');
  });

  it('buckets damage causes for stream-facing telemetry', () => {
    assert.equal(bucketCause('FALL'), 'fall');
    assert.equal(bucketCause('ENTITY_ATTACK'), 'mob');
    assert.equal(bucketCause('BLOCK_EXPLOSION'), 'explosion');
    assert.equal(bucketCause(null), 'unknown');
    assert.equal(bucketCause('SOMETHING_NEW'), 'something_new');
  });
});

describe('executeSurvival', () => {
  function fakeHarness() {
    const calls = [];
    return {
      calls,
      raw: async (cmd) => {
        calls.push(['raw', cmd]);
        return 'ok';
      },
      cap: {
        observe: async () => ({ success: true, data: { x: WORK.x, y: WORK.y, z: WORK.z } }),
        respawn: async () => {
          calls.push(['respawn']);
          return { success: true };
        },
        teleport: async (...a) => {
          calls.push(['teleport', ...a]);
          return { success: true };
        },
        sprint: async (_p, on) => {
          calls.push(['sprint', on]);
          return { success: true };
        },
        giveItem: async (_p, m) => {
          calls.push(['give', m]);
          return { success: true };
        },
        hotbar: async () => ({ success: true }),
        swing: async () => ({ success: true }),
        attackNearest: async () => {
          calls.push(['attack']);
          return { success: true };
        },
        act: async (_p, action) => {
          calls.push(['act', action]);
          if (action === 'walk_path') return { success: true, data: { waypoints: 2 } };
          return { success: true, data: { active: false, done: true, distance_to_goal: 0.5 } };
        },
        step: async () => ({ success: true }),
      },
    };
  }

  it('does nothing for a work recommendation', async () => {
    const h = fakeHarness();
    const out = await executeSurvival(h, 'Steve', { action: { kind: 'work' } }, { workOrigin: WORK });
    assert.equal(out.handled, false);
    assert.equal(h.calls.length, 0);
  });

  it('respawns and returns home on recover', async () => {
    const h = fakeHarness();
    const out = await executeSurvival(
      h,
      'Steve',
      { action: { kind: 'recover', respawn: true, returnToWork: true } },
      { workOrigin: WORK }
    );
    assert.equal(out.handled, true);
    assert.ok(h.calls.some((c) => c[0] === 'respawn'));
    assert.ok(h.calls.some((c) => c[0] === 'teleport'));
  });

  it('attacks on defend', async () => {
    const h = fakeHarness();
    const out = await executeSurvival(h, 'Steve', { action: { kind: 'defend', target: 'ZOMBIE' } }, { workOrigin: WORK });
    assert.equal(out.kind, 'defend');
    assert.ok(h.calls.some((c) => c[0] === 'attack'));
    assert.ok(h.calls.some((c) => c[0] === 'give' && c[1] === 'IRON_SWORD'));
  });

  it('flees without teleporting', async () => {
    const h = fakeHarness();
    await executeSurvival(h, 'Steve', { action: { kind: 'flee', target: WORK } }, { workOrigin: WORK });
    assert.ok(h.calls.some((c) => c[0] === 'sprint' && c[1] === true));
    assert.ok(!h.calls.some((c) => c[0] === 'teleport'), 'flee must not teleport');
  });
});
