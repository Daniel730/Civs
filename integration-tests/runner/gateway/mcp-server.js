#!/usr/bin/env node
'use strict';
/**
 * Agent Gateway — MCP stdio server exposing verified Minecraft QA capabilities.
 *
 * FACT: Hermes attaches external tools via `hermes mcp add <name> --command … --args …`
 * (see docs/HERMES-INTEGRATION.md). This process is that command.
 *
 * Does NOT create a second Minecraft client stack. Uses existing Harness + RawKeepAliveActor.
 * Never maps "command accepted" to PASS — returns structured status:
 *   OBSERVED | PASS | FAIL | BLOCKED | UNKNOWN
 */
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { z } = require('zod');
const { Harness } = require('../lib/harness');
const { RawKeepAliveActor } = require('../lib/actor');

const cfg = {
  rconHost: process.env.RCON_HOST || '127.0.0.1',
  rconPort: parseInt(process.env.RCON_PORT || '25575', 10),
  rconPassword: process.env.RCON_PASSWORD || 'civsqa',
  mcHost: process.env.MC_HOST || '127.0.0.1',
  mcPort: parseInt(process.env.MC_PORT || '25565', 10),
  actorName: process.env.ACTOR_NAME || 'Steve',
  version: process.env.MC_SERVER_MAJOR || '26.1.2',
};

let harness = null;
let actor = null;

function envelope(status, action, payload = {}, reason = null) {
  return {
    status, // OBSERVED|PASS|FAIL|BLOCKED|UNKNOWN
    action,
    reason,
    player: cfg.actorName,
    ...payload,
    _lesson: 'success flags from performCommand are insufficient; prefer harness.json.success + state observe',
  };
}

function textResult(obj) {
  return { content: [{ type: 'text', text: JSON.stringify(obj, null, 2) }] };
}

async function ensureSession() {
  if (!harness) {
    harness = new Harness({
      host: cfg.rconHost, port: cfg.rconPort, password: cfg.rconPassword,
    });
    await harness.connect();
    const ping = await harness.ping();
    if (!ping || ping.pong !== '1') {
      throw new Error('harness ping failed: ' + (ping && ping._raw));
    }
  }
  if (!actor || !actor.available) {
    actor = new RawKeepAliveActor({
      host: cfg.mcHost, port: cfg.mcPort, username: cfg.actorName,
      version: cfg.version, sendCommand: (c) => harness.raw(c),
    });
    await actor.connect();
    if (!actor.available) {
      return envelope('BLOCKED', 'session', {}, actor.reason || 'actor_unavailable');
    }
    await actor.grantOp();
  }
  return null;
}

function fromCap(action, result) {
  if (!result) return envelope('UNKNOWN', action, {}, 'no_result');
  if (result.success === true) {
    return envelope('PASS', action, { result }, null);
  }
  const reason = result.reason || 'capability_failed';
  if (reason === 'player_offline') return envelope('BLOCKED', action, { result }, reason);
  return envelope('FAIL', action, { result }, reason);
}

const server = new McpServer({
  name: 'civs-minecraft-qa',
  version: '0.1.0',
});

server.tool(
  'minecraft_observe',
  'Observe online player state (position, health, inventory). Verified via /test observe.',
  {},
  async () => {
    const blocked = await ensureSession();
    if (blocked) return textResult(blocked);
    const r = await harness.cap.observe(cfg.actorName);
    return textResult(fromCap('observe', r));
  },
);

server.tool(
  'minecraft_move_to',
  'Greedy step navigation to x,y,z (NOT Mineflayer pathfinder). Verified open-terrain move_to.',
  {
    x: z.number(),
    y: z.number(),
    z: z.number(),
    timeout_ms: z.number().optional(),
    arrive: z.number().optional(),
  },
  async ({ x, y, z, timeout_ms, arrive }) => {
    const blocked = await ensureSession();
    if (blocked) return textResult(blocked);
    const r = await harness.cap.moveTo(cfg.actorName, x, y, z, timeout_ms ?? 15000, arrive ?? 1.5);
    return textResult(fromCap('move_to', r));
  },
);

