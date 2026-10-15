'use strict';

// M3 — Tool-block matching contract (lib/tool-check.js).
// Verifies the core spec: held item vs block/mob type is matched, mismatches are
// reported, and the correct tool to fetch/craft/equip is identified. Pure, no I/O.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  checkTool,
  expectedToolName,
  findToolInInventory,
  classifyHeld,
} = require('../lib/tool-check');

describe('tool-check M3: correct-tool matches', () => {
  it('axe matches wood/log/planks', () => {
    assert.equal(checkTool('IRON_AXE', 'OAK_LOG').matched, true);
    assert.equal(checkTool('DIAMOND_AXE', 'OAK_PLANKS').matched, true);
    assert.equal(checkTool('WOODEN_AXE', 'SPRUCE_LOG').matched, true);
  });

  it('pickaxe matches stone/ore/cobblestone', () => {
    assert.equal(checkTool('IRON_PICKAXE', 'STONE').matched, true);
    assert.equal(checkTool('STONE_PICKAXE', 'COBBLESTONE').matched, true);
    assert.equal(checkTool('IRON_PICKAXE', 'IRON_ORE').matched, true);
    assert.equal(checkTool('GOLD_PICKAXE', 'NETHERRACK').matched, true);
  });

  it('shovel matches dirt/sand/gravel', () => {
    assert.equal(checkTool('IRON_SHOVEL', 'DIRT').matched, true);
    assert.equal(checkTool('DIAMOND_SHOVEL', 'SAND').matched, true);
  });

  it('sword matches mob/hostile', () => {
    assert.equal(checkTool('IRON_SWORD', 'mob').matched, true);
    assert.equal(checkTool('DIAMOND_SWORD', 'hostile').matched, true);
    assert.equal(checkTool('WOODEN_SWORD', 'zombie').matched, true);
  });
});

describe('tool-check M3: mismatch detection', () => {
  it('axe vs stone is a mismatch (use pickaxe)', () => {
    const v = checkTool('IRON_AXE', 'STONE');
    assert.equal(v.matched, false);
    assert.equal(v.actualTool, 'axe');
    assert.equal(v.targetCategory, 'pickaxe');
    assert.equal(v.expectedTool ? v.expectedTool : v.expectedTool, 'pickaxe');
    assert.equal(v.action, 'switch_or_fetch');
  });

  it('pickaxe vs wood is a mismatch (use axe)', () => {
    const v = checkTool('IRON_PICKAXE', 'OAK_LOG');
    assert.equal(v.matched, false);
    assert.equal(v.expectedTool, 'axe');
  });

  it('empty hands on a minable target => fetch_or_craft', () => {
    const v = checkTool('AIR', 'OAK_LOG');
    assert.equal(v.matched, false);
    assert.equal(v.actualTool, 'none');
    assert.equal(v.action, 'fetch_or_craft');
    assert.equal(v.expectedTool, 'axe');

    const v2 = checkTool(null, 'STONE');
    assert.equal(v2.matched, false);
    assert.equal(v2.action, 'fetch_or_craft');
    assert.equal(v2.expectedTool, 'pickaxe');
  });

  it('obsidian needs a diamond-tier pickaxe (weak tier rejected)', () => {
    assert.equal(checkTool('IRON_PICKAXE', 'OBSIDIAN').matched, false);
    assert.equal(checkTool('IRON_PICKAXE', 'OBSIDIAN').action, 'fetch_or_craft');
    assert.equal(checkTool('DIAMOND_PICKAXE', 'OBSIDIAN').matched, true);
    assert.equal(checkTool('NETHERITE_PICKAXE', 'OBSIDIAN').matched, true);
  });
});

describe('tool-check M3: inventory-aware fetch/craft routing', () => {
  it('findToolInInventory locates an owned tool (no giveItem)', () => {
    const inv = [
      { material: 'OAK_LOG', amount: 3 },
      { material: 'IRON_AXE', amount: 1 },
      { material: 'COOKED_BEEF', amount: 2 },
    ];
    assert.equal(findToolInInventory(inv, 'axe'), 'IRON_AXE');
    assert.equal(findToolInInventory(inv, 'pickaxe'), null);
  });

  it('findToolInInventory honors the diamond tier for obsidian', () => {
    const inv = [
      { material: 'IRON_PICKAXE', amount: 1 },
      { material: 'DIAMOND_PICKAXE', amount: 1 },
    ];
    assert.equal(findToolInInventory(inv, 'diamond_pickaxe'), 'DIAMOND_PICKAXE');
    // a plain 'pickaxe' search also returns the iron one (weaker), proving the
    // diamond requirement lives in checkTool, not findToolInInventory.
    assert.equal(findToolInInventory(inv, 'pickaxe'), 'IRON_PICKAXE');
  });

  it('checkTool + findToolInInventory together flag owned-but-not-held', () => {
    const inv = [{ material: 'IRON_AXE', amount: 1 }];
    const v = checkTool('IRON_PICKAXE', 'OAK_LOG');
    assert.equal(v.matched, false);
    const have = findToolInInventory(inv, v.expectedTool);
    assert.equal(have, 'IRON_AXE'); // NPC owns the right tool — just not in hand
  });
});

describe('tool-check M3: held classification + non-tool blocks', () => {
  it('classifies held item families', () => {
    assert.equal(classifyHeld('IRON_AXE').tool, 'axe');
    assert.equal(classifyHeld('DIAMOND_PICKAXE').tool, 'pickaxe');
    assert.equal(classifyHeld('WOODEN_SHOVEL').tool, 'shovel');
    assert.equal(classifyHeld('STONE_SWORD').tool, 'sword');
    assert.equal(classifyHeld('OAK_LOG').tool, 'none');
    assert.equal(classifyHeld('AIR').tool, 'none');
  });

  it('non-tool block => bare hands suffice (unknown:true)', () => {
    const v = checkTool('STONE', 'BEDROCK');
    assert.equal(v.matched, true);
    assert.equal(v.unknown, true);
  });

  it('expectedToolName maps the canonical tool to fetch/craft', () => {
    assert.equal(expectedToolName('OBSIDIAN'), 'diamond_pickaxe');
    assert.equal(expectedToolName('OAK_LOG'), 'axe');
    assert.equal(expectedToolName('STONE'), 'pickaxe');
    assert.equal(expectedToolName('DIRT'), 'shovel');
    assert.equal(expectedToolName('mob'), 'sword');
  });
});
