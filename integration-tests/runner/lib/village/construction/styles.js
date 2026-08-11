/**
 * Settlement architectural styles and material palettes.
 * Coherence without cloning — controlled variation within a style.
 */

/** @typedef {{ primary:string, secondary:string, accent:string, roof:string, foundation:string, glass:string, path:string }} MaterialPalette */

/** Site-specific palettes for coherent builds (shared with aesthetic templates). */
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

/** Configurable proportion ranges (not hardcoded one-offs). */
const PROPORTION_LIMITS = Object.freeze({
  maxHeightToFootprintRatio: 1.2,
  minDoorWidthFraction: 0.12,
  maxWindowWallFraction: 0.45,
  maxRoofOverhangBlocks: 2,
  minFootprintBlocks: 9,
  maxFootprintBlocks: 400,
  maxPaletteDistinctMaterials: 8,
});

/** Purpose → preferred site roles / footprint hints. */
const BUILDING_PURPOSES = Object.freeze({
  house: { footprintHint: 'small', near: ['residential', 'road'], materials: 'housing' },
  farmhouse: { footprintHint: 'medium', near: ['farm'], materials: 'housing' },
  barn: { footprintHint: 'large', near: ['farm'], materials: 'housing' },
  warehouse: { footprintHint: 'large', near: ['road', 'market'], materials: 'military' },
  blacksmith: { footprintHint: 'medium', near: ['workshop'], materials: 'military' },
  tavern: { footprintHint: 'medium', near: ['center', 'road'], materials: 'housing' },
  market: { footprintHint: 'large', near: ['center'], materials: 'military' },
  town_hall: { footprintHint: 'large', near: ['center'], materials: 'military' },
  watchtower: { footprintHint: 'tiny', near: ['perimeter'], materials: 'military' },
  workshop: { footprintHint: 'medium', near: ['workshop'], materials: 'military' },
  mine_entrance: { footprintHint: 'small', near: ['quarry'], materials: 'military' },
  stable: { footprintHint: 'medium', near: ['farm', 'road'], materials: 'housing' },
  church: { footprintHint: 'large', near: ['center'], materials: 'military' },
  library: { footprintHint: 'medium', near: ['center'], materials: 'housing' },
  monument: { footprintHint: 'small', near: ['plaza'], materials: 'military' },
  path: { footprintHint: 'linear', near: ['road'], materials: 'path' },
  fence: { footprintHint: 'ring', near: ['farm'], materials: 'housing' },
});

/**
 * Named settlement styles.
 * @type {Record<string, { id:string, primaryMaterials:string[], roofMaterials:string[], foundationMaterials:string[], floorHeight:number, roofPitch:'flat'|'low', windowStyle:string, doorStyle:string, decoration:string[] }>}
 */
const STYLES = Object.freeze({
  medieval_village: {
    id: 'medieval_village',
    primaryMaterials: ['oak_planks', 'oak_log', 'cobblestone', 'stone_bricks'],
    roofMaterials: ['oak_slab', 'stone_brick_slab', 'cobblestone_slab'],
    foundationMaterials: ['cobblestone', 'stone', 'dirt'],
    floorHeight: 3,
    roofPitch: 'flat',
    windowStyle: 'gap',
    doorStyle: 'south_gap',
    decoration: ['oak_fence', 'lantern'],
  },
  northern_village: {
    id: 'northern_village',
    primaryMaterials: ['spruce_planks', 'spruce_log', 'cobblestone', 'stone_bricks'],
    roofMaterials: ['spruce_slab', 'stone_brick_slab'],
    foundationMaterials: ['cobblestone', 'stone'],
    floorHeight: 3,
    roofPitch: 'flat',
    windowStyle: 'gap',
    doorStyle: 'south_gap',
    decoration: ['spruce_fence'],
  },
  desert_settlement: {
    id: 'desert_settlement',
    primaryMaterials: ['sandstone', 'cut_sandstone', 'smooth_sandstone'],
    roofMaterials: ['sandstone_slab', 'smooth_sandstone_slab'],
    foundationMaterials: ['sandstone', 'sand'],
    floorHeight: 3,
    roofPitch: 'flat',
    windowStyle: 'gap',
    doorStyle: 'south_gap',
    decoration: ['oak_fence'],
  },
  forest_settlement: {
    id: 'forest_settlement',
    primaryMaterials: ['oak_planks', 'oak_log', 'mossy_cobblestone'],
    roofMaterials: ['oak_slab'],
    foundationMaterials: ['mossy_cobblestone', 'dirt', 'cobblestone'],
    floorHeight: 3,
    roofPitch: 'flat',
    windowStyle: 'gap',
    doorStyle: 'south_gap',
    decoration: ['oak_fence', 'vine'],
  },
  coastal_town: {
    id: 'coastal_town',
    primaryMaterials: ['oak_planks', 'prismarine', 'cobblestone'],
    roofMaterials: ['oak_slab', 'prismarine_slab'],
    foundationMaterials: ['cobblestone', 'stone'],
    floorHeight: 3,
    roofPitch: 'flat',
    windowStyle: 'gap',
    doorStyle: 'south_gap',
    decoration: ['oak_fence'],
  },
  industrial_settlement: {
    id: 'industrial_settlement',
    primaryMaterials: ['stone_bricks', 'cobblestone', 'iron_block', 'oak_log'],
    roofMaterials: ['stone_brick_slab', 'cobblestone_slab'],
    foundationMaterials: ['stone_bricks', 'cobblestone'],
    floorHeight: 4,
    roofPitch: 'flat',
    windowStyle: 'gap',
    doorStyle: 'south_gap',
    decoration: ['iron_bars'],
  },
  fantasy_settlement: {
    id: 'fantasy_settlement',
    primaryMaterials: ['stone_bricks', 'oak_planks', 'oak_log', 'amethyst_block'],
    roofMaterials: ['stone_brick_slab', 'oak_slab'],
    foundationMaterials: ['stone_bricks', 'cobblestone'],
    floorHeight: 3,
    roofPitch: 'flat',
    windowStyle: 'gap',
    doorStyle: 'south_gap',
    decoration: ['lantern', 'oak_fence'],
  },
});

/**
 * Map site key / purpose to a MaterialPalette, optionally filtered by settlement style.
 * @param {string} siteOrPurpose
 * @param {string} [styleId]
 * @returns {MaterialPalette}
 */
function paletteForPurpose(siteOrPurpose, styleId) {
  const sitePal = paletteFor(siteOrPurpose);
  const style = STYLES[styleId] || STYLES.medieval_village;
  return {
    primary: sitePal.wall,
    secondary: sitePal.trim,
    accent: style.decoration[0] || sitePal.trim,
    roof: sitePal.roof,
    foundation: style.foundationMaterials[0],
    glass: 'glass',
    path: sitePal.path,
  };
}

/**
 * @param {string} styleId
 */
function styleById(styleId) {
  return STYLES[styleId] || STYLES.medieval_village;
}

/**
 * Controlled variation: pick a secondary trim from style list without leaving palette.
 * @param {string} styleId
 * @param {number} seed
 */
function varyWithinStyle(styleId, seed) {
  const style = styleById(styleId);
  const mats = style.primaryMaterials;
  const i = Math.abs(Math.floor(seed)) % mats.length;
  return {
    wall: mats[i],
    trim: mats[(i + 1) % mats.length],
    roof: style.roofMaterials[i % style.roofMaterials.length],
    foundation: style.foundationMaterials[i % style.foundationMaterials.length],
  };
}

module.exports = {
  PALETTES,
  paletteFor,
  PROPORTION_LIMITS,
  BUILDING_PURPOSES,
  STYLES,
  paletteForPurpose,
  styleById,
  varyWithinStyle,
};
