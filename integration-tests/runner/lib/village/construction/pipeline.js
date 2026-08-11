/**
 * Construction quality pipeline orchestrator.
 *
 * Need → Site → Blueprint → Pre-validate → Material validate → Construct → Inspect → Repair/Rollback
 *
 * Never skips validation. Never places arbitrary LLM block ops.
 */

const { planBlueprint, compileBlueprint } = require('./blueprint');
const { selectBestSite, defaultCandidates, scoreSite } = require('./site');
const { validateBlueprint, validateBlueprintSync, validatePalette } = require('./validate');
const { construct, createLoggingPlaceFn } = require('./engine');
const { inspect } = require('./inspect');
const { repairOrRollback } = require('./repair');
const {
  loadMemory,
  saveMemory,
  rememberOutcome,
  preferredStyle,
  isSiteConstrained,
  DEFAULT_PATH,
} = require('./memory');
const { reviewVisual } = require('./visualCritic');
const { STATUS } = require('./transaction');

/**
 * @param {{
 *   harness?: object,
 *   origin: {x:number,y:number,z:number},
 *   step?: object,
 *   blueprint?: object,
 *   actorName?: string,
 *   style?: string,
 *   memoryPath?: string,
 *   memory?: object,
 *   persistMemory?: boolean,
 *   maxBlocks?: number,
 *   startIndex?: number,
 *   skipSiteSelection?: boolean,
 *   site?: {x:number,z:number},
 *   supportAt?: Function,
 *   dryRun?: boolean,
 *   visionReview?: boolean,
 *   shouldPause?: Function,
 *   existingBuildings?: Array,
 *   settlementContext?: object,
 *   minScore?: number,
 * }} opts
 */
