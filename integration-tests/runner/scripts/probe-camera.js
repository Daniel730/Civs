#!/usr/bin/env node
/**
 * Camera quality probe against a live Paper server.
 *
 * Answers the questions the JSONL log cannot: does the rig glide or teleport, does it keep the
 * subject framed while the subject walks, and how often is a shot actually occluded in the open
 * versus inside the village. Two actors join: `CamProbe` (the rig) and `SubProbe` (the subject).
 *
 * Reported per shot:
 *   maxJumpBlocks   largest single-sample camera displacement — a cut/teleport, not a move
 *   moveCv          coefficient of variation of camera displacement (jerk)
 *   framing         camera→subject distance vs. the distance the shot asked for
 *   occluded        server verdict for the requested angle
 *
 * Usage:
 *   RCON_HOST=<wsl-ip> RCON_PASSWORD=civsqa node scripts/probe-camera.js
 */
const fs = require('fs');
const path = require('path');
const { Harness } = require('../lib/harness');
const { RawKeepAliveActor } = require('../lib/actor');
const { SHOTS, selectShot, shotArgs } = require('../lib/observation/shots');

const cfg = {
  rconHost: process.env.RCON_HOST || '127.0.0.1',
  rconPort: Number.parseInt(process.env.RCON_PORT || '25575', 10),
  rconPassword: process.env.RCON_PASSWORD || 'civsqa',
  mcHost: process.env.MC_HOST || process.env.RCON_HOST || '127.0.0.1',
  mcPort: Number.parseInt(process.env.MC_PORT || '25565', 10),
  camName: process.env.CAM_PROBE || 'CamProbe',
  subName: process.env.SUB_PROBE || 'SubProbe',
  version: process.env.MC_SERVER_MAJOR || '26.1.2',
  origin: {
    x: Number.parseInt(process.env.VILLAGE_X || '5200', 10),
    y: Number.parseInt(process.env.VILLAGE_Y || '80', 10),
    z: Number.parseInt(process.env.VILLAGE_Z || '5200', 10),
  },
  /** How far from the village counts as "open field" for the control case. */
  openOffset: Number.parseInt(process.env.PROBE_OPEN_OFFSET || '90', 10),
  holdMs: Number.parseInt(process.env.PROBE_HOLD_MS || '3500', 10),
  sampleMs: Number.parseInt(process.env.PROBE_SAMPLE_MS || '250', 10),
};

const SHOT_LIST = (process.env.PROBE_SHOTS || 'establishing,wide,medium,over_shoulder,low,top_down')
  .split(',')
  .map((s) => s.trim())
  .filter((s) => SHOTS[s]);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const round = (v, p = 2) => (Number.isFinite(v) ? Math.round(v * 10 ** p) / 10 ** p : null);

function stats(values) {
  if (!values.length) return { n: 0 };
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const sd = Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length);
  const sorted = [...values].sort((a, b) => a - b);
  return {
    n: values.length,
    mean: round(mean, 3),
    sd: round(sd, 3),
    cv: mean > 0 ? round(sd / mean, 3) : null,
    p50: round(sorted[Math.floor(sorted.length * 0.5)], 3),
    max: round(sorted[sorted.length - 1], 3),
  };
}

async function pos(harness, name) {
  const obs = await harness.cap.observe(name);
  if (!obs || !obs.success || !obs.data) return null;
  const d = obs.data;
  return { x: d.x, y: d.y, z: d.z, yaw: d.yaw, pitch: d.pitch };
}

function dist3(a, b) {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2);
}

/** Sample the rig and the subject together while a shot is held. */
async function sampleShot(harness, holdMs) {
  const camMoves = [];
  const subMoves = [];
  const yawSteps = [];
  const framing = [];
  let prev = null;
  let prevSub = null;
  const deadline = Date.now() + holdMs;
  while (Date.now() < deadline) {
    const [cam, sub] = [await pos(harness, cfg.camName), await pos(harness, cfg.subName)];
    if (cam && sub) {
      if (prev) {
        camMoves.push(dist3(cam, prev));
        yawSteps.push(Math.abs(((cam.yaw - prev.yaw + 540) % 360) - 180));
      }
      if (prevSub) subMoves.push(dist3(sub, prevSub));
      framing.push(dist3(cam, sub));
      prev = cam;
      prevSub = sub;
    }
    await sleep(cfg.sampleMs);
  }
  return { camMoves, subMoves, yawSteps, framing };
}

