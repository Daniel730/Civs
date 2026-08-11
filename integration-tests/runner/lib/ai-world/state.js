const fs = require('node:fs');
const path = require('node:path');
const { createPersonality } = require('./personality');
const { createMemory } = require('./memory');
const { createGuard } = require('./anti-stupid');

/** Autonomy ladder from the mission brief — do not claim higher than validated. */
const AUTONOMY = Object.freeze({
  SCRIPTED: 0,
  GOAL_DIRECTED: 1,
  REACTIVE: 2,
  PERSISTENT_MEMORY: 3,
  SOCIAL: 4,
  ECONOMIC: 5,
  CONSTRUCTION: 6,
  SETTLEMENT: 7,
  EMERGENT: 8,
});

/**
 * Create a persistent AI-citizen agent record.
 * Adapted from the mission schema to the existing Player-actor architecture
 * (agents are RawKeepAliveActor players + server capabilities — not Citizens entities).
 *
 * @param {object} opts
 */
function createAgent(opts = {}) {
  const id = opts.id || opts.name || 'Citizen';
  const occupation = opts.occupation || 'explorer';
  return {
    schemaVersion: 1,
    autonomyLevel: opts.autonomyLevel == null ? AUTONOMY.GOAL_DIRECTED : opts.autonomyLevel,
    identity: {
      id,
      name: opts.name || id,
      age: opts.age == null ? 25 : opts.age,
      personality: createPersonality(occupation, opts.traits || {}),
      background: opts.background || '',
      occupation,
      home: opts.home || null,
      origin: opts.origin || null,
    },
    needs: {
      hunger: opts.needs?.hunger ?? 0.3,
      safety: opts.needs?.safety ?? 0.2,
      social: opts.needs?.social ?? 0.3,
      rest: opts.needs?.rest ?? 0.2,
      money: opts.needs?.money ?? 0.4,
      purpose: opts.needs?.purpose ?? 0.5,
    },
    goals: {
      life: opts.goals?.life || null,
      longTerm: opts.goals?.longTerm || [],
      mediumTerm: opts.goals?.mediumTerm || [],
      current: opts.goals?.current || null,
    },
    relationships: {
      friends: {},
      family: {},
      enemies: {},
      employers: {},
      factions: {},
      players: {},
    },
    skills: {
      gathering: 0.5,
      farming: 0.5,
      building: 0.5,
      combat: 0.5,
      trading: 0.5,
      exploration: 0.5,
      crafting: 0.5,
      ...(opts.skills || {}),
    },
    memory: createMemory(opts.memoryCaps),
    state: {
      location: null,
      activity: 'idle',
      health: 20,
      food: 20,
      inventory: [],
      currentPlan: null,
      currentTask: null,
      activeQuestId: null,
      money: null,
    },
    guard: createGuard(opts.guardOpts),
    schedule: opts.schedule || null,
    updatedAt: Date.now(),
  };
}

function saveAgent(agent, filePath) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const clone = JSON.parse(
    JSON.stringify(agent, (_key, value) => {
      if (value instanceof Set) return [...value];
      return value;
    })
  );
  fs.writeFileSync(filePath, JSON.stringify(clone, null, 2), 'utf8');
  return filePath;
}

function loadAgent(filePath) {
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  if (raw.guard) {
    raw.guard.invalidatedPlans = new Set(raw.guard.invalidatedPlans || []);
    raw.guard.opts = { ...createGuard().opts, ...(raw.guard.opts || {}) };
    raw.guard.retries = raw.guard.retries || {};
    raw.guard.lastPositions = raw.guard.lastPositions || [];
    raw.guard.lastGoals = raw.guard.lastGoals || [];
    raw.guard.cooldowns = raw.guard.cooldowns || {};
    raw.guard.lastActions = raw.guard.lastActions || [];
  } else {
    raw.guard = createGuard();
  }
  if (!raw.memory) raw.memory = createMemory();
  return raw;
}

module.exports = {
  AUTONOMY,
  createAgent,
  saveAgent,
  loadAgent,
};
