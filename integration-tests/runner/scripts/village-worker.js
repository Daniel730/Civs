#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { Harness } = require('../lib/harness');
const { RawKeepAliveActor } = require('../lib/actor');
const { SpectatorCamera } = require('../lib/camera');
const {
  nextJob,
  workCoords,
  SITES,
  EXCLUSIVE_PAIRS,
  JOB_CAMERA_MODE,
  stockpileMaterials,
  walkTo,
  blueprintFor,
  cleanupTargets,
  findSurfaceY,
} = require('../lib/village');
const { initTelemetry, shutdownTelemetry } = require('../lib/telemetry');

let FallbackDirector = null;
try {
  ({ FallbackDirector } = require('../lib/stream'));
} catch (_) {
  /* shot-planner optional when stream surface missing */
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
    const s = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    // One-shot: clear place blocks after stockpile profile v2 (inn/barracks/farm)
    if (!s.stockpileV2) {
      for (const t of ['shack', 'potato_farm', 'inn', 'barracks']) {
        delete s.blocked?.[t];
      }
      s.stockpileV2 = true;
      s.failCounts = {};
    }
    // If barracks completed, keep inn blocked (Civs exclusive:inn/barracks)
    if (s.completedPlaces?.barracks) {
      s.blocked = s.blocked || {};
      s.blocked.inn = true;
    }
    if (s.completedPlaces?.inn) {
      s.blocked = s.blocked || {};
      s.blocked.barracks = true;
    }
    return s;
  } catch (_) {
    return {
      tick: 0,
      blocked: {},
      completedPlaces: {},
      actions: 0,
      failCounts: {},
      stockpileV2: true,
    };
  }
}

