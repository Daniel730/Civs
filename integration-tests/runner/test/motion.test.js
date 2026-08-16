const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { walkTo, runPathLeg, resetPathCapability } = require('../lib/village/walk');
const { IntentionCache, AntiStall, STALL_LADDER } = require('@daniel730/aiworld/intention-cache');
const { METRIC, initMetrics, resetMetrics, metricsSnapshot } = require('../lib/metrics');

/**
 * Fake harness that simulates the server-side `walk_path` mover: the actor closes on the goal
 * over a number of status polls, or fails with a configured reason.
 */
function fakeHarness(opts = {}) {
  const state = {
    pos: { x: 0, y: 80, z: 0 },
    acts: [],
    teleports: [],
    steps: 0,
  };
  const behaviour = opts.behaviour || 'arrive';
  let goal = null;
  let polls = 0;

  const harness = {
    state,
    raw: async () => 'ok',
    cap: {
      observe: async () => ({ success: true, data: { ...state.pos } }),
      teleport: async (_p, x, y, z) => {
        state.teleports.push({ x, y, z });
        state.pos = { x, y, z };
        return { success: true };
      },
      step: async (_p, x, _y, z) => {
        state.steps += 1;
        if (opts.legacyStuck) return { success: false, reason: 'blocked' };
        const dx = x - state.pos.x;
        const dz = z - state.pos.z;
        const len = Math.sqrt(dx * dx + dz * dz) || 1;
        state.pos = {
          x: state.pos.x + (dx / len) * 0.45,
          y: state.pos.y,
          z: state.pos.z + (dz / len) * 0.45,
        };
        return { success: true };
      },
      sprint: async () => ({ success: true }),
      act: async (_player, action, ...args) => {
        state.acts.push({ action, args });
        if (action === 'walk_path') {
          if (behaviour === 'unsupported') return { success: false, reason: 'unknown_action', data: {} };
          if (behaviour === 'no_path') {
            return { success: false, reason: 'no_path', data: { nodes_explored: 900 } };
          }
          goal = { x: args[0], y: args[1], z: args[2] };
          polls = 0;
          return { success: true, reason: null, data: { waypoints: 3, path_length: 20, eta_ms: 4000 } };
        }
        if (action === 'walk_status') {
          polls += 1;
          if (behaviour === 'blocked') {
            return {
              success: false,
              reason: 'blocked',
              data: { active: false, done: true, distance_to_goal: 9, stuck_ms: 2000, collisions: 4 },
            };
          }
          const total = opts.pollsToArrive || 2;
          if (polls >= total) {
            state.pos = { x: goal.x, y: goal.y, z: goal.z };
            return {
              success: true,
              reason: null,
              data: { active: false, done: true, distance_to_goal: 0.4, travelled: 20, collisions: 0, stuck_ms: 0 },
            };
          }
          return {
            success: true,
            reason: null,
            data: { active: true, done: false, distance_to_goal: 10, travelled: 10, collisions: 0, stuck_ms: 0 },
          };
        }
        return { success: true, data: {} };
      },
    },
  };
  return harness;
}

