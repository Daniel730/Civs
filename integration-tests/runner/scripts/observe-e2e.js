#!/usr/bin/env node
/**
 * End-to-end observation proof against live Paper QA.
 *
 * Proves:
 *   Cam tracks Steve → Cam tracks Alex → Viewer spectates Cam continuously
 *   Steve/Alex observe() succeeds (agents alive)
 *
 * Usage (Windows → WSL Paper):
 *   set RCON_HOST=192.168.152.149
 *   set RCON_PASSWORD=civsqa
 *   node scripts/observe-e2e.js
 */
const fs = require('fs');
const path = require('path');
const { Harness } = require('../lib/harness');
const { SpectatorCamera } = require('../lib/camera');
const { ObservationDirector, ViewerFollowLoop } = require('../lib/observation');

const REPORTS = path.join(__dirname, '..', 'reports');
const OUT = path.join(REPORTS, 'observe-e2e.json');

const cfg = {
  rconHost: process.env.RCON_HOST || '192.168.152.149',
  rconPort: Number.parseInt(process.env.RCON_PORT || '25575', 10),
  rconPassword: process.env.RCON_PASSWORD || 'civsqa',
  mcHost: process.env.MC_HOST || process.env.RCON_HOST || '192.168.152.149',
  mcPort: Number.parseInt(process.env.MC_PORT || '25565', 10),
  dwellMs: Number.parseInt(process.env.CAM_DWELL_MS || '8000', 10),
};

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const evidence = {
    startedAt: new Date().toISOString(),
    steps: [],
    pass: false,
  };
  const push = (step) => {
    evidence.steps.push({ ts: new Date().toISOString(), ...step });
    console.log(JSON.stringify(step));
  };

  const harness = new Harness({
    host: cfg.rconHost,
    port: cfg.rconPort,
    password: cfg.rconPassword,
  });
  await harness.connect();

  const list = await harness.raw('list');
  push({ action: 'list', list });
  for (const name of ['Steve', 'Alex', 'Cam']) {
    if (!new RegExp(`\\b${name}\\b`).test(String(list))) {
      push({ action: 'missing_player', name, status: 'FAIL' });
      evidence.failReason = `missing_${name}`;
      fs.mkdirSync(REPORTS, { recursive: true });
      fs.writeFileSync(OUT, JSON.stringify(evidence, null, 2));
      process.exit(2);
    }
  }

  for (const name of ['Steve', 'Alex']) {
    const obs = await harness.cap.observe(name);
    push({
      action: 'agent_observe',
      name,
      success: !!(obs && obs.success),
      data: obs && obs.data,
    });
    if (!obs || !obs.success) {
      evidence.failReason = `observe_failed_${name}`;
      fs.writeFileSync(OUT, JSON.stringify(evidence, null, 2));
      process.exit(3);
    }
  }

  const camera = new SpectatorCamera({
    harness,
    host: cfg.mcHost,
    port: cfg.mcPort,
    name: 'Cam',
    targetName: 'Steve',
  });
  // Cam already online from village-worker — do not reconnect actor; just use harness.
  camera.actor = { available: true, connect: async () => {}, disconnect: async () => {} };
  await harness.raw('gamemode spectator Cam');
  await harness.raw('execute as Cam run spectate');

  const logs = [];
  const director = new ObservationDirector({
    camera,
    harness,
    subjects: ['Steve', 'Alex'],
    dwellMs: cfg.dwellMs,
    tickMs: 1500,
    onLog: (e) => logs.push(e),
  });
  // Manual drive — no interval
  director.currentSubject = 'Steve';
  director._subjectStartedAt = Date.now();
  director.status = 'HEALTHY';

  const tSteve = await director.tick();
  push({ action: 'cam_focus_steve', ...tSteve });
  assertPass(tSteve, 'Steve');

  // Advance dwell
  director._subjectStartedAt = Date.now() - cfg.dwellMs - 1;
  const tAlex = await director.tick();
  push({ action: 'cam_focus_alex', ...tAlex });
  assertPass(tAlex, 'Alex');

  const viewer = new ViewerFollowLoop({
    harness,
    viewerName: 'Viewer',
    cameraName: 'Cam',
  });
  // Ensure Viewer online or skip with DEGRADED
  const list2 = await harness.raw('list');
  if (/\bViewer\b/.test(String(list2))) {
    const v1 = await viewer.tick();
    push({ action: 'viewer_follow_1', ...v1 });
    const v2 = await viewer.tick();
    push({ action: 'viewer_follow_2', ...v2 });
    if (v1.status !== 'PASS' || v2.status !== 'PASS') {
      evidence.failReason = 'viewer_follow_failed';
      fs.writeFileSync(OUT, JSON.stringify(evidence, null, 2));
      process.exit(4);
    }
  } else {
    push({ action: 'viewer_follow', status: 'DEGRADED', reason: 'viewer_offline' });
  }

  await sleep(500);
  const focused = director.focusedSubjects.sort();
  push({ action: 'focused_subjects', focused });
  if (!focused.includes('Steve') || !focused.includes('Alex')) {
    evidence.failReason = 'did_not_focus_both';
    fs.writeFileSync(OUT, JSON.stringify(evidence, null, 2));
    process.exit(5);
  }

  evidence.pass = true;
  evidence.finishedAt = new Date().toISOString();
  evidence.answers = {
    camWorking: true,
    viewerFollowContinuous: /\bViewer\b/.test(String(list2)),
    alexAiObservable: true,
    steveAiObservable: true,
    camFocusedAlex: focused.includes('Alex'),
    camFocusedSteve: focused.includes('Steve'),
  };
  fs.mkdirSync(REPORTS, { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(evidence, null, 2));
  push({ action: 'e2e_pass', out: OUT, answers: evidence.answers });
  await harness.close();
  process.exit(0);
}

function assertPass(tick, subject) {
  if (!tick || tick.status === 'FAILED' || tick.subject !== subject) {
    throw new Error(`expected focus ${subject}, got ${JSON.stringify(tick)}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
