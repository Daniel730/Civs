const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  createAgent,
  saveAgent,
  loadAgent,
  AUTONOMY,
  evaluateQuest,
  selectQuest,
  planObjective,
  planQuest,
  decide,
  createQuestLoop,
  rememberEpisode,
  rememberPerson,
  recentFailures,
  tryRetry,
  notePosition,
  createGuard,
  buildObservation,
  applyPersonality,
  createPersonality,
  executeMineObjective,
  toPersistentSnapshot,
} = require('@daniel730/aiworld');

describe('ai-world agent state', () => {
  it('creates persistent agent with personality that affects scores', () => {
    const brave = createAgent({
      name: 'BraveBot',
      occupation: 'adventurer',
      traits: { brave: 0.95, cautious: 0.1, greedy: 0.2 },
    });
    const coward = createAgent({
      name: 'CowardBot',
      occupation: 'scholar',
      traits: { brave: 0.1, cautious: 0.95, greedy: 0.2 },
    });
    assert.equal(brave.autonomyLevel, AUTONOMY.GOAL_DIRECTED);
    const b = applyPersonality(brave.identity.personality, 'combat', 1);
    const c = applyPersonality(coward.identity.personality, 'combat', 1);
    assert.ok(b > c, `brave combat ${b} should exceed coward ${c}`);
  });

  it('round-trips save/load including guard Set', () => {
    const agent = createAgent({ name: 'Persist', occupation: 'builder' });
    agent.guard.invalidatedPlans.add('plan-1');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-world-'));
    const file = path.join(dir, 'agent.json');
    saveAgent(agent, file);
    const loaded = loadAgent(file);
    assert.equal(loaded.identity.name, 'Persist');
    assert.ok(loaded.guard.invalidatedPlans instanceof Set);
    assert.ok(loaded.guard.invalidatedPlans.has('plan-1'));
  });
});

describe('ai-world quest evaluation', () => {
  it('builder prefers mine_block reward quests over combat', () => {
    const builder = createAgent({
      occupation: 'builder',
      traits: { builder: 0.9, brave: 0.3, greedy: 0.6 },
      skills: { gathering: 0.8, combat: 0.2, building: 0.9 },
      needs: { money: 0.7, purpose: 0.6 },
    });
    const gather = {
      id: 'daily_quarry',
      archetype: 'builder',
      objectives: [{ typeId: 'mine_block', block: 'stone', amount: 64 }],
      rewards: { money: 40 },
      status: 'NOT_STARTED',
    };
    const combat = {
      id: 'weekly_warrior',
      archetype: 'warrior',
      objectives: [{ typeId: 'kill_mob', mob: 'zombie', amount: 20 }],
      rewards: { money: 50 },
      status: 'NOT_STARTED',
    };
    const eg = evaluateQuest(builder, gather);
    const ec = evaluateQuest(builder, combat);
    assert.ok(eg.accept, eg.reasons);
    assert.ok(eg.score > ec.score, `gather ${eg.score} vs combat ${ec.score}`);
  });

  it('rejects after repeated failure memory', () => {
    const agent = createAgent({ occupation: 'explorer' });
    rememberEpisode(agent.memory, {
      type: 'quest_failed',
      summary: 'fail 1',
      importance: 0.7,
      tags: ['bad_quest', 'failure'],
    });
    rememberEpisode(agent.memory, {
      type: 'quest_failed',
      summary: 'fail 2',
      importance: 0.7,
      tags: ['bad_quest', 'failure'],
    });
    assert.equal(recentFailures(agent.memory, 'quest_failed').length, 2);
    const ev = evaluateQuest(agent, {
      id: 'bad_quest',
      objectives: [{ typeId: 'mine_block', amount: 1 }],
      rewards: { money: 100 },
    });
    assert.equal(ev.accept, false);
    assert.ok(ev.reasons.includes('repeated_failure_memory'));
  });

  it('selectQuest picks highest scoring acceptable', () => {
    const merchant = createAgent({
      occupation: 'merchant',
      traits: { greedy: 0.95 },
      needs: { money: 0.9 },
    });
    const sel = selectQuest(merchant, [
      {
        id: 'low_pay',
        archetype: 'neutral',
        objectives: [{ typeId: 'mine_block', amount: 8 }],
        rewards: { money: 5 },
      },
      {
        id: 'high_pay',
        archetype: 'neutral',
        objectives: [{ typeId: 'mine_block', amount: 8 }],
        rewards: { money: 180 },
      },
    ]);
    assert.equal(sel.selected.id, 'high_pay');
  });
});

