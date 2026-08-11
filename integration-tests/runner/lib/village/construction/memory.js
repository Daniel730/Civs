/**
 * Construction memory — NPCs remember successes, failures, and style preferences.
 */

const fs = require('fs');
const path = require('path');

const DEFAULT_PATH = path.join(__dirname, '../../../reports/construction-memory.json');

/**
 * @param {string} [filePath]
 */
function loadMemory(filePath = DEFAULT_PATH) {
  try {
    if (!fs.existsSync(filePath)) {
      return { version: 1, outcomes: [], siteConstraints: [], styles: {}, successfulDesigns: [] };
    }
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return {
      version: raw.version || 1,
      outcomes: raw.outcomes || [],
      siteConstraints: raw.siteConstraints || [],
      styles: raw.styles || {},
      successfulDesigns: raw.successfulDesigns || [],
    };
  } catch {
    return { version: 1, outcomes: [], siteConstraints: [], styles: {}, successfulDesigns: [] };
  }
}

/**
 * @param {object} memory
 * @param {string} [filePath]
 */
function saveMemory(memory, filePath = DEFAULT_PATH) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(memory, null, 2));
  return filePath;
}

/**
 * Record a project outcome.
 * @param {object} memory
 * @param {{
 *   projectId: string,
 *   purpose?: string,
 *   style?: string,
 *   site?: {x:number,z:number},
 *   status: string,
 *   score?: object,
 *   reject?: string,
 *   notes?: string,
 * }} outcome
 */
function rememberOutcome(memory, outcome) {
  const entry = {
    at: new Date().toISOString(),
    projectId: outcome.projectId,
    purpose: outcome.purpose,
    style: outcome.style,
    site: outcome.site,
    status: outcome.status,
    score: outcome.score,
    reject: outcome.reject,
    notes: outcome.notes,
  };
  memory.outcomes.push(entry);
  // Cap growth
  if (memory.outcomes.length > 500) memory.outcomes = memory.outcomes.slice(-400);

  if (outcome.reject && outcome.site) {
    memory.siteConstraints.push({
      x: outcome.site.x,
      z: outcome.site.z,
      reject: outcome.reject,
      at: entry.at,
    });
    if (memory.siteConstraints.length > 200) {
      memory.siteConstraints = memory.siteConstraints.slice(-150);
    }
  }

  if (outcome.status === 'COMMITTED' && outcome.style) {
    memory.styles[outcome.style] = (memory.styles[outcome.style] || 0) + 1;
    if (outcome.purpose) {
      memory.successfulDesigns.push({
        purpose: outcome.purpose,
        style: outcome.style,
        score: outcome.score && outcome.score.overall,
        at: entry.at,
      });
      if (memory.successfulDesigns.length > 100) {
        memory.successfulDesigns = memory.successfulDesigns.slice(-80);
      }
    }
  }

  return memory;
}

/**
 * Prefer the style that has succeeded most often for this settlement.
 * @param {object} memory
 * @param {string} [fallback]
 */
function preferredStyle(memory, fallback = 'medieval_village') {
  const styles = memory.styles || {};
  let best = fallback;
  let n = -1;
  for (const [k, v] of Object.entries(styles)) {
    if (v > n) {
      n = v;
      best = k;
    }
  }
  return best;
}

/**
 * True if site was recently rejected for a hard constraint.
 * @param {object} memory
 * @param {{x:number,z:number}} site
 * @param {number} [radius]
 */
function isSiteConstrained(memory, site, radius = 3) {
  for (const c of memory.siteConstraints || []) {
    const dx = c.x - site.x;
    const dz = c.z - site.z;
    if (dx * dx + dz * dz <= radius * radius) return c;
  }
  return null;
}

module.exports = {
  DEFAULT_PATH,
  loadMemory,
  saveMemory,
  rememberOutcome,
  preferredStyle,
  isSiteConstrained,
};