describe('walkTo with the server-side path mover', () => {
  beforeEach(() => {
    initMetrics({ serviceName: 'test' });
    resetMetrics();
    resetPathCapability();
  });

  it('walks to the goal with one walk_path call and no teleport', async () => {
    const h = fakeHarness();
    const r = await walkTo(h, 'Steve', { x: 10, y: 80, z: 10 }, { pollMs: 1, timeoutMs: 3000 });
    assert.equal(r.success, true);
    assert.equal(r.navigator, 'walk_path');
    assert.equal(r.recoverTeleport, false);
    assert.equal(h.state.teleports.length, 0, 'a successful walk must not teleport');
    assert.equal(h.state.acts.filter((a) => a.action === 'walk_path').length, 1);
    assert.ok(metricsSnapshot().histograms[METRIC.MOVEMENT_COMMAND_LATENCY].count >= 1);
  });

  it('reports arrival without walking when already at the goal', async () => {
    const h = fakeHarness();
    const r = await walkTo(h, 'Steve', { x: 0, y: 80, z: 0 }, { pollMs: 1 });
    assert.equal(r.navigator, 'already_there');
    assert.equal(h.state.acts.length, 0);
  });

  it('replans to a nearby offset when the goal cell has no path', async () => {
    const h = fakeHarness({ behaviour: 'no_path' });
    const r = await walkTo(h, 'Steve', { x: 10, y: 80, z: 10 }, { pollMs: 1, timeoutMs: 500 });
    const retries = h.state.acts.filter((a) => a.action === 'walk_path').length;
    assert.ok(retries > 1, 'expected offset retries');
    assert.ok(metricsSnapshot().counters[METRIC.REPLAN] >= 1);
    assert.ok(metricsSnapshot().counters[METRIC.PATH_FAILURE] >= 1);
    assert.ok(r.replans >= 1);
  });

  it('records collisions and stuck time reported by the mover', async () => {
    const h = fakeHarness({ behaviour: 'blocked' });
    await walkTo(h, 'Steve', { x: 10, y: 80, z: 10 }, { pollMs: 1, timeoutMs: 300, allowTeleport: false });
    const snap = metricsSnapshot();
    assert.ok(snap.counters[METRIC.COLLISION] >= 4);
    assert.ok(snap.histograms[METRIC.STUCK_DURATION].count >= 1);
  });

  it('falls back to the legacy stepping loop on an old harness', async () => {
    const h = fakeHarness({ behaviour: 'unsupported' });
    const r = await walkTo(h, 'Steve', { x: 6, y: 80, z: 0 }, { pollMs: 1, timeoutMs: 5000, pauseMs: 1 });
    assert.equal(r.success, true);
    assert.ok(r.navigator.startsWith('walk_step'));
    assert.ok(h.state.steps > 0);
  });

  it('teleports only after the whole ladder fails, and says so', async () => {
    const h = fakeHarness({ behaviour: 'blocked', legacyStuck: true });
    const r = await walkTo(h, 'Steve', { x: 10, y: 80, z: 10 }, { pollMs: 1, timeoutMs: 200, pauseMs: 1 });
    assert.equal(r.navigator, 'recovery_teleport');
    assert.equal(r.recoverTeleport, true);
    assert.equal(h.state.teleports.length, 1);
    assert.ok(metricsSnapshot().counters[METRIC.GOAL_ABANDON] >= 1);
  });

  it('honours allowTeleport:false for survival movement', async () => {
    const h = fakeHarness({ behaviour: 'blocked', legacyStuck: true });
    const r = await walkTo(h, 'Steve', { x: 10, y: 80, z: 10 }, {
      pollMs: 1,
      timeoutMs: 200,
      pauseMs: 1,
      allowTeleport: false,
    });
    assert.equal(r.success, false);
    assert.equal(h.state.teleports.length, 0);
  });

  it('closes an out-of-range gap first, then walks the last stretch', async () => {
    const h = fakeHarness();
    const r = await walkTo(h, 'Steve', { x: 500, y: 80, z: 500 }, { pollMs: 1, timeoutMs: 2000 });
    assert.equal(r.recoverTeleport, true);
    assert.equal(h.state.acts.filter((a) => a.action === 'walk_path').length >= 1, true);
    assert.ok(metricsSnapshot().counters[METRIC.GOAL_ABANDON] >= 1);
    assert.equal(r.success, true);
  });

  it('runPathLeg surfaces an unsupported capability instead of throwing', async () => {
    const h = fakeHarness({ behaviour: 'unsupported' });
    const leg = await runPathLeg(h, 'Steve', { x: 1, y: 80, z: 1 }, { pollMs: 1 });
    assert.equal(leg.status, 'UNSUPPORTED');
  });
});

describe('IntentionCache', () => {
  it('serves a cached intention inside the TTL', () => {
    let now = 0;
    const c = new IntentionCache({ now: () => now });
    c.set('Steve', { intent: 'build' }, { ttlMs: 30000, contextKey: 'ctx1' });
    now += 10000;
    const hit = c.get('Steve', 'ctx1');
    assert.equal(hit.hit, true);
    assert.equal(hit.intention.intent, 'build');
  });

  it('misses once the TTL expires', () => {
    let now = 0;
    const c = new IntentionCache({ now: () => now });
    c.set('Steve', { intent: 'build' }, { ttlMs: 20000 });
    now += 20001;
    assert.equal(c.get('Steve').hit, false);
    assert.equal(c.get('Steve').reason, 'expired');
  });

  it('clamps TTL into the 20-60 s decision cadence', () => {
    const c = new IntentionCache();
    assert.equal(c.set('a', {}, { ttlMs: 1000 }).ttlMs, 20000);
    assert.equal(c.set('b', {}, { ttlMs: 999999 }).ttlMs, 60000);
  });

  it('misses when the decision context changed', () => {
    const c = new IntentionCache();
    c.set('Steve', { intent: 'build' }, { contextKey: 'safe:builder' });
    const miss = c.get('Steve', 'danger:builder');
    assert.equal(miss.hit, false);
    assert.equal(miss.reason, 'context_changed');
  });

  it('invalidates on the standard signals', () => {
    const c = new IntentionCache();
    c.set('Steve', { intent: 'build' });
    const reasons = c.applySignals('Steve', { survivalEscalated: true });
    assert.deepEqual(reasons, ['survival_escalated']);
    assert.equal(c.get('Steve').hit, false);
    assert.equal(c.snapshot().invalidations.survival_escalated, 1);
  });

  it('reports a hit rate', () => {
    const c = new IntentionCache();
    c.set('Steve', {});
    c.get('Steve');
    c.get('Alex');
    assert.equal(c.snapshot().hitRate, 50);
  });
});

