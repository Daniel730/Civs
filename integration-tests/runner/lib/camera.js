/**
 * Minimal cinematic camera: second RawKeepAliveActor in spectator mode.
 *
 * Design (FACT after 2026-08-11 investigation):
 * - Nested `/spectate Viewer→Cam→Steve` is unreliable for continuous watching.
 * - Cam should be a free spectator near the subject (teleport+look).
 * - Viewer continuously re-asserts `/spectate Cam` (see ViewerFollowLoop).
 * - Subject selection (Steve/Alex) is owned by ObservationDirector.
 */
const { RawKeepAliveActor } = require('./actor');

class SpectatorCamera {
  /**
   * @param {{ harness: import('./harness').Harness, host?: string, port?: number, name?: string, version?: string, targetName?: string }} opts
   */
  constructor(opts) {
    this.harness = opts.harness;
    this.name = opts.name || 'Cam';
    this.targetName = opts.targetName || 'Steve';
    this.mode = 'idle'; // idle | spectate | track | orbit
    this._orbitAngle = 0;
    this._timer = null;
    this.lastPose = null;
    this.lastTrackAt = null;
    this.lastError = null;
    this.actor = new RawKeepAliveActor({
      host: opts.host || '127.0.0.1',
      port: opts.port || 25565,
      username: this.name,
      version: opts.version || '26.1.2',
      sendCommand: (c) => this.harness.raw(c),
    });
  }

  setSubject(name) {
    if (name) this.targetName = name;
    return this.targetName;
  }

  snapshot() {
    return {
      name: this.name,
      subject: this.targetName,
      mode: this.mode,
      online: !!(this.actor && this.actor.available),
      lastPose: this.lastPose,
      lastTrackAt: this.lastTrackAt,
      lastError: this.lastError,
    };
  }

  async start() {
    await this.actor.connect();
    if (!this.actor.available) {
      return { status: 'BLOCKED', reason: this.actor.reason || 'camera_actor_unavailable' };
    }
    await this.harness.raw(`op ${this.name}`);
    await this.harness.raw(`gamemode spectator ${this.name}`);
    // Clear any prior nested spectate so Cam is a free camera entity.
    try {
      await this.harness.raw(`execute as ${this.name} run spectate`);
    } catch (_) {}
    this.mode = 'idle';
    return {
      status: 'PASS',
      mode: this.mode,
      player: this.name,
      subject: this.targetName,
    };
  }

  /**
   * Track near a living subject via teleport+look (preferred for Viewer observability).
   * @param {string} subject
   * @param {{x:number,y:number,z:number}} pos
   * @param {number} [angle]
   */
  async trackNearSubject(subject, pos, angle = 0) {
    if (!this.actor.available) {
      return { status: 'BLOCKED', reason: 'camera_offline' };
    }
    if (!pos) return { status: 'FAIL', reason: 'no_position' };
    this.setSubject(subject);
    await this.harness.raw(`gamemode spectator ${this.name}`);
    // Ensure Cam is not nested-spectating someone else.
    try {
      await this.harness.raw(`execute as ${this.name} run spectate`);
    } catch (_) {}

    const radius = 8;
    const height = 4;
    const x = pos.x + Math.cos(angle) * radius;
    const y = pos.y + height;
    const z = pos.z + Math.sin(angle) * radius;
    const tp = await this.harness.cap.teleport(this.name, x, y, z);
    const look = await this.harness.cap.lookAt(this.name, pos.x, pos.y + 1.2, pos.z);
    const ok = !!(tp && tp.success);
    this.mode = 'track';
    this.lastPose = {
      kind: 'teleport_look',
      x,
      y,
      z,
      lookX: pos.x,
      lookY: pos.y + 1.2,
      lookZ: pos.z,
    };
    this.lastTrackAt = Date.now();
    this.lastError = ok ? null : 'teleport_failed';
    return {
      status: ok ? 'PASS' : 'FAIL',
      mode: this.mode,
      subject,
      camera: { x, y, z },
      target: pos,
      tp,
      look,
    };
  }

