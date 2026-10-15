#!/usr/bin/env node
/**
 * steve-speak.js — makes Steve "talk" on the server chat so a human (Smokeshow) can read what
 * the NPC is thinking. It tails the village-worker live log for `ollama_decision` lines, and
 * whenever Steve's stated intent/reason changes, broadcasts `say [Steve] <pt phrase>` over RCON.
 *
 * Runs as a SEPARATE process (tmux steve-speak) so it never touches the body agent's worker.
 * Proof of "text conversation": you literally see Steve's brain output in the MC chat.
 */
const fs = require('fs');
const path = require('path');
const { Harness } = require('../lib/harness');

const LOG = process.env.STEVE_LOG ||
  '/home/dansilva/aiworld-civs-live.log';
const HOST = process.env.RCON_HOST || '127.0.0.1';
const PORT = Number.parseInt(process.env.RCON_PORT || '25575', 10);
const PASS = process.env.RCON_PASSWORD || 'civsqa';
const TAIL_MS = 1500;
const MIN_GAP_MS = 8000; // throttle: at most one speak per 8s

// Short PT phrases keyed by brain focus. Keeps the chat readable, not a log dump.
const FOCUS_PT = {
  survive: 'Perigo! Vou procurar um sítio seguro.',
  secure: 'Vou montar guarda por aqui.',
  found: 'Vou fundar uma nova região.',
  build: 'Vou construir qualquer coisa.',
  maintain: 'Vou tratar da vila (farmar/repair).',
};

let lastSpoken = '';
let lastTime = 0;

function extractDecision(line) {
  // line like: {"ts":...,"action":"ollama_decision","worker":"Steve","focus":"survive","reason":"...","shadow":false}
  try {
    const o = JSON.parse(line);
    if (o.action === 'ollama_decision' && o.worker === 'Steve' && o.focus && o.reason) {
      return { focus: o.focus, reason: o.reason };
    }
  } catch (_) {}
  return null;
}

async function speak(harness, decision) {
  const now = Date.now();
  if (now - lastTime < MIN_GAP_MS) return;
  const base = FOCUS_PT[decision.focus] || ('Foco: ' + decision.focus);
  // Trim the English reason to a short tail so the line stays readable.
  const reasonShort = decision.reason.length > 90 ? decision.reason.slice(0, 87) + '...' : decision.reason;
  const msg = `[Steve] ${base} (${reasonShort})`;
  if (msg === lastSpoken) return;
  lastSpoken = msg;
  lastTime = now;
  try {
    await harness.raw(`say ${msg}`);
    console.log('SAID:', msg);
  } catch (e) {
    console.error('speak err', e.message);
  }
}

async function main() {
  const harness = new Harness({ host: HOST, port: PORT, password: PASS });
  await harness.connect();
  console.log('steve-speak connected to RCON', HOST + ':' + PORT);

  // Start from end of file so we only narrate new decisions.
  let pos = 0;
  try { pos = fs.statSync(LOG).size; } catch (_) {}

  setInterval(async () => {
    try {
      const st = fs.statSync(LOG);
      if (st.size < pos) pos = 0; // log rotated
      const full = fs.readFileSync(LOG, 'utf8');
      const text = full.slice(pos);
      pos = st.size;
      const lines = text.split('\n').filter(Boolean);
      for (const line of lines) {
        const d = extractDecision(line);
        if (d) await speak(harness, d);
      }
    } catch (e) {
      // log not ready yet — skip
    }
  }, TAIL_MS);
}

main().catch((e) => { console.error('fatal', e); process.exit(1); });
