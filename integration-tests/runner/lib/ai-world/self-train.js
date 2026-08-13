/**
 * self-train.js — closes the live learning loop for AI World.
 *
 * The ExperienceStore records decisions + outcomes during play; aiworld-train.js
 * turns that dataset into weights-shared.json; NeuralPolicy loads those weights.
 * This module is the MISSING LINK: it periodically (a) runs the offline trainer
 * and (b) hot-reloads the live policy so the running NPC actually improves from
 * its own experience — "learns in the process".
 *
 * Safe by design:
 *  - disabled unless AIWORLD_SELFTRAIN=1 (never surprises the body agent / QA)
 *  - never throws; failures are logged and skipped
 *  - trains in a child process (node scripts/aiworld-train.js) so a crash can't
 *    take down the work loop
 *  - reload is best-effort (policy.loadWeights falls back to mirror on any fault)
 */
const path = require('path');
const { execFile } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const TRAIN_SCRIPT = path.join(ROOT, 'scripts', 'aiworld-train.js');
const EXP_DIR = path.join(ROOT, 'reports', 'aiworld-experiences');
const WEIGHTS_OUT = path.join(ROOT, 'reports', 'aiworld-weights', 'weights-shared.json');

let _enabled = null;
let _sinceTrain = 0;
let _training = false;
let _lastTrainedAt = 0;

function enabled() {
  if (_enabled === null) _enabled = process.env.AIWORLD_SELFTRAIN === '1';
  return _enabled;
}

/**
 * Call after every recorded outcome. When enough new outcomes accumulate (and the
 * trainer isn't already running), kick off a background train + reload.
 * @param {object} [opts]
 * @param {number} [opts.threshold=8] outcomes since last train before retraining
 * @param {number} [opts.cooldownMs=60000] min ms between trains
 * @param {object} [opts.policy] the live NeuralPolicy instance to hot-reload
 */
function noteOutcome(opts = {}) {
  if (!enabled()) return;
  const threshold = opts.threshold || 8;
  const cooldownMs = opts.cooldownMs || 60000;
  _sinceTrain += 1;
  const now = Date.now();
  if (_training) return;
  if (_sinceTrain < threshold) return;
  if (now - _lastTrainedAt < cooldownMs) return;
  runNow(opts);
}

/**
 * Force a train + reload now. Returns a promise that resolves to
 * { trained:boolean, loadedWeights:boolean, error?:string }.
 */
function runNow(opts = {}) {
  if (!enabled()) return Promise.resolve({ trained: false, reason: 'disabled' });
  if (_training) return Promise.resolve({ trained: false, reason: 'in_progress' });
  _training = true;
  _sinceTrain = 0;
  _lastTrainedAt = Date.now();
  const policy = opts.policy || null;
  return new Promise((resolve) => {
    const child = execFile(
      process.execPath,
      [TRAIN_SCRIPT, '--dir', EXP_DIR, '--out', WEIGHTS_OUT],
      { timeout: 30000 },
      (err) => {
        _training = false;
        if (err) {
          console.log('[self-train] train step failed:', err.message);
          return resolve({ trained: false, loadedWeights: false, error: err.message });
        }
        let loaded = false;
        if (policy && typeof policy.loadWeights === 'function') {
          try { loaded = policy.loadWeights(); } catch (_) { loaded = false; }
        }
        console.log(`[self-train] retrained -> weights written, policy reloaded=${loaded}`);
        resolve({ trained: true, loadedWeights: loaded });
      }
    );
    child.on('error', (e) => {
      _training = false;
      console.log('[self-train] could not spawn trainer:', e.message);
      resolve({ trained: false, loadedWeights: false, error: e.message });
    });
  });
}

/** Test/inspection hook. */
function snapshot() {
  return { enabled: enabled(), sinceTrain: _sinceTrain, training: _training, lastTrainedAt: _lastTrainedAt };
}

module.exports = { noteOutcome, runNow, snapshot, enabled, EXP_DIR, WEIGHTS_OUT, TRAIN_SCRIPT };
