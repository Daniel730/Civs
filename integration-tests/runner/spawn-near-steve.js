const { Rcon } = require('rcon-client');
(async () => {
  const c = new Rcon({ host: '127.0.0.1', port: 25576, password: 'civsqa' });
  await c.connect();
  // Teleport the most recent zombie to Steve's location
  const list = await c.send('list');
  // Parse list to find a zombie entity id; simpler: summon zombie at Steve's coords
  const r = await c.send('execute as Steve run summon zombie ~ ~ ~');
  console.log('SPAWN_NEAR_STEVE', r);
  await c.end();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });