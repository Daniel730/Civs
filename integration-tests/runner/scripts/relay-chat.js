#!/usr/bin/env node
/**
 * relay-chat.js — bridges in-game player chat to Steve's text channel.
 *
 * The QA server log (logs/latest.log) DOES capture player chat, e Steve already replies
 * via the file-pipe chat-listener (scripts/steve-chat.js reads AIWORLD_CHAT_FILE). This
 * relay tails latest.log, detects when a player addresses Steve (message contains "steve",
 * case-insensitive, and is NOT Steve's own broadcast), and writes "Steve: <msg>" into the
 * chat file so Steve answers in-game. This makes the conversation truly two-way in-game.
 *
 * Runs as its own tmux (relay-chat); does not touch the body worker.
 */
const fs = require('fs');
const path = require('path');
const ROOT = __dirname + '/..';
const { Harness } = require(ROOT + '/lib/harness');

const LOG = process.env.MC_LOG ||
  '/home/dansilva/civs-testserver/logs/latest.log';
const CHAT_FILE = process.env.AIWORLD_CHAT_FILE || '/tmp/steve-chat.txt';
const TAIL_MS = 1000;

// Lines we must NEVER treat as a player addressing Steve (avoid feedback loops / noise).
function isNoise(line) {
  return /\[Steve\]|slain by Steve|Applied effect|Rcon: Applied|was slain|Vindicator|Zombie|Skeleton|Spider|Creeper|Guild Thief/.test(line);
}

// Extract the spoken text from a chat log line, or null if not addressing Steve.
function extractAddress(line) {
  if (!/steve/i.test(line)) return null;
  if (isNoise(line)) return null;
  // Common forms:
  //   <Smokeshow> hey steve come here
  //   [Server thread/INFO]: Smokeshow: hey steve ...
  //   [Not Secure] [Rcon] hey steve ...        (player used /say)
  let m = line.match(/^\s*\[[^\]]*\]\s*(?:\[[^\]]*\]\s*)?.*?(\w+)\s*:\s*(.*steve.*)$/i);
  if (m) return { player: m[1], text: m[2].trim() };
  m = line.match(/^\s*\[[^\]]*\]\s*(?:\[[^\]]*\]\s*)?(.*steve.*)$/i); // /say form, no player:
  if (m) return { player: 'player', text: m[1].trim() };
  m = line.match(/<(\w+)>\s*(.*steve.*)$/i); // <player> form
  if (m) return { player: m[1], text: m[2].trim() };
  return null;
}

// Avoid replying to the same line twice. Track CHARACTER offset (not bytes — the log is
// UTF-8 and byte!=char offsets would corrupt multi-byte lines and break detection).
let lastPos = 0;
try { lastPos = fs.readFileSync(LOG, 'utf8').length; } catch (_) {}

async function tick(harness) {
  try {
    const st = fs.statSync(LOG);
    const full = fs.readFileSync(LOG, 'utf8');
    if (lastPos > full.length) lastPos = 0; // log rotated/truncated
    const text = full.slice(lastPos);
    lastPos = full.length;
    for (const raw of text.split('\n')) {
      if (!raw.trim()) continue;
      const addr = extractAddress(raw);
      if (!addr || !addr.text) continue;
      // Only forward if it really looks like a human addressing Steve.
      if (!/steve/i.test(addr.text)) continue;
      // Clean relay artifacts: "INFO: [Not Secure] [Rcon] msg" -> "msg"
      const clean = addr.text
        .replace(/^[:\s]*\[[^\]]*\]\s*(?:\[[^\]]*\]\s*)*/i, '')
        .replace(/^Rcon\s*/i, '')
        .trim();
      if (!clean) continue;
      try {
        fs.appendFileSync(CHAT_FILE, `Steve: ${clean}\n`);
        console.log(`[relay] ${addr.player} -> Steve: "${clean}"`);
      } catch (e) {
        console.error('relay write err', e.message);
      }
    }
  } catch (_) {}
}

async function main() {
  // Touch the chat file so the listener has something to tail.
  if (!fs.existsSync(CHAT_FILE)) fs.writeFileSync(CHAT_FILE, '');
  const harness = new Harness({
    host: process.env.MC_HOST || '127.0.0.1',
    port: Number(process.env.MC_RCON_PORT || 25575),
    password: process.env.MC_RCON_PW || 'civsqa',
  });
  try { await harness.connect(); console.log('[relay] RCON ok'); } catch (e) { console.log('[relay] RCON warn', e.message); }
  console.log(`[relay] tailing ${LOG} -> ${CHAT_FILE}`);
  setInterval(() => tick(harness), TAIL_MS);
}

main().catch((e) => { console.error('fatal', e); process.exit(1); });