async function runShot(harness, shotName, label) {
  const plan = selectShot({ subject: cfg.subName, activity: 'idle', shotIndex: 0 });
  // Force the specific shot geometry rather than whatever the rotation would pick.
  const forced = { ...plan, shot: shotName, geometry: SHOTS[shotName], yaw: SHOTS[shotName].yaw };
  const t0 = Date.now();
  const res = await harness.cap.act(cfg.camName, 'cam_shot', cfg.subName, ...shotArgs(forced));
  const issueMs = Date.now() - t0;
  if (!res || res.reason === 'unknown_action') {
    return { label, shot: shotName, status: 'BLOCKED', reason: 'cam_shot_missing' };
  }
  const before = (await harness.cap.act(cfg.camName, 'cam_status')).data || {};
  const s = await sampleShot(harness, cfg.holdMs);
  const after = (await harness.cap.act(cfg.camName, 'cam_status')).data || {};
  const d = res.data || {};
  return {
    label,
    shot: shotName,
    status: res.success ? 'OBSERVED' : 'DEGRADED',
    issueLatencyMs: issueMs,
    requestedDistance: SHOTS[shotName].dist,
    resolvedDistance: d.distance,
    occluded: !!d.occluded,
    repositioned: !!d.repositioned,
    camDisplacementPerSample: stats(s.camMoves),
    maxJumpBlocks: stats(s.camMoves).max,
    camYawStepDegrees: stats(s.yawSteps),
    framingDistance: stats(s.framing),
    serverDelta: {
      occlusionEvents: (after.occlusion_events || 0) - (before.occlusion_events || 0),
      repositionEvents: (after.reposition_events || 0) - (before.reposition_events || 0),
      subjectLost: (after.subject_lost || 0) - (before.subject_lost || 0),
      cuts: (after.cuts || 0) - (before.cuts || 0),
      ticks: (after.ticks || 0) - (before.ticks || 0),
    },
  };
}

async function joinActor(harness, username) {
  const actor = new RawKeepAliveActor({
    host: cfg.mcHost,
    port: cfg.mcPort,
    username,
    version: cfg.version,
    sendCommand: (c) => harness.raw(c),
  });
  await actor.connect();
  if (!actor.available) return { actor, ok: false, reason: actor.reason };
  await actor.grantOp();
  return { actor, ok: true };
}

