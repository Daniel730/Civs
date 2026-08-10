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
const fs = require('fs');
const path = require('path');
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { z } = require('zod');
const { Harness } = require('../lib/harness');
const { RawKeepAliveActor } = require('../lib/actor');
const {
  initTelemetry,
  shutdownTelemetry,
  withSpan,
  setSpanAttrs,
  recordResultStatus,
} = require('../lib/telemetry');

// Agent Gateway telemetry — optional; never blocks MCP if exporter down.
initTelemetry({ serviceName: process.env.OTEL_SERVICE_NAME || 'civs-agent-gateway' });

const cfg = {
  rconHost: process.env.RCON_HOST || '127.0.0.1',
  rconPort: parseInt(process.env.RCON_PORT || '25575', 10),
  rconPassword: process.env.RCON_PASSWORD || 'civsqa',
  mcHost: process.env.MC_HOST || '127.0.0.1',
  mcPort: parseInt(process.env.MC_PORT || '25565', 10),
  actorName: process.env.ACTOR_NAME || 'Steve',
  version: process.env.MC_SERVER_MAJOR || '26.1.2',
};

const REPORTS_DIR = process.env.GATEWAY_REPORTS_DIR
  || path.join(__dirname, '..', 'reports');
const TOOL_LOG = path.join(REPORTS_DIR, 'gateway-tools.jsonl');

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

/** Observability: model-facing tool args/results + latency. Never logs secrets. */
function logTool(entry) {
  try {
    fs.mkdirSync(REPORTS_DIR, { recursive: true });
    const row = {
      ts: new Date().toISOString(),
      player: cfg.actorName,
      ...entry,
    };
    fs.appendFileSync(TOOL_LOG, JSON.stringify(row) + '\n');
  } catch (e) {
    console.error('gateway log warn:', e.message);
  }
}

function withToolLog(toolName, args, fn) {
  const t0 = Date.now();
  return withSpan('mcp.tool', {
    'mcp.tool': toolName,
    'agent.role': 'minecraft-qa',
    'agent.id': process.env.AGENT_ID || 'gateway',
    'minecraft.player': cfg.actorName,
  }, async (span) => {
    try {
      const result = await Promise.resolve().then(fn);
      let status = 'UNKNOWN';
      let preview = null;
      try {
        const text = result && result.content && result.content[0] && result.content[0].text;
        const parsed = text ? JSON.parse(text) : null;
        status = (parsed && parsed.status) || status;
        const r = parsed && parsed.result;
        const pos = (r && (r.position || r.pos || r.location))
          || (parsed && (parsed.position || parsed.pos))
          || null;
        const xyz = pos || (r && typeof r.x === 'number' ? { x: r.x, y: r.y, z: r.z } : null);
        preview = parsed && {
          status: parsed.status,
          action: parsed.action,
          reason: parsed.reason || null,
          position: xyz,
          success: r && typeof r.success === 'boolean' ? r.success : undefined,
          final_distance: r && r.final_distance != null ? r.final_distance : undefined,
        };
        if (parsed && parsed.action) {
          setSpanAttrs(span, {
            'minecraft.action': parsed.action,
            'minecraft.capability': parsed.action,
          });
        }
      } catch (_) { /* ignore parse */ }
      recordResultStatus(span, status);
      logTool({
        tool: toolName,
        args: args || {},
        status,
        latency_ms: Date.now() - t0,
        result_preview: preview,
      });
      return result;
    } catch (err) {
      recordResultStatus(span, 'FAIL');
      logTool({
        tool: toolName,
        args: args || {},
        status: 'FAIL',
        latency_ms: Date.now() - t0,
        error: String(err && err.message ? err.message : err),
      });
      throw err;
    }
  });
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
  async () => withToolLog('minecraft_observe', {}, async () => {
    const blocked = await ensureSession();
    if (blocked) return textResult(blocked);
    const r = await harness.cap.observe(cfg.actorName);
    return textResult(fromCap('observe', r));
  }),
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
  async ({ x, y, z, timeout_ms, arrive }) => withToolLog(
    'minecraft_move_to',
    { x, y, z, timeout_ms, arrive },
    async () => {
      const blocked = await ensureSession();
      if (blocked) return textResult(blocked);
      const r = await harness.cap.moveTo(cfg.actorName, x, y, z, timeout_ms ?? 15000, arrive ?? 1.5);
      return textResult(fromCap('move_to', r));
    },
  ),
);

