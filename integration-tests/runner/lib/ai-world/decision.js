/**
 * Deterministic decision engine. Optional LLM hook for high-level choice only.
 * Cadence: callers should invoke on a timer / event — never every Minecraft tick.
 */

const { applyPersonality } = require('./personality');
const { createGoal, setCurrentGoal, reconsiderGoals } = require('./goals');
const { selectQuest } = require('./quest-eval');
const { noteGoal } = require('./anti-stupid');
const { setWorking } = require('./memory');

/**
 * Score standing needs into candidate intents.
 * @param {object} agent
 * @param {object} observation
 */
function scoreNeeds(agent, observation) {
  const candidates = [];
  const push = (id, motive, base, title) => {
    const score = applyPersonality(agent.identity.personality, motive, base);
    candidates.push({ id, motive, score, title });
  };

  push(
    'satisfy_hunger',
    'hunger',
    observation.food != null && observation.food < 10 ? 0.9 : agent.needs.hunger * 0.4,
    'Eat / find food'
  );
  push(
    'seek_safety',
    'safety',
    observation.danger ? 0.95 : agent.needs.safety * 0.5,
    'Seek safety'
  );
  push('earn_money', 'money', agent.needs.money, 'Earn money');
  push('pursue_purpose', 'purpose', agent.needs.purpose, 'Pursue purpose');
  push('socialize', 'social', agent.needs.social, 'Socialize');
  push('explore', 'exploration', agent.needs.purpose * 0.6 + 0.2, 'Explore');
  push('build', 'construction', agent.skills.building * 0.5, 'Build / maintain');

  // Profession bias on purpose
  const occ = agent.identity.occupation;
  if (occ === 'builder') push('profession_build', 'construction', 0.7, 'Profession: build');
  if (occ === 'merchant') push('profession_trade', 'money', 0.7, 'Profession: trade');
  if (occ === 'farmer') push('profession_farm', 'gathering', 0.7, 'Profession: farm');
  if (occ === 'explorer') push('profession_explore', 'exploration', 0.75, 'Profession: explore');
  if (occ === 'guard') push('profession_guard', 'safety', 0.75, 'Profession: guard');
  if (occ === 'adventurer') push('profession_quest', 'combat', 0.7, 'Profession: adventure');

  candidates.sort((a, b) => b.score - a.score);
  return candidates;
}

/**
 * Choose next high-level intent. Prefer quest when purpose/money/combat motives win.
 *
 * @param {object} agent
 * @param {object} observation
 * @param {{ questCandidates?: object[], llmChoose?: Function|null }} [opts]
 */
function decide(agent, observation, opts = {}) {
  const reconsider = reconsiderGoals(agent, observation);
  if (reconsider.changed) {
    return {
      intent: 'override',
      goal: reconsider.goal,
      reason: reconsider.reason,
      model: 'deterministic',
    };
  }

  const osc = noteGoal(agent.guard, agent.goals.current ? agent.goals.current.id : 'idle');
  if (osc.oscillating) {
    return {
      intent: 'stabilize',
      reason: 'goal_oscillation',
      model: 'deterministic',
      holdGoal: agent.goals.current,
    };
  }

  const needScores = scoreNeeds(agent, observation);
  const top = needScores[0];

  // Optional LLM: only to pick among top-K need ids / quest ids — must return schema-valid id.
  if (typeof opts.llmChoose === 'function') {
    try {
      const llmPick = opts.llmChoose({
        topNeeds: needScores.slice(0, 5),
        quests: opts.questCandidates || [],
        observationSummary: {
          food: observation.food,
          health: observation.health,
          danger: observation.danger,
          activeQuests: observation.quests && observation.quests.active,
        },
      });
      if (llmPick && llmPick.intent === 'accept_quest' && llmPick.questId) {
        const q = (opts.questCandidates || []).find((x) => x.id === llmPick.questId);
        if (q) {
          return { intent: 'pursue_quest', quest: q, reason: 'llm', model: 'llm', needScores };
        }
      }
    } catch {
      // Fall through to deterministic — never crash the citizen loop on LLM failure.
    }
  }

  const questMotives = new Set([
    'purpose',
    'money',
    'combat',
    'exploration',
    'gathering',
    'construction',
  ]);
  if (questMotives.has(top.motive) && opts.questCandidates && opts.questCandidates.length) {
    const sel = selectQuest(agent, opts.questCandidates);
    if (sel.selected) {
      const goal = createGoal({
        kind: 'current',
        title: `Quest: ${sel.selected.name || sel.selected.id}`,
        motive: top.motive,
        priority: sel.evaluation.score,
        questId: sel.selected.id,
        meta: { evaluation: sel.evaluation },
      });
      setCurrentGoal(agent, goal);
      setWorking(agent.memory, { decision: 'pursue_quest', questId: sel.selected.id });
      return {
        intent: 'pursue_quest',
        quest: sel.selected,
        evaluation: sel.evaluation,
        goal,
        reason: 'quest_selected',
        model: 'deterministic',
        needScores,
      };
    }
  }

  const goal = createGoal({
    kind: 'current',
    title: top.title,
    motive: top.motive,
    priority: top.score,
  });
  setCurrentGoal(agent, goal);
  setWorking(agent.memory, { decision: top.id });
  return {
    intent: top.id,
    goal,
    reason: 'top_need',
    model: 'deterministic',
    needScores,
  };
}

module.exports = {
  scoreNeeds,
  decide,
};
