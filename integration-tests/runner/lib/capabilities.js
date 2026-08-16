const { withSpan, setSpanAttrs, recordResultStatus } = require('./telemetry');

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
      return {
        success: false,
        action: null,
        target: null,
        duration_ms: 0,
        reason: 'bad_reply',
        data: {},
        _raw: raw,
      };
    }
    try {
      const obj = JSON.parse(raw.slice(idx + 5));
      obj._raw = raw;
      return obj;
    } catch (e) {
      return {
        success: false,
        action: null,
        target: null,
        duration_ms: 0,
        reason: 'json_parse:' + e.message,
        data: {},
        _raw: raw,
      };
    }
  }

  _capSpan(capability, player, action, fn) {
    return withSpan(
      `minecraft.capability.${capability}`,
      {
        'minecraft.capability': capability,
        'minecraft.action': action || capability,
        'minecraft.player': player || undefined,
      },
      async (span) => {
        const result = await fn(span);
        if (result) {
          setSpanAttrs(span, {
            'minecraft.world': result.data && result.data.world,
            'result.reason': result.reason || undefined,
          });
          recordResultStatus(
            span,
            result.success === true
              ? 'PASS'
              : result.reason === 'player_offline'
                ? 'BLOCKED'
                : 'FAIL'
          );
        }
        return result;
      }
    );
  }

  act(player, action, ...args) {
    const cmd = ['test', 'act', player, action, ...args].join(' ');
    return this._capSpan(action, player, action, () =>
      this.harness.raw(cmd).then((line) => this._parse(line))
    );
  }

  observe(player) {
    return this._capSpan('observe', player, 'observe', () =>
      this.harness.raw(`test observe ${player}`).then((line) => this._parse(line))
    );
  }

  teleport(player, x, y, z, yaw, pitch) {
    const args = [x, y, z];
    if (yaw != null && pitch != null) args.push(yaw, pitch);
    return this.act(player, 'teleport', ...args);
  }
  look(player, yaw, pitch) {
    return this.act(player, 'look', yaw, pitch);
  }
  lookAt(player, x, y, z) {
    return this.act(player, 'look_at', x, y, z);
  }
  sneak(player, on) {
    return this.act(player, 'sneak', on ? 'on' : 'off');
  }
  sprint(player, on) {
    return this.act(player, 'sprint', on ? 'on' : 'off');
  }
  jump(player) {
    return this.act(player, 'jump');
  }
  swing(player) {
    return this.act(player, 'swing');
  }
  breakBlock(player, x, y, z, world) {
    return this.act(player, 'break_block', x, y, z, ...(world ? [world] : []));
  }
  placeBlock(player, x, y, z, material, world) {
    return this.act(player, 'place_block', x, y, z, material, ...(world ? [world] : []));
  }
  attackNearest(player, entityType) {
    return this.act(player, 'attack', 'nearest', ...(entityType ? [entityType] : []));
  }
  attackUuid(player, uuid) {
    return this.act(player, 'attack', uuid);
  }
  hotbar(player, slot) {
    return this.act(player, 'hotbar', slot);
  }
  giveItem(player, material, amount = 1) {
      return this.act(player, 'give_item', material, amount);
    }
    craftItem(player, material, amount = 1) {
      return this.act(player, 'craft_item', material, amount);
    }
  runAs(player, command) {
    return this.act(player, 'run_as', ...String(command).replace(/^\//, '').split(/\s+/));
  }
  gameMode(player, mode) {
    return this.act(player, 'game_mode', mode);
  }
  die(player) {
    return this.act(player, 'die');
  }
  respawn(player) {
    return this.act(player, 'respawn');
  }
  step(player, x, y, z, len) {
    if (x === 'forward') return this.act(player, 'step', 'forward', ...(len != null ? [len] : []));
    return this.act(player, 'step', x, y, z, ...(len != null ? [len] : []));
  }
  moveTo(player, x, y, z, timeoutMs, arrive, stepLen) {
    const args = [x, y, z];
    if (timeoutMs != null) args.push(timeoutMs);
    if (arrive != null) args.push(arrive);
    if (stepLen != null) args.push(stepLen);
    // Dedicated span (does not call act() to avoid duplicate capability span).
    return withSpan(
      'minecraft.move_to',
      {
        'minecraft.capability': 'move_to',
        'minecraft.action': 'move_to',
        'minecraft.player': player,
      },
      async (span) => {
        const cmd = ['test', 'act', player, 'move_to', ...args].join(' ');
        const result = await this.harness.raw(cmd).then((line) => this._parse(line));
        if (result && result.data && typeof result.data.final_distance === 'number') {
          setSpanAttrs(span, { 'minecraft.final_distance': result.data.final_distance });
        }
        recordResultStatus(span, result && result.success === true ? 'PASS' : 'FAIL');
        return result;
      }
    );
  }
  rpgPing() {
    return this._capSpan('rpg_ping', null, 'rpg_ping', () =>
      this.harness.raw('test rpg ping').then((line) => this._parse(line))
    );
  }
  rpgObserve(player) {
    return this._capSpan('rpg_observe', player, 'rpg_observe', () =>
      this.harness.raw(`test rpg observe ${player}`).then((line) => this._parse(line))
    );
  }
  rpgAbandon(player, questId) {
    return this._capSpan('rpg_abandon', player, 'rpg_abandon', () =>
      this.harness.raw(`test rpg abandon ${player} ${questId}`).then((line) => this._parse(line))
    );
  }
  rpgAccept(player, questId) {
    return this._capSpan('rpg_accept', player, 'rpg_accept', () =>
      this.harness.raw(`test rpg accept ${player} ${questId}`).then((line) => this._parse(line))
    );
  }
  rpgQuestDetail(player, questId) {
    return this._capSpan('rpg_quest_detail', player, 'rpg_quest_detail', () =>
      this.harness
        .raw(`test rpg quest_detail ${player} ${questId}`)
        .then((line) => this._parse(line))
    );
  }
  rpgNextQuest(player) {
    return this._capSpan('rpg_next_quest', player, 'rpg_next_quest', () =>
      this.harness.raw(`test rpg next_quest ${player}`).then((line) => this._parse(line))
    );
  }
  rpgPois(player, radius) {
    const r = radius == null ? '' : ` ${radius}`;
    return this._capSpan('rpg_pois', player, 'rpg_pois', () =>
      this.harness.raw(`test rpg pois ${player}${r}`).then((line) => this._parse(line))
    );
  }
  findBlock(player, material, radius, max) {
    const args = [material];
    if (radius != null) args.push(radius);
    if (max != null) args.push(max);
    return this.act(player, 'find_block', ...args);
  }
  worldNearby(player, radius) {
    const r = radius == null ? '' : ` ${radius}`;
    return this._capSpan('world_nearby', player, 'world_nearby', () =>
      this.harness.raw(`test world nearby ${player}${r}`).then((line) => this._parse(line))
    );
  }
}

module.exports = { Capabilities };
