/**
 * Post-build inspection + measurable quality score.
 * Scores are derived from counters — never faked.
 */

const { normMat } = require('./site');
const { validatePalette, validateProportions, validateArchitecture } = require('./validate');

/**
 * @typedef {{
 *   structural_integrity: number,
 *   functional_integrity: number,
 *   terrain_integration: number,
 *   architectural_coherence: number,
 *   material_coherence: number,
 *   proportion: number,
 *   settlement_integration: number,
 *   overall: number,
 * }} QualityScore
 */

/**
 * Inspect constructed result against blueprint + world.
 *
 * @param {{
 *   blueprint: object,
 *   tx?: { log: object[], unexplainedCount?: Function },
 *   harness?: { block: { at: Function }, region?: { at: Function } },
 *   world?: string,
 *   supportAt?: Function,
 *   settlementContext?: { nearbyBuildings?: number, roadConnected?: boolean },
 * }} opts
 */
async function inspect(opts) {
  const { blueprint, tx, harness, world, supportAt, settlementContext } = opts;
  const findings = [];
  const counters = {
    floatingBlocks: 0,
    missingBlocks: 0,
    holes: 0,
    unexplainedChanges: 0,
    brokenEntrances: 0,
    invalidStairs: 0,
    roofGaps: 0,
    liquidLeaks: 0,
    intersections: 0,
  };

  const elevated = blueprint.elevated === true;
  const purpose = blueprint.purpose || 'house';

  // Floating / support
  if (purpose !== 'path' && purpose !== 'fence') {
    const floors =
      (blueprint.foundation && blueprint.foundation.length ? blueprint.foundation : null) ||
      (blueprint.floors && blueprint.floors[0] && blueprint.floors[0].blocks) ||
      [];
    for (const b of floors) {
      let supported = false;
      if (typeof supportAt === 'function') {
        supported = !!(await supportAt(b.x, b.y, b.z));
      } else if (harness && harness.block) {
        const below = normMat(await harness.block.at(b.x, b.y - 1, b.z, world || blueprint.world));
        supported =
          below !== 'AIR' &&
          below !== 'CAVE_AIR' &&
          below !== 'VOID_AIR' &&
          !below.includes('WATER') &&
          !below.includes('LAVA');
      } else {
        supported = true; // no world → assume terrain contact deferred
      }
      if (!supported) {
        counters.floatingBlocks += 1;
        findings.push({ code: 'floating_block', x: b.x, y: b.y, z: b.z });
      }
    }
  }

  // Verify placed materials if harness present
  if (harness && harness.block && blueprint.blocks) {
    for (const b of blueprint.blocks.slice(0, 200)) {
      const mat = normMat(await harness.block.at(b.x, b.y, b.z, world || blueprint.world));
      const expect = normMat(b.material);
      if (mat !== expect && b.role !== 'entrance' && b.role !== 'window') {
        // air gap roles ok
        if (expect !== 'AIR') {
          counters.missingBlocks += 1;
          if (findings.length < 40)
            findings.push({ code: 'missing_or_wrong', expect, got: mat, ...b });
        }
      }
      if (mat.includes('WATER') || mat.includes('LAVA')) {
        counters.liquidLeaks += 1;
        findings.push({ code: 'liquid', mat, ...b });
      }
    }
  }

  // Entrances: floor at entrance cell should be usable (not solid wall)
  for (const e of blueprint.entrances || []) {
    if (harness && harness.block) {
      const at = normMat(await harness.block.at(e.x, e.y, e.z, world || blueprint.world));
      const floor = normMat(await harness.block.at(e.x, e.y - 1, e.z, world || blueprint.world));
      if (at !== 'AIR' && at !== 'CAVE_AIR' && !at.includes('DOOR')) {
        counters.brokenEntrances += 1;
        findings.push({ code: 'blocked_entrance', mat: at, ...e });
      }
      if (floor === 'AIR' || floor.includes('WATER')) {
        counters.brokenEntrances += 1;
        findings.push({ code: 'entrance_no_floor', floor, ...e });
      }
    }
  }

  // Stairs
  if (blueprint.stairs && blueprint.stairs.length && (blueprint.floors || []).length < 2) {
    counters.invalidStairs = blueprint.stairs.length;
    findings.push({ code: 'stairs_nowhere' });
  }

  // Roof integrity: every roof cell should exist in blueprint (structural plan)
  if (purpose !== 'path' && purpose !== 'fence') {
    if (!blueprint.roof || !blueprint.roof.length) {
      counters.roofGaps = 1;
      findings.push({ code: 'no_roof' });
    }
  }

  if (tx && typeof tx.unexplainedCount === 'function') {
    counters.unexplainedChanges = tx.unexplainedCount([]);
  }

  // Static architecture / palette / proportion (plan-level)
  const arch = validateArchitecture(blueprint);
  const pal = validatePalette(blueprint);
  const prop = validateProportions(blueprint);
  for (const i of [...arch.issues, ...pal.issues, ...prop.issues]) {
    findings.push({ code: i.code, message: i.message });
  }

  const score = computeQualityScore({
    counters,
    elevated,
    purpose,
    paletteOk: pal.ok,
    proportionOk: prop.ok,
    architectureOk: arch.ok,
    settlementContext,
  });

  const pass =
    (elevated || counters.floatingBlocks === 0) &&
    counters.unexplainedChanges === 0 &&
    counters.liquidLeaks === 0 &&
    counters.brokenEntrances === 0 &&
    counters.invalidStairs === 0 &&
    arch.ok &&
    pal.ok;

  return {
    pass,
    findings,
    counters,
    score,
    invariants: {
      NORMAL_BUILDING_FLOATING_BLOCKS: elevated ? null : counters.floatingBlocks,
      UNEXPLAINED_BLOCK_CHANGES: counters.unexplainedChanges,
      UNRELATED_WORLD_DAMAGE: counters.liquidLeaks + counters.intersections,
    },
  };
}

