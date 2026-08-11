/**
 * Observes RPGServer profile state via harness reflection bridge (/test rpg observe).
 * Does not invent RPG APIs — fails explicitly if RPGServer is absent.
 */
const { scenario } = require('../lib/dsl');

module.exports = scenario('RpgObserve')
  .player('Steve')
  .step('rpg ping', async (ctx) => {
    const r = await ctx.harness.cap.rpgPing();
    ctx.expectTrue('rpg ping success', r.success === true, r.reason || r._raw);
    ctx.expectTrue('rpg present', r.data && r.data.present === true, JSON.stringify(r.data));
  })
  .step('rpg observe profile', async (ctx) => {
    const r = await ctx.harness.cap.rpgObserve(ctx.playerName);
    ctx.expectTrue('rpg observe success', r.success === true, r.reason || r._raw);
    ctx.expectTrue(
      'has active_quests array',
      r.data && Array.isArray(r.data.active_quests),
      JSON.stringify(r.data)
    );
    ctx.expectTrue(
      'has completed_quests array',
      r.data && Array.isArray(r.data.completed_quests),
      JSON.stringify(r.data)
    );
    ctx.expectTrue(
      'rebirth_count number',
      r.data && typeof r.data.rebirth_count === 'number',
      JSON.stringify(r.data)
    );
  })
  .step('run_as rpg profile (allowlisted performCommand)', async (ctx) => {
    const r = await ctx.harness.cap.runAs(ctx.playerName, 'rpg profile');
    ctx.expectTrue('run_as rpg profile', r.success === true, r.reason || r._raw);
  })
  .expectNoErrors({ ignore: [/\[CivsTestHarness\]/, /PlaceholderAPI/] })
  .build();
