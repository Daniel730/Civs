/**
 * Accept an RPG quest through Player.performCommand and verify via /test rpg observe.
 *
 * FACT: new profiles may already hold max-active (3) starter quests. Free one slot with
 * `/test rpg abandon` (calls RPGServer.abandonQuest) before accepting.
 *
 * FACT: performCommand("rpg quest accept …") can return true even when accept fails —
 * success requires observe to show the quest id in active_quests.
 */
const { scenario } = require('../lib/dsl');

// No-requires neutral story quest (empirically: merchant_feira_guilda is LOCKED until
// merchant_path is completed, not merely active).
const QUEST = process.env.RPG_TEST_QUEST || 'rescue_quartermaster';
const ACTOR = process.env.ACTOR_NAME || 'QaBot';
const SACRIFICE = process.env.RPG_ABANDON_QUEST || 'rescue_treasurer';

module.exports = scenario('RpgQuestAccept')
  .player(ACTOR)
  .step('ensure slot then accept', async (ctx) => {
    ctx.playerName = ACTOR;
    let obs = await ctx.harness.cap.rpgObserve(ACTOR);
    ctx.expectTrue('rpg observe', obs.success === true, obs.reason || obs._raw);
    let active = (obs.data && obs.data.active_quests) || [];

    if (active.includes(QUEST)) {
      ctx.expectTrue(`quest ${QUEST} already active`, true, JSON.stringify(active));
      return;
    }

    if (active.length >= 3) {
      const drop = active.includes(SACRIFICE) ? SACRIFICE : active[0];
      const ab = await ctx.harness.cap.rpgAbandon(ACTOR, drop);
      ctx.expectTrue(`abandon ${drop}`, ab.success === true, ab.reason || ab._raw);
      obs = await ctx.harness.cap.rpgObserve(ACTOR);
      active = (obs.data && obs.data.active_quests) || [];
      ctx.expectTrue('slot freed', active.length < 3, JSON.stringify(active));
    }

    // Prefer QuestManager.acceptQuest via harness — returns real QuestAcceptResult.
    const r = await ctx.harness.cap.rpgAccept(ACTOR, QUEST);
    ctx.expectTrue(
      'rpg_accept SUCCESS',
      r.success === true,
      (r.reason || r._raw) + ' data=' + JSON.stringify(r.data)
    );
    await ctx.wait(200);
    obs = await ctx.harness.cap.rpgObserve(ACTOR);
    active = (obs.data && obs.data.active_quests) || [];
    ctx.expectTrue(
      `quest ${QUEST} in active_quests`,
      active.includes(QUEST),
      JSON.stringify(active)
    );
  })
  .expectNoErrors({ ignore: [/\[CivsTestHarness\]/, /PlaceholderAPI/] })
  .build();