function saveState(state) {
  fs.mkdirSync(REPORTS, { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Clear head+feet air at an approach tile without cutting the floor. */
async function clearFooting(harness, x, y, z) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const iz = Math.floor(z);
  await harness.raw(`setblock ${ix} ${iy} ${iz} air`);
  await harness.raw(`setblock ${ix} ${iy + 1} ${iz} air`);
}

/** Honest stockpile fills ONLY for Civs placeregion founding (#66 exception). */
async function stockpile(harness, x, y, z, profile) {
  await stockpileMaterials(harness, x, y, z, profile);
}

/**
 * Place one blueprint block via capability. Prefer place_block; setblock only for
 * slabs/paths/fences the capability cannot place — never pre-clear the ground pad.
 */
async function placeAesthetic(harness, actorName, block) {
  const mat = block.material;
  // Paths replace surface; walls/roof need empty air — clear only the target cell if not path
  if (block.role !== 'path') {
    await harness.raw(`setblock ${block.x} ${block.y} ${block.z} air`);
  }
  await harness.cap.giveItem(actorName, mat.toUpperCase(), 8);
  await harness.cap.lookAt(actorName, block.x, block.y, block.z);
  const pl = await harness.cap.placeBlock(actorName, block.x, block.y, block.z, mat);
  if (pl && pl.success) {
    await harness.cap.swing(actorName);
    return { via: 'place_block', ...pl, material: mat, role: block.role };
  }
  await harness.raw(`setblock ${block.x} ${block.y} ${block.z} ${mat}`);
  await harness.cap.swing(actorName);
  return {
    via: 'setblock',
    success: true,
    material: mat,
    role: block.role,
    x: block.x,
    y: block.y,
    z: block.z,
  };
}

/**
 * Execute one visible work tick — survival-like by default (#66).
 */
async function runJob(harness, actorName, step, state) {
  const coords = workCoords(cfg.origin, { ...step, tick: state.tick });
  const cap = harness.cap;
  const results = {
    job: step.job,
    site: step.site || step.label,
    actions: [],
    policy: 'playerlike_v1',
  };

  // Creative ONLY for Civs founding stockpile (build-reqs). All other jobs: survival.
  const founding = step.job === 'placeregion';
  await harness.raw(`gamemode ${founding ? 'creative' : 'survival'} ${actorName}`);

  if (step.job === 'placeregion') {
    const px = cfg.origin.x + (step.dx || 0);
    const pz = cfg.origin.z + (step.dz || 0);
    const py = cfg.origin.y;
    // Founding exception: stockpile fill then placeregion (documented in VILLAGE-AESTHETICS).
    await stockpile(harness, px, py, pz, step.stockpile || 'utility');
    const walk = await walkTo(
      harness,
      actorName,
      { x: px + 1, y: py + 1, z: pz + 1 },
      { clearFooting: (x, y, z) => clearFooting(harness, x, y, z), timeoutMs: 12000 }
    );
    results.actions.push({ walk });
    await cap.lookAt(actorName, px, py + 1, pz);
    await cap.swing(actorName);
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
      cheat: 'stockpile_fill_for_civs_founding',
    });
    await harness.raw(`gamemode survival ${actorName}`);
    if (ok) {
      state.completedPlaces[step.type] = true;
      const exclusiveOther = EXCLUSIVE_PAIRS[step.type];
      if (exclusiveOther) {
        state.blocked[exclusiveOther] = true;
        results.exclusiveBlocked = exclusiveOther;
      }
      results.status = 'PASS';
    } else {
      state.failCounts = state.failCounts || {};
      state.failCounts[step.type] = (state.failCounts[step.type] || 0) + 1;
      if (state.failCounts[step.type] >= 3) {
        state.blocked[step.type] = true;
      }
      results.status = 'BLOCKED';
      results.reason = 'placeregion_failed_build_reqs_or_overlap';
      results.failCount = state.failCounts[step.type];
    }
    return results;
  }

  // Adapt stands to natural surface (no floating platforms).
  const standX = coords.stand.x;
  const standZ = coords.stand.z;
  const groundY = await findSurfaceY(harness, standX, standZ, {
    fallbackY: cfg.origin.y,
    maxY: cfg.origin.y + 24,
    minY: cfg.origin.y - 24,
  });
  const stand = { x: standX, y: groundY + 1, z: standZ };
  results.groundY = groundY;

  const walk = await walkTo(harness, actorName, stand, {
    clearFooting: (x, y, z) => clearFooting(harness, x, y, z),
    timeoutMs: 14000,
    stepLen: 0.45,
    pauseMs: 140,
  });
  results.actions.push({
    walk: {
      success: walk.success,
      steps: walk.steps,
      final_distance: walk.final_distance,
      recoverTeleport: walk.recoverTeleport,
      navigator: walk.navigator,
      reason: walk.reason,
    },
  });

  if (coords.target) {
    const look = await cap.lookAt(actorName, coords.target.x, groundY + 1, coords.target.z);
    results.actions.push({ look });
  }

  if (step.job === 'miner' || step.job === 'builder' || step.job === 'beautify') {
    await cap.giveItem(actorName, 'STONE_PICKAXE', 1);
    await cap.hotbar(actorName, 0);
  }
  if (step.job === 'farmer') {
    await cap.giveItem(actorName, 'IRON_HOE', 1);
    await cap.hotbar(actorName, 0);
  }
  if (step.job === 'lumberjack') {
    await cap.giveItem(actorName, 'IRON_AXE', 1);
    await cap.hotbar(actorName, 0);
  }
  if (step.job === 'guard') {
    await cap.giveItem(actorName, 'IRON_SWORD', 1);
    await cap.hotbar(actorName, 0);
  }

  // Mine / chop existing terrain only — never spawn a block then break it (#66).
  if (step.job === 'miner') {
    const digX = Math.floor(cfg.origin.x + (step.dx || 0) + 5);
    const digZ = Math.floor(cfg.origin.z + (step.dz || 0) + 5);
    const digY = await findSurfaceY(harness, digX, digZ, {
      fallbackY: groundY,
      maxY: groundY + 8,
      minY: groundY - 8,
    });
    const br = await cap.breakBlock(actorName, digX, digY, digZ);
    results.actions.push({ breakBlock: br, spawned: false });
    await cap.swing(actorName);
  } else if (step.job === 'lumberjack') {
    const digX = Math.floor(cfg.origin.x + (step.dx || 0) + 5);
    const digZ = Math.floor(cfg.origin.z + (step.dz || 0) + 4);
    // Prefer a block above surface (log/leaves) if present; else surface
    let digY = groundY + 1;
    const br = await cap.breakBlock(actorName, digX, digY, digZ);
    if (!br || !br.success) {
      digY = await findSurfaceY(harness, digX, digZ, {
        fallbackY: groundY,
        maxY: groundY + 12,
        minY: groundY - 4,
      });
      const br2 = await cap.breakBlock(actorName, digX, digY, digZ);
      results.actions.push({ breakBlock: br2, spawned: false });
    } else {
      results.actions.push({ breakBlock: br, spawned: false });
    }
    await cap.swing(actorName);
  }

  // Beautify: tear platform junk + restore grass (no new pads).
  if (step.job === 'beautify' || coords.cleanup) {
    const targets = cleanupTargets(cfg.origin, {
      ...step,
      tick: state.tick,
      groundY,
    });
    const cleaned = [];
    for (const t of targets) {
      if (t.action === 'break') {
        const br = await cap.breakBlock(actorName, t.x, t.y, t.z);
        if (!br || !br.success) {
          await harness.raw(`setblock ${t.x} ${t.y} ${t.z} air`);
        }
        cleaned.push({ ...t, ok: true });
      } else if (t.action === 'set_grass') {
        await harness.raw(`setblock ${t.x} ${t.y} ${t.z} grass_block`);
        cleaned.push({ ...t, ok: true });
      }
    }
    await cap.swing(actorName);
    results.actions.push({ beautify: true, cleaned: cleaned.length, sample: cleaned.slice(0, 4) });
  }

  // Builder / farmer: terrain-adapted blueprints (no floor platforms).
  if (step.job === 'builder' || step.job === 'farmer' || coords.blueprint) {
    const bp = blueprintFor(cfg.origin, { ...step, tick: state.tick, groundY });
    const placed = [];
    for (const block of bp.blocks) {
      const near = {
        x: block.x,
        y: Math.max(block.y, groundY + 1),
        z: block.z + (block.role === 'path' ? 0 : 1),
      };
      const w2 = await walkTo(harness, actorName, near, {
        arrive: 2.5,
        timeoutMs: 8000,
        stepLen: 0.45,
        pauseMs: 100,
      });
      results.actions.push({
        walkBlock: { steps: w2.steps, success: w2.success, recoverTeleport: w2.recoverTeleport },
      });
      const pr = await placeAesthetic(harness, actorName, block);
      placed.push(pr);
    }
    results.actions.push({
      blueprint: bp.id,
      placed: placed.length,
      materials: [...new Set(placed.map((p) => p.material))],
    });
  }

  if (step.job === 'patrol' || step.job === 'guard') {
    await cap.sprint(actorName, true);
    for (let i = 0; i < 3; i++) {
      await cap.step(actorName, 'forward', 0.5);
      await sleep(120);
    }
    await cap.swing(actorName);
    if (step.job === 'guard') {
      await cap.lookAt(actorName, cfg.origin.x, groundY + 1, cfg.origin.z);
      await cap.swing(actorName);
    }
    await cap.sprint(actorName, false);
  }

  const obs = await cap.observe(actorName);
  results.observe =
    obs && obs.data ? { x: obs.data.x, y: obs.data.y, z: obs.data.z, held: obs.data.held } : null;
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
  // Spawn-in: brief creative only to land safely, then survival for player-like work.
  await harness.raw(`gamemode creative ${name}`);
  await actor.teleport(cfg.origin.x, cfg.origin.y + 2, cfg.origin.z);
  await harness.raw(`gamemode survival ${name}`);
  return { actor, ok: true };
}

