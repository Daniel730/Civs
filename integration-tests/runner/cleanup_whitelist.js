// LIMPEZA DE EMERGÊNCIA — remove NPCs da whitelist do servidor via RCON
const { Rcon } = require('rcon-client');

const RCON_HOST = process.env.RCON_HOST || '100.115.208.23';
const RCON_PORT = parseInt(process.env.RCON_PORT || '25575', 10);
const RCON_PASS = process.env.RCON_PASS || '29b775df63c16099c04db20b';

async function main() {
  const rcon = new Rcon({ host: RCON_HOST, port: RCON_PORT, password: RCON_PASS });
  await rcon.connect();
  console.log('RCON_CONNECTED');

  // Remove NPCs da whitelist e deop
  for (const name of ['Steve', 'Alex', 'Cam']) {
    for (const cmd of [`whitelist remove ${name}`, `deop ${name}`]) {
      try {
        const resp = await rcon.send(cmd);
        console.log(`${cmd}: ${resp.trim()}`);
      } catch (e) {
        console.log(`${cmd}: ERR ${e.message}`);
      }
    }
  }

  // Verifica whitelist
  const wl = await rcon.send('whitelist list');
  console.log(`WHITELIST_LIST: ${wl.trim()}`);

  // Jogadores online
  const online = await rcon.send('list');
  console.log(`ONLINE: ${online.trim()}`);

  await rcon.end();
}
main().catch((e) => { console.error('FATAL', e.message); process.exit(1); });