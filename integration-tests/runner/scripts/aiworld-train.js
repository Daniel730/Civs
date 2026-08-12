#!/usr/bin/env node
/**
 * AI World — OFFLINE TRAINING STEP (LIVE ≠ TRAIN).
 *
 * Reads the experience dataset (reports/aiworld-experiences/*.jsonl), aggregates
 * reward evidence per (context -> intent), and writes a small, explainable weights
 * artifact that the live NeuralPolicy loads at startup.
 *
 * This is NOT reinforcement learning. It is a dependency-free contextual-bandit /
 * preference learner: which intent tended to produce better outcomes in which
 * survival context, based on the rewards the running server already collected.
 *
 * Usage:
 *   node scripts/aiworld-train.js [--agent Steve|Alex|shared] [--minN 5] [--out <dir>]
 *
 * Output:
 *   reports/aiworld-weights/weights-<agent>.json   (or weights-shared.json)
 *   { version, trainedAt, contexts, bias: { [ctx]: { [intent]: number } }, default, stats }
 *
 * Safety: never writes weights if a context/intent has fewer than --minN samples
 * (avoids overfitting to noise). Missing/corrupt data is skipped, never throws.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const EXP_DIR = path.join(ROOT, 'reports', 'aiworld-experiences');
const DEFAULT_OUT = path.join(ROOT, 'reports', 'aiworld-weights');

function parseArgs(argv) {
  const a = { agent: 'shared', minN: 5, out: DEFAULT_OUT };
  for (let i = 2; i < argv.length; i++) {
    const t = argv[i];
    if (t === '--agent') a.agent = argv[++i] || a.agent;
    else if (t === '--minN') a.minN = Number(argv[++i]) || a.minN;
    else if (t === '--out') a.out = argv[++i] || a.out;
  }
  return a;
}

function readExperiences() {
  if (!fs.existsSync(EXP_DIR)) return [];
  const rows = [];
  for (const f of fs.readdirSync(EXP_DIR)) {
    if (!f.endsWith('.jsonl')) continue;
    const full = path.join(EXP_DIR, f);
    for (const line of fs.readFileSync(full, 'utf8').split('\n')) {
      const s = line.trim();
      if (!s) continue;
      try {
        const e = JSON.parse(s);
        // Accept experiences that at least have a state representation (decision recorded).
        // Outcome may be attached later by the worker; training uses whatever is present.
        if (e && e.schema === 'aiworld.experience' && e.stateRep && e.stateRep.vec) rows.push(e);
      } catch (_) {
        /* skip malformed line */
      }
    }
  }
  return rows;
}

/**
 * Extract the survival context from a state representation.
 * Prefers an explicit survivalState/context field, then falls back to the
 * 'survival_state' column of stateRep.vec (see state-rep.js field order).
 */
function contextOf(e) {
  if (e.survivalState) return String(e.survivalState).toUpperCase();
  if (e.context && e.context.survival) return String(e.context.survival).toUpperCase();
  try {
    const rep = e.stateRep;
    const fields = rep.fields || [];
    const idx = fields.indexOf('survival_state');
    if (idx >= 0 && Array.isArray(rep.vec)) {
      const v = rep.vec[idx];
      if (typeof v === 'string') return v.toUpperCase();
      // numeric encoding: 0=SAFE,1=CAUTION,2=DANGER,3=RECOVER,4=ESCAPE (see state-rep)
      const map = ['SAFE', 'CAUTION', 'DANGER', 'RECOVER', 'ESCAPE'];
      if (Number.isFinite(v)) return map[Math.round(v)] || 'SAFE';
    }
  } catch (_) {
    /* ignore */
  }
  return 'SAFE';
}

/**
 * Aggregate reward by (context, intent).
 * Context = survivalState of the decision (SAFE/DANGER/RECOVER/CAUTION/...).
 * Intent = chosenIntent (the focus the worker actually executed).
 * Reward = outcome.reward (already computed by state-rep.computeReward).
 */