/** Recover council_room + town if overnight damage wiped the center. */
async function ensureTown(harness, actorName) {
  const town = await harness.assert.town(cfg.town);
  if (town && town.ok) return { status: 'PASS', town };
  const { x, y, z } = cfg.origin;
  await harness.raw(`gamemode creative ${actorName}`);
  await stockpile(harness, x, y, z, 'utility');
  // Bookshelves required by council_room build-reqs
  for (const [bx, by, bz] of [
    [-3, 1, 1],
    [-3, 1, 2],
    [-3, 2, 1],
    [-3, 2, 2],
    [-2, 1, 2],
    [-2, 2, 2],
    [-1, 1, 2],
    [-1, 2, 2],
  ]) {
    await harness.raw(`setblock ${x + bx} ${y + by} ${z + bz} bookshelf`);
  }
  await harness.raw(`setblock ${x} ${y} ${z} grass_block`);
  await harness.raw(`setblock ${x} ${y + 1} ${z} air`);
  const place = await harness.raw(`cv placeregion ${actorName} council_room ${x} ${y} ${z}`);
  await harness.raw(`clear ${actorName}`);
  await harness.raw(`cv give ${actorName} settlement 1`);
  await harness.raw(`tp ${actorName} ${x + 2} ${y + 1} ${z + 2}`);
  await harness.cap.hotbar(actorName, 0);
  await harness.raw(
    `item replace entity ${actorName} weapon.mainhand from entity ${actorName} container.0`
  );
  await harness.cap.runAs(actorName, `cv town ${cfg.town}`);
  await sleep(400);
  await harness.raw(`gamemode survival ${actorName}`);
  const again = await harness.assert.town(cfg.town);
  return {
    status: again && again.ok ? 'PASS' : 'FAIL',
    place: String(place || '').slice(0, 160),
    town: again,
    cheat: 'ensure_town_stockpile_fill',
  };
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
      if ((!town || !town.ok) && state.tick % 12 === 1) {
        const recovery = await ensureTown(harness, cfg.actorName);
        log({ status: recovery.status, action: 'ensure_town', recovery });
      }
      const step = nextJob(state.tick, state);
      const who = helper && helper.ok && state.tick % 2 === 0 ? cfg.helperName : cfg.actorName;
      const result = await runJob(harness, who, step, state);
      if (director && result.status === 'PASS') {
        const mode = JOB_CAMERA_MODE[step.job] || 'event';
        await director.onEvent({
          x: cfg.origin.x + (step.dx || 0),
          y: cfg.origin.y + 2,
          z: cfg.origin.z + (step.dz || 0),
          mode,
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
