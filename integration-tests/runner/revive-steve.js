const { Rcon } = require('rcon-client');
(async () => {
  const c = new Rcon({ host: '127.0.0.1', port: 25576, password: 'civsqa' });
  await c.connect();
  // Respawn Steve
  await c.send('effect give Steve instant_health 1 255 true');
  await c.send('effect give Steve resistance 1 255 10 true');
  await c.send('effect give Steve saturation 1 255 true');
  // Ensure sword in inventory and hotbar
  await c.send('give Steve diamond_sword 1');
  await c.send('hotbar Steve 0');
  console.log('REVIVED_STEVE');
  await c.end();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });