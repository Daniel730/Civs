/**
 * Structured construction blueprint IR.
 * Buildings are NOT an unstructured list of thousands of blocks at the planning layer.
 */

const { houseShell, pathToCenter, farmEdge } = require('../blueprints');
const { paletteForPurpose, styleById, BUILDING_PURPOSES, paletteFor } = require('./styles');

/**
 * @typedef {{ x:number, y:number, z:number, material:string, role:string }} BlueprintBlock
 * @typedef {{
 *   id: string,
 *   purpose: string,
 *   style: string,
 *   elevated: boolean,
 *   footprint: { minX:number, minY:number, minZ:number, maxX:number, maxY:number, maxZ:number, width:number, depth:number, height:number },
 *   floors: Array<{ level:number, blocks: BlueprintBlock[] }>,
 *   rooms: Array<{ id:string, purpose:string, entrances:number }>,
 *   entrances: BlueprintBlock[],
 *   windows: BlueprintBlock[],
 *   walls: BlueprintBlock[],
 *   roof: BlueprintBlock[],
 *   foundation: BlueprintBlock[],
 *   stairs: BlueprintBlock[],
 *   decorations: BlueprintBlock[],
 *   materials: Record<string,string>,
 *   blocks: BlueprintBlock[],
 *   world: string,
 * }} Blueprint
 */

/**
 * Compute axis-aligned footprint from blocks.
 * @param {BlueprintBlock[]} blocks
 */
function footprintFromBlocks(blocks) {
  if (!blocks.length) {
    return { minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0, width: 0, depth: 0, height: 0 };
  }
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;
  for (const b of blocks) {
    if (b.x < minX) minX = b.x;
    if (b.y < minY) minY = b.y;
    if (b.z < minZ) minZ = b.z;
    if (b.x > maxX) maxX = b.x;
    if (b.y > maxY) maxY = b.y;
    if (b.z > maxZ) maxZ = b.z;
  }
  return {
    minX,
    minY,
    minZ,
    maxX,
    maxY,
    maxZ,
    width: maxX - minX + 1,
    depth: maxZ - minZ + 1,
    height: maxY - minY + 1,
  };
}

/**
 * Infer door/window gaps from a full shell (roles floor/wall/roof).
 * Door = south-edge floor cell with no wall above at y+1/y+2.
 * @param {BlueprintBlock[]} allBlocks
 */
function inferOpenings(allBlocks) {
  const byKey = new Map();
  for (const b of allBlocks) {
    byKey.set(`${b.x},${b.y},${b.z}`, b);
  }
  const floors = allBlocks.filter((b) => b.role === 'floor' || b.role === 'path');
  const walls = allBlocks.filter((b) => b.role === 'wall' || b.role === 'wall_top');
  const roof = allBlocks.filter((b) => b.role === 'roof');
  const foundation = allBlocks.filter((b) => b.role === 'foundation' || b.role === 'floor');
  const fences = allBlocks.filter((b) => b.role === 'fence');

  const entrances = [];
  const windows = [];
  const fp = footprintFromBlocks(allBlocks);

  // Door candidates: south edge of footprint at floor Y, missing wall columns
  const floorY = fp.minY;
  for (let x = fp.minX; x <= fp.maxX; x++) {
    const z = fp.minZ;
    const hasFloor = byKey.has(`${x},${floorY},${z}`);
    const wall1 = byKey.has(`${x},${floorY + 1},${z}`);
    const wall2 = byKey.has(`${x},${floorY + 2},${z}`);
    if (hasFloor && !wall1 && !wall2) {
      entrances.push({
        x,
        y: floorY + 1,
        z,
        material: 'air',
        role: 'entrance',
      });
    }
  }

  // Window candidates: mid-height edge cells with no wall block
  for (let x = fp.minX; x <= fp.maxX; x++) {
    for (let z = fp.minZ; z <= fp.maxZ; z++) {
      const edge = x === fp.minX || x === fp.maxX || z === fp.minZ || z === fp.maxZ;
      if (!edge) continue;
      const y = floorY + 2;
      const hasWall = byKey.has(`${x},${y},${z}`);
      const hasFloorBelow =
        byKey.has(`${x},${floorY},${z}`) || walls.some((w) => w.x === x && w.z === z);
      if (!hasWall && hasFloorBelow && !entrances.some((e) => e.x === x && e.z === z)) {
        // Only count if surrounding wall columns exist (gap in wall run)
        const neighbors = [
          byKey.has(`${x - 1},${y},${z}`),
          byKey.has(`${x + 1},${y},${z}`),
          byKey.has(`${x},${y},${z - 1}`),
          byKey.has(`${x},${y},${z + 1}`),
        ].filter(Boolean).length;
        if (neighbors >= 1) {
          windows.push({ x, y, z, material: 'air', role: 'window' });
        }
      }
    }
  }

  return { floors, walls, roof, foundation, fences, entrances, windows };
}

