/**
 * Aesthetic blueprints for NpcPad workers — player-like, terrain-following.
 *
 * Rules:
 * - NO artificial floor platforms / flatten pads that wreck the world.
 * - Small footprints on natural ground (walls sit on surface; no 5×5 plank pads).
 * - Paths replace only the surface block; follow groundY when provided.
 * - Prefer Civs placeregion over decorative mega-builds.
 * - Beautify tears down platform junk and restores grass.
 * - Structured IR / validation: `./construction` (`compileBlueprint` / `runProject`).
 */

const { PLATFORM_JUNK } = require('./terrain');
const { PALETTES, paletteFor } = require('./construction/styles');

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
  'oak_slab',
  'oak_fence',
]);

/**
 * Surface Y for blueprints: prefer step.groundY (from findSurfaceY), else origin.y.
 * @param {{ x:number,y:number,z:number }} origin
 * @param {{ groundY?: number }} step
 */
function surfaceY(origin, step) {
  if (Number.isFinite(step.groundY)) return Math.floor(step.groundY);
  return Math.floor(origin.y);
}

/**
 * Tiny 3×3 cabin shell on natural ground — walls/roof only, NO floor platform.
 * Anchored on south apron outside typical Civs radius 5.
 *
 * @param {{ x:number,y:number,z:number }} origin village origin
 * @param {{ dx?:number,dz?:number,site?:string,tick?:number,groundY?:number }} step
 * @returns {{ id:string, blocks: Array<{x:number,y:number,z:number,material:string,role:string}>, allBlocks: Array }}
 */
function houseShell(origin, step) {
  const ox = Math.floor(origin.x + (step.dx || 0));
  const oy = surfaceY(origin, step);
  const oz = Math.floor(origin.z + (step.dz || 0));
  const pal = paletteFor(step.site);
  // South apron cabin (outside typical Civs radius 5). Floor sits on natural surface —
  // not a large flatten pad. Construction IR needs role:floor for doors/foundation.
  const ax = ox - 2;
  const az = oz - 8;
  const w = 5;
  const d = 5;
  const blocks = [];
  const floorMat = pal.floor || pal.wall;

  for (let x = 0; x < w; x++) {
    for (let z = 0; z < d; z++) {
      blocks.push({ x: ax + x, y: oy, z: az + z, material: floorMat, role: 'floor' });
    }
  }

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

  for (let x = 0; x < w; x++) {
    for (let z = 0; z < d; z++) {
      blocks.push({ x: ax + x, y: oy + 4, z: az + z, material: pal.roof, role: 'roof' });
    }
  }

  const progress = Math.max(0, Math.floor(step.tick || 0));
  const chunk = 10;
  const start = (progress * chunk) % Math.max(1, blocks.length);
  return {
    id: `cabin_${step.site || 'site'}`,
    blocks: blocks.slice(start, start + chunk),
    allBlocks: blocks,
  };
}

/**
 * Dirt path segment toward village center — surface only, no pad fill.
 * @param {{ x:number,y:number,z:number }} origin
 * @param {{ dx?:number,dz?:number,site?:string,tick?:number,groundY?:number }} step
 */
function pathToCenter(origin, step) {
  const ox = Math.floor(origin.x + (step.dx || 0));
  const oz = Math.floor(origin.z + (step.dz || 0));
  const oy = surfaceY(origin, step);
  const pal = paletteFor(step.site);
  const cx = Math.floor(origin.x);
  const cz = Math.floor(origin.z);
  const blocks = [];
  const steps = 6;
  for (let i = 1; i <= steps; i++) {
    const t = i / (steps + 1);
    const x = Math.round(ox + (cx - ox) * t);
    const z = Math.round(oz + (cz - oz) * t);
    blocks.push({ x, y: oy, z, material: pal.path, role: 'path' });
  }
  const tick = Math.max(0, Math.floor(step.tick || 0));
  const start = (tick * 2) % Math.max(1, blocks.length);
  return {
    id: `path_${step.site || 'site'}`,
    blocks: blocks.slice(start, start + 3),
    allBlocks: blocks,
  };
}

/**
 * Farm edge fence posts on natural ground (outside potato_farm radius 4).
 * Sparse posts — not a full flatten ring every tick.
 * @param {{ x:number,y:number,z:number }} origin
 * @param {{ dx?:number,dz?:number,tick?:number,groundY?:number }} step
 */
