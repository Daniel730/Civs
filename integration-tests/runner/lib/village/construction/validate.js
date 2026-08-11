/**
 * Pre-build validators: geometry, safety, palette, proportions, architectural rules.
 * Never skip — pipeline must call these before ConstructionEngine places blocks.
 */

const { PROPORTION_LIMITS, styleById } = require('./styles');
const { normMat } = require('./site');

/**
 * @typedef {{ ok:boolean, code:string, message:string, detail?:object }} ValidationIssue
 * @typedef {{ ok:boolean, issues:ValidationIssue[], metrics:object }} ValidationResult
 */

function issue(ok, code, message, detail) {
  return { ok, code, message, detail };
}

/**
 * Count distinct materials in blueprint (palette entropy).
 * @param {{ blocks: Array<{material:string}>, materials?:object, style?:string }} blueprint
 */
function validatePalette(blueprint) {
  const mats = new Set(
    (blueprint.blocks || []).map((b) => String(b.material || '').toLowerCase()).filter(Boolean)
  );
  const style = styleById(blueprint.style);
  const allowed = new Set(
    [
      ...(style.primaryMaterials || []),
      ...(style.roofMaterials || []),
      ...(style.foundationMaterials || []),
      ...(style.decoration || []),
      'oak_planks',
      'oak_log',
      'oak_slab',
      'oak_fence',
      'dirt_path',
      'dirt',
      'cobblestone',
      'stone_bricks',
      'stone_brick_slab',
      'cobblestone_slab',
      'air',
      'glass',
    ].map((m) => m.toLowerCase())
  );
  // Always allow palette materials declared on blueprint
  if (blueprint.materials) {
    for (const v of Object.values(blueprint.materials)) {
      if (v) allowed.add(String(v).toLowerCase());
    }
  }
  const forbidden = [...mats].filter((m) => !allowed.has(m));
  const issues = [];
  if (mats.size > PROPORTION_LIMITS.maxPaletteDistinctMaterials) {
    issues.push(
      issue(false, 'palette_entropy', `too many distinct materials: ${mats.size}`, {
        count: mats.size,
        materials: [...mats],
      })
    );
  }
  if (forbidden.length) {
    issues.push(
      issue(false, 'palette_forbidden', `materials outside style palette: ${forbidden.join(',')}`, {
        forbidden,
      })
    );
  }
  // Ban precious / nonsense blocks unless style explicitly lists them
  const ban = [
    'diamond_block',
    'gold_block',
    'emerald_block',
    'netherite_block',
    'purple_concrete',
    'beacon',
  ];
  for (const b of ban) {
    if (mats.has(b) && !allowed.has(b)) {
      issues.push(issue(false, 'palette_precious', `forbidden material ${b}`));
    }
  }
  return {
    ok: issues.length === 0,
    issues,
    metrics: { distinctMaterials: mats.size, materials: [...mats] },
  };
}

/**
 * Proportion checks using configurable ranges.
 * @param {{ footprint:object, purpose?:string }} blueprint
 */
function validateProportions(blueprint) {
  const fp = blueprint.footprint || {};
  const issues = [];
  const area = (fp.width || 0) * (fp.depth || 0);
  const height = fp.height || 0;
  if (area > 0 && height / Math.sqrt(area) > PROPORTION_LIMITS.maxHeightToFootprintRatio) {
    issues.push(
      issue(false, 'proportion_tall', 'building too tall for footprint', {
        height,
        area,
        ratio: height / Math.sqrt(area),
      })
    );
  }
  if (area > 0 && area < PROPORTION_LIMITS.minFootprintBlocks && blueprint.purpose === 'house') {
    issues.push(issue(false, 'proportion_tiny', 'house footprint too small', { area }));
  }
  if (area > PROPORTION_LIMITS.maxFootprintBlocks) {
    issues.push(issue(false, 'proportion_huge', 'footprint exceeds max', { area }));
  }
  const walls = (blueprint.walls || []).length;
  const windows = (blueprint.windows || []).length;
  if (walls > 0 && windows / walls > PROPORTION_LIMITS.maxWindowWallFraction) {
    issues.push(
      issue(false, 'proportion_windows', 'windows occupy absurd wall fraction', {
        windows,
        walls,
      })
    );
  }
  return { ok: issues.length === 0, issues, metrics: { area, height, walls, windows } };
}

