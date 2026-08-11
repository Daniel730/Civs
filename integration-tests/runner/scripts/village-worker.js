#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { Harness } = require('../lib/harness');
const { RawKeepAliveActor } = require('../lib/actor');
const { SpectatorCamera } = require('../lib/camera');
const { CinematicDirector, ObservationDirector, ViewerFollowLoop } = require('../lib/observation');
const {
  nextJob,
  workCoords,
  SITES,
  EXCLUSIVE_PAIRS,
  stockpileMaterials,
  walkTo,
  cleanupTargets,
  findSurfaceY,
  chooseFocus,
  biasJob,
  construction,
} = require('../lib/village');
const { SurvivalMonitor, executeSurvival } = require('../lib/survival');
const { IntentionCache, AntiStall } = require('../lib/ai-world/intention-cache');
const { initTelemetry, shutdownTelemetry } = require('../lib/telemetry');
const {
  METRIC,
  initMetrics,
  observeMetric,
  metricsSnapshot,
} = require('../lib/metrics');

const REPORTS = path.join(__dirname, '..', 'reports');
const LOG_JSONL = path.join(REPORTS, 'village-worker.jsonl');
const STATE_FILE = path.join(REPORTS, 'village-worker-state.json');
const MEMORY_PATH = path.join(REPORTS, 'construction-memory.json');

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
  viewerName: process.env.VIEWER_NAME || 'Viewer',
  camDwellMs: Number.parseInt(process.env.CAM_DWELL_MS || '20000', 10),
  viewerFollowMs: Number.parseInt(process.env.VIEWER_FOLLOW_MS || '2500', 10),
  enableViewerFollow: process.env.ENABLE_VIEWER_FOLLOW !== '0',
  // Cinematic director is the default; CAM_LEGACY=1 falls back to ObservationDirector.
  legacyCamera: process.env.CAM_LEGACY === '1',
  camMinDwellMs: Number.parseInt(process.env.CAM_MIN_DWELL_MS || '7000', 10),
  camMaxDwellMs: Number.parseInt(process.env.CAM_MAX_DWELL_MS || '32000', 10),
  camTickMs: Number.parseInt(process.env.CAM_TICK_MS || '1500', 10),
  // How far an agent may stray from the village before it is considered stranded.
  leashRadius: Number.parseInt(process.env.VILLAGE_LEASH || '150', 10),
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
 * Protocol bots can die and stay as corpses (health 0) without client respawn UI.
 * Dead agents look "invisible"/unresponsive to Cam — recover before work.
 */
async function ensureAlive(harness, actorName, preObserved) {
  let obs = preObserved || (await harness.cap.observe(actorName));
  const health = obs && obs.data ? Number(obs.data.health) : Number.NaN;
  if (obs && obs.success && health > 0) {
    return { status: 'PASS', action: 'ensure_alive', player: actorName, health, revived: false };
  }
  const respawn = await harness.cap.respawn(actorName);
  await harness.raw(`gamemode survival ${actorName}`);
  await harness.cap.teleport(actorName, cfg.origin.x, cfg.origin.y + 2, cfg.origin.z);
  obs = await harness.cap.observe(actorName);
  const healthAfter = obs && obs.data ? Number(obs.data.health) : Number.NaN;
  return {
    status: healthAfter > 0 ? 'PASS' : 'FAIL',
    action: 'ensure_alive',
    player: actorName,
    health: healthAfter,
    revived: true,
    priorHealth: health,
    respawn,
    position: obs && obs.data ? { x: obs.data.x, y: obs.data.y, z: obs.data.z } : null,
  };
}

/**
 * Execute one visible work tick — survival-like by default (#66).
 */