server.tool(
  'minecraft_look',
  'Set player yaw/pitch via Player.setRotation.',
  { yaw: z.number(), pitch: z.number() },
  async ({ yaw, pitch }) => {
    const blocked = await ensureSession();
    if (blocked) return textResult(blocked);
    return textResult(fromCap('look', await harness.cap.look(cfg.actorName, yaw, pitch)));
  },
);

server.tool(
  'minecraft_break_block',
  'Break block via Player.breakBlock (fires BlockBreakEvent).',
  { x: z.number(), y: z.number(), z: z.number() },
  async ({ x, y, z }) => {
    const blocked = await ensureSession();
    if (blocked) return textResult(blocked);
    return textResult(fromCap('break_block', await harness.cap.breakBlock(cfg.actorName, x, y, z)));
  },
);

server.tool(
  'minecraft_place_block',
  'Place block via BlockPlaceEvent + setType (not native client place).',
  { x: z.number(), y: z.number(), z: z.number(), material: z.string() },
  async ({ x, y, z, material }) => {
    const blocked = await ensureSession();
    if (blocked) return textResult(blocked);
    return textResult(fromCap('place_block', await harness.cap.placeBlock(cfg.actorName, x, y, z, material)));
  },
);

server.tool(
  'minecraft_attack_nearest',
  'Attack nearest entity of optional type via LivingEntity.attack.',
  { entity_type: z.string().optional() },
  async ({ entity_type }) => {
    const blocked = await ensureSession();
    if (blocked) return textResult(blocked);
    return textResult(fromCap('attack', await harness.cap.attackNearest(cfg.actorName, entity_type)));
  },
);

server.tool(
  'minecraft_rpg_observe',
  'Observe RPGServer profile (archetype, active/completed quests) via /test rpg observe.',
  {},
  async () => {
    const blocked = await ensureSession();
    if (blocked) return textResult(blocked);
    return textResult(fromCap('rpg_observe', await harness.cap.rpgObserve(cfg.actorName)));
  },
);

server.tool(
  'minecraft_rpg_accept',
  'Accept quest via QuestManager.acceptQuest. Returns QuestAcceptResult — NOT performCommand.',
  { quest_id: z.string() },
  async ({ quest_id }) => {
    const blocked = await ensureSession();
    if (blocked) return textResult(blocked);
    return textResult(fromCap('rpg_accept', await harness.cap.rpgAccept(cfg.actorName, quest_id)));
  },
);

server.tool(
  'minecraft_rpg_abandon',
  'Abandon quest via QuestManager.abandonQuest (QA setup / free max-active slot).',
  { quest_id: z.string() },
  async ({ quest_id }) => {
    const blocked = await ensureSession();
    if (blocked) return textResult(blocked);
    return textResult(fromCap('rpg_abandon', await harness.cap.rpgAbandon(cfg.actorName, quest_id)));
  },
);

server.tool(
  'minecraft_teleport',
  'Teleport player (Bukkit teleport / tp). Useful for pads; not a substitute for move_to.',
  { x: z.number(), y: z.number(), z: z.number() },
  async ({ x, y, z }) => {
    const blocked = await ensureSession();
    if (blocked) return textResult(blocked);
    return textResult(fromCap('teleport', await harness.cap.teleport(cfg.actorName, x, y, z)));
  },
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((e) => {
  // stderr only — stdout is MCP JSON-RPC
  console.error('minecraft-qa mcp gateway failed:', e);
  process.exit(1);
});

process.on('SIGINT', async () => {
  try { if (actor) await actor.disconnect(); } catch (_) {}
  try { if (harness) await harness.close(); } catch (_) {}
  process.exit(0);
});