/**
 * Architectural rules: doors, windows, rooms, roofs, stairs.
 * @param {object} blueprint
 */
function validateArchitecture(blueprint) {
  const issues = [];
  const purpose = blueprint.purpose || 'house';
  const isStructure = purpose !== 'path' && purpose !== 'fence';

  if (isStructure) {
    if (!blueprint.entrances || blueprint.entrances.length === 0) {
      issues.push(issue(false, 'no_entrance', 'building requires external access'));
    }
    if (!blueprint.foundation || blueprint.foundation.length === 0) {
      issues.push(issue(false, 'no_foundation', 'building requires foundation/floor blocks'));
    }
    if (!blueprint.walls || blueprint.walls.length === 0) {
      issues.push(issue(false, 'no_walls', 'building requires walls'));
    }
    if (!blueprint.roof || blueprint.roof.length === 0) {
      issues.push(issue(false, 'no_roof', 'building requires a roof'));
    }
    for (const room of blueprint.rooms || []) {
      if (room.entrances < 1) {
        issues.push(issue(false, 'room_no_entrance', `room ${room.id} has no entrance`));
      }
    }
  }

  // Stairs must connect floor levels if present
  if (blueprint.stairs && blueprint.stairs.length) {
    const floors = blueprint.floors || [];
    if (floors.length < 2) {
      issues.push(issue(false, 'stairs_nowhere', 'stairs present without multi-level floors'));
    }
  }

  // Windows require walls nearby (already inferred as gaps; check wall count)
  if ((blueprint.windows || []).length && !(blueprint.walls || []).length) {
    issues.push(issue(false, 'windows_without_walls', 'windows require walls'));
  }

  return { ok: issues.length === 0, issues, metrics: { purpose } };
}

/**
 * Foundation / floating validation against world (or provided support map).
 * NORMAL_BUILDING_FLOATING_BLOCKS = 0 unless blueprint.elevated.
 *
 * @param {object} blueprint
 * @param {{
 *   supportAt?: (x:number,y:number,z:number)=>boolean|Promise<boolean>,
 *   harness?: { block: { at: Function } },
 *   world?: string,
 * }} [ctx]
 */
async function validateFoundation(blueprint, ctx = {}) {
  const issues = [];
  const elevated = blueprint.elevated === true;
  const purpose = blueprint.purpose || 'house';
  if (purpose === 'path' || purpose === 'fence') {
    return { ok: true, issues: [], metrics: { floating: 0, skipped: purpose } };
  }

  const floors = (blueprint.foundation || []).length
    ? blueprint.foundation
    : (blueprint.floors && blueprint.floors[0] && blueprint.floors[0].blocks) || [];

  let floating = 0;
  const floatingSamples = [];

  async function hasSupport(x, y, z) {
    if (typeof ctx.supportAt === 'function') {
      return !!(await ctx.supportAt(x, y, z));
    }
    if (ctx.harness && ctx.harness.block) {
      const below = normMat(await ctx.harness.block.at(x, y - 1, z, ctx.world || blueprint.world));
      return (
        below !== 'AIR' &&
        below !== 'CAVE_AIR' &&
        below !== 'VOID_AIR' &&
        !below.includes('WATER') &&
        !below.includes('LAVA')
      );
    }
    // Pure geometric mode: assume support if another blueprint block is directly below, else unsupported
    return (blueprint.blocks || []).some((b) => b.x === x && b.z === z && b.y === y - 1);
  }

  for (const b of floors) {
    const supported = await hasSupport(b.x, b.y, b.z);
    if (!supported) {
      floating += 1;
      if (floatingSamples.length < 8) floatingSamples.push({ x: b.x, y: b.y, z: b.z });
    }
  }

  if (!elevated && floating > 0) {
    issues.push(
      issue(false, 'floating_foundation', `NORMAL_BUILDING_FLOATING_BLOCKS=${floating}`, {
        floating,
        samples: floatingSamples,
      })
    );
  }

  // Impossible overhang: wall blocks with nothing below in column for >2 air
  let overhangs = 0;
  for (const w of blueprint.walls || []) {
    let air = 0;
    for (let dy = 1; dy <= 4; dy++) {
      const below = (blueprint.blocks || []).find(
        (b) => b.x === w.x && b.z === w.z && b.y === w.y - dy
      );
      if (below) break;
      air += 1;
    }
    if (air >= 3) overhangs += 1;
  }
  if (!elevated && overhangs > 0) {
    issues.push(
      issue(false, 'impossible_overhang', `unsupported wall overhangs: ${overhangs}`, { overhangs })
    );
  }

  return {
    ok: issues.length === 0,
    issues,
    metrics: { floating, overhangs, elevated },
  };
}

