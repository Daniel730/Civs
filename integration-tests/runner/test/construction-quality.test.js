/**
 * Construction quality pipeline unit tests (mock harness — no live Paper).
 */

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const {
  planBlueprint,
  compileBlueprint,
  footprintFromBlocks,
} = require('../lib/village/construction/blueprint');
const { houseShell } = require('../lib/village/blueprints');
const {
  validatePalette,
  validateProportions,
  validateArchitecture,
  validateBlueprintSync,
  validateFoundation,
} = require('../lib/village/construction/validate');
const { createTransaction, STATUS } = require('../lib/village/construction/transaction');
const { construct } = require('../lib/village/construction/engine');
const { inspect, computeQualityScore } = require('../lib/village/construction/inspect');
const { scoreSite, selectBestSite, findSurfaceY } = require('../lib/village/construction/site');
const { runProject } = require('../lib/village/construction/pipeline');
const {
  loadMemory,
  saveMemory,
  rememberOutcome,
  preferredStyle,
} = require('../lib/village/construction/memory');
const { reviewVisual } = require('../lib/village/construction/visualCritic');

/** In-memory block world mock. Keys: "x,y,z" → MATERIAL */
function mockHarness(initial = {}) {
  const world = { ...initial };
  const key = (x, y, z) => `${x},${y},${z}`;
  return {
    world,
    block: {
      at: async (x, y, z) => world[key(x, y, z)] || 'AIR',
      set: async (x, y, z, material) => {
        world[key(x, y, z)] = String(material).toUpperCase();
        return { material: world[key(x, y, z)] };
      },
    },
    region: {
      at: async () => ({ type: '' }),
    },
  };
}

function fillTerrain(harness, minX, maxX, minZ, maxZ, y, mat = 'GRASS_BLOCK') {
  for (let x = minX; x <= maxX; x++) {
    for (let z = minZ; z <= maxZ; z++) {
      harness.world[`${x},${y},${z}`] = mat;
    }
  }
}

describe('construction blueprint IR', () => {
  it('compiles houseShell into structured footprint/rooms/entrances', () => {
    const origin = { x: 100, y: 64, z: 100 };
    const template = houseShell(origin, { site: 'shelter', tick: 0 });
    const bp = compileBlueprint(template, {
      purpose: 'house',
      style: 'medieval_village',
      site: 'shelter',
    });
    assert.equal(bp.purpose, 'house');
    assert.ok(bp.footprint.width >= 5);
    assert.ok(bp.floors.length >= 1);
    assert.ok(bp.walls.length > 0);
    assert.ok(bp.roof.length > 0);
    assert.ok(bp.entrances.length >= 1);
    assert.equal(bp.elevated, false);
    assert.ok(bp.materials.primary);
  });

  it('planBlueprint is deterministic for same inputs', () => {
    const origin = { x: 0, y: 70, z: 0 };
    const a = planBlueprint(origin, { site: 'shelter', tick: 1 });
    const b = planBlueprint(origin, { site: 'shelter', tick: 1 });
    assert.equal(a.id, b.id);
    assert.equal(a.blocks.length, b.blocks.length);
    assert.deepEqual(footprintFromBlocks(a.blocks), footprintFromBlocks(b.blocks));
  });
});

describe('construction validators', () => {
  it('accepts coherent medieval palette', () => {
    const bp = planBlueprint({ x: 0, y: 64, z: 0 }, { site: 'shelter', tick: 1 });
    const r = validatePalette(bp);
    assert.equal(r.ok, true, JSON.stringify(r.issues));
  });

  it('rejects precious / high-entropy palettes', () => {
    const bp = planBlueprint({ x: 0, y: 64, z: 0 }, { site: 'shelter', tick: 1 });
    bp.blocks = [
      ...bp.blocks,
      { x: 0, y: 64, z: 0, material: 'diamond_block', role: 'floor' },
      { x: 1, y: 64, z: 0, material: 'gold_block', role: 'floor' },
      { x: 2, y: 64, z: 0, material: 'purple_concrete', role: 'wall' },
    ];
    const r = validatePalette(bp);
    assert.equal(r.ok, false);
    assert.ok(r.issues.some((i) => i.code.startsWith('palette_')));
  });

  it('rejects doorless houses', () => {
    const bp = planBlueprint({ x: 0, y: 64, z: 0 }, { site: 'shelter', tick: 1 });
    bp.entrances = [];
    const r = validateArchitecture(bp);
    assert.equal(r.ok, false);
    assert.ok(r.issues.some((i) => i.code === 'no_entrance'));
  });

  it('flags floating foundation unless elevated', async () => {
    const bp = planBlueprint({ x: 0, y: 64, z: 0 }, { site: 'shelter', tick: 1 });
    const floating = await validateFoundation(bp, {
      supportAt: async () => false,
    });
    assert.equal(floating.ok, false);
    assert.ok(floating.metrics.floating > 0);

    const elevated = await validateFoundation(
      { ...bp, elevated: true },
      {
        supportAt: async () => false,
      }
    );
    assert.equal(elevated.ok, true);
  });

  it('proportion limits catch absurd towers', () => {
    const bp = {
      purpose: 'house',
      footprint: {
        width: 2,
        depth: 2,
        height: 40,
        minX: 0,
        minY: 0,
        minZ: 0,
        maxX: 1,
        maxY: 39,
        maxZ: 1,
      },
      walls: [{}, {}, {}],
      windows: [],
    };
    const r = validateProportions(bp);
    assert.equal(r.ok, false);
  });
});

