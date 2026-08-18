'use strict';
/**
 * JobRunner — incremental, serializable job executor for the village worker.
 *
 * WHY THIS EXISTS (Fase B, wiki lower-latency):
 *   The legacy runJob() executed an ENTIRE job (walk + mine + place + ...) inside one
 *   tick. When pathfinding retried or a walk aborted on hazard, a single tick could
 *   take 25-38s (measured: runJob = 26570ms of a 38726ms tick). That makes the loop
 *   unpredictable and the NPC "frozen" between long ticks.
 *
 * DESIGN (scalable, no monolith):
 *   - Each job is a `plan(ctx)` function that returns an ORDERED list of atomic Steps.
 *   - A Step is one of: tool_check | walk | break | place | gather | craft.
 *   - The Runner executes steps[cursor++] with a TIME BUDGET per tick (default 1500ms).
 *     It stops when the budget is exhausted OR all steps are done, and PERSISTS
 *     { steps, cursor } in `state.activeJob` so the next tick resumes exactly where
 *     it left off.
 *   - Adding a new job = write one planX(ctx) function. The core never changes.
 *   - Steps are plain JSON → trivially serializable to the worker state file.
 *
 * STEP CONTRACT:
 *   executeStep(harness, actorName, step, ctx) -> Promise<{ ok, result?, setCursor?, done? }>
 *   - `done:true` means "job finished, clear activeJob".
 *   - `setCursor` lets a step jump (e.g. tool_check failure routes to craft then replans).
 *
 * This is intentionally NOT a generator: generators don't serialize to disk, and the
 * worker must survive restarts mid-job (continuity requirement from the user).
 */

// C1 (2026-08-18): log when a site is invalidated after repeated nav failures.
function logNavBlock(siteKey, fails) {
  // ctx.log may be undefined in unit tests — guard.
  if (typeof logNavBlock._log === 'function') {
    logNavBlock._log({
      status: 'WARN',
      action: 'nav_site_blocked',
      site: siteKey,
      fails,
      reason: 'walk_path stalled 3x -> site invalidated (anti-circle)',
    });
  }
}

// ---- Step executors (atomic actions) ----------------------------------------------

const { planBlueprint, compileBlueprint, expandPlacementOrder } = require('../village/construction');

async function execToolCheck(harness, actorName, step, ctx) {
  const { checkTool, applyObserve } = ctx.helpers;
  const held = ctx.held;
  const inventory = ctx.inventory || [];
  const verdict = checkTool(held, step.target);
  ctx.lastToolVerdict = verdict;
  ctx.log({
    schemaVersion: ctx.agentEventsSchema,
    ts: new Date().toISOString(),
    kind: 'tool_check',
    action: 'tool_check',
    actor: actorName,
    job: step.job,
    target: step.target,
    ...verdict,
  });
  if (verdict.matched) return { ok: true };
  // Tool owned but not in hand? Signal equip (can't hotbar-select without slot index).
  const have = ctx.findToolInInventory(inventory, verdict.expectedTool);
  if (have) {
    ctx.state.needsTool = { job: step.job, target: step.target, expectedTool: verdict.expectedTool, ownedInInventory: have, action: 'equip' };
    ctx.log({ kind: 'tool_owned_not_held', actor: actorName, job: step.job, tool: have, expected: verdict.expectedTool });
    return { ok: false, reason: 'tool_owned_not_held' };
  }
  // Truly missing: craft from own inventory if recipe exists.
  ctx.state.needsTool = { job: step.job, target: step.target, expectedTool: verdict.expectedTool, ownedInInventory: null, action: 'fetch_or_craft' };
  const { craftWithOwnResources, recipeForTool } = ctx.helpers;
  const recipe = recipeForTool(verdict.expectedTool);
  if (recipe) {
    const res = await craftWithOwnResources(harness.cap, actorName, recipe.result, 1, recipe, ctx.log);
    if (res.success) {
      ctx.log({ kind: 'craft', action: 'craft', actor: actorName, job: step.job, tool: recipe.result, success: true });
      ctx.state.needsTool = null;
      const recheck = checkTool(ctx.held, step.target);
      if (recheck.matched) return { ok: true };
    } else {
      ctx.log({ kind: 'craft_failed', actor: actorName, job: step.job, tool: recipe.result, success: false, reason: res.reason });
    }
  }
  return { ok: false, reason: 'tool_missing' };
}

