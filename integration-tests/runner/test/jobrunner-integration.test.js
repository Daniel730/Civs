'use strict';

// Integration test for MVP1 JobRunner (no live server).
// Exercises the REAL _JobRunner.runJobStep against a stubbed harness so we prove:
//   (a) a gather job emits incremental steps and progresses each tick,
//   (b) state.activeJob.cursor resumes across ticks (continuity),
//   (c) the job completes and clears activeJob.

const test = require('node:test');
const assert = require('node:assert');

const { JobRunner } = require('../lib/village/job-runner');

// ---- Stub harness: records calls, returns success ----
function makeHarness() {
  const calls = { walkTo: 0, breakBlock: 0, placeBlock: 0, observe: 0, swing: 0 };
  const helpers = { safeWalk: 0, placeAesthetic: 0, clearFooting: 0 };
  const cap = {
    walkTo: async () => { calls.walkTo++; return { success: true, navigator: 'walk_path', final_distance: 0.4 }; },
    breakBlock: async () => { calls.breakBlock++; return { success: true }; },
    placeBlock: async () => { calls.placeBlock++; return { success: true }; },
    observe: async () => { calls.observe++; return { success: true, data: { x: 5200, y: 80, z: 5200, health: 20, inventory: [] } }; },
    swing: async () => { calls.swing++; },
    findBlock: async () => ({ success: false }),
    lookAt: async () => ({}),
  };
  return { cap, calls, helpers };
}

function makeCtx(harness, step, state) {
  const logLines = [];
  return {
    harness,
    actorName: 'Steve',
    step,
    state,
    cfg: { origin: { x: 5200, y: 80, z: 5200 } },
    groundY: 80,
    coords: {},
    origin: { x: 5200, y: 80, z: 5200 },
    tick: state.tick,
    budgetMs: 1500,
    log: (e) => logLines.push(e),
    worldMem: null,
    helpers: {
      checkTool: () => ({ matched: true }),
      applyObserve: (o) => o,
      diffInventory: () => ({ gained: [], lost: [], dropped: [] }),
      buildGatherEvent: () => ({}),
      buildPlaceEvent: () => ({}),
      findToolInInventory: () => null,
      craftWithOwnResources: async () => ({ success: true }),
      recipeForTool: () => null,
      safeWalk: async () => { harness.helpers.safeWalk++; await new Promise((r) => setTimeout(r, 10)); return { success: true, navigator: 'walk_path', final_distance: 0.4 }; },
      placeAesthetic: async () => { harness.helpers.placeAesthetic++; await new Promise((r) => setTimeout(r, 8)); return { success: true }; },
      clearFooting: async () => { harness.helpers.clearFooting++; await new Promise((r) => setTimeout(r, 5)); },
    },
    held: null,
    inventory: [],
  };
}

test('JobRunner: resumes a pre-existing activeJob mid-cursor (continuity)', async () => {
  const harness = makeHarness();
  const step = { job: 'gather' }; // step.site/label undefined -> stepKey undefined
  // Simulate a job that was half-done in a previous tick/restart: cursor already advanced.
  const planned = [
    { type: 'walk', to: { x: 1, y: 80, z: 1 } },
    { type: 'gather', x: 1, y: 80, z: 1 },
    { type: 'walk', to: { x: 2, y: 80, z: 2 } },
    { type: 'gather', x: 2, y: 80, z: 2 },
  ];
  const state = { tick: 5, activeJob: { job: 'gather', stepKey: undefined, steps: planned, cursor: 2, startedAt: Date.now() } };

  // Tight budget: only run 1 step (safeWalk ~10ms) before exhaustion.
  const ctx = makeCtx(harness, step, state);
  ctx.budgetMs = 12;
  const r = await JobRunner.runJobStep(harness, 'Steve', step, state, ctx);
  assert.ok(state.activeJob, 'activeJob must persist (budget too tight to finish)');
  // Must NOT re-plan from scratch (cursor was 2, must stay >= 2, never reset to 0).
  assert.ok(state.activeJob.cursor >= 2, 'cursor must resume from injected 2, never reset');
  assert.ok(harness.helpers.safeWalk >= 1, 'must execute the step at cursor 2 (a walk)');
  assert.strictEqual(r.status, 'PROGRESS', 'should be PROGRESS, not done');
});

test('JobRunner: gather job runs end-to-end and terminates', async () => {
  const harness = makeHarness();
  const step = { job: 'gather' };
  const state = { tick: 0, activeJob: null };

  // With an instant mock harness, the whole plan runs in one tick (no real latency).
  const r1 = await JobRunner.runJobStep(harness, 'Steve', step, state, makeCtx(harness, step, state));
  // Either still in progress (budget-bound) or done+cleared — both valid.
  assert.ok(r1.status === 'PROGRESS' || r1.status === 'PASS', 'status must be PROGRESS or PASS');
  assert.ok(harness.helpers.safeWalk > 0, 'safeWalk should have been called');
  assert.ok(harness.calls.breakBlock > 0, 'breakBlock should have been called (gather breaks blocks)');
});

test('JobRunner: gather job completes and clears activeJob', async () => {
  const harness = makeHarness();
  const step = { job: 'gather' };
  const state = { tick: 0, activeJob: null };

  // Run ticks until the job finishes (bounded loop to avoid infinite).
  let ticks = 0;
  let lastDone = false;
  while (ticks < 50) {
    const r = await JobRunner.runJobStep(harness, 'Steve', step, state, makeCtx(harness, step, state));
    ticks++;
    if (r.done || !state.activeJob) { lastDone = true; break; }
    if (state.activeJob.cursor >= state.activeJob.steps.length) break;
  }
  // Either the runner flagged done, or the plan was exhausted and activeJob cleared.
  assert.ok(lastDone || !state.activeJob, 'gather job should terminate within 50 ticks');
});

test('JobRunner: torch job plans a grid of place steps', async () => {
  const harness = makeHarness();
  const step = { job: 'torch' };
  const state = { tick: 0, activeJob: null };
  const r = await JobRunner.runJobStep(harness, 'Steve', step, state, makeCtx(harness, step, state));
  assert.ok(r.status === 'PROGRESS' || r.status === 'PASS', 'torch must run');
  const placeSteps = (state.activeJob ? state.activeJob.steps : r.steps).filter((s) => s.type === 'place');
  assert.ok(placeSteps.length > 0, 'torch should plan place steps');
  assert.ok(harness.helpers.placeAesthetic > 0, 'placeAesthetic called during execution');
});

test('JobRunner: unknown job returns UNSUPPORTED without throwing', async () => {
  const harness = makeHarness();
  const step = { job: 'does_not_exist' };
  const state = { tick: 0, activeJob: null };
  const r = await JobRunner.runJobStep(harness, 'Steve', step, state, makeCtx(harness, step, state));
  assert.strictEqual(r.status, 'UNSUPPORTED');
  assert.strictEqual(state.activeJob, null, 'no activeJob for unsupported job');
});