async function runJob(harness, actorName, step, state, ctx = {}) {
  const alive = await ensureAlive(harness, actorName, ctx.observed);
  if (alive.revived) {
    log({ ...alive });
  }
  const coords = workCoords(cfg.origin, { ...step, tick: state.tick });
  const cap = harness.cap;
  const results = {
    job: step.job,
    site: step.site || step.label,
    actions: [],
    policy: 'playerlike_v1',
    alive,
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

  // Builder / farmer: construction quality pipeline on natural terrain (playerlike_v1).
  // Never places arbitrary blocks; pauses leave PROJECT_PAUSED in worker state.
  if (step.job === 'builder' || step.job === 'farmer' || coords.blueprint) {
    const paused = state.construction && state.construction.status === 'PROJECT_PAUSED';
    const supportAt = async (x, y, z) => {
      const below = await harness.block.at(x, y - 1, z);
      const m = String(below || 'AIR').toUpperCase();
      return (
        m !== 'AIR' &&
        m !== 'CAVE_AIR' &&
        m !== 'VOID_AIR' &&
        !m.includes('WATER') &&
        !m.includes('LAVA')
      );
    };

    // Keep the same plan across incremental ticks (don't flip path↔house mid-project).
    const resumeTick =
      paused && state.construction.planTick != null ? state.construction.planTick : state.tick;

    const placeFn = async (block, tx) => {
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
      const oldBlock = await harness.block.at(block.x, block.y, block.z);
      const pr = await placeAesthetic(harness, actorName, block);
      await tx.setBlock({
        x: block.x,
        y: block.y,
        z: block.z,
        newBlock: block.material,
        oldBlock: oldBlock || 'AIR',
        reason: `role:${block.role}:${pr.via || 'place'}`,
        apply: false,
      });
    };

    const project = await construction.runProject({
      harness,
      origin: cfg.origin,
      step: { ...step, tick: resumeTick },
      actorName,
      memoryPath: MEMORY_PATH,
      persistMemory: true,
      maxBlocks: 10,
      startIndex: paused ? state.construction.nextIndex || 0 : 0,
      projectId: paused ? state.construction.projectId : undefined,
      priorLog: paused ? state.construction.log || [] : undefined,
      supportAt,
      skipSiteSelection: true,
      placeFn,
      settlementContext: {
        nearbyBuildings: Object.keys(state.completedPlaces || {}).length,
        roadConnected: true,
      },
      shouldPause: () => state._interruptConstruction === true,
    });

    if (project.status === 'PROJECT_PAUSED') {
      state.construction = {
        status: 'PROJECT_PAUSED',
        projectId: project.tx && project.tx.projectId,
        nextIndex: project.nextIndex,
        purpose: project.blueprint && project.blueprint.purpose,
        planTick: resumeTick,
        log: project.tx ? project.tx.log : [],
      };
      results.status = project.incremental ? 'PASS' : 'PAUSED';
      results.actions.push({
        construction: {
          status: project.status,
          incremental: !!project.incremental,
          stages: (project.stages || []).map((s) => s.stage),
          nextIndex: project.nextIndex,
          placed: project.build && project.build.placed && project.build.placed.length,
        },
      });
      return results;
    }

    if (project.ok) {
      state.construction = { status: 'COMMITTED', projectId: project.tx && project.tx.projectId };
      results.actions.push({
        construction: {
          status: project.status,
          blueprint: project.blueprint && project.blueprint.id,
          purpose: project.blueprint && project.blueprint.purpose,
          placed: project.build && project.build.placed && project.build.placed.length,
          score: project.inspection && project.inspection.score,
        },
      });
    } else {
      state.construction = {
        status: project.status || 'PROJECT_ABORTED',
        reason: project.reason || (project.resolution && project.resolution.reason),
      };
      results.status = project.status === 'PROJECT_ABORTED' ? 'BLOCKED' : results.status;
      results.actions.push({
        construction: {
          status: project.status,
          reason: project.reason,
          stages: (project.stages || []).map((s) => ({ stage: s.stage, ok: s.ok })),
        },
      });
    }
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

async function connectActor(harness, name, attempt = 1) {
  const actor = new RawKeepAliveActor({
    host: cfg.mcHost,
    port: cfg.mcPort,
    username: name,
    version: cfg.version,
    sendCommand: (c) => harness.raw(c),
  });
  await actor.connect();
  if (!actor.available) {
    if (attempt < 3) {
      await sleep(2000 * attempt);
      return connectActor(harness, name, attempt + 1);
    }
    return { actor, ok: false, reason: actor.reason };
  }
  await actor.grantOp();
  // Spawn-in: brief creative only to land safely, then survival for player-like work.
  await harness.raw(`gamemode creative ${name}`);
  await actor.teleport(cfg.origin.x, cfg.origin.y + 2, cfg.origin.z);
  await harness.raw(`gamemode survival ${name}`);
  const alive = await ensureAlive(harness, name);
  return { actor, ok: true, alive };
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

/** Countable evidence that a work tick actually moved the world forward. */
function meaningfulProgress(result) {
  if (!result) return 0;
  let score = 0;
  if (result.status === 'PASS') score += 1;
  for (const entry of result.actions || []) {
    const walk = entry.walk || entry.walkBlock;
    if (walk && walk.success && !walk.recoverTeleport) score += 1;
    if (entry.breakBlock && entry.breakBlock.success) score += 1;
    if (entry.beautify && entry.cleaned) score += Math.min(3, entry.cleaned);
    if (entry.construction && entry.construction.placed) score += entry.construction.placed;
    if (entry.ok === true) score += 2;
  }
  return score;
}

async function main() {
  initTelemetry({ serviceName: 'civs-village-worker' });
  initMetrics({ serviceName: 'civs-village-worker' });
  fs.mkdirSync(REPORTS, { recursive: true });
  const state = loadState();
  state.progress = Number.isFinite(state.progress) ? state.progress : 0;

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
    await sleep(2500);
    helper = await connectActor(harness, cfg.helperName);
    log({
      status: helper.ok ? 'PASS' : 'DEGRADED',
      action: 'helper_connect',
      player: cfg.helperName,
      reason: helper.reason,
    });
  }

  await sleep(2500);
  const camera = new SpectatorCamera({
    harness,
    host: cfg.mcHost,
    port: cfg.mcPort,
    name: cfg.cameraName,
    version: cfg.version,
    targetName: cfg.actorName,
  });
  let camStart = await camera.start();
  if (camStart.status !== 'PASS') {
    await sleep(3000);
    camStart = await camera.start();
  }
  log({ status: camStart.status, action: 'camera_start', ...camStart });
  if (camStart.status !== 'PASS') {
    log({
      status: 'BLOCKED',
      action: 'camera_required',
      reason: camStart.reason || 'camera_start_failed',
    });
    process.exit(3);
  }

  const subjects = [cfg.actorName];
  if (helper && helper.ok) subjects.push(cfg.helperName);

  const observation = cfg.legacyCamera
    ? new ObservationDirector({
        camera,
        harness,
        subjects,
        dwellMs: cfg.camDwellMs,
        tickMs: Math.min(2000, cfg.intervalMs),
        onLog: (entry) => log(entry),
        forceTarget: process.env.CAM_FORCE_TARGET || null,
      })
    : new CinematicDirector({
        camera,
        harness,
        subjects,
        tickMs: cfg.camTickMs,
        minDwellMs: cfg.camMinDwellMs,
        preferredDwellMs: cfg.camDwellMs,
        maxDwellMs: cfg.camMaxDwellMs,
        fallbackOrigin: cfg.origin,
        onLog: (entry) => log(entry),
        forceTarget: process.env.CAM_FORCE_TARGET || null,
      });
  observation.start();
  log({
    status: 'PASS',
    action: 'observation_director_start',
    director: cfg.legacyCamera ? 'ObservationDirector' : 'CinematicDirector',
    subjects,
    dwellMs: cfg.camDwellMs,
    minDwellMs: cfg.camMinDwellMs,
    maxDwellMs: cfg.camMaxDwellMs,
  });

  // Survival, intention and stall detection are per-agent.
  const survival = new Map();
  for (const name of subjects) {
    survival.set(
      name,
      new SurvivalMonitor({ actor: name, workOrigin: cfg.origin, leashRadius: cfg.leashRadius })
    );
  }
  const intentions = new IntentionCache();
  const antiStall = new AntiStall({ noProgressMs: Math.max(12000, cfg.intervalMs * 3) });

  let viewerFollow = null;
  if (cfg.enableViewerFollow) {
    viewerFollow = new ViewerFollowLoop({
      harness,
      viewerName: cfg.viewerName,
      cameraName: cfg.cameraName,
      intervalMs: cfg.viewerFollowMs,
      onLog: (entry) => log(entry),
    });
    viewerFollow.start();
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
      const who = helper && helper.ok && state.tick % 2 === 0 ? cfg.helperName : cfg.actorName;

      // 1. Perception + survival. Survival always outranks the job rotation.
      const observed = await harness.cap.observe(who);
      const monitor = survival.get(who);
      const assessment = monitor
        ? monitor.assess((observed && observed.data) || {})
        : { state: 'SAFE', action: { kind: 'work' }, changed: false };
      if (assessment.changed || assessment.state !== 'SAFE') {
        log({
          status: assessment.state === 'SAFE' ? 'PASS' : 'DEGRADED',
          action: 'survival_state',
          worker: who,
          state: assessment.state,
          previous: assessment.previous,
          reason: assessment.reason,
          threats: assessment.threats,
          healthPct: assessment.healthPct,
          distanceFromWork: assessment.distanceFromWork,
          recommended: assessment.action.kind,
        });
      }
      if (assessment.deathCause) {
        log({
          status: 'DEGRADED',
          action: 'agent_death',
          worker: who,
          cause: assessment.deathCause,
          deaths: assessment.deaths,
        });
        if (typeof observation.noteEvent === 'function') observation.noteEvent(who, 'death');
      }
      if (assessment.action.kind !== 'work') {
        if (typeof observation.noteEvent === 'function') {
          observation.noteEvent(who, assessment.state === 'RECOVER' ? 'danger' : 'combat');
        }
        intentions.applySignals(who, { survivalEscalated: true });
        const survived = await executeSurvival(harness, who, assessment, {
          workOrigin: cfg.origin,
          findSurfaceY: (x, z) =>
            findSurfaceY(harness, x, z, {
              fallbackY: cfg.origin.y,
              maxY: cfg.origin.y + 24,
              minY: cfg.origin.y - 24,
            }),
        });
        log({
          status: survived.status,
          action: 'survival_action',
          worker: who,
          kind: survived.kind,
          state: assessment.state,
          steps: survived.steps,
        });
        saveState(state);
        return;
      }

      // 2. Intention (cached 20-60 s) then the deterministic per-tick job.
      const decisionStart = Date.now();
      const focusCandidate = chooseFocus(state, {
        survivalState: assessment.state,
        townOk: !!(town && town.ok),
      });
      const cached = intentions.get(who, focusCandidate.contextKey);
      const intention = cached.hit ? cached.intention : focusCandidate;
      if (!cached.hit) {
        intentions.set(who, focusCandidate, { contextKey: focusCandidate.contextKey });
        log({
          status: 'PASS',
          action: 'intention_set',
          worker: who,
          focus: focusCandidate.focus,
          reason: focusCandidate.reason,
          cacheMiss: cached.reason,
        });
      }
      const step = biasJob(nextJob(state.tick, state), intention.focus, state.tick);
      observeMetric(METRIC.DECISION_LATENCY, Date.now() - decisionStart, {
        actor: who,
        cached: String(cached.hit),
      });

      state.agentJobs = state.agentJobs || {};
      const prevJob = state.agentJobs[who] || null;
      if (typeof observation.setActivity === 'function') {
        observation.setActivity(who, step.job);
      }

      // 3. Act.
      const actionStart = Date.now();
      const result = await runJob(harness, who, step, state, { observed });
      observeMetric(METRIC.ACTION_LATENCY, Date.now() - actionStart, { actor: who, job: step.job });

      let agentPos = null;
      try {
        const obs = await harness.cap.observe(who);
        if (obs && obs.success && obs.data) {
          agentPos = {
            x: obs.data.x ?? obs.data.loc_x,
            y: obs.data.y ?? obs.data.loc_y,
            z: obs.data.z ?? obs.data.loc_z,
          };
        }
      } catch (_) {}

      // 4. Stall detection on real progress, not on tick count.
      state.progress += meaningfulProgress(result);
      const stall = antiStall.report(who, {
        goalKey: `${who}:${intention.focus}:${step.job}:${step.site || ''}`,
        progressValue: state.progress,
        higherIsBetter: true,
      });
      if (stall.escalated) {
        log({
          status: 'DEGRADED',
          action: 'anti_stall',
          worker: who,
          stage: stall.stage,
          noProgressMs: stall.noProgressMs,
          goalAgeMs: stall.goalAgeMs,
          reason: stall.reason,
          job: step.job,
        });
        if (stall.stage === 'REPLAN' || stall.stage === 'ABANDON_GOAL') {
          intentions.applySignals(who, { noProgress: true, goalAbandoned: stall.stage === 'ABANDON_GOAL' });
        }
      }
      state.agentJobs[who] = step.job;
      state.lastAgent = {
        worker: who,
        job: step.job,
        status: result.status,
        position: agentPos,
        at: Date.now(),
      };
      if (prevJob !== step.job) {
        log({
          status: 'PASS',
          action: 'agent_state_transition',
          worker: who,
          fromJob: prevJob,
          toJob: step.job,
          position: agentPos,
          result: result.status,
        });
      } else {
        log({
          status: result.status === 'PASS' ? 'PASS' : 'DEGRADED',
          action: 'agent_action',
          worker: who,
          job: step.job,
          position: agentPos,
          lastAction: step.job,
        });
      }
      if (result.status === 'PASS' && observation) {
        // Interest signal only: the director decides whether that earns a cut.
        observation.biasTo(who, 'work_tick_bias');
        if (prevJob !== step.job && typeof observation.noteEvent === 'function') {
          observation.noteEvent(who, 'state_transition');
        }
      }
      if (step.job === 'placeregion' && result.status === 'PASS' && typeof observation.noteEvent === 'function') {
        observation.noteEvent(who, 'region_placed');
      }
      if (state.tick % 5 === 0) {
        log({
          status: 'OBSERVED',
          action: 'observation_snapshot',
          observation: observation.snapshot(),
          viewer: viewerFollow ? viewerFollow.snapshot() : null,
          worker: who,
          job: step.job,
        });
      }
      if (state.tick % 20 === 0) {
        log({
          status: 'OBSERVED',
          action: 'metrics_snapshot',
          metrics: metricsSnapshot(),
          intentions: intentions.snapshot(),
          antiStall: antiStall.snapshot(),
          survival: [...survival.values()].map((m) => m.snapshot()),
        });
      }
      log({
        status: result.status,
        action: 'work_tick',
        tick: state.tick,
        worker: who,
        town,
        focus: intention.focus,
        survivalState: assessment.state,
        step,
        result,
        cameraSubject: observation.currentSubject,
        watch: 'Viewer continuously spectates Cam; Cam directs shots on Steve/Alex',
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
    if (observation) observation.stop();
    if (viewerFollow) viewerFollow.stop();
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