async function execWalk(harness, actorName, step, ctx) {
  const { safeWalk } = ctx.helpers;
  const walk = await safeWalk(harness, actorName, step.to, Object.assign({
    clearFooting: (x, y, z) => ctx.clearFooting(x, y, z, actorName),
    allowTeleport: false,
  }, step.opts || {}));
  ctx.lastWalk = walk;
  return {
    ok: !!(walk && walk.success),
    result: { walk: { success: walk && walk.success, steps: walk && walk.steps, final_distance: walk && walk.final_distance, navigator: walk && walk.navigator, reason: walk && walk.reason } },
  };
}

async function execFindBlock(harness, actorName, step, ctx) {
  const fb = await harness.cap.findBlock(actorName, step.material, step.radius || 12).catch(() => null);
  if (fb && fb.success && fb.data && fb.data.nearest) {
    ctx._lastFound = { x: fb.data.nearest.x, y: fb.data.nearest.y, z: fb.data.nearest.z };
    return { ok: true, result: { found: ctx._lastFound } };
  }
  return { ok: false, reason: 'no_block_found' };
}

async function execBreak(harness, actorName, step, ctx) {
  const br = await harness.cap.breakBlock(actorName, step.x, step.y, step.z).catch(() => null);
  if (br && br.success && ctx.worldMem) ctx.worldMem.noteCell(step.x, step.y, step.z, 'air', ctx.tick);
  await harness.cap.swing(actorName).catch(() => {});
  return { ok: !!(br && br.success), result: { breakBlock: br } };
}

async function execPlace(harness, actorName, step, ctx) {
  const { placeAesthetic, buildPlaceEvent } = ctx.helpers;
  const block = step.block || { x: step.x, y: step.y, z: step.z, material: step.material, role: step.role || 'wall' };
  const pr = await placeAesthetic(harness, actorName, block, ctx.worldMem);
  const ok = !!(pr && pr.success);
  if (buildPlaceEvent) {
    ctx.log(buildPlaceEvent({
      actor: actorName,
      job: step.job || ctx.step.job || 'builder',
      material: block.material,
      target: { x: block.x, y: block.y, z: block.z },
      held: ctx.held,
      invDiff: { gained: [], lost: [], dropped: [] },
      success: ok,
      reason: ok ? null : (pr && pr.reason) || 'place_failed',
      position: null,
    }));
  }
  return { ok, result: { place: pr } };
}

async function execGather(harness, actorName, step, ctx) {
  const { applyObserve, diffInventory, buildGatherEvent } = ctx.helpers;
  const { x, y, z } = step;
  const obsBefore = await harness.cap.observe(actorName);
  const invBefore = applyObserve(obsBefore);
  const gPos = obsBefore && obsBefore.data ? { x: obsBefore.data.x, y: obsBefore.data.y, z: obsBefore.data.z } : null;
  const br = await harness.cap.breakBlock(actorName, x, y, z).catch(() => null);
  if (br && br.success && ctx.worldMem) ctx.worldMem.noteCell(x, y, z, 'air', ctx.tick);
  const invAfter = applyObserve(await harness.cap.observe(actorName));
  const gDiff = diffInventory(invBefore, invAfter, { from: `gather_break:@${x},${y},${z}` });
  ctx.log(buildGatherEvent({
    actor: actorName, job: step.job || 'gather', target: { x, y, z },
    held: ctx.held, toolVerdict: ctx.lastToolVerdict, invDiff: gDiff,
    gathered: br && br.success ? 1 : 0, success: !!(br && br.success),
    reason: br && !br.success ? (br.reason || br.error || 'break_failed') : null, position: gPos,
  }));
  await harness.cap.swing(actorName).catch(() => {});
  return { ok: !!(br && br.success), result: { gather: br && br.success ? 1 : 0 } };
}

async function execCraft(harness, actorName, step, ctx) {
  const { craftWithOwnResources, recipeForTool } = ctx.helpers;
  const recipe = step.recipe || recipeForTool(step.result);
  if (!recipe) return { ok: false, reason: 'no_recipe' };
  const res = await craftWithOwnResources(harness.cap, actorName, step.result, step.amount || 1, recipe, ctx.log);
  return { ok: !!res.success, result: { craft: res } };
}

