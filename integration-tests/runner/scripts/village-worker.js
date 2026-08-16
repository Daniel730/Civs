#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { Harness } = require('../lib/harness');
const { RawKeepAliveActor } = require('../lib/actor');
const { SpectatorCamera } = require('../lib/camera');
const { CinematicDirector, ObservationDirector, ViewerFollowLoop } = require('../lib/observation');
const {
  nextJob,
  nextPlaceAttempt,
  workCoords,
  SITES,
  siteForJob,
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
const { IntentionCache, AntiStall } = require('@daniel730/aiworld/intention-cache');
const { ConsultGate, plannerFromEnv } = require('@daniel730/aiworld/consult-planner');
const { recordFocusDecision, recordFocusOutcome } = require('@daniel730/aiworld/decision');
const { policy: aiPolicy } = require('@daniel730/aiworld/decision');
const { OllamaBrain } = require('@daniel730/aiworld/ollama-brain');
const { encodeState } = require('@daniel730/aiworld/state-rep');
const { FOCUSES } = require('../lib/village/focus');
const { initTelemetry, shutdownTelemetry } = require('../lib/telemetry');
const { METRIC, initMetrics, observeMetric, metricsSnapshot } = require('../lib/metrics');
const rt = require('@daniel730/aiworld/agent-runtime');
const { AgentCooperation, semanticFor } = require('@daniel730/aiworld/agent-bus');
const { HermesBridge } = require('@daniel730/aiworld/hermes-bridge');

// Player-like modules (M3, M4, M5, M6) — pure, testable, no I/O
const { checkTool, expectedToolName, findToolInInventory } = require('../lib/tool-check');
const { CombatLog, ATTACK_COOLDOWN_MS } = require('../lib/combat-log');
const { applyObserve, diffInventory } = require('../lib/inventory-diff');
// M6: typed, agent-oriented action events (break/mine/gather/place) with full context.
const { buildMineEvent, buildBreakEvent, buildGatherEvent, buildPlaceEvent, SCHEMA_VERSION: agentEventsSchema } = require('../lib/agent-events');

const REPORTS = path.join(__dirname, '..', 'reports');
const LOG_JSONL = path.join(REPORTS, 'village-worker.jsonl');
const STATE_FILE = path.join(REPORTS, 'village-worker-state.json');
const MEMORY_PATH = path.join(REPORTS, 'construction-memory.json');

/**
 * safeWalk — stable locomotion wrapper around walkTo (server-side A* walk_path).
 * Guarantees: (a) never teleports (allowTeleport:false), (b) uses walk_path hops for any
 * distance (low recoverDistance) so the agent actually travels instead of blinking,
 * (c) anti-stuck: if walk_path stalls/falls back to legacy stepping, retries the goal with
 * small standable offsets (±2, ±4) before giving up. This kills the "teleporting, walking in
 * circles, hitting walls, falling in holes, climbing fences" stupidity from greedy-step fallbacks.
 */
async function safeWalk(harness, actorName, stand, opts = {}) {
  const baseOpts = Object.assign(
    { allowTeleport: false, recoverDistance: 18, speed: 4.0, timeoutMs: 12000, arrive: 1.6 },
    opts,
    { allowTeleport: false } // HARD: safeWalk NEVER teleports — locomotion must be real travel
  );
  const offsets = [
    [0, 0],
    [2, 0],
    [-2, 0],
    [0, 2],
    [0, -2],
    [3, 3],
    [-3, -3],
  ];
  let last = null;
  for (const [dx, dz] of offsets) {
    const goal = { x: stand.x + dx, y: stand.y, z: stand.z + dz };
    const w = await walkTo(harness, actorName, goal, baseOpts).catch(() => ({
      success: false,
      reason: 'walk_threw',
      navigator: 'error',
    }));
    last = w;
    const badNavigator = w.navigator === 'walk_step' || w.navigator === 'walk_step_fallback' || w.navigator === 'recovery_teleport';
    if (w.success && !badNavigator) {
      return Object.assign({ recoveredOffset: dx || dz ? [dx, dz] : null }, w);
    }
  }
  return last || { success: false, reason: 'all_offsets_failed', navigator: 'none' };
}

const cfg = {
  rconHost: process.env.RCON_HOST || '127.0.0.1',
  rconPort: Number.parseInt(process.env.RCON_PORT || '25576', 10),
  rconPassword: process.env.RCON_PASSWORD || 'civsqa',
  mcHost: process.env.MC_HOST || '127.0.0.1',
  mcPort: Number.parseInt(process.env.MC_PORT || '25566', 10),
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

// Throttle cache for equipSurvivalGear — avoids RCON storm from equipping every tick.
const _lastEquipped = {};

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

/**
 * PLAYER-LIKE ONLY: clear head+feet at an approach tile by actually MINING the blocks
 * (cap.breakBlock), never `setblock ... air`. If the break fails the agent simply walks
 * around — no admin fallback.
 *
 * M5 NOTE: blocks mined here CAN yield drops (e.g. an oak-log in the path). Those drops
 * are captured honestly because EVERY downstream job (miner/lumberjack/beautify/place/
 * gather/torch/guard) takes a fresh `cap.observe` immediately after arriving via
 * safeWalk (which calls clearFooting) and diffs it against the post-action observe. So
 * a log/ore collected while clearing footing surfaces in that job's `inventory_diff`
 * rather than being invisible. We deliberately do NOT diff clearFooting per-tile here:
 * it can fire many times mid-walk and would flood the log; the next job's diff is the
 * single source of truth for "what the NPC actually gained/lost/dropped".
 */
async function clearFooting(harness, x, y, z, actorName = cfg.actorName) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const iz = Math.floor(z);
  await harness.cap.breakBlock(actorName, ix, iy, iz).catch(() => {});
  await harness.cap.breakBlock(actorName, ix, iy + 1, iz).catch(() => {});
}

/**
 * Founding stockpile is an ADMIN FILL (cheat). Disabled by default (player-like policy).
 * Set AIWORLD_ALLOW_FOUNDING_FILL=1 to re-enable for Civs build-reqs QA only.
 */
async function stockpile(harness, x, y, z, profile) {
  if (process.env.AIWORLD_ALLOW_FOUNDING_FILL !== '1') {
    return { skipped: true, reason: 'playerlike_no_admin_fill' };
  }
  await stockpileMaterials(harness, x, y, z, profile);
  return { skipped: false };
}

/**
 * Place one blueprint block as a REAL PLAYER would: mine the obstructing cell with
 * breakBlock, then placeBlock from the NPC's OWN inventory. No giveItem, no setblock
 * fallback — if the NPC has no material the placement fails and the caller must go
 * collect/craft it.
 */
async function placeAesthetic(harness, actorName, block) {
  const mat = block.material;
  if (block.role !== 'path') {
    // Mine the target cell for real instead of `setblock air`.
    await harness.cap.breakBlock(actorName, block.x, block.y, block.z).catch(() => {});
  }
  await harness.cap.lookAt(actorName, block.x, block.y, block.z);
  const pl = await harness.cap.placeBlock(actorName, block.x, block.y, block.z, mat);
  if (pl && pl.success) {
    await harness.cap.swing(actorName);
    return { via: 'place_block', ...pl, material: mat, role: block.role };
  }
  await harness.cap.swing(actorName);
  return {
    via: 'place_block_failed',
    success: false,
    reason: (pl && (pl.reason || pl.error)) || 'no_material_in_inventory',
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
    // Keep survival gear topped up every tick — cheap and idempotent, and prevents the
    // inventory_full death spiral (armour never lands while carrying blocks).
    await equipSurvivalGear(harness, actorName).catch(() => {});
    return { status: 'PASS', action: 'ensure_alive', player: actorName, health, revived: false };
  }
  const respawn = await harness.cap.respawn(actorName);
  // PLAYER-LIKE: no `gamemode`, no admin teleport, no gear handout after respawn.
  // The agent respawns like a player and walks back to the village on its own.
  await safeWalk(harness, actorName, {
    x: cfg.origin.x,
    y: cfg.origin.y + 1,
    z: cfg.origin.z,
  }).catch(() => {});
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
  // M6: carry the most-recent tool-check verdict + held item across the per-job
  // action blocks so every typed event (mine/break/gather/place) embeds it.
  let lastToolVerdict = null;
  // The work-loop caller passes the fresh observe as ctx.observed (parsed result
  // whose .data carries the flat snake_case fields: held / inventory — verified
  // live). Fall back across the older ctx.obs shape too, so the held item is ALWAYS
  // read from real data. The previous ctx.obs?.data path was always undefined, so
  // held was never seen and a false mismatch was logged on every tick.
  const _obsData =
    (ctx && ctx.observed && ctx.observed.data) ||
    (ctx && ctx.obs && ctx.obs.data) ||
    {};
  let lastHeldItem = _obsData.held != null ? _obsData.held : null;
  const results = {
    job: step.job,
    site: step.site || step.label,
    actions: [],
    policy: 'playerlike_v1',
    alive,
  };

  // PLAYER-LIKE: never switch gamemode. The QA/prod server is survival with
  // allow-cheats=false; the NPC works with exactly the same rules as a human player.

  if (step.job === 'placeregion') {
    // Ensure the town exists AND Steve is a member (Civs pre-reqs for regions require
    // member=settlement:...). ensureTown founds NpcPad as Steve (runAs) which enrolls him.
    try { await ensureTown(harness, actorName); } catch (_) {}
    const px = cfg.origin.x + (step.dx || 0);
    const pz = cfg.origin.z + (step.dz || 0);
    const py = cfg.origin.y;
    // Founding exception: stockpile fill then placeregion (documented in VILLAGE-AESTHETICS).
    const stock = await stockpile(harness, px, py, pz, step.stockpile || 'utility');
    const walk = await safeWalk(
      harness,
      actorName,
      { x: px + 1, y: py + 1, z: pz + 1 },
      {
        clearFooting: (x, y, z) => clearFooting(harness, x, y, z, actorName),
        timeoutMs: 12000,
        allowTeleport: false,
      }
    );
    results.actions.push({ walk, stockpile: stock });
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
      cheat: stock && stock.skipped ? null : 'stockpile_fill_for_civs_founding',
    });
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

  const walk = await safeWalk(harness, actorName, stand, {
    clearFooting: (x, y, z) => clearFooting(harness, x, y, z, actorName),
    timeoutMs: 14000,
    stepLen: 0.45,
    pauseMs: 140,
    allowTeleport: false,
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

  // --- Tool-check guard (M3, lib/tool-check.js) ---------------------------------
  // Before any mine/break, check the held item against the target block/mob. If the
  // wrong tool (or none) is in hand, LOG the mismatch and route the NPC to
  // fetch / craft / equip the correct tool BEFORE it wastes swings. Player-like: a
  // real player never bare-hands obsidian, and bare-handing stone is slow / often
  // blocked. No giveItem, no item-replace, no gamemode — the tool must come from the
  // NPC's OWN inventory or be crafted/fetched.
  let toolReady = true;
  let toolNeed = null; // {job,target,expectedTool,reason,ownedInInventory,action}
  if (
    ['miner', 'builder', 'beautify', 'farmer', 'lumberjack', 'guard'].includes(step.job)
  ) {
    const JOB_TARGET = {
      miner: 'STONE',
      builder: 'STONE',
      beautify: 'STONE', // cleanup uses stone-breaking
      farmer: 'GRASS_BLOCK', // tilling dirt/grass
      lumberjack: 'OAK_LOG',
      guard: 'mob',
    };
    const target = JOB_TARGET[step.job];
    if (target) {
      try {
        // Read REAL held + inventory from the fresh observe (ctx.observed.data). The
        // flat snake_case fields (held / inventory) are verified against live QA logs.
        const held = _obsData.held != null ? _obsData.held : null;
        const inventory = Array.isArray(_obsData.inventory) ? _obsData.inventory : [];
        const verdict = checkTool(held, target);
        // M6: stash the verdict so the typed mine/break/gather/place events below
        // embed it in their `tool` field (full context: right tool?).
        lastToolVerdict = verdict;
        lastHeldItem = held || lastHeldItem;
        // M6: typed tool_check event (replaces free-form kind:'tool_check').
        log({
          schemaVersion: agentEventsSchema,
          ts: new Date().toISOString(),
          kind: 'tool_check',
          action: 'tool_check',
          actor: actorName,
          job: step.job,
          target,
          ...verdict,
        });
        if (!verdict.matched) {
          // Is the correct tool somewhere in the NPC's OWN inventory (no giveItem!)?
          const have = findToolInInventory(inventory, verdict.expectedTool);
          if (have) {
            // Tool owned but not in hand. The flat observe payload carries NO hotbar
            // slot index, so we CANNOT honestly hotbar-select it here (selecting slot 0
            // would put the wrong item in hand). Signal the planner to equip/route it
            // instead of pretending. toolReady=false so pure-break jobs skip the swing.
            toolNeed = {
              job: step.job,
              target,
              expectedTool: verdict.expectedTool,
              reason: verdict.reason,
              ownedInInventory: have,
              action: 'equip',
            };
            log({
              schemaVersion: agentEventsSchema,
              ts: new Date().toISOString(),
              kind: 'tool_owned_not_held',
              action: 'tool_owned_not_held',
              actor: actorName,
              job: step.job,
              tool: have,
              expected: verdict.expectedTool,
              reason: verdict.reason,
            });
          } else {
            // Truly missing: NPC must fetch / craft the right tool before mining.
            toolNeed = {
              job: step.job,
              target,
              expectedTool: verdict.expectedTool,
              reason: verdict.reason,
              ownedInInventory: null,
              action: 'fetch_or_craft',
            };
            log({
              schemaVersion: agentEventsSchema,
              ts: new Date().toISOString(),
              kind: 'tool_mismatch',
              action: 'tool_mismatch',
              actor: actorName,
              job: step.job,
              target,
              expected: verdict.expectedTool,
              action: 'fetch_or_craft',
              reason: verdict.reason,
            });
          }
          toolReady = false;
          // Consulted by the planner / next tick to route the NPC to fetch/craft/equip.
          state.needsTool = toolNeed;
        }
      } catch (e) {
        log({ kind: 'tool_check_error', error: String(e) });
      }
    }
  }

  // M3: for PURE-BREAK jobs, do NOT bare-hand the block when the right tool is
  // missing / not equipped (slow, and impossible for obsidian). Log + return so the
  // planner / next tick fetches-crafts-equips. Non-break jobs (guard/farmer/builder)
  // keep their other actions; they only get the mismatch logged above.
  if (!toolReady && (step.job === 'miner' || step.job === 'lumberjack' || step.job === 'beautify')) {
    // M3b: if the NPC needs a tool and it's a fetch_or_craft action, craft it now from the NPC's own inventory.
    if (toolNeed && toolNeed.action === 'fetch_or_craft' && state.needsTool) {
      const { craftWithOwnResources, recipeForTool } = require('../lib/crafting');
      const toolRecipe = recipeForTool(toolNeed.expectedTool);
      if (toolRecipe) {
        const craftRes = await craftWithOwnResources(harness.cap, actorName, toolRecipe.result, 1, toolRecipe, (ev) => log(ev));
        if (craftRes.success) {
          log({
            schemaVersion: agentEventsSchema,
            ts: new Date().toISOString(),
            kind: 'craft',
            action: 'craft',
            actor: actorName,
            job: step.job,
            target: toolNeed.target,
            tool: toolRecipe.result,
            success: true,
            reason: 'crafted_from_inventory',
          });
          // Clear the needsTool so the next tick proceeds with the correct tool in hand.
          state.needsTool = null;
          // Re-check tool readiness after crafting (should now be matched).
          const recheck = await checkTool(lastHeldItem, toolNeed.target);
          if (recheck.matched) {
            toolReady = true;
          }
        } else {
          log({
            schemaVersion: agentEventsSchema,
            ts: new Date().toISOString(),
            kind: 'craft_failed',
            action: 'craft_failed',
            actor: actorName,
            job: step.job,
            target: toolNeed.target,
            tool: toolRecipe.result,
            success: false,
            reason: craftRes.reason || 'craft_failed',
          });
        }
      }
    }
    // If after crafting we still don't have the right tool, keep the TOOL_REQUIRED status.
    if (!toolReady && (step.job === 'miner' || step.job === 'lumberjack' || step.job === 'beautify')) {
      results.status = 'TOOL_REQUIRED';
      results.toolRequired = toolNeed;
      results.actions.push({
        tool_skip_break: {
          job: step.job,
          target: toolNeed && toolNeed.target,
          expectedTool: toolNeed && toolNeed.expectedTool,
          action: toolNeed && toolNeed.action,
          ownedInInventory: toolNeed && toolNeed.ownedInInventory,
        },
      });
      state.actions += 1;
      return results;
    }
  }



  // Mine / chop existing terrain only — never spawn a block then break it (#66).
  if (step.job === 'miner') {
    // Find a REAL solid block nearby and dig THAT — otherwise we swing at air
    // (already_air) and look stuck. Prefer stone/dirt/grass within reach.
    let digX = Math.floor(cfg.origin.x + (step.dx || 0) + 5);
    let digZ = Math.floor(cfg.origin.z + (step.dz || 0) + 5);
    let digY = await findSurfaceY(harness, digX, digZ, {
      fallbackY: groundY,
      maxY: groundY + 8,
      minY: groundY - 8,
    });
    const fb = await cap.findBlock(actorName, 'STONE', 12).catch(() => null);
        if (fb && fb.success && fb.data && fb.data.nearest) {
          digX = fb.data.nearest.x;
          digZ = fb.data.nearest.z;
          digY = fb.data.nearest.y;
          // Walk to the block first so the swing actually connects (don't dig from afar).
          await safeWalk(harness, actorName, { x: digX, y: digY, z: digZ }, {
            arrive: 2.5, timeoutMs: 6000, speed: 4.5, allowTeleport: false,
          }).catch(() => {});
        }
        // --- Inventory diff (M5: lib/inventory-diff.js) ---------------------------
        const obsBeforeMiner = await harness.cap.observe(actorName);
        const invBeforeMiner = applyObserve(obsBeforeMiner);
        const minerPos = obsBeforeMiner && obsBeforeMiner.data
          ? { x: obsBeforeMiner.data.x, y: obsBeforeMiner.data.y, z: obsBeforeMiner.data.z }
          : null;
        const br = await cap.breakBlock(actorName, digX, digY, digZ);
        const invAfterMiner = applyObserve(await harness.cap.observe(actorName));
        const minerDiff = diffInventory(invBeforeMiner, invAfterMiner, {
          from: `break:STONE@${digX},${digY},${digZ}`,
          expectedDrops: { COBBLESTONE: 1 }, // stone drops cobblestone
        });
        // M6: typed `mine` event with full context (target+pos, tool, inventory diff, result).
        log(buildMineEvent({
          actor: actorName,
          job: step.job,
          target: { blockType: 'STONE', x: digX, y: digY, z: digZ },
          held: lastHeldItem,
          toolVerdict: lastToolVerdict,
          invDiff: minerDiff,
          success: !!(br && br.success),
          reason: br && !br.success ? (br.reason || br.error || 'break_failed') : null,
          position: minerPos,
        }));
        // -----------------------------------------------------------------------
        results.actions.push({ breakBlock: br, spawned: false, target: { x: digX, y: digY, z: digZ } });
        await cap.swing(actorName);
      } else if (step.job === 'lumberjack') {
    const digX = Math.floor(cfg.origin.x + (step.dx || 0) + 5);
    const digZ = Math.floor(cfg.origin.z + (step.dz || 0) + 4);
    // Prefer a block above surface (log/leaves) if present; else surface
    let digY = groundY + 1;
    // --- Inventory diff (M5) for FIRST break: observe the REAL inventory before ---
    const obsBeforeLJ = await harness.cap.observe(actorName);
    const invBeforeLJ = applyObserve(obsBeforeLJ);
    const ljPos = obsBeforeLJ && obsBeforeLJ.data
      ? { x: obsBeforeLJ.data.x, y: obsBeforeLJ.data.y, z: obsBeforeLJ.data.z }
      : null;
    const br = await cap.breakBlock(actorName, digX, digY, digZ);
        if (!br || !br.success) {
          digY = await findSurfaceY(harness, digX, digZ, {
            fallbackY: groundY,
            maxY: groundY + 12,
            minY: groundY - 4,
          });
          // --- Inventory diff (M5) for retry break ---
          const invBeforeLJ2 = applyObserve(await harness.cap.observe(actorName));
          const br2 = await cap.breakBlock(actorName, digX, digY, digZ);
          const invAfterLJ2 = applyObserve(await harness.cap.observe(actorName));
          const ljDiff2 = diffInventory(invBeforeLJ2, invAfterLJ2, {
            from: `break:OAK_LOG@${digX},${digY},${digZ}`,
            expectedDrops: { OAK_LOG: 1 },
          });
          // M6: typed `mine` event (lumberjack) with full context.
          log(buildMineEvent({
            actor: actorName,
            job: step.job,
            target: { blockType: 'OAK_LOG', x: digX, y: digY, z: digZ },
            held: lastHeldItem,
            toolVerdict: lastToolVerdict,
            invDiff: ljDiff2,
            success: !!(br2 && br2.success),
            reason: br2 && !br2.success ? (br2.reason || br2.error || 'break_failed') : null,
            position: ljPos,
          }));
          results.actions.push({ breakBlock: br2, spawned: false });
        } else {
          // --- Inventory diff (M5) for successful first break ---
          const invAfterLJ = applyObserve(await harness.cap.observe(actorName));
          const ljDiff = diffInventory(invBeforeLJ, invAfterLJ, {
            from: `break:OAK_LOG@${digX},${digY},${digZ}`,
            expectedDrops: { OAK_LOG: 1 },
          });
          // M6: typed `mine` event (lumberjack) with full context.
          log(buildMineEvent({
            actor: actorName,
            job: step.job,
            target: { blockType: 'OAK_LOG', x: digX, y: digY, z: digZ },
            held: lastHeldItem,
            toolVerdict: lastToolVerdict,
            invDiff: ljDiff,
            success: !!(br && br.success),
            reason: br && !br.success ? (br.reason || br.error || 'break_failed') : null,
            position: ljPos,
          }));
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
            // --- Inventory diff (M5) for beautify break ---
            const obsBeforeBeauty = await harness.cap.observe(actorName);
            const invBeforeBeauty = applyObserve(obsBeforeBeauty);
            const beautyPos = obsBeforeBeauty && obsBeforeBeauty.data
              ? { x: obsBeforeBeauty.data.x, y: obsBeforeBeauty.data.y, z: obsBeforeBeauty.data.z }
              : null;
            const br = await cap.breakBlock(actorName, t.x, t.y, t.z);
            const invAfterBeauty = applyObserve(await harness.cap.observe(actorName));
            const beautyDiff = diffInventory(invBeforeBeauty, invAfterBeauty, {
              from: `beautify_break:${t.x},${t.y},${t.z}`,
              expectedDrops: { COBBLESTONE: 1 }, // approximate for cleanup blocks
            });
            // M6: typed `break` event (beautify tear-down) with full context.
            log(buildBreakEvent({
              actor: actorName,
              job: step.job || 'beautify',
              target: { x: t.x, y: t.y, z: t.z },
              held: lastHeldItem,
              toolVerdict: lastToolVerdict,
              invDiff: beautyDiff,
              success: !!(br && br.success),
              reason: br && !br.success ? (br.reason || br.error || 'break_failed') : null,
              position: beautyPos,
            }));
            // PLAYER-LIKE: no `setblock air` fallback. If the block cannot be mined it stays.
            cleaned.push({ ...t, ok: !!(br && br.success) });
          } else if (t.action === 'set_grass') {
            // --- Inventory diff (M5) for grass place ---
            const obsBeforeGrass = await harness.cap.observe(actorName);
            const invBeforeGrass = applyObserve(obsBeforeGrass);
            const grassPos = obsBeforeGrass && obsBeforeGrass.data
              ? { x: obsBeforeGrass.data.x, y: obsBeforeGrass.data.y, z: obsBeforeGrass.data.z }
              : null;
            // PLAYER-LIKE: place from the NPC's own inventory; no admin setblock.
            await cap.lookAt(actorName, t.x, t.y, t.z);
            const pl = await cap
              .placeBlock(actorName, t.x, t.y, t.z, 'GRASS_BLOCK')
              .catch(() => null);
            const invAfterGrass = applyObserve(await harness.cap.observe(actorName));
            const grassDiff = diffInventory(invBeforeGrass, invAfterGrass, {
              from: `place:GRASS_BLOCK@${t.x},${t.y},${t.z}`,
              expectedDrops: {}, // placing consumes from inventory, no drops
            });
            // M6: typed `place` event (beautify grass) with full context.
            log(buildPlaceEvent({
              actor: actorName,
              job: step.job || 'beautify',
              material: 'GRASS_BLOCK',
              target: { x: t.x, y: t.y, z: t.z },
              held: lastHeldItem,
              invDiff: grassDiff,
              success: !!(pl && pl.success),
              reason: pl && !pl.success ? (pl.reason || pl.error || 'place_failed') : null,
              position: grassPos,
            }));
            cleaned.push({ ...t, ok: !!(pl && pl.success), needsMaterial: !(pl && pl.success) });
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
          const w2 = await safeWalk(harness, actorName, near, {
            arrive: 2.5,
            timeoutMs: 8000,
            stepLen: 0.45,
            pauseMs: 100,
            allowTeleport: false,
          });
          results.actions.push({
            walkBlock: { steps: w2.steps, success: w2.success, recoverTeleport: w2.recoverTeleport },
          });
          const oldBlock = await harness.block.at(block.x, block.y, block.z);
          // --- Inventory diff (M5) for placeBlock via placeAesthetic ---
          const obsBeforePlace = await harness.cap.observe(actorName);
          const invBeforePlace = applyObserve(obsBeforePlace);
          const placePos = obsBeforePlace && obsBeforePlace.data
            ? { x: obsBeforePlace.data.x, y: obsBeforePlace.data.y, z: obsBeforePlace.data.z }
            : null;
          const pr = await placeAesthetic(harness, actorName, block);
          const invAfterPlace = applyObserve(await harness.cap.observe(actorName));
          const placeDiff = diffInventory(invBeforePlace, invAfterPlace, {
            from: `place:${block.material}@${block.x},${block.y},${block.z}`,
            expectedDrops: {}, // placing consumes from inventory, no drops
          });
          // M6: typed `place` event (builder construction) with full context.
          log(buildPlaceEvent({
            actor: actorName,
            job: step.job || 'builder',
            material: block.material,
            target: { x: block.x, y: block.y, z: block.z },
            held: lastHeldItem,
            invDiff: placeDiff,
            success: !!(pr && pr.success),
            reason: pr && !pr.success ? (pr.reason || pr.error || 'place_failed') : null,
            position: placePos,
          }));
          // -----------------------------------------------------------------------
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
      // When the brain says survive, actually RETREAT to a safe spot away from the death zone
      // (e.g. iron bars under the center where the agent suffocates) instead of standing still
      // and re-suffocating. Walk (teleport-allowed) to an offset clear of the current tile.
      if (step.focus === 'survive') {
        const safeX = cfg.origin.x + 22;
        const safeZ = cfg.origin.z + 22;
        await safeWalk(harness, actorName, { x: safeX, y: (groundY || cfg.origin.y) + 2, z: safeZ },
          { arrive: 2, timeoutMs: 8000, speed: 4.5, allowTeleport: true }).catch(() => {});
        // Light up the fight zone with REAL torch placements from the NPC's own inventory
        // (no admin setblock). If it has no torches, nothing is placed — it must craft them.
        const ty = (groundY || cfg.origin.y) + 1;
        // --- Inventory diff (M5): each guard torch is drawn from the NPC's OWN inventory ---
        let prevGuardInv = applyObserve(await harness.cap. observe(actorName));
        for (const [dx, dz] of [[2,2],[-2,2],[2,-2],[-2,-2],[3,0],[-3,0],[0,3],[0,-3]]) {
          const tx2 = Math.floor(safeX + dx);
          const tz2 = Math.floor(safeZ + dz);
          await cap.lookAt(actorName, tx2, ty, tz2).catch(() => {});
          await cap.placeBlock(actorName, tx2, ty, tz2, 'TORCH').catch(() => {});
          const afterGuardInv = applyObserve(await harness.cap.observe(actorName));
          const gd = diffInventory(prevGuardInv, afterGuardInv, {
            from: `place:TORCH@${tx2},${tz2}`,
            expectedDrops: {},
          });
          // M6: typed `place` event (guard torch) with full context.
          log(buildPlaceEvent({
            actor: actorName,
            job: step.job || 'guard',
            material: 'TORCH',
            target: { x: tx2, y: ty, z: tz2 },
            held: lastHeldItem,
            invDiff: gd,
            success: gd.lost && gd.lost.some((l) => String(l.item).includes('TORCH')),
            reason: null,
            position: { x: safeX, y: ty, z: safeZ },
          }));
          prevGuardInv = afterGuardInv;
        }
      }
      await cap.lookAt(actorName, cfg.origin.x, groundY + 1, cfg.origin.z);
      await cap.swing(actorName);
    }
    await cap.sprint(actorName, false);
  }

  // Explore: travel to scattered waypoints around the origin and scan the horizon.
  // Gives the agent purposeful movement across the map instead of loitering.
  if (step.job === 'explore') {
    const ring = 40 + ((state.tick || 0) % 4) * 10; // 40..70 blocks out, rotating
    const ang = ((state.tick || 0) * 2.39996) % (Math.PI * 2); // golden-angle spread
    const tx = Math.floor(cfg.origin.x + Math.cos(ang) * ring);
    const tz = Math.floor(cfg.origin.z + Math.sin(ang) * ring);
    const ty = (groundY || cfg.origin.y) + 1;
    await safeWalk(harness, actorName, { x: tx, y: ty, z: tz },
      { arrive: 3, timeoutMs: 9000, speed: 4.5, allowTeleport: false }).catch(() => {});
    for (let d = 0; d < 4; d++) {
      await cap.lookAt(actorName, tx + Math.cos(d * 1.57) * 8, ty + 2, tz + Math.sin(d * 1.57) * 8);
      await sleep(150);
    }
    await cap.swing(actorName);
    results.actions.push({ explore: { target: { x: tx, y: ty, z: tz } } });
  }

  // Hunt: find the nearest hostile, walk to it, and attack it down (Fix A already
  // makes defend aim; hunt is the proactive version — go find one).
  if (step.job === 'hunt') {
    const near = await cap.worldNearby(actorName, { radius: 24, types: 'hostile' }).catch(() => null);
    const hostile = near && near.success && near.data && near.data.entities && near.data.entities[0];
    if (hostile) {
      await safeWalk(harness, actorName,
        { x: hostile.x, y: (hostile.y || groundY) + 1, z: hostile.z },
        { arrive: 2.5, timeoutMs: 7000, speed: 4.5, allowTeleport: false }).catch(() => {});
      await cap.lookAt(actorName, hostile.x, (hostile.y || groundY) + 1, hostile.z);
      const atk = await cap.attackNearest(actorName, 'hostile').catch(() => null);
      // M4: record the real swing so the combat cooldown is honest.
      try { combat.get(actorName)?.noteAttack(actorName); } catch (_) {}
      results.actions.push({ hunt: { target: hostile, attack: atk } });
    } else {
      // No hostiles nearby — roam toward the nearest mob spawn / dark patch.
      results.actions.push({ hunt: { target: null, note: 'no_hostiles_nearby' } });
    }
  }

  // Gather: forage nearby resource blocks (wood/stone/food drops) and harvest them.
  if (step.job === 'gather') {
    const targets = ['OAK_LOG', 'SPRUCE_LOG', 'STONE', 'COBBLESTONE', 'DIRT', 'GRASS_BLOCK'];
    let gathered = 0;
    for (let t = 0; t < 4; t++) {
      const ang = ((state.tick || 0) * 1.7 + t * 1.57) % (Math.PI * 2);
      const gx = Math.floor(cfg.origin.x + Math.cos(ang) * (8 + t * 2));
      const gz = Math.floor(cfg.origin.z + Math.sin(ang) * (8 + t * 2));
      const gy = await findSurfaceY(harness, gx, gz, { fallbackY: groundY, maxY: groundY + 6, minY: groundY - 3 });
      await safeWalk(harness, actorName, { x: gx, y: gy + 1, z: gz },
        { arrive: 2.5, timeoutMs: 6000, speed: 4.5, allowTeleport: false }).catch(() => {});
      // --- Inventory diff (M5) for gather break: observe REAL inventory before/after ---
      const obsBeforeG = await harness.cap.observe(actorName);
      const invBeforeG = applyObserve(obsBeforeG);
      const gPos = obsBeforeG && obsBeforeG.data
        ? { x: obsBeforeG.data.x, y: obsBeforeG.data.y, z: obsBeforeG.data.z }
        : null;
      const br = await cap.breakBlock(actorName, gx, gy, gz);
      if (br && br.success) gathered++;
      const invAfterG = applyObserve(await harness.cap.observe(actorName));
      const gDiff = diffInventory(invBeforeG, invAfterG, {
        from: `gather_break:@${gx},${gy},${gz}`,
      });
      // M6: typed `gather` event (forage resource block) with full context.
      log(buildGatherEvent({
        actor: actorName,
        job: step.job,
        target: { x: gx, y: gy, z: gz },
        held: lastHeldItem,
        toolVerdict: lastToolVerdict,
        invDiff: gDiff,
        gathered: br && br.success ? 1 : 0,
        success: !!(br && br.success),
        reason: br && !br.success ? (br.reason || br.error || 'break_failed') : null,
        position: gPos,
      }));
      await cap.swing(actorName);
    }
    results.actions.push({ gather: { gathered } });
  }

  // Torch: light the area so fewer hostiles spawn (breaks the survive-forever loop).
  // Cover a wider radius (grid ±15) so the whole village lights up, not just the center tiles.
  if (step.job === 'torch') {
    const ty = (groundY || cfg.origin.y) + 1;
    const spots = [];
    for (let dx = -15; dx <= 15; dx += 5) {
      for (let dz = -15; dz <= 15; dz += 5) {
        spots.push([dx, dz]);
      }
    }
    let placed = 0;
    // Real placement means real walking — cap the batch per tick (8 torches) instead of
    // instantly setblock-ing 49 tiles.
    // --- Inventory diff (M5): TORCH is drawn from the NPC's OWN inventory; prove it ---
    const obsBeforeTorch = await harness.cap.observe(actorName);
    let prevTorchInv = applyObserve(obsBeforeTorch);
    const torchPos = obsBeforeTorch && obsBeforeTorch.data
      ? { x: obsBeforeTorch.data.x, y: obsBeforeTorch.data.y, z: obsBeforeTorch.data.z }
      : { x: cfg.origin.x, y: ty, z: cfg.origin.z };
    for (const [dx, dz] of spots.slice(0, 8)) {
      const tx = Math.floor(cfg.origin.x + dx);
      const tz = Math.floor(cfg.origin.z + dz);
      // PLAYER-LIKE: walk into range, look, then place a torch we actually own.
      await safeWalk(harness, actorName, { x: tx, y: ty, z: tz },
        { arrive: 3, timeoutMs: 5000, speed: 4.5, allowTeleport: false }).catch(() => {});
      await cap.lookAt(actorName, tx, ty, tz).catch(() => {});
      const r = await cap.placeBlock(actorName, tx, ty, tz, 'TORCH').catch(() => null);
      if (r && r.success) placed++;
      const afterTorchInv = applyObserve(await harness.cap.observe(actorName));
      const tDiff = diffInventory(prevTorchInv, afterTorchInv, {
        from: `place:TORCH@${tx},${tz}`,
        expectedDrops: {}, // placing consumes from inventory, no drops
      });
      // M6: typed `place` event (torch lighting) with full context.
      log(buildPlaceEvent({
        actor: actorName,
        job: step.job,
        material: 'TORCH',
        target: { x: tx, y: ty, z: tz },
        held: lastHeldItem,
        invDiff: tDiff,
        success: !!(r && r.success),
        reason: r && !r.success ? (r.reason || r.error || 'place_failed') : null,
        position: torchPos,
      }));
      prevTorchInv = afterTorchInv;
    }
    results.actions.push({ torch: { placed, attempted: spots.length, playerlike: true } });
  }

  // Rest: return to base and recover (regen happens in prod; here it's a safe idle).
  if (step.job === 'rest') {
    await safeWalk(harness, actorName, { x: cfg.origin.x, y: (groundY || cfg.origin.y) + 1, z: cfg.origin.z },
      { arrive: 2, timeoutMs: 8000, speed: 4, allowTeleport: false }).catch(() => {});
    await cap.lookAt(actorName, cfg.origin.x, (groundY || cfg.origin.y) + 2, cfg.origin.z);
    await cap.swing(actorName);
    results.actions.push({ rest: { atBase: true } });
  }

  const obs = await cap.observe(actorName);
  results.observe =
    obs && obs.data ? { x: obs.data.x, y: obs.data.y, z: obs.data.z, held: obs.data.held } : null;
  // Preserve any status already set by an early-return path (e.g. M3 TOOL_REQUIRED);
  // only default to PASS when nothing more specific was recorded.
  results.status = results.status || 'PASS';
  state.actions += 1;
  return results;
}

/**
 * PLAYER-LIKE NO-OP (was: godmode gear handout).
 *
 * The old implementation ran `clear <player>` + `item replace entity <player> <slot> with
 * minecraft:diamond_*` + giveItem(GOLDEN_APPLE...) every 30s. That is admin gear from
 * nothing — a cheat. NPCs must now survive with what they mine/craft, exactly like a
 * player. Kept as a no-op so every existing call site stays valid, and so the honest
 * behaviour can never be "accidentally" re-enabled by an env var.
 */
async function equipSurvivalGear(_harness, actorName, _opts = {}) {
  _lastEquipped[actorName] = Date.now();
  return { skipped: true, reason: 'playerlike_no_admin_gear' };
}

async function connectActor(harness, name, attempt = 1) {
  await sleep(800);
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
  // BOOTSTRAP ONLY (login placement, not part of the work loop): move the fresh session to
  // the village. No gamemode switch, no gear handout — it stays in the server's survival mode.
  await actor.teleport(cfg.origin.x, cfg.origin.y + 2, cfg.origin.z);
  const alive = await ensureAlive(harness, name);
  return { actor, ok: true, alive };
}

/**
 * Town check (player-like).
 *
 * The old body founded the town with creative + admin stockpile fill + setblock bookshelves
 * + `clear` + `cv give` + `tp` + `item replace`. All of that is godmode, so it is gone.
 * We now only OBSERVE whether the town exists. If it does not, the NPC must gather the
 * materials and found it through normal play; the worker reports NEEDS_PLAYER_FOUNDING
 * instead of faking it.
 */
async function ensureTown(harness, actorName) {
  const town = await harness.assert.town(cfg.town);
  if (town && town.ok) return { status: 'PASS', town };
  // Player-like attempt: if the NPC already holds a settlement item, let IT run the command.
  let attempt = null;
  try {
    await harness.cap.hotbar(actorName, 0);
    attempt = await harness.cap.runAs(actorName, `cv town ${cfg.town} settlement`);
    await sleep(400);
  } catch (_) {
    /* best effort — no admin fallback */
  }
  const again = await harness.assert.town(cfg.town);
  return {
    status: again && again.ok ? 'PASS' : 'NEEDS_PLAYER_FOUNDING',
    town: again,
    attempt: attempt ? String(attempt).slice(0, 160) : null,
    playerlike: true,
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

/**
 * Objective / commitment layer.
 *
 * The old `nextJob(tick)` rotated jobs every tick, so agents never finished anything —
 * they walked to a site, did one action, then walked away to the next job. That read as
 * "walking around like an idiot". This keeps an agent on ONE objective until it makes enough
 * meaningful progress (or survival escalates), then picks the next objective coherently.
 *
 * The chosen objective is still derived from chooseFocus (survive/build/maintain/...) so it
 * stays compatible with the existing intention cache; only the *commitment* is new.
 *
 * @param {object} state worker state (holds state.objective between ticks)
 * @param {{ state:string }} assessment survival verdict
 * @param {object} focusCandidate result of chooseFocus({focus,reason,contextKey})
 * @param {number} progress accumulated meaningful progress for the current objective
 */
const OBJECTIVE_GOALS = Object.freeze({
  miner: 4, // break at least 4 blocks
  lumberjack: 3,
  builder: 6, // place ~6 blocks of a structure
  beautify: 4,
  farmer: 3,
  guard: 3, // 3 patrol/guard steps
  patrol: 3,
  placeregion: 1, // founding a region counts as done immediately
  explore: 5, // travel to + scan 5 distinct waypoints
  hunt: 3, // defeat 3 hostiles
  gather: 4, // collect 4 resource drops
  torch: 8, // place 8 torches to light the area
  rest: 1, // return to base and recover
});

function chooseObjective(state, assessment, focusCandidate) {
  const surv = assessment.state || 'SAFE';
  // Survival always wins the commitment: if in danger, the objective is to survive.
  if (surv !== 'SAFE' && surv !== 'CAUTION') {
    return { job: 'guard', focus: 'survive', reason: `survival:${surv}`, committed: true };
  }

  // Brain said "survive" with a REAL threat (hostile nearby) — interrupt the current objective
  // and switch to guard (flee/defend), even if the prior job had progress. Being merely DARK is
  // not a threat by itself (the village is unlit) — only an actual mob nearby forces a flee,
  // otherwise the agent would get stuck standing still "guarding" forever (the burro bug).
  const threatNear = Array.isArray(assessment.threats) &&
    assessment.threats.includes('hostile_nearby');
  const cur = state.objective;
  if (focusCandidate.focus === 'survive' && threatNear) {
    // Actively HUNT nearby mobs (progress via hunt goal of 3) instead of standing guard forever.
    // hunt completes after 3 kills, so the agent makes real progress and rotates to other jobs,
    // rather than re-entering an endless guard loop (the burro bug).
    return { job: 'hunt', focus: 'survive', reason: 'ollama_survive_hunt', committed: true };
  }
  // Brain said "survive" because it's DARK (unlit village) but no mob is right next to us.
  // Light the area (torch job) so fewer hostiles spawn and we exit the CAUTION/dark state,
  // instead of loitering in the dark forever.
  const dark = Array.isArray(assessment.threats) && assessment.threats.includes('dark');
  if (focusCandidate.focus === 'survive' && dark) {
    return { job: 'torch', focus: 'survive', reason: 'ollama_survive_torch', committed: true };
  }
  // Build-for-growth: once the settlement is established, the village must KEEP GROWING or the
  // agent looks "burro" (explores/torches forever, completedPlaces frozen at 3). When safe-ish
  // (SAFE/CAUTION) and NO hostile is near, found the NEXT unbuilt Civs region via placeregion
  // (the only path that increments completedPlaces and grows the village). Dark is fine — founding
  // also lights the area. Fall back to builder (decorative blocks) only if every region is done/blocked.
  const established = Object.keys(state.completedPlaces || {}).length >= 3;
  // Fire growth whenever established and we're past the survival guard (SAFE/CAUTION). We do NOT
  // gate on !threatNear: the unlit village constantly spawns mobs, so requiring no hostile would
  // deadlock growth forever (dark -> mobs -> blocked -> stays dark). Founding is near-instant
  // (creative mode + placeregion), so a distant mob is acceptable; real DANGER is caught above.
  if (established && (surv === 'SAFE' || surv === 'CAUTION')) {
    const attempt = nextPlaceAttempt(state);
    if (attempt) {
      return {
        job: 'placeregion',
        focus: 'build',
        type: attempt.type,
        site: attempt.site,
        dx: attempt.dx,
        dz: attempt.dz,
        stockpile: attempt.stockpile,
        reason: 'growth:found_next_region',
        committed: false,
      };
    }
    // All region types done or blocked (Civs build-reqs / disabled types in QA). Instead of
    // building blocks forever (looked "burro"), rotate the Steve across the FULL Minecraft loop —
    // mine the quarry, chop wood, forage, farm, and occasionally build — so he's visibly doing
    // everything, not stuck in one job.
    // STABLE-FOCUS FIX: do NOT re-pick from the LOOP every tick — that made Steve jump between 5
    // pads each tick (looked like wandering / stopping for no reason). Keep the current loop job
    // until its goal is reached, THEN advance to the next LOOP entry. We track loop position in
    // state.loopIdx so progress is monotonic, not tick%-driven.
    const LOOP = ['miner', 'lumberjack', 'gather', 'farmer', 'builder'];
    const curLoopJob = cur && LOOP.includes(cur.job) ? cur.job : null;
    if (curLoopJob && (state.objectiveProgress || 0) < (OBJECTIVE_GOALS[curLoopJob] || 3)) {
      return { ...cur, committed: true, reason: 'continuing_loop:' + curLoopJob };
    }
    const loopIdx = Number.isFinite(state.loopIdx) ? state.loopIdx : 0;
    const loopJob = LOOP[loopIdx % LOOP.length];
    state.loopIdx = (loopIdx + 1) % LOOP.length;
    return {
      job: loopJob,
      focus: loopJob === 'builder' ? 'build' : 'maintain',
      reason: 'growth:loop_' + loopJob,
      committed: false,
    };
  }
  // Keep the current objective until it makes enough meaningful progress, REGARDLESS of
  // focus-cache churn — the focus can flip build/maintain every ~30s, but the agent should
  // finish what it started (e.g. place the farm fence) before switching.
  // NOTE: objectiveProgress is NOT reset here — it is cleared in the act step (4) once the
  // goal is actually reached, so the commit log reflects accumulated progress.
  if (cur) {
    const goal = OBJECTIVE_GOALS[cur.job] || 3;
    if ((state.objectiveProgress || 0) < goal) {
      return { ...cur, committed: true, reason: 'continuing' };
    }
    // Goal reached — clear so we can pick a fresh one next tick.
    state.objective = null;
  }

  // New objective: prefer a job that serves the chosen focus, else rotate by tick.
  const focus = focusCandidate.focus;
  // Map EVERY focus (including the rich rotation set explore/hunt/gather/torch/rest) to its
  // OWN job. Without explicit keys here, the rich foci fell through to the `|| 'explore'`
  // default and the rotation produced no variety (Steve only ever explored/farmed).
  const jobForFocus =
    {
      survive: 'hunt', // actively fight nearby mobs (progress via hunt goal) instead of standing guard forever
      found: 'explore', // founding done -> roam the map and scan (was placeregion)
      build: (state.tick || 0) % 2 === 0 ? 'builder' : 'torch', // alternate building with lighting
      // maintain rotates across ALL the productive village jobs (gather/farm/miner/lumberjack)
      // so the Steve actually exercises the full Minecraft loop (forage, farm, dig stone/ore, chop wood)
      // instead of just farming forever.
      maintain: ['gather', 'farmer', 'miner', 'lumberjack'][(state.tick || 0) % 4],
      secure: (state.tick || 0) % 2 === 0 ? 'hunt' : 'rest', // alternate hunting with recovering
      explore: 'explore', // roam + scan the map
      hunt: 'hunt', // seek and defeat hostiles
      gather: 'gather', // forage wood/stone/food
      miner: 'miner', // dig the quarry for stone/ore (core Minecraft resource loop)
      lumberjack: 'lumberjack', // chop wood for building materials
      torch: 'torch', // light the area to suppress spawns
      rest: 'rest', // return to base and recover
    }[focus] || 'explore';
  const job =
    jobForFocus === 'placeregion' &&
    state.completedPlaces &&
    state.completedPlaces.shack &&
    state.completedPlaces.potato_farm &&
    state.completedPlaces.inn &&
    state.completedPlaces.barracks
      ? 'beautify'
      : jobForFocus;
  const next = { job, focus, reason: `new:${focus}`, committed: false };
  state.objective = next;
  state.objectiveProgress = 0;
  return next;
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
  // ping desabilitado — servidor Minecraft não tem comando 'ping' no RCON
  // const ping = await harness.ping();
  // if (!ping || ping.pong !== '1') {
  //   log({ status: 'BLOCKED', action: 'ping', ping });
  //   process.exit(1);
  // }
  log({ status: 'PASS', action: 'init', reason: 'RCON autenticado com sucesso' });

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

  // Name -> actor handle, so the work loop can re-ensure the player is online each tick.
  const actorByName = { [cfg.actorName]: primary.actor };
  if (helper && helper.ok) actorByName[cfg.helperName] = helper.actor;

  // Name -> persistent ai-world agent (memory + goals + personality). Loaded from disk so
  // NPCs remember across process / server restarts (Phase 2 of the Living AI World audit).
  const agentByName = {};
  const regPrimary = rt.loadOrCreateAgent(cfg.actorName, {
    occupation: 'builder',
    origin: cfg.origin,
  });
  agentByName[cfg.actorName] = regPrimary;
  log({
    status: 'PASS',
    action: 'agent_loaded',
    worker: cfg.actorName,
    episodes: regPrimary.memory.episodic.length,
    semantic: Object.keys(regPrimary.memory.semantic).length,
  });
  if (helper && helper.ok) {
    const regHelper = rt.loadOrCreateAgent(cfg.helperName, {
      occupation: 'helper',
      origin: cfg.origin,
    });
    agentByName[cfg.helperName] = regHelper;
    log({
      status: 'PASS',
      action: 'agent_loaded',
      worker: cfg.helperName,
      episodes: regHelper.memory.episodic.length,
      semantic: Object.keys(regHelper.memory.semantic).length,
    });
  }

  // Phase 5+6: Hermes Bridge + NPC cooperation. The bridge owns the bus + shared world
  // memory; the cooperation layer (AgentCooperation) adds semantic 'share' messages between
  // NPCs (brief §11) on top of the same bus Hermes publishes to (brief §16).
  const hermesBridge = new HermesBridge({
    transport: new (require('@daniel730/aiworld/hermes-bridge').LocalHermesStub)(),
    onLog: (entry) => log(entry),
  });
  // Lazily-built cooperation object (AgentCooperation) — owns the same bus + worldMemory,
  // publishes semantic shares between NPCs, and mirrors SPATIAL facts into shared worldMemory.
  const cooperation = hermesBridge.cooperation;

  await sleep(2500);
  // The camera (spectator Cam) must NEVER block the core work loop. Both the SpectatorCamera
  // *constructor* (it connects to the MC server as Cam) and camera.start() can hang forever when
  // the spectator account can't log in / server unreachable. Race the whole setup against a timeout
  // and proceed headless on ANY failure so Steve keeps working autonomously.
  const withTimeout = (p, ms, label) =>
    Promise.race([
      p,
      new Promise((res) => setTimeout(() => res({ status: 'TIMEOUT', reason: label + '_timeout' }), ms)),
    ]);
  let camera = null;
  let camStart = { status: 'BLOCKED', reason: 'camera_setup_skipped' };
  try {
    camera = await withTimeout(
      (async () => {
        const cam = new SpectatorCamera({
          harness,
          host: cfg.mcHost,
          port: cfg.mcPort,
          name: cfg.cameraName,
          version: cfg.version,
          targetName: cfg.actorName,
        });
        const s = await withTimeout(cam.start(), 20000, 'camera_start');
        return { cam, s };
      })(),
      25000,
      'camera_setup'
    );
    if (camera && camera.cam && camera.s && camera.s.status === 'PASS') {
      camera = camera.cam;
      camStart = camera.s;
    } else {
      camera = null;
      const reason = (camera && camera.s && camera.s.reason) || 'camera_start_failed';
      camStart = { status: 'BLOCKED', reason };
    }
  } catch (_) {
    camera = null;
    camStart = { status: 'BLOCKED', reason: 'camera_setup_exception' };
  }
  // Hard safety net: guarantee camStart is a valid object so the observation/director
  // selection below can never crash on `camStart.status`.
  if (!camStart || typeof camStart.status !== 'string') {
    camStart = { status: 'BLOCKED', reason: (camStart && camStart.reason) || 'camStart_normalized' };
  }
  log({ status: (camStart && camStart.status) || 'BLOCKED', action: 'camera_start', ...(camStart || {}) });
  if ((camStart && camStart.status) !== 'PASS') {
    log({
      status: 'BLOCKED',
      action: 'camera_required',
      reason: (camStart && camStart.reason) || 'camera_start_failed',
    });
    // Do NOT exit — the loop can run without camera (degraded mode).
    // The camera is used for observation/cinematic, not for the core work loop.
  }

  const subjects = [cfg.actorName];
  if (helper && helper.ok) subjects.push(cfg.helperName);

  // When the camera failed to start, run HEADLESS: a no-op observation so the core work
  // loop still executes (Steve keeps mining/building/farming without the cinematic camera).
  // The camera is purely for observation/cinematic — it must never gate actual work.
  const headlessObservation = {
    start() {},
    stop() {},
    tick() {},
    biasTo() {},
    noteEvent() {},
    snapshot() { return { headless: true }; },
    get currentSubject() { return null; },
  };

  const observation = camStart.status === 'PASS'
    ? (cfg.legacyCamera
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
        }))
    : headlessObservation;
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
  // M4: per-agent combat/survival logging tracker (attack cooldown memory, hazards).
  const combat = new Map();
  for (const name of subjects) {
    combat.set(name, new CombatLog({ actor: name, attackCooldownMs: ATTACK_COOLDOWN_MS }));
  }
  const intentions = new IntentionCache();
  const antiStall = new AntiStall({ noProgressMs: Math.max(12000, cfg.intervalMs * 3) });
  // AI World neural layer: maps each agent to its most recent experience episodeId,
  // so a terminal outcome (death / stall / goal) can be attached to the decision later.
  const lastEpisode = {};
  // W1: per-agent spatial/episodic memory of the world (threats seen, deaths, blocks).
  // Lets the agent "absorb" the world instead of re-deriving everything from one observe().
  const { WorldMemory } = require('@daniel730/aiworld/world-memory');
  const worldMemory = {};
  const getWorldMemory = (who) => (worldMemory[who] || (worldMemory[who] = new WorldMemory({ agentId: who, dir: path.join(os.tmpdir(), 'aiw-wm') })));
  // CONSULT_LLM hook: optional planner via AI_WORLD_CONSULT_PLANNER (default off → log only).
  // The gate guarantees at most one consult per goalKey and a per-agent cooldown — never per-tick.
  // Phase 5: when AI_WORLD_CONSULT_PLANNER=hermes, the gate's planner is the HermesPlanner
  // from hermesBridge, so anti-stall escalations consult Hermes (operational answers only).
  const consultGate = new ConsultGate({
    planner: plannerFromEnv() || hermesBridge.planner,
    onLog: (entry) => log(entry),
  });

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
    // Phase 2: flush persistent agent memory to disk periodically so NPCs remember
    // across restarts. Done FIRST (before the survival/try branch) so it runs even when
    // the agent is in danger and the loop returns early after the survival action.
    // Every 10 ticks (~2 min) is frequent enough to survive a crash without thrashing disk.
    if (state.tick % 10 === 0) {
      for (const name of Object.keys(agentByName)) {
        try {
          rt.saveAgent(agentByName[name]);
        } catch (_) {
          /* best-effort */
        }
      }
    }
    try {
      const town = await harness.assert.town(cfg.town);
      if ((!town || !town.ok) && state.tick % 12 === 1) {
        const recovery = await ensureTown(harness, cfg.actorName);
        log({ status: recovery.status, action: 'ensure_town', recovery });
      }
      const who = helper && helper.ok && state.tick % 2 === 0 ? cfg.helperName : cfg.actorName;

      // 0a. Keep the player client online (auto-heal dropped keepalive connections).
      const actor = actorByName[who];
      if (actor) {
        try {
          const ok = await actor.ensureOnline();
          if (!ok) {
            log({ status: 'DEGRADED', action: 'actor_reconnect', worker: who, online: false });
          }
        } catch (_) {
          /* best effort */
        }
      }

      // 0c. Camera health check — if the spectator actor dropped mid-run, try to bring it
      // back so cinematic/observation keep working without a full worker restart.
      // Best-effort: a camera that stays down does not block the core work loop.
      if (cfg.cameraName) {
        try {
          const camActor = camera.actor;
          if (camActor && typeof camActor.isOnline === 'function' && !camActor.isOnline()) {
            log({ status: 'DEGRADED', action: 'camera_health', online: false });
            try {
              await camera.stopLoop();
              await camera.stop();
              const restart = await camera.start();
              log({
                status: restart.status === 'PASS' ? 'PASS' : 'DEGRADED',
                action: 'camera_restart',
                status: restart.status,
                reason: restart.reason,
              });
            } catch (_) {
              /* best effort */
            }
          }
        } catch (_) {
          /* best effort — camera monitor must never break a work tick */
        }
      }

      // 0b. Keep survival gear topped up BEFORE the survival assessment, so a bot in danger
      // still gets armour (otherwise it dies before runJob's ensureAlive ever runs).
      try {
        await equipSurvivalGear(harness, who);
      } catch (_) {
        /* best effort */
      }

      // 1. Perception + survival. Survival always outranks the job rotation.
            const observed = await harness.cap.observe(who);
            const monitor = survival.get(who);
            const assessment = monitor
              ? monitor.assess((observed && observed.data) || {})
              : { state: 'SAFE', action: { kind: 'work' }, changed: false };

            // --- Combat/survival event (M4: lib/combat-log.js CombatLog) --------------
            // Built from the REAL flat observe payload so attacker / light / hazards
            // are populated (the old version read camelCase fields that don't exist).
            try {
              const od = (observed && observed.data) || {};
              const combatLog = combat.get(who);
              const evt = combatLog
                ? combatLog.assess(od, {
                    actor: who,
                    survivalState: assessment.state,
                    job: state.currentJob || null,
                  })
                : { kind: 'combat_survival', error: 'no_combat_log' };
              log(evt);
            } catch (e) {
              log({ kind: 'combat_survival_error', error: String(e) });
            }
            // -----------------------------------------------------------------------

      // W2: feed the world memory from this tick's observation so the agent "absorbs" the world.
      // The observe payload carries deaths/last_damage/light even when no mob is in range, so the
      // agent builds a memory of WHERE and HOW it gets hurt — not just when a hostile is visible.
      try {
        const wm = getWorldMemory(who);
        const od = (observed && observed.data) || {};
        const pos = { x: od.x, z: od.z };
        if (assessment.threats && assessment.threats.length) {
          for (const t of assessment.threats) {
            const h = (od.nearest_hostile) || {};
            wm.noteThreat({ x: h.x, z: h.z, type: t, distance: h.distance, severity: assessment.state === 'ESCAPE' ? 3 : 1 });
          }
        }
        if (od.nearest_hostile) {
          wm.noteThreat({ x: od.nearest_hostile.x, z: od.nearest_hostile.z, type: od.nearest_hostile.type, distance: od.nearest_hostile.distance });
        }
        // Even without a visible mob, damage/death are ground-truth signals of a dangerous world.
        if (typeof od.last_damage === 'number' && od.last_damage > 0) {
          wm.noteDamage(od.last_damage_cause || 'unknown', od.last_damage);
        }
        if (typeof od.deaths === 'number') {
          const prev = (state.lastDeaths && state.lastDeaths[who]) || 0;
          if (od.deaths > prev) wm.noteDeath(od.deaths);
          state.lastDeaths = state.lastDeaths || {};
          state.lastDeaths[who] = od.deaths;
        }
        wm.noteSurroundings({ lightLevel: od.light_level, blockBelow: od.block_below });
        // expose memory features to the focus decision below
        assessment.worldMemory = wm.features(pos);
      } catch (_) { /* best-effort */ }

      // B1: survival has HIGHER priority than work. If the monitor says flee/defend/retreat/recover
      // (state not SAFE/CAUTION), execute that action and skip the work tick entirely — never let
      // the agent keep building while a mob is killing it. This realizes the priority chain
      // EMERGENCY→DANGER→RECOVER→SURVIVE→TASK→EXPLORE/BUILD/MINE. Death is still handled below.
      // Connection blips (no login within 15s / ECONNRESET) make the monitor report DANGER,
      // but that is NOT a real threat — the actor auto-reconnects. Freezing on it halts the
      // whole agent forever (0 objectives). Skip the survival-preempt when the actor link is
      // down so the normal loop keeps running and the reconnect recovers.
      const connDown = actor && actor.available === false;
      if (!connDown && assessment.state !== 'SAFE' && assessment.state !== 'CAUTION' && assessment.action && assessment.action.kind !== 'work') {
        const od = (observed && observed.data) || {};
        log({
          status: 'DEGRADED',
          action: 'survival_preempt',
          worker: who,
          state: assessment.state,
          recommended: assessment.action.kind,
          healthPct: assessment.healthPct,
          food: od.food,
          threats: assessment.threats,
          walk_origin: cfg.origin,
        });
        try {
          const sv = await executeSurvival(harness, who, assessment, { workOrigin: cfg.origin, combatLogger: combat.get(who) });
          log({
            status: sv && sv.handled ? 'PASS' : 'DEGRADED',
            action: 'survival_executed',
            worker: who,
            kind: assessment.action.kind,
            handled: !!(sv && sv.handled),
            steps: sv && sv.steps ? JSON.stringify(sv.steps) : null,
          });
          if (sv && sv.handled) {
            observeMetric(METRIC.AIWORLD_POLICY_DISAGREEMENT, { agent: who, mode: 'survival_preempt' });
            saveState(state);
            return; // next tick (setInterval) — re-assess; do NOT run the work loop this tick
          }
        } catch (err) {
          log({ status: 'DEGRADED', action: 'survival_exec_error', worker: who, error: String(err && err.message || err) });
        }
      }

      // Phase 5: consult Hermes by the brief §15 triggers — evaluated RIGHT AFTER the
      // assessment (before the survival early-return) so it also fires when the agent is
      // in danger, not only on safe ticks. Signals are cheap, in-scope facts:
      //   low health -> low confidence; ESCAPE/RECOVER -> high novelty (unprecedented).
      try {
        const ag = agentByName[who];
        if (ag) {
          const healthPct = assessment.healthPct != null ? assessment.healthPct : 1;
          const novelState = assessment.state === 'ESCAPE' || assessment.state === 'RECOVER';
          const triggers = evaluateTriggers(ag, (observed && observed.data) || {}, {
            confidence: healthPct < 0.4 ? 0.2 : healthPct < 0.7 ? 0.45 : 0.8,
            novelty: novelState ? 0.7 : 0.1,
            failedAttempts: ag._failedAttempts || 0,
            goalConflict: false,
            explicitAsk: false,
          });
          if (triggers.consult) {
            const ans = await hermesBridge.ask(
              who,
              `state=${assessment.state} health=${Math.round(healthPct * 100)}%`,
              {
                focus:
                  assessment.state !== 'SAFE' && assessment.state !== 'CAUTION'
                    ? 'survive'
                    : 'work',
                job: null,
                goalKey: `${who}:${assessment.state}:${ag.goals.current ? ag.goals.current.title : 'none'}`,
                novelty: novelState ? 0.7 : 0.1,
                confidence: healthPct < 0.4 ? 0.2 : healthPct < 0.7 ? 0.45 : 0.8,
              }
            );
            rt.recordEpisode(ag, {
              type: 'hermes_consult',
              summary: `Asked Hermes (${triggers.reasons.join(',')}): ${ans.reasoning_summary || ans.decision}`,
              importance: 0.7,
              tags: ['hermes', ...triggers.reasons],
            });
            // Flush immediately so the mentor's advice survives a crash/restart (brief §3).
            try {
              rt.saveAgent(ag);
            } catch (_) {
              /* best-effort */
            }
          }
        }
      } catch (_) {
        /* best-effort */
      }

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
        // A3: attach outcome to the CURRENT tick's decision (not lastEpisode from the previous
        // tick). Record a fresh 'survive' decision for this tick and close it — so death is
        // attributed to the decision that was actually live, not a stale one.
        try {
          const epNow = recordFocusDecision({
            agentId: who,
            observation: (observed && observed.data) || {},
            focus: 'survive',
            candidates: FOCUSES.map((f) => ({ id: f, base: f === 'survive' ? 1 : 0.5, motive: 'focus' })),
            survivalState: assessment.state,
            distWork: assessment.distanceFromWork,
            personality: { occupation: cfg.actorName === who ? 'builder' : 'helper' },
          });
          if (epNow) recordFocusOutcome(who, epNow, { died: true, goalFailed: true, damageTaken: 20 });
        } catch (_) {
          /* best-effort */
        }
        // Phase 2: persistent memory — a death is an important episode to remember.
        try {
          const ag = agentByName[who];
          if (ag) {
            rt.recordEpisode(ag, {
              type: 'death',
              summary: `Died near work (${assessment.deathCause || 'unknown'})`,
              importance: 0.8,
              tags: ['death', assessment.deathCause || 'unknown'],
            });
            rt.closeCurrentGoal(ag, 'abandoned');
          }
        } catch (err) {
          /* best-effort — survival_action failure is not fatal */
        }
        if (typeof observation.noteEvent === 'function') observation.noteEvent(who, 'danger_survival');
        saveState(state);
        return;
      }

      // 2. Intention (cached 20-60 s) then the committed objective for this agent.
      //    Replaces the old per-tick nextJob() rotation: the agent stays on ONE objective
      //    until it makes enough meaningful progress, so it actually builds/mines/farms.
      const decisionStart = Date.now();
      const focusCandidate = chooseFocus(state, {
        survivalState: assessment.state,
        townOk: !!(town && town.ok),
        worldMemory: assessment.worldMemory,
      });
      // --- AI World: neural-mode focus re-ranking (LIVE inference, deterministic fallback) ---
      // The neural policy has already been trained offline (scripts/aiworld-train.js) and its
      // weights are loaded by NeuralPolicy at startup. In `neural` mode it may RE-RANK the focus
      // candidates and pick a different one than the deterministic chooseFocus — but ONLY when
      // that choice is safe (never overrides survival). In `shadow` mode the decision is recorded
      // for comparison but the deterministic focus still executes. Any fault falls back to the
      // deterministic focus (never crashes, never overrides a broken model).
      let effectiveFocus = focusCandidate;
      // Default to the Ollama local-LLM brain (Dan wants the Steve autonomous + intelligent).
      // Only an explicit 'deterministic' / 'neural' / 'shadow' env overrides it. A missing/lost
      // AIWORLD_POLICY env must NOT silently drop the brain back to the dumb deterministic path.
      const aiwMode = (process.env.AIWORLD_POLICY || 'ollama').toLowerCase();
      if (process.env.AIWORLD_DEBUG) {
        console.log('[ollama-debug] aiwMode=' + aiwMode + ' policyEnv=' + process.env.AIWORLD_POLICY);
      }
      if (aiwMode === 'neural' || aiwMode === 'shadow') {
        try {
          const pol = aiPolicy();
          const stateRep = encodeState((observed && observed.data) || {}, {
            survival: { state: assessment.state, distanceFromWork: assessment.distanceFromWork },
          });
          const candidates = FOCUSES.map((f) => ({ id: f, base: f === focusCandidate.focus ? 1 : 0.5 }));
          const pick = pol.choose(stateRep.vec, candidates, assessment.state);
          if (pick && pick.id && pick.id !== focusCandidate.focus) {
            // Safety gate: never let the neural policy pick 'survive' when the survival monitor
            // says SAFE/CAUTION (that would be over-reacting), and never pick a non-survive focus
            // when the monitor says DANGER/ESCAPE/RECOVER (that would be under-reacting).
            const monitorSafe = assessment.state === 'SAFE' || assessment.state === 'CAUTION';
            const neuralSafe =
              (pick.id === 'survive' && !monitorSafe) || (pick.id !== 'survive' && monitorSafe);
            if (neuralSafe) {
              effectiveFocus = {
                ...focusCandidate,
                focus: pick.id,
                reason: `neural_policy(${pick.usedModel})`,
              };
              observeMetric(METRIC.AIWORLD_POLICY_DISAGREEMENT, { agent: who, mode: aiwMode });
            }
          }
        } catch (_) {
          /* best-effort: any fault keeps the deterministic focus */
        }
      }
      // Ollama local-LLM brain: replaces the deterministic chooseFocus with a real decision.
      // In 'ollama' mode the LLM focus executes; in 'ollama-shadow' it only logs (deterministic
      // still executes) for side-by-side comparison. Any failure falls back to focusCandidate.
      let ollamaBrainInst = null;
      if (aiwMode === 'ollama' || aiwMode === 'ollama-shadow') {
        try {
          if (!ollamaBrainInst) {
            ollamaBrainInst = new OllamaBrain({
              endpoint: process.env.OLLAMA_ENDPOINT,
              model: process.env.OLLAMA_MODEL,
              systemPrompt: process.env.OLLAMA_SYSTEM_PROMPT || null,
            });
          }
          const od = (observed && observed.data) || {};
          const snap = {
            healthPct: assessment.healthPct,
            survivalState: assessment.state,
            x: od.x,
            z: od.z,
            threats: assessment.threats || [],
            nearestThreatDist: (assessment.worldMemory && assessment.worldMemory.nearestThreatDist) || -1,
            dangerZone: !!(assessment.worldMemory && assessment.worldMemory.dangerZone === 1),
            // W: pass the FULL world-memory object so the LLM decides with spatial context
            // (remembered threats, blocks placed/broken, deaths, damage, darkness) — not just the
            // instantaneous observation. This is what makes the NPC "absorb the world".
            worldMemory: assessment.worldMemory || {},
            deaths: (assessment.worldMemory && assessment.worldMemory.deaths) || (od.deaths || 0),
            lastDamageCause: (assessment.worldMemory && assessment.worldMemory.lastDamageCause) || od.last_damage_cause || null,
            lightLevel: (assessment.worldMemory && assessment.worldMemory.lightLevel) >= 0 ? assessment.worldMemory.lightLevel : (od.light_level != null ? od.light_level : -1),
            blockBelow: (assessment.worldMemory && assessment.worldMemory.blockBelow) || od.block_below || null,
            nearestHostile: od.nearest_hostile || null,
            currentFocus: focusCandidate.focus,
            completedPlaces: Object.keys(state.completedPlaces || {}).length,
          };
          if (process.env.AIWORLD_DEBUG) {
            console.log('[ollama-debug] snap=' + JSON.stringify(snap));
          }
          // DECISION CACHE: calling Ollama every tick freezes the Steve for ~60-120s while he
          // waits (looked "burro" — stood still between actions). Cache the brain's focus for
          // FOCUS_TTL ms and only re-query when it expires OR survival escalates to DANGER/ESCAPE
          // (so he still reacts instantly to real threats). Between calls the cached focus drives
          // per-tick sub-actions (mine/break/walk) with ZERO brain latency -> looks autonomous.
          const FOCUS_TTL = 45000;
          const survEscalated = assessment.state === 'DANGER' || assessment.state === 'ESCAPE';
          const cacheFresh =
            state.cachedFocus &&
            (state.cachedFocusUntil || 0) > Date.now() &&
            !(survEscalated && state.cachedFocusSafe);
          let decision = cacheFresh ? state.cachedDecision : null;
          if (!decision) {
            decision = await ollamaBrainInst.decide(snap);
            if (decision && FOCUSES.includes(decision.focus)) {
              state.cachedFocus = decision.focus;
              state.cachedFocusUntil = Date.now() + FOCUS_TTL;
              state.cachedFocusSafe = assessment.state === 'SAFE' || assessment.state === 'CAUTION';
              state.cachedDecision = decision;
            }
          }
          if (process.env.AIWORLD_DEBUG) {
            console.log('[ollama-debug] mode=' + aiwMode + ' model=' + ollamaBrainInst.model + ' decision=' + JSON.stringify(decision));
          }
          if (decision && FOCUSES.includes(decision.focus)) {
            if (aiwMode === 'ollama') {
              effectiveFocus = {
                ...focusCandidate,
                focus: decision.focus,
                reason: `ollama(${ollamaBrainInst.model}):${decision.reason}`,
              };
            }
            log({
              status: 'PASS',
              action: 'ollama_decision',
              worker: who,
              focus: decision.focus,
              reason: decision.reason,
              shadow: aiwMode === 'ollama-shadow',
            });
            observeMetric(METRIC.AIWORLD_POLICY_DISAGREEMENT, { agent: who, mode: aiwMode });
          }
        } catch (err) {
          if (process.env.AIWORLD_DEBUG) console.log('[ollama-debug] decide threw: ' + (err && err.message));
          /* best-effort: keep deterministic focus */
        }
      }
      // Honor an explicit BUILD intent from the brain so the village actually grows. The
      // anti-fixation rotation below would otherwise silently discard 'build' and keep Steve
      // farming/exploring/torching forever — leaving completedPlaces stuck (the "burro" bug).
      // Only rotate non-build foci; a build decision is respected as-is.
      if ((assessment.state === 'SAFE' || assessment.state === 'CAUTION') && effectiveFocus.focus !== 'build') {
        const RICH = ['explore', 'hunt', 'gather', 'torch', 'rest', 'maintain', 'miner', 'lumberjack'];
        // TENURE: hold a focus for N ticks before rotating. Flipping every tick reset objective
        // progress each loop -> the Steve never finished a goal (goal_completed ~0). With a
        // tenure, the same job/site runs repeatedly and reaches OBJECTIVE_GOALS, so he
        // actually completes what he starts while still varying over time.
        const TENURE = 14;
        const rotated = RICH[Math.floor((state.tick || 0) / TENURE) % RICH.length];
        effectiveFocus = {
          ...effectiveFocus,
          focus: rotated,
          // also rotate the cache key so the IntentionCache doesn't return the
          // previously-cached (stale) focus and silently discard this rotation.
          contextKey: 'rich_' + rotated,
          reason: `rich_rotation(${rotated})`,
        };
      }
      const cached = intentions.get(who, effectiveFocus.contextKey);
      const intention = cached.hit ? cached.intention : effectiveFocus;
      if (!cached.hit) {
        intentions.set(who, effectiveFocus, { contextKey: effectiveFocus.contextKey });
        log({
          status: 'PASS',
          action: 'intention_set',
          worker: who,
          focus: effectiveFocus.focus,
          reason: effectiveFocus.reason,
          cacheMiss: cached.reason,
        });
      }
      const objective = chooseObjective(state, assessment, effectiveFocus);
      const step = biasJob(nextJob(state.tick, state), objective.focus, state.tick);
      // Override the blind rotation with the committed job so the agent keeps working
      // the same objective (site + job) until its progress goal is met.
      step.job = objective.job;
      step.focus = objective.focus;
      const siteKey = siteForJob(objective.job, state.tick);
      step.site = siteKey;
      Object.assign(step, SITES[siteKey]);
      // Carry founding metadata (placeregion type/dx/dz/stockpile) from chooseObjective so the
      // village actually grows (completedPlaces increments). On non-11 ticks nextJob omits these.
      if (objective.type) {
        step.type = objective.type;
        step.dx = objective.dx;
        step.dz = objective.dz;
        step.stockpile = objective.stockpile;
        if (objective.site) step.site = objective.site;
      }
      log({
        status: 'PASS',
        action: 'objective_commit',
        worker: who,
        job: step.job,
        site: siteKey,
        focus: objective.focus,
        reason: objective.reason,
        committed: objective.committed,
        progress: state.objectiveProgress || 0,
        goal: OBJECTIVE_GOALS[step.job] || 3,
      });
      observeMetric(METRIC.DECISION_LATENCY, Date.now() - decisionStart, {
        actor: who,
        cached: String(cached.hit),
      });

      // AI World neural layer (MVP): record every real focus decision into the experience
      // dataset. In shadow/neural mode the policy also scores (recorded, not controlling).
      // Purely additive — never changes what the agent actually does.
      try {
        const ep = recordFocusDecision({
          agentId: who,
          observation: (observed && observed.data) || {},
          focus: effectiveFocus.focus,
          candidates: FOCUSES.map((f) => ({
            id: f,
            base: f === effectiveFocus.focus ? 1 : 0.5,
            motive: 'focus',
          })),
          survivalState: assessment.state,
          distWork: assessment.distanceFromWork,
          personality: { occupation: cfg.actorName === who ? 'builder' : 'helper' },
        });
        if (ep) lastEpisode[who] = ep;
      } catch (_) {
        /* experience recording must never break the work tick */
      }

      // Phase 2: persistent memory — remember the committed objective as an episode and a goal.
      try {
        const ag = agentByName[who];
        if (ag) {
          rt.recordEpisode(ag, {
            type: 'objective',
            summary: `Working ${step.job} @ ${siteKey} (${objective.focus})`,
            importance: 0.5,
            tags: [step.job, siteKey, objective.focus],
          });
          if (!ag.goals.current || ag.goals.current.title !== `Objective: ${step.job}`) {
            rt.commitGoal(ag, {
              kind: 'current',
              title: `Objective: ${step.job}`,
              motive: objective.focus,
              priority: 0.7,
            });
          }
        }
      } catch (_) {
        /* best-effort */
      }
      // Phase 6: NPC cooperation — share the current activity with peers so they can
      // coordinate (e.g. Alex joins Steve's mine, Steve retreats when Alex reports combat).
      // Best-effort: a failed share must never break the work tick.
      try {
        const ag = agentByName[who];
        if (ag && cooperation && typeof cooperation.publishSituation === 'function') {
          const situation = semanticFor({
            who,
            job: step.job,
            site: step.site,
            observation: (observed && observed.data) || {},
          });
          if (situation) await cooperation.publishSituation(who, situation);
        }
      } catch (_) {
        /* best-effort */
      }
      const prevJob = state.agentJobs[who] || null;
      if (typeof observation.setActivity === 'function') {
        observation.setActivity(who, step.job);
      }

      // 3. Act. Guard against a HANGING job (e.g. construction.runProject awaiting an
      // unresolved call) so ONE stuck job can never stall the whole work loop. The loop
      // must keep ticking and executing the jobs that DO work (mine/gather/torch/explore) —
      // otherwise the Steve looks frozen (only survival/defend runs, everything else stalls).
      const actionStart = Date.now();
      const RUN_JOB_TIMEOUT_MS = 25000;
      const runJobResult = await Promise.race([
        runJob(harness, who, step, state, { observed }),
        new Promise((res) =>
          setTimeout(
            () => res({ status: 'TIMEOUT', job: step.job, reason: 'runJob_exceeded_' + RUN_JOB_TIMEOUT_MS + 'ms' }),
            RUN_JOB_TIMEOUT_MS
          )
        ),
      ]);
      const result = runJobResult;
      observeMetric(METRIC.ACTION_LATENCY, Date.now() - actionStart, { actor: who, job: step.job });

      let agentPos = null;
      let afterHealthPct = assessment.healthPct != null ? assessment.healthPct : 1;
      try {
        const obs = await harness.cap.observe(who);
        if (obs && obs.success && obs.data) {
          agentPos = {
            x: obs.data.x ?? obs.data.loc_x,
            y: obs.data.y ?? obs.data.loc_y,
            z: obs.data.z ?? obs.data.loc_z,
          };
          if (typeof obs.data.health === 'number' && typeof obs.data.max_health === 'number' && obs.data.max_health > 0) {
            afterHealthPct = obs.data.health / obs.data.max_health;
          }
        }
      } catch (_) {}

      // 4. Stall detection on real progress, not on tick count.
      const tickProgress = meaningfulProgress(result);
      state.progress += tickProgress;
      // Accumulate progress toward the current objective's completion goal.
      state.objectiveProgress = (state.objectiveProgress || 0) + tickProgress;
      // Once the committed objective reaches its goal, clear it so next tick picks a fresh one.
      if (
        state.objective &&
        state.objectiveProgress >= (OBJECTIVE_GOALS[state.objective.job] || 3)
      ) {
        state.objective = null;
        state.objectiveProgress = 0;
      }
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
        // Close the experience loop: a stall/abandon is a negative outcome for the last decision.
        try {
          recordFocusOutcome(who, lastEpisode[who], {
            stalled: true,
            abandonedUseful: stall.stage === 'ABANDON_GOAL',
          });
        } catch (_) {
          /* best-effort */
        }
        if (stall.stage === 'REPLAN' || stall.stage === 'ABANDON_GOAL') {
          intentions.applySignals(who, {
            noProgress: true,
            goalAbandoned: stall.stage === 'ABANDON_GOAL',
          });
        }
        if (stall.stage === 'CONSULT_LLM') {
          // Optional planner; with none configured this only logs (previous behaviour).
          const consult = await consultGate.maybeConsult(stall, {
            agentId: who,
            goalKey: `${who}:${intention.focus}:${step.job}:${step.site || ''}`,
            focus: intention.focus,
            job: step.job,
          });
          if (consult.consulted && consult.suggestion && consult.suggestion.focus) {
            intentions.invalidate(who, 'consult_llm');
            intentions.set(
              who,
              {
                focus: consult.suggestion.focus,
                reason: consult.suggestion.reason,
                contextKey: null,
              },
              { ttlMs: consult.suggestion.ttlMs }
            );
            log({
              status: 'PASS',
              action: 'consult_llm_applied',
              worker: who,
              focus: consult.suggestion.focus,
              reason: consult.suggestion.reason,
            });
          }
        }
      }
      state.agentJobs[who] = step.job;

      // A1/A2: close the current tick's focus decision with a real outcome.
      // The ExperienceStore is idempotent (recordOutcome deletes from `open`), so if a
      // death/stall already closed this episode, this is a harmless no-op. Otherwise we
      // attach the actual consequence of the work tick: progress made, objective completed,
      // and damage taken — so offline training sees REWARD, not just pending decisions.
      try {
        const epNow = lastEpisode[who];
        if (epNow) {
          const goalJustCompleted =
            state.objective == null && (state.objectiveProgress || 0) === 0 && tickProgress > 0;
          const dmgTaken = Math.max(0, (assessment.healthPct != null ? assessment.healthPct : 1) - afterHealthPct) * 20;
          recordFocusOutcome(who, epNow, {
            progressDelta: Number((tickProgress / (OBJECTIVE_GOALS[step.job] || 3)).toFixed(3)),
            goalCompleted: goalJustCompleted,
            damageTaken: Number(dmgTaken.toFixed(2)),
            recovered: false,
          });
        }
      } catch (_) {
        /* best-effort */
      }

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
      if (
        step.job === 'placeregion' &&
        result.status === 'PASS' &&
        typeof observation.noteEvent === 'function'
      ) {
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
          consultGate: consultGate.snapshot(),
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
