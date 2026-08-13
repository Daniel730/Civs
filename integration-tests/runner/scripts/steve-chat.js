/**
 * steve-chat.js — standalone text channel for Steve on the QA server.
 *
 * Runs as its own process (does not touch village-worker.js, which the other agent
 * owns). Reads lines "Steve: <msg>" from CHAT_IN_FILE, asks the local Ollama brain,
 * and sends Steve's reply back in-game via `tell Steve <reply>`.
 *
 * Usage:
 *   AIWORLD_CHAT_FILE=/tmp/steve-chat.txt node scripts/steve-chat.js
 * Then drop a line into the file (e.g. from a wrapper that maps your in-game say to it).
 */
const path = require('path');
const ROOT = __dirname + '/..';
const { Harness } = require(ROOT + '/lib/harness');
const { startChatListener } = require(ROOT + '/lib/ai-world/chat-listener');

const chatFile = process.env.AIWORLD_CHAT_FILE || '/tmp/steve-chat.txt';
const harness = new Harness({
  host: process.env.MC_HOST || '127.0.0.1',
  port: Number(process.env.MC_RCON_PORT || 25575),
  password: process.env.MC_RCON_PW || 'civsqa',
});

(async () => {
  await harness.connect();
  const ping = await harness.ping();
  if (!ping || ping.pong !== '1') {
    console.log('Harness RCON unavailable — cannot send replies.');
    process.exit(1);
  }
  console.log('[steve-chat] RCON connected. Listening on', chatFile);
  // useSay=true => Steve replies via `say Steve: <reply>` (broadcast, visible to all players
  // in chat). tell Steve would send the reply only to Steve himself (invisible to Dan).
  startChatListener({ harness, chatInFile: chatFile, actorName: 'Steve', pollMs: 500, useSay: true });
})().catch((e) => {
  console.log('[steve-chat] fatal:', e && e.message);
  process.exit(1);
});
