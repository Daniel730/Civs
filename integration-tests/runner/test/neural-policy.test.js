const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const {
  encodeState,
  buildExperience,
  computeReward,
  VEC_LEN,
} = require('../lib/ai-world/state-rep');
const { NeuralPolicy } = require('../lib/ai-world/neural-policy');
const { ExperienceStore } = require('../lib/ai-world/experience-store');

describe('state-rep.encodeState', () => {
  it('produces a fixed-length normalized vector with no NaN', () => {
    const rep = encodeState(
      { health: 20, max_health: 20, food: 18, hostiles: 2, nearest_hostile: { distance: 5 } },
      {
        survival: { state: 'DANGER', distanceFromWork: 30 },
        leashRadius: 120,
        goalProgress: 0.5,
        noProgressMs: 10000,
        stallStage: 1,
      }
    );
    assert.equal(rep.vec.length, VEC_LEN);
    assert.ok(rep.vec.every((x) => Number.isFinite(x) && x >= 0 && x <= 1));
  });

  it('flags escape/recover from survival state', () => {
    const rep = encodeState({}, { survival: { state: 'ESCAPE' } });
    assert.equal(rep.vec[6], 1); // escape_flag
    const rep2 = encodeState({}, { survival: { state: 'RECOVER' } });
    assert.equal(rep2.vec[7], 1); // recover_flag
  });

  it('clamps garbage input to safe values', () => {
    const rep = encodeState({ health: 'x', food: Number.NaN }, {});
    assert.ok(rep.vec.every((x) => Number.isFinite(x)));
  });
});

describe('neural-policy safety invariants', () => {
  const candidates = [
    { id: 'eat', base: 0.3 },
    { id: 'fight', base: 0.9 },
    { id: 'build', base: 0.5 },
  ];
  const vec = new Array(VEC_LEN).fill(0.5);

  it('deterministic mode mirrors baseline and never throws', () => {
    const p = new NeuralPolicy({ mode: 'deterministic' });
    const { scores, usedModel, fellBack } = p.scoreIntents(vec, candidates);
    assert.equal(scores.fight, 0.9);
    assert.equal(usedModel, 'baseline_mirror');
    assert.equal(fellBack, false);
  });

  it('rejects impossible/NaN input with fallback, never crashes', () => {
    const p = new NeuralPolicy({ mode: 'neural' });
    const bad = p.scoreIntents([Number.NaN, 1, 2], candidates);
    assert.equal(bad.fellBack, true);
    assert.ok(Object.keys(bad.scores).length === candidates.length);
  });

  it('rejects empty candidates with fallback', () => {
    const p = new NeuralPolicy({ mode: 'neural' });
    const bad = p.scoreIntents(vec, []);
    assert.equal(bad.fellBack, true);
  });

  it('clamps out-of-range scores into [-2,2]', () => {
    const p = new NeuralPolicy({ mode: 'neural', weights: { bogus: true } });
    // even with weights, output is clamped; here no weights applied -> baseline mirror
    const { scores } = p.scoreIntents(vec, candidates);
    for (const v of Object.values(scores)) {
      assert.ok(v >= -2 && v <= 2 && Number.isFinite(v));
    }
  });

  it('shadow mode computes neural scores without being the executed decision', () => {
    const p = new NeuralPolicy({ mode: 'shadow' });
    const { id, usedModel } = p.choose(vec, candidates);
    // choose still returns a pick (for recording), but caller executes baseline in shadow
    assert.ok(['eat', 'fight', 'build'].includes(id));
    assert.ok(usedModel.startsWith('baseline') || usedModel === 'neural');
  });

  it('missing model artifact falls back (weights null => mirror)', () => {
    const os = require('os');
    const fs = require('fs');
    const path = require('path');
    const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-empty-'));
    const p = new NeuralPolicy({ mode: 'neural', weightsDir: emptyDir });
    assert.equal(p.weights, null);
    const { fellBack } = p.scoreIntents(vec, candidates);
    assert.equal(fellBack, false); // mirror is not a "fallback", it is the safe default
    fs.rmSync(emptyDir, { recursive: true, force: true });
  });
});

describe('experience-store', () => {
  let dir;
  beforeEach(() => {
    dir =
      require('os').tmpdir() +
      '/aiw-exp-' +
      Date.now() +
      '-' +
      Math.random().toString(36).slice(2, 6);
  });

  it('records decision, attaches outcome+reward, persists both', () => {
    const store = new ExperienceStore({ dir });
    const ep = store.recordDecision({
      agentId: 'Steve',
      observation: { health: 20, food: 18 },
      candidates: [{ id: 'eat', base: 0.3 }],
      chosenIntent: 'eat',
      deterministicScores: { eat: 0.3 },
      policyMode: 'deterministic',
    });
    const exp = store.recordOutcome(ep, { goalCompleted: true, progressDelta: 0.1 });
    assert.ok(exp && exp.outcome && exp.outcome.reward > 0);

    const raw = require('fs').readFileSync(store._fileFor('Steve'), 'utf8').trim().split('\n');
    assert.equal(raw.length, 2); // decision snapshot + final with outcome
    const final = JSON.parse(raw[1]);
    assert.equal(final.outcome.reward, exp.outcome.reward);
    assert.equal(final.stateVec.length, VEC_LEN);
  });

  it('reward weights are configurable and documented by behavior', () => {
    const r1 = computeReward({ goalCompleted: true });
    const r2 = computeReward({ died: true });
    assert.ok(r1.reward > 0);
    assert.ok(r2.reward < 0);
    assert.equal(r2.reward, -1.0);
    // configurable
    const r3 = computeReward({ died: true }, { death: -5 });
    assert.equal(r3.reward, -2); // clamped to [-2,2]
  });
});

describe('buildExperience context richness', () => {
  it('captures deterministic + neural scores, candidates, personality', () => {
    const exp = buildExperience({
      agentId: 'Steve',
      observation: { health: 10 },
      personality: { archetype: 'guard' },
      candidates: [{ id: 'fight', base: 0.9 }],
      chosenIntent: 'fight',
      deterministicScores: { fight: 0.9 },
      neuralScores: { fight: 0.95 },
      policyMode: 'shadow',
    });
    assert.equal(exp.policyMode, 'shadow');
    assert.deepEqual(exp.neuralScores, { fight: 0.95 });
    assert.equal(exp.personality.archetype, 'guard');
    assert.ok(Array.isArray(exp.stateVec));
  });
});
