/**
 * chat-listener.js — lets a player TALK to Steve in natural language on the QA server.
 *
 * The CivsTestHarness has no chat action and the QA server log does not capture player
 * chat, so we use a file pipe: a line "Steve: <msg>" dropped into CHAT_IN_FILE is read,
 * sent to the local Ollama brain (OllamaChat), and Steve's reply is sent back with
 * `raw('tell Steve <reply>')` (or `say` if you prefer broadcast). This is the MVP text
 * channel; a real Discord/RCON-chat relay can replace the file pipe later without
 * touching this module's contract.
 *
 * Robustness: never throws; bad lines / model hiccups are skipped with a log line.
 */
const fs = require('fs');
const { OllamaChat } = require('./ollama-chat');

function extractText(raw) {
  if (typeof raw !== 'string') return String(raw);
  const t = raw.trim();
  // civs-brain returns a JSON decision string; pull a human line out of it if present.
  try {
    const j = JSON.parse(t);
    if (j && typeof j.reason === 'string' && j.reason.length) return j.reason;
    if (j && typeof j.response === 'string' && j.response.length) return j.response;
  } catch (_) { /* plain text */ }
  return t;
}

async function startChatListener({ harness, chatInFile, chat, actorName = 'Steve', pollMs = 1000, useSay = false, stateProvider = null }) {
  const chatObj = chat || new OllamaChat({ model: process.env.OLLAMA_CHAT_MODEL || process.env.OLLAMA_MODEL || 'civs-brain' });
  if (!fs.existsSync(chatInFile)) fs.writeFileSync(chatInFile, '');
  let offset = fs.statSync(chatInFile).size;
  let busy = false;
  // Echo suppression: the QA harness writes Steve's own `say Steve: <reply>` back into the
  // chat file, which would make him talk to himself forever. Track recent outgoing lines
  // (Q&A replies + proactive narrations) and skip any incoming line that matches one.
  const recentOutgoing = [];
  const noteOutgoing = (line) => {
    recentOutgoing.push(line);
    if (recentOutgoing.length > 6) recentOutgoing.shift();
  };
  const isEcho = (text) => {
    const t = text.trim();
    if (!t) return true;
    if (/^\s*Steve\s*:\s*Steve\s*:/i.test(t)) return true; // doubled prefix = self-echo
    return recentOutgoing.some((o) => o && (t === o || t.endsWith(o)));
  };

  const getState = () => (typeof stateProvider === 'function' ? stateProvider() : null);

  const respond = async (line) => {
    const m = line.match(/^\s*Steve\s*:\s*(.*)$/i);
    if (!m) return;
    const userText = m[1].trim();
    if (!userText) return;
    if (isEcho(userText)) return; // ignore our own echoed output
    if (busy) return; // don't overlap replies
    busy = true;
    try {
      const raw = await chatObj.ask(userText, { state: getState() });
      const reply = extractText(raw);
      noteOutgoing(reply);
      const cmd = useSay ? `say ${actorName}: ${reply}` : `tell ${actorName} ${reply}`;
      if (harness && typeof harness.raw === 'function') {
        await harness.raw(cmd).catch(() => {});
      }
      console.log(`[chat] ${actorName} <- "${userText}" => "${reply}"`);
    } catch (e) {
      console.log(`[chat] error replying to "${userText}": ${e && e.message}`);
    } finally {
      busy = false;
    }
  };

  // Proactive narration: the worker calls this when Steve chooses a focus, learns, or faces danger.
  // Steve volunteers a short PT line out loud via `tell Steve`. Never throws.
  const narrate = async (event, ctx = {}) => {
    try {
      const line = await chatObj.narrate(event, ctx);
      if (!line) return;
      noteOutgoing(line);
      const cmd = useSay ? `say ${actorName}: ${line}` : `tell ${actorName} ${line}`;
      if (harness && typeof harness.raw === 'function') {
        await harness.raw(cmd).catch(() => {});
      }
      console.log(`[chat-narrate] ${actorName} >> "${line}"`);
    } catch (_) { /* best-effort: NPC never stalls */ }
  };

  const tick = () => {
    try {
      const st = fs.statSync(chatInFile);
      if (st.size < offset) offset = 0; // file truncated/rotated
      if (st.size > offset) {
        const buf = Buffer.alloc(st.size - offset);
        const fd = fs.openSync(chatInFile, 'r');
        fs.readSync(fd, buf, 0, buf.length, offset);
        fs.closeSync(fd);
        offset = st.size;
        const text = buf.toString('utf8');
        for (const line of text.split('\n')) {
          if (line.trim()) respond(line);
        }
      }
    } catch (_) { /* best-effort */ }
  };

  const timer = setInterval(tick, pollMs);
  if (timer.unref) timer.unref();
  console.log(`[chat] listening on ${chatInFile} (actor=${actorName})`);
  return { stop: () => clearInterval(timer), narrate, chat: chatObj };
}

module.exports = { startChatListener, extractText };
