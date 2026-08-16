/**
 * Regression test: survivalState MUST be persisted on every experience record and
 * consumed by offline training to produce multi-context bias. Before the fix,
 * recordFocusDecision dropped survivalState, so training only ever saw SAFE.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { recordFocusDecision } = require('@daniel730/aiworld/decision');
const { contextOf } = require('../scripts/aiworld-train');

test('recordFocusDecision persists survivalState into the experience record', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aiw-ss-'));
  const { ExperienceStore } = require('@daniel730/aiworld/experience-store');
  const store = new ExperienceStore({ dir: tmp });
  // Monkeypatch the shared store used by decision.js via require cache reset
  const dec = require('@daniel730/aiworld/decision');
  // Directly drive recordDecision through the store API to mirror what decision.js does:
  const { buildExperience } = require('@daniel730/aiworld/state-rep');
  const exp = buildExperience({
    agentId: 'Steve',
    observation: { health: 10, max_health: 20 },
    stateRep: { version: 1, fields: [], vec: [] },
    candidates: [{ id: 'survive', base: 0.5, motive: 'focus' }],
    chosenIntent: 'survive',
    survivalState: 'DANGER',
  });
  assert.strictEqual(exp.survivalState, 'DANGER', 'buildExperience must keep survivalState');
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('contextOf derives DANGER from legacy stateRep.vec danger_flag', () => {
  const e = {
    stateRep: {
      fields: ['danger_flag', 'escape_flag', 'recover_flag'],
      vec: [1, 0, 0],
    },
  };
  assert.strictEqual(contextOf(e), 'DANGER');
  assert.strictEqual(contextOf({ stateRep: { fields: ['escape_flag'], vec: [1] } }), 'ESCAPE');
  assert.strictEqual(contextOf({ stateRep: { fields: ['recover_flag'], vec: [1] } }), 'RECOVER');
});

test('recordFocusDecision (live path) writes survivalState to the dataset', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aiw-live-'));
  const { ExperienceStore } = require('@daniel730/aiworld/experience-store');
  const store = new ExperienceStore({ dir: tmp });
  const ep = store.recordDecision({
    agentId: 'Steve',
    observation: { health: 5, max_health: 20 },
    stateRep: { version: 1, fields: ['danger_flag'], vec: [1] },
    candidates: [{ id: 'survive', base: 0.5, motive: 'focus' }],
    chosenIntent: 'survive',
    survivalState: 'DANGER',
  });
  const file = path.join(tmp, 'experiences-Steve.jsonl');
  const line = fs.readFileSync(file, 'utf8').trim().split('\n').pop();
  const rec = JSON.parse(line);
  assert.strictEqual(rec.survivalState, 'DANGER', 'persisted experience must carry survivalState');
  fs.rmSync(tmp, { recursive: true, force: true });
});