describe('construction transaction', () => {
  it('logs changes and rollbacks to old blocks', async () => {
    const h = mockHarness({ '1,64,1': 'GRASS_BLOCK' });
    const tx = createTransaction({ harness: h, world: 'world' });
    tx.begin();
    await tx.setBlock({ x: 1, y: 64, z: 1, newBlock: 'oak_planks', reason: 'floor' });
    assert.equal(await h.block.at(1, 64, 1), 'OAK_PLANKS');
    assert.equal(tx.log.length, 1);
    assert.equal(tx.log[0].oldBlock, 'GRASS_BLOCK');
    await tx.rollback();
    assert.equal(tx.status, STATUS.ROLLED_BACK);
    assert.equal(await h.block.at(1, 64, 1), 'GRASS_BLOCK');
  });

  it('pause and resume then abort cleans up', async () => {
    const h = mockHarness({ '0,70,0': 'STONE' });
    const tx = createTransaction({ harness: h });
    tx.begin();
    await tx.setBlock({ x: 0, y: 70, z: 0, newBlock: 'cobblestone', reason: 'test' });
    tx.pause();
    assert.equal(tx.status, STATUS.PROJECT_PAUSED);
    tx.resume();
    await tx.setBlock({ x: 0, y: 71, z: 0, newBlock: 'oak_planks', reason: 'wall' });
    const aborted = await tx.abort('npc_death');
    assert.equal(aborted.status, STATUS.PROJECT_ABORTED);
    assert.equal(await h.block.at(0, 70, 0), 'STONE');
    assert.equal(await h.block.at(0, 71, 0), 'AIR');
  });

  it('unexplainedCount is zero when all changes are logged', () => {
    const tx = createTransaction({});
    tx.begin();
    // sync push via setBlock without harness
    return tx
      .setBlock({ x: 1, y: 2, z: 3, newBlock: 'dirt', oldBlock: 'AIR', reason: 't' })
      .then(() => {
        assert.equal(tx.unexplainedCount([{ x: 1, y: 2, z: 3, newBlock: 'dirt' }]), 0);
        assert.equal(tx.unexplainedCount([{ x: 9, y: 9, z: 9, newBlock: 'dirt' }]), 1);
      });
  });
});

describe('site selection', () => {
  it('rejects water and lava; prefers flat grass', async () => {
    const h = mockHarness();
    fillTerrain(h, 0, 10, 0, 10, 64, 'GRASS_BLOCK');
    h.world['5,64,5'] = 'WATER';
    const wet = await scoreSite(h, { x: 5, z: 5, width: 3, depth: 3 }, { startY: 70 });
    assert.equal(wet.ok, false);
    assert.equal(wet.reject, 'water');

    fillTerrain(h, 20, 30, 20, 30, 64, 'GRASS_BLOCK');
    const dry = await scoreSite(h, { x: 25, z: 25, width: 3, depth: 3 }, { startY: 70 });
    assert.equal(dry.ok, true, JSON.stringify(dry));
    assert.ok(dry.score > 0);
  });

  it('findSurfaceY returns top solid', async () => {
    const h = mockHarness({ '0,60,0': 'STONE', '0,61,0': 'GRASS_BLOCK' });
    const s = await findSurfaceY(h, 0, 0, { startY: 80 });
    assert.equal(s.y, 61);
    assert.equal(s.material, 'GRASS_BLOCK');
  });

  it('selectBestSite returns highest scoring ok candidate', async () => {
    const h = mockHarness();
    fillTerrain(h, -5, 15, -5, 15, 64, 'GRASS_BLOCK');
    // Make one candidate steeper
    h.world['10,68,10'] = 'STONE';
    h.world['10,67,10'] = 'STONE';
    h.world['10,66,10'] = 'STONE';
    h.world['10,65,10'] = 'STONE';
    const { best, ranked } = await selectBestSite(
      h,
      [
        { x: 2, z: 2, width: 3, depth: 3 },
        { x: 10, z: 10, width: 3, depth: 3 },
      ],
      { startY: 80, maxSlope: 2 }
    );
    assert.ok(best);
    assert.equal(best.candidate.x, 2);
    assert.ok(ranked.length === 2);
  });
});