function farmEdge(origin, step) {
  const ox = Math.floor(origin.x + (step.dx || 0));
  const oz = Math.floor(origin.z + (step.dz || 0));
  const oy = surfaceY(origin, step);
  const r = 6;
  const blocks = [];
  // Corner posts + mid-edge posts only (player-like, not a solid wall spam)
  const posts = [
    [-r, -r],
    [0, -r],
    [r, -r],
    [-r, 0],
    [r, 0],
    [-r, r],
    [0, r],
    [r, r],
  ];
  for (const [px, pz] of posts) {
    blocks.push({ x: ox + px, y: oy + 1, z: oz + pz, material: 'oak_fence', role: 'fence' });
  }
  const tick = Math.max(0, Math.floor(step.tick || 0));
  const start = (tick * 2) % Math.max(1, blocks.length);
  return {
    id: 'farm_edge',
    blocks: blocks.slice(start, start + 3),
    allBlocks: blocks,
  };
}

/**
 * Pick blueprint for a builder tick.
 * Prefer paths (connect existing sites) over new cabins; farm stays fence posts.
 * @param {{ x:number,y:number,z:number }} origin
 * @param {{ job?:string,site?:string,dx?:number,dz?:number,tick?:number,groundY?:number }} step
 */
function blueprintFor(origin, step) {
  const site = step.site || 'shelter';
  const tick = step.tick || 0;
  if (site === 'farm' || step.job === 'farmer') return farmEdge(origin, step);
  // Paths most of the time; rare small cabin — never floor platforms
  if (tick % 5 === 0) return houseShell(origin, { ...step, site });
  return pathToCenter(origin, { ...step, site });
}

/**
 * Cleanup targets: historic junk scatter + decorative cabin / platform scars.
 * Restores grass under torn-down pads. Does NOT target Civs region centers
 * (stockpile shells) — those stay until an explicit founding redo.
 *
 * @param {{ x:number,y:number,z:number }} origin
 * @param {{ dx?:number,dz?:number,site?:string,tick?:number,groundY?:number }} step
 * @returns {Array<{x:number,y:number,z:number,action:'break'|'set_grass'}>}
 */
function cleanupTargets(origin, step) {
  const ox = Math.floor(origin.x + (step.dx || 0));
  const oz = Math.floor(origin.z + (step.dz || 0));
  const oy = surfaceY(origin, step);
  const tick = Math.max(0, Math.floor(step.tick || 0));
  const targets = [];

  // Old scatter: (dx+6, y+1, dz+6) junk pad
  const jx = ox + 6;
  const jz = oz + 6;
  for (let dx = -1; dx <= 1; dx++) {
    for (let dz = -1; dz <= 2; dz++) {
      targets.push({ x: jx + dx, y: oy + 1, z: jz + dz, action: 'break' });
      targets.push({ x: jx + dx, y: oy + 2, z: jz + dz, action: 'break' });
      targets.push({ x: jx + dx, y: oy + 3, z: jz + dz, action: 'break' });
      targets.push({ x: jx + dx, y: oy, z: jz + dz, action: 'set_grass' });
    }
  }

  // Former 5×5 house-shell floor platform south of site (oak_planks pad scar)
  const ax = ox - 2;
  const az = oz - 8;
  for (let x = 0; x < 5; x++) {
    for (let z = 0; z < 5; z++) {
      targets.push({ x: ax + x, y: oy + 1, z: az + z, action: 'break' });
      targets.push({ x: ax + x, y: oy + 2, z: az + z, action: 'break' });
      targets.push({ x: ax + x, y: oy + 3, z: az + z, action: 'break' });
      targets.push({ x: ax + x, y: oy + 4, z: az + z, action: 'break' });
      targets.push({ x: ax + x, y: oy, z: az + z, action: 'set_grass' });
    }
  }

  const start = (tick * 7) % Math.max(1, targets.length);
  return targets.slice(start, start + 10);
}

module.exports = {
  JUNK_MATERIALS,
  PLATFORM_JUNK,
  PALETTES,
  paletteFor,
  surfaceY,
  houseShell,
  pathToCenter,
  farmEdge,
  blueprintFor,
  cleanupTargets,
};