describe('ai-world objective planning', () => {
  it('plans mine_block as executable gather', () => {
    const p = planObjective({ typeId: 'mine_block', block: 'stone', amount: 64, id: 'mine_stone' });
    assert.equal(p.executable, true);
    assert.equal(p.kind, 'gather_blocks');
    assert.ok(p.steps.some((s) => s.action === 'break_block'));
  });

  it('blocks discover_poi without known coordinates', () => {
    const p = planObjective({ typeId: 'discover_poi', poi: 'abandoned_port', id: 'd1' });
    assert.equal(p.executable, false);
    assert.match(p.reason, /BLOCKED/);
  });

  it('planQuest canStart only when all objectives executable', () => {
    const ok = planQuest({
      id: 'daily_quarry',
      objectives: [{ typeId: 'mine_block', block: 'stone', amount: 16 }],
    });
    assert.equal(ok.canStart, true);
    const bad = planQuest({
      id: 'rescue',
      objectives: [
        { typeId: 'discover_poi', poi: 'abandoned_port' },
        { typeId: 'custom_mob_kill', mob: 'bandit_scout', amount: 2 },
      ],
    });
    assert.equal(bad.canStart, false);
    assert.ok(bad.blockedCount >= 1);
  });
});

describe('ai-world anti-stupidity', () => {
  it('exhausts retry budget', () => {
    const g = createGuard({ maxRetries: 2 });
    assert.equal(tryRetry(g, 'a').ok, true);
    assert.equal(tryRetry(g, 'a').ok, true);
    assert.equal(tryRetry(g, 'a').ok, false);
  });

  it('detects stuck positions', () => {
    const g = createGuard({ stuckTicks: 3, stuckDistanceEpsilon: 0.5 });
    notePosition(g, { x: 0, y: 64, z: 0 });
    notePosition(g, { x: 0.1, y: 64, z: 0 });
    const r = notePosition(g, { x: 0.1, y: 64, z: 0.1 });
    assert.equal(r.stuck, true);
  });
});

