'use strict';
/**
 * Structured capability client for CivsTestHarness `/test act` and `/test observe`.
 * Never invents success — parses TEST-RESULT json= payloads from the server.
 */
class Capabilities {
  /**
   * @param {{ raw: (cmd: string) => Promise<string>, _json?: Function }} harness
   */
  constructor(harness) {
    this.harness = harness;
  }

  async _parse(line) {
    const raw = String(line || '').trim();
    const idx = raw.indexOf('json=');
    if (idx < 0) {
      return { success: false, action: null, target: null, duration_ms: 0, reason: 'bad_reply', data: {}, _raw: raw };
    }
    try {
      const obj = JSON.parse(raw.slice(idx + 5));
      obj._raw = raw;
      return obj;
    } catch (e) {
      return { success: false, action: null, target: null, duration_ms: 0, reason: 'json_parse:' + e.message, data: {}, _raw: raw };
    }
  }

  act(player, action, ...args) {
    const cmd = ['test', 'act', player, action, ...args].join(' ');
    return this.harness.raw(cmd).then((line) => this._parse(line));
  }

  observe(player) {
    return this.harness.raw(`test observe ${player}`).then((line) => this._parse(line));
  }

  teleport(player, x, y, z, yaw, pitch) {
    const args = [x, y, z];
    if (yaw != null && pitch != null) args.push(yaw, pitch);
    return this.act(player, 'teleport', ...args);
  }
  look(player, yaw, pitch) { return this.act(player, 'look', yaw, pitch); }
  lookAt(player, x, y, z) { return this.act(player, 'look_at', x, y, z); }
  sneak(player, on) { return this.act(player, 'sneak', on ? 'on' : 'off'); }
  sprint(player, on) { return this.act(player, 'sprint', on ? 'on' : 'off'); }
  jump(player) { return this.act(player, 'jump'); }
  swing(player) { return this.act(player, 'swing'); }
  breakBlock(player, x, y, z, world) {
    return this.act(player, 'break_block', x, y, z, ...(world ? [world] : []));
  }
  placeBlock(player, x, y, z, material, world) {
    return this.act(player, 'place_block', x, y, z, material, ...(world ? [world] : []));
  }
  attackNearest(player, entityType) {
    return this.act(player, 'attack', 'nearest', ...(entityType ? [entityType] : []));
  }
  attackUuid(player, uuid) { return this.act(player, 'attack', uuid); }
  hotbar(player, slot) { return this.act(player, 'hotbar', slot); }
  giveItem(player, material, amount = 1) { return this.act(player, 'give_item', material, amount); }
  runAs(player, command) { return this.act(player, 'run_as', ...String(command).replace(/^\//, '').split(/\s+/)); }
  gameMode(player, mode) { return this.act(player, 'game_mode', mode); }
  die(player) { return this.act(player, 'die'); }
  respawn(player) { return this.act(player, 'respawn'); }
  rpgPing() { return this.harness.raw('test rpg ping').then((line) => this._parse(line)); }
  rpgObserve(player) { return this.harness.raw(`test rpg observe ${player}`).then((line) => this._parse(line)); }
  rpgAbandon(player, questId) {
    return this.harness.raw(`test rpg abandon ${player} ${questId}`).then((line) => this._parse(line));
  }
  rpgAccept(player, questId) {
    return this.harness.raw(`test rpg accept ${player} ${questId}`).then((line) => this._parse(line));
  }
}

module.exports = { Capabilities };
