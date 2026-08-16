const { Rcon } = require('rcon-client');
(async () => {
  const c = new Rcon({ host: '127.0.0.1', port: 25576, password: 'civsqa' });
  await c.connect();
  // Give Steve a diamond sword
  await c.send('give Steve diamond_sword 1');
  // Summon zombie 3 blocks east of Steve
  await c.send('execute positioned as Steve run summon zombie 3 0 0');
  console.log('EQUIP_AND_SPAWN_DONE');
  await c.end();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });