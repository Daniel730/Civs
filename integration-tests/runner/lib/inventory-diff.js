'use strict';

/**
 * inventory-diff.js
 * -----------------
 * Real-inventory diffing for NPC item gain/loss on the Civs QA server.
 *
 * WHY THIS EXISTS
 *   M2 is removing the `give` / `clear` capability calls from the worker. From
 *   now on EVERY item change the NPC experiences must be proven by comparing the
 *   REAL inventory observed via `cap.observe(...)` before and after an action.
 *   This module is the single source of truth for "what did the NPC actually
 *   gain / lose / drop".
 *
 *   - `applyObserve(json)`  -> normalize a `cap.observe` reply into {item:qty}
 *   - `diffInventory(before, after, opts)` ->
 *        { gained:[{item,qty,from?}], lost:[{item,qty}], dropped:[{item,qty}] }
 *
 * `dropped` semantics (the important part):
 *   "dropped" = items the action PRODUCED but the NPC is NOT holding afterwards
 *   -> they fell on the floor / were left behind, NOT consumed or equipped.
 *   A floor-drop is invisible in two inventory snapshots alone (the item simply
 *   is not in `after`). To classify it you MUST tell the diff what the action
 *   should have produced, via `opts.expectedDrops` (the broken block's drop, the
 *   chest's contents, ...) or `opts.dropped` (a map you obtained from a separate
 *   ground/world observation). Without that context `dropped` stays empty and
 *   uncollected drops are simply "not gained" (which is itself a useful signal).
 */

/** Coerce any qty-like value into a finite integer >= 0. */
function _qty(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  // Inventories never hold fractional or negative stacks; floor & clamp.
  return n > 0 ? Math.floor(n) : 0;
}

/** Is this an "inventory array" shape: [{material|item, amount|count}, ...]? */
function _isInvArray(v) {
  return Array.isArray(v) && v.length > 0 && typeof v[0] === 'object' && v[0] !== null;
}

/**
 * Normalize a `cap.observe` reply (or its `data`, or a raw inventory array)
 * into a flat { item: qty } map. Items that appear more than once are summed
 * (defensive; the harness normally emits one entry per material).
 *
 * Accepts any of:
 *   - full observe result: { success, data: { inventory: [...] }, ... }
 *   - the `data` object:   { inventory: [...] }
 *   - a raw inventory array: [ { material, amount }, ... ]
 *   - an existing map:        { OAK_LOG: 9 }  (returned as a copy)
 *
 * @param {object|Array|null|undefined} json
 * @returns {Object<string, number>}  material -> count
 */
function applyObserve(json) {
  if (json == null) return {};

  // Already a map.
  if (!Array.isArray(json) && typeof json === 'object') {
    // Full result or data object with .inventory
    const inv = json.inventory != null ? json.inventory : json.data && json.data.inventory;
    if (inv != null) {
      if (_isInvArray(inv)) return _invArrayToMap(inv);
      // If .inventory is itself already a map, normalize it.
      if (typeof inv === 'object') return _cleanMap(inv);
    }
    // Plain map passed directly (no .inventory key).
    if (!('inventory' in json) && !('data' in json)) return _cleanMap(json);
  }

  if (Array.isArray(json)) {
    if (_isInvArray(json)) return _invArrayToMap(json);
    // Bare map-as-array? not valid; fall through to {}.
  }

  return {};
}

function _invArrayToMap(arr) {
  const map = {};
  for (const slot of arr) {
    if (!slot || typeof slot !== 'object') continue;
    const item = slot.material != null ? slot.material : slot.item != null ? slot.item : slot.name;
    if (item == null) continue;
    // `amount` is the harness field; fall back to `count` / `qty`.
    const raw = slot.amount != null ? slot.amount : slot.count != null ? slot.count : slot.qty;
    map[String(item)] = (map[String(item)] || 0) + _qty(raw);
  }
  return map;
}

