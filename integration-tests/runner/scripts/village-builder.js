#!/usr/bin/env node
/**
 * Deterministic overnight village builder for Civs QA.
 * Architecture: runner → RawKeepAliveActor + Capabilities + RCON → Paper QA.
 * Optional SpectatorCamera (Cam) for cinematic watchability.
 *
 * Usage (WSL):
 *   RCON_PASSWORD=civsqa node scripts/village-builder.js [--once] [--max-steps N]
 */
const fs = require('fs');
const path = require('path');
const { Harness } = require('../lib/harness');
const { RawKeepAliveActor } = require('../lib/actor');
const { SpectatorCamera } = require('../lib/camera');
const { initTelemetry, shutdownTelemetry } = require('../lib/telemetry');

const REPORTS = path.join(__dirname, '..', 'reports');
const LOG_JSONL = path.join(REPORTS, 'village-builder.jsonl');
const STATE_FILE = path.join(REPORTS, 'village-builder-state.json');
const SUMMARY = path.join(REPORTS, 'village-builder-summary.json');

const cfg = {
  rconHost: process.env.RCON_HOST || '127.0.0.1',
  rconPort: Number.parseInt(process.env.RCON_PORT || '25575', 10),
  rconPassword: process.env.RCON_PASSWORD || 'civsqa',
  mcHost: process.env.MC_HOST || '127.0.0.1',
  mcPort: Number.parseInt(process.env.MC_PORT || '25565', 10),
  actorName: process.env.ACTOR_NAME || 'Steve',
  cameraName: process.env.CAMERA_NAME || 'Cam',
  version: process.env.MC_SERVER_MAJOR || '26.1.2',
  // Dedicated village pad (away from prior QA at ~2100 and ~3000).
  origin: {
    x: Number.parseInt(process.env.VILLAGE_X || '5200', 10),
    y: Number.parseInt(process.env.VILLAGE_Y || '80', 10),
    z: Number.parseInt(process.env.VILLAGE_Z || '5200', 10),
  },
  maxSteps: Number.parseInt(process.env.VILLAGE_MAX_STEPS || '40', 10),
  loopMs: Number.parseInt(process.env.VILLAGE_LOOP_MS || '8000', 10),
  once: process.argv.includes('--once'),
};

/**
 * Sensible progression from Civs_servidor item-types (real names only).
 * Offsets keep footprints from overlapping (radii ~2–5 + town 40).
 */
const PLAN = [
  { id: 'pad', kind: 'prep', label: 'Prepare village plateau' },
  // Town build-reqs need council_room first (settlement.yml), then found town via /cv town.
  {
    id: 'council_room',
    kind: 'region',
    type: 'council_room',
    dx: 0,
    dy: 0,
    dz: 0,
    label: 'Town center: council_room',
    stockpile: 'council_room',
  },
  {
    id: 'settlement',
    kind: 'town',
    type: 'settlement',
    townName: 'NpcPad',
    dx: 2,
    dy: 1,
    dz: 2,
    label: 'Found settlement town (/cv town)',
  },
  {
    id: 'shelter',
    kind: 'region',
    type: 'shelter',
    dx: -10,
    dy: 0,
    dz: 0,
    label: 'Emergency shelter',
  },
  {
    id: 'hovel',
    kind: 'region',
    type: 'hovel',
    dx: 0,
    dy: 0,
    dz: 14,
    label: 'Housing: hovel',
    stockpile: 'hovel',
    schem: 'hovel',
  },
  {
    id: 'cobble_quarry',
    kind: 'region',
    type: 'cobble_quarry',
    dx: -14,
    dy: 0,
    dz: 14,
    label: 'Production: cobble_quarry',
    stockpile: 'quarry',
  },
  {
    id: 'warehouse',
    kind: 'region',
    type: 'inn',
    dx: 14,
    dy: 0,
    dz: 14,
    label: 'Utility: inn (settlement-tier storage/housing)',
    stockpile: 'utility',
  },
  {
    id: 'wheat_farm',
    kind: 'region',
    type: 'potato_farm',
    dx: 0,
    dy: 0,
    dz: -14,
    label: 'Food: potato_farm (settlement-tier)',
    stockpile: 'farm',
  },
  {
    id: 'barracks',
    kind: 'region',
    type: 'barracks',
    dx: 14,
    dy: 0,
    dz: -10,
    label: 'Defense: barracks',
    stockpile: 'utility',
  },
  {
    id: 'smithy',
    kind: 'region',
    type: 'smithy',
    dx: -14,
    dy: 0,
    dz: -10,
    label: 'Workshop: smithy',
    stockpile: 'utility',
  },
  { id: 'verify', kind: 'verify', label: 'Dump region evidence + save' },
];

