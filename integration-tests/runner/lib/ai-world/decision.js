/**
 * Deterministic decision engine. Optional LLM hook for high-level choice only.
 * Cadence: callers should invoke on a timer / event — never every Minecraft tick.
 */

const { applyPersonality } = require('./personality');
const { createGoal, setCurrentGoal, reconsiderGoals } = require('./goals');
const { selectQuest } = require('./quest-eval');
const { noteGoal } = require('./anti-stupid');
const { setWorking } = require('./memory');
const { encodeState, buildExperience } = require('./state-rep');
const { NeuralPolicy } = require('./neural-policy');
const { ExperienceStore } = require('./experience-store');

// MVP policy mode: deterministic | neural | shadow. No RL; neural mirrors baseline until trained.
const POLICY_MODE = (process.env.AIWORLD_POLICY || 'deterministic').toLowerCase();

// One shared store collects experiences for all agents (shared learned policy direction).
let _experienceStore = null;
function experienceStore() {
  if (!_experienceStore) _experienceStore = new ExperienceStore();
  return _experienceStore;
}

// One policy instance per process; weights are null (mirror) until an offline training step
// writes reports/aiworld-weights/weights-<agent>.json (or weights-shared.json). In neural/shadow
// mode the policy attempts to load trained weights at construction (best-effort; falls back to
// baseline mirror if absent or corrupt).
let _policy = null;
function policy() {
  if (!_policy) _policy = new NeuralPolicy({ mode: POLICY_MODE });
  return _policy;
}

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

  // ---- AI World neural layer (MVP): record, do not replace ----
  recordDecisionExperience(agent, observation, needScores, top, 'top_need');

  return {
    intent: top.id,
    goal,
    reason: 'top_need',
    model: 'deterministic',
    needScores,
  };
}

/**
 * Record a focus-level decision (used by village-worker's tick loop, which drives the
 * settlement via chooseFocus rather than the full quest decide()). Same dataset schema,
 * same safety rules. Keeps the neural layer recording every real decision without
 * replacing chooseFocus.
 *
 * @param {{ agentId:string, observation:object, focus:string, candidates:Array<{id:string,base:number,motive?:string}>,
 *   survivalState?:string, distWork?:number, personality?:object }} rec
 */
function recordFocusDecision(rec = {}) {
  try {
    const { METRIC, countMetric } = require('../metrics');
    const stateRep = encodeState(rec.observation || {}, {
      survival: { state: rec.survivalState || 'SAFE', distanceFromWork: rec.distWork },
    });
    const candidates =
      rec.candidates && rec.candidates.length
        ? rec.candidates
        : rec.focus
          ? [{ id: rec.focus, base: 1, motive: 'focus' }]
          : [];
    const pol = policy();
    let neuralScores = null;
    if (POLICY_MODE !== 'deterministic') {
      const res = pol.scoreIntents(stateRep.vec, candidates, rec.survivalState || 'SAFE');
      neuralScores = res.scores;
      if (res.fellBack) countMetric(METRIC.AIWORLD_POLICY_FALLBACK, { agent: rec.agentId });
    }
    const episodeId = experienceStore().recordDecision({
      agentId: rec.agentId,
      observation: rec.observation,
      stateRep,
      personality: rec.personality || {},
      candidates,
      chosenIntent: rec.focus,
      deterministicScores: Object.fromEntries(candidates.map((c) => [c.id, c.base])),
      neuralScores,
      policyMode: POLICY_MODE,
      action: { intent: rec.focus },
    });
    countMetric(METRIC.AIWORLD_EXPERIENCE_RECORDED, { agent: rec.agentId, mode: POLICY_MODE });
    if (neuralScores) {
      const neuroTop = candidates.reduce(
        (a, b) => (neuralScores[b.id] > neuralScores[a.id] ? b : a),
        candidates[0]
      );
      if (neuroTop && neuroTop.id !== rec.focus) {
        countMetric(METRIC.AIWORLD_POLICY_DISAGREEMENT, { agent: rec.agentId });
      }
    }
    return episodeId;
  } catch (_) {
    /* best-effort */
  }
}

