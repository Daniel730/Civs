/**
 * Neural policy for AI World intent scoring.
 *
 * STAGE: MVP with OFFLINE TRAINING. This is a dependency-free, explainable
 * contextual-bandit / preference learner. It does NOT do online RL — the live
 * server only INFERS from weights produced by an offline training step
 * (scripts/aiworld-train.js). Training reads the experience dataset (JSONL),
 * aggregates (context -> intent) reward evidence, and writes a small weights
 * artifact that this module loads at startup.
 *
 * Until weights exist, it mirrors the deterministic baseline (identity), so
 * behaviour is unchanged and the neural/shadow modes are behaviourally comparable.
 *
 * Modes (selected by AIWORLD_POLICY):
 *   deterministic -> baseline only, executed
 *   neural       -> neural scores, executed (falls back to baseline on any fault)
 *   shadow       -> baseline executed, neural scores recorded alongside (no control)
 *
 * Safety invariants (defended here, not only by the caller):
 *   - never return NaN/Infinity/out-of-range
 *   - never throw
 *   - always return a complete score map for every candidate id
 *   - any fault -> baseline mirror (NEURAL -> DETERMINISTIC fallback)
 */

const fs = require('fs');
const path = require('path');
const { VEC_LEN } = require('./state-rep');

/** Default path for the per-agent trained weights artifact. */
const DEFAULT_WEIGHTS_DIR = path.join(__dirname, '..', '..', 'reports', 'aiworld-weights');

/**
 * Score candidate intents with a trained linear model.
 *
 * Model: neuralScore(intent) = base + bias[contextBucket][intent] + Σ_k W[feature_k]*stateVec[k]
 * where `base` is the deterministic score (kept as the anchor), `bias` is the
 * learned per-context intent adjustment, and `W` is an optional global feature
 * weight vector. If weights are absent, returns identity (baseline mirror).
 *
 * @param {number[]} stateVec
 * @param {Array<{id:string, base:number, motive?:string}>} candidates
 * @param {object} weights  { version, bias: {[ctx]: {[intent]: number}}, featureW?: number[], default: number }
 * @param {string} ctx  context bucket key (e.g. 'SAFE', 'DANGER', 'RECOVER')
 * @returns {Object<string, number>} intent id -> neural score
 */
function linearScore(stateVec, candidates, weights, ctx) {
  const out = {};
  const biasMap = (weights && weights.bias && weights.bias[ctx]) || (weights && weights.bias && weights.bias.__default) || {};
  const featW = (weights && weights.featureW) || null;
  const globalDefault = (weights && typeof weights.default === 'number') ? weights.default : 0;
  for (const c of candidates) {
    let v = Number(c.base);
    if (!Number.isFinite(v)) v = 0;
    // learned per-context intent bias
    const b = Number(biasMap[c.id]);
    if (Number.isFinite(b)) v += b;
    else v += globalDefault;
    // optional global feature influence (shaped by state)
    if (featW && Array.isArray(stateVec) && featW.length === stateVec.length) {
      let dot = 0;
      for (let k = 0; k < featW.length; k++) {
        const x = Number(stateVec[k]);
        if (Number.isFinite(x)) dot += featW[k] * x;
      }
      if (Number.isFinite(dot)) v += dot;
    }
    out[c.id] = v;
  }
  return out;
}

class NeuralPolicy {
  /**
   * @param {{ mode?: 'deterministic'|'neural'|'shadow', weights?: object,
   *   weightsPath?: string, now?: ()=>number, weightsDir?: string }} [opts]
   */
  constructor(opts = {}) {
    this.mode = ['deterministic', 'neural', 'shadow'].includes(opts.mode)
      ? opts.mode
      : 'deterministic';
    this.weights = opts.weights || null; // null => identity (baseline mirror)
    this.weightsDir = opts.weightsDir || DEFAULT_WEIGHTS_DIR;
    this.weightsPath = opts.weightsPath || null; // explicit override
    this.now = typeof opts.now === 'function' ? opts.now : () => Date.now();
    this.fallbackCount = 0;
    this.loadedFrom = null;
    if (!this.weights && (this.mode === 'neural' || this.mode === 'shadow')) {
      this.loadWeights(); // best-effort at construction
    }
  }