function log(entry) {
  fs.mkdirSync(REPORTS, { recursive: true });
  const row = { ts: new Date().toISOString(), ...entry };
  fs.appendFileSync(LOG_JSONL, JSON.stringify(row) + '\n');
  console.log(JSON.stringify(row));
}

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch (_) {
    return { completed: {}, attempts: {}, origin: cfg.origin };
  }
}

function saveState(state) {
  fs.mkdirSync(REPORTS, { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function posFor(step) {
  return {
    x: cfg.origin.x + (step.dx || 0),
    y: cfg.origin.y + (step.dy || 0),
    z: cfg.origin.z + (step.dz || 0),
  };
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Dump Civs build materials so MANUAL /cv placeregion can validate.
 * Materials match Civs_servidor config.yml item-groups (primary/secondary/roof/…).
 */
async function stockpileMaterials(harness, x, y, z, profile = 'utility') {
  const r = profile === 'council_room' ? 5 : profile === 'hovel' ? 4 : 4;
  const cmds = [
    `fill ${x - r} ${y + 1} ${z - r} ${x + r} ${y + 7} ${z + r} air`,
    // Primary volume (stone_bricks ∈ g:primary) — overshoot counts for 125+
    `fill ${x - r} ${y} ${z - r} ${x + r} ${y + 3} ${z + r} stone_bricks`,
    // Secondary (cobblestone)
    `fill ${x - r} ${y} ${z - r} ${x + r} ${y} ${z + r} cobblestone`,
    `fill ${x - Math.max(1, r - 1)} ${y + 1} ${z - Math.max(1, r - 1)} ${x + Math.max(1, r - 1)} ${y + 2} ${z + Math.max(1, r - 1)} oak_log`,
    // Roof / stairs
    `fill ${x - r} ${y + 4} ${z - r} ${x + r} ${y + 4} ${z + r} oak_stairs`,
    `fill ${x - r} ${y + 5} ${z - r} ${x + r} ${y + 5} ${z + r} oak_slab`,
    // Hollow interior for interactables
    `fill ${x - Math.max(1, r - 2)} ${y + 1} ${z - Math.max(1, r - 2)} ${x + Math.max(1, r - 2)} ${y + 3} ${z + Math.max(1, r - 2)} air`,
    `setblock ${x + 1} ${y + 1} ${z} chest`,
    `setblock ${x + 2} ${y + 1} ${z} chest`,
    `setblock ${x - 1} ${y + 1} ${z} chest`,
    `setblock ${x - 2} ${y + 1} ${z} chest`,
    `setblock ${x} ${y + 1} ${z + 1} oak_door[half=lower]`,
    `setblock ${x} ${y + 2} ${z + 1} oak_door[half=upper]`,
    `setblock ${x} ${y + 1} ${z - 1} oak_door[half=lower]`,
    `setblock ${x} ${y + 2} ${z - 1} oak_door[half=upper]`,
    `setblock ${x + 1} ${y + 2} ${z + 2} glass`,
    `setblock ${x - 1} ${y + 2} ${z + 2} glass`,
    `setblock ${x + 1} ${y + 2} ${z - 2} glass`,
    `setblock ${x - 1} ${y + 2} ${z - 2} glass`,
    `setblock ${x + 2} ${y + 2} ${z + 1} glass_pane`,
    `setblock ${x - 2} ${y + 2} ${z + 1} glass_pane`,
    `setblock ${x + 2} ${y + 2} ${z - 1} glass_pane`,
    `setblock ${x - 2} ${y + 2} ${z - 1} glass_pane`,
    `setblock ${x + 3} ${y + 1} ${z} furnace`,
    `setblock ${x + 3} ${y + 1} ${z + 1} furnace`,
    `setblock ${x - 3} ${y + 1} ${z} crafting_table`,
    `setblock ${x - 3} ${y + 1} ${z + 1} bookshelf`,
    `setblock ${x - 3} ${y + 1} ${z + 2} bookshelf`,
    `setblock ${x - 3} ${y + 2} ${z + 1} bookshelf`,
    `setblock ${x - 3} ${y + 2} ${z + 2} bookshelf`,
    `setblock ${x - 2} ${y + 1} ${z + 2} bookshelf`,
    `setblock ${x - 2} ${y + 2} ${z + 2} bookshelf`,
    `setblock ${x - 1} ${y + 1} ${z + 2} bookshelf`,
    `setblock ${x - 1} ${y + 2} ${z + 2} bookshelf`,
    `setblock ${x + 1} ${y + 1} ${z + 3} red_bed`,
    `setblock ${x - 1} ${y + 1} ${z + 3} water`,
    `setblock ${x - 2} ${y + 1} ${z + 3} lava`,
    `setblock ${x + 2} ${y + 1} ${z + 3} cauldron`,
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
  if (profile === 'quarry') {
    cmds.push(
      `setblock ${x + 1} ${y + 1} ${z + 1} furnace`,
      `setblock ${x - 1} ${y + 1} ${z + 1} furnace`,
      `setblock ${x} ${y + 1} ${z + 2} lava`,
      `setblock ${x} ${y + 1} ${z - 2} cauldron`
    );
  }
  // Leave center clear for region icon chest placed by placeregion
  cmds.push(`setblock ${x} ${y} ${z} grass_block`);
  cmds.push(`setblock ${x} ${y + 1} ${z} air`);
  const results = [];
  for (const c of cmds) {
    results.push({ cmd: c.slice(0, 80), reply: await harness.raw(c) });
  }
  return results;
}

async function pasteSchem(harness, actor, schem, x, y, z) {
  // WorldEdit console paste if plugin present — best-effort, not required.
  const replies = [];
  replies.push(
    await harness.raw(`execute as ${actor.name} at ${actor.name} run //schem load ${schem}`)
  );
  replies.push(await harness.raw(`tp ${actor.name} ${x} ${y + 1} ${z}`));
  replies.push(await harness.raw(`execute as ${actor.name} at ${actor.name} run //paste -a`));
  return replies;
}

async function preparePad(harness, actor) {
  const { x, y, z } = cfg.origin;
  const size = 40;
  await harness.raw(`time set day`);
  await harness.raw(`weather clear`);
  await harness.raw(`gamemode creative ${actor.name}`);
  await actor.teleport(x, y + 2, z);
  await harness.raw(`fill ${x - size} ${y} ${z - size} ${x + size} ${y} ${z + size} grass_block`);
  await harness.raw(`fill ${x - size} ${y + 1} ${z - size} ${x + size} ${y + 8} ${z + size} air`);
  // Visible border for cinematic
  await harness.raw(`fill ${x - size} ${y} ${z - size} ${x + size} ${y} ${z - size} stone_bricks`);
  await harness.raw(`fill ${x - size} ${y} ${z + size} ${x + size} ${y} ${z + size} stone_bricks`);
  await harness.raw(`say Village pad ready at ${x} ${y} ${z}`);
  return { x, y, z, size };
}

async function placeRegionStep(harness, actor, step) {
  const p = posFor(step);
  if (step.stockpile) {
    await stockpileMaterials(
      harness,
      p.x,
      p.y,
      p.z,
      step.stockpile === true ? 'utility' : step.stockpile
    );
  }
  if (step.schem) {
    await pasteSchem(harness, actor, step.schem, p.x, p.y, p.z);
  }
  await actor.teleport(p.x, p.y + 2, p.z);
  await sleep(400);
  const before = await harness.region.at(p.x, p.y, p.z);
  const placeReply = await actor.placeRegion(step.type, p.x, p.y, p.z);
  await sleep(600);
  const after = await harness.region.at(p.x, p.y, p.z);
  const count = await harness.region.count(step.type).catch(() => null);
  const ok =
    String(placeReply || '').includes('placeregion OK') ||
    (after && after.type && String(after.type).toLowerCase() === step.type);
  return {
    status: ok ? 'PASS' : 'FAIL',
    type: step.type,
    pos: p,
    placeReply: String(placeReply || '').slice(0, 240),
    before,
    after,
    count,
  };
}

async function placeTownStep(harness, actor, step) {
  const p = posFor(step);
  const townName = step.townName || 'NpcPad';
  await actor.teleport(p.x, p.y, p.z);
  await sleep(300);
  const reply = await actor.placeTown(step.type, townName, p.x, p.y, p.z);
  await sleep(1000);
  const assertTown = await harness.assert.town(townName);
  const replyStr = String(reply || '');
  const ok = assertTown && assertTown.ok === true;
  return {
    status: ok ? 'PASS' : 'FAIL',
    type: step.type,
    townName,
    pos: p,
    placeReply: replyStr.slice(0, 500),
    assertTown,
  };
}

async function verifyAll(harness) {
  const dump = await harness.raw('test dump regions');
  await harness.region.save();
  const townsList = await harness.raw('cv listtowns').catch(() => 'n/a');
  return { dump: String(dump).slice(0, 4000), townsList: String(townsList).slice(0, 1000) };
}

async function nextIncomplete(state) {
  for (const step of PLAN) {
    if (!state.completed[step.id]) return step;
  }
  return null;
}

async function main() {
  initTelemetry({ serviceName: 'civs-village-builder' });
  fs.mkdirSync(REPORTS, { recursive: true });
  const state = loadState();
  state.origin = cfg.origin;

  const harness = new Harness({
    host: cfg.rconHost,
    port: cfg.rconPort,
    password: cfg.rconPassword,
  });
  await harness.connect();
  const ping = await harness.ping();
  if (!ping || ping.pong !== '1') {
    log({ status: 'BLOCKED', action: 'ping', reason: 'harness_ping_failed', ping });
    await harness.close();
    process.exit(2);
  }
  log({ status: 'PASS', action: 'ping', ping });

  const actor = new RawKeepAliveActor({
    host: cfg.mcHost,
    port: cfg.mcPort,
    username: cfg.actorName,
    version: cfg.version,
    sendCommand: (c) => harness.raw(c),
  });
  await actor.connect();
  if (!actor.available) {
    log({ status: 'BLOCKED', action: 'actor_connect', reason: actor.reason });
    await harness.close();
    process.exit(2);
  }
  await actor.grantOp();
  log({ status: 'PASS', action: 'actor_online', player: actor.name });

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
  camera.startLoop(async () => {
    const obs = await harness.cap.observe(cfg.actorName);
    if (obs && obs.success && obs.data) {
      return {
        x: obs.data.x ?? obs.data.loc_x,
        y: obs.data.y ?? obs.data.loc_y,
        z: obs.data.z ?? obs.data.loc_z,
      };
    }
    return null;
  });

  let stepsDone = 0;
  const runOne = async () => {
    const step = await nextIncomplete(state);
    if (!step) {
      log({ status: 'PASS', action: 'plan_complete', completed: Object.keys(state.completed) });
      return false;
    }
    state.attempts[step.id] = (state.attempts[step.id] || 0) + 1;
    log({
      status: 'OBSERVED',
      action: 'plan_step',
      step: step.id,
      label: step.label,
      attempt: state.attempts[step.id],
    });

    let result;
    try {
      if (step.kind === 'prep') {
        result = { status: 'PASS', ...(await preparePad(harness, actor)) };
      } else if (step.kind === 'region') {
        result = await placeRegionStep(harness, actor, step);
      } else if (step.kind === 'town') {
        result = await placeTownStep(harness, actor, step);
      } else if (step.kind === 'verify') {
        result = { status: 'PASS', ...(await verifyAll(harness)) };
      } else {
        result = { status: 'UNKNOWN', reason: 'bad_step_kind' };
      }
    } catch (e) {
      result = { status: 'FAIL', reason: String(e && e.message ? e.message : e) };
    }

    log({ status: result.status, action: 'step_result', step: step.id, result });
    if (result.status === 'PASS') {
      state.completed[step.id] = { at: new Date().toISOString(), result };
    } else if (state.attempts[step.id] >= 3) {
      // Skip stubborn steps so overnight loop keeps progressing
      state.completed[step.id] = {
        at: new Date().toISOString(),
        skipped: true,
        result,
      };
      log({
        status: 'BLOCKED',
        action: 'step_skipped',
        step: step.id,
        attempts: state.attempts[step.id],
      });
    }
    saveState(state);
    await camera.ensureFollow();
    stepsDone += 1;
    return stepsDone < cfg.maxSteps;
  };

  if (cfg.once) {
    await runOne();
  } else {
    while (stepsDone < cfg.maxSteps) {
      const cont = await runOne();
      if (!cont) break;
      const remaining = await nextIncomplete(state);
      if (!remaining) break;
      await sleep(cfg.loopMs);
    }
  }

  const finalVerify = await verifyAll(harness);
  const summary = {
    status: 'OBSERVED',
    origin: cfg.origin,
    completed: state.completed,
    attempts: state.attempts,
    camera: camStart,
    finalVerify,
    how_to_watch: {
      camera_player: cfg.cameraName,
      builder: cfg.actorName,
      server: `${cfg.mcHost}:${cfg.mcPort}`,
      online_mode: false,
      tips: [
        'Join as Viewer with Minecraft 26.1.2 offline → /spectate Cam or /tp @s Cam',
        'Or watch Cam in spectator following Steve',
        'OBS: Window Capture Minecraft; recordings under reports/cinematic/ if started',
      ],
    },
  };
  fs.writeFileSync(SUMMARY, JSON.stringify(summary, null, 2));
  log({ status: 'PASS', action: 'summary_written', path: SUMMARY });

  camera.stopLoop();
  await camera.stop();
  await actor.disconnect();
  await harness.close();
  await shutdownTelemetry();
}

main().catch(async (e) => {
  console.error(e);
  log({ status: 'FAIL', action: 'fatal', reason: String(e && e.message ? e.message : e) });
  try {
    await shutdownTelemetry();
  } catch (_) {}
  process.exit(1);
});
