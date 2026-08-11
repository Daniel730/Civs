/**
 * Natural-terrain helpers for player-like village bots.
 *
 * Uses RCON `execute if block` probes (existing Paper/RCON surface) — no Mineflayer,
 * no invented Paper APIs. Falls back to origin.y when probing fails.
 *
 * Keep probes cheap: narrow Y band around fallback, one air check, cache per column.
 */

const surfaceCache = new Map();

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
  // air + cave_air + void_air share #minecraft:air in modern versions? Prefer explicit air first.
  if (await blockIs(harness, x, y, z, 'air')) return true;
  if (await blockIs(harness, x, y, z, 'cave_air')) return true;
  return false;
}

/**
 * Highest non-air block Y near fallback with air above (walkable surface).
 * Scans a narrow band to avoid RCON storms.
 *
 * @param {import('../harness').Harness} harness
 * @param {number} x
 * @param {number} z
 * @param {{ maxY?: number, minY?: number, fallbackY?: number }} [opts]
 * @returns {Promise<number>}
 */
async function findSurfaceY(harness, x, z, opts = {}) {
  const fallbackY = Math.floor(opts.fallbackY ?? 80);
  const maxY = Math.floor(opts.maxY ?? fallbackY + 6);
  const minY = Math.floor(opts.minY ?? fallbackY - 6);
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const key = `${ix},${iz},${minY},${maxY}`;
  if (surfaceCache.has(key)) return surfaceCache.get(key);

  // Prefer common flat-world / pad height first
  for (const y of [fallbackY, fallbackY - 1, fallbackY + 1, fallbackY - 2, fallbackY + 2]) {
    if (y < minY || y > maxY) continue;
    const solidHere = !(await isAirish(harness, ix, y, iz));
    if (!solidHere) continue;
    if (await isAirish(harness, ix, y + 1, iz)) {
      surfaceCache.set(key, y);
      return y;
    }
  }

  for (let y = maxY; y >= minY; y--) {
    const solidHere = !(await isAirish(harness, ix, y, iz));
    if (!solidHere) continue;
    if (await isAirish(harness, ix, y + 1, iz)) {
      surfaceCache.set(key, y);
      return y;
    }
  }
  surfaceCache.set(key, fallbackY);
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

const AIRISH = Object.freeze(['air', 'cave_air', 'void_air', 'short_grass', 'tall_grass', 'snow']);

function clearSurfaceCache() {
  surfaceCache.clear();
}

module.exports = {
  AIRISH,
  PLATFORM_JUNK,
  blockIs,
  isAirish,
  findSurfaceY,
  isNaturalSurface,
  clearSurfaceCache,
};
