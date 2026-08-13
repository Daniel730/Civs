#!/usr/bin/env node
// probe-steve.js — direct server truth about Steve: where he is, what he holds, mobs nearby.
// Run: node scripts/probe-steve.js
const { Harness } = require('../lib/harness');
const { Capabilities } = require('../lib/capabilities');

async function main() {
  const h = new Harness({ host: '127.0.0.1', port: 25575, password: 'civsqa' });
  await h.connect();
  const cap = new Capabilities(h);
  for (const who of ['Steve', 'Alex']) {
    try {
      const o = await cap.observe(who);
      const d = o && o.data ? o.data : {};
      console.log(`\n=== ${who} ===`);
      console.log('  pos:', d.x, d.y, d.z, '| health:', d.health, '| held:', d.held);
      console.log('  biome/light:', d.light_level, '| blockBelow:', d.block_below);
      console.log('  hostile:', JSON.stringify(d.nearest_hostile || d.hostiles));
    } catch (e) {
      console.log(`${who}: observe failed:`, e.message);
    }
  }
  await h.close();
}
main().catch((e) => { console.error('fatal', e); process.exit(1); });
