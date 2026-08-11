#!/usr/bin/env node
/**
 * Live construction-quality scenarios against a Paper QA server (optional).
 * Leaves the world valid after each case (rollback / cleanup).
 *
 * Usage:
 *   RCON_PASSWORD=civsqa node scripts/construction-scenarios.js
 *
 * Not a mandatory CI gate — unit tests cover the pipeline; this is empirical QA.
 */
const fs = require('fs');
const path = require('path');
const { Harness } = require('../lib/harness');
const { planBlueprint } = require('../lib/village/construction/blueprint');
const { runProject } = require('../lib/village/construction/pipeline');
const { scoreSite } = require('../lib/village/construction/site');
const { createTransaction } = require('../lib/village/construction/transaction');

const REPORTS = path.join(__dirname, '..', 'reports');
const OUT = path.join(REPORTS, 'construction-scenarios.json');

const cfg = {
  rconHost: process.env.RCON_HOST || '127.0.0.1',
  rconPort: Number.parseInt(process.env.RCON_PORT || '25575', 10),
  rconPassword: process.env.RCON_PASSWORD || 'civsqa',
  origin: {
    x: Number.parseInt(process.env.CQ_X || '6100', 10),
    y: Number.parseInt(process.env.CQ_Y || '80', 10),
    z: Number.parseInt(process.env.CQ_Z || '6100', 10),
  },
};

async function scenario(name, fn) {
  const t0 = Date.now();
  try {
    const detail = await fn();
    return { name, status: 'PASS', ms: Date.now() - t0, ...detail };
  } catch (e) {
    return {
      name,
      status: 'FAIL',
      ms: Date.now() - t0,
      error: String(e && e.message ? e.message : e),
    };
  }
}

async function main() {
  if (!fs.existsSync(REPORTS)) fs.mkdirSync(REPORTS, { recursive: true });
  const harness = new Harness({
    host: cfg.rconHost,
    port: cfg.rconPort,
    password: cfg.rconPassword,
  });
  await harness.connect();
  const results = [];
  const o = cfg.origin;
  const mem = path.join(REPORTS, 'construction-scenarios-memory.json');

  results.push(
    await scenario('flat_terrain_house', async () => {
      const origin = { x: o.x, y: o.y, z: o.z };
      // Small flat pad ONLY for this isolated scenario fixture (not village-builder default).
      await harness.raw(
        `fill ${origin.x - 8} ${origin.y - 1} ${origin.z - 12} ${origin.x + 8} ${origin.y - 1} ${origin.z + 2} grass_block`
      );
      await harness.raw(
        `fill ${origin.x - 8} ${origin.y} ${origin.z - 12} ${origin.x + 8} ${origin.y + 6} ${origin.z + 2} air`
      );
      const bp = planBlueprint(origin, { site: 'shelter', tick: 1 });
      const project = await runProject({
        harness,
        origin,
        blueprint: bp,
        skipSiteSelection: true,
        memoryPath: mem,
        persistMemory: true,
        supportAt: async (x, y, z) => {
          const m = String((await harness.block.at(x, y - 1, z)) || 'AIR').toUpperCase();
          return m !== 'AIR' && !m.includes('WATER') && !m.includes('LAVA');
        },
      });
      if (!project.ok) throw new Error(project.reason || project.status);
      return { score: project.inspection && project.inspection.score };
    })
  );

  results.push(
    await scenario('near_water_reject', async () => {
      const x = o.x + 40;
      const z = o.z;
      const y = o.y;
      await harness.raw(`fill ${x - 2} ${y} ${z - 2} ${x + 2} ${y} ${z + 2} water`);
      const scored = await scoreSite(harness, { x, z, width: 3, depth: 3 }, { startY: y + 20 });
      // cleanup water
      await harness.raw(`fill ${x - 2} ${y} ${z - 2} ${x + 2} ${y} ${z + 2} air`);
      if (scored.ok) throw new Error('expected water reject');
      return { reject: scored.reject };
    })
  );

  results.push(
    await scenario('rollback_restores', async () => {
      const x = o.x + 60;
      const y = o.y;
      const z = o.z;
      await harness.block.set(x, y, z, 'STONE');
      const before = await harness.block.at(x, y, z);
      const tx = createTransaction({ harness, world: 'world' });
      tx.begin();
      await tx.setBlock({ x, y, z, newBlock: 'oak_planks', reason: 'test' });
      await tx.rollback();
      const after = await harness.block.at(x, y, z);
      if (String(after).toUpperCase() !== String(before).toUpperCase()) {
        throw new Error(`rollback failed ${before} -> ${after}`);
      }
      return { before, after };
    })
  );

  results.push(
    await scenario('invalid_blueprint_abort', async () => {
      const origin = { x: o.x + 80, y: o.y, z: o.z };
      const bp = planBlueprint(origin, { site: 'shelter', tick: 1 });
      bp.blocks.push({
        x: origin.x,
        y: origin.y,
        z: origin.z,
        material: 'diamond_block',
        role: 'floor',
      });
      const project = await runProject({
        harness,
        origin,
        blueprint: bp,
        skipSiteSelection: true,
        dryRun: false,
        memoryPath: mem,
        persistMemory: false,
        supportAt: async () => true,
      });
      if (project.status !== 'PROJECT_ABORTED')
        throw new Error(`expected abort got ${project.status}`);
      return { reason: project.reason };
    })
  );

  await harness.close().catch(() => {});
  const summary = {
    at: new Date().toISOString(),
    pass: results.filter((r) => r.status === 'PASS').length,
    fail: results.filter((r) => r.status === 'FAIL').length,
    results,
  };
  fs.writeFileSync(OUT, JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
  process.exit(summary.fail ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
