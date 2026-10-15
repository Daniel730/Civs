// Adiciona Steve, Alex e Cam à whitelist via RCON e testa login direto
const { Rcon } = require('rcon-client');
const mc = require('minecraft-protocol');

const RCON_HOST = process.env.RCON_HOST || '100.115.208.23';
const RCON_PORT = parseInt(process.env.RCON_PORT || '25575', 10);
const RCON_PASS = process.env.RCON_PASS || '29b775df63c16099c04db20b';
const MC_HOST = process.env.MC_HOST || RCON_HOST;
const MC_PORT = parseInt(process.env.MC_PORT || '25565', 10);
const VERSION = process.env.MC_SERVER_MAJOR || '26.1.2';

async function main() {
  // 1. Whitelist via RCON
  const rcon = new Rcon({ host: RCON_HOST, port: RCON_PORT, password: RCON_PASS });
  await rcon.connect();
  console.log('RCON_CONNECTED');

  for (const name of ['Steve', 'Alex', 'Cam', 'steve', 'alex', 'cam']) {
    try {
      const resp = await rcon.send(`whitelist add ${name}`);
      console.log(`WHITELIST_ADD(${name}): ${resp.trim()}`);
    } catch (e) {
      console.log(`WHITELIST_ADD_ERR(${name}): ${e.message}`);
    }
  }
  await rcon.end();

  // 2. Teste de login direto (protocolo)
  const results = {};
  for (const name of ['Steve', 'Alex', 'Cam']) {
    results[name] = await new Promise((resolve) => {
      const start = Date.now();
      try {
        const c = mc.createClient({
          host: MC_HOST,
          port: MC_PORT,
          username: name,
          version: VERSION,
          auth: 'offline',
        });
        const done = (status, msg) => {
          try { c.end(); } catch (_) {}
          resolve({ status, msg, ms: Date.now() - start });
        };
        c.on('login', () => done('LOGIN_OK', 'logged in'));
        c.on('error', (e) => done('LOGIN_ERR', e.message));
        setTimeout(() => done('TIMEOUT_20S', 'no login event'), 20000);
      } catch (e) {
        resolve({ status: 'CREATE_ERR', msg: e.message, ms: Date.now() - start });
      }
    });
    console.log(`LOGIN_TEST(${name}): ${JSON.stringify(results[name])}`);
  }
}
main().catch((e) => { console.error('FATAL', e.message); process.exit(1); });