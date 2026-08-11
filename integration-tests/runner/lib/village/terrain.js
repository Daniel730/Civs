/**
 * Natural-terrain helpers for player-like village bots.
 *
 * Uses RCON `execute if block` probes (existing Paper/RCON surface) — no Mineflayer,
 * no invented Paper APIs. Falls back to origin.y when probing fails.
 */

const AIRISH = Object.freeze(['air', 'cave_air', 'void_air', 'short_grass', 'tall_grass', 'snow']);

/**
 * @param {import('../harness').Harness} harness
 * @param {number} x
 * @param {number} y
 * @param {number} z
 * @param {string} material bare id e.g. grass_block
 */
async function blockIs(harness, x, y, z, material) {
  const mat = String(material || '').replace(/^minecraft:/, '');
  const reply = await harness.raw(
    `execute in minecraft:overworld if block ${Math.floor(x)} ${Math.floor(y)} ${Math.floor(z)} minecraft:${mat}`
  );
  return String(reply || '').includes('Test passed');
}

/**
 * @param {import('../harness').Harness} harness
 * @param {number} x
 * @param {number} y
 * @param {number} z
 */
async function isAirish(harness, x, y, z) {
  for (const m of AIRISH) {
    if (await blockIs(harness, x, y, z, m)) return true;
  }
  return false;
}

/**
 * Highest non-air block Y in [minY, maxY] with air above (walkable surface).
 *
 * @param {import('../harness').Harness} harness
 * @param {number} x
 * @param {number} z
 * @param {{ maxY?: number, minY?: number, fallbackY?: number }} [opts]
 * @returns {Promise<number>}
 */
async function findSurfaceY(harness, x, z, opts = {}) {
  const maxY = opts.maxY ?? 120;
  const minY = opts.minY ?? 40;
  const fallbackY = opts.fallbackY ?? 80;
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  for (let y = maxY; y >= minY; y--) {
    const solidHere = !(await isAirish(harness, ix, y, iz));
    if (!solidHere) continue;
    const airAbove = await isAirish(harness, ix, y + 1, iz);
    if (airAbove) return y;
  }
  return fallbackY;
}

/**
 * True if a column looks like natural ground we may path/place on.
 * @param {string} material
 */
function isNaturalSurface(material) {
  const m = String(material || '')
    .toLowerCase()
    .replace(/^minecraft:/, '');
  return (
    m === 'grass_block' ||
    m === 'dirt' ||
    m === 'coarse_dirt' ||
    m === 'podzol' ||
    m === 'rooted_dirt' ||
    m === 'moss_block' ||
    m === 'sand' ||
    m === 'gravel' ||
    m === 'stone' ||
    m === 'dirt_path' ||
    m === 'farmland'
  );
}

/**
 * Materials that are decorative platform / scatter junk (safe for beautify teardown
 * outside Civs region footprints). Not stone_bricks — those are often placeregion shells.
 */
const PLATFORM_JUNK = Object.freeze([
  'oak_planks',
  'oak_slab',
  'oak_stairs',
  'oak_fence',
  'spruce_planks',
  'cobblestone',
  'andesite',
  'granite',
  'diorite',
  'stone',
  'dirt',
]);

module.exports = {
  AIRISH,
  PLATFORM_JUNK,
  blockIs,
  isAirish,
  findSurfaceY,
  isNaturalSurface,
};
