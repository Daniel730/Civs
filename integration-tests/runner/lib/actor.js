'use strict';
/**
 * Actor layer — performs PLAYER ACTIONS that exercise Civs production code. This is kept
 * strictly separate from the observation harness: the actor *acts*, the harness *observes*.
 *
 * RawKeepAliveActor: a raw `minecraft-protocol` client that stays online as a real Player,
 * so server commands that target it run the real production pipeline with a real Player
 * object (e.g. `/cv placeregion <name> <type>` -> RegionManager.createRegionFromPlacement
 * -> RegionCreatedEvent -> listeners). It works on Paper 26.1.2 (mineflayer's high-level API
 * does not — see docs). On real ≤1.21.x servers, swap in the Mineflayer actor for true
 * block-place / GUI-click actions (fuller production path).
 *
 * Actions are issued through an injected `sendCommand` (the RCON channel). The actor owns the
 * player *identity and presence*; it never creates Civs game state directly.
 */
class RawKeepAliveActor {
  constructor({ host = '127.0.0.1', port = 25565, username = 'Steve', version = '26.1.2', sendCommand }) {
    this.host = host; this.port = port; this.name = username; this.version = version;
    this.sendCommand = sendCommand; // async (cmd) => responseText  (RCON)
    this.available = false;
    this.client = null;
  }

  connect() {
    let mc;
    try { mc = require('minecraft-protocol'); }
    catch (_) { this.available = false; this.reason = 'minecraft-protocol not installed'; return Promise.resolve(this); }
    return new Promise((resolve) => {
      this.client = mc.createClient({
        host: this.host, port: this.port, username: this.name, auth: 'offline',
        version: this.version, keepAlive: true,
      });
      const to = setTimeout(() => { this.available = false; this.reason = 'no login within 15s'; resolve(this); }, 15000);
      this.client.on('login', () => { clearTimeout(to); this.available = true; resolve(this); });
      this.client.on('error', (e) => { clearTimeout(to); this.available = false; this.reason = e.message; resolve(this); });
      this.client.on('end', () => { this.available = false; });
    });
  }

  /** Run an arbitrary command in the player's context (production sender path). */
  async runCommand(cmd) {
    const c = cmd.replace(/^\//, '');
    return this.sendCommand(`execute as ${this.name} at ${this.name} run ${c}`);
  }

  /** Place a Civs region as this player — hits the real region-creation pipeline. */
  async placeRegion(type, x, y, z) {
    return this.sendCommand(`cv placeregion ${this.name} ${type} ${x} ${y} ${z}`);
  }
  /** Receive a Civs item through the real item pipeline. */
  async give(item, qty = 1) { return this.sendCommand(`cv give ${this.name} ${item} ${qty}`); }
  async teleport(x, y, z) { return this.sendCommand(`tp ${this.name} ${x} ${y} ${z}`); }
  /** Ensure the actor can use admin QA actions (OP grants civs.admin). */
  async grantOp() { return this.sendCommand(`op ${this.name}`); }

  async disconnect() { try { if (this.client) this.client.end(); } catch (_) {} }
}

module.exports = { RawKeepAliveActor };