function aggregate(rows, minN) {
  // per-context: intent -> { sum, n, deathN, goalN }
  const ctxMap = {};
  let usable = 0;
  for (const e of rows) {
    const ctx = contextOf(e);
    const intent = e.chosenIntent || (e.action && e.action.intent);
    // Reward: prefer recorded outcome; if absent, this decision has no learning signal yet.
    const r = e.outcome && typeof e.outcome.reward === 'number' ? e.outcome.reward : null;
    if (!intent) continue;
    if (!ctxMap[ctx]) ctxMap[ctx] = {};
    if (!ctxMap[ctx][intent]) ctxMap[ctx][intent] = { sum: 0, n: 0, deathN: 0, goalN: 0, rated: 0 };
    const cell = ctxMap[ctx][intent];
    if (r !== null) {
      cell.sum += r;
      cell.rated += 1;
      if (e.outcome.died) cell.deathN += 1;
      if (e.outcome.goalCompleted) cell.goalN += 1;
    }
    cell.n += 1; // decisions recorded (even without outcome yet)
    usable += 1;
  }

  // Convert per-context sums into bias adjustments.
  // bias[intent] = (meanReward_thisIntent - meanReward_allIntentsInCtx), clamped.
  // This is a mean-centering preference shift: intents that beat the context average
  // get a positive nudge; those that underperform get a negative nudge.
  const bias = {};
  const stats = { contexts: 0, intents: 0, usableSamples: usable, ratedSamples: 0 };
  for (const ctx of Object.keys(ctxMap)) {
    const intents = ctxMap[ctx];
    let totalSum = 0, totalRated = 0;
    for (const it of Object.keys(intents)) {
      totalSum += intents[it].sum;
      totalRated += intents[it].rated;
    }
    const grandMean = totalRated > 0 ? totalSum / totalRated : 0;
    stats.ratedSamples = totalRated;
    bias[ctx] = {};
    for (const it of Object.keys(intents)) {
      const c = intents[it];
      if (c.rated < minN) continue; // insufficient EVIDENCE (rated samples) — skip (no bias)
      const mean = c.sum / c.rated;
      let delta = mean - grandMean;
      // clamp the learned adjustment to a safe range so it can only nudge, never dominate
      delta = Math.max(-1, Math.min(1, delta));
      // also discount by confidence: small n -> smaller nudge
      const conf = Math.min(1, c.rated / (minN * 2));
      bias[ctx][it] = Number((delta * (0.5 + 0.5 * conf)).toFixed(4));
      stats.intents += 1;
    }
    if (Object.keys(bias[ctx]).length === 0) delete bias[ctx];
    else stats.contexts += 1;
  }
  return { bias, stats };
}

function main() {
  const args = parseArgs(process.argv);
  const rows = readExperiences();
  console.log(`[aiworld-train] read ${rows.length} experience records`);
  if (rows.length === 0) {
    console.log('[aiworld-train] no experiences yet — run the worker to collect a dataset first.');
    process.exit(0);
  }
  const { bias, stats } = aggregate(rows, args.minN);
  if (stats.contexts === 0) {
    console.log(`[aiworld-train] insufficient samples (<${args.minN}) per context — no weights written.`);
    console.log('[aiworld-train] keep running the worker to collect more experiences, then re-run this step.');
    process.exit(0);
  }
  const artifact = {
    version: 1,
    trainedAt: new Date().toISOString(),
    agent: args.agent,
    minN: args.minN,
    bias,
    default: 0,
    stats,
  };
  if (!fs.existsSync(args.out)) fs.mkdirSync(args.out, { recursive: true });
  const outFile =
    args.agent === 'shared'
      ? path.join(args.out, 'weights-shared.json')
      : path.join(args.out, `weights-${args.agent}.json`);
  fs.writeFileSync(outFile, JSON.stringify(artifact, null, 2));
  console.log(`[aiworld-train] wrote weights -> ${outFile}`);
  console.log(`[aiworld-train] stats: ${stats.contexts} context(s), ${stats.intents} intent bias(es), ${stats.usableSamples} usable samples`);
  console.log('[aiworld-train] live server will load these on next start (AIWORLD_POLICY=neural|shadow).');
}

// Export internals for unit testing; only run main() when invoked as a CLI script.
module.exports = { readExperiences, contextOf, aggregate, parseArgs };
if (require.main === module) main();