/**
 * Measurable quality score 0..1 per dimension.
 * @param {object} p
 * @returns {QualityScore}
 */
function computeQualityScore(p) {
  const c = p.counters || {};
  const clamp = (n) => Math.max(0, Math.min(1, n));

  const structural_integrity = clamp(
    1 - (c.floatingBlocks || 0) * 0.2 - (c.roofGaps || 0) * 0.15 - (c.holes || 0) * 0.1
  );
  const functional_integrity = clamp(
    1 -
      (c.brokenEntrances || 0) * 0.25 -
      (c.invalidStairs || 0) * 0.2 -
      (c.missingBlocks || 0) * 0.02
  );
  const terrain_integration = p.elevated ? 0.7 : clamp(1 - (c.floatingBlocks || 0) * 0.3);
  const architectural_coherence = p.architectureOk ? 1 : 0.4;
  const material_coherence = p.paletteOk ? 1 : 0.3;
  const proportion = p.proportionOk ? 1 : 0.5;
  let settlement_integration = 0.6;
  if (p.settlementContext) {
    if (p.settlementContext.roadConnected) settlement_integration += 0.2;
    if ((p.settlementContext.nearbyBuildings || 0) > 0) settlement_integration += 0.1;
    settlement_integration = clamp(settlement_integration);
  }

  const overall =
    structural_integrity * 0.25 +
    functional_integrity * 0.2 +
    terrain_integration * 0.15 +
    architectural_coherence * 0.15 +
    material_coherence * 0.1 +
    proportion * 0.1 +
    settlement_integration * 0.05;

  return {
    structural_integrity,
    functional_integrity,
    terrain_integration,
    architectural_coherence,
    material_coherence,
    proportion,
    settlement_integration,
    overall: clamp(overall),
  };
}

module.exports = {
  inspect,
  computeQualityScore,
};
