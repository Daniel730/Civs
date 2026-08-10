'use strict';
/**
 * Empirically validates server-side player capabilities on Paper 26.1.2.
 * Requires an online actor (RawKeepAliveActor) — actions run via /test act as that player.
 */
const { scenario } = require('../lib/dsl');

const PAD = { x: 720, y: -60, z: 720 };

module.exports = scenario('PlayerCapabilities')
  .player('Steve')
  .teleport(PAD.x, PAD.y, PAD.z)
  .step('observe baseline', async (ctx) => {
    const obs = await ctx.harness.cap.observe(ctx.playerName);
    ctx.expectTrue('observe success', obs.success === true, obs.reason || obs._raw);
    ctx.expectTrue('observe has coords', obs.data && typeof obs.data.x === 'number', JSON.stringify(obs.data));
  })
  .step('sneak on/off', async (ctx) => {
    let r = await ctx.harness.cap.sneak(ctx.playerName, true);
    ctx.expectTrue('sneak on', r.success === true, r.reason || r._raw);
    let obs = await ctx.harness.cap.observe(ctx.playerName);
    ctx.expectTrue('sneaking true', obs.data && obs.data.sneaking === true, JSON.stringify(obs.data));
    r = await ctx.harness.cap.sneak(ctx.playerName, false);
    ctx.expectTrue('sneak off', r.success === true, r.reason || r._raw);
  })
  .step('look + jump', async (ctx) => {
    let r = await ctx.harness.cap.look(ctx.playerName, 90, -15);
    ctx.expectTrue('look', r.success === true, r.reason || r._raw);
    r = await ctx.harness.cap.jump(ctx.playerName);
    ctx.expectTrue('jump', r.success === true, r.reason || r._raw);
  })
  .arrangeBlock(PAD.x + 1, PAD.y, PAD.z, 'STONE')
  .step('break_block via Player.breakBlock', async (ctx) => {
    const r = await ctx.harness.cap.breakBlock(ctx.playerName, PAD.x + 1, PAD.y, PAD.z);
    ctx.expectTrue('break_block success', r.success === true, r.reason || r._raw);
  })
  .expectBlock(PAD.x + 1, PAD.y, PAD.z, 'AIR')
  .step('place_block via BlockPlaceEvent', async (ctx) => {
    const r = await ctx.harness.cap.placeBlock(ctx.playerName, PAD.x + 2, PAD.y, PAD.z, 'OAK_PLANKS');
    ctx.expectTrue('place_block success', r.success === true, r.reason || r._raw);
  })
  .expectBlock(PAD.x + 2, PAD.y, PAD.z, 'OAK_PLANKS')
  .step('spawn + attack nearest zombie', async (ctx) => {
    const spawned = await ctx.harness.spawnEntity('ZOMBIE', PAD.x + 3, PAD.y, PAD.z);
    ctx.expectTrue('spawned zombie', !!spawned.uuid, spawned._raw);
    const r = await ctx.harness.cap.attackNearest(ctx.playerName, 'ZOMBIE');
    ctx.expectTrue('attack nearest', r.success === true, r.reason || r._raw);
    // cleanup entity if still alive
    if (spawned.uuid) await ctx.harness.raw(`kill ${spawned.uuid}`);
  })
  .expectNoErrors({ ignore: [/\[CivsTestHarness\]/] })
  .resetBlock(PAD.x + 1, PAD.y, PAD.z)
  .resetBlock(PAD.x + 2, PAD.y, PAD.z)
  .build();
