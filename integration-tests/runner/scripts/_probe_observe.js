// TEMP probe: discover real `test observe` + `test act break_block` output shapes on QA server.
const { Harness } = require('../lib/harness');

(async () => {
  const h = new Harness({ host: '127.0.0.1', port: 25576, password: 'civsqa', timeout: 20000 });
  await h.connect();
  console.log('=== PING ===');
  console.log(JSON.stringify(await h.cap.observe('Steve').catch(e => ({ err: String(e) }))));
  // Get Steve's position
  const obs = await h.cap.observe('Steve');
  console.log('=== OBSERVE RAW ===');
  console.log(obs && obs._raw ? obs._raw : JSON.stringify(obs));
  let d = (obs && obs.data) || {};
  console.log('=== OBSERVE data keys ===', Object.keys(d));
  console.log('pos', d.x, d.y, d.z, 'world', d.world);
  // pick a block to break: the block just above the one under feet
  const bx = Math.floor(d.x), by = Math.floor(d.y) - 1, bz = Math.floor(d.z);
  console.log('target block x,y,z =', bx, by, bz);
  const block = await h.cap.findBlock ? null : null;
  const before = await h.cap.observe('Steve');
  const broke = await h.cap.breakBlock('Steve', bx, by, bz);
  console.log('=== BREAK RAW ===');
  console.log(broke && broke._raw ? broke._raw : JSON.stringify(broke));
  await new Promise(r => setTimeout(r, 1500)); // allow pickup
  const after = await h.cap.observe('Steve');
  console.log('=== AFTER OBSERVE RAW ===');
  console.log(after && after._raw ? after._raw : JSON.stringify(after));
  await h.close();
  process.exit(0);
})().catch(e => { console.error('FAIL', e); process.exit(1); });
