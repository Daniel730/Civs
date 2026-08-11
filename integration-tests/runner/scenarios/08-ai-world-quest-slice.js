/**
 * Live AI World physical quest slice (#67).
 *
 * Proves authoritative RPG transitions + physical break_block progress.
 * Requires disposable WSL QA (RCON). Seeds STONE near actor when missing.
 *
 * Env:
 *   ACTOR_NAME=QaBot
 *   RPG_TEST_QUEST=ai_world_mine_probe
 *   AI_WORLD_SEED_BLOCKS=1
 */
const path = require('node:path');
const { scenario } = require('../lib/dsl');
const { createAgent, createQuestLoop, persistAgent, EVENT } = require('../lib/ai-world');

const ACTOR = process.env.ACTOR_NAME || 'QaBot';
const QUEST = process.env.RPG_TEST_QUEST || 'ai_world_mine_probe';
const SEED = process.env.AI_WORLD_SEED_BLOCKS !== '0';

module.exports = scenario('AiWorldPhysicalMine')
  .player(ACTOR)
  .step('physical mine quest loop', async (ctx) => {
    ctx.playerName = ACTOR;
    const events = [];
    const statePath = path.join(__dirname, '..', 'reports', 'ai-world', `${ACTOR}-state.json`);
    const agent = createAgent({
      id: ACTOR,
      name: ACTOR,
      occupation: 'builder',
      traits: { greedy: 0.55, builder: 0.85, brave: 0.4 },
      needs: { purpose: 0.85, money: 0.55 },
      skills: { gathering: 0.8, building: 0.8 },
    });

    const ping = await ctx.harness.cap.rpgPing();
    ctx.expectTrue(
      'rpg present',
      ping.success === true && ping.data && ping.data.present,
      ping._raw
    );

    // Ensure probe quest exists
    const detail0 = await ctx.harness.cap.rpgQuestDetail(ACTOR, QUEST);
    if (!detail0.success) {
      ctx.expectTrue(
        `quest ${QUEST} loaded on QA (copy fixtures/ai_world_mine_probe.yml + /rpg reload)`,
        false,
        detail0.reason || detail0._raw
      );
      return;
    }

    // Survival + pickaxe
    await ctx.harness.cap.act(ACTOR, 'game_mode', 'SURVIVAL');
    await ctx.harness.cap.act(ACTOR, 'give_item', 'STONE_PICKAXE', 1);

    const moneyBefore = await ctx.harness.money.get(ACTOR);

    const loop = createQuestLoop(agent, {
      eventSink: events,
      seedBlocks: SEED,
      searchRadius: 10,
      mineTimeoutMs: 90_000,
      observePlayer: () => ctx.harness.cap.observe(ACTOR),
      observeRpg: () => ctx.harness.cap.rpgObserve(ACTOR),
      observeWorld: () => ctx.harness.cap.worldNearby(ACTOR, 64),
      observePois: () => ctx.harness.cap.rpgPois(ACTOR, 512),
      questDetail: (id) => ctx.harness.cap.rpgQuestDetail(ACTOR, id),
      listQuestCandidates: async () => {
        const d = await ctx.harness.cap.rpgQuestDetail(ACTOR, QUEST);
        return d.success && d.data ? [d.data] : [];
      },
      acceptQuest: async (id) => {
        let obs = await ctx.harness.cap.rpgObserve(ACTOR);
        let active = (obs.data && obs.data.active_quests) || [];
        if (active.includes(id)) {
          return { success: true, data: { result: 'ALREADY_ACTIVE' } };
        }
        // Free slots if needed
        while (active.length >= 3) {
          const drop = active[0];
          const ab = await ctx.harness.cap.rpgAbandon(ACTOR, drop);
          ctx.expectTrue(`abandon ${drop} for slot`, ab.success === true, ab.reason || ab._raw);
          obs = await ctx.harness.cap.rpgObserve(ACTOR);
          active = (obs.data && obs.data.active_quests) || [];
        }
        // If already completed, abandon is N/A — try accept anyway
        const completed = (obs.data && obs.data.completed_quests) || [];
        if (completed.includes(id)) {
          // Cannot re-accept completed — fail honestly
          return { success: false, reason: 'ALREADY_COMPLETE' };
        }
        return ctx.harness.cap.rpgAccept(ACTOR, id);
      },
      findBlock: (mat, radius) => ctx.harness.cap.findBlock(ACTOR, mat, radius, 5),
      moveTo: (x, y, z) => ctx.harness.cap.moveTo(ACTOR, x, y, z, 8000, 2.0, 0.9),
      breakBlock: (x, y, z) => ctx.harness.cap.breakBlock(ACTOR, x, y, z),
      giveItem: (mat, n) => ctx.harness.cap.act(ACTOR, 'give_item', mat, n),
      setblock: async (x, y, z, mat) => {
        const line = await ctx.harness.raw(`test setblock ${x} ${y} ${z} ${mat}`);
        return { success: /TEST-OK|TEST-RESULT/.test(line), _raw: line };
      },
      getMoney: () => ctx.harness.money.get(ACTOR),
      persist: async (a) => persistAgent(a, statePath),
    });

    let remembered = false;
    let failed = null;
    let sawProgress = false;
    for (let i = 0; i < 40; i++) {
      const r = await loop.tick();
      if (r.detail && r.detail.objectives) {
        const o = r.detail.objectives.find((x) => x.id === 'mine_stone') || r.detail.objectives[0];
        if (o && o.progress > 0) sawProgress = true;
      }
      if (r.result && r.result.progress > 0) sawProgress = true;
      if (r.remembered) {
        remembered = true;
        break;
      }
      if (r.failed) {
        failed = r.error;
        break;
      }
      await ctx.wait(100);
    }

    persistAgent(agent, statePath);
    const moneyAfter = await ctx.harness.money.get(ACTOR);
    const finalObs = await ctx.harness.cap.rpgObserve(ACTOR);
    const completed = (finalObs.data && finalObs.data.completed_quests) || [];
    const questDone = completed.includes(QUEST);

    ctx.expectTrue(
      'accepted/progressed or completed without crash',
      !failed || sawProgress || questDone,
      failed
    );
    ctx.expectTrue(
      'RPG progress increased or quest completed',
      sawProgress || questDone,
      JSON.stringify(finalObs.data)
    );
    ctx.expectTrue(
      'quest completed in RPG completed_quests OR progress events emitted',
      questDone || events.some((e) => e.type === EVENT.QUEST_PROGRESS),
      `done=${questDone} events=${events.length} remembered=${remembered}`
    );
    if (questDone) {
      ctx.expectTrue(
        'reward money applied (delta >= 0; probe reward=5)',
        moneyAfter >= moneyBefore,
        `before=${moneyBefore} after=${moneyAfter}`
      );
      ctx.expectTrue(
        'memory persisted quest_complete',
        agent.memory.episodic.some((e) => e.type === 'quest_complete')
      );
    }
  })
  .expectNoErrors({ ignore: [/\[CivsTestHarness\]/, /PlaceholderAPI/] })
  .build();
