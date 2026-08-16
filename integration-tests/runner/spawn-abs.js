const { Rcon } = require('rcon-client');
(async () => {
  const c = new Rcon({ host: '127.0.0.1', port: 25576, password: 'civsqa' });
  await c.connect();
  // Summon zombie at Steve's exact coords (5199, 81, 5200) — 3 blocks east via absolute coords
  const r1 = await c.send('summon zombie 5203 81 5200');
  console.log('SUM_ABS', r1);
  // Also summon one right on top of Steve
  const r2 = await c.send('summon zombie 5199 82 5200');
  console.log('SUM_ON', r2);
  await c.end();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });