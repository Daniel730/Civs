/**
 * Aesthetic blueprints for NpcPad workers.
 *
 * Rules (keep builds lookable):
 * - Grid-aligned only; no random 1-block towers.
 * - Material palettes match site role (oak housing, stone military, dirt/cobble farm).
 * - Place on apron / path corridors — never scatter junk inside Civs region footprints.
 * - Prefer completing real placeregion stockpiles over decorative spam.
 * - Cleanup targets prior worker junk materials only.
 */

/** Junk materials previously spammed by workers — safe to tear down. */
const JUNK_MATERIALS = Object.freeze([
  'cobblestone',
  'stone_bricks',
  'oak_planks',
  'oak_log',
  'stone',
  'dirt',
  'andesite',
  'granite',
  'diorite',
]);

/** Site-specific palettes for coherent builds. */
const PALETTES = Object.freeze({
  shelter: {
    wall: 'oak_planks',
    trim: 'oak_log',
    roof: 'oak_slab',
    floor: 'oak_planks',
    path: 'dirt_path',
  },
  hovel: {
    wall: 'oak_planks',
    trim: 'oak_log',
    roof: 'oak_slab',
    floor: 'oak_planks',
    path: 'dirt_path',
  },
  shack: {
    wall: 'oak_planks',
    trim: 'oak_log',
    roof: 'oak_slab',
    floor: 'oak_planks',
    path: 'dirt_path',
  },
  smithy: {
    wall: 'stone_bricks',
    trim: 'oak_log',
    roof: 'stone_brick_slab',
    floor: 'stone_bricks',
    path: 'cobblestone',
  },
  quarry: {
    wall: 'cobblestone',
    trim: 'oak_log',
    roof: 'cobblestone_slab',
    floor: 'cobblestone',
    path: 'cobblestone',
  },
  farm: { wall: 'oak_fence', trim: 'oak_log', roof: 'oak_slab', floor: 'dirt', path: 'dirt_path' },
  barracks: {
    wall: 'stone_bricks',
    trim: 'oak_log',
    roof: 'stone_brick_slab',
    floor: 'stone_bricks',
    path: 'stone_bricks',
  },
  inn: {
    wall: 'oak_planks',
    trim: 'oak_log',
    roof: 'oak_slab',
    floor: 'oak_planks',
    path: 'dirt_path',
  },
  center: {
    wall: 'stone_bricks',
    trim: 'oak_log',
    roof: 'stone_brick_slab',
    floor: 'stone_bricks',
    path: 'dirt_path',
  },
});

/**
 * @param {string} site
 */
function paletteFor(site) {
  return PALETTES[site] || PALETTES.shelter;
}

/**
 * South-apron house shell: floor, 3-high walls with door gap + two windows, simple roof line.
 * Footprint is OUTSIDE Civs region (apron), so placeregion stockpiles stay intact.
 *
 * @param {{ x:number,y:number,z:number }} origin village origin
 * @param {{ dx?:number,dz?:number,site?:string,tick?:number }} step
 * @returns {{ id:string, blocks: Array<{x:number,y:number,z:number,material:string,role:string}> }}
 */
function houseShell(origin, step) {
  const ox = Math.floor(origin.x + (step.dx || 0));
  const oy = Math.floor(origin.y);
  const oz = Math.floor(origin.z + (step.dz || 0));
  const pal = paletteFor(step.site);
  // Anchor on south apron, 7 blocks south of site center (outside typical radius 5)
  const ax = ox - 2;
  const az = oz - 8;
  const w = 5;
  const d = 5;
  const blocks = [];

  // Floor
  for (let x = 0; x < w; x++) {
    for (let z = 0; z < d; z++) {
      blocks.push({ x: ax + x, y: oy, z: az + z, material: pal.floor, role: 'floor' });
    }
  }

  // Walls (y+1..y+3), door on south, windows east/west at mid
  for (let y = 1; y <= 3; y++) {
    for (let x = 0; x < w; x++) {
      for (let z = 0; z < d; z++) {
        const edge = x === 0 || x === w - 1 || z === 0 || z === d - 1;
        if (!edge) continue;
        const door = z === 0 && x === 2 && y <= 2;
        const winE = x === w - 1 && z === 2 && y === 2;
        const winW = x === 0 && z === 2 && y === 2;
        if (door || winE || winW) continue;
        const corner = (x === 0 || x === w - 1) && (z === 0 || z === d - 1);
        blocks.push({
          x: ax + x,
          y: oy + y,
          z: az + z,
          material: corner || y === 3 ? pal.trim : pal.wall,
          role: y === 3 ? 'wall_top' : 'wall',
        });
      }
    }
  }

  // Simple flat slab roof
  for (let x = 0; x < w; x++) {
    for (let z = 0; z < d; z++) {
      blocks.push({ x: ax + x, y: oy + 4, z: az + z, material: pal.roof, role: 'roof' });
    }
  }

  // Incremental: place next chunk of the shell each tick (coherent over time)
  const progress = Math.max(0, Math.floor(step.tick || 0));
  const chunk = 10;
  const start = (progress * chunk) % Math.max(1, blocks.length);
  return {
    id: `house_shell_${step.site || 'site'}`,
    blocks: blocks.slice(start, start + chunk),
    allBlocks: blocks,
  };
}