async function main() {
  const harness = new Harness({ host: cfg.rconHost, port: cfg.rconPort, password: cfg.rconPassword });
  await harness.connect();
  const ping = await harness.ping();
  if (!ping || ping.pong !== '1') {
    console.log(JSON.stringify({ status: 'BLOCKED', reason: 'harness_ping', ping }));
    process.exit(2);
  }

  const cam = await joinActor(harness, cfg.camName);
  const sub = await joinActor(harness, cfg.subName);
  if (!cam.ok || !sub.ok) {
    console.log(JSON.stringify({ status: 'BLOCKED', reason: 'actor_offline', cam: cam.reason, sub: sub.reason }));
    process.exit(2);
  }
  await harness.raw(`gamemode spectator ${cfg.camName}`);
  await harness.raw(`gamemode survival ${cfg.subName}`);

  const out = {
    status: 'OBSERVED',
    at: new Date().toISOString(),
    host: cfg.rconHost,
    shots: SHOT_LIST,
    scenes: [],
  };

  const scenes = [
    { label: 'open_field', x: cfg.origin.x + cfg.openOffset, z: cfg.origin.z + cfg.openOffset },
    { label: 'village', x: cfg.origin.x, z: cfg.origin.z },
  ];

  for (const scene of scenes) {
    await harness.raw(`gamemode creative ${cfg.subName}`);
    await harness.cap.teleport(cfg.subName, scene.x, cfg.origin.y + 6, scene.z);
    await sleep(1200);
    await harness.raw(`gamemode survival ${cfg.subName}`);
    await sleep(1200);
    const standing = await pos(harness, cfg.subName);
    const legs = [];
    for (const shot of SHOT_LIST) {
      legs.push(await runShot(harness, shot, scene.label));
    }
    out.scenes.push({ scene: scene.label, subjectAt: standing, legs });
  }

  // Tracking case: hold one shot while the subject walks a real route.
  const walkScene = { label: 'tracking_walk' };
  await harness.raw(`gamemode creative ${cfg.subName}`);
  await harness.cap.teleport(cfg.subName, cfg.origin.x + 30, cfg.origin.y + 6, cfg.origin.z);
  await sleep(1200);
  await harness.raw(`gamemode survival ${cfg.subName}`);
  await sleep(1000);
  const from = await pos(harness, cfg.subName);
  const plan = selectShot({ subject: cfg.subName, activity: 'travelling', speed: 4, shotIndex: 0 });
  await harness.cap.act(cfg.camName, 'cam_shot', cfg.subName, ...shotArgs(plan));
  const walkStart = await harness.cap.act(
    cfg.subName,
    'walk_path',
    cfg.origin.x - 20,
    from.y,
    cfg.origin.z,
    1.5,
    4.3
  );
  const tracked = await sampleShot(harness, 12000);
  const camStatus = (await harness.cap.act(cfg.camName, 'cam_status')).data || {};
  const walkStatus = (await harness.cap.act(cfg.subName, 'walk_status')).data || {};
  await harness.cap.act(cfg.subName, 'walk_stop');
  walkScene.shot = plan.shot;
  walkScene.walkPlan = walkStart && walkStart.data;
  walkScene.walkStatus = walkStatus;
  walkScene.subjectTravelled = round(tracked.subMoves.reduce((a, b) => a + b, 0));
  walkScene.camTravelled = round(tracked.camMoves.reduce((a, b) => a + b, 0));
  walkScene.camDisplacementPerSample = stats(tracked.camMoves);
  walkScene.subjectDisplacementPerSample = stats(tracked.subMoves);
  walkScene.camYawStepDegrees = stats(tracked.yawSteps);
  walkScene.framingDistance = stats(tracked.framing);
  walkScene.subjectLost = camStatus.subject_lost;
  walkScene.cuts = camStatus.cuts;
  out.scenes.push(walkScene);

  // Aggregate verdict: a good rig glides (small max jump) and keeps framing stable.
  const shotLegs = out.scenes.flatMap((s) => s.legs || []);
  const jumps = shotLegs.map((l) => l.maxJumpBlocks).filter((v) => Number.isFinite(v));
  out.summary = {
    shotsMeasured: shotLegs.length,
    occludedPct: shotLegs.length
      ? round((shotLegs.filter((l) => l.occluded).length / shotLegs.length) * 100, 1)
      : null,
    repositionedPct: shotLegs.length
      ? round((shotLegs.filter((l) => l.repositioned).length / shotLegs.length) * 100, 1)
      : null,
    maxJumpBlocks: jumps.length ? Math.max(...jumps) : null,
    medianJumpBlocks: jumps.length ? stats(jumps).p50 : null,
    byScene: out.scenes
      .filter((s) => s.legs)
      .map((s) => ({
        scene: s.scene,
        occluded: s.legs.filter((l) => l.occluded).length,
        of: s.legs.length,
      })),
  };

  await harness.cap.act(cfg.camName, 'cam_stop');
  await cam.actor.disconnect();
  await sub.actor.disconnect();
  await harness.raw(`kick ${cfg.camName}`).catch(() => {});
  await harness.raw(`kick ${cfg.subName}`).catch(() => {});
  await harness.close();

  const reports = path.join(__dirname, '..', 'reports');
  fs.mkdirSync(reports, { recursive: true });
  fs.writeFileSync(path.join(reports, 'probe-camera.json'), JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out.summary, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