const STEP_EXECUTORS = {
  tool_check: execToolCheck,
  find_block: execFindBlock,
  walk: execWalk,
  break: execBreak,
  place: execPlace,
  gather: execGather,
  craft: execCraft,
};

// ---- Plan functions (one per migratable job) --------------------------------------
// Each returns an array of Steps. ctx carries everything planX needs:
//   { harness, actorName, step, state, cfg, groundY, coords, origin, tick, helpers, log }

function planGather(ctx) {
  const { cfg, groundY, state } = ctx;
  const targets = ['OAK_LOG', 'SPRUCE_LOG', 'STONE', 'COBBLESTONE', 'DIRT', 'GRASS_BLOCK'];
  const steps = [];
  for (let t = 0; t < 4; t++) {
    const ang = ((state.tick || 0) * 1.7 + t * 1.57) % (Math.PI * 2);
    const gx = Math.floor(cfg.origin.x + Math.cos(ang) * (8 + t * 2));
    const gz = Math.floor(cfg.origin.z + Math.sin(ang) * (8 + t * 2));
    steps.push({ type: 'walk', to: { x: gx, y: groundY + 1, z: gz }, opts: { arrive: 2.5, timeoutMs: 6000, speed: 4.5 } });
    steps.push({ type: 'gather', x: gx, y: groundY, z: gz, job: 'gather' });
  }
  return steps;
}

function planTorch(ctx) {
  const { cfg, groundY } = ctx;
  const ty = (groundY || cfg.origin.y) + 1;
  const steps = [];
  for (let dx = -15; dx <= 15; dx += 5) {
    for (let dz = -15; dz <= 15; dz += 5) {
      const tx = Math.floor(cfg.origin.x + dx);
      const tz = Math.floor(cfg.origin.z + dz);
      steps.push({ type: 'walk', to: { x: tx, y: ty, z: tz }, opts: { arrive: 3, timeoutMs: 5000, speed: 4.5 } });
      steps.push({ type: 'place', x: tx, y: ty, z: tz, material: 'TORCH', role: 'torch' });
    }
  }
  return steps;
}

/**
 * Miner: find the nearest mineable block (STONE by default), walk to it, break it.
 * Async because it needs one RCON findBlock call to discover the target before planning.
 * The runner executes: find_block -> walk -> break, then the job is done (1 block/tick-budget).
 */
async function planMiner(ctx) {
  const { harness, actorName, cfg, groundY, step } = ctx;
  const material = step.job === 'lumberjack' ? 'OAK_LOG' : (step.material || 'STONE');
  const fb = await harness.cap.findBlock(actorName, material, 12).catch(() => null);
  if (fb && fb.success && fb.data && fb.data.nearest) {
    const { x, y, z } = fb.data.nearest;
    return [
      { type: 'walk', to: { x, y, z }, opts: { arrive: 2.5, timeoutMs: 6000, speed: 4.5 } },
      { type: 'break', x, y, z, material },
    ];
  }
  // Fallback: dig at a fixed offset from origin (player-like: mine what's underfoot nearby).
  const digX = Math.floor(cfg.origin.x + (step.dx || 0) + 5);
  const digZ = Math.floor(cfg.origin.z + (step.dz || 0) + 5);
  const digY = groundY;
  return [
    { type: 'walk', to: { x: digX, y: digY, z: digZ }, opts: { arrive: 2.5, timeoutMs: 6000, speed: 4.5 } },
    { type: 'break', x: digX, y: digY, z: digZ, material },
  ];
}

/**
 * Builder: generate the construction blueprint ONCE (cached in state.builderPlan), then
 * emit incremental steps: walk-to + place per block. This replaces the legacy runJob
 * `construction.runProject` call which re-ran compileBlueprint + validateBlueprint +
 * construct EVERY tick (CPU/IO-bound → 12s+ ticks). Here the heavy plan is built once and
 * the runner places 1-3 blocks per tick (~1.5s budget), resuming via state.builderPlan.cursor.
 * The actual placement quality is preserved: execPlace calls placeAesthetic (same as runProject).
 */
