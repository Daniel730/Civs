/**
 * Deterministic observation director for Cam.
 *
 * Guarantees useful coverage of Steve and Alex (and any extra subjects).
 * Prefers teleport+look near the subject so Viewer→Cam is a single spectate hop
 * (nested /spectate Cam→Steve is unreliable in vanilla clients).
 */

const DEFAULT_SUBJECTS = Object.freeze(['Steve', 'Alex']);

class ObservationDirector {
  /**
   * @param {{
   *   camera: import('../camera').SpectatorCamera,
   *   harness: import('../harness').Harness,
   *   subjects?: string[],
   *   dwellMs?: number,
   *   tickMs?: number,
   *   onLog?: (entry: object) => void,
   *   forceTarget?: string|null,
   *   now?: () => number,
   * }} opts
   */
  constructor(opts) {
    this.camera = opts.camera;
    this.harness = opts.harness;
    this.subjects = [...(opts.subjects || DEFAULT_SUBJECTS)];
    this.dwellMs = opts.dwellMs || 20_000;
    this.tickMs = opts.tickMs || 2000;
    this.onLog = typeof opts.onLog === 'function' ? opts.onLog : () => {};
    this.forceTarget = opts.forceTarget || process.env.CAM_FORCE_TARGET || null;
    this.now = typeof opts.now === 'function' ? opts.now : () => Date.now();

    this._timer = null;
    this._index = 0;
    this._subjectStartedAt = 0;
    this._angle = 0;
    this._focused = new Set();
    this._preferredNext = null;
    this.status = 'IDLE';
    this.lastError = null;
    this.currentSubject = null;
    this.lastSwitch = null;
    this.lastAgentSnapshot = {};
  }

  /** Subjects Cam has successfully focused at least once this run. */
  get focusedSubjects() {
    return [...this._focused];
  }

  start() {
    if (this._timer) return { status: 'DEGRADED', reason: 'already_running' };
    this.status = 'HEALTHY';
    this._subjectStartedAt = this.now();
    this.currentSubject = this._resolveSubject(this.forceTarget || this.subjects[0]);
    this._syncIndex(this.currentSubject);
    this._timer = setInterval(() => {
      this.tick().catch((err) => {
        this.lastError = String(err && err.message ? err.message : err);
        this.status = 'DEGRADED';
        this.onLog({
          status: 'DEGRADED',
          action: 'observation_tick_error',
          reason: this.lastError,
        });
      });
    }, this.tickMs);
    this.onLog({
      status: 'PASS',
      action: 'observation_start',
      subjects: this.subjects,
      dwellMs: this.dwellMs,
      firstSubject: this.currentSubject,
    });
    return { status: 'HEALTHY', subject: this.currentSubject };
  }

  stop() {
    if (this._timer) clearInterval(this._timer);
    this._timer = null;
    this.status = 'IDLE';
  }

  /** Dev/debug: force Cam onto a subject immediately (sticky until clearForce). */
  forceFocus(name, reason = 'force') {
    const subject = this._resolveSubject(name);
    if (!subject) return { status: 'FAIL', reason: 'unknown_subject', name };
    this.forceTarget = subject;
    this._switchTo(subject, reason);
    return { status: 'PASS', subject };
  }

  clearForce() {
    this.forceTarget = null;
  }

  /**
   * Soft bias toward a subject after a work tick.
   * Does not interrupt mid-dwell unless the subject has never been focused
   * or at least half the dwell window has elapsed. Otherwise queues as next.
   */
  biasTo(name, reason = 'work_tick_bias') {
    const subject = this._resolveSubject(name);
    if (!subject) return { status: 'FAIL', reason: 'unknown_subject', name };
    this.forceTarget = null;
    if (subject === this.currentSubject) {
      return { status: 'PASS', subject, switched: false };
    }
    const elapsed = this.now() - this._subjectStartedAt;
    const neverFocused = !this._focused.has(subject);
    const dwellHalf = elapsed >= this.dwellMs / 2;
    if (!neverFocused && !dwellHalf) {
      this._preferredNext = subject;
      this.onLog({
        status: 'PASS',
        action: 'camera_bias_queued',
        subject,
        reason,
        elapsedMs: elapsed,
      });
      return { status: 'PASS', subject, switched: false, queued: true };
    }
    this._switchTo(subject, reason);
    return { status: 'PASS', subject, switched: true };
  }

