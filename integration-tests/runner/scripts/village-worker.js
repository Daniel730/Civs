#!/usr/bin/env node
/**
 * Overnight NPC village WORKER — visible work via harness capabilities.
 * Architecture: runner → RawKeepAliveActor + Capabilities + RCON → Paper QA.
 * No Mineflayer. Agent decides WHAT (jobs); harness executes HOW.
 *
 * Usage (WSL):
 *   RCON_PASSWORD=civsqa node scripts/village-worker.js
 *   RCON_PASSWORD=civsqa WORKER_MS=4000 node scripts/village-worker.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { Harness } = require('../lib/harness');
const { RawKeepAliveActor } = require('../lib/actor');
const { SpectatorCamera } = require('../lib/camera');
const { nextJob, workCoords, SITES } = require('../lib/village/jobs');
const { initTelemetry, shutdownTelemetry } = require('../lib/telemetry');

let FallbackDirector = null;
try {
  ({ FallbackDirector } = require('../lib/stream'));
} catch (_) {
  /* shot-planner optional when stream PR not on branch */
}

const REPORTS = path.join(__dirname, '..', 'reports');
const LOG_JSONL = path.join(REPORTS, 'village-worker.jsonl');
const STATE_FILE = path.join(REPORTS, 'village-worker-state.json');

const cfg = {
  rconHost: process.env.RCON_HOST || '127.0.0.1',
  rconPort: Number.parseInt(process.env.RCON_PORT || '25575', 10),
  rconPassword: process.env.RCON_PASSWORD || 'civsqa',
  mcHost: process.env.MC_HOST || '127.0.0.1',
  mcPort: Number.parseInt(process.env.MC_PORT || '25565', 10),
  actorName: process.env.ACTOR_NAME || 'Steve',
  helperName: process.env.HELPER_NAME || 'Alex',
  cameraName: process.env.CAMERA_NAME || 'Cam',
  version: process.env.MC_SERVER_MAJOR || '26.1.2',
  town: process.env.VILLAGE_TOWN || 'NpcPad',
  origin: {
    x: Number.parseInt(process.env.VILLAGE_X || '5200', 10),
    y: Number.parseInt(process.env.VILLAGE_Y || '80', 10),
    z: Number.parseInt(process.env.VILLAGE_Z || '5200', 10),
  },
  intervalMs: Number.parseInt(process.env.WORKER_MS || '6000', 10),
  enableHelper: process.env.ENABLE_HELPER === '1',
};

function log(entry) {
  fs.mkdirSync(REPORTS, { recursive: true });
  const row = { ts: new Date().toISOString(), ...entry };
  fs.appendFileSync(LOG_JSONL, `${JSON.stringify(row)}\n`);
  console.log(JSON.stringify(row));
}

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch (_) {
    return { tick: 0, blocked: {}, completedPlaces: {}, actions: 0 };
  }
}