describe('ai-world decision + quest loop (deterministic)', () => {
  it('decide prefers quest when candidates score well', () => {
    const agent = createAgent({
      occupation: 'builder',
      needs: { purpose: 0.8, money: 0.7 },
      skills: { gathering: 0.8, building: 0.9 },
    });
    const obs = buildObservation({
      playerObserve: { data: { health: 20, food: 18, x: 0, y: 64, z: 0, world: 'world' } },
      rpgObserve: { data: { active_quests: [], completed_quests: [], archetype: 'builder' } },
    });
    const decision = decide(agent, obs, {
      questCandidates: [
        {
          id: 'daily_quarry',
          name: 'Pedreira',
          archetype: 'builder',
          objectives: [{ typeId: 'mine_block', block: 'stone', amount: 32 }],
          rewards: { money: 40 },
        },
      ],
    });
    assert.equal(decision.intent, 'pursue_quest');
    assert.equal(decision.quest.id, 'daily_quarry');
  });

  it('quest loop: observe→accept→plan→complete→remember without live server', async () => {
    const agent = createAgent({ name: 'SliceBot', occupation: 'builder', traits: { greedy: 0.7 } });
    const events = [];
    let completed = false;
    const loop = createQuestLoop(agent, {
      eventSink: events,
      observePlayer: async () => ({
        success: true,
        data: { health: 20, food: 20, x: 100, y: 64, z: 100, world: 'world' },
      }),
      observeRpg: async () => ({
        success: true,
        data: {
          archetype: 'builder',
          active_quests: completed
            ? []
            : agent.state.activeQuestId
              ? [agent.state.activeQuestId]
              : [],
          completed_quests: completed ? ['daily_quarry'] : [],
        },
      }),
      listQuestCandidates: async () => [
        {
          id: 'daily_quarry',
          name: 'Pedreira Diária',
          archetype: 'builder',
          objectives: [{ typeId: 'mine_block', block: 'stone', amount: 8, id: 'mine_stone' }],
          rewards: { money: 40 },
          status: 'NOT_STARTED',
        },
      ],
      questDetail: async (id) => ({
        success: true,
        data: {
          id,
          name: 'Pedreira Diária',
          archetype: 'builder',
          objectives: [{ typeId: 'mine_block', block: 'stone', amount: 8, id: 'mine_stone' }],
          rewards: { money: 40 },
          status: 'NOT_STARTED',
        },
      }),
      acceptQuest: async (id) => {
        agent.state.activeQuestId = id;
        return { success: true, data: { result: 'SUCCESS' } };
      },
      executeStep: async () => {
        completed = true;
        return { success: true };
      },
    });

    const phases = [];
    for (let i = 0; i < 20; i++) {
      const r = await loop.tick();
      phases.push(r.phase);
      if (r.remembered) break;
    }
    assert.ok(
      phases.includes('decide') || phases.includes('evaluate') || phases.includes('accept')
    );
    assert.ok(
      agent.memory.episodic.some((e) => e.type === 'quest_complete'),
      JSON.stringify(agent.memory.episodic)
    );
    assert.ok(
      events.some((e) => e.type === 'ai.npc.quest.accept' || e.type === 'ai.npc.quest.complete')
    );
  });

  it('social memory trust updates', () => {
    const agent = createAgent({ name: 'SocialBot', occupation: 'social' });
    rememberPerson(agent.memory, 'Daniel', { deltaTrust: 0.3, note: 'Helped defend village' });
    rememberPerson(agent.memory, 'Daniel', { deltaTrust: 0.2, note: 'Gave diamonds' });
    assert.ok(agent.memory.social.Daniel.trust > 0.4);
  });

  it('personality factory covers professions', () => {
    const p = createPersonality('guard', { brave: 0.8 });
    assert.ok(p.weights.safety >= 1.4);
  });

  it('mine executor uses quest_detail progress not break success alone', async () => {
    const agent = createAgent({ name: 'Miner', occupation: 'builder' });
    let progress = 0;
    const result = await executeMineObjective(
      agent,
      {
        findBlock: async () => ({
          success: true,
          data: {
            nearest: { x: 1 + progress, y: 64, z: 1, material: 'STONE' },
          },
        }),
        moveTo: async () => ({ success: true }),
        breakBlock: async () => {
          progress += 1;
          return { success: true };
        },
        questDetail: async () => ({
          success: true,
          data: {
            id: 'ai_world_mine_probe',
            objectives: [{ id: 'mine_stone', progress, amount: 3, complete: progress >= 3 }],
            progress_completed: progress >= 3 ? 1 : 0,
            progress_total: 1,
          },
        }),
      },
      { questId: 'ai_world_mine_probe', objectiveId: 'mine_stone', block: 'stone', amount: 3 }
    );
    assert.equal(result.success, true, result.reason);
    assert.equal(result.progress, 3);
  });

  it('persistence snapshot drops ephemeral working memory', () => {
    const agent = createAgent({ name: 'Persist2', occupation: 'explorer' });
    agent.memory.working = { scratch: true };
    agent.goals.current = { id: 'g1', questId: 'q1', title: 'Q' };
    const snap = toPersistentSnapshot(agent);
    assert.deepEqual(snap.memory.working, {});
    assert.equal(snap.goals.current.questId, 'q1');
  });
});