describe('AntiStall ladder', () => {
  beforeEach(() => {
    initMetrics({ serviceName: 'test' });
    resetMetrics();
  });

  it('stays on CONTINUE while distance to the goal keeps falling', () => {
    let now = 0;
    const s = new AntiStall({ noProgressMs: 10000, now: () => now });
    s.beginGoal('Steve', 'goal-1', 20);
    for (const d of [18, 15, 11, 6, 2]) {
      now += 4000;
      const r = s.report('Steve', { goalKey: 'goal-1', progressValue: d });
      assert.equal(r.stage, 'CONTINUE');
    }
  });

  it('escalates local recovery, replan, LLM and finally abandon', () => {
    let now = 0;
    const s = new AntiStall({ noProgressMs: 10000, goalBudgetMs: 999999, now: () => now });
    s.beginGoal('Steve', 'goal-1', 20);
    const seen = [];
    for (let i = 0; i < 4; i++) {
      now += 10000;
      seen.push(s.report('Steve', { goalKey: 'goal-1', progressValue: 20 }).stage);
    }
    assert.deepEqual(seen, ['LOCAL_RECOVERY', 'REPLAN', 'CONSULT_LLM', 'ABANDON_GOAL']);
    const snap = metricsSnapshot();
    assert.equal(snap.counters[METRIC.REPLAN], 1);
    assert.equal(snap.counters[METRIC.GOAL_ABANDON], 1);
    assert.ok(snap.histograms[METRIC.NO_PROGRESS].count >= 4);
  });

  it('only consults the LLM at the CONSULT_LLM stage', () => {
    let now = 0;
    const s = new AntiStall({ noProgressMs: 5000, now: () => now });
    s.beginGoal('Steve', 'g', 10);
    now += 5000;
    s.report('Steve', { progressValue: 10 });
    assert.equal(s.needsLlm('Steve'), false);
    now += 10000;
    s.report('Steve', { progressValue: 10 });
    assert.equal(s.needsLlm('Steve'), true);
  });

  it('resets the ladder as soon as real progress resumes', () => {
    let now = 0;
    const s = new AntiStall({ noProgressMs: 5000, now: () => now });
    s.beginGoal('Steve', 'g', 20);
    now += 11000;
    assert.equal(s.report('Steve', { progressValue: 20 }).stage, 'REPLAN');
    now += 1000;
    assert.equal(s.report('Steve', { progressValue: 12 }).stage, 'CONTINUE');
  });

  it('jumps straight to abandon when the goal budget is exhausted', () => {
    let now = 0;
    const s = new AntiStall({ noProgressMs: 60000, goalBudgetMs: 30000, now: () => now });
    s.beginGoal('Steve', 'g', 20);
    now += 31000;
    const r = s.report('Steve', { progressValue: 19.9 });
    assert.equal(r.stage, 'ABANDON_GOAL');
    assert.equal(r.reason, 'goal_budget_exhausted');
  });

  it('a new goal restarts the ladder', () => {
    let now = 0;
    const s = new AntiStall({ noProgressMs: 5000, now: () => now });
    s.beginGoal('Steve', 'g1', 20);
    now += 20000;
    s.report('Steve', { goalKey: 'g1', progressValue: 20 });
    const r = s.report('Steve', { goalKey: 'g2', progressValue: 40 });
    assert.equal(r.stage, 'CONTINUE');
    assert.equal(r.reason, 'new_goal');
    assert.deepEqual(STALL_LADDER[0], 'CONTINUE');
  });
});