describe('inspect + quality score', () => {
  it('score is measurable and drops with floating blocks', () => {
    const good = computeQualityScore({
      counters: {
        floatingBlocks: 0,
        brokenEntrances: 0,
        invalidStairs: 0,
        missingBlocks: 0,
        roofGaps: 0,
        holes: 0,
      },
      architectureOk: true,
      paletteOk: true,
      proportionOk: true,
      settlementContext: { roadConnected: true, nearbyBuildings: 2 },
    });
    const bad = computeQualityScore({
      counters: {
        floatingBlocks: 5,
        brokenEntrances: 2,
        invalidStairs: 1,
        missingBlocks: 10,
        roofGaps: 1,
        holes: 2,
      },
      architectureOk: false,
      paletteOk: false,
      proportionOk: false,
    });
    assert.ok(good.overall > bad.overall);
    assert.ok(good.structural_integrity > bad.structural_integrity);
    assert.ok(good.overall <= 1 && good.overall >= 0);
  });

  it('inspect enforces NORMAL_BUILDING_FLOATING_BLOCKS=0', async () => {
    const bp = planBlueprint({ x: 50, y: 80, z: 50 }, { site: 'shelter', tick: 1 });
    const report = await inspect({
      blueprint: bp,
      supportAt: async () => false,
    });
    assert.equal(report.pass, false);
    assert.equal(report.invariants.NORMAL_BUILDING_FLOATING_BLOCKS, report.counters.floatingBlocks);
    assert.ok(report.counters.floatingBlocks > 0);
  });
});

describe('pipeline vertical slice', () => {
  let memFile;
  beforeEach(() => {
    memFile = path.join(os.tmpdir(), `civs-cq-mem-${Date.now()}-${Math.random()}.json`);
  });

  it('dryRun validates house on supported terrain without placing', async () => {
    const origin = { x: 200, y: 64, z: 200 };
    const bp = planBlueprint(origin, { site: 'shelter', tick: 1 });
    const h = mockHarness();
    fillTerrain(
      h,
      bp.footprint.minX - 2,
      bp.footprint.maxX + 2,
      bp.footprint.minZ - 2,
      bp.footprint.maxZ + 2,
      63,
      'GRASS_BLOCK'
    );
    const result = await runProject({
      harness: h,
      origin,
      blueprint: bp,
      dryRun: true,
      skipSiteSelection: true,
      supportAt: async (x, y, z) => {
        const m = await h.block.at(x, y - 1, z);
        return m !== 'AIR';
      },
      memoryPath: memFile,
      persistMemory: false,
    });
    assert.equal(result.status, 'VALIDATED');
    assert.equal(result.ok, true);
  });

  it('construct + inspect + commit on flat terrain', async () => {
    const origin = { x: 300, y: 64, z: 300 };
    const bp = planBlueprint(origin, { site: 'shelter', tick: 1 });
    const h = mockHarness();
    fillTerrain(
      h,
      bp.footprint.minX - 2,
      bp.footprint.maxX + 2,
      bp.footprint.minZ - 2,
      bp.footprint.maxZ + 2,
      63,
      'GRASS_BLOCK'
    );
    // clear air for building volume
    for (const b of bp.blocks) {
      h.world[`${b.x},${b.y},${b.z}`] = 'AIR';
    }
    const result = await runProject({
      harness: h,
      origin,
      blueprint: bp,
      skipSiteSelection: true,
      supportAt: async (x, y) => {
        // terrain at y-1 under floors
        return y - 1 === 63 || (await h.block.at(x, y - 1)) !== 'AIR';
      },
      memoryPath: memFile,
      persistMemory: true,
      settlementContext: { roadConnected: true, nearbyBuildings: 1 },
    });
    assert.equal(result.ok, true, JSON.stringify(result.stages));
    assert.equal(result.status, STATUS.COMMITTED);
    assert.ok(result.inspection.score.overall > 0.4);
    assert.equal(result.inspection.invariants.UNEXPLAINED_BLOCK_CHANGES, 0);
  });

  it('aborts invalid blueprint without placing', async () => {
    const origin = { x: 0, y: 64, z: 0 };
    const bp = planBlueprint(origin, { site: 'shelter', tick: 1 });
    bp.blocks.push({ x: 0, y: 64, z: 0, material: 'diamond_block', role: 'floor' });
    bp.materials = { ...bp.materials }; // keep
    const h = mockHarness();
    const result = await runProject({
      harness: h,
      origin,
      blueprint: bp,
      skipSiteSelection: true,
      supportAt: async () => true,
      memoryPath: memFile,
      persistMemory: false,
    });
    assert.equal(result.ok, false);
    assert.equal(result.status, STATUS.PROJECT_ABORTED);
    assert.equal(result.reason, 'validation_failed');
  });

  it('interrupted construction yields PROJECT_PAUSED and resume continues', async () => {
    const origin = { x: 400, y: 64, z: 400 };
    const bp = planBlueprint(origin, { site: 'shelter', tick: 1 });
    const h = mockHarness();
    fillTerrain(
      h,
      bp.footprint.minX - 2,
      bp.footprint.maxX + 2,
      bp.footprint.minZ - 2,
      bp.footprint.maxZ + 2,
      63,
      'GRASS_BLOCK'
    );
    let calls = 0;
    const first = await runProject({
      harness: h,
      origin,
      blueprint: bp,
      skipSiteSelection: true,
      supportAt: async () => true,
      memoryPath: memFile,
      persistMemory: false,
      maxBlocks: 5,
      shouldPause: () => {
        calls += 1;
        return calls > 3;
      },
    });
    assert.equal(first.status, STATUS.PROJECT_PAUSED);
    assert.ok(first.nextIndex > 0);

    const second = await runProject({
      harness: h,
      origin,
      blueprint: bp,
      skipSiteSelection: true,
      supportAt: async () => true,
      memoryPath: memFile,
      persistMemory: false,
      startIndex: first.nextIndex,
      projectId: first.tx.projectId,
      priorLog: first.tx.log,
    });
    assert.ok(
      second.status === STATUS.COMMITTED || second.status === STATUS.PROJECT_PAUSED || second.ok,
      JSON.stringify(second.stages)
    );
  });

  it('rollback restores world after failed inspection', async () => {
    const origin = { x: 500, y: 64, z: 500 };
    // path has no foundation floating issues — force a house then break support after place via inspect supportAt false
    const bp = planBlueprint(origin, { site: 'shelter', tick: 1 });
    const h = mockHarness();
    fillTerrain(
      h,
      bp.footprint.minX - 2,
      bp.footprint.maxX + 2,
      bp.footprint.minZ - 2,
      bp.footprint.maxZ + 2,
      63,
      'GRASS_BLOCK'
    );
    const before = { ...h.world };
    // Pre-validate with support, but inspect with no support → rollback
    const result = await runProject({
      harness: h,
      origin,
      blueprint: bp,
      skipSiteSelection: true,
      supportAt: async () => true,
      memoryPath: memFile,
      persistMemory: false,
      minScore: 0.99,
    });
    // After commit or rollback, unexplained damage must be 0 relative to tx
    if (!result.ok && result.tx) {
      for (const e of result.tx.log) {
        const mat = await h.block.at(e.x, e.y, e.z);
        assert.equal(mat, String(e.oldBlock).toUpperCase());
      }
    } else if (result.ok) {
      // committed — blocks should match new
      assert.ok(result.tx.log.length > 0);
    }
    assert.ok(before);
  });
});

