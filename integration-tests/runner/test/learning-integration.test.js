const test = require('node:test');
const assert = require('node:assert');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { recordFocusDecision, recordFocusOutcome } = require('../lib/ai-world/decision');

/**
 * Phase 3 (Learning) integration: the worker loop calls recordFocusDecision() at decision time
 * and recordFocusOutcome() when the decision resolves (died / recovered / goal / stalled). Those
 * two calls must produce a COMPLETE experience in the shared ExperienceStore: a decision snapshot
 * plus a later-attached outcome with a finite reward. This is the offline dataset the brief asks
 * for (JSONL, consumable by any tool) — no RL, just experience collection + shadow metrics.
 */
test('recordFocusDecision + recordFocusOutcome -> complete experience with reward', () => {
  // Use an isolated temp dir so we don't touch the live reports/aiworld-experiences dataset.
  const dir = path.join(
    os.tmpdir(),
    `aiw-learn-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
  );
  // Monkeypatch the store dir by recreating via the module's internal singleton is not exposed,
  // so we assert on the live store's file after a real call instead.
  const agentId = 'LearnBot';
  const episodeId = recordFocusDecision({
    agentId,
    observation: { health: 20, food: 18, hostiles: 0, x: 5203, y: 71, z: 5193 },
    focus: 'farmer',
    candidates: [
      { id: 'farmer', base: 0.85, motive: 'gathering' },
      { id: 'builder', base: 0.4, motive: 'construction' },
    ],
    survivalState: 'SAFE',
    distWork: 2,
    personality: { archetype: 'farmer', occupation: 'farmer' },
  });
  assert.ok(episodeId, 'expected an episodeId from recordFocusDecision');

  const outcome = recordFocusOutcome(agentId, episodeId, {
    goalCompleted: true,
    progressDelta: 0.25,
    damageTaken: 0,
  });
  assert.ok(outcome, 'expected recordFocusOutcome to return the completed experience');
  assert.ok(outcome.outcome && Number.isFinite(outcome.outcome.reward), 'expected a finite reward');
  assert.ok(outcome.outcome.reward > 0, 'goal completion should yield positive reward');

  // The shared store persists line-delimited JSON; the final line for this episode has the outcome.
  const file = path.join(
    __dirname,
    '..',
    'reports',
    'aiworld-experiences',
    `experiences-${agentId}.jsonl`
  );
  assert.ok(fs.existsSync(file), `expected dataset file ${file}`);
  const lines = fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean);
  const mine = lines.filter((l) => {
    try {
      return JSON.parse(l).episodeId === episodeId;
    } catch {
      return false;
    }
  });
  assert.ok(mine.length >= 2, 'expected a decision snapshot + an outcome-appended line');
  const final = JSON.parse(mine[mine.length - 1]);
  assert.ok(
    final.outcome && final.outcome.reward === outcome.outcome.reward,
    'final line carries the reward'
  );
});

test('recordFocusOutcome with no episodeId is a safe no-op', () => {
  const res = recordFocusOutcome('Someone', null, { died: true });
  assert.strictEqual(res, null);
});
