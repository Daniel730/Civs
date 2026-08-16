/**
 * Tests for the neural-mode FOCUS RE-RANKING that the village-worker applies at runtime:
 * the trained NeuralPolicy may override the deterministic chooseFocus (never survival,
 * always falls back on fault). These are pure/offline checks — no Minecraft server.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const test = require('node:test');
const { NeuralPolicy } = require('@daniel730/aiworld/neural-policy');

const VEC = new Array(17).fill(0);
const FOCUSES = ['survive', 'found', 'build', 'maintain', 'secure'];

// Build a weights artifact that strongly prefers 'build' in SAFE, and 'survive' in danger.
function writeTestWeights(dir) {
  const w = {
    version: 1,
    bias: {
      SAFE: { build: 1, maintain: -1, found: -0.5, secure: -0.5, survive: -1 },
      CAUTION: { build: 0.5, maintain: -0.5 },
      DANGER: { survive: 1 },
      RECOVER: { survive: 1 },
      ESCAPE: { survive: 1 },
    },
    default: 0,
    stats: { contexts: 5, intents: 8, usableSamples: 100, ratedSamples: 50 },
  };
  fs.writeFileSync(path.join(dir, 'weights-Test.json'), JSON.stringify(w));
  return w;
}

test('neural re-ranking overrides deterministic focus when safe + disagrees', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-rerank-'));
  writeTestWeights(dir);
  const p = new NeuralPolicy({ mode: 'neural', weightsDir: dir, weightsPath: path.join(dir, 'weights-Test.json') });
  // Deterministic chooseFocus would return 'maintain' (base=1). Neural should pick 'build' (bias +1).
  const candidates = FOCUSES.map((f) => ({ id: f, base: f === 'maintain' ? 1 : 0.5 }));
  const pick = p.choose(VEC, candidates, 'SAFE');
  assert.strictEqual(pick.id, 'build', 'neural should override to build in SAFE');
  assert.strictEqual(pick.usedModel, 'neural');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('neural re-ranking never overrides survival in DANGER (safety gate)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-rerank-'));
  writeTestWeights(dir);
  const p = new NeuralPolicy({ mode: 'neural', weightsDir: dir, weightsPath: path.join(dir, 'weights-Test.json') });
  // Even if neural picks 'survive' in DANGER, the worker safety gate allows it; here the
  // policy itself returns 'survive' (bias +1) which matches the survival monitor -> safe.
  const candidates = FOCUSES.map((f) => ({ id: f, base: f === 'build' ? 1 : 0.5 }));
  const pick = p.choose(VEC, candidates, 'DANGER');
  assert.strictEqual(pick.id, 'survive', 'neural must agree with survival in DANGER');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('neural re-ranking falls back to deterministic on missing weights (no crash)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-rerank-'));
  const p = new NeuralPolicy({ mode: 'neural', weightsDir: dir });
  const candidates = FOCUSES.map((f) => ({ id: f, base: f === 'maintain' ? 1 : 0.5 }));
  const pick = p.choose(VEC, candidates, 'SAFE');
  // No weights -> mirror: picks the highest base (maintain), usedModel baseline_mirror.
  assert.strictEqual(pick.id, 'maintain');
  assert.strictEqual(pick.usedModel, 'baseline_mirror');
  fs.rmSync(dir, { recursive: true, force: true });
});
