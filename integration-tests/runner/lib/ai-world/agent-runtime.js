/**
 * Agent runtime — binds the persistent ai-world agent model into the live worker loop.
 *
 * Phase 2 of the Living AI World audit (docs/AIWORLD_AUDIT.md). This is the INTEGRATION
 * layer: it does NOT replace the worker's execution path (runJob / chooseObjective stay in
 * charge of acting). It gives every NPC a real, disk-persistent memory + goals record that
 * survives process / server restart, and records the events the loop already emits.
 *
 * Design rules (from the audit + brief §3/§31):
 *   - Additive only. Never change what the agent does; only what it REMEMBERS and PERSISTS.
 *   - All persistence is best-effort: a failed save must never break a work tick.
 *   - Memory is bounded (memory.js caps) so it cannot grow without limit (brief §4).
 *   - Agent files live under reports/agents/<name>.json so they are outside the repo tree
 *     and survive restarts without polluting git.
 */

const fs = require('node:fs');
const path = require('node:path');
const { createAgent, createGoal, setCurrentGoal, completeCurrentGoal } = require('./state');
const { restoreAgent, persistAgent } = require('./persistence');
const { rememberEpisode, rememberFact, rememberPerson, setWorking } = require('./memory');
const { buildObservation } = require('./perception');
const { scoreNeeds, decide } = require('./decision');
const { EVENT, emitAgentEvent } = require('./events');

const AGENTS_DIR = path.join(__dirname, '..', '..', 'reports', 'agents');

function agentPath(name) {
  return path.join(AGENTS_DIR, `${name}.json`);
}

/**
 * Create or restore a persistent agent for a named NPC.
 * @param {string} name e.g. 'Steve'
 * @param {{ occupation?: string, traits?: object, origin?: object }} [opts]
 * @returns {object} the agent record (with .memory, .goals, .guard, .identity)
 */
function loadOrCreateAgent(name, opts = {}) {
  const file = agentPath(name);
  let agent;
  if (fs.existsSync(file)) {
    try {
      agent = restoreAgent(file, opts);
      return agent;
    } catch (_) {
      // Corrupt agent file — fall through to a fresh agent rather than crashing.
    }
  }
  agent = createAgent({
    id: name,
    name,
    occupation: opts.occupation || (name === 'Steve' ? 'builder' : 'helper'),
    traits: opts.traits || {},
    origin: opts.origin || null,
  });
  return agent;
}

/** Persist an agent to disk. Best-effort. */
function saveAgent(agent) {
  try {
    persistAgent(agent, agentPath(agent.identity.name));
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * Build the hierarchical observation the ai-world modules expect, from a raw harness observe.
 * @param {{ success?: boolean, data?: object }} rawObserve
 */
function observeFor(agent, rawObserve) {
  const playerObserve = (rawObserve && rawObserve.data) || rawObserve || {};
  return buildObservation({ playerObserve });
}

/**
 * Enrich the worker's focus choice with the agent's persistent memory + personality.
 * Pure: returns a { memory, intent, scoring } bundle the worker can log. Does NOT act.
 *
 * @param {object} agent
 * @param {object} rawObserve raw harness observe for this NPC
 * @returns {{ observation: object, candidates: Array, topIntent: string|null }}
 */
function scoreFor(agent, rawObserve) {
  const observation = observeFor(agent, rawObserve);
  const candidates = scoreNeeds(agent, observation);
  const top = candidates[0] ? candidates[0].id : null;
  return { observation, candidates, topIntent: top };
}

/**
 * Record a meaningful episode into the agent's episodic memory.
 * @param {object} agent
 * @param {{ type: string, summary: string, importance?: number, tags?: string[] }} ev
 */
function recordEpisode(agent, ev) {
  try {
    return rememberEpisode(agent.memory, ev);
  } catch (_) {
    return null;
  }
}

/**
 * Record a world fact into the agent's semantic memory.
 * @param {object} agent
 * @param {string} key
 * @param {*} value
 * @param {number} [importance]
 */
function recordFact(agent, key, value, importance = 0.5) {
  try {
    rememberFact(agent.memory, key, value, importance);
  } catch (_) {
    /* best-effort */
  }
}

/**
 * Record an interaction with another agent into social memory.
 * @param {object} agent
 * @param {string} otherId
 * @param {{ deltaTrust?: number, note?: string }} update
 */
function recordSocial(agent, otherId, update) {
  try {
    return rememberPerson(agent.memory, otherId, update);
  } catch (_) {
    /* best-effort */
  }
}

/**
 * Emit a structured WorldEvent (brief §28) and mirror it into episodic memory.
 * @param {Function|Array|object} sink same sink accepted by events.emitAgentEvent
 * @param {object} agent
 * @param {string} type one of EVENT.*
 * @param {object} payload
 */
function emit(agent, sink, type, payload = {}) {
  const ev = emitAgentEvent(sink, type, { agentId: agent.identity.name, ...payload });
  // High-interest events are also worth remembering.
  const IMPORTANT = new Set([
    EVENT.QUEST_COMPLETE,
    EVENT.QUEST_FAIL,
    EVENT.REPLAN,
    EVENT.CONSTRUCTION,
    EVENT.SOCIAL,
  ]);
  if (IMPORTANT.has(type)) {
    recordEpisode(agent, {
      type: String(type).replace('ai.npc.', ''),
      summary: payload.summary || type,
      importance: 0.7,
      tags: [payload.questId || 'event'],
    });
  }
  return ev;
}

/**
 * Close the commit/complete cycle on the agent's current goal when an objective is reached.
 * @param {object} agent
 * @param {string} reason 'done' | 'abandoned'
 */
function closeCurrentGoal(agent, reason = 'done') {
  try {
    return completeCurrentGoal(agent, reason);
  } catch (_) {
    return null;
  }
}

/**
 * Set a current goal on the agent (used when the worker commits to an objective).
 * @param {object} agent
 * @param {object} partial goal fields
 */
function commitGoal(agent, partial) {
  try {
    return setCurrentGoal(agent, createGoal(partial));
  } catch (_) {
    return null;
  }
}

module.exports = {
  AGENTS_DIR,
  agentPath,
  loadOrCreateAgent,
  saveAgent,
  observeFor,
  scoreFor,
  recordEpisode,
  recordFact,
  recordSocial,
  emit,
  closeCurrentGoal,
  commitGoal,
};
