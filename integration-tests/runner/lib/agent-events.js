'use strict';

/**
 * agent-events.js
 * ----------------
 * Typed, agent-oriented event builders for the village worker (M6).
 *
 * Replaces the previous free-form `log({ kind: 'inventory_diff', ... })` /
 * `log({ kind: 'tool_check', ... })` calls with STRUCTURED events that carry
 * their FULL context in one row:
 *
 *   - what was acted on (target block type + position)        -> "where"
 *   - with what tool (held item + tool-check verdict)         -> "by what / right tool?"
 *   - where the NPC was standing (its own position)           -> "where (agent)"
 *   - what it actually gained / lost / dropped                -> "what picked up"
 *     (inventory diff = M5 reality, proven by cap.observe diff — never give/clear)
 *   - outcome (success / honest failure reason)
 *
 * This directly answers Dan's agent-oriented questions for EVERY action:
 * "what picked up / by what / where / buried? / can retaliate? / right tool? /
 *  starve-fire-dark?" — `combat_survival` (lib/combat-log.js) covers retaliate /
 *  starve-fire-dark / buried; these cover pick-up / by-what / where / right-tool.
 *
 * Pure functions, no I/O, no RCON, no globals — easy to unit-test and to drop
 * into the worker. The worker still emits them through its `log()` (which
 * stamps ts + appends JSONL + console.logs), so existing readers keep working.
 *
 * Event kinds (stable vocabulary, grep-friendly):
 *   mine   — mining a natural block for material (miner, lumberjack)
 *   break  — tearing down / clearing a block (beautify, cleanup)
 *   gather — foraging a resource block (gather job)
 *   place  — placing a block from the NPC's OWN inventory (no setblock cheat)
 *   combat_survival — see lib/combat-log.js (M4)
 *
 * Every event carries `schemaVersion` so a future schema bump is detectable in
 * the JSONL without breaking older rows.
 */

const SCHEMA_VERSION = 1;

const KIND = Object.freeze({
  MINE: 'mine',
  BREAK: 'break',
  GATHER: 'gather',
  PLACE: 'place',
  COMBAT: 'combat_survival',
});

function _nowIso(now) {
  return typeof now === 'number' ? new Date(now).toISOString() : new Date().toISOString();
}

function _num(v, d = null) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

function _pos(p) {
  if (!p || typeof p !== 'object') return null;
  return { x: _num(p.x), y: _num(p.y), z: _num(p.z) };
}

/**
 * Normalize a tool-check verdict (from lib/tool-check.js `checkTool` return)
 * plus the raw held item into the event's `tool` shape.
 * @returns {{held:?string, category:?string, expected:?string, matched:?boolean, reason:?string}}
 */
function _toolFrom(held, verdict) {
  if (verdict && typeof verdict === 'object') {
    return {
      held: held || verdict.held || null,
      category: verdict.actualTool || null,
      expected: verdict.expectedTool || null,
      matched: verdict.matched === true,
      reason: verdict.reason || null,
    };
  }
  if (held != null) {
    return { held: String(held), category: null, expected: null, matched: null, reason: null };
  }
  return { held: null, category: null, expected: null, matched: null, reason: null };
}

/** Coerce a diffInventory() result (or anything shaped like it) to safe arrays. */
function _normInv(inv) {
  if (!inv || typeof inv !== 'object') return { gained: [], lost: [], dropped: [] };
  const arr = (x) => (Array.isArray(x) ? x : []);
  return {
    gained: arr(inv.gained).map((g) => ({
      item: g && g.item != null ? String(g.item) : null,
      qty: _num(g && g.qty, 0),
      from: g && g.from != null ? String(g.from) : null,
    })),
    lost: arr(inv.lost).map((l) => ({
      item: l && l.item != null ? String(l.item) : null,
      qty: _num(l && l.qty, 0),
    })),
    dropped: arr(inv.dropped).map((d) => ({
      item: d && d.item != null ? String(d.item) : null,
      qty: _num(d && d.qty, 0),
    })),
  };
}

