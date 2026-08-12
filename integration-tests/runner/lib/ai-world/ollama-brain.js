/**
 * Ollama brain — replaces the deterministic chooseFocus with a local LLM decision.
 *
 * Why: Dan wants autonomous NPCs that LEARN, not scripts. The body (walk/flee/build) is solid;
 * this is the "entity that plays Minecraft" layer. It runs inference locally (no API cost) and
 * degrades to the deterministic focus if Ollama is unavailable, so the agent never breaks.
 *
 * Contract:
 *   - decide(state) takes a human-readable world snapshot and returns { focus, reason, target? }.
 *   - The worker still executes the focus via the existing body (walk/flee/build). The LLM only
 *     DECIDES; it never touches the world directly.
 *   - Shadow mode: decide() but the deterministic focus executes (compare, no risk).
 *
 * Safety invariant: any failure (timeout, bad JSON, model down) -> return null and let caller
 * fall back to chooseFocus. The NPC must never stall or crash because the brain hiccupped.
 */
const http = require('http');

const DEFAULT_ENDPOINT = process.env.OLLAMA_ENDPOINT || 'http://localhost:11434';
const DEFAULT_MODEL = process.env.OLLAMA_MODEL || 'llama3.1:8b';
const TIMEOUT_MS = Number(process.env.OLLAMA_TIMEOUT_MS || 8000);

const FOCUSES = ['survive', 'found', 'build', 'maintain', 'secure'];

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

function buildPrompt(snapshot, systemPrompt) {
  const sys =
    systemPrompt ||
    'You are an autonomous Minecraft villager. Prioritize survival above all. ' +
      'Given the world snapshot, choose ONE focus from [survive, found, build, maintain, secure]. ' +
      'Respond ONLY with JSON: {"focus":"...","reason":"...","target":null}. ' +
      'If a host is near, prefer survive/flee. If settlement is built, maintain it.';
  const snap =
    'WORLD SNAPSHOT:\n' +
    `- health: ${snapshot.healthPct != null ? Math.round(snapshot.healthPct * 100) : '?'}%\n` +
    `- survivalState: ${snapshot.survivalState || 'SAFE'}\n` +
    `- position: (${snapshot.x ?? '?'}, ${snapshot.z ?? '?'})\n` +
    `- threats: ${snapshot.threats && snapshot.threats.length ? snapshot.threats.join(', ') : 'none'}\n` +
    `- nearestThreatDist: ${snapshot.nearestThreatDist != null && snapshot.nearestThreatDist >= 0 ? snapshot.nearestThreatDist : 'unknown'}\n` +
    `- dangerZoneRemembered: ${snapshot.dangerZone ? 'yes' : 'no'}\n` +
    `- currentFocus: ${snapshot.currentFocus || 'none'}\n` +
    `- completedPlaces: ${snapshot.completedPlaces || 0}\n` +
    `- availableJobs: ${FOCUSES.join(', ')}\n`;
  return [{ role: 'system', content: sys }, { role: 'user', content: snap }];
}

function extractJSON(text) {
  // Ollama may wrap JSON in markdown fences or prose; pull the first {...} block.
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    return JSON.parse(m[0]);
  } catch (_) {
    return null;
  }
}

class OllamaBrain {
  constructor(opts = {}) {
    this.endpoint = opts.endpoint || DEFAULT_ENDPOINT;
    // model priority: explicit arg > OLLAMA_MODEL env > built-in default
    this.model = opts.model || process.env.OLLAMA_MODEL || DEFAULT_MODEL;
    this.systemPrompt = opts.systemPrompt || null;
    this.timeoutMs = opts.timeoutMs || TIMEOUT_MS;
    this._available = null; // lazy: checked on first decide()
  }

  /** True if Ollama answers a lightweight ping. Cached until a failure flips it. */
  async isAvailable() {
    if (this._available !== null) return this._available;
    try {
      const r = await postJSON(this.endpoint, '/api/tags', {}, Math.min(2000, this.timeoutMs));
      this._available = r.status === 200;
    } catch (_) {
      this._available = false;
    }
    return this._available;
  }

  /**
   * @param {object} snapshot see buildPrompt for fields
   * @returns {Promise<{focus:string,reason:string,target?:any}|null>}
   *   null = caller must fall back to deterministic focus (brain unavailable / invalid).
   */
  async decide(snapshot = {}) {
    let available;
    try {
      available = await this.isAvailable();
    } catch (_) {
      available = false;
    }
    if (!available) return null;

    const messages = buildPrompt(snapshot, this.systemPrompt);
    let res;
    try {
      res = await postJSON(
        this.endpoint,
        '/api/generate',
        { model: this.model, messages, stream: false, format: 'json' },
        this.timeoutMs
      );
    } catch (_) {
      this._available = false;
      return null;
    }
    if (!res || res.status !== 200) {
      this._available = false;
      return null;
    }

    let parsed = null;
    try {
      const json = JSON.parse(res.body);
      parsed = extractJSON(json.response || '');
    } catch (_) {
      return null;
    }
    if (!parsed || !FOCUSES.includes(parsed.focus)) return null;
    return {
      focus: parsed.focus,
      reason: parsed.reason || 'ollama',
      target: parsed.target != null ? parsed.target : null,
    };
  }
}

module.exports = { OllamaBrain, FOCUSES, extractJSON, buildPrompt };
