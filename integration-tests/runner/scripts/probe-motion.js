#!/usr/bin/env node
/**
 * A/B motion probe against a live Paper server.
 *
 * Compares the legacy per-step RCON walk with the server-side `walk_path` mover on the
 * same route and reports the numbers that decide whether motion actually looks human:
 * wall-clock duration, RCON commands spent, effective speed, and a jerk score
 * (coefficient of variation of per-sample displacement — high means stop/go stutter).
 *
 * Usage:
 *   RCON_HOST=<wsl-ip> RCON_PASSWORD=civsqa node scripts/probe-motion.js
 */
const fs = require('fs');
const path = require('path');
const { Harness } = require('../lib/harness');
const { RawKeepAliveActor } = require('../lib/actor');
const { walkTo } = require('../lib/village/walk');

const cfg = {
  rconHost: process.env.RCON_HOST || '127.0.0.1',
  rconPort: Number.parseInt(process.env.RCON_PORT || '25575', 10),
  rconPassword: process.env.RCON_PASSWORD || 'civsqa',
  mcHost: process.env.MC_HOST || process.env.RCON_HOST || '127.0.0.1',
  mcPort: Number.parseInt(process.env.MC_PORT || '25565', 10),
  name: process.env.PROBE_NAME || 'Probe',
  version: process.env.MC_SERVER_MAJOR || '26.1.2',
  origin: {
    x: Number.parseInt(process.env.VILLAGE_X || '5200', 10),
    y: Number.parseInt(process.env.VILLAGE_Y || '80', 10),
    z: Number.parseInt(process.env.VILLAGE_Z || '5200', 10),
  },
  legRange: Number.parseInt(process.env.PROBE_RANGE || '22', 10),
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function stats(values) {
  if (!values.length) return { n: 0 };
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
  const sorted = [...values].sort((a, b) => a - b);
  return {
    n: values.length,
    mean: Math.round(mean * 1000) / 1000,
    sd: Math.round(Math.sqrt(variance) * 1000) / 1000,
    cv: mean > 0 ? Math.round((Math.sqrt(variance) / mean) * 1000) / 1000 : null,
    p50: sorted[Math.floor(sorted.length * 0.5)],
    max: sorted[sorted.length - 1],
  };
}

/** Poll position while `run()` executes; report displacement smoothness. */
async function sampleWhile(harness, name, run, sampleMs = 200) {
  const samples = [];
  let stop = false;
  const poll = (async () => {
    let prev = null;
    while (!stop) {
      const obs = await harness.cap.observe(name);
      if (obs && obs.success && obs.data) {
        const p = { x: obs.data.x, y: obs.data.y, z: obs.data.z, yaw: obs.data.yaw, at: Date.now() };
        if (prev) {
          const dx = p.x - prev.x;
          const dz = p.z - prev.z;
          samples.push({
            move: Math.sqrt(dx * dx + dz * dz),
            dyaw: Math.abs(((p.yaw - prev.yaw + 540) % 360) - 180),
            dt: p.at - prev.at,
          });
        }
        prev = p;
      }
      await sleep(sampleMs);
    }
  })();
  const t0 = Date.now();
  const result = await run();
  stop = true;
  await poll;
  return { result, durationMs: Date.now() - t0, samples };
}

function motionReport(label, durationMs, samples, extra) {
  const moves = samples.map((s) => s.move);
  const yaws = samples.map((s) => s.dyaw);
  const distance = moves.reduce((a, b) => a + b, 0);
  const stalls = moves.filter((m) => m < 0.05).length;
  return {
    label,
    durationMs,
    distance: Math.round(distance * 100) / 100,
    blocksPerSecond: durationMs > 0 ? Math.round((distance / (durationMs / 1000)) * 100) / 100 : null,
    displacementPerSample: stats(moves),
    yawStepDegrees: stats(yaws),
    stalledSamples: stalls,
    stalledPct: moves.length ? Math.round((stalls / moves.length) * 1000) / 10 : null,
    ...extra,
  };
}

async function main() {
  const harness = new Harness({
    host: cfg.rconHost,
    port: cfg.rconPort,
    password: cfg.rconPassword,
  });
  await harness.connect();
  const ping = await harness.ping();
  if (!ping || ping.pong !== '1') {
    console.log(JSON.stringify({ status: 'BLOCKED', reason: 'harness_ping', ping }));
    process.exit(2);
  }

  const actor = new RawKeepAliveActor({
    host: cfg.mcHost,
    port: cfg.mcPort,
    username: cfg.name,
    version: cfg.version,
    sendCommand: (c) => harness.raw(c),
  });
  await actor.connect();
  if (!actor.available) {
    console.log(JSON.stringify({ status: 'BLOCKED', reason: 'actor_offline', detail: actor.reason }));
    process.exit(2);
  }
  await actor.grantOp();
  await harness.raw(`gamemode creative ${cfg.name}`);
  await harness.cap.teleport(cfg.name, cfg.origin.x, cfg.origin.y + 2, cfg.origin.z);
  await sleep(800);
  await harness.raw(`gamemode survival ${cfg.name}`);
  await sleep(400);

  const out = { status: 'OBSERVED', at: new Date().toISOString(), host: cfg.rconHost, legs: [] };

  // Baseline RCON round-trip cost — the unit of all Node-driven motion.
  const rtt = [];
  for (let i = 0; i < 25; i++) {
    const t = Date.now();
    await harness.cap.observe(cfg.name);
    rtt.push(Date.now() - t);
  }
  out.observeRoundTripMs = stats(rtt);

  const homeObs = await harness.cap.observe(cfg.name);
  const home = { x: homeObs.data.x, y: homeObs.data.y, z: homeObs.data.z };
  out.start = home;
  out.capabilities = {};

  const legacyGoal = { x: home.x + cfg.legRange, y: home.y, z: home.z };
  const pathGoal = { x: home.x, y: home.y, z: home.z + cfg.legRange };

  // Leg A — legacy per-step walk.
  const legacy = await sampleWhile(harness, cfg.name, () =>
    walkTo(harness, cfg.name, legacyGoal, { timeoutMs: 30000, stepLen: 0.45, pauseMs: 140, forceLegacy: true })
  );
  out.legs.push(
    motionReport('legacy_step_walk', legacy.durationMs, legacy.samples, {
      success: !!legacy.result.success,
      reason: legacy.result.reason,
      steps: legacy.result.steps,
      rconCommands: (legacy.result.steps || 0) * 2 + 2,
      recoverTeleport: !!legacy.result.recoverTeleport,
    })
  );

  await harness.cap.teleport(cfg.name, home.x, home.y, home.z);
  await sleep(700);

  // Leg B — server-side path mover.
  const started = await harness.cap.act(cfg.name, 'walk_path', pathGoal.x, pathGoal.y, pathGoal.z, 1.2, 4.3);
  out.capabilities.walk_path = started && started.reason !== 'unknown_action';
  if (!out.capabilities.walk_path) {
    out.legs.push({ label: 'walk_path', status: 'BLOCKED', reason: 'capability_missing', started });
  } else {
    let statusCalls = 0;
    const pathRun = await sampleWhile(harness, cfg.name, async () => {
      const deadline = Date.now() + 30000;
      while (Date.now() < deadline) {
        await sleep(400);
        const st = await harness.cap.act(cfg.name, 'walk_status');
        statusCalls += 1;
        if (!st || !st.data || st.data.done === true || st.data.active === false) return st;
      }
      return { reason: 'probe_timeout' };
    });
    const finalObs = await harness.cap.observe(cfg.name);
    const dx = finalObs.data.x - pathGoal.x;
    const dz = finalObs.data.z - pathGoal.z;
    out.legs.push(
      motionReport('server_walk_path', pathRun.durationMs, pathRun.samples, {
        plan: started.data,
        finalStatus: pathRun.result && pathRun.result.data,
        finalReason: pathRun.result && pathRun.result.reason,
        finalDistance: Math.round(Math.sqrt(dx * dx + dz * dz) * 100) / 100,
        rconCommands: 1 + statusCalls,
      })
    );
  }

  // Line-of-sight capability check (used by the cinematic director).
  const losProbe = await harness.cap.act(cfg.name, 'los', home.x, home.y + 40, home.z);
  out.capabilities.los = !!(losProbe && losProbe.reason !== 'unknown_action');
  out.losSample = losProbe && losProbe.data;

  await harness.cap.act(cfg.name, 'walk_stop');
  await actor.disconnect();
  await harness.raw(`kick ${cfg.name}`).catch(() => {});
  await harness.close();

  const reports = path.join(__dirname, '..', 'reports');
  fs.mkdirSync(reports, { recursive: true });
  fs.writeFileSync(path.join(reports, 'probe-motion.json'), JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
