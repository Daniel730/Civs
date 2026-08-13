/**
 * ollama-chat.js — free-text chat via local Ollama (no API cost).
 *
 * Used by the chat listener so a player can TALK to Steve in natural language
 * and get a real reply (not a scripted line). Reuses the same local Ollama that
 * powers the brain (civs-brain / any instruct model), so it is offline and free.
 *
 * v2 — conversational agent:
 *   - Multi-turn memory (rolling history) so Steve follows the conversation.
 *   - Remembers the player (name + a few facts) across the session.
 *   - Answers questions about what he is doing / what he has learned (live state).
 *   - Proactively NARRATES: narrate({event:'focus'|'learned'|...}) returns a short
 *     PT line the worker sends via `tell Steve` when he starts a plan or learns.
 *
 * Safety invariant: any failure -> returns a safe fallback string, never throws,
 * so the NPC never stalls because the model hiccupped.
 */
const http = require('http');
const fs = require('fs');

const DEFAULT_ENDPOINT = process.env.OLLAMA_ENDPOINT || 'http://localhost:11434';
const DEFAULT_MODEL = process.env.OLLAMA_CHAT_MODEL || process.env.OLLAMA_MODEL || 'civs-brain';
const TIMEOUT_MS = Number(process.env.OLLAMA_TIMEOUT_MS || 15000);
const MEMORY_PATH = process.env.AIWORLD_CHAT_MEMORY || require('path').join(__dirname, '..', '..', 'reports', 'steve-memory.json');
const MAX_HISTORY = Number(process.env.AIWORLD_CHAT_HISTORY || 12);

function postJSON(endpoint, path, payload, timeoutMs) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, endpoint);
    const data = JSON.stringify(payload);
    const req = http.request(
      url,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
        timeout: timeoutMs,
      },
      (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => resolve({ status: res.statusCode, body }));
      }
    );
    req.on('timeout', () => req.destroy(new Error('ollama_timeout')));
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function getJSON(endpoint, path, timeoutMs) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, endpoint);
    const req = http.request(
      url,
      { method: 'GET', timeout: timeoutMs },
      (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => resolve({ status: res.statusCode, body }));
      }
    );
    req.on('timeout', () => req.destroy(new Error('ollama_timeout')));
    req.on('error', reject);
    req.end();
  });
}

const SYSTEM_PROMPT =
  'You are Steve, an autonomous Minecraft villager NPC living in a small town. ' +
  'You speak Portuguese (PT) with your owner Dan, who is a player on the server. ' +
  'You are helpful, curious, and play Minecraft with real purpose — you mine, build, ' +
  'farm, fight mobs, explore, gather, light the area, and rest. ' +
  'Keep replies short (1-3 sentences), friendly, and in PT. ' +
  'You can reference what you are currently doing and what you have learned. ' +
  'You remember the conversation and the player. Never break character.';

const NARRATE_SYSTEM =
  'You are Steve, an autonomous Minecraft villager NPC. Reply in Portuguese (PT). ' +
  'You are given an event about your own behavior. Output EXACTLY ONE short sentence ' +
  '(max 2 sentences), no greeting, no "Olá", no quotes — just say what you are doing or what you learned.';

class OllamaChat {
  constructor(opts = {}) {
    this.endpoint = opts.endpoint || DEFAULT_ENDPOINT;
    this.model = opts.model || DEFAULT_MODEL;
    this.systemPrompt = opts.systemPrompt || SYSTEM_PROMPT;
    this.timeoutMs = opts.timeoutMs || TIMEOUT_MS;
    this.transport = typeof opts.transport === 'function' ? opts.transport : null;
    this._available = null;
    // Rolling conversation history: [{role:'user'|'assistant', content}]
    this.history = [];
    // Remembered facts about the player / world: { key: value }
    this.memory = this._loadMemory();
    this.ownerName = this.memory.owner || 'Dan';
  }

  _loadMemory() {
    try {
      const raw = fs.readFileSync(MEMORY_PATH, 'utf8');
      const m = JSON.parse(raw);
      return m && typeof m === 'object' ? m : {};
    } catch (_) {
      return {};
    }
  }

  _saveMemory() {
    try {
      fs.writeFileSync(MEMORY_PATH, JSON.stringify(this.memory, null, 2));
    } catch (_) {
      /* best-effort */
    }
  }

  /** Learn a small fact about the player/world (persisted). */
  rememberFact(key, value) {
    if (!key) return;
    this.memory[key] = value;
    this._saveMemory();
  }

  async isAvailable() {
    if (this._available !== null) return this._available;
    try {
      const r = await getJSON(this.endpoint, '/api/tags', Math.min(5000, this.timeoutMs));
      this._available = r.status === 200;
    } catch (_) {
      this._available = false;
    }
    return this._available;
  }