function saveState(state) {
  fs.mkdirSync(REPORTS, { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Honest stockpile fills for placeregion retries (same materials family as builder). */
async function stockpile(harness, x, y, z, profile) {
  const r = profile === 'farm' ? 4 : 4;
  const cmds = [
    `fill ${x - r} ${y + 1} ${z - r} ${x + r} ${y + 7} ${z + r} air`,
    `fill ${x - r} ${y} ${z - r} ${x + r} ${y + 3} ${z + r} stone_bricks`,
    `fill ${x - r} ${y} ${z - r} ${x + r} ${y} ${z + r} cobblestone`,
    `fill ${x - Math.max(1, r - 1)} ${y + 1} ${z - Math.max(1, r - 1)} ${x + Math.max(1, r - 1)} ${y + 2} ${z + Math.max(1, r - 1)} oak_log`,
    `fill ${x - r} ${y + 4} ${z - r} ${x + r} ${y + 4} ${z + r} oak_stairs`,
    `fill ${x - Math.max(1, r - 2)} ${y + 1} ${z - Math.max(1, r - 2)} ${x + Math.max(1, r - 2)} ${y + 3} ${z + Math.max(1, r - 2)} air`,
    `setblock ${x + 1} ${y + 1} ${z} chest`,
    `setblock ${x + 2} ${y + 1} ${z} chest`,
    `setblock ${x - 1} ${y + 1} ${z} chest`,
    `setblock ${x} ${y + 1} ${z + 1} oak_door[half=lower]`,
    `setblock ${x} ${y + 2} ${z + 1} oak_door[half=upper]`,
    `setblock ${x + 1} ${y + 2} ${z + 2} glass`,
    `setblock ${x - 1} ${y + 2} ${z + 2} glass`,
    `setblock ${x + 1} ${y + 2} ${z - 2} glass`,
    `setblock ${x - 1} ${y + 2} ${z - 2} glass`,
    `setblock ${x + 2} ${y + 1} ${z} furnace`,
    `setblock ${x - 2} ${y + 1} ${z} crafting_table`,
    `setblock ${x} ${y} ${z} grass_block`,
    `setblock ${x} ${y + 1} ${z} air`,
  ];
  if (profile === 'farm') {
    cmds.push(
      `fill ${x - 3} ${y} ${z - 4} ${x + 3} ${y} ${z - 2} farmland`,
      `fill ${x - 3} ${y + 1} ${z - 4} ${x + 3} ${y + 1} ${z - 2} potatoes[age=7]`,
      `setblock ${x} ${y} ${z - 3} water`,
      `setblock ${x + 2} ${y + 1} ${z} composter`,
      `fill ${x - 4} ${y + 1} ${z - 4} ${x + 4} ${y + 1} ${z - 4} oak_fence`,
      `setblock ${x} ${y + 1} ${z - 4} oak_fence_gate`
    );
  }
  if (profile === 'hovel') {
    cmds.push(
      `setblock ${x + 1} ${y + 1} ${z + 3} red_bed`,
      `setblock ${x - 1} ${y + 1} ${z + 3} yellow_bed`
    );
  }
  if (profile === 'utility') {
    cmds.push(
      `fill ${x - 3} ${y + 1} ${z - 3} ${x + 3} ${y + 1} ${z - 3} iron_bars`,
      `setblock ${x + 3} ${y + 1} ${z + 1} black_bed`,
      `setblock ${x + 3} ${y + 1} ${z - 1} red_bed`,
      `setblock ${x - 3} ${y + 1} ${z + 1} black_bed`
    );
  }
  for (const c of cmds) {
    await harness.raw(c);
  }
}

/**
 * Execute one visible work tick using only existing capabilities.
 */
async function runJob(harness, actorName, step, state) {
  const coords = workCoords(cfg.origin, { ...step, tick: state.tick });
  const cap = harness.cap;
  const results = { job: step.job, site: step.site || step.label, actions: [] };

  await harness.raw(`gamemode creative ${actorName}`);

  if (step.job === 'placeregion') {
    const px = cfg.origin.x + (step.dx || 0);
    const pz = cfg.origin.z + (step.dz || 0);
    const py = cfg.origin.y;
    await stockpile(harness, px, py, pz, step.stockpile || 'utility');
    await cap.moveTo(actorName, px + 1, py + 1, pz + 1, 8000, 2.0, 0.9);
    await cap.lookAt(actorName, px, py + 1, pz);
    await cap.swing(actorName);
    // Official harness path (same as village-builder / RawKeepAliveActor.placeRegion)
    const placeReply = await harness.raw(
      `cv placeregion ${actorName} ${step.type} ${px} ${py} ${pz}`
    );
    await sleep(600);
    const after = await harness.region.at(px, py, pz);
    const ok =
      String(placeReply || '').includes('placeregion OK') ||
      (after && after.type && String(after.type).toLowerCase() === step.type);
    results.actions.push({
      placeReply: String(placeReply || '').slice(0, 240),
      after,
      ok,
    });
    if (ok) {
      state.completedPlaces[step.type] = true;
      results.status = 'PASS';
    } else {
      state.blocked[step.type] = true;
      results.status = 'BLOCKED';
      results.reason = 'placeregion_failed_build_reqs_or_overlap';
    }
    return results;
  }

  // Teleport near the site first so move_to can finish a short walk (avoids no_progress).
  const stand = coords.stand;
  await cap.teleport(actorName, stand.x - 2, cfg.origin.y + 1, stand.z - 2);
  const move = await cap.moveTo(
    actorName,
    stand.x,
    stand.y,
    stand.z,
    7000,
    1.8,
    0.85
  );
  results.actions.push({ move });

  if (coords.target) {
    const look = await cap.lookAt(
      actorName,
      coords.target.x,
      coords.target.y,
      coords.target.z
    );
    results.actions.push({ look });
  }

  if (step.job === 'miner' || step.job === 'builder') {
    await cap.giveItem(actorName, 'STONE_PICKAXE', 1);
    await cap.hotbar(actorName, 0);
  }
  if (step.job === 'farmer') {
    await cap.giveItem(actorName, 'IRON_HOE', 1);
    await cap.hotbar(actorName, 0);
  }

  // Break then place where allowed (creative QA pad — visible progress)
  if (coords.target && (step.job === 'miner' || step.job === 'builder' || step.job === 'farmer')) {
    const br = await cap.breakBlock(
      actorName,
      Math.floor(coords.target.x),
      Math.floor(coords.target.y),
      Math.floor(coords.target.z)
    );
    results.actions.push({ breakBlock: br });
    await cap.swing(actorName);
  }

  if (coords.place && step.job !== 'patrol') {
    const mat = coords.place.material || 'stone_bricks';
    await cap.giveItem(actorName, mat.toUpperCase(), 16);
    const pl = await cap.placeBlock(
      actorName,
      Math.floor(coords.place.x),
      Math.floor(coords.place.y),
      Math.floor(coords.place.z),
      mat
    );
    results.actions.push({ placeBlock: pl });
    await cap.swing(actorName);
    await cap.jump(actorName);
  }

  if (step.job === 'stockpile') {
    const sx = cfg.origin.x + (step.dx || 0);
    const sz = cfg.origin.z + (step.dz || 0);
    await stockpile(harness, sx, cfg.origin.y, sz, 'utility');
    results.actions.push({ stockpile: true, x: sx, z: sz });
  }

  if (step.job === 'patrol') {
    await cap.sprint(actorName, true);
    await cap.step(actorName, 'forward', 1.2);
    await cap.swing(actorName);
    await cap.sprint(actorName, false);
  }

  const obs = await cap.observe(actorName);
  results.observe = obs && obs.data
    ? { x: obs.data.x, y: obs.data.y, z: obs.data.z, held: obs.data.held }
    : null;
  results.status = 'PASS';
  state.actions += 1;
  return results;
}

async function connectActor(harness, name) {
  const actor = new RawKeepAliveActor({
    host: cfg.mcHost,
    port: cfg.mcPort,
    username: name,
    version: cfg.version,
    sendCommand: (c) => harness.raw(c),
  });
  await actor.connect();
  if (!actor.available) {
    return { actor, ok: false, reason: actor.reason };
  }
  await actor.grantOp();
  await harness.raw(`gamemode creative ${name}`);
  await actor.teleport(cfg.origin.x, cfg.origin.y + 2, cfg.origin.z);
  return { actor, ok: true };
}

async function main() {
  initTelemetry({ serviceName: 'civs-village-worker' });
  fs.mkdirSync(REPORTS, { recursive: true });
  const state = loadState();

  const harness = new Harness({
    host: cfg.rconHost,
    port: cfg.rconPort,
    password: cfg.rconPassword,
  });
  await harness.connect();
  const ping = await harness.ping();
  if (!ping || ping.pong !== '1') {
    log({ status: 'BLOCKED', action: 'ping', ping });
    process.exit(2);
  }
  log({ status: 'PASS', action: 'ping', ping });

  const primary = await connectActor(harness, cfg.actorName);
  if (!primary.ok) {
    log({ status: 'BLOCKED', action: 'actor_connect', reason: primary.reason });
    process.exit(2);
  }
  log({ status: 'PASS', action: 'actor_online', player: cfg.actorName });

  let helper = null;
  if (cfg.enableHelper) {
    helper = await connectActor(harness, cfg.helperName);
    log({
      status: helper.ok ? 'PASS' : 'DEGRADED',
      action: 'helper_connect',
      player: cfg.helperName,
      reason: helper.reason,
    });
  }

  const camera = new SpectatorCamera({
    harness,
    host: cfg.mcHost,
    port: cfg.mcPort,
    name: cfg.cameraName,
    version: cfg.version,
    targetName: cfg.actorName,
  });
  const camStart = await camera.start();
  log({ status: camStart.status, action: 'camera_start', ...camStart });

  const getTargetPos = async () => {
    const obs = await harness.cap.observe(cfg.actorName);
    if (obs && obs.success && obs.data) {
      return {
        x: obs.data.x ?? obs.data.loc_x,
        y: obs.data.y ?? obs.data.loc_y,
        z: obs.data.z ?? obs.data.loc_z,
      };
    }
    return { x: cfg.origin.x, y: cfg.origin.y, z: cfg.origin.z };
  };

  let director = null;
  if (FallbackDirector) {
    director = new FallbackDirector({
      camera,
      getTargetPos,
      intervalMs: Math.min(2500, cfg.intervalMs),
    });
    director.start();
    log({ status: 'PASS', action: 'director_start', sites: Object.keys(SITES) });
  } else {
    process.env.FORCE_ORBIT = process.env.FORCE_ORBIT || '1';
    camera.startLoop(getTargetPos, Math.min(2500, cfg.intervalMs));
    log({ status: 'PASS', action: 'camera_orbit_loop', sites: Object.keys(SITES) });
  }

  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    state.tick += 1;
    try {
      const town = await harness.assert.town(cfg.town);
      const step = nextJob(state.tick, state);
      const who =
        helper && helper.ok && state.tick % 2 === 0 ? cfg.helperName : cfg.actorName;
      const result = await runJob(harness, who, step, state);
      if (director && result.status === 'PASS' && step.job !== 'patrol') {
        await director.onEvent({
          x: cfg.origin.x + (step.dx || 0),
          y: cfg.origin.y + 2,
          z: cfg.origin.z + (step.dz || 0),
          mode: 'event',
        });
      }
      log({
        status: result.status,
        action: 'work_tick',
        tick: state.tick,
        worker: who,
        town,
        step,
        result,
        watch: 'launch-viewer.ps1 → spectate Cam @ WSL IP:25565',
      });
      saveState(state);
    } catch (e) {
      log({ status: 'FAIL', action: 'work_tick', reason: String(e.message || e) });
    } finally {
      busy = false;
    }
  };

  await tick();
  const timer = setInterval(tick, cfg.intervalMs);

  const shutdown = async () => {
    clearInterval(timer);
    if (director) director.stop();
    camera.stopLoop();
    await camera.stop();
    await primary.actor.disconnect();
    if (helper && helper.ok) await helper.actor.disconnect();
    await harness.close();
    await shutdownTelemetry();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch(async (e) => {
  console.error(e);
  log({ status: 'FAIL', action: 'fatal', reason: String(e.message || e) });
  try {
    await shutdownTelemetry();
  } catch (_) {}
  process.exit(1);
});
