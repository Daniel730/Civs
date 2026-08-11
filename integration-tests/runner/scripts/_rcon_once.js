const { Rcon } = require('rcon-client');
(async () => {
  const host = process.env.H || '192.168.152.149';
  const port = Number(process.env.P || 25575);
  const password = process.env.PW || 'civsqa';
  const r = await Rcon.connect({ host, port, password });
  for (const cmd of process.env.CMD.split('||')) {
    const out = await r.send(cmd);
    console.log(cmd, '=>', out);
  }
  await r.end();
})().catch((e) => { console.error(e); process.exit(1); });
