/**
 * Tests for the OFFLINE TRAINING STEP (scripts/aiworld-train.js) and the weight
 * loading path in NeuralPolicy. Verifies the learning loop closes:
 *   dataset (JSONL) -> aggregate -> weights artifact -> NeuralPolicy applies bias.
 * These are pure/offline checks — no Minecraft server required.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const test = require('node:test');
const { NeuralPolicy, linearScore, VEC_LEN } = require('../lib/ai-world/neural-policy');
const { aggregate } = require('../scripts/aiworld-train');

const VEC = new Array(VEC_LEN).fill(0);

function makeExp(intent, reward, ctx) {
  return {
    schema: 'aiworld.experience',
    version: 1,
    episodeId: 'ep_' + Math.random().toString(36).slice(2),
    agentId: 'Test',
    at: Date.now(),
    stateRep: {
      version: 1,
      fields: ['survival_state'],
      vec: [ctx === 'DANGER' ? 2 : 0],
      len: 1,
    },
    chosenIntent: intent,
    action: { intent },
    survivalState: ctx,
    outcome: { reward, died: reward < -1, goalCompleted: reward > 0 },
  };
}

test('linearScore: identity when no weights', () => {
  const cands = [{ id: 'a', base: 0.3 }, { id: 'b', base: 0.9 }];
  const out = linearScore([1, 0], cands, null, 'SAFE');
  assert.strictEqual(out.a, 0.3);
  assert.strictEqual(out.b, 0.9);
});

test('linearScore: applies per-context bias', () => {
  const weights = { version: 1, bias: { SAFE: { a: 0.5, b: -0.5 } }, default: 0 };
  const cands = [{ id: 'a', base: 0.3 }, { id: 'b', base: 0.3 }];
  const out = linearScore([1, 0], cands, weights, 'SAFE');
  assert.strictEqual(out.a, 0.8);
  assert.strictEqual(out.b, -0.2);
});

test('NeuralPolicy.loadWeights reads artifact and applies bias', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-w-'));
  const w = { version: 1, bias: { SAFE: { mine: 0.7, flee: -0.7 } }, default: 0 };
  fs.writeFileSync(path.join(dir, 'weights-Test.json'), JSON.stringify(w));
  const p = new NeuralPolicy({ mode: 'neural', weightsDir: dir, weightsPath: path.join(dir, 'weights-Test.json') });
  assert.ok(p.weights !== null, 'weights should be loaded');
  const cands = [{ id: 'mine', base: 0.5 }, { id: 'flee', base: 0.5 }];
  const res = p.scoreIntents(VEC, cands, 'SAFE');
  assert.strictEqual(res.usedModel, 'neural');
  assert.ok(Math.abs(res.scores.mine - 1.2) < 1e-9, 'mine=' + res.scores.mine);
  assert.ok(Math.abs(res.scores.flee - -0.2) < 1e-9, 'flee=' + res.scores.flee);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('NeuralPolicy falls back to baseline mirror on empty weights dir', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-w-'));
  const p = new NeuralPolicy({ mode: 'neural', weightsDir: dir });
  assert.strictEqual(p.weights, null);
  const cands = [{ id: 'x', base: 0.4 }];
  const res = p.scoreIntents(VEC, cands, 'SAFE');
  assert.strictEqual(res.usedModel, 'baseline_mirror');
  assert.strictEqual(res.scores.x, 0.4);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('offline training step: dataset -> weights artifact (hermetic)', () => {
  const rows = [];
  for (let i = 0; i < 10; i++) {
    rows.push(makeExp('mine', 0.8, 'SAFE'));
    rows.push(makeExp('flee', -0.8, 'SAFE'));
  }
  const { bias, stats } = aggregate(rows, 3);
  assert.ok(bias.SAFE, 'should have SAFE context bias');
  assert.ok(bias.SAFE.mine > 0, 'mine should be positively biased (got ' + bias.SAFE.mine + ')');
  assert.ok(bias.SAFE.flee < 0, 'flee should be negatively biased (got ' + bias.SAFE.flee + ')');
  assert.strictEqual(stats.contexts, 1);
  assert.strictEqual(stats.intents, 2);
});
