// Verificar jogadores online e posição no QA local
const { Rcon } = require('rcon-client');

const HOST = '127.0.0.1';
const PORT = 25576;
const PASS = 'civsqa';

async function main() {
  const c = new Rcon({ host: HOST, port: PORT, password: PASS });
  await c.connect();
  console.log('RCON_CONNECTED');

  // Listar jogadores online
  try {
    const list = await c.send('list');
    console.log('LIST:', list.trim());
  } catch (e) { console.log('LIST_ERR:', e.message); }

  // Posição do Steve
  for (const name of ['Steve', 'Alex', 'Cam', 'Smokeshow']) {
    try {
      const pos = await c.send(`data get entity ${name} Pos`);
      console.log(`POS(${name}):`, pos.trim());
    } catch (e) { console.log(`POS_ERR(${name}):`, e.message); }
  }

  await c.end();
}
main().catch((e) => { console.error('FATAL', e.message); process.exit(1); });