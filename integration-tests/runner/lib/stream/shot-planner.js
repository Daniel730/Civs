const MODES = Object.freeze([
  'follow',
  'orbit',
  'wide',
  'exploration',
  'overhead',
  'poi',
  'event',
  'idle',
]);

const DEFAULTS = Object.freeze({
  minDurationMs: 12_000,
  maxDurationMs: 45_000,
  cooldownMs: 90_000,
  historyLimit: 24,
  eventPriorityBoost: 3,
});

class ShotPlanner {
  /**
   * @param {Partial<typeof DEFAULTS>} [opts]
   */
  constructor(opts = {}) {
    this.opts = { ...DEFAULTS, ...opts };
    /** @type {{ mode: string, at: number, reason?: string }[]} */
    this.history = [];
    /** @type {Map<string, number>} */
    this.lastUsed = new Map();
    this.current = null;
    this._rng = typeof opts.rng === 'function' ? opts.rng : Math.random;
  }

  /** @returns {readonly string[]} */
  static get modes() {
    return MODES;
  }

  /**
   * @param {{ mode?: string, event?: boolean, now?: number, force?: boolean }} [req]
   */
  nextShot(req = {}) {
    const now = req.now ?? Date.now();
    if (req.force && req.mode) {
      return this._commit(req.mode, now, req.event ? 'event_force' : 'force');
    }

    if (this.current) {
      const elapsed = now - this.current.startedAt;
      const minOk = elapsed >= this.opts.minDurationMs;
      const maxHit = elapsed >= this.opts.maxDurationMs;
      if (!req.event && !maxHit && (!minOk || this._rng() > 0.35)) {
        return { ...this.current, reused: true };
      }
      if (req.event && !minOk && elapsed < this.opts.minDurationMs / 2) {
        // allow early cut only for strong events after half-min
      } else if (req.event && elapsed < this.opts.minDurationMs / 3) {
        return { ...this.current, reused: true, reason: 'event_too_soon' };
      }
    }

    const candidates = MODES.filter((m) => {
      if (req.mode && m !== req.mode) return false;
      const last = this.lastUsed.get(m) ?? 0;
      if (now - last < this.opts.cooldownMs && m !== 'event' && !req.event) return false;
      if (this.current && this.current.mode === m && !req.event) return false;
      return true;
    });

    let pool = candidates.length ? candidates : [...MODES];
    if (req.event) {
      const preferred = ['event', 'follow', 'orbit'].filter((m) => pool.includes(m));
      if (preferred.length) pool = preferred;
    } else if (!req.mode) {
      // diversity: prefer least-recent
      pool = [...pool].sort((a, b) => (this.lastUsed.get(a) ?? 0) - (this.lastUsed.get(b) ?? 0));
      const top = pool.slice(0, Math.min(4, pool.length));
      pool = top;
    }

    const idx = Math.floor(this._rng() * pool.length);
    const mode = req.mode && MODES.includes(req.mode) ? req.mode : pool[idx];
    return this._commit(mode, now, req.event ? 'event' : 'plan');
  }

  /**
   * Camera offsets for deterministic fallback (world coords relative to target).
   * @param {string} mode
   * @param {{ x: number, y: number, z: number }} target
   * @param {number} [angle]
   */
  poseFor(mode, target, angle = 0) {
    const t = target || { x: 0, y: 80, z: 0 };
    switch (mode) {
      case 'follow':
        return { kind: 'spectate', target: t };
      case 'orbit':
        return {
          kind: 'teleport_look',
          x: t.x + Math.cos(angle) * 12,
          y: t.y + 6,
          z: t.z + Math.sin(angle) * 12,
          lookX: t.x,
          lookY: t.y + 1,
          lookZ: t.z,
        };
      case 'wide':
        return {
          kind: 'teleport_look',
          x: t.x + 28,
          y: t.y + 14,
          z: t.z + 28,
          lookX: t.x,
          lookY: t.y + 2,
          lookZ: t.z,
        };
      case 'exploration':
        return {
          kind: 'teleport_look',
          x: t.x + Math.cos(angle) * 18,
          y: t.y + 4,
          z: t.z + Math.sin(angle) * 18,
          lookX: t.x + Math.cos(angle + 1) * 8,
          lookY: t.y + 1,
          lookZ: t.z + Math.sin(angle + 1) * 8,
        };
      case 'overhead':
        return {
          kind: 'teleport_look',
          x: t.x + 0.5,
          y: t.y + 32,
          z: t.z + 0.5,
          lookX: t.x,
          lookY: t.y,
          lookZ: t.z,
        };
      case 'poi':
      case 'event':
        return {
          kind: 'teleport_look',
          x: t.x + 8,
          y: t.y + 5,
          z: t.z + 8,
          lookX: t.x,
          lookY: t.y + 1,
          lookZ: t.z,
        };
      default:
        return {
          kind: 'teleport_look',
          x: t.x + 10,
          y: t.y + 8,
          z: t.z - 10,
          lookX: t.x,
          lookY: t.y + 1,
          lookZ: t.z,
        };
    }
  }

  _commit(mode, now, reason) {
    const durationMs =
      this.opts.minDurationMs +
      Math.floor(this._rng() * (this.opts.maxDurationMs - this.opts.minDurationMs));
    const shot = {
      mode,
      startedAt: now,
      durationMs,
      reason,
      reused: false,
    };
    this.current = shot;
    this.lastUsed.set(mode, now);
    this.history.push({ mode, at: now, reason });
    if (this.history.length > this.opts.historyLimit) {
      this.history.splice(0, this.history.length - this.opts.historyLimit);
    }
    return shot;
  }

  snapshot() {
    return {
      current: this.current,
      history: [...this.history],
      lastUsed: Object.fromEntries(this.lastUsed),
    };
  }
}

module.exports = { ShotPlanner, MODES, DEFAULTS };