  // Build the legacy single-prompt from system + memory + state + history + new user line.
  _buildPrompt(userText, ctx) {
    const memLines = Object.entries(this.memory)
      .filter(([k]) => k !== 'owner')
      .map(([k, v]) => `- ${k}: ${v}`)
      .join('\n');
    const memoryText = memLines ? `\nFactos que lembras: ${memLines}\n` : '';
    const stateText = ctx && ctx.state ? `Estado atual: ${JSON.stringify(ctx.state)}\n` : '';
    const historyText = this.history
      .slice(-MAX_HISTORY)
      .map((t) => `${t.role === 'user' ? this.ownerName : 'Steve'}: ${t.content}`)
      .join('\n');
    return (
      `<<SYSTEM>>\n${this.systemPrompt}\n` +
      memoryText +
      stateText +
      (historyText ? `\nConversa recente:\n${historyText}\n` : '') +
      `\n${this.ownerName}: ${userText}\nSteve:`
    );
  }

  /**
   * @param {string} userText natural-language message directed at Steve
   * @param {object} [ctx] optional { state: {...} }
   * @returns {Promise<string>} Steve's reply (always a string; safe fallback on error)
   */
  async ask(userText, ctx = {}) {
    let available = false;
    try { available = await this.isAvailable(); } catch (_) { available = false; }
    if (!available) {
      return 'Estou aqui, ' + this.ownerName + '! Mas o meu cérebro (Ollama) não está a responder de momento.';
    }
    // Lightweight fact extraction: "chamo-me X" / "sou o X"
    const nameMatch = String(userText).match(/\b(chamo[- ]?me|sou o|sou a)\s+([A-Za-zÀ-ÿ0-9_]{2,16})/i);
    if (nameMatch) {
      this.ownerName = nameMatch[2];
      this.rememberFact('owner', this.ownerName);
    }
    const prompt = this._buildPrompt(userText, ctx);
    try {
      const res = this.transport
        ? await this.transport(this.endpoint, '/api/generate', { model: this.model, prompt, stream: false }, this.timeoutMs)
        : await postJSON(this.endpoint, '/api/generate', { model: this.model, prompt, stream: false }, this.timeoutMs);
      if (!res || res.status !== 200) return 'Estou aqui, mas falhei a gerar resposta. Tenta outra vez?';
      const json = JSON.parse(res.body);
      const text = json.response || json.thinking || json.reasoning_content || '';
      const reply = String(text).trim();
      if (!reply) return 'Hmm, não sei bem o que dizer a isso.';
      // Update rolling history (cap it)
      this.history.push({ role: 'user', content: userText });
      this.history.push({ role: 'assistant', content: reply });
      if (this.history.length > MAX_HISTORY * 2) this.history = this.history.slice(-MAX_HISTORY * 2);
      return reply;
    } catch (_) {
      return 'Estou aqui, ' + this.ownerName + '! Mas falhei a processar isso agora.';
    }
  }

  /**
   * Proactive narration: given an event about Steve's own behavior, return ONE short PT
   * line he says out loud (the worker sends it via `tell Steve`). event types:
   *   'focus'   -> just chose a new focus (ctx.focus, ctx.reason)
   *   'learned' -> weights were updated (ctx.prefs = 'prefer X; avoid Y')
   *   'danger'  -> a threat appeared (ctx.threat)
   * Returns the line (string) or '' on failure.
   */
  async narrate(event, ctx = {}) {
    let available = false;
    try { available = await this.isAvailable(); } catch (_) { available = false; }
    if (!available) return '';
    let body;
    if (event === 'focus') {
      body = `Evento: decidiste focar em "${ctx.focus || '?'}"${ctx.reason ? ' porque ' + ctx.reason : ''}. Diz o que vais fazer agora.`;
    } else if (event === 'learned') {
      body = `Evento: os teus pesos de decisão foram atualizados. ${ctx.prefs || 'Aprendeste algo novo.'} Diz o que aprendeste.`;
    } else if (event === 'danger') {
      body = `Evento: há uma ameaça perto (${ctx.threat || 'desconhecida'}). Diz o que vais fazer.`;
    } else {
      body = `Evento: ${ctx.detail || 'algo aconteceu'}. Diz uma frase curta sobre o que fazes.`;
    }
    const prompt = `<<SYSTEM>>\n${NARRATE_SYSTEM}\n${body}\nSteve:`;
    try {
      const res = this.transport
        ? await this.transport(this.endpoint, '/api/generate', { model: this.model, prompt, stream: false }, this.timeoutMs)
        : await postJSON(this.endpoint, '/api/generate', { model: this.model, prompt, stream: false }, this.timeoutMs);
      if (!res || res.status !== 200) return '';
      const json = JSON.parse(res.body);
      const text = json.response || json.thinking || json.reasoning_content || '';
      return String(text).trim();
    } catch (_) {
      return '';
    }
  }
}

module.exports = { OllamaChat, SYSTEM_PROMPT, NARRATE_SYSTEM };
