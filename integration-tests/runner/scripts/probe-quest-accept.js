'use strict';
const { Harness } = require('../lib/harness');
const { RawKeepAliveActor } = require('../lib/actor');

(async () => {
  const h = new Harness({
    host: process.env.RCON_HOST || '127.0.0.1',
    port: parseInt(process.env.RCON_PORT || '25575', 10),
    password: process.env.RCON_PASSWORD || 'civsqa',
  });
  await h.connect();
  const actor = new RawKeepAliveActor({
    host: process.env.MC_HOST || '127.0.0.1',
    port: parseInt(process.env.MC_PORT || '25565', 10),
    username: 'Steve',
    version: '26.1.2',
    sendCommand: (c) => h.raw(c),
  });
  await actor.connect();
  if (!actor.available) throw new Error('actor unavailable: ' + actor.reason);
  await actor.grantOp();
  const before = await h.cap.rpgObserve('Steve');
  console.log('BEFORE', JSON.stringify(before.data));
  const candidates = [
    'first_steps', 'daily_farm', 'daily_miner', 'daily_scout',
    'daily_boar_hunt', 'explorer_vila_conselho', 'builder_path',
  ];
  for (const id of candidates) {
    if ((before.data.active_quests || []).includes(id)) {
      console.log('SKIP already active', id);
      continue;
    }
    const r = await h.cap.runAs('Steve', 'rpg quest accept ' + id);
    const after = await h.cap.rpgObserve('Steve');
    const active = (after.data && after.data.active_quests) || [];
    console.log('ACCEPT', id, 'runAs=', r.success, 'activeHas=', active.includes(id), 'reason=', r.reason);
    console.log('ACTIVE', JSON.stringify(active));
    if (active.includes(id)) {
      console.log('SUCCESS_QUEST', id);
      break;
    }
  }
  await actor.disconnect();
  await h.close();
})().catch((e) => { console.error(e); process.exit(1); });