async function planBuilder(ctx) {
  const { cfg, step, state } = ctx;
  const siteKey = step.site || step.label || 'shack';
  // Build (or reuse) the cached blueprint plan.
  if (!state.builderPlan || state.builderPlan.job !== step.job || state.builderPlan.site !== siteKey) {
    const template = planBlueprint(cfg.origin, { ...step, tick: state.tick });
    const blueprint = compileBlueprint(template, {
      style: 'medieval_village',
      purpose: template.purpose || 'house',
      site: step.site,
    });
    const ordered = expandPlacementOrder(blueprint);
    state.builderPlan = { job: step.job, site: siteKey, blocks: ordered, cursor: 0 };
  }
  const plan = state.builderPlan;
  if (plan.cursor >= plan.blocks.length) {
    // Whole structure placed — clear so next tick the planner can pick a new job.
    state.builderPlan = null;
    return [];
  }
  // Emit up to 3 blocks worth of steps this tick (walk + place each).
  const slice = plan.blocks.slice(plan.cursor, plan.cursor + 3);
  plan.cursor += slice.length;
  const steps = [];
  for (const b of slice) {
    const near = {
      x: b.x,
      y: Math.max(b.y, cfg.origin.y + 1),
      z: b.z + (b.role === 'path' ? 0 : 1),
    };
    steps.push({ type: 'walk', to: near, opts: { arrive: 2.5, timeoutMs: 3000, stepLen: 0.45, pauseMs: 100 } });
    steps.push({ type: 'place', x: b.x, y: b.y, z: b.z, material: b.material, role: b.role, block: b });
  }
  return steps;
}

// Registry: job name -> plan function. Add new jobs here ONLY.
const PLAN_REGISTRY = {
  gather: planGather,
  torch: planTorch,
  miner: planMiner,
  lumberjack: planMiner, // same shape: find nearest log -> walk -> break (planMiner uses step.material || STONE)
  farmer: planBuilder,  // farmer builds farm structures via the same blueprint pipeline
  builder: planBuilder,
};

// ---- Physical-safety guard (P0.1, 2026-08-18) ------------------------------------
// Inspects the actor's body BEFORE any world-mutating step (break/place/gather/craft).
// If the body is not in a valid standable state (airborne with no support, or not
// grounded), the job must NOT execute world edits — it must enter RECOVERY instead.
// This is defense-in-depth: even if navigation produces a bad target Y, place/break can
// never run from an invalid airborne position (no more floating houses / air terraforming).
const WORLD_MUTATING = new Set(['break', 'place', 'gather', 'craft']);

async function inspectBody(harness, actorName) {
  const ob = await harness.cap.observe(actorName).catch(() => null);
  const d = (ob && ob.data) || {};
  const x = d.x, y = d.y, z = d.z;
  const inWater = !!(d.in_water === true || d.head_in_water === true || d.block_below === 'WATER' || d.block_feet === 'WATER');
  if (typeof x !== 'number' || typeof y !== 'number' || typeof z !== 'number') {
    // Cannot determine position → do NOT block (best-effort, let survival handle).
    return { ok: false, standable: true, airborne: false, reason: 'observe_failed', pos: null };
  }
  // FASE 1 (2026-08-18): trust the server's own physics report from `observe` instead of
  // probing with `execute if block` (which is BROKEN on CivsTestHarness — it always returns
  // "Test passed", so every column looked like air and Steve was perpetually flagged
  // airborne). The harness observe payload carries the ground truth:
  //   on_ground (bool), block_below (material string), block_feet (material string).
  // Standable = server says on_ground OR there is a solid (non-air) block directly below feet.
  const onGround = d.on_ground === true;
  const below = String(d.block_below || '').toUpperCase();
  const feet = String(d.block_feet || '').toUpperCase();
  const supportSolid = below !== '' && below !== 'AIR' && below !== 'CAVE_AIR' && below !== 'VOID_AIR';
  const feetClear = feet === '' || feet === 'AIR' || feet === 'CAVE_AIR' || feet === 'VOID_AIR';
  const standable = onGround || (supportSolid && feetClear);
  return {
    ok: true,
    pos: { x, y, z },
    standable,
    grounded: onGround,
    airborne: !standable,
    inWater,
    reason: standable ? null : 'body_not_standable',
  };
}

