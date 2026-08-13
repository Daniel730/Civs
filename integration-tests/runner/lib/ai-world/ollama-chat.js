/**
 * ollama-chat.js — free-text chat via local Ollama (no API cost).
 *
 * Used by the chat listener so a player can TALK to Steve in natural language
 * and get a real reply (not a scripted line). Reuses the same local Ollama that
 * powers the brain (civs-brain / any instruct model), so it is offline and free.
 *
 * Safety invariant: any failure -> returns a safe fallback string, never throws,
 * so the NPC never stalls because the model hiccupped.
 */
const http = require('http');

const DEFAULT_ENDPOINT = process.env.OLLAMA_ENDPOINT || 'http://localhost:11434';
const DEFAULT_MODEL = process.env.OLLAMA_CHAT_MODEL || process.env.OLLAMA_MODEL || 'civs-brain';
const TIMEOUT_MS = Number(process.env.OLLAMA_TIMEOUT_MS || 15000);

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
  'farm, fight mobs, and explore. Keep replies short (1-3 sentences), friendly, and ' +
  'in PT. You can reference what you are currently doing if relevant.';

class OllamaChat {
  constructor(opts = {}) {
    this.endpoint = opts.endpoint || DEFAULT_ENDPOINT;
    this.model = opts.model || DEFAULT_MODEL;
    this.systemPrompt = opts.systemPrompt || SYSTEM_PROMPT;
    this.timeoutMs = opts.timeoutMs || TIMEOUT_MS;
    this.transport = typeof opts.transport === 'function' ? opts.transport : null;
    this._available = null;
  }

  async isAvailable() {
    if (this._available !== null) return this._available;
    try {
      // /api/tags is GET; Ollama returns 405 on POST, which would wrongly mark
      // the chat unavailable. Use GET so availability detection is correct.
      const r = await getJSON(this.endpoint, '/api/tags', Math.min(5000, this.timeoutMs));
      this._available = r.status === 200;
    } catch (_) {
      this._available = false;
    }
    return this._available;
  }

  /**
   * @param {string} userText natural-language message directed at Steve
   * @param {object} [ctx] optional { history: [{role,content}], state: {...} }
   * @returns {Promise<string>} Steve's reply (always a string; safe fallback on error)
   */
  async ask(userText, ctx = {}) {
    let available = false;
    try { available = await this.isAvailable(); } catch (_) { available = false; }
    if (!available) {
      return 'Estou aqui, Dan! Mas o meu cérebro (Ollama) não está a responder de momento.';
    }
    const prompt =
      `<<SYSTEM>>\n${this.systemPrompt}\n` +
      (ctx.state ? `Contexto atual: ${JSON.stringify(ctx.state)}\n` : '') +
      `\nPergunta do Dan: ${userText}\nResposta do Steve:`;
    try {
      const res = this.transport
        ? await this.transport(this.endpoint, '/api/generate', { model: this.model, prompt, stream: false }, this.timeoutMs)
        : await postJSON(this.endpoint, '/api/generate', { model: this.model, prompt, stream: false }, this.timeoutMs);
      if (!res || res.status !== 200) return 'Estou aqui, mas falhei a gerar resposta. Tenta outra vez?';
      const json = JSON.parse(res.body);
      const text = json.response || json.thinking || json.reasoning_content || '';
      const clean = String(text).trim();
      return clean || 'Hmm, não sei bem o que dizer a isso.';
    } catch (_) {
      return 'Estou aqui, Dan! Mas falhei a processar isso agora.';
    }
  }
}

module.exports = { OllamaChat, SYSTEM_PROMPT };