async function runProject(opts) {
  const stages = [];
  const memoryPath = opts.memoryPath || DEFAULT_PATH;
  const memory = opts.memory || loadMemory(memoryPath);
  const style = opts.style || preferredStyle(memory) || 'medieval_village';
  const step = { ...(opts.step || {}), style };
  const world = (opts.blueprint && opts.blueprint.world) || 'world';

  // --- Site selection ---
  let siteResult = null;
  let chosen = opts.site || null;
  if (!opts.skipSiteSelection && opts.harness) {
    const candidates = defaultCandidates(opts.origin, step).filter(
      (c) => !isSiteConstrained(memory, c)
    );
    siteResult = await selectBestSite(opts.harness, candidates, {
      startY: (opts.origin && opts.origin.y) + 40,
      world,
      settlementCenter: { x: opts.origin.x, z: opts.origin.z },
      existingBuildings: opts.existingBuildings,
    });
    stages.push({ stage: 'site_selection', ok: !!siteResult.best, best: siteResult.best });
    if (!siteResult.best) {
      const outcome = {
        projectId: `none_${Date.now()}`,
        purpose: step.job || 'house',
        style,
        site: candidates[0],
        status: STATUS.PROJECT_ABORTED,
        reject: 'no_safe_site',
      };
      rememberOutcome(memory, outcome);
      if (opts.persistMemory !== false) saveMemory(memory, memoryPath);
      return {
        ok: false,
        status: STATUS.PROJECT_ABORTED,
        reason: 'no_safe_site',
        stages,
        memory,
      };
    }
    chosen = {
      x: siteResult.best.candidate.x,
      z: siteResult.best.candidate.z,
      surfaceY: siteResult.best.surfaceY,
    };
  } else if (chosen && opts.harness) {
    siteResult = {
      best: await scoreSite(
        opts.harness,
        { x: chosen.x, z: chosen.z, width: 5, depth: 5 },
        {
          startY: (opts.origin && opts.origin.y) + 40,
          world,
          settlementCenter: { x: opts.origin.x, z: opts.origin.z },
        }
      ),
    };
    stages.push({ stage: 'site_selection', ok: siteResult.best.ok, best: siteResult.best });
    if (!siteResult.best.ok) {
      rememberOutcome(memory, {
        projectId: `none_${Date.now()}`,
        style,
        site: chosen,
        status: STATUS.PROJECT_ABORTED,
        reject: siteResult.best.reject,
      });
      if (opts.persistMemory !== false) saveMemory(memory, memoryPath);
      return {
        ok: false,
        status: STATUS.PROJECT_ABORTED,
        reason: siteResult.best.reject || 'site_rejected',
        stages,
        memory,
      };
    }
  } else {
    stages.push({ stage: 'site_selection', ok: true, skipped: true });
  }

  // --- Architectural plan / blueprint ---
  let blueprint = opts.blueprint;
  if (!blueprint) {
    blueprint = planBlueprint(opts.origin, step);
  } else if (!blueprint.footprint) {
    blueprint = compileBlueprint(blueprint, { style, purpose: blueprint.purpose, site: step.site });
  }
  stages.push({
    stage: 'blueprint',
    ok: true,
    id: blueprint.id,
    purpose: blueprint.purpose,
    blocks: (blueprint.blocks || []).length,
  });

  // --- Pre-build + material validation (never skip) ---
  const pre =
    opts.harness || opts.supportAt
      ? await validateBlueprint(blueprint, {
          harness: opts.harness,
          supportAt: opts.supportAt,
          world,
        })
      : validateBlueprintSync(blueprint);

  // If foundationNeedsTerrain and we have harness support map from site, re-check with supportAt
  if (pre.metrics && pre.metrics.foundationNeedsTerrain && opts.supportAt) {
    const founded = await validateBlueprint(blueprint, { supportAt: opts.supportAt, world });
    Object.assign(pre, founded);
  }

  const mat = validatePalette(blueprint);
  stages.push({ stage: 'pre_build_validation', ok: pre.ok, issues: pre.issues });
  stages.push({ stage: 'material_validation', ok: mat.ok, issues: mat.issues });

  if (!pre.ok || !mat.ok) {
    rememberOutcome(memory, {
      projectId: `invalid_${Date.now()}`,
      purpose: blueprint.purpose,
      style: blueprint.style,
      site: chosen,
      status: STATUS.PROJECT_ABORTED,
      reject: 'validation_failed',
      notes: [...(pre.issues || []), ...(mat.issues || [])].map((i) => i.code).join(','),
    });
    if (opts.persistMemory !== false) saveMemory(memory, memoryPath);
    return {
      ok: false,
      status: STATUS.PROJECT_ABORTED,
      reason: 'validation_failed',
      stages,
      blueprint,
      validation: pre,
      memory,
    };
  }

  // Dry-run: stop after validation
  if (opts.dryRun) {
    return { ok: true, status: 'VALIDATED', stages, blueprint, memory, site: chosen };
  }

  // --- Construct ---
  const build = await construct({
    harness: opts.harness,
    blueprint,
    actorName: opts.actorName,
    world,
    projectId: opts.projectId,
    maxBlocks: opts.maxBlocks,
    startIndex: opts.startIndex || 0,
    placeFn: opts.placeFn || (opts.harness ? undefined : createLoggingPlaceFn()),
    shouldPause: opts.shouldPause,
    priorLog: opts.priorLog,
  });
  stages.push({
    stage: 'construction',
    ok: build.status !== STATUS.PROJECT_ABORTED,
    status: build.status,
    placed: build.placed.length,
    complete: build.complete,
  });

  if (build.status === STATUS.PROJECT_PAUSED) {
    rememberOutcome(memory, {
      projectId: build.tx.projectId,
      purpose: blueprint.purpose,
      style: blueprint.style,
      site: chosen,
      status: STATUS.PROJECT_PAUSED,
      notes: `nextIndex=${build.nextIndex}`,
    });
    if (opts.persistMemory !== false) saveMemory(memory, memoryPath);
    return {
      ok: false,
      status: STATUS.PROJECT_PAUSED,
      stages,
      blueprint,
      build,
      tx: build.tx,
      nextIndex: build.nextIndex,
      memory,
      site: chosen,
    };
  }

  // Incremental chunk (maxBlocks) without finishing the blueprint → pause, do not inspect/rollback yet.
  if (build.complete === false) {
    build.tx.pause();
    rememberOutcome(memory, {
      projectId: build.tx.projectId,
      purpose: blueprint.purpose,
      style: blueprint.style,
      site: chosen,
      status: STATUS.PROJECT_PAUSED,
      notes: `incremental nextIndex=${build.nextIndex}/${build.total}`,
    });
    if (opts.persistMemory !== false) saveMemory(memory, memoryPath);
    return {
      ok: true,
      status: STATUS.PROJECT_PAUSED,
      stages,
      blueprint,
      build,
      tx: build.tx,
      nextIndex: build.nextIndex,
      memory,
      site: chosen,
      incremental: true,
    };
  }

  // --- Inspect ---
  const inspection = await inspect({
    blueprint,
    tx: build.tx,
    harness: opts.harness,
    world,
    supportAt: opts.supportAt,
    settlementContext: opts.settlementContext,
  });
  stages.push({
    stage: 'inspection',
    ok: inspection.pass,
    score: inspection.score,
    counters: inspection.counters,
  });

  // Optional vision (never mutates world)
  const vision = await reviewVisual({
    enabled: opts.visionReview === true,
    blueprint,
    inspection,
  });
  stages.push({ stage: 'vision_review', ok: true, ...vision });

  // --- Repair or rollback ---
  const resolution = await repairOrRollback({
    tx: build.tx,
    inspection,
    blueprint,
    harness: opts.harness,
    minScore: opts.minScore,
  });
  stages.push({ stage: 'repair_or_rollback', ok: resolution.action === 'commit', ...resolution });

  if (resolution.needsReinspect && opts.harness) {
    const inspection2 = await inspect({
      blueprint,
      tx: build.tx,
      harness: opts.harness,
      world,
      supportAt: opts.supportAt,
      settlementContext: opts.settlementContext,
    });
    const resolution2 = await repairOrRollback({
      tx: build.tx,
      inspection: inspection2,
      blueprint,
      harness: opts.harness,
      mode: inspection2.pass ? 'auto' : 'rollback',
      minScore: opts.minScore,
    });
    stages.push({ stage: 'reinspect', ok: inspection2.pass, score: inspection2.score });
    stages.push({ stage: 'final_resolution', ok: resolution2.action === 'commit', ...resolution2 });
    rememberOutcome(memory, {
      projectId: build.tx.projectId,
      purpose: blueprint.purpose,
      style: blueprint.style,
      site: chosen,
      status: resolution2.action === 'commit' ? STATUS.COMMITTED : resolution2.status,
      score: inspection2.score,
      reject: resolution2.action === 'commit' ? undefined : resolution2.reason,
    });
    if (opts.persistMemory !== false) saveMemory(memory, memoryPath);
    return {
      ok: resolution2.action === 'commit',
      status: resolution2.action === 'commit' ? STATUS.COMMITTED : resolution2.status,
      stages,
      blueprint,
      build,
      tx: build.tx,
      inspection: inspection2,
      resolution: resolution2,
      memory,
      site: chosen,
    };
  }

  rememberOutcome(memory, {
    projectId: build.tx.projectId,
    purpose: blueprint.purpose,
    style: blueprint.style,
    site: chosen,
    status: resolution.action === 'commit' ? STATUS.COMMITTED : resolution.status,
    score: inspection.score,
    reject: resolution.action === 'commit' ? undefined : resolution.reason,
  });
  if (opts.persistMemory !== false) saveMemory(memory, memoryPath);

  return {
    ok: resolution.action === 'commit',
    status: resolution.action === 'commit' ? STATUS.COMMITTED : resolution.status,
    stages,
    blueprint,
    build,
    tx: build.tx,
    inspection,
    resolution,
    memory,
    site: chosen,
  };
}

module.exports = {
  runProject,
  STATUS,
};
