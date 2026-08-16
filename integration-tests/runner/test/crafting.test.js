'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const { craftWithOwnResources, canCraftFromInventory } = require('../lib/crafting');

function fakePorts(itemsByPlayer = {}) {
  return {
    inventory: async (player) => {
      const items = Array.isArray(itemsByPlayer[player]) ? itemsByPlayer[player] : [];
      return { success: true, data: { items } };
    },
    craftItem: async (player, material, amount) => ({ success: true, material, amount }),
    giveItem: async (player, material, amount) => ({ success: true, material, amount }),
    eventSink: {
      emit: (name, payload) => ({ name, payload }),
    },
  };
}

describe('crafting', () => {
  it('can craft when ingredients are present', async () => {
    const ports = fakePorts({
      Steve: [
        { material: 'COBBLESTONE', amount: 3 },
        { material: 'STICK', amount: 2 },
      ],
    });
    const recipe = { result: 'STONE_PICKAXE', ingredients: [
      { material: 'COBBLESTONE', amount: 3 },
      { material: 'STICK', amount: 2 },
    ]};

    const out = await canCraftFromInventory(ports, 'Steve', recipe);
    assert.strictEqual(out.canCraft, true);
    assert.deepStrictEqual(out.missing, []);

    const craft = await craftWithOwnResources(ports, 'Steve', 'STONE_PICKAXE', 1, recipe);
    assert.strictEqual(craft.success, true);
    assert.strictEqual(craft.reason, 'crafted');
  });

  it('declines craft when materials are missing', async () => {
    const ports = fakePorts({
      Steve: [
        { material: 'COBBLESTONE', amount: 1 },
        { material: 'STICK', amount: 2 },
      ],
    });
    const recipe = { result: 'STONE_PICKAXE', ingredients: [
      { material: 'COBBLESTONE', amount: 3 },
      { material: 'STICK', amount: 2 },
    ]};

    const precheck = await canCraftFromInventory(ports, 'Steve', recipe);
    assert.strictEqual(precheck.canCraft, false);
    assert.ok(precheck.missing.some((m) => m.material === 'COBBLESTONE'));

    const craft = await craftWithOwnResources(ports, 'Steve', 'STONE_PICKAXE', 1, recipe);
    assert.strictEqual(craft.success, false);
    assert.strictEqual(craft.reason, 'missing_materials');
  });

  it('normalizes recipe/result material names', async () => {
    const ports = fakePorts({
      Steve: [
        { material: 'minecraft:cobblestone', amount: 3 },
        { material: 'STICK', amount: 2 },
      ],
    });
    const recipe = { result: 'minecraft:stone_pickaxe', ingredients: [
      { material: 'cobblestone', amount: 3 },
      { material: 'STICK', amount: 2 },
    ]};

    const precheck = await canCraftFromInventory(ports, 'Steve', recipe);
    assert.strictEqual(precheck.canCraft, true);
  });
});