  /** Soft re-attach entity spectate (legacy). Prefer trackNearSubject for viewing. */
  async ensureFollow() {
    if (!this.actor.available) return { status: 'BLOCKED', reason: 'camera_offline' };
    await this.harness.raw(`gamemode spectator ${this.name}`);
    await this.harness.raw(`execute as ${this.name} run spectate ${this.targetName}`);
    this.mode = 'spectate';
    this.lastTrackAt = Date.now();
    return { status: 'PASS', mode: this.mode, subject: this.targetName };
  }

  /**
   * Apply a deterministic pose from ShotPlanner / FallbackDirector.
   * pose.kind: 'spectate' | 'teleport_look'
   */
  async applyPose(pose) {
    if (!this.actor.available) return { status: 'BLOCKED', reason: 'camera_offline' };
    if (!pose || pose.kind === 'spectate') {
      // Do not nest-spectate for production viewing; track last known subject if possible.
      return this.ensureFollow();
    }
    try {
      await this.harness.raw(`execute as ${this.name} run spectate`);
    } catch (_) {}
    const tp = await this.harness.cap.teleport(this.name, pose.x, pose.y, pose.z);
    const look = await this.harness.cap.lookAt(this.name, pose.lookX, pose.lookY, pose.lookZ);
    this.mode = pose.mode || 'teleport_look';
    this.lastPose = pose;
    this.lastTrackAt = Date.now();
    return {
      status: tp && tp.success ? 'PASS' : 'FAIL',
      mode: this.mode,
      tp,
      look,
    };
  }

  async orbitTick(ox, oy, oz, radius = 12, height = 6) {
    this._orbitAngle = (this._orbitAngle + 0.18) % (Math.PI * 2);
    const x = ox + Math.cos(this._orbitAngle) * radius;
    const z = oz + Math.sin(this._orbitAngle) * radius;
    const y = oy + height;
    try {
      await this.harness.raw(`execute as ${this.name} run spectate`);
    } catch (_) {}
    const tp = await this.harness.cap.teleport(this.name, x, y, z);
    const look = await this.harness.cap.lookAt(this.name, ox, oy + 1, oz);
    this.mode = 'orbit';
    this.lastPose = { kind: 'teleport_look', x, y, z, lookX: ox, lookY: oy + 1, lookZ: oz };
    this.lastTrackAt = Date.now();
    return {
      status: tp && tp.success ? 'PASS' : 'FAIL',
      mode: this.mode,
      camera: { x, y, z },
      target: { x: ox, y: oy, z: oz },
      look,
    };
  }

  /** Periodic follow loop (legacy). ObservationDirector owns production tracking. */
  startLoop(getTargetPos, intervalMs = 2500) {
    if (this._timer) clearInterval(this._timer);
    this._timer = setInterval(async () => {
      try {
        if (process.env.FORCE_ORBIT === '1' && typeof getTargetPos === 'function') {
          const p = await getTargetPos();
          if (p) await this.orbitTick(p.x, p.y, p.z);
        } else if (typeof getTargetPos === 'function') {
          const p = await getTargetPos();
          if (p) await this.trackNearSubject(this.targetName, p, this._orbitAngle);
          else await this.ensureFollow();
        } else {
          await this.ensureFollow();
        }
      } catch (e) {
        this.lastError = String(e && e.message ? e.message : e);
      }
    }, intervalMs);
  }

  stopLoop() {
    if (this._timer) clearInterval(this._timer);
    this._timer = null;
  }

  async stop() {
    this.stopLoop();
    try {
      await this.harness.raw(`execute as ${this.name} run spectate`);
    } catch (_) {}
    await this.actor.disconnect();
  }
}

module.exports = { SpectatorCamera };
