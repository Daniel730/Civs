const { Rcon } = require('rcon-client');
(async () => {
  const c = new Rcon({ host: '127.0.0.1', port: 25576, password: 'civsqa' });
  await c.connect();
  // Summon zombie exactly at Steve's feet (5199,81,5200)
  await c.send('summon zombie 5199 81 5200');
  await c.send('summon zombie 5198 81 5200');
  await c.send('summon zombie 5200 81 5200');
  console.log('SUMMONED_3_AT_STEVE');
  await c.end();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });