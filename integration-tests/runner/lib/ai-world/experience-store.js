/**
 * Experience collector + dataset store for the AI World neural layer.
 *
 * LIVE INFERENCE vs OFFLINE TRAINING are strictly separated (per brief):
 *   - This module only RECORDS experiences during live runs and (optionally) loads a
 *     previously-trained model artifact. It never trains.
 *   - Offline training is a separate, reproducible step (future) that reads the
 *     persisted dataset and writes a weights artifact back.
 *
 * Each experience captures enough context to investigate WHY a decision was good/bad:
 * state vector, personality, candidate intents + both deterministic and neural scores,
 * the executed action, and a later-attached outcome + reward.
 *
 * Persisted as line-delimited JSON (append-only) so it is trivially consumable by any
 * offline tool (Python, jq, DuckDB, ...). One file per agent keeps writes cheap.
 */

const fs = require('fs');
const path = require('path');
const { buildExperience, computeReward } = require('./state-rep');

const DEFAULT_DIR = path.join(__dirname, '..', '..', 'reports', 'aiworld-experiences');

class ExperienceStore {
  /**
   * @param {{ dir?: string, now?: ()=>number }} [opts]
   */
  constructor(opts = {}) {
    this.dir = opts.dir || DEFAULT_DIR;
    this.now = typeof opts.now === 'function' ? opts.now : () => Date.now();
    this.open = new Map(); // episodeId -> partial experience awaiting outcome
    this.count = 0;
    fs.mkdirSync(this.dir, { recursive: true });
  }

  _fileFor(agentId) {
    return path.join(this.dir, `experiences-${agentId}.jsonl`);
  }

  /**
   * Record a decision (called at decision time). Returns the episodeId for later outcome linking.
   * @returns {string} episodeId
   */
  recordDecision(rec = {}) {
    const episodeId = rec.episodeId || `ep_${this.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const exp = buildExperience({ ...rec, episodeId, at: rec.at || this.now() });
    // Stash for outcome attachment; persist a decision snapshot immediately too.
    this.open.set(episodeId, exp);
    this._append(exp.agentId, exp);
    this.count += 1;
    return episodeId;
  }

  /**
   * Attach an outcome + computed reward to a previously recorded decision.
   * @param {string} episodeId
   * @param {object} outcome see computeReward for fields
   * @param {object} [rewardWeights]
   */
  recordOutcome(episodeId, outcome = {}, rewardWeights) {
    const exp = this.open.get(episodeId);
    if (!exp) return null; // already flushed or unknown
    // Pass the decision context (survivalState + chosenIntent recorded at decision time) so
    // computeReward can score how well the focus FIT the situation — the signal that makes
    // learning differentiate behaviour instead of rewarding every tick equally.
    const { reward, components } = computeReward(outcome, rewardWeights, {
      survivalState: exp.survivalState,
      chosenIntent: exp.chosenIntent,
    });
    exp.outcome = { ...outcome, reward, rewardComponents: components };
    this.open.delete(episodeId);
    this._append(exp.agentId, exp);
    return exp;
  }

  _append(agentId, obj) {
    const line = JSON.stringify(obj) + '\n';
    try {
      fs.appendFileSync(this._fileFor(agentId), line);
    } catch (e) {
      // Never let persistence failure crash the NPC loop.
    }
  }

  /** Load a trained weights artifact (offline step writes this). Null until then. */
  loadWeights(artifactPath) {
    try {
      const raw = fs.readFileSync(artifactPath, 'utf8');
      return JSON.parse(raw);
    } catch (e) {
      return null;
    }
  }

  snapshot() {
    return { dir: this.dir, openEpisodes: this.open.size, recorded: this.count };
  }
}

module.exports = { ExperienceStore, DEFAULT_DIR };
