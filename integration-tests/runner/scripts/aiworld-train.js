#!/usr/bin/env node
/**
 * aiworld-train.js — OFFLINE training step that closes the AI World learning loop.
 *
 * The live server only RECORDS experiences (ExperienceStore) + INFERS from weights
 * (NeuralPolicy). This script reads the recorded dataset (JSONL) and writes a small
 * explainable weights artifact that NeuralPolicy loads at startup. So the more Steve
 * plays, the more experiences accumulate, and re-running this step makes his policy
 * better — that is "learn in the process".
 *
 * Model (matches NeuralPolicy.linearScore):
 *   neuralScore(intent) = base + bias[context][intent]
 * where bias[ctx][intent] = clamp( avgReward(ctx,intent) - globalAvgReward, -1, 1 ).
 * Intents that yielded above-average reward in a context get a positive boost there.
 *
 * Usage:
 *   node scripts/aiworld-train.js [--dir <experiences-dir>] [--out <weights.json>] [--min-count N]
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DEFAULT_EXP_DIR = path.join(ROOT, 'reports', 'aiworld-experiences');
const DEFAULT_OUT = path.join(ROOT, 'reports', 'aiworld-weights', 'weights-shared.json');
const MIN_COUNT = 3; // ignore contexts/intents with too few samples (noise)

function parseArgs(argv) {
  const a = { dir: DEFAULT_EXP_DIR, out: DEFAULT_OUT, minCount: MIN_COUNT };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--dir') a.dir = argv[++i];
    else if (argv[i] === '--out') a.out = argv[++i];
    else if (argv[i] === '--min-count') a.minCount = Number(argv[++i]) || MIN_COUNT;
  }
  return a;
}

function loadExperiences(dir) {
  if (!fs.existsSync(dir)) return [];
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl'));
  const out = [];
  for (const f of files) {
    const lines = fs.readFileSync(path.join(dir, f), 'utf8').split('\n');
    for (const ln of lines) {
      if (!ln.trim()) continue;
      try {
        const e = JSON.parse(ln);
        if (e && e.outcome && typeof e.outcome.reward === 'number') out.push(e);
      } catch (_) { /* skip bad line */ }
    }
  }
  return out;
}

function train(exps, minCount) {
  // Accumulate (ctx, intent) -> {sum, n}
  const acc = {};
  let totalSum = 0, totalN = 0;
  for (const e of exps) {
    const ctx = String(e.survivalState || e.context || 'SAFE').toUpperCase();
    const intent = e.chosenIntent || e.action || e.focus || null;
    if (!intent) continue;
    const r = Number(e.outcome.reward);
    if (!Number.isFinite(r)) continue;
    acc[ctx] = acc[ctx] || {};
    acc[ctx][intent] = acc[ctx][intent] || { sum: 0, n: 0 };
    acc[ctx][intent].sum += r;
    acc[ctx][intent].n += 1;
    totalSum += r;
    totalN += 1;
  }
  const globalAvg = totalN ? totalSum / totalN : 0;
  const bias = {};
  let ctxsWithData = 0;
  for (const ctx of Object.keys(acc)) {
    bias[ctx] = bias[ctx] || {};
    let ctxHasEnough = false;
    for (const intent of Object.keys(acc[ctx])) {
      const { sum, n } = acc[ctx][intent];
      if (n < minCount) continue;
      const avg = sum / n;
      const b = Math.max(-1, Math.min(1, avg - globalAvg));
      bias[ctx][intent] = Math.round(b * 1000) / 1000;
      ctxHasEnough = true;
    }
    if (ctxHasEnough) ctxsWithData++;
  }
  const weights = {
    version: 1,
    trainedAt: new Date().toISOString(),
    samples: totalN,
    globalAvgReward: Math.round(globalAvg * 1000) / 1000,
    default: 0,
    bias,
  };
  return { weights, ctxsWithData, totalN };
}

function main() {
  const a = parseArgs(process.argv.slice(2));
  const exps = loadExperiences(a.dir);
  if (!exps.length) {
    console.log(`[train] no experiences with outcomes in ${a.dir} — nothing to learn yet.`);
    process.exit(0);
  }
  const { weights, ctxsWithData, totalN } = train(exps, a.minCount);
  fs.mkdirSync(path.dirname(a.out), { recursive: true });
  fs.writeFileSync(a.out, JSON.stringify(weights, null, 2));
  console.log(`[train] wrote ${a.out}`);
  console.log(`[train] samples=${totalN} contexts_with_data=${ctxsWithData} globalAvgReward=${weights.globalAvgReward}`);
  console.log('[train] bias=', JSON.stringify(weights.bias));
  process.exit(0);
}

if (require.main === module) main();
module.exports = { train, loadExperiences };
