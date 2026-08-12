/**
 * Outcome-closure tests (Task A): a decision must receive a real outcome with reward that
 * reflects the objective, not just stay pending. Before the fix, recordFocusOutcome only
 * fired on death/stall, so ~672/674 experiences were pending (ratedSamples ~2/674) and the
 * offline learner saw almost no reward signal.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ExperienceStore } = require('../lib/ai-world/experience-store');
const { recordFocusDecision, recordFocusOutcome } = require('../lib/ai-world/decision');
const { computeReward } = require('../lib/ai-world/state-rep');
const { aggregate } = require('../scripts/aiworld-train');

const SURV = (s) => ({ state: s, healthPct: 1, distanceFromWork: 0 });
const FOCI = (focus) =>
  ['survive', 'found', 'build', 'maintain', 'secure'].map((f) => ({
    id: f,
    base: f === focus ? 1 : 0.5,
    motive: 'focus',
  }));

test('computeReward: progress + goal completion yields positive reward, death negative', () => {
  const good = computeReward({ progressDelta: 0.5, goalCompleted: true, damageTaken: 0 });
  const bad = computeReward({ died: true, damageTaken: 20 });
  assert.ok(good.reward > 0, 'progress+goal should be positive, got ' + good.reward);
  assert.ok(bad.reward < 0, 'death should be negative, got ' + bad.reward);
  // damage without progress is a small penalty
  const dmg = computeReward({ damageTaken: 5 });
  assert.ok(dmg.reward < 0, 'taking damage should penalize');
});

test('a successful work tick closes its decision with a positive outcome (not pending)', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aiw-closure-'));
  const store = new ExperienceStore({ dir: tmp });
  const ep = store.recordDecision({
    agentId: 'Steve',
    observation: { health: 20, max_health: 20 },
    stateRep: { version: 1, fields: ['danger_flag'], vec: [0] },
    candidates: FOCI('build'),
    chosenIntent: 'build',
    survivalState: 'SAFE',
  });
  // Simulate the worker closing the tick after a successful build
  const closed = store.recordOutcome(ep, { progressDelta: 0.6, goalCompleted: true, damageTaken: 0 });
  assert.ok(closed && closed.outcome, 'experience must be closed with an outcome');
  assert.strictEqual(closed.outcome.reward > 0, true, 'successful build -> positive reward');
  // After closing, the episode is removed from `open` (idempotent re-close is a no-op)
  const again = store.recordOutcome(ep, { died: true, damageTaken: 20 });
  assert.strictEqual(again, null, 're-closing a closed episode must be a no-op (null)');
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('recordFocusDecision + recordFocusOutcome through decision.js attach real reward', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aiw-closure2-'));
  const { ExperienceStore } = require('../lib/ai-world/experience-store');
  // Force decision.js to use our temp store via module-level singleton reset is not trivial;
  // instead drive the public API which is what the worker calls.
  const store = new ExperienceStore({ dir: tmp });
  const ep = recordFocusDecision({
    agentId: 'Steve',
    observation: { health: 20, max_health: 20 },
    focus: 'build',
    candidates: FOCI('build'),
    survivalState: 'SAFE',
    distWork: 0,
  });
  assert.ok(ep, 'recordFocusDecision returns an episodeId');
  const closed = recordFocusOutcome('Steve', ep, { progressDelta: 0.4, goalCompleted: false, damageTaken: 0 });
  assert.ok(closed && closed.outcome && closed.outcome.reward > 0, 'build with progress -> positive reward');
  // A death closes as negative (Task A3: current-tick decision, not a stale one)
  const ep2 = recordFocusDecision({
    agentId: 'Steve',
    observation: { health: 0, max_health: 20 },
    focus: 'survive',
    candidates: FOCI('survive'),
    survivalState: 'RECOVER',
    distWork: 0,
  });
  const dead = recordFocusOutcome('Steve', ep2, { died: true, goalFailed: true, damageTaken: 20 });
  assert.ok(dead && dead.outcome.reward < 0, 'death -> negative reward, attributed to current decision');
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('aggregate reports rated samples with reward distribution per intent (Task A4)', () => {
  const rows = [
    { schema: 'aiworld.experience', survivalState: 'SAFE', chosenIntent: 'build',
      outcome: { reward: 1.2, goalCompleted: true, progressDelta: 0.6 } },
    { schema: 'aiworld.experience', survivalState: 'SAFE', chosenIntent: 'build',
      outcome: { reward: 0.8, goalCompleted: false, progressDelta: 0.4 } },
    { schema: 'aiworld.experience', survivalState: 'SAFE', chosenIntent: 'survive',
      outcome: { reward: -2, died: true, damageTaken: 20 } },
    { schema: 'aiworld.experience', survivalState: 'DANGER', chosenIntent: 'survive',
      outcome: { reward: -1, damageTaken: 5 } },
    // a pending decision (no outcome) — must NOT inflate ratedSamples
    { schema: 'aiworld.experience', survivalState: 'SAFE', chosenIntent: 'maintain' },
  ];
  const { bias, stats } = aggregate(rows, 2);
  assert.strictEqual(stats.ratedSamples, 4, '4 rated, 1 pending excluded');
  assert.ok(stats.ratedByIntent.build >= 2, 'build closure counted');
  assert.ok(stats.rewardByIntent.build > 0, 'build reward distribution positive');
  assert.ok(stats.rewardByIntent.survive < 0, 'survive reward distribution negative (deaths)');
});
