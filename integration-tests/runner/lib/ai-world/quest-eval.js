/**
 * Quest evaluation — whether an agent should accept a quest.
 * Scoring uses personality, needs, skills, risk, distance, commitments.
 */

const { applyPersonality } = require('./personality');
const { recentFailures } = require('./memory');

/** Map RPG objective type → primary motive. */
const OBJECTIVE_MOTIVE = Object.freeze({
  mine_block: 'gathering',
  kill_mob: 'combat',
  custom_mob_kill: 'combat',
  discover_poi: 'exploration',
  visit_poi: 'exploration',
  visit_region: 'exploration',
  skill_level: 'purpose',
  civs_skill_xp: 'construction',
  break_block: 'gathering',
  place_block: 'construction',
});

/**
 * @param {object} agent
 * @param {{
 *   id: string,
 *   name?: string,
 *   archetype?: string,
 *   tier?: number,
 *   objectives?: Array<{ typeId?: string, type?: string, amount?: number, block?: string, mob?: string }>,
 *   rewards?: { money?: number },
 *   status?: string,
 *   distanceHint?: number,
 * }} quest
 */
function evaluateQuest(agent, quest) {
  const reasons = [];
  let score = 0.4;

  if (!quest || !quest.id) {
    return { accept: false, score: 0, reasons: ['invalid_quest'] };
  }

  if (
    quest.status === 'LOCKED' ||
    quest.status === 'COMPLETED' ||
    quest.status === 'ALREADY_COMPLETE'
  ) {
    return { accept: false, score: 0, reasons: [`status_${quest.status}`] };
  }

  const fails = recentFailures(agent.memory, 'quest_failed').filter((e) =>
    (e.tags || []).includes(quest.id)
  );
  if (fails.length >= 2) {
    return { accept: false, score: 0.05, reasons: ['repeated_failure_memory'] };
  }

  const money = (quest.rewards && quest.rewards.money) || 0;
  const moneyScore = applyPersonality(
    agent.identity.personality,
    'money',
    Math.min(1, money / 200)
  );
  score += moneyScore * 0.25 * (0.5 + (agent.needs.money || 0));
  if (money > 0) reasons.push(`reward_money:${money}`);

  const objectives = quest.objectives || [];
  let combatWeight = 0;
  let gatherWeight = 0;
  let exploreWeight = 0;
  let constructWeight = 0;
  let difficulty = 0;

  for (const obj of objectives) {
    const type = obj.typeId || obj.type || '';
    const motive = OBJECTIVE_MOTIVE[type] || 'purpose';
    const amount = obj.amount || 1;
    difficulty += Math.min(1, amount / 64) * 0.2;
    if (motive === 'combat') combatWeight += 1;
    if (motive === 'gathering') gatherWeight += 1;
    if (motive === 'exploration' || motive === 'discovery') exploreWeight += 1;
    if (motive === 'construction') constructWeight += 1;
  }

  if (combatWeight) {
    const s = applyPersonality(agent.identity.personality, 'combat', combatWeight * 0.2);
    score += s * (0.4 + agent.skills.combat);
    reasons.push('combat_affinity');
  }
  if (gatherWeight) {
    const s = applyPersonality(agent.identity.personality, 'gathering', gatherWeight * 0.2);
    score += s * (0.4 + agent.skills.gathering);
    reasons.push('gather_affinity');
  }
  if (exploreWeight) {
    const s = applyPersonality(agent.identity.personality, 'exploration', exploreWeight * 0.25);
    score += s * (0.4 + agent.skills.exploration);
    reasons.push('explore_affinity');
  }
  if (constructWeight) {
    const s = applyPersonality(agent.identity.personality, 'construction', constructWeight * 0.25);
    score += s * (0.4 + agent.skills.building);
    reasons.push('build_affinity');
  }

  // Archetype match
  const arch = (quest.archetype || '').toLowerCase();
  const occ = (agent.identity.occupation || '').toLowerCase();
  if (arch && (arch === occ || (arch === 'builder' && occ === 'builder') || arch === 'neutral')) {
    score += 0.15;
    reasons.push('archetype_match');
  } else if (arch && arch !== 'neutral' && arch !== occ) {
    score -= 0.2;
    reasons.push('archetype_mismatch');
  }

  // Distance / risk
  const dist = quest.distanceHint || 0;
  if (dist > 200) {
    score -= 0.15;
    reasons.push('far');
  }
  score -= difficulty * applyPersonality(agent.identity.personality, 'safety', 0.3);

  // Existing commitments
  if (agent.state.activeQuestId && agent.state.activeQuestId !== quest.id) {
    score -= 0.35;
    reasons.push('already_committed');
  }
  if (
    agent.goals.current &&
    agent.goals.current.questId &&
    agent.goals.current.questId !== quest.id
  ) {
    score -= 0.15;
    reasons.push('other_goal');
  }

  // Impossible without tools for mine_block of hard materials — soft signal
  for (const obj of objectives) {
    const type = obj.typeId || obj.type || '';
    if (type === 'discover_poi' && !agent.memory.semantic[`poi:${obj.poi || obj.region}`]) {
      // Still acceptable if we can explore; mark uncertainty
      score -= 0.05;
      reasons.push('poi_unknown');
    }
  }

  score = Math.max(0, Math.min(1, score));
  const accept = score >= 0.45;
  if (!accept) reasons.push('score_below_threshold');
  return { accept, score, reasons, difficulty };
}

/**
 * Pick best among candidates.
 * @param {object} agent
 * @param {object[]} quests
 */
function selectQuest(agent, quests) {
  let best = null;
  for (const q of quests || []) {
    const ev = evaluateQuest(agent, q);
    if (!best || ev.score > best.evaluation.score) {
      best = { quest: q, evaluation: ev };
    }
  }
  if (!best || !best.evaluation.accept) {
    return { selected: null, evaluation: best && best.evaluation, candidates: quests || [] };
  }
  return { selected: best.quest, evaluation: best.evaluation, candidates: quests || [] };
}

module.exports = {
  OBJECTIVE_MOTIVE,
  evaluateQuest,
  selectQuest,
};