/**
 * Compile a flat aesthetic template into a structured Blueprint.
 * @param {{ id:string, blocks?:BlueprintBlock[], allBlocks?:BlueprintBlock[] }} template
 * @param {{ purpose?:string, style?:string, elevated?:boolean, world?:string, site?:string }} opts
 * @returns {Blueprint}
 */
function compileBlueprint(template, opts = {}) {
  const allBlocks = template.allBlocks || template.blocks || [];
  const purpose = opts.purpose || inferPurpose(template.id);
  const style = opts.style || 'medieval_village';
  const styleDef = styleById(style);
  const site = opts.site || 'shelter';
  const materials = paletteForPurpose(site, style);
  const opened = inferOpenings(allBlocks);
  const footprint = footprintFromBlocks(allBlocks);

  const floorLevels = new Map();
  for (const b of opened.floors) {
    const level = b.y - footprint.minY;
    if (!floorLevels.has(level)) floorLevels.set(level, []);
    floorLevels.get(level).push(b);
  }

  const rooms =
    purpose === 'path' || purpose === 'fence'
      ? []
      : [
          {
            id: 'main',
            purpose,
            entrances: opened.entrances.length,
          },
        ];

  return {
    id: template.id || `bp_${purpose}`,
    purpose,
    style: styleDef.id,
    elevated: opts.elevated === true,
    footprint,
    floors: [...floorLevels.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([level, blocks]) => ({ level, blocks })),
    rooms,
    entrances: opened.entrances,
    windows: opened.windows,
    walls: opened.walls,
    roof: opened.roof,
    foundation: opened.foundation,
    stairs: allBlocks.filter((b) => b.role === 'stairs'),
    decorations: opened.fences,
    materials,
    blocks: allBlocks,
    world: opts.world || 'world',
  };
}

/**
 * @param {string} id
 */
function inferPurpose(id) {
  const s = String(id || '');
  if (s.startsWith('path_')) return 'path';
  if (s === 'farm_edge') return 'fence';
  if (s.includes('house') || s.includes('shell')) return 'house';
  if (BUILDING_PURPOSES[s]) return s;
  return 'house';
}

/**
 * Plan a blueprint from village origin + job step (deterministic).
 * @param {{ x:number,y:number,z:number }} origin
 * @param {{ job?:string, site?:string, dx?:number, dz?:number, tick?:number, style?:string, elevated?:boolean }} step
 * @returns {Blueprint}
 */
function planBlueprint(origin, step = {}) {
  const site = step.site || 'shelter';
  const tick = step.tick || 0;
  let template;
  let purpose;
  if (site === 'farm' || step.job === 'farmer') {
    template = farmEdge(origin, step);
    purpose = 'fence';
  } else if (tick % 3 === 0) {
    template = pathToCenter(origin, { ...step, site });
    purpose = 'path';
  } else {
    template = houseShell(origin, { ...step, site });
    purpose = purposeForSite(site);
  }
  // Use full geometry for validation; engine may still place a chunk.
  return compileBlueprint(
    { id: template.id, allBlocks: template.allBlocks || template.blocks, blocks: template.blocks },
    {
      purpose,
      style: step.style || 'medieval_village',
      elevated: step.elevated === true,
      site,
    }
  );
}

/**
 * @param {string} site
 */
function purposeForSite(site) {
  const map = {
    shelter: 'house',
    hovel: 'house',
    shack: 'house',
    smithy: 'blacksmith',
    quarry: 'mine_entrance',
    farm: 'farmhouse',
    barracks: 'watchtower',
    inn: 'tavern',
    center: 'town_hall',
  };
  return map[site] || 'house';
}

/**
 * Expand blueprint to ordered placement ops (foundation → floor → walls → roof → decor).
 * @param {Blueprint} blueprint
 * @returns {BlueprintBlock[]}
 */
function expandPlacementOrder(blueprint) {
  const order = [
    'foundation',
    'floor',
    'path',
    'wall',
    'wall_top',
    'entrance',
    'window',
    'stairs',
    'roof',
    'fence',
    'decoration',
  ];
  const rank = (role) => {
    const i = order.indexOf(role);
    return i < 0 ? 50 : i;
  };
  return [...blueprint.blocks].sort((a, b) => {
    const ra = rank(a.role);
    const rb = rank(b.role);
    if (ra !== rb) return ra - rb;
    if (a.y !== b.y) return a.y - b.y;
    if (a.z !== b.z) return a.z - b.z;
    return a.x - b.x;
  });
}

module.exports = {
  footprintFromBlocks,
  inferOpenings,
  compileBlueprint,
  planBlueprint,
  purposeForSite,
  expandPlacementOrder,
  paletteFor,
};