// ---- Runner -------------------------------------------------------------------------

/**
 * Execute a job incrementally. Mutates `state.activeJob` (persisted by caller).
 * @returns {{ status:string, done:boolean, cursor:number, steps:object[], results:object[], reason?:string }}
 */
async function runJobStep(harness, actorName, step, state, ctx) {
  const budgetMs = ctx.budgetMs || 1500;
  const start = Date.now();
  if (ctx && typeof ctx.log === 'function') logNavBlock._log = ctx.log;

  // Lazily build the step list if this is a fresh job (or the job type changed).
  if (!state.activeJob || state.activeJob.job !== step.job || state.activeJob.stepKey !== (step.site || step.label)) {
    const plan = PLAN_REGISTRY[step.job];
    if (!plan) return { status: 'UNSUPPORTED', done: false, cursor: 0, steps: [], results: [], reason: `no_plan_for_${step.job}` };
    const steps = await plan(ctx);
    state.activeJob = { job: step.job, stepKey: step.site || step.label, steps, cursor: 0, startedAt: start };
  }

  const aj = state.activeJob;
  const results = [];
  while (aj.cursor < aj.steps.length && Date.now() - start < budgetMs) {
    const st = aj.steps[aj.cursor];
    const exec = STEP_EXECUTORS[st.type];
    if (!exec) {
      results.push({ step: st, error: `unknown_step_${st.type}` });
      aj.cursor++;
      continue;
    }
    // P0.1 (2026-08-18): PHYSICS GUARD. No world-mutating step may run from an invalid
    // airborne body. inspectBody() checks feet/support/head; if not standable, we refuse
    // the edit and signal RECOVERY so survival/navigation can fix the body position first.
    // Walk is explicitly allowed — it IS the recovery path. (Defense-in-depth: even a bad
    // navigation target Y can never produce a floating-house / air-terraform edit.)
    if (WORLD_MUTATING.has(st.type)) {
      const body = await inspectBody(harness, actorName);
      if (!body.ok || !body.standable) {
        return {
          status: 'RECOVERY',
          done: false,
          cursor: aj.cursor,
          steps: aj.steps,
          results: results.concat([{ step: st, ok: false, reason: 'actor_not_physically_valid', body }]),
          reason: 'actor_not_physically_valid',
        };
      }
    }
    try {
      const r = await exec(harness, actorName, st, ctx);
      results.push({ step: st, ok: r.ok, result: r.result });
      // C1 (2026-08-18): track walk failures per site so we can invalidate unreachable
      // waypoints instead of re-issuing them (the "walks in circles" bug). Only count real
      // navigation failures, not transient/physics-guard refusals.
      if (st.type === 'walk' && !r.ok) {
        const reason = (r.result && r.result.walk && r.result.walk.reason) || '';
        const isNavFail = /walk_threw|stuck|no_path|start_not_standable|timeout/.test(reason);
        if (isNavFail) {
          const siteKey = step.site || step.label || 'unknown';
          state.siteFails = state.siteFails || {};
          state.siteFails[siteKey] = (state.siteFails[siteKey] || 0) + 1;
          if (state.siteFails[siteKey] >= 3) {
            state.blocked = state.blocked || {};
            state.blocked[siteKey] = true;
            logNavBlock(siteKey, state.siteFails[siteKey]);
          }
        }
      }
      if (r.done) { aj.cursor = aj.steps.length; break; }
      if (r.setCursor != null) { aj.cursor = r.setCursor; continue; }
      aj.cursor++;
    } catch (e) {
      results.push({ step: st, error: String(e && e.message || e) });
      aj.cursor++; // skip broken step rather than loop forever
    }
  }

  const done = aj.cursor >= aj.steps.length;
  if (done) state.activeJob = null;
  return {
    status: done ? 'PASS' : 'PROGRESS',
    done,
    cursor: aj.cursor,
    steps: aj.steps,
    results,
    reason: done ? null : 'budget_exhausted',
  };
}

module.exports = {
  JobRunner: { runJobStep, PLAN_REGISTRY },
  planGather,
  planTorch,
  STEP_EXECUTORS,
};