  async tick() {
    if (!this.camera || !this.camera.actor || !this.camera.actor.available) {
      this.status = 'FAILED';
      return { status: 'FAILED', reason: 'camera_offline' };
    }

    const now = this.now();
    if (this.forceTarget) {
      const forced = this._resolveSubject(this.forceTarget);
      if (forced && forced !== this.currentSubject) {
        this._switchTo(forced, 'force_target');
      }
    } else if (now - this._subjectStartedAt >= this.dwellMs) {
      const preferred = this._preferredNext;
      this._preferredNext = null;
      const next = preferred || this._nextSubject();
      this._switchTo(next, preferred ? 'dwell_preferred' : 'dwell_elapsed');
    }

    const subject = this.currentSubject || this.subjects[0];
    const pos = await this._observeSubject(subject);
    this.lastAgentSnapshot[subject] = {
      at: now,
      online: !!pos,
      position: pos,
    };

    if (!pos) {
      this.status = 'DEGRADED';
      this.onLog({
        status: 'DEGRADED',
        action: 'observation_subject_missing',
        subject,
      });
      // Still advance dwell so we do not stick forever on a missing subject.
      if (now - this._subjectStartedAt >= this.dwellMs / 2) {
        this._switchTo(this._nextSubject(), 'subject_missing');
      }
      return { status: 'DEGRADED', subject, reason: 'subject_offline' };
    }

    this._angle = (this._angle + 0.2) % (Math.PI * 2);
    const tracked = await this.camera.trackNearSubject(subject, pos, this._angle);
    if (tracked && tracked.status === 'PASS') {
      this._focused.add(subject);
      this.status = 'HEALTHY';
    } else {
      this.status = 'DEGRADED';
    }

    // Periodic summary (not every tick spam): every ~10s of dwell
    const elapsed = now - this._subjectStartedAt;
    if (elapsed > 0 && elapsed % 10000 < this.tickMs) {
      this.onLog({
        status: this.status,
        action: 'observation_summary',
        subject,
        position: pos,
        focused: this.focusedSubjects,
        camera: this.camera.snapshot(),
        tracked,
      });
    }

    return {
      status: this.status,
      subject,
      position: pos,
      tracked,
      focused: this.focusedSubjects,
    };
  }

  snapshot() {
    return {
      status: this.status,
      currentSubject: this.currentSubject,
      lastSwitch: this.lastSwitch,
      focused: this.focusedSubjects,
      subjects: this.subjects,
      dwellMs: this.dwellMs,
      forceTarget: this.forceTarget,
      lastError: this.lastError,
      agents: { ...this.lastAgentSnapshot },
      camera: this.camera ? this.camera.snapshot() : null,
    };
  }

  _switchTo(subject, reason) {
    if (!subject) return;
    const prev = this.currentSubject;
    if (prev === subject) {
      // Keep dwell clock; sync index only.
      this._syncIndex(subject);
      return;
    }
    this.currentSubject = subject;
    this._syncIndex(subject);
    this._subjectStartedAt = this.now();
    this.lastSwitch = {
      at: this._subjectStartedAt,
      from: prev,
      to: subject,
      reason,
    };
    if (this.camera && typeof this.camera.setSubject === 'function') {
      this.camera.setSubject(subject);
    }
    this.onLog({
      status: 'PASS',
      action: 'camera_target_switch',
      from: prev,
      to: subject,
      reason,
    });
  }

  _syncIndex(subject) {
    const idx = this.subjects.indexOf(subject);
    if (idx >= 0) this._index = idx;
  }

  _nextSubject() {
    if (!this.subjects.length) return null;
    this._index = (this._index + 1) % this.subjects.length;
    return this.subjects[this._index];
  }

  _resolveSubject(name) {
    if (!name) return null;
    const hit = this.subjects.find((s) => s.toLowerCase() === String(name).toLowerCase());
    return hit || null;
  }

  async _observeSubject(name) {
    try {
      const obs = await this.harness.cap.observe(name);
      if (!obs || !obs.success || !obs.data) return null;
      const x = obs.data.x ?? obs.data.loc_x;
      const y = obs.data.y ?? obs.data.loc_y;
      const z = obs.data.z ?? obs.data.loc_z;
      if ([x, y, z].some((v) => typeof v !== 'number' || Number.isNaN(v))) return null;
      return { x, y, z };
    } catch (_) {
      return null;
    }
  }
}

module.exports = { ObservationDirector, DEFAULT_SUBJECTS };
