// Verificar altura do terreno em (5200,5200) no QA
const { Rcon } = require('rcon-client');

const HOST = '127.0.0.1';
const PORT = 25576;
const PASS = 'civsqa';

async function main() {
  const c = new Rcon({ host: HOST, port: PORT, password: PASS });
  await c.connect();
  console.log('RCON_CONNECTED');

  // Verificar bloco em y=80, 70, 60
  for (const y of [80, 70, 60, 50]) {
    try {
      const block = await c.send(`execute if block 5200 ${y} 5200 air run say Y_${y}`);
      console.log(`Y=${y}: ${block.trim()}`);
    } catch (e) {
      console.log(`Y=${y}: ERR ${e.message}`);
    }
  }

  await c.end();
}
main().catch((e) => { console.error('FATAL', e.message); process.exit(1); });