'use strict';
/**
 * Death → respawn → disconnect → reconnect, with RPG profile still observable.
 * Creative mode is switched to survival for the kill (Paper will not kill creatives).
 */
const { scenario } = require('../lib/dsl');

const PAD = { x: 740, y: -60, z: 740 };

module.exports = scenario('DeathRespawnReconnect')
  .player('Steve')
  .teleport(PAD.x, PAD.y, PAD.z)
  .step('survival + die + respawn', async (ctx) => {
    let r = await ctx.harness.cap.gameMode(ctx.playerName, 'SURVIVAL');
    ctx.expectTrue('game_mode survival', r.success === true, r.reason || r._raw);
    r = await ctx.harness.cap.die(ctx.playerName);
    ctx.expectTrue('die', r.success === true, r.reason || r._raw);
    await ctx.wait(250);
    r = await ctx.harness.cap.respawn(ctx.playerName);
    ctx.expectTrue('respawn', r.success === true, r.reason || r._raw);
    const obs = await ctx.harness.cap.observe(ctx.playerName);
    ctx.expectTrue('alive after respawn', obs.success && obs.data && obs.data.health > 0, JSON.stringify(obs.data));
  })
  .step('rpg profile survives death', async (ctx) => {
    const r = await ctx.harness.cap.rpgObserve(ctx.playerName);
    ctx.expectTrue('rpg observe after death', r.success === true, r.reason || r._raw);
    ctx.expectTrue('archetype still set', r.data && r.data.archetype != null, JSON.stringify(r.data));
  })
  .step('disconnect + reconnect actor', async (ctx) => {
    const name = ctx.playerName;
    await ctx.actor.disconnect();
    await ctx.wait(800);
    const offline = await ctx.harness.cap.observe(name);
    ctx.expectTrue('offline after disconnect', offline.success === false && offline.reason === 'player_offline', offline._raw);
    await ctx.actor.reconnect(200);
    ctx.expectTrue('reconnected', ctx.actor.available === true, ctx.actor.reason || 'no login');
    if (ctx.actor.available) await ctx.actor.grantOp();
    await ctx.wait(500);
    const obs = await ctx.harness.cap.observe(name);
    ctx.expectTrue('online after reconnect', obs.success === true, obs.reason || obs._raw);
    const rpg = await ctx.harness.cap.rpgObserve(name);
    ctx.expectTrue('rpg after reconnect', rpg.success === true, rpg.reason || rpg._raw);
  })
  .step('restore creative', async (ctx) => {
    const r = await ctx.harness.cap.gameMode(ctx.playerName, 'CREATIVE');
    ctx.expectTrue('restore creative', r.success === true, r.reason || r._raw);
  })
  .expectNoErrors({ ignore: [/\[CivsTestHarness\]/, /lost connection/, /left the game/, /joined the game/] })
  .build();