function _cleanMap(obj) {
  const map = {};
  for (const k of Object.keys(obj)) {
    if (obj[k] == null) continue;
    map[String(k)] = _qty(obj[k]);
  }
  return map;
}

/** Normalize `before`/`after` args into a map, whether map or observe-shaped. */
function _toMap(v) {
  if (v == null) return {};
  if (!Array.isArray(v) && typeof v === 'object' && !('inventory' in v) && !('data' in v)) {
    // Looks like a plain map already (no inventory/data wrapper).
    return _cleanMap(v);
  }
  // observe-shaped or inventory array -> applyObserve handles it.
  const m = applyObserve(v);
  return m && Object.keys(m).length ? m : (typeof v === 'object' && !Array.isArray(v) ? _cleanMap(v) : {});
}

/**
 * Diff two inventory snapshots.
 *
 * @param {Object<string,number>|object} before  inventory BEFORE the action
 * @param {Object<string,number>|object} after   inventory AFTER the action
 *        (either may be a {item:qty} map OR a cap.observe-shaped object)
 * @param {object} [opts]
 * @param {Object<string,number>} [opts.expectedDrops]
 *        What the action should have produced (e.g. { OAK_LOG: 1 } for a broken
 *        oak trunk, or the chest/entity loot). Drives `dropped`.
 * @param {Object<string,number>} [opts.dropped]
 *        A known floor/world map (from a separate ground observation). If given,
 *        used verbatim for `dropped` and `expectedDrops` is ignored.
 * @param {string} [opts.from]
 *        Source label stamped onto every `gained` entry (e.g.
 *        'break:OAK_LOG', 'chest:STOCKPILE', 'entity:ZOMBIE'). This is what the
 *        worker logs as the coleta "source".
 * @returns {{gained:Array, lost:Array, dropped:Array}}
 *          gained:  [{ item, qty, from? }]
 *          lost:    [{ item, qty }]   (consumed / equipped / used)
 *          dropped: [{ item, qty }]   (produced but on the floor, not held)
 */
function diffInventory(before, after, opts = {}) {
  const b = _toMap(before);
  const a = _toMap(after);
  const from = opts && opts.from;

  const items = new Set([...Object.keys(b), ...Object.keys(a)]);

  const gained = [];
  const lost = [];

  for (const item of items) {
    const bq = b[item] || 0;
    const aq = a[item] || 0;
    if (aq > bq) {
      const entry = { item, qty: aq - bq };
      if (from != null) entry.from = from;
      gained.push(entry);
    } else if (aq < bq) {
      lost.push({ item, qty: bq - aq });
    }
  }

  // Order deterministically for stable logs/tests.
  gained.sort((x, y) => x.item.localeCompare(y.item));
  lost.sort((x, y) => x.item.localeCompare(y.item));

  let dropped = [];
  if (opts && opts.dropped && typeof opts.dropped === 'object') {
    dropped = Object.keys(opts.dropped)
      .filter((k) => _qty(opts.dropped[k]) > 0)
      .map((item) => ({ item, qty: _qty(opts.dropped[item]) }))
      .sort((x, y) => x.item.localeCompare(y.item));
  } else if (opts && opts.expectedDrops && typeof opts.expectedDrops === 'object') {
    // For each thing the action should have produced, how much did the NPC
    // actually end up holding? The shortfall fell on the floor.
    for (const item of Object.keys(opts.expectedDrops)) {
      const expected = _qty(opts.expectedDrops[item]);
      if (expected <= 0) continue;
      const collected = Math.max(0, (a[item] || 0) - (b[item] || 0));
      const shortfall = expected - collected;
      if (shortfall > 0) dropped.push({ item, qty: shortfall });
    }
    dropped.sort((x, y) => x.item.localeCompare(y.item));
  }

  return { gained, lost, dropped };
}

module.exports = { applyObserve, diffInventory, _qty };