function _base(actor, kind, opts) {
  const o = opts || {};
  return {
    schemaVersion: SCHEMA_VERSION,
    ts: _nowIso(o.now),
    kind, // typed event kind (stable vocabulary)
    action: kind, // duplicate for the worker's analyzer/grep convention (uses `action`)
    actor: actor || 'agent',
    job: o.job || null,
    source: o.source || 'worker:runJob',
  };
}

/**
 * Build a `mine` event — mining a natural block for material (miner, lumberjack).
 * @param {object} p
 * @param {string} [p.actor]
 * @param {string} [p.job]              e.g. 'miner' | 'lumberjack'
 * @param {{blockType?:string, material?:string, x?:number, y?:number, z?:number}} [p.target]
 * @param {string} [p.held]             raw `data.held` item in hand
 * @param {object} [p.toolVerdict]      return of tool-check `checkTool(held, target)`
 * @param {object} [p.invDiff]          return of inventory-diff `diffInventory(...)` (M5)
 * @param {boolean} [p.success]
 * @param {string} [p.reason]
 * @param {{x?:number,y?:number,z?:number}} [p.position]  NPC standing position
 * @param {number} [p.now]
 */
function buildMineEvent(p = {}) {
  const e = _base(p.actor, KIND.MINE, p);
  const t = p.target || {};
  e.target = {
    blockType: t.blockType || t.material || null,
    x: _num(t.x),
    y: _num(t.y),
    z: _num(t.z),
  };
  e.tool = _toolFrom(p.held, p.toolVerdict);
  e.inventory = _normInv(p.invDiff);
  e.result = { success: p.success === true, reason: p.reason || null };
  e.position = _pos(p.position);
  return e;
}

/**
 * Build a `break` event — tearing down / clearing a block (beautify, cleanup).
 * Same shape as `mine`; the `kind` makes the intent explicit in the log.
 */
function buildBreakEvent(p = {}) {
  const e = _base(p.actor, KIND.BREAK, p);
  const t = p.target || {};
  e.target = {
    blockType: t.blockType || t.material || null,
    x: _num(t.x),
    y: _num(t.y),
    z: _num(t.z),
  };
  e.tool = _toolFrom(p.held, p.toolVerdict);
  e.inventory = _normInv(p.invDiff);
  e.result = { success: p.success === true, reason: p.reason || null };
  e.position = _pos(p.position);
  return e;
}

/**
 * Build a `gather` event — foraging a resource block (gather job).
 * @param {object} p  same fields as buildMineEvent, plus optional `gathered` count
 */
function buildGatherEvent(p = {}) {
  const e = _base(p.actor, KIND.GATHER, p);
  const t = p.target || {};
  e.target = {
    blockType: t.blockType || t.material || null,
    x: _num(t.x),
    y: _num(t.y),
    z: _num(t.z),
  };
  e.tool = _toolFrom(p.held, p.toolVerdict);
  e.inventory = _normInv(p.invDiff);
  e.gathered = _num(p.gathered, 0);
  e.result = { success: p.success === true, reason: p.reason || null };
  e.position = _pos(p.position);
  return e;
}

/**
 * Build a `place` event — placing a block from the NPC's OWN inventory
 * (player-like: no setblock / giveItem admin fill). The inventory diff shows the
 * material leaving the NPC's hand (lost) and proves nothing was admin-injected.
 * @param {object} p
 * @param {string} [p.material]  block placed (e.g. 'GRASS_BLOCK', 'TORCH')
 */
function buildPlaceEvent(p = {}) {
  const e = _base(p.actor, KIND.PLACE, p);
  const t = p.target || {};
  e.target = {
    blockType: p.material || t.blockType || t.material || null,
    x: _num(t.x),
    y: _num(t.y),
    z: _num(t.z),
  };
  e.tool = _toolFrom(p.held, p.toolVerdict);
  e.inventory = _normInv(p.invDiff);
  e.result = { success: p.success === true, reason: p.reason || null };
  e.position = _pos(p.position);
  return e;
}

module.exports = {
  SCHEMA_VERSION,
  KIND,
  buildMineEvent,
  buildBreakEvent,
  buildGatherEvent,
  buildPlaceEvent,
  // helpers exported for tests / future builders
  _toolFrom,
  _normInv,
  _pos,
};
