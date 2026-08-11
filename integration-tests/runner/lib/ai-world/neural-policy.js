/**
 * Neural policy stub for AI World intent scoring.
 *
 * STAGE: MVP. This does NOT learn yet. It exposes the exact interface a trained
 * policy will use, and by default it mirrors the deterministic baseline so the
 * A/B and shadow modes are behaviorally comparable. When weights are loaded
 * (offline training step, future), `scoreIntents` will use them; until then it
 * returns the passed-in deterministic scores unchanged — guaranteeing no behavior
 * regression and a clean fallback path.
 *
 * Modes (selected by AIWORLD_POLICY):
 *   deterministic -> baseline only, executed
 *   neural       -> neural scores, executed (falls back to baseline on any fault)
 *   shadow       -> baseline executed, neural scores recorded alongside (no control)
 *
 * Safety invariants (enforced by the caller in decision integration, but also
 * defended here): never return NaN/Infinity/out-of-range; never throw; always
 * return a complete score map for every candidate id.
 */

const { VEC_LEN } = require('./state-rep');

/**
 * A tiny, dependency-free linear scorer. With identity weights it returns the
 * baseline scores unchanged. This is the seam where trained weights plug in.
 *
 * @param {number[]} stateVec
 * @param {Array<{id:string, base:number}>} candidates  base = deterministic score
 * @param {object} [weights]  future: per-feature or per-intent weights
 * @returns {Object<string, number>} intent id -> neural score
 */
function linearScore(stateVec, candidates, weights) {
  const out = {};
  for (const c of candidates) {
    // Identity for now: neural score == provided base.
    let v = Number(c.base);
    if (!Number.isFinite(v)) v = 0;
    out[c.id] = v;
  }
  return out;
}

class NeuralPolicy {
  /**
   * @param {{ mode?: 'deterministic'|'neural'|'shadow', weights?: object, now?: ()=>number }} [opts]
   */
  constructor(opts = {}) {
    this.mode = ['deterministic', 'neural', 'shadow'].includes(opts.mode)
      ? opts.mode
      : 'deterministic';
    this.weights = opts.weights || null; // null => identity (baseline mirror)
    this.now = typeof opts.now === 'function' ? opts.now : () => Date.now();
    this.fallbackCount = 0;
  }

  /**
   * Score candidate intents.
   * @param {number[]} stateVec length VEC_LEN
   * @param {Array<{id:string, base:number, motive?:string}>} candidates
   * @returns {{ scores: Object<string,number>, usedModel: string, fellBack: boolean }}
   */
  scoreIntents(stateVec, candidates) {
    // Validate inputs defensively — a bad vector must never crash the NPC loop.
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
      // Return baseline (already validated inside caller), usedModel flags fallback.
      const fallback = {};
      for (const c of candidates || []) fallback[c.id] = Number(c.base) || 0;
      return { scores: fallback, usedModel: 'fallback_invalid_input', fellBack: true };
    }

    try {
      const scores = this.weights
        ? this._applyWeights(stateVec, candidates)
        : linearScore(stateVec, candidates, this.weights);
      // Clamp + NaN guard as a final safety net.
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

  /** Future: multiply state features by per-intent weights. Stub returns base. */
  _applyWeights(_stateVec, candidates) {
    const out = {};
    for (const c of candidates) out[c.id] = Number(c.base);
    return out;
  }

  /**
   * Pick the winning intent id. In neural/shadow the policy decides; the caller
   * still runs safety/planner validation after this.
   * @returns {{ id:string|null, scores:object, usedModel:string, fellBack:boolean }}
   */
  choose(stateVec, candidates) {
    const { scores, usedModel, fellBack } = this.scoreIntents(stateVec, candidates);
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
    return { mode: this.mode, hasWeights: !!this.weights, fallbackCount: this.fallbackCount };
  }
}

module.exports = { NeuralPolicy, linearScore, VEC_LEN };
