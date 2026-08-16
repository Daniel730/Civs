#!/usr/bin/env node
/**
 * Recon analyzer for reports/village-worker.jsonl.
 *
 * Answers the Phase-0 questions with counts from real runs instead of guesses:
 * walk outcomes, recovery teleports, stalls, deaths/revives, camera switch cadence,
 * job mix and per-tick wall clock. Read-only; prints a JSON summary.
 *
 * Usage: node scripts/analyze-worker-log.js [path] [--last N]
 */
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const args = process.argv.slice(2);
const lastIdx = args.indexOf('--last');
const lastN = lastIdx >= 0 ? Number.parseInt(args[lastIdx + 1], 10) : 0;
const positional = args.filter(
  (a, i) => !a.startsWith('--') && !(lastIdx >= 0 && i === lastIdx + 1)
);
const file = positional[0] || path.join(__dirname, '..', 'reports', 'village-worker.jsonl');

function pct(part, total) {
  if (!total) return 0;
  return Math.round((part / total) * 1000) / 10;
}

async function main() {
  if (!fs.existsSync(file)) {
    console.log(JSON.stringify({ status: 'BLOCKED', reason: 'log_missing', file }));
    process.exit(2);
  }
  const rl = readline.createInterface({
    input: fs.createReadStream(file, { encoding: 'utf8' }),
    crlfDelay: Number.POSITIVE_INFINITY,
  });

  const walkOutcome = {};
  const jobs = {};
  const camSwitchReasons = {};
  const camSwitchAt = [];
  const tickAt = [];
  const workStatus = {};
  let rows = 0;
  let bad = 0;
  let walks = 0;
  let recoverTeleports = 0;
  let walkSteps = 0;
  let walkStepsMax = 0;
  let finalDistSum = 0;
  let finalDistN = 0;
  let revives = 0;
  let ensureAlive = 0;
  let subjectMissing = 0;
  let tickErrors = 0;
  let observeMissing = 0;
  let constructionPaused = 0;
  let constructionAborted = 0;
  // M6: typed action-event aggregation (break/mine/gather/place) + inventory reality.
  const typedEvents = { mine: 0, break: 0, gather: 0, place: 0, combat_survival: 0 };
  const typedByJob = {};
  const typedFails = {};
  let itemsGained = 0;
  let itemsDropped = 0;
  let wrongToolEvents = 0;
  const buffer = [];

  for await (const line of rl) {
    if (!line.trim()) continue;
    let row;
    try {
      row = JSON.parse(line);
    } catch (_) {
      bad += 1;
      continue;
    }
    rows += 1;
    if (lastN > 0) {
      buffer.push(row);
      if (buffer.length > lastN) buffer.shift();
      continue;
    }
    consume(row);
  }

  if (lastN > 0) for (const row of buffer) consume(row);

  function consume(row) {
    const action = row.action;
    if (action === 'camera_target_switch') {
      camSwitchReasons[row.reason || 'unknown'] = (camSwitchReasons[row.reason || 'unknown'] || 0) + 1;
      if (row.ts) camSwitchAt.push(Date.parse(row.ts));
    }
    if (action === 'observation_subject_missing') subjectMissing += 1;
    if (action === 'observation_tick_error') tickErrors += 1;
    if (action === 'ensure_alive') {
      ensureAlive += 1;
      if (row.revived) revives += 1;
    }
    // M6: aggregate typed action events (mine/break/gather/place/combat_survival).
    if (typedEvents[row.kind] != null) {
      typedEvents[row.kind] += 1;
      const job = row.job || 'unknown';
      typedByJob[job] = typedByJob[job] || { mine: 0, break: 0, gather: 0, place: 0, combat_survival: 0 };
      if (typedByJob[job][row.kind] != null) typedByJob[job][row.kind] += 1;
      if (row.result && row.result.success === false) {
        typedFails[row.kind] = (typedFails[row.kind] || 0) + 1;
      }
      if (row.tool && row.tool.matched === false) wrongToolEvents += 1;
      const inv = row.inventory || {};
      if (Array.isArray(inv.gained)) for (const g of inv.gained) itemsGained += (g.qty || 0);
      if (Array.isArray(inv.dropped)) for (const d of inv.dropped) itemsDropped += (d.qty || 0);
    }
    if (action !== 'work_tick') return;
    if (row.ts) tickAt.push(Date.parse(row.ts));
    workStatus[row.status || 'unknown'] = (workStatus[row.status || 'unknown'] || 0) + 1;
    const step = row.step || {};
    if (step.job) jobs[step.job] = (jobs[step.job] || 0) + 1;
    const result = row.result || {};
    if (result.alive && result.alive.revived) revives += 1;
    if (!result.observe) observeMissing += 1;
    for (const entry of result.actions || []) {
      const w = entry.walk || entry.walkBlock;
      if (w) {
        walks += 1;
        const reason = w.success ? w.reason || 'arrived' : w.reason || 'failed';
        walkOutcome[reason] = (walkOutcome[reason] || 0) + 1;
        if (w.recoverTeleport) recoverTeleports += 1;
        if (typeof w.steps === 'number') {
          walkSteps += w.steps;
          walkStepsMax = Math.max(walkStepsMax, w.steps);
        }
        if (typeof w.final_distance === 'number') {
          finalDistSum += w.final_distance;
          finalDistN += 1;
        }
      }
      if (entry.construction) {
        if (entry.construction.status === 'PROJECT_PAUSED') constructionPaused += 1;
        if (entry.construction.status === 'PROJECT_ABORTED') constructionAborted += 1;
      }
    }
  }

  const gaps = [];
  for (let i = 1; i < tickAt.length; i++) {
    const d = tickAt[i] - tickAt[i - 1];
    if (Number.isFinite(d) && d >= 0) gaps.push(d);
  }
  gaps.sort((a, b) => a - b);
  const camGaps = [];
  for (let i = 1; i < camSwitchAt.length; i++) {
    const d = camSwitchAt[i] - camSwitchAt[i - 1];
    if (Number.isFinite(d) && d >= 0) camGaps.push(d);
  }
  camGaps.sort((a, b) => a - b);
  const q = (arr, p) => (arr.length ? arr[Math.min(arr.length - 1, Math.floor(arr.length * p))] : null);

  const summary = {
    status: 'OBSERVED',
    file,
    rows,
    badLines: bad,
    workTicks: tickAt.length,
    workStatus,
    jobs,
    // M6: agent-oriented typed action events — answer "what did the NPC do / pick up / with what tool".
    typedEvents,
    typedByJob,
    typedFails,
    inventoryReality: { itemsGained, itemsDropped, wrongToolEvents },
    tickGapMs: { p50: q(gaps, 0.5), p90: q(gaps, 0.9), p99: q(gaps, 0.99), max: gaps[gaps.length - 1] || null },
    walk: {
      total: walks,
      outcomes: walkOutcome,
      recoverTeleports,
      recoverTeleportPct: pct(recoverTeleports, walks),
      avgSteps: walks ? Math.round((walkSteps / walks) * 10) / 10 : 0,
      maxSteps: walkStepsMax,
      avgFinalDistance: finalDistN ? Math.round((finalDistSum / finalDistN) * 100) / 100 : null,
    },
    survival: { ensureAliveChecks: ensureAlive, revives, revivePct: pct(revives, ensureAlive) },
    camera: {
      switches: camSwitchAt.length,
      reasons: camSwitchReasons,
      gapMs: { p50: q(camGaps, 0.5), p90: q(camGaps, 0.9), min: camGaps[0] || null },
      subjectMissing,
      tickErrors,
    },
    construction: { paused: constructionPaused, aborted: constructionAborted },
    observeMissing,
  };
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