server.tool(
  'minecraft_look',
  'Set player yaw/pitch via Player.setRotation.',
  { yaw: z.number(), pitch: z.number() },
  async ({ yaw, pitch }) => withToolLog('minecraft_look', { yaw, pitch }, async () => {
    const blocked = await ensureSession();
    if (blocked) return textResult(blocked);
    return textResult(fromCap('look', await harness.cap.look(cfg.actorName, yaw, pitch)));
  }),
);

server.tool(
  'minecraft_break_block',
  'Break block via Player.breakBlock (fires BlockBreakEvent).',
  { x: z.number(), y: z.number(), z: z.number() },
  async ({ x, y, z }) => withToolLog('minecraft_break_block', { x, y, z }, async () => {
    const blocked = await ensureSession();
    if (blocked) return textResult(blocked);
    return textResult(fromCap('break_block', await harness.cap.breakBlock(cfg.actorName, x, y, z)));
  }),
);

server.tool(
  'minecraft_place_block',
  'Place block via BlockPlaceEvent + setType (not native client place).',
  { x: z.number(), y: z.number(), z: z.number(), material: z.string() },
  async ({ x, y, z, material }) => withToolLog(
    'minecraft_place_block',
    { x, y, z, material },
    async () => {
      const blocked = await ensureSession();
      if (blocked) return textResult(blocked);
      return textResult(fromCap('place_block', await harness.cap.placeBlock(cfg.actorName, x, y, z, material)));
    },
  ),
);

server.tool(
  'minecraft_attack_nearest',
  'Attack nearest entity of optional type via LivingEntity.attack.',
  { entity_type: z.string().optional() },
  async ({ entity_type }) => withToolLog('minecraft_attack_nearest', { entity_type }, async () => {
    const blocked = await ensureSession();
    if (blocked) return textResult(blocked);
    return textResult(fromCap('attack', await harness.cap.attackNearest(cfg.actorName, entity_type)));
  }),
);

server.tool(
  'minecraft_rpg_observe',
  'Observe RPGServer profile (archetype, active/completed quests) via /test rpg observe.',
  {},
  async () => withToolLog('minecraft_rpg_observe', {}, async () => {
    const blocked = await ensureSession();
    if (blocked) return textResult(blocked);
    return textResult(fromCap('rpg_observe', await harness.cap.rpgObserve(cfg.actorName)));
  }),
);

server.tool(
  'minecraft_rpg_accept',
  'Accept quest via QuestManager.acceptQuest. Returns QuestAcceptResult — NOT performCommand.',
  { quest_id: z.string() },
  async ({ quest_id }) => withToolLog('minecraft_rpg_accept', { quest_id }, async () => {
    const blocked = await ensureSession();
    if (blocked) return textResult(blocked);
    return textResult(fromCap('rpg_accept', await harness.cap.rpgAccept(cfg.actorName, quest_id)));
  }),
);

server.tool(
  'minecraft_rpg_abandon',
  'Abandon quest via QuestManager.abandonQuest (QA setup / free max-active slot).',
  { quest_id: z.string() },
  async ({ quest_id }) => withToolLog('minecraft_rpg_abandon', { quest_id }, async () => {
    const blocked = await ensureSession();
    if (blocked) return textResult(blocked);
    return textResult(fromCap('rpg_abandon', await harness.cap.rpgAbandon(cfg.actorName, quest_id)));
  }),
);

server.tool(
  'minecraft_teleport',
  'Teleport player (Bukkit teleport / tp). Useful for pads; not a substitute for move_to.',
  { x: z.number(), y: z.number(), z: z.number() },
  async ({ x, y, z }) => withToolLog('minecraft_teleport', { x, y, z }, async () => {
    const blocked = await ensureSession();
    if (blocked) return textResult(blocked);
    return textResult(fromCap('teleport', await harness.cap.teleport(cfg.actorName, x, y, z)));
  }),
);

async function main() {
  const transport = new StdioServerTransport();
  await withSpan('gateway.lifecycle', {
    'agent.role': 'minecraft-qa',
    'agent.id': process.env.AGENT_ID || 'gateway',
  }, async (span) => {
    recordResultStatus(span, 'OBSERVED');
    await server.connect(transport);
  });
}

main().catch((e) => {
  // stderr only — stdout is MCP JSON-RPC
  console.error('minecraft-qa mcp gateway failed:', e);
  process.exit(1);
});

process.on('SIGINT', async () => {
  try { if (actor) await actor.disconnect(); } catch (_) {}
  try { if (harness) await harness.close(); } catch (_) {}
  try { await shutdownTelemetry(); } catch (_) {}
  process.exit(0);
});
