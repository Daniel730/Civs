/**
 * Deterministic fallback cinematic when AI Director is unavailable.
 * Drives SpectatorCamera using ShotPlanner — no LLM, no fake intelligence.
 */
'use strict';

const { ShotPlanner } = require('./shot-planner');

class FallbackDirector {
  /**
   * @param {{
   *   camera: import('../camera').SpectatorCamera,
   *   getTargetPos: () => Promise<{x:number,y:number,z:number}|null>,
   *   planner?: ShotPlanner,
   *   intervalMs?: number,
   * }} opts
   */
  constructor(opts) {
    this.camera = opts.camera;
    this.getTargetPos = opts.getTargetPos;
    this.planner = opts.planner || new ShotPlanner();
    this.intervalMs = opts.intervalMs || 2000;
    this._timer = null;
    this._angle = 0;
    this.status = 'IDLE';
    this.lastError = null;
  }

  start() {
    if (this._timer) return { status: 'DEGRADED', reason: 'already_running' };
    this.status = 'HEALTHY';
    this._timer = setInterval(() => {
      this.tick().catch((err) => {
        this.lastError = String(err && err.message ? err.message : err);
        this.status = 'DEGRADED';
      });
    }, this.intervalMs);
    return { status: 'HEALTHY', mode: 'fallback_director' };
  }

  stop() {
    if (this._timer) clearInterval(this._timer);
    this._timer = null;
    this.status = 'IDLE';
  }

  async tick(now = Date.now()) {
    if (!this.camera || !this.camera.actor || !this.camera.actor.available) {
      this.status = 'FAILED';
      return { status: 'FAILED', reason: 'camera_offline' };
    }

    const shot = this.planner.nextShot({ now });
    const target = (await this.getTargetPos()) || { x: 5200, y: 80, z: 5200 };
    this._angle = (this._angle + 0.15) % (Math.PI * 2);
    const pose = this.planner.poseFor(shot.mode, target, this._angle);

    pose.mode = shot.mode;
    const applied = await this.camera.applyPose(
      shot.mode === 'follow' ? { kind: 'spectate' } : pose,
    );
    const ok = applied && applied.status === 'PASS';
    this.status = ok ? 'HEALTHY' : 'DEGRADED';
    return { status: this.status, shot, pose, applied };
  }

  /** Push an event cut (builder placed region, etc.). */
  async onEvent(poi) {
    const now = Date.now();
    const shot = this.planner.nextShot({ now, event: true, mode: poi && poi.mode ? poi.mode : 'event' });
    if (poi && typeof poi.x === 'number') {
      const pose = this.planner.poseFor(shot.mode, poi, this._angle);
      if (pose.kind === 'teleport_look') {
        await this.camera.harness.cap.teleport(this.camera.name, pose.x, pose.y, pose.z);
        await this.camera.harness.cap.lookAt(
          this.camera.name,
          pose.lookX,
          pose.lookY,
          pose.lookZ,
        );
      }
    }
    return { status: this.status, shot };
  }
}

module.exports = { FallbackDirector };