  /**
   * Try to load a trained weights artifact for `agentId` (or the shared artifact).
   * Best-effort: on any failure weights remain null (baseline mirror).
   * @param {string} [agentId]
   * @returns {boolean} whether weights were loaded
   */
  loadWeights(agentId) {
    const candidates = [];
    if (this.weightsPath) candidates.push(this.weightsPath);
    if (agentId) candidates.push(path.join(this.weightsDir, `weights-${agentId}.json`));
    candidates.push(path.join(this.weightsDir, 'weights-shared.json'));
    for (const p of candidates) {
      try {
        if (fs.existsSync(p)) {
          const data = JSON.parse(fs.readFileSync(p, 'utf8'));
          if (data && data.bias) {
            this.weights = data;
            this.loadedFrom = p;
            return true;
          }
        }
      } catch (_) {
        /* try next candidate */
      }
    }
    this.weights = null;
    return false;
  }

  /**
   * Persist current weights to disk (used by offline training step).
   * @param {string} [agentId]
   * @returns {string|null} written path
   */
  saveWeights(agentId, dir) {
    const targetDir = dir || this.weightsDir;
    try {
      if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });
      const p = path.join(targetDir, agentId ? `weights-${agentId}.json` : 'weights-shared.json');
      fs.writeFileSync(p, JSON.stringify(this.weights, null, 2));
      this.loadedFrom = p;
      return p;
    } catch (_) {
      return null;
    }
  }

  /**
   * Score candidate intents.
   * @param {number[]} stateVec length VEC_LEN
   * @param {Array<{id:string, base:number, motive?:string}>} candidates
   * @param {string} [ctx] context bucket (e.g. survivalState)
   * @returns {{ scores: Object<string,number>, usedModel: string, fellBack: boolean }}
   */
  scoreIntents(stateVec, candidates, ctx) {
    const context = ctx || 'SAFE';
    const vecOk =
      Array.isArray(stateVec) &&
      stateVec.length === VEC_LEN &&
      stateVec.every((x) => Number.isFinite(x));
    const candsOk =
      Array.isArray(candidates) &&
      candidates.length > 0 &&
      candidates.every((c) => c && typeof c.id === 'string' && Number.isFinite(Number(c.base)));

    if (!vecOk || !candsOk) {
      this.fallbackCount += 1;
      const fallback = {};
      for (const c of candidates || []) fallback[c.id] = Number(c.base) || 0;
      return { scores: fallback, usedModel: 'fallback_invalid_input', fellBack: true };
    }

    try {
      const scores = this.weights
        ? this._applyWeights(stateVec, candidates, context)
        : linearScore(stateVec, candidates, null, context);
      const clean = {};
      for (const c of candidates) {
        const v = Number(scores[c.id]);
        clean[c.id] = Number.isFinite(v) ? Math.max(-2, Math.min(2, v)) : Number(c.base) || 0;
      }
      return {
        scores: clean,
        usedModel: this.weights ? 'neural' : 'baseline_mirror',
        fellBack: false,
      };
    } catch (e) {
      this.fallbackCount += 1;
      const fallback = {};
      for (const c of candidates) fallback[c.id] = Number(c.base) || 0;
      return { scores: fallback, usedModel: 'fallback_exception', fellBack: true };
    }
  }

  /** Apply trained weights (per-context intent bias + optional feature dot product). */
  _applyWeights(stateVec, candidates, ctx) {
    return linearScore(stateVec, candidates, this.weights, ctx);
  }

  /**
   * Pick the winning intent id. In neural/shadow the policy decides; the caller
   * still runs safety/planner validation after this.
   * @returns {{ id:string|null, scores:object, usedModel:string, fellBack:boolean }}
   */
  choose(stateVec, candidates, ctx) {
    const { scores, usedModel, fellBack } = this.scoreIntents(stateVec, candidates, ctx);
    let best = null;
    let bestScore = Number.NEGATIVE_INFINITY;
    for (const c of candidates) {
      const s = scores[c.id];
      if (s > bestScore) {
        bestScore = s;
        best = c.id;
      }
    }
    return { id: best, scores, usedModel, fellBack };
  }

  snapshot() {
    return {
      mode: this.mode,
      hasWeights: !!this.weights,
      loadedFrom: this.loadedFrom,
      fallbackCount: this.fallbackCount,
    };
  }
}

module.exports = { NeuralPolicy, linearScore, VEC_LEN, DEFAULT_WEIGHTS_DIR };
