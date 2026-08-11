/**
 * Minimal cinematic camera: second RawKeepAliveActor in spectator mode.
 * Prefer native `/spectate <target>` follow; fall back to teleport+look orbit.
 * Does NOT create a second Minecraft harness — same RCON + protocol actor stack.
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
    this.mode = 'idle'; // idle | spectate | orbit
    this._orbitAngle = 0;
    this._timer = null;
    this.actor = new RawKeepAliveActor({
      host: opts.host || '127.0.0.1',
      port: opts.port || 25565,
      username: this.name,
      version: opts.version || '26.1.2',
      sendCommand: (c) => this.harness.raw(c),
    });
  }

  async start() {
    await this.actor.connect();
    if (!this.actor.available) {
      return { status: 'BLOCKED', reason: this.actor.reason || 'camera_actor_unavailable' };
    }
    await this.harness.raw(`op ${this.name}`);
    await this.harness.raw(`gamemode spectator ${this.name}`);
    // Native entity follow — best watchability for a second client looking at Cam,
    // and for anyone spectating Cam / Steve.
    const spectate = await this.harness.raw(
      `execute as ${this.name} run spectate ${this.targetName}`
    );
    this.mode = 'spectate';
    return {
      status: 'PASS',
      mode: this.mode,
      spectate,
      player: this.name,
      target: this.targetName,
    };
  }

  /** Soft re-attach if Steve reconnects or spectate drops. */
  async ensureFollow() {
    if (!this.actor.available) return { status: 'BLOCKED', reason: 'camera_offline' };
    await this.harness.raw(`gamemode spectator ${this.name}`);
    await this.harness.raw(`execute as ${this.name} run spectate ${this.targetName}`);
    this.mode = 'spectate';
    return { status: 'PASS', mode: this.mode };
  }

  /**
   * Orbit around observed target position (when spectate is unavailable or for cinematic wide shots).
   * Uses verified capabilities: teleport + look_at.
   */
  async orbitTick(ox, oy, oz, radius = 12, height = 6) {
    this._orbitAngle = (this._orbitAngle + 0.18) % (Math.PI * 2);
    const x = ox + Math.cos(this._orbitAngle) * radius;
    const z = oz + Math.sin(this._orbitAngle) * radius;
    const y = oy + height;
    const tp = await this.harness.cap.teleport(this.name, x, y, z);
    const look = await this.harness.cap.lookAt(this.name, ox, oy + 1, oz);
    this.mode = 'orbit';
    return {
      status: tp && tp.success ? 'PASS' : 'FAIL',
      mode: this.mode,
      camera: { x, y, z },
      target: { x: ox, y: oy, z: oz },
      look,
    };
  }

  /** Periodic follow loop (spectate refresh + optional orbit when FORCE_ORBIT=1). */
  startLoop(getTargetPos, intervalMs = 2500) {
    if (this._timer) clearInterval(this._timer);
    this._timer = setInterval(async () => {
      try {
        if (process.env.FORCE_ORBIT === '1' && typeof getTargetPos === 'function') {
          const p = await getTargetPos();
          if (p) await this.orbitTick(p.x, p.y, p.z);
        } else {
          await this.ensureFollow();
        }
      } catch (_) {
        /* keep loop alive */
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
