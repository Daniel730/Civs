/** @typedef {'council_room'|'hovel'|'farm'|'quarry'|'utility'|'inn'|'barracks'} StockpileProfile */

/**
 * @param {string} profile
 * @returns {number} half-extent for primary shell
 */
function radiusFor(profile) {
  switch (profile) {
    case 'council_room':
      return 5;
    case 'inn':
      return 9;
    case 'barracks':
      return 7;
    default:
      return 4;
  }
}

/**
 * @param {import('../harness').Harness} harness
 * @param {number} x
 * @param {number} y
 * @param {number} z
 * @param {StockpileProfile|string} [profile]
 */
async function stockpileMaterials(harness, x, y, z, profile = 'utility') {
  const r = radiusFor(profile);
  const cmds = [
    `fill ${x - r} ${y + 1} ${z - r} ${x + r} ${y + 7} ${z + r} air`,
    // Primary (stone_bricks ∈ g:primary) — keep mostly solid so counts survive hollow
    `fill ${x - r} ${y} ${z - r} ${x + r} ${y + 3} ${z + r} stone_bricks`,
    // Secondary (cobblestone ∈ g:secondary)
    `fill ${x - r} ${y} ${z - r} ${x + r} ${y} ${z + r} cobblestone`,
    `fill ${x - Math.max(1, r - 1)} ${y + 1} ${z - Math.max(1, r - 1)} ${x + Math.max(1, r - 1)} ${y + 2} ${z + Math.max(1, r - 1)} oak_log`,
    // Roof (oak_stairs/slab ∈ g:roof)
    `fill ${x - r} ${y + 4} ${z - r} ${x + r} ${y + 4} ${z + r} oak_stairs`,
    `fill ${x - r} ${y + 5} ${z - r} ${x + r} ${y + 5} ${z + r} oak_slab`,
    // Small hollow only (preserve primary mass for inn/barracks)
    `fill ${x - 2} ${y + 1} ${z - 2} ${x + 2} ${y + 3} ${z + 2} air`,
  ];

  // Baseline interactables (hovel / utility / council)
  cmds.push(
    `setblock ${x + 1} ${y + 1} ${z} chest`,
    `setblock ${x + 2} ${y + 1} ${z} chest`,
    `setblock ${x - 1} ${y + 1} ${z} chest`,
    `setblock ${x - 2} ${y + 1} ${z} chest`,
    `setblock ${x} ${y + 1} ${z + 1} oak_door[half=lower]`,
    `setblock ${x} ${y + 2} ${z + 1} oak_door[half=upper]`,
    `setblock ${x} ${y + 1} ${z - 1} oak_door[half=lower]`,
    `setblock ${x} ${y + 2} ${z - 1} oak_door[half=upper]`,
    `setblock ${x + 1} ${y + 2} ${z + 2} glass`,
    `setblock ${x - 1} ${y + 2} ${z + 2} glass`,
    `setblock ${x + 1} ${y + 2} ${z - 2} glass`,
    `setblock ${x - 1} ${y + 2} ${z - 2} glass`,
    `setblock ${x + 2} ${y + 2} ${z + 1} glass_pane`,
    `setblock ${x - 2} ${y + 2} ${z + 1} glass_pane`,
    `setblock ${x + 2} ${y + 2} ${z - 1} glass_pane`,
    `setblock ${x - 2} ${y + 2} ${z - 1} glass_pane`,
    `setblock ${x + 3} ${y + 1} ${z} furnace`,
    `setblock ${x + 3} ${y + 1} ${z + 1} furnace`,
    `setblock ${x - 3} ${y + 1} ${z} crafting_table`,
    `setblock ${x - 3} ${y + 1} ${z + 1} bookshelf`,
    `setblock ${x - 3} ${y + 1} ${z + 2} bookshelf`,
    `setblock ${x - 3} ${y + 2} ${z + 1} bookshelf`,
    `setblock ${x - 3} ${y + 2} ${z + 2} bookshelf`,
    `setblock ${x - 2} ${y + 1} ${z + 2} bookshelf`,
    `setblock ${x - 2} ${y + 2} ${z + 2} bookshelf`,
    `setblock ${x - 1} ${y + 1} ${z + 2} bookshelf`,
    `setblock ${x - 1} ${y + 2} ${z + 2} bookshelf`,
    `setblock ${x + 1} ${y + 1} ${z + 3} red_bed`,
    `setblock ${x - 1} ${y + 1} ${z + 3} water`,
    `setblock ${x - 2} ${y + 1} ${z + 3} lava`,
    `setblock ${x + 2} ${y + 1} ${z + 3} cauldron`
  );

  if (profile === 'farm') {
    // potato_farm: potatoes*24, fence*16, fencegate*1, COMPOSTER*1
    cmds.push(
      `fill ${x - 3} ${y} ${z - 4} ${x + 3} ${y} ${z + 1} farmland`,
      `fill ${x - 3} ${y + 1} ${z - 4} ${x + 3} ${y + 1} ${z + 1} potatoes[age=7]`,
      `setblock ${x} ${y} ${z - 1} water`,
      `setblock ${x + 2} ${y + 1} ${z} composter`,
      `fill ${x - 4} ${y + 1} ${z - 4} ${x + 4} ${y + 1} ${z - 4} oak_fence`,
      `fill ${x - 4} ${y + 1} ${z + 4} ${x + 4} ${y + 1} ${z + 4} oak_fence`,
      `fill ${x - 4} ${y + 1} ${z - 3} ${x - 4} ${y + 1} ${z + 3} oak_fence`,
      `fill ${x + 4} ${y + 1} ${z - 3} ${x + 4} ${y + 1} ${z + 3} oak_fence`,
      `setblock ${x} ${y + 1} ${z - 4} oak_fence_gate`
    );
  }

  if (profile === 'quarry') {
    cmds.push(
      `setblock ${x + 1} ${y + 1} ${z + 1} furnace`,
      `setblock ${x - 1} ${y + 1} ${z + 1} furnace`,
      `setblock ${x} ${y + 1} ${z + 2} lava`,
      `setblock ${x} ${y + 1} ${z - 2} cauldron`
    );
  }

  if (profile === 'hovel') {
    cmds.push(
      `setblock ${x + 1} ${y + 1} ${z + 3} red_bed`,
      `setblock ${x - 1} ${y + 1} ${z + 3} yellow_bed`
    );
  }

  if (profile === 'utility') {
    cmds.push(
      `fill ${x - 3} ${y + 1} ${z - 3} ${x + 3} ${y + 1} ${z - 3} iron_bars`,
      `setblock ${x + 3} ${y + 1} ${z + 1} black_bed`,
      `setblock ${x + 3} ${y + 1} ${z - 1} red_bed`,
      `setblock ${x - 3} ${y + 1} ${z + 1} black_bed`
    );
  }

  // inn: window*8, door*6, bed*6, CHEST*6, FURNACE*6, CRAFTING_TABLE*6, roof*90, primary*300, secondary*50
  if (profile === 'inn') {
    const beds = [
      [2, 1],
      [-2, 1],
      [2, -1],
      [-2, -1],
      [1, 2],
      [-1, 2],
    ];
    for (const [dx, dz] of beds) {
      cmds.push(`setblock ${x + dx} ${y + 1} ${z + dz} red_bed`);
    }
    cmds.push(
      `setblock ${x + 1} ${y + 1} ${z} oak_door[half=lower]`,
      `setblock ${x + 1} ${y + 2} ${z} oak_door[half=upper]`,
      `setblock ${x - 1} ${y + 1} ${z} oak_door[half=lower]`,
      `setblock ${x - 1} ${y + 2} ${z} oak_door[half=upper]`,
      `setblock ${x} ${y + 1} ${z + 2} chest`,
      `setblock ${x} ${y + 1} ${z - 2} chest`,
      `setblock ${x + 2} ${y + 1} ${z} furnace`,
      `setblock ${x - 2} ${y + 1} ${z} furnace`,
      `setblock ${x + 2} ${y + 1} ${z + 1} furnace`,
      `setblock ${x - 2} ${y + 1} ${z + 1} furnace`,
      `setblock ${x + 2} ${y + 1} ${z - 1} crafting_table`,
      `setblock ${x - 2} ${y + 1} ${z - 1} crafting_table`,
      `setblock ${x + 1} ${y + 1} ${z + 2} crafting_table`,
      `setblock ${x - 1} ${y + 1} ${z + 2} crafting_table`,
      `setblock ${x + 1} ${y + 1} ${z - 2} crafting_table`,
      `setblock ${x - 1} ${y + 1} ${z - 2} crafting_table`,
      `setblock ${x + 3} ${y + 2} ${z + 3} glass`,
      `setblock ${x - 3} ${y + 2} ${z + 3} glass`,
      `setblock ${x + 3} ${y + 2} ${z - 3} glass`,
      `setblock ${x - 3} ${y + 2} ${z - 3} glass`
    );
  }

  // barracks: IRON_BARS*6, door*3, bed*3, CHEST*3, FURNACE*3, CRAFTING_TABLE*3, roof*50, primary*200, secondary*40
  if (profile === 'barracks') {
    cmds.push(
      `fill ${x - 3} ${y + 1} ${z - 3} ${x + 3} ${y + 1} ${z - 3} iron_bars`,
      `setblock ${x + 2} ${y + 1} ${z + 1} black_bed`,
      `setblock ${x - 2} ${y + 1} ${z + 1} black_bed`,
      `setblock ${x} ${y + 1} ${z + 2} red_bed`,
      `setblock ${x} ${y + 1} ${z - 1} oak_door[half=lower]`,
      `setblock ${x} ${y + 2} ${z - 1} oak_door[half=upper]`,
      `setblock ${x + 1} ${y + 1} ${z} chest`,
      `setblock ${x - 1} ${y + 1} ${z} furnace`,
      `setblock ${x + 1} ${y + 1} ${z - 1} crafting_table`
    );
  }

  // Leave center clear for region icon chest placed by placeregion
  cmds.push(`setblock ${x} ${y} ${z} grass_block`);
  cmds.push(`setblock ${x} ${y + 1} ${z} air`);

  const results = [];
  for (const c of cmds) {
    results.push({ cmd: c.slice(0, 80), reply: await harness.raw(c) });
  }
  return results;
}

module.exports = {
  radiusFor,
  stockpileMaterials,
};
