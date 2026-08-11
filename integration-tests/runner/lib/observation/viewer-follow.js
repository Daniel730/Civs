/**
 * Continuous Viewer → Cam follow.
 * Vanilla /spectate can drop after teleports/mode changes; re-assert periodically.
 */

class ViewerFollowLoop {
  /**
   * @param {{
   *   harness: import('../harness').Harness,
   *   viewerName?: string,
   *   cameraName?: string,
   *   intervalMs?: number,
   *   onLog?: (entry: object) => void,
   * }} opts
   */
  constructor(opts) {
    this.harness = opts.harness;
    this.viewerName = opts.viewerName || process.env.VIEWER_NAME || 'Viewer';
    this.cameraName = opts.cameraName || process.env.CAMERA_NAME || 'Cam';
    this.intervalMs = opts.intervalMs || 2500;
    this.onLog = typeof opts.onLog === 'function' ? opts.onLog : () => {};
    this._timer = null;
    this.status = 'IDLE';
    this.lastSyncAt = null;
    this.lastResult = null;
    this.reassertCount = 0;
    this.missCount = 0;
  }

  start() {
    if (this._timer) return { status: 'DEGRADED', reason: 'already_running' };
    this.status = 'HEALTHY';
    this._timer = setInterval(() => {
      this.tick().catch((err) => {
        this.status = 'DEGRADED';
        this.onLog({
          status: 'DEGRADED',
          action: 'viewer_follow_error',
          reason: String(err && err.message ? err.message : err),
        });
      });
    }, this.intervalMs);
    this.onLog({
      status: 'PASS',
      action: 'viewer_follow_start',
      viewer: this.viewerName,
      camera: this.cameraName,
      intervalMs: this.intervalMs,
    });
    return { status: 'HEALTHY' };
  }

  stop() {
    if (this._timer) clearInterval(this._timer);
    this._timer = null;
    this.status = 'IDLE';
  }

  async tick() {
    const list = await this.harness.raw('list');
    const online = typeof list === 'string' ? list : String(list || '');
    const viewerOnline = new RegExp(`\\b${escapeReg(this.viewerName)}\\b`).test(online);
    const camOnline = new RegExp(`\\b${escapeReg(this.cameraName)}\\b`).test(online);

    if (!viewerOnline) {
      this.missCount += 1;
      this.status = 'DEGRADED';
      this.lastResult = { status: 'DEGRADED', reason: 'viewer_offline', online };
      // Quiet unless recurring
      if (this.missCount === 1 || this.missCount % 10 === 0) {
        this.onLog({
          status: 'DEGRADED',
          action: 'viewer_follow_miss',
          reason: 'viewer_offline',
          missCount: this.missCount,
        });
      }
      return this.lastResult;
    }

    if (!camOnline) {
      this.status = 'FAILED';
      this.lastResult = { status: 'FAILED', reason: 'camera_offline', online };
      this.onLog({
        status: 'FAILED',
        action: 'viewer_follow_miss',
        reason: 'camera_offline',
      });
      return this.lastResult;
    }

    await this.harness.raw(`op ${this.viewerName}`);
    await this.harness.raw(`gamemode spectator ${this.viewerName}`);
    const spectate = await this.harness.raw(
      `execute as ${this.viewerName} run spectate ${this.cameraName}`
    );
    this.reassertCount += 1;
    this.lastSyncAt = Date.now();
    this.status = 'HEALTHY';
    this.missCount = 0;
    this.lastResult = {
      status: 'PASS',
      tracked: this.cameraName,
      spectate,
      reassertCount: this.reassertCount,
    };
    if (this.reassertCount === 1 || this.reassertCount % 12 === 0) {
      this.onLog({
        status: 'PASS',
        action: 'viewer_follow_sync',
        viewer: this.viewerName,
        camera: this.cameraName,
        reassertCount: this.reassertCount,
        spectate,
      });
    }
    return this.lastResult;
  }

  snapshot() {
    return {
      status: this.status,
      viewer: this.viewerName,
      camera: this.cameraName,
      lastSyncAt: this.lastSyncAt,
      lastResult: this.lastResult,
      reassertCount: this.reassertCount,
      missCount: this.missCount,
    };
  }
}

function escapeReg(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = { ViewerFollowLoop };
