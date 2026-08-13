/**
 * steve-chat.js — standalone text channel for Steve on the QA server.
 *
 * Runs as its own process (does not touch village-worker.js, which the other agent
 * owns). Reads lines "Steve: <msg>" from CHAT_IN_FILE, asks the local Ollama brain,
 * and sends Steve's reply back in-game via `say Steve: <reply>` (broadcast).
 *
 * v2 — also PROACTIVE: watches the live worker log for:
 *   - ollama_decision  -> Steve volunteers what he is about to do (new focus)
 *   - self-train       -> Steve volunteers what he just learned (weights updated)
 * So Steve both answers AND speaks on his own, like a real companion.
 *
 * Usage:
 *   AIWORLD_CHAT_FILE=/tmp/steve-chat.txt node scripts/steve-chat.js
 */
const fs = require('fs');
const path = require('path');
const ROOT = __dirname + '/..';
const { Harness } = require(ROOT + '/lib/harness');
const { startChatListener } = require(ROOT + '/lib/ai-world/chat-listener');
const { OllamaChat } = require(ROOT + '/lib/ai-world/ollama-chat');

const chatFile = process.env.AIWORLD_CHAT_FILE || '/tmp/steve-chat.txt';
const workerLog = process.env.AIWORLD_WORKER_LOG || '/home/dansilva/aiworld-civs-live.log';
const harness = new Harness({
  host: process.env.MC_HOST || '127.0.0.1',
  port: Number(process.env.MC_RCON_PORT || 25575),
  password: process.env.MC_RCON_PW || 'civsqa',
});

// Dedicated chat instance for narration (separate history from Q&A is fine).
const narrator = new OllamaChat({ model: process.env.OLLAMA_CHAT_MODEL || process.env.OLLAMA_MODEL || 'civs-brain' });

// Throttle narration so Steve doesn't spam on every tick.
let lastFocusNarrate = 0;
let lastLearnNarrate = 0;
const FOCUS_COOLDOWN_MS = Number(process.env.AIWORLD_NARRATE_FOCUS_CD || 20000);
const LEARN_COOLDOWN_MS = Number(process.env.AIWORLD_NARRATE_LEARN_CD || 30000);

async function narrate(event, ctx) {
  const now = Date.now();
  if (event === 'focus' && now - lastFocusNarrate < FOCUS_COOLDOWN_MS) return;
  if (event === 'learned' && now - lastLearnNarrate < LEARN_COOLDOWN_MS) return;
  const line = await narrator.narrate(event, ctx);
  if (!line) return;
  const cmd = `say Steve: ${line}`;
  if (harness && typeof harness.raw === 'function') {
    await harness.raw(cmd).catch(() => {});
  }
  console.log(`[steve-chat][narrate] ${event} >> "${line}"`);
  if (event === 'focus') lastFocusNarrate = now; else lastLearnNarrate = now;
}

// Watch the worker log for decisions/learning and make Steve speak.
function watchWorkerLog() {
  if (!fs.existsSync(workerLog)) { console.log('[steve-chat] worker log not found:', workerLog); return; }
  let offset = fs.statSync(workerLog).size;
  const tick = () => {
    try {
      const st = fs.statSync(workerLog);
      if (st.size < offset) offset = 0; // rotated
      if (st.size > offset) {
        const buf = Buffer.alloc(st.size - offset);
        const fd = fs.openSync(workerLog, 'r');
        fs.readSync(fd, buf, 0, buf.length, offset);
        fs.closeSync(fd);
        offset = st.size;
        const text = buf.toString('utf8');
        for (const raw of text.split('\n')) {
          const line = raw.trim();
          if (!line) continue;
          // Focus chosen by the brain/rotation: ollama_decision lines carry focus + reason.
          if (/ollama_decision/.test(line)) {
            const fm = line.match(/"focus":"([a-z]+)"/);
            const rm = line.match(/"reason":"([^"]*)"/);
            if (fm) {
              const focus = fm[1];
              const reason = rm ? rm[1].replace(/^ollama\([^)]*\):/, '').slice(0, 80) : '';
              narrate('focus', { focus, reason });
              continue;
            }
          }
          // Learning happened: self-train wrote new weights.
          if (/self-train/i.test(line)) {
            narrate('learned', { prefs: 'Atualizei os meus pesos de decisão com base no que aconteceu.' });
            continue;
          }
        }
      }
    } catch (_) { /* best-effort */ }
  };
  const t = setInterval(tick, 1500);
  if (t.unref) t.unref();
}

(async () => {
  await harness.connect();
  const ping = await harness.ping();
  if (!ping || ping.pong !== '1') {
    console.log('Harness RCON unavailable — cannot send replies.');
    process.exit(1);
  }
  console.log('[steve-chat] RCON connected. Listening on', chatFile);
  startChatListener({ harness, chatInFile: chatFile, actorName: 'Steve', pollMs: 500, useSay: true });
  watchWorkerLog();
  console.log('[steve-chat] proactive narration watching', workerLog);
})().catch((e) => {
  console.log('[steve-chat] fatal:', e && e.message);
  process.exit(1);
});
