'use strict';
/**
 * Spatial grid extension for WorldMemory — the Steve's "mirror of the world" around him.
 *
 * The base WorldMemory (from @daniel730/aiworld) tracks threats/deaths/placed/broken but
 * NOT spatial cells. This extension adds a 2D grid of cells with TTL:
 *   - cellKey = "x,z" -> { y, material, lastSeen, tick }
 *   - noteCell(x, y, z, material, tick) records what the agent saw
 *   - getCell(x, z) returns cached material if recent, null if stale/missing
 *   - nearbyCells(pos, radius) returns the cells within radius
 *   - features(pos) is overridden to also include cell-block counts so the brain / craft
 *     layer can decide based on world state (e.g. "is there wood nearby?")
 *
 * Cells are 1×1 m at integer xz. The agent's observation radius defaults to 6 blocks but is
 * configurable via opts.visionRadius. Cells older than ttlMs are dropped and the agent should
 * re-observe them via RCON batch queries.
 */

const { WorldMemory } = require('@daniel730/aiworld/world-memory');

class SpatialWorldMemory extends WorldMemory {
  constructor(opts = {}) {
    super(opts);
    this.visionRadius = opts.visionRadius || 6;
    this.cellTtlMs = opts.cellTtlMs || 30000; // cells expire after 30s
    this.maxCells = opts.maxCells || 1024; // hard cap so memory can't grow unbounded
    this.cells = new Map(); // cellKey -> { x, z, y, material, lastSeen, tick }
    this.cellStats = {
      observed: 0,
      hits: 0,    // queries served from cache
      misses: 0,  // queries that fell through (stale / not seen)
      evictions: 0,
    };
  }

  /**
   * Record what the agent saw at (x, y, z).
   * @param {number} x integer x
   * @param {number} y integer y
   * @param {number} z integer z
   * @param {string|null} material bare id e.g. 'oak_log', or null if air
   * @param {number} [tick] work tick (for staleness comparisons)
   */
  noteCell(x, y, z, material, tick = 0) {
    if (!Number.isFinite(x) || !Number.isFinite(z)) return;
    const key = `${Math.floor(x)},${Math.floor(z)}`;
    this.cells.set(key, {
      x: Math.floor(x),
      z: Math.floor(z),
      y: Number.isFinite(y) ? Math.floor(y) : null,
      material: material || 'air',
      lastSeen: Date.now(),
      tick: tick || 0,
    });
    this.cellStats.observed += 1;
    // Bounded size — drop oldest if over cap (FIFO by lastSeen)
    if (this.cells.size > this.maxCells) {
      const overflow = this.cells.size - this.maxCells;
      const sorted = [...this.cells.entries()].sort((a, b) => a[1].lastSeen - b[1].lastSeen);
      for (let i = 0; i < overflow; i++) {
        this.cells.delete(sorted[i][0]);
        this.cellStats.evictions += 1;
      }
    }
  }

  /**
   * Query a cell. Returns { y, material, lastSeen, tick } if known AND fresh, else null.
   * @param {number} x
   * @param {number} z
   * @returns {{y:number|null,material:string,lastSeen:number,tick:number}|null}
   */
  getCell(x, z) {
    if (!Number.isFinite(x) || !Number.isFinite(z)) return null;
    const key = `${Math.floor(x)},${Math.floor(z)}`;
    const c = this.cells.get(key);
    if (!c) {
      this.cellStats.misses += 1;
      return null;
    }
    const age = Date.now() - c.lastSeen;
    if (age > this.cellTtlMs) {
      this.cellStats.misses += 1;
      return null; // stale — caller should re-observe
    }
    this.cellStats.hits += 1;
    return c;
  }

  /**
   * Cells within `radius` blocks of pos, returned as a flat array (only fresh ones).
   * Useful for "what do I see around me right now" prompts.
   * @param {{x:number,z:number}} pos
   * @param {number} [radius]
   */
  nearbyCells(pos, radius) {
    if (!pos || !Number.isFinite(pos.x) || !Number.isFinite(pos.z)) return [];
    const r = radius || this.visionRadius;
    const out = [];
    for (const c of this.cells.values()) {
      const dx = c.x - Math.floor(pos.x);
      const dz = c.z - Math.floor(pos.z);
      if (Math.abs(dx) <= r && Math.abs(dz) <= r) {
        const age = Date.now() - c.lastSeen;
        if (age <= this.cellTtlMs) out.push(c);
      }
    }
    return out;
  }

  /**
   * Aggregate counts of cell materials within `radius`. Returns { oak_log: 4, stone: 12, ... }.
   * Useful for craft decisions: "have I seen enough wood nearby to build?"
   */
  materialCountsInRadius(pos, radius, opts = {}) {
    const cells = this.nearbyCells(pos, radius);
    const out = {};
    const topOnly = opts.topOnly === true;
    for (const c of cells) {
      // If the cell is air / unknown, skip unless we want surface counts.
      if (!topOnly && c.y == null) continue;
      out[c.material] = (out[c.material] || 0) + 1;
    }
    return out;
  }

  /**
   * Override features() to also include the spatial snapshot for chooseFocus / craft.
   */
  features(pos = {}) {
    const base = super.features(pos);
    const radius = this.visionRadius;
    const cells = this.nearbyCells(pos, radius);
    const blocksObserved = cells.length;
    const materialCounts = {};
    for (const c of cells) {
      materialCounts[c.material] = (materialCounts[c.material] || 0) + 1;
    }
    // Sorted top 6 materials — small enough to fit in an Ollama prompt without overwhelming it.
    const topMaterials = Object.entries(materialCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([m, c]) => `${m}:${c}`)
      .join(',');
    return {
      ...base,
      // Spatial-grid additions
      visionRadius: radius,
      blocksObserved,
      topMaterials: topMaterials || null,
      cellHits: this.cellStats.hits,
      cellMisses: this.cellStats.misses,
      cellsTracked: this.cells.size,
    };
  }

  /**
   * Drop cells that are older than cellTtlMs. Called by _clean() implicitly via the parent
   * class' TTL cycle (it doesn't know about our cells map, so we expose a manual sweep).
   */
  evictStaleCells() {
    const cut = Date.now() - this.cellTtlMs;
    let evicted = 0;
    for (const [key, c] of this.cells) {
      if (c.lastSeen < cut) {
        this.cells.delete(key);
        evicted += 1;
      }
    }
    this.cellStats.evictions += evicted;
    return evicted;
  }

  /**
   * Persist cells to the JSONL alongside world-memory events so reloading can rebuild the
   * grid after a worker restart.
   */
  flush() {
    super.flush();
    if (!this.dir) return;
    try {
      const fs = require('fs');
      const path = require('path');
      const f = path.join(this.dir, `spatial-cells-${this.agentId}.jsonl`);
      const lines = [...this.cells.entries()].map(([k, c]) =>
        JSON.stringify({ agent: this.agentId, kind: 'cell', ...c, key: k })
      );
      if (lines.length) fs.appendFileSync(f, lines.join('\n') + '\n');
    } catch (_) { /* best-effort */ }
  }
}

module.exports = { SpatialWorldMemory };