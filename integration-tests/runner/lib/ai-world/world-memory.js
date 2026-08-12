/**
 * World memory — the agent's spatial/episodic memory of the Minecraft world around it.
 *
 * Why this exists: the worker was a pure reactive script. It re-derived everything from the
 * current observe() payload and forgot it next tick, so it "did not absorb the world". This
 * store lets the agent remember:
 *   - threats seen at a place (mob at x,z) with a TTL, so it can avoid that spot
 *   - blocks of interest it broke / placed (progress map)
 *   - deaths / damage events (so a repeated death location is flagged dangerous)
 * - and exposes compact features that feed encodeState() so chooseFocus sees context, not just
 *   the instantaneous observation.
 *
 * Pure, in-memory + optional JSONL append for offline analysis. No RCON, no async — callers
 * decide when to flush. Unit-testable.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

function nowMs() {
  return Date.now();
}

function dist2D(a, b) {
  const dx = (a.x ?? 0) - (b.x ?? 0);
  const dz = (a.z ?? 0) - (b.z ?? 0);
  return Math.sqrt(dx * dx + dz * dz);
}

class WorldMemory {
  /**
   * @param {{ ttlMs?: number, dir?: string, agentId?: string }} opts
   */
  constructor(opts = {}) {
    this.ttlMs = opts.ttlMs || 60000; // threat memories expire after 60s by default
    this.agentId = opts.agentId || 'agent';
    this.dir = opts.dir || null;
    this.threats = []; // { x, z, type, at, severity }
    this.events = []; // { kind, x, z, at, meta }
    this.placed = new Map(); // "x,z" -> count (blocks placed)
    this.broken = new Map(); // "x,z" -> count (blocks broken)
    this._cleanAt = 0;
  }

  _clean() {
    const t = nowMs();
    if (t - this._cleanAt < this.ttlMs / 4) return;
    this._cleanAt = t;
    const cut = t - this.ttlMs;
    this.threats = this.threats.filter((e) => e.at >= cut);
    this.events = this.events.filter((e) => e.at >= cut);
  }

  /**
   * Record a hostile entity observed near the agent.
   * @param {{x?:number,z?:number,type?:string,distance?:number,severity?:number}} h
   */
  noteThreat(h = {}) {
    this._clean();
    this.threats.push({
      x: h.x != null ? h.x : null,
      z: h.z != null ? h.z : null,
      type: h.type || 'unknown',
      distance: h.distance != null ? h.distance : null,
      severity: h.severity != null ? h.severity : 1,
      at: nowMs(),
    });
    this.events.push({ kind: 'threat', x: h.x, z: h.z, at: nowMs(), meta: { type: h.type } });
  }

  noteEvent(kind, pos = {}, meta = {}) {
    this._clean();
    this.events.push({ kind, x: pos.x != null ? pos.x : null, z: pos.z != null ? pos.z : null, at: nowMs(), meta });
    if (kind === 'death' || kind === 'damage') {
      this.threats.push({ x: pos.x != null ? pos.x : null, z: pos.z != null ? pos.z : null, type: 'death_zone', severity: 3, at: nowMs() });
    }
  }

  noteBlock(kind, x, z) {
    const key = `${Math.floor(x)},${Math.floor(z)}`;
    const m = kind === 'placed' ? this.placed : this.broken;
    m.set(key, (m.get(key) || 0) + 1);
  }

  /**
   * Compact features for encodeState().
   * @param {{x?:number,z?:number}} pos agent position
   */
  features(pos = {}) {
    this._clean();
    let nearestThreatDist = null;
    let threatSeen = false;
    let dangerZone = false;
    for (const t of this.threats) {
      if (t.x == null || t.z == null) continue;
      const d = dist2D(pos, t);
      if (nearestThreatDist == null || d < nearestThreatDist) nearestThreatDist = d;
      threatSeen = true;
      if (d < 12) dangerZone = true; // a remembered threat within 12 blocks
    }
    return {
      nearestThreatDist: nearestThreatDist == null ? -1 : Math.round(nearestThreatDist * 10) / 10,
      threatSeen: threatSeen ? 1 : 0,
      dangerZone: dangerZone ? 1 : 0,
      threatsRemembered: this.threats.length,
      blocksPlaced: this.placed.size,
      blocksBroken: this.broken.size,
    };
  }

  /** Persist events to JSONL (best-effort, for offline analysis). */
  flush() {
    if (!this.dir) return;
    try {
      const f = path.join(this.dir, `world-memory-${this.agentId}.jsonl`);
      const lines = this.events.map((e) => JSON.stringify({ ...e, agent: this.agentId }));
      if (lines.length) fs.appendFileSync(f, lines.join('\n') + '\n');
      this.events = [];
    } catch (_) {
      /* best-effort */
    }
  }
}

module.exports = { WorldMemory };
