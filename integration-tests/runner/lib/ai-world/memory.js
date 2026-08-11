/**
 * Bounded agent memory. Do not store every observation — compress + prioritize.
 *
 * working  — current situation (ephemeral)
 * episodic — important events (capped)
 * semantic — world knowledge (places, resources)
 * social   — people / reputation
 */

const DEFAULT_CAPS = Object.freeze({
  episodic: 64,
  semantic: 128,
  social: 64,
});

function createMemory(caps = {}) {
  return {
    working: {},
    episodic: [],
    semantic: {},
    social: {},
    caps: { ...DEFAULT_CAPS, ...caps },
  };
}

/**
 * @param {ReturnType<typeof createMemory>} memory
 * @param {{ type: string, summary: string, importance?: number, at?: number, tags?: string[] }} event
 */
function rememberEpisode(memory, event) {
  const entry = {
    type: event.type,
    summary: event.summary,
    importance: event.importance == null ? 0.5 : event.importance,
    at: event.at || Date.now(),
    tags: event.tags || [],
  };
  memory.episodic.push(entry);
  const cap = memory.caps.episodic;
  if (memory.episodic.length > cap) {
    memory.episodic.sort((a, b) => a.importance - b.importance);
    memory.episodic.splice(0, memory.episodic.length - cap);
    memory.episodic.sort((a, b) => a.at - b.at);
  }
  return entry;
}

/**
 * @param {ReturnType<typeof createMemory>} memory
 * @param {string} key
 * @param {*} value
 * @param {number} [importance]
 */
function rememberFact(memory, key, value, importance = 0.5) {
  memory.semantic[key] = { value, importance, at: Date.now() };
  const keys = Object.keys(memory.semantic);
  const cap = memory.caps.semantic;
  if (keys.length > cap) {
    keys
      .map((k) => ({ k, i: memory.semantic[k].importance }))
      .sort((a, b) => a.i - b.i)
      .slice(0, keys.length - cap)
      .forEach(({ k }) => {
        delete memory.semantic[k];
      });
  }
}

/**
 * @param {ReturnType<typeof createMemory>} memory
 * @param {string} personId
 * @param {{ deltaTrust?: number, note?: string, lastSeen?: number }} update
 */
function rememberPerson(memory, personId, update) {
  const prev = memory.social[personId] || { trust: 0, notes: [], lastSeen: 0 };
  const trust = Math.max(-1, Math.min(1, prev.trust + (update.deltaTrust || 0)));
  const notes = [...prev.notes];
  if (update.note) {
    notes.push({ at: Date.now(), note: update.note });
    if (notes.length > 8) notes.splice(0, notes.length - 8);
  }
  memory.social[personId] = {
    trust,
    notes,
    lastSeen: update.lastSeen || Date.now(),
  };
  const ids = Object.keys(memory.social);
  const cap = memory.caps.social;
  if (ids.length > cap) {
    ids
      .map((id) => ({ id, t: Math.abs(memory.social[id].trust) }))
      .sort((a, b) => a.t - b.t)
      .slice(0, ids.length - cap)
      .forEach(({ id }) => {
        delete memory.social[id];
      });
  }
  return memory.social[personId];
}

function setWorking(memory, patch) {
  memory.working = { ...memory.working, ...patch };
}

function clearWorking(memory) {
  memory.working = {};
}

/**
 * Recent failures of a given type — used by anti-stupidity / quest eval.
 * @param {ReturnType<typeof createMemory>} memory
 * @param {string} type
 * @param {number} [sinceMs]
 */
function recentFailures(memory, type, sinceMs = 30 * 60 * 1000) {
  const since = Date.now() - sinceMs;
  return memory.episodic.filter(
    (e) => e.type === type && e.at >= since && (e.tags || []).includes('failure')
  );
}

module.exports = {
  DEFAULT_CAPS,
  createMemory,
  rememberEpisode,
  rememberFact,
  rememberPerson,
  setWorking,
  clearWorking,
  recentFailures,
};
