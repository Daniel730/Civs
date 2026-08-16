#!/usr/bin/env node
// Throwaway probe: print Steve's full observe payload so we learn the `held` item shape.
const { Harness } = require('../lib/harness');
const { Capabilities } = require('../lib/capabilities');

async function main() {
  const h = new Harness({ host: process.env.RCON_HOST || '192.168.152.149', port: Number(process.env.RCON_PORT || '25576'), password: 'civsqa' });
  await h.connect();
  const cap = new Capabilities(h);
  const who = process.argv[2] || 'Steve';
  const o = await cap.observe(who);
  console.log('OBSERVE RAW:', JSON.stringify(o, null, 2));
  // Also grab raw held + inventory dumps for shape reference.
  try {
    const held = await h.held(who);
    console.log('HELD KV:', JSON.stringify(held));
  } catch (e) { console.log('held failed', e.message); }
  await h.close();
}
main().catch((e) => { console.error('fatal', e); process.exit(1); });
