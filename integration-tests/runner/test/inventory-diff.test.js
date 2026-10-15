'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { applyObserve, diffInventory } = require('../lib/inventory-diff');

// ---------------------------------------------------------------------------
// applyObserve
// ---------------------------------------------------------------------------
describe('applyObserve', () => {
  it('normalizes a full cap.observe result', () => {
    const obs = {
      success: true,
      data: {
        x: 1, y: 2, z: 3,
        inventory: [
          { material: 'OAK_LOG', amount: 9 },
          { material: 'IRON_AXE', amount: 1 },
          { material: 'BOOK', amount: 12 },
        ],
      },
    };
    assert.deepEqual(applyObserve(obs), { OAK_LOG: 9, IRON_AXE: 1, BOOK: 12 });
  });

  it('normalizes the bare data object', () => {
    const data = { inventory: [{ material: 'DIRT', amount: 4 }] };
    assert.deepEqual(applyObserve(data), { DIRT: 4 });
  });

  it('normalizes a raw inventory array', () => {
    assert.deepEqual(applyObserve([{ material: 'COBBLESTONE', amount: 3 }]), { COBBLESTONE: 3 });
  });

  it('accepts alt field names (item/count/qty)', () => {
    assert.deepEqual(
      applyObserve([{ item: 'STONE', count: 2 }, { name: 'GRAVEL', qty: 5 }]),
      { STONE: 2, GRAVEL: 5 }
    );
  });

  it('sums duplicate materials', () => {
    assert.deepEqual(
      applyObserve([{ material: 'OAK_LOG', amount: 1 }, { material: 'OAK_LOG', amount: 2 }]),
      { OAK_LOG: 3 }
    );
  });

  it('returns {} for null / empty / malformed input', () => {
    assert.deepEqual(applyObserve(null), {});
    assert.deepEqual(applyObserve(undefined), {});
    assert.deepEqual(applyObserve({}), {});
    assert.deepEqual(applyObserve({ data: {} }), {});
  });

  it('passes an existing map through (copied)', () => {
    const m = { OAK_LOG: 9 };
    const out = applyObserve(m);
    assert.deepEqual(out, m);
    assert.notStrictEqual(out, m); // defensive copy
  });
});

// ---------------------------------------------------------------------------
// diffInventory — core gained/lost from two maps
// ---------------------------------------------------------------------------
describe('diffInventory (gained/lost)', () => {
  it('reports a single gained item', () => {
    const before = { OAK_LOG: 9 };
    const after = { OAK_LOG: 10 };
    const d = diffInventory(before, after);
    assert.deepEqual(d.gained, [{ item: 'OAK_LOG', qty: 1 }]);
    assert.deepEqual(d.lost, []);
    assert.deepEqual(d.dropped, []);
  });

  it('reports a single lost item', () => {
    const before = { OAK_LOG: 9, BOOK: 12 };
    const after = { OAK_LOG: 9, BOOK: 3 };
    const d = diffInventory(before, after);
    assert.deepEqual(d.gained, []);
    assert.deepEqual(d.lost, [{ item: 'BOOK', qty: 9 }]);
    assert.deepEqual(d.dropped, []);
  });

  it('reports gained + lost simultaneously', () => {
    const before = { OAK_LOG: 9, BOOK: 12 };
    const after = { OAK_LOG: 10, BOOK: 3 };
    const d = diffInventory(before, after);
    assert.deepEqual(d.gained, [{ item: 'OAK_LOG', qty: 1 }]);
    assert.deepEqual(d.lost, [{ item: 'BOOK', qty: 9 }]);
  });

  it('accepts observe-shaped objects directly', () => {
    const before = { success: true, data: { inventory: [{ material: 'OAK_LOG', amount: 9 }] } };
    const after = { success: true, data: { inventory: [{ material: 'OAK_LOG', amount: 10 }] } };
    const d = diffInventory(before, after, { from: 'break:OAK_LOG' });
    assert.deepEqual(d.gained, [{ item: 'OAK_LOG', qty: 1, from: 'break:OAK_LOG' }]);
  });

  it('stamps from onto gained entries', () => {
    const d = diffInventory({ A: 1 }, { A: 3 }, { from: 'chest:STOCKPILE' });
    assert.deepEqual(d.gained, [{ item: 'A', qty: 2, from: 'chest:STOCKPILE' }]);
  });

  it('empty diff on identical inventories', () => {
    const d = diffInventory({ A: 1, B: 2 }, { A: 1, B: 2 });
    assert.deepEqual(d, { gained: [], lost: [], dropped: [] });
  });

  it('treats a brand-new item as gained, removed item as lost', () => {
    const before = { A: 1 };
    const after = { B: 1 };
    const d = diffInventory(before, after);
    assert.deepEqual(d.gained, [{ item: 'B', qty: 1 }]);
    assert.deepEqual(d.lost, [{ item: 'A', qty: 1 }]);
  });
});

// ---------------------------------------------------------------------------
// diffInventory — dropped (floor / uncollected) classification
// ---------------------------------------------------------------------------
describe('diffInventory (dropped)', () => {
  it('classifies a produced-but-uncollected item as dropped', () => {
    // Broke OAK_LOG (expected 1) but inventory unchanged -> it fell on the floor.
    const before = { OAK_LOG: 9, BOOK: 12 };
    const after = { OAK_LOG: 9, BOOK: 12 };
    const d = diffInventory(before, after, {
      expectedDrops: { OAK_LOG: 1 },
      from: 'break:OAK_LOG',
    });
    // OAK_LOG neither gained nor lost in the snapshot...
    assert.deepEqual(d.gained, []);
    assert.deepEqual(d.lost, []);
    // ...but it should have been produced -> dropped on the floor.
    assert.deepEqual(d.dropped, [{ item: 'OAK_LOG', qty: 1 }]);
  });

  it('does NOT report dropped when the item was fully collected', () => {
    const before = { OAK_LOG: 9 };
    const after = { OAK_LOG: 10 }; // +1 collected
    const d = diffInventory(before, after, { expectedDrops: { OAK_LOG: 1 } });
    assert.deepEqual(d.gained, [{ item: 'OAK_LOG', qty: 1 }]);
    assert.deepEqual(d.dropped, []);
  });

  it('reports only the uncollected shortfall as dropped', () => {
    // Expected 3, collected 1 -> 2 dropped.
    const before = { DIRT: 0 };
    const after = { DIRT: 1 };
    const d = diffInventory(before, after, { expectedDrops: { DIRT: 3 } });
    assert.deepEqual(d.gained, [{ item: 'DIRT', qty: 1 }]);
    assert.deepEqual(d.dropped, [{ item: 'DIRT', qty: 2 }]);
  });

  it('drops nothing when expectedDrops absent (can not infer floor state)', () => {
    const before = { OAK_LOG: 9 };
    const after = { OAK_LOG: 9 }; // item broke but was not collected
    const d = diffInventory(before, after);
    assert.deepEqual(d.gained, []);
    assert.deepEqual(d.dropped, []); // correctly unknowable without expectedDrops
  });

  it('uses an explicit opts.dropped map verbatim (ground observation wins)', () => {
    const before = { OAK_LOG: 9 };
    const after = { OAK_LOG: 9 };
    const d = diffInventory(before, after, { dropped: { OAK_LOG: 1, STICK: 2 } });
    assert.deepEqual(d.dropped, [
      { item: 'OAK_LOG', qty: 1 },
      { item: 'STICK', qty: 2 },
    ]);
  });
});
