'use strict';

/**
 * agent-events.test.js — M6 typed event builders.
 * Pure unit tests: every builder must emit a stable `kind`, embed tool + inventory
 * context, coerce bad inputs safely (no throw, no NaN), and round-trip through JSON.
 */

const test = require('node:test');
const assert = require('node:assert');

const {
  SCHEMA_VERSION,
  KIND,
  buildMineEvent,
  buildBreakEvent,
  buildGatherEvent,
  buildPlaceEvent,
  _toolFrom,
  _normInv,
} = require('../lib/agent-events');

test('SCHEMA_VERSION is a positive integer', () => {
  assert.ok(Number.isInteger(SCHEMA_VERSION) && SCHEMA_VERSION > 0);
});

test('buildMineEvent carries full context (target+pos, tool, inventory, result)', () => {
  const verdict = { matched: true, expectedTool: 'pickaxe', actualTool: 'pickaxe', reason: 'iron_pickaxe ok' };
  const inv = { gained: [{ item: 'COBBLESTONE', qty: 1, from: 'break:STONE@1,2,3' }], lost: [], dropped: [] };
  const e = buildMineEvent({
    actor: 'Steve',
    job: 'miner',
    target: { blockType: 'STONE', x: 1, y: 2, z: 3 },
    held: 'IRON_PICKAXE',
    toolVerdict: verdict,
    invDiff: inv,
    success: true,
    position: { x: 5, y: 6, z: 7 },
  });
  assert.strictEqual(e.kind, KIND.MINE);
  assert.strictEqual(e.action, 'mine');
  assert.strictEqual(e.actor, 'Steve');
  assert.strictEqual(e.job, 'miner');
  assert.deepStrictEqual(e.target, { blockType: 'STONE', x: 1, y: 2, z: 3 });
  assert.strictEqual(e.tool.matched, true);
  assert.strictEqual(e.tool.held, 'IRON_PICKAXE');
  assert.strictEqual(e.tool.expected, 'pickaxe');
  assert.deepStrictEqual(e.inventory.gained, [{ item: 'COBBLESTONE', qty: 1, from: 'break:STONE@1,2,3' }]);
  assert.strictEqual(e.result.success, true);
  assert.deepStrictEqual(e.position, { x: 5, y: 6, z: 7 });
  assert.strictEqual(e.schemaVersion, SCHEMA_VERSION);
  // Must be JSON-serializable (no circular refs).
  assert.doesNotThrow(() => JSON.stringify(e));
});

test('buildMineEvent tolerates null inputs without throwing or NaN', () => {
  const e = buildMineEvent({});
  assert.strictEqual(e.kind, KIND.MINE);
  assert.strictEqual(e.target.blockType, null);
  assert.strictEqual(Number.isNaN(e.target.x), false);
  assert.strictEqual(e.tool.matched, null);
  assert.deepStrictEqual(e.inventory, { gained: [], lost: [], dropped: [] });
  assert.strictEqual(e.result.success, false);
  assert.strictEqual(e.position, null);
});

test('buildBreakEvent uses BREAK kind and accepts plain coords', () => {
  const e = buildBreakEvent({
    actor: 'Steve',
    job: 'beautify',
    target: { x: 10, y: 11, z: 12 },
    invDiff: { gained: [], lost: [{ item: 'COBBLESTONE', qty: 1 }], dropped: [] },
    success: true,
  });
  assert.strictEqual(e.kind, KIND.BREAK);
  assert.deepStrictEqual(e.target, { blockType: null, x: 10, y: 11, z: 12 });
  assert.strictEqual(e.inventory.lost[0].item, 'COBBLESTONE');
});

test('buildGatherEvent carries gathered count', () => {
  const e = buildGatherEvent({
    actor: 'Steve',
    job: 'gather',
    target: { x: 1, y: 2, z: 3 },
    gathered: 1,
    success: true,
  });
  assert.strictEqual(e.kind, KIND.GATHER);
  assert.strictEqual(e.gathered, 1);
});

test('buildPlaceEvent carries material and embeds lost-from-inventory (proves player-like, no admin fill)', () => {
  const e = buildPlaceEvent({
    actor: 'Steve',
    job: 'builder',
    material: 'OAK_PLANKS',
    target: { x: 4, y: 5, z: 6 },
    invDiff: { gained: [], lost: [{ item: 'OAK_PLANKS', qty: 1 }], dropped: [] },
    success: true,
  });
  assert.strictEqual(e.kind, KIND.PLACE);
  assert.strictEqual(e.target.blockType, 'OAK_PLANKS');
  assert.strictEqual(e.inventory.lost[0].item, 'OAK_PLANKS');
  assert.strictEqual(e.result.success, true);
});

test('_toolFrom prefers a tool-check verdict when present', () => {
  const v = { matched: false, expectedTool: 'diamond_pickaxe', actualTool: 'wood_pickaxe', reason: 'too weak' };
  assert.deepStrictEqual(_toolFrom('WOOD_PICKAXE', v), {
    held: 'WOOD_PICKAXE',
    category: 'wood_pickaxe',
    expected: 'diamond_pickaxe',
    matched: false,
    reason: 'too weak',
  });
});

test('_normInv coerces non-array / missing shapes to empty arrays', () => {
  assert.deepStrictEqual(_normInv(null), { gained: [], lost: [], dropped: [] });
  assert.deepStrictEqual(_normInv({ gained: 'x' }), { gained: [], lost: [], dropped: [] });
  assert.deepStrictEqual(_normInv({ gained: [{ item: 'A', qty: 2 }] }).gained[0], { item: 'A', qty: 2, from: null });
});

test('every builder stamps a stable kind vocabulary', () => {
  const kinds = [
    buildMineEvent({}).kind,
    buildBreakEvent({}).kind,
    buildGatherEvent({}).kind,
    buildPlaceEvent({}).kind,
  ];
  assert.deepStrictEqual(kinds, [KIND.MINE, KIND.BREAK, KIND.GATHER, KIND.PLACE]);
});