/**
 * Straight dirt/cobble path segment from site toward village center.
 * @param {{ x:number,y:number,z:number }} origin
 * @param {{ dx?:number,dz?:number,site?:string,tick?:number }} step
 */
function pathToCenter(origin, step) {
  const ox = Math.floor(origin.x + (step.dx || 0));
  const oz = Math.floor(origin.z + (step.dz || 0));
  const oy = Math.floor(origin.y);
  const pal = paletteFor(step.site);
  const cx = Math.floor(origin.x);
  const cz = Math.floor(origin.z);
  const blocks = [];
  const steps = 8;
  for (let i = 1; i <= steps; i++) {
    const t = i / (steps + 1);
    const x = Math.round(ox + (cx - ox) * t);
    const z = Math.round(oz + (cz - oz) * t);
    blocks.push({ x, y: oy, z, material: pal.path, role: 'path' });
    // 2-wide path
    blocks.push({
      x: x + (Math.abs(cx - ox) >= Math.abs(cz - oz) ? 0 : 1),
      y: oy,
      z: z + (Math.abs(cx - ox) >= Math.abs(cz - oz) ? 1 : 0),
      material: pal.path,
      role: 'path',
    });
  }
  const tick = Math.max(0, Math.floor(step.tick || 0));
  const start = (tick * 2) % Math.max(1, blocks.length);
  return {
    id: `path_${step.site || 'site'}`,
    blocks: blocks.slice(start, start + 4),
    allBlocks: blocks,
  };
}

/**
 * Farm edge fence ring on apron (outside potato_farm radius 4).
 * @param {{ x:number,y:number,z:number }} origin
 * @param {{ dx?:number,dz?:number,tick?:number }} step
 */
function farmEdge(origin, step) {
  const ox = Math.floor(origin.x + (step.dx || 0));
  const oz = Math.floor(origin.z + (step.dz || 0));
  const oy = Math.floor(origin.y);
  const r = 6; // outside footprint 4
  const blocks = [];
  for (let i = -r; i <= r; i++) {
    blocks.push({ x: ox + i, y: oy + 1, z: oz - r, material: 'oak_fence', role: 'fence' });
    blocks.push({ x: ox + i, y: oy + 1, z: oz + r, material: 'oak_fence', role: 'fence' });
    blocks.push({ x: ox - r, y: oy + 1, z: oz + i, material: 'oak_fence', role: 'fence' });
    blocks.push({ x: ox + r, y: oy + 1, z: oz + i, material: 'oak_fence', role: 'fence' });
  }
  // Gate gap south
  const filtered = blocks.filter((b) => !(b.z === oz - r && Math.abs(b.x - ox) <= 1));
  const tick = Math.max(0, Math.floor(step.tick || 0));
  const start = (tick * 3) % Math.max(1, filtered.length);
  return {
    id: 'farm_edge',
    blocks: filtered.slice(start, start + 6),
    allBlocks: filtered,
  };
}

/**
 * Pick blueprint for a builder tick.
 * @param {{ x:number,y:number,z:number }} origin
 * @param {{ job?:string,site?:string,dx?:number,dz?:number,tick?:number }} step
 */
function blueprintFor(origin, step) {
  const site = step.site || 'shelter';
  const tick = step.tick || 0;
  if (site === 'farm' || step.job === 'farmer') return farmEdge(origin, step);
  // Alternate path vs shell so village gains connectivity + buildings
  if (tick % 3 === 0) return pathToCenter(origin, { ...step, site });
  return houseShell(origin, { ...step, site });
}

/**
 * Cleanup targets: known junk scatter zones used by the OLD worker (site+6 apron spam)
 * plus a small house-apron scan for orphan junk above grass.
 *
 * @param {{ x:number,y:number,z:number }} origin
 * @param {{ dx?:number,dz?:number,site?:string,tick?:number }} step
 * @returns {Array<{x:number,y:number,z:number,action:'break'|'set_grass'|'set_air'}>}
 */
function cleanupTargets(origin, step) {
  const ox = Math.floor(origin.x + (step.dx || 0));
  const oz = Math.floor(origin.z + (step.dz || 0));
  const oy = Math.floor(origin.y);
  const tick = Math.max(0, Math.floor(step.tick || 0));
  const targets = [];

  // Old scatter: (dx+6, y+1, dz+6+(tick%3)) — sweep a 3×3 of that historic junk pad
  const jx = ox + 6;
  const jz = oz + 6;
  for (let dx = -1; dx <= 1; dx++) {
    for (let dz = -1; dz <= 2; dz++) {
      targets.push({ x: jx + dx, y: oy + 1, z: jz + dz, action: 'break' });
      targets.push({ x: jx + dx, y: oy + 2, z: jz + dz, action: 'break' });
      targets.push({ x: jx + dx, y: oy + 3, z: jz + dz, action: 'break' });
    }
  }

  // Terrain scar repair under junk pad
  for (let dx = -1; dx <= 1; dx++) {
    for (let dz = -1; dz <= 2; dz++) {
      targets.push({ x: jx + dx, y: oy, z: jz + dz, action: 'set_grass' });
    }
  }

  // Rotate which subset we act on each tick (pride is incremental)
  const start = (tick * 5) % Math.max(1, targets.length);
  return targets.slice(start, start + 8);
}

module.exports = {
  JUNK_MATERIALS,
  PALETTES,
  paletteFor,
  houseShell,
  pathToCenter,
  farmEdge,
  blueprintFor,
  cleanupTargets,
};
