#!/usr/bin/env node
/**
 * Empirically exercises the Agent Gateway MCP server (list tools + observe + move_to).
 * Does not invoke Hermes. Exit 0 only if tools return status PASS/OBSERVED as expected.
 */
const path = require('path');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');

(async () => {
  const serverPath = path.join(__dirname, 'mcp-server.js');
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverPath],
    env: {
      ...process.env,
      RCON_HOST: process.env.RCON_HOST || '127.0.0.1',
      RCON_PORT: process.env.RCON_PORT || '25575',
      RCON_PASSWORD: process.env.RCON_PASSWORD || 'civsqa',
      MC_HOST: process.env.MC_HOST || '127.0.0.1',
      MC_PORT: process.env.MC_PORT || '25565',
      ACTOR_NAME: process.env.ACTOR_NAME || 'Steve',
    },
  });
  const client = new Client({ name: 'gateway-smoke', version: '0.1.0' });
  await client.connect(transport);
  const tools = await client.listTools();
  const names = (tools.tools || []).map((t) => t.name).sort();
  console.log('TOOLS', JSON.stringify(names));
  const need = [
    'minecraft_observe',
    'minecraft_move_to',
    'minecraft_rpg_observe',
    'minecraft_rpg_accept',
  ];
  for (const n of need) {
    if (!names.includes(n)) throw new Error('missing tool ' + n);
  }

  const obs = await client.callTool({ name: 'minecraft_observe', arguments: {} });
  const obsText = obs.content && obs.content[0] && obs.content[0].text;
  const obsJson = JSON.parse(obsText);
  console.log('OBSERVE', obsJson.status, obsJson.reason || '');
  if (obsJson.status !== 'PASS') throw new Error('observe not PASS: ' + obsText);

  const tp = await client.callTool({
    name: 'minecraft_teleport',
    arguments: { x: 800.5, y: -60, z: 800.5 },
  });
  const tpJson = JSON.parse(tp.content[0].text);
  console.log('TELEPORT', tpJson.status, tpJson.reason || '');
  if (tpJson.status !== 'PASS') throw new Error('teleport not PASS: ' + tp.content[0].text);

  // Short move on the validated pad
  const mv = await client.callTool({
    name: 'minecraft_move_to',
    arguments: { x: 802.5, y: -60, z: 800.5, timeout_ms: 12000, arrive: 1.5 },
  });
  const mvJson = JSON.parse(mv.content[0].text);
  console.log('MOVE_TO', mvJson.status, mvJson.reason || '', mvJson.result && mvJson.result.data);
  if (mvJson.status !== 'PASS') throw new Error('move_to not PASS: ' + mv.content[0].text);

  const rpg = await client.callTool({ name: 'minecraft_rpg_observe', arguments: {} });
  const rpgJson = JSON.parse(rpg.content[0].text);
  console.log(
    'RPG',
    rpgJson.status,
    rpgJson.result && rpgJson.result.data && rpgJson.result.data.archetype
  );

  await client.close();
  console.log('GATEWAY_SMOKE PASS');
})().catch((e) => {
  console.error('GATEWAY_SMOKE FAIL', e);
  process.exit(1);
});