/**
 * Run all pre-build validators.
 * @param {object} blueprint
 * @param {object} [ctx]
 * @returns {Promise<ValidationResult>}
 */
async function validateBlueprint(blueprint, ctx = {}) {
  const parts = [
    validatePalette(blueprint),
    validateProportions(blueprint),
    validateArchitecture(blueprint),
    await validateFoundation(blueprint, ctx),
  ];
  const issues = parts.flatMap((p) => p.issues);
  const metrics = Object.assign({}, ...parts.map((p) => p.metrics));
  return { ok: issues.every((i) => i.ok !== false) && issues.length === 0, issues, metrics };
}

/**
 * Sync wrapper for pure (no harness) checks — foundation uses geometric support only.
 * @param {object} blueprint
 */
function validateBlueprintSync(blueprint) {
  const parts = [
    validatePalette(blueprint),
    validateProportions(blueprint),
    validateArchitecture(blueprint),
  ];
  // geometric foundation without async
  const elevated = blueprint.elevated === true;
  const purpose = blueprint.purpose || 'house';
  const issues = parts.flatMap((p) => p.issues);
  const metrics = Object.assign({}, ...parts.map((p) => p.metrics));
  if (purpose !== 'path' && purpose !== 'fence') {
    const floors =
      (blueprint.foundation && blueprint.foundation.length ? blueprint.foundation : null) ||
      (blueprint.floors && blueprint.floors[0] && blueprint.floors[0].blocks) ||
      [];
    let floating = 0;
    for (const b of floors) {
      const supported = (blueprint.blocks || []).some(
        (o) => o.x === b.x && o.z === b.z && o.y === b.y - 1
      );
      if (!supported) floating += 1;
    }
    metrics.floating = floating;
    if (!elevated && floating > 0) {
      // In sync geometric mode without terrain, floors at minY are expected to contact terrain —
      // mark as needing terrain support rather than auto-fail when all floors share minY.
      const minY = blueprint.footprint ? blueprint.footprint.minY : floors[0] && floors[0].y;
      const allOnTerrainLine = floors.every((b) => b.y === minY);
      if (!allOnTerrainLine) {
        issues.push(
          issue(false, 'floating_foundation', `NORMAL_BUILDING_FLOATING_BLOCKS=${floating}`, {
            floating,
          })
        );
      } else {
        metrics.foundationNeedsTerrain = true;
      }
    }
  }
  return { ok: issues.length === 0, issues, metrics };
}

module.exports = {
  validatePalette,
  validateProportions,
  validateArchitecture,
  validateFoundation,
  validateBlueprint,
  validateBlueprintSync,
  issue,
};