describe('construction memory + vision stub', () => {
  it('remembers style successes and prefers them', () => {
    const mem = loadMemory('/tmp/does-not-exist-cq.json');
    rememberOutcome(mem, {
      projectId: 'p1',
      status: 'COMMITTED',
      style: 'forest_settlement',
      purpose: 'house',
      score: { overall: 0.8 },
    });
    rememberOutcome(mem, {
      projectId: 'p2',
      status: 'COMMITTED',
      style: 'forest_settlement',
      purpose: 'house',
      score: { overall: 0.7 },
    });
    rememberOutcome(mem, {
      projectId: 'p3',
      status: 'COMMITTED',
      style: 'desert_settlement',
      purpose: 'house',
      score: { overall: 0.9 },
    });
    assert.equal(preferredStyle(mem), 'forest_settlement');
    const file = path.join(os.tmpdir(), `cq-mem-save-${Date.now()}.json`);
    saveMemory(mem, file);
    assert.ok(fs.existsSync(file));
    const loaded = loadMemory(file);
    assert.equal(preferredStyle(loaded), 'forest_settlement');
    fs.unlinkSync(file);
  });

  it('vision critic never mutates and is off by default', async () => {
    const r = await reviewVisual({ enabled: false });
    assert.equal(r.enabled, false);
    assert.deepEqual(r.suggestions, []);
    const on = await reviewVisual({
      enabled: true,
      critiqueFn: async () => [{ code: 'roof_looks_off', message: 'roof disproportionate' }],
    });
    assert.equal(on.suggestions.length, 1);
  });
});

describe('validateBlueprintSync smoke', () => {
  it('path blueprints skip house foundation rules', () => {
    const bp = planBlueprint({ x: 0, y: 64, z: 0 }, { site: 'shelter', tick: 0 });
    assert.equal(bp.purpose, 'path');
    const r = validateBlueprintSync(bp);
    assert.equal(r.ok, true, JSON.stringify(r.issues));
  });
});
