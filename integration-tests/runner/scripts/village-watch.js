#!/usr/bin/env node
/**
 * Overnight keep-alive: hold Steve + Cam online for cinematic watching.
 * Re-asserts town, refreshes spectate, optional orbit for motion.
 */
const { Harness } = require('../lib/harness');
const { RawKeepAliveActor } = require('../lib/actor');
const { SpectatorCamera } = require('../lib/camera');

const cfg = {
  rconHost: process.env.RCON_HOST || '127.0.0.1',
  rconPort: Number.parseInt(process.env.RCON_PORT || '25575', 10),
  rconPassword: process.env.RCON_PASSWORD || 'civsqa',
  mcHost: process.env.MC_HOST || '127.0.0.1',
  mcPort: Number.parseInt(process.env.MC_PORT || '25565', 10),
  actorName: process.env.ACTOR_NAME || 'Steve',
  cameraName: process.env.CAMERA_NAME || 'Cam',
  version: process.env.MC_SERVER_MAJOR || '26.1.2',
  town: process.env.VILLAGE_TOWN || 'NpcPad',
  ox: Number.parseInt(process.env.VILLAGE_X || '5200', 10),
  oy: Number.parseInt(process.env.VILLAGE_Y || '80', 10),
  oz: Number.parseInt(process.env.VILLAGE_Z || '5200', 10),
  intervalMs: Number.parseInt(process.env.WATCH_MS || '5000', 10),
};

async function main() {
  const harness = new Harness({
    host: cfg.rconHost,
    port: cfg.rconPort,
    password: cfg.rconPassword,
  });
  await harness.connect();
  const ping = await harness.ping();
  console.log(JSON.stringify({ status: 'PASS', action: 'ping', ping }));

  const actor = new RawKeepAliveActor({
    host: cfg.mcHost,
    port: cfg.mcPort,
    username: cfg.actorName,
    version: cfg.version,
    sendCommand: (c) => harness.raw(c),
  });
  await actor.connect();
  if (!actor.available) throw new Error(actor.reason || 'actor_offline');
  await actor.grantOp();
  await actor.teleport(cfg.ox, cfg.oy + 2, cfg.oz);

  const camera = new SpectatorCamera({
    harness,
    host: cfg.mcHost,
    port: cfg.mcPort,
    name: cfg.cameraName,
    version: cfg.version,
    targetName: cfg.actorName,
  });
  console.log(JSON.stringify(await camera.start()));
  process.env.FORCE_ORBIT = process.env.FORCE_ORBIT || '1';
  camera.startLoop(async () => ({ x: cfg.ox, y: cfg.oy, z: cfg.oz }), cfg.intervalMs);

  let tick = 0;
  setInterval(async () => {
    tick += 1;
    try {
      const town = await harness.assert.town(cfg.town);
      const obs = await harness.cap.observe(cfg.actorName);
      if (tick % 6 === 0) {
        // Slow walk around pad for visible motion
        const a = (tick / 6) * 0.7;
        const x = cfg.ox + Math.cos(a) * 8;
        const z = cfg.oz + Math.sin(a) * 8;
        await actor.teleport(x, cfg.oy + 2, z);
      }
      console.log(
        JSON.stringify({
          ts: new Date().toISOString(),
          status: 'OBSERVED',
          tick,
          town,
          player: obs && obs.data ? { x: obs.data.x, y: obs.data.y, z: obs.data.z } : null,
          watch: 'Join Viewer → /spectate Cam or look at 5200,80,5200',
        })
      );
    } catch (e) {
      console.error(JSON.stringify({ status: 'FAIL', reason: String(e.message || e) }));
    }
  }, cfg.intervalMs);

  process.on('SIGINT', async () => {
    camera.stopLoop();
    await camera.stop();
    await actor.disconnect();
    await harness.close();
    process.exit(0);
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
