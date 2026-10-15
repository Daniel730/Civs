const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { findSurfaceY, clearSurfaceCache } = require('../lib/village/terrain');

// Mock harness: given a map "x,y,z" -> material, returns a RCON reply containing
// 'Test passed' for an `if block ... air` probe when the material is air-ish.
function fakeHarness(world) {
  const air = new Set(['air', 'cave_air', 'void_air', 'short_grass']);
  return {
    async raw(cmd) {
      const m = /if block (-?\d+) (-?\d+) (-?\d+) minecraft:(\S+)/.exec(cmd);
      if (!m) return '';
      const [, x, y, z, mat] = m;
      const key = `${x},${y},${z}`;
      const actual = world.get(key);
      if (actual == null) return 'no block';
      return air.has(actual) ? 'Test passed' : 'Test failed';
    },
  };
}

// Solid ground at topY with two clear blocks above (a normal stand).
function openColumn(topY) {
  const w = new Map();
  for (let y = 70; y <= 90; y++) {
    w.set(`0,${y},0`, y <= topY ? 'grass_block' : 'air');
  }
  return w;
}

describe('findSurfaceY (terrain)', () => {
  beforeEach(() => clearSurfaceCache());

  it('returns the fallback surface when two clear blocks sit above it', async () => {
    const w = openColumn(80); // grass at 80, air 81+ -> head room
    const y = await findSurfaceY(fakeHarness(w), 0, 0, { fallbackY: 80 });
    assert.equal(y, 80);
  });

  it('prefers fallback height when it is head-clear', async () => {
    const w = openColumn(80);
    const y = await findSurfaceY(fakeHarness(w), 0, 0, { fallbackY: 80 });
    assert.equal(y, 80);
  });

  it('finds the top of a tall solid stack (no suffocation at the surface)', async () => {
    // grass 70..84, air 85+ : top of stack is 84 with two air blocks above
    const w = openColumn(84);
    const y = await findSurfaceY(fakeHarness(w), 0, 0, { fallbackY: 80 });
    assert.equal(y, 84);
  });
});
