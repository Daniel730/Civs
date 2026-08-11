/**
 * Terrain-aware site selection for NPC construction.
 * Scores candidates; prefers minimal terrain modification; rejects unsafe sites.
 */

const LIQUIDS = new Set(['WATER', 'LAVA', 'KELP', 'KELP_PLANT', 'SEAGRASS', 'TALL_SEAGRASS']);
const SOLID_GROUND = new Set([
  'GRASS_BLOCK',
  'DIRT',
  'COARSE_DIRT',
  'PODZOL',
  'ROOTED_DIRT',
  'STONE',
  'COBBLESTONE',
  'SAND',
  'RED_SAND',
  'GRAVEL',
  'SANDSTONE',
  'MYCELIUM',
  'SNOW_BLOCK',
  'CLAY',
  'MOSS_BLOCK',
  'PACKED_MUD',
  'MUD',
  'NETHERRACK',
  'END_STONE',
  'TERRACOTTA',
  'DIRT_PATH',
]);

/**
 * Normalize harness material to UPPER_SNAKE.
 * @param {string|null|undefined} mat
 */
function normMat(mat) {
  return String(mat || 'AIR')
    .toUpperCase()
    .replace(/[^A-Z0-9_]/g, '_');
}

/**
 * Find surface Y by scanning downward from startY using harness.block.at.
 * @param {{ block: { at:(x:number,y:number,z:number,world?:string)=>Promise<string> } }} harness
 * @param {number} x
 * @param {number} z
 * @param {{ startY?:number, minY?:number, world?:string }} [opts]
 */
async function findSurfaceY(harness, x, z, opts = {}) {
  const startY = opts.startY != null ? opts.startY : 120;
  const minY = opts.minY != null ? opts.minY : 0;
  const world = opts.world;
  for (let y = startY; y >= minY; y--) {
    const mat = normMat(await harness.block.at(x, y, z, world));
    if (mat === 'AIR' || mat === 'CAVE_AIR' || mat === 'VOID_AIR') continue;
    if (LIQUIDS.has(mat)) return { y, material: mat, liquid: true };
    return {
      y,
      material: mat,
      liquid: false,
      solid: SOLID_GROUND.has(mat) || !mat.includes('LEAVES'),
    };
  }
  return { y: minY, material: 'AIR', liquid: false, solid: false };
}

/**
 * Sample slope across a footprint (max-min surface Y).
 * @param {*} harness
 * @param {{ minX:number, maxX:number, minZ:number, maxZ:number }} footprint
 * @param {{ startY?:number, world?:string, step?:number }} [opts]
 */
async function measureSlope(harness, footprint, opts = {}) {
  const step =
    opts.step ||
    Math.max(
      1,
      Math.floor(Math.max(footprint.maxX - footprint.minX, footprint.maxZ - footprint.minZ) / 4) ||
        1
    );
  const heights = [];
  let liquidHits = 0;
  let lavaHits = 0;
  for (let x = footprint.minX; x <= footprint.maxX; x += step) {
    for (let z = footprint.minZ; z <= footprint.maxZ; z += step) {
      const s = await findSurfaceY(harness, x, z, opts);
      if (s.liquid) {
        liquidHits += 1;
        if (String(s.material).includes('LAVA')) lavaHits += 1;
        continue;
      }
      heights.push(s.y);
    }
  }
  if (!heights.length) {
    return {
      slope: liquidHits ? 0 : 99,
      meanY: 0,
      samples: 0,
      liquidHits,
      lavaHits,
    };
  }
  const min = Math.min(...heights);
  const max = Math.max(...heights);
  const meanY = heights.reduce((a, b) => a + b, 0) / heights.length;
  return {
    slope: max - min,
    meanY,
    samples: heights.length,
    minY: min,
    maxY: max,
    liquidHits,
    lavaHits,
  };
}

/**
 * Score one candidate location for a blueprint footprint size.
 * Higher is better. Negative / rejected → do not build.
 *
 * @param {*} harness
 * @param {{ x:number, z:number, width?:number, depth?:number }} candidate
 * @param {{
 *   startY?:number,
 *   world?:string,
 *   settlementCenter?:{x:number,z:number},
 *   maxSlope?:number,
 *   maxTerrainEditBlocks?:number,
 *   existingBuildings?:Array<{x:number,z:number,radius?:number}>,
 * }} [ctx]
 */
