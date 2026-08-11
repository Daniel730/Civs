/**
 * Persistence policy for AI citizens.
 *
 * Persistent across disconnect / process restart:
 *   identity, needs baselines, goals (life/long/medium), relationships,
 *   skills, episodic/semantic/social memory, autonomyLevel
 *
 * Ephemeral (cleared on disconnect / fresh actor session):
 *   working memory, currentPlan, currentTask activity ticks, guard position samples,
 *   cooldowns, lastObservation
 */

const { saveAgent, loadAgent, createAgent } = require('./state');
const { createMemory, clearWorking } = require('./memory');
const { createGuard } = require('./anti-stupid');

function toPersistentSnapshot(agent) {
  return {
    schemaVersion: agent.schemaVersion || 1,
    autonomyLevel: agent.autonomyLevel,
    identity: agent.identity,
    needs: agent.needs,
    goals: {
      life: agent.goals.life,
      longTerm: agent.goals.longTerm,
      mediumTerm: agent.goals.mediumTerm,
      // current goal is semi-persistent — keep if quest-linked
      current: agent.goals.current && agent.goals.current.questId ? agent.goals.current : null,
    },
    relationships: agent.relationships,
    skills: agent.skills,
    memory: {
      working: {},
      episodic: (agent.memory && agent.memory.episodic) || [],
      semantic: (agent.memory && agent.memory.semantic) || {},
      social: (agent.memory && agent.memory.social) || {},
      caps: (agent.memory && agent.memory.caps) || undefined,
    },
    state: {
      location: null,
      activity: 'idle',
      health: null,
      food: null,
      inventory: [],
      currentPlan: null,
      currentTask: null,
      activeQuestId: agent.state && agent.state.activeQuestId,
      money: agent.state && agent.state.money,
    },
    schedule: agent.schedule || null,
    updatedAt: Date.now(),
  };
}

function restoreAgent(filePath, defaults = {}) {
  const loaded = loadAgent(filePath);
  clearWorking(loaded.memory);
  loaded.guard = createGuard(defaults.guardOpts);
  loaded.state = {
    ...loaded.state,
    location: null,
    activity: loaded.state.activeQuestId ? 'resume_quest' : 'idle',
    currentPlan: null,
    currentTask: null,
    inventory: [],
  };
  return loaded;
}

function persistAgent(agent, filePath) {
  const snap = toPersistentSnapshot(agent);
  // Rehydrate into full agent shape for saveAgent Set handling
  const full = {
    ...createAgent({ id: snap.identity.id, name: snap.identity.name }),
    ...snap,
    memory: { ...createMemory(snap.memory.caps), ...snap.memory, working: {} },
    guard: createGuard(),
  };
  return saveAgent(full, filePath);
}

module.exports = {
  toPersistentSnapshot,
  restoreAgent,
  persistAgent,
};