function recordDecisionExperience(agent, observation, needScores, top, reason) {
  try {
    const { METRIC, countMetric } = require('../metrics');
    const stateRep = encodeState(observation, {
      survival: {
        state: observation.danger ? 'DANGER' : 'SAFE',
        distanceFromWork: agent._distWork,
      },
    });
    const candidates = needScores.map((c) => ({ id: c.id, base: c.score, motive: c.motive }));
    const pol = policy();
    let neuralScores = null;
    let usedModel = 'deterministic';
    if (POLICY_MODE !== 'deterministic') {
      const res = pol.scoreIntents(stateRep.vec, candidates);
      neuralScores = res.scores;
      usedModel = res.usedModel;
      if (res.fellBack)
        countMetric(METRIC.AIWORLD_POLICY_FALLBACK, {
          agent: agent.identity && agent.identity.name,
        });
    }
    experienceStore().recordDecision({
      agentId: agent.identity && agent.identity.name,
      observation,
      stateRep,
      personality: agent.identity
        ? { archetype: agent.identity.personality, occupation: agent.identity.occupation }
        : {},
      candidates,
      chosenIntent: top.id,
      deterministicScores: Object.fromEntries(needScores.map((c) => [c.id, c.score])),
      neuralScores,
      policyMode: POLICY_MODE,
      action: { intent: top.id },
    });
    countMetric(METRIC.AIWORLD_EXPERIENCE_RECORDED, {
      agent: agent.identity && agent.identity.name,
      mode: POLICY_MODE,
    });
    // metric: disagreement between neural and deterministic top pick (future learning signal)
    if (neuralScores) {
      const neuroTop = candidates.reduce(
        (a, b) => (neuralScores[b.id] > neuralScores[a.id] ? b : a),
        candidates[0]
      );
      if (neuroTop && neuroTop.id !== top.id) {
        countMetric(METRIC.AIWORLD_POLICY_DISAGREEMENT, {
          agent: agent.identity && agent.identity.name,
        });
      }
    }
  } catch (_) {
    /* experience recording is best-effort */
  }
}

/**
 * Attach a terminal outcome + computed reward to a previously recorded focus decision.
 * Best-effort: a missing episodeId must never crash the work tick.
 * @param {string} agentId
 * @param {string} episodeId
 * @param {object} outcome see state-rep computeReward (died, goalCompleted, stalled, ...)
 * @param {object} [rewardWeights]
 */
function recordFocusOutcome(agentId, episodeId, outcome = {}, rewardWeights) {
  if (!episodeId) return null;
  try {
    const { METRIC, countMetric, observeMetric } = require('../metrics');
    const exp = experienceStore().recordOutcome(episodeId, outcome, rewardWeights);
    if (exp && exp.outcome) {
      const r = exp.outcome.reward;
      countMetric(METRIC.AIWORLD_EXPERIENCE_RECORDED, { agent: agentId, mode: POLICY_MODE });
      if (outcome.died) countMetric(METRIC.DEATH, { agent: agentId });
      if (outcome.goalCompleted) countMetric(METRIC.AIWORLD_GOAL_COMPLETED, { agent: agentId });
      if (outcome.stalled) countMetric(METRIC.AIWORLD_STALL, { agent: agentId });
      if (outcome.recovered) countMetric(METRIC.AIWORLD_RECOVERY_SUCCESS, { agent: agentId });
      if (typeof outcome.damageTaken === 'number' && outcome.damageTaken > 0) {
        countMetric(METRIC.AIWORLD_UNNECESSARY_DAMAGE, { agent: agentId });
      }
      observeMetric(METRIC.AIWORLD_REWARD_PER_EPISODE, r, { agent: agentId, mode: POLICY_MODE });
    }
    return exp;
  } catch (_) {
    /* best-effort */
    return null;
  }
}

module.exports = {
  scoreNeeds,
  decide,
  recordFocusDecision,
  recordFocusOutcome,
  recordDecisionExperience,
  policy,
};