async function scoreSite(harness, candidate, ctx = {}) {
  const width = candidate.width || 5;
  const depth = candidate.depth || 5;
  const halfW = Math.floor(width / 2);
  const halfD = Math.floor(depth / 2);
  const footprint = {
    minX: candidate.x - halfW,
    maxX: candidate.x + halfW,
    minZ: candidate.z - halfD,
    maxZ: candidate.z + halfD,
  };
  const reasons = [];
  let score = 100;

  const slopeInfo = await measureSlope(harness, footprint, {
    startY: ctx.startY,
    world: ctx.world,
  });

  // Liquids first — all-water/lava footprints must not be mislabeled as steep_terrain.
  if (slopeInfo.lavaHits > 0) {
    reasons.push('lava');
    return { ok: false, score: -1, reasons, footprint, slopeInfo, reject: 'lava' };
  }
  if (slopeInfo.liquidHits > 0 && slopeInfo.samples === 0) {
    reasons.push('water');
    return { ok: false, score: -1, reasons, footprint, slopeInfo, reject: 'water' };
  }

  const maxSlope = ctx.maxSlope != null ? ctx.maxSlope : 4;
  if (slopeInfo.slope > maxSlope) {
    reasons.push(`slope_too_steep:${slopeInfo.slope}`);
    return { ok: false, score: -1, reasons, footprint, slopeInfo, reject: 'steep_terrain' };
  }
  score -= slopeInfo.slope * 5;

  // Liquids / lava in footprint
  for (let x = footprint.minX; x <= footprint.maxX; x++) {
    for (let z = footprint.minZ; z <= footprint.maxZ; z++) {
      const s = await findSurfaceY(harness, x, z, { startY: ctx.startY, world: ctx.world });
      if (s.liquid) {
        const mat = s.material;
        if (mat.includes('LAVA')) {
          reasons.push('lava');
          return { ok: false, score: -1, reasons, footprint, slopeInfo, reject: 'lava' };
        }
        reasons.push('water');
        return { ok: false, score: -1, reasons, footprint, slopeInfo, reject: 'water' };
      }
      if (!s.solid && s.material.includes('LEAVES')) {
        score -= 2;
        reasons.push('trees');
      }
    }
  }

  // Existing structures / regions at center
  if (harness.region && typeof harness.region.at === 'function') {
    const y = Math.round(slopeInfo.meanY);
    const reg = await harness.region.at(candidate.x, y, candidate.z, ctx.world);
    if (reg && reg.type && String(reg.type).toLowerCase() !== 'none' && reg.type !== '') {
      reasons.push(`region_overlap:${reg.type}`);
      return { ok: false, score: -1, reasons, footprint, slopeInfo, reject: 'protected_or_region' };
    }
  }

  // Nearby buildings crowding
  const existing = ctx.existingBuildings || [];
  for (const b of existing) {
    const dx = candidate.x - b.x;
    const dz = candidate.z - b.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    const r = b.radius != null ? b.radius : 6;
    if (dist < r) {
      reasons.push(`too_close_to_building:${dist.toFixed(1)}`);
      return { ok: false, score: -1, reasons, footprint, slopeInfo, reject: 'overlap_building' };
    }
    if (dist < r * 2) score -= 5;
  }

  // Prefer near settlement center but not on top of it
  if (ctx.settlementCenter) {
    const dx = candidate.x - ctx.settlementCenter.x;
    const dz = candidate.z - ctx.settlementCenter.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    if (dist < 3) score -= 15;
    else if (dist > 80) score -= 20;
    else score += Math.max(0, 20 - Math.abs(dist - 20) / 2);
  }

  // Prefer low terrain edit (flat-ish already scored via slope)
  const maxEdit = ctx.maxTerrainEditBlocks != null ? ctx.maxTerrainEditBlocks : 40;
  const estimatedEdit = slopeInfo.slope * width * depth;
  if (estimatedEdit > maxEdit) {
    reasons.push(`excessive_terrain_edit:${estimatedEdit}`);
    return {
      ok: false,
      score: -1,
      reasons,
      footprint,
      slopeInfo,
      reject: 'excessive_terrain_edit',
    };
  }
  score -= estimatedEdit * 0.5;

  reasons.push('acceptable');
  return {
    ok: true,
    score,
    reasons,
    footprint,
    slopeInfo,
    surfaceY: Math.round(slopeInfo.meanY),
    reject: null,
  };
}

/**
 * Evaluate several candidates; return best ok site or null.
 * @param {*} harness
 * @param {Array<{x:number,z:number,width?:number,depth?:number}>} candidates
 * @param {object} [ctx]
 */
async function selectBestSite(harness, candidates, ctx = {}) {
  const scored = [];
  for (const c of candidates) {
    const r = await scoreSite(harness, c, ctx);
    scored.push({ candidate: c, ...r });
  }
  scored.sort((a, b) => b.score - a.score);
  const best = scored.find((s) => s.ok);
  return { best: best || null, ranked: scored };
}

/**
 * Default candidate ring around a site stand (apron offsets).
 * @param {{x:number,z:number}} origin
 * @param {{dx?:number,dz?:number,width?:number,depth?:number}} step
 */
function defaultCandidates(origin, step = {}) {
  const cx = Math.floor(origin.x + (step.dx || 0));
  const cz = Math.floor(origin.z + (step.dz || 0) - 8);
  const w = step.width || 5;
  const d = step.depth || 5;
  const offsets = [
    [0, 0],
    [2, 0],
    [-2, 0],
    [0, 2],
    [0, -2],
    [3, 3],
    [-3, 3],
  ];
  return offsets.map(([ox, oz]) => ({ x: cx + ox, z: cz + oz, width: w, depth: d }));
}

module.exports = {
  LIQUIDS,
  SOLID_GROUND,
  normMat,
  findSurfaceY,
  measureSlope,
  scoreSite,
  selectBestSite,
  defaultCandidates,
};
