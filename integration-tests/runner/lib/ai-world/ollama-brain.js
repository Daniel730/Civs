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
const fs = require('fs');

const DEFAULT_ENDPOINT = process.env.OLLAMA_ENDPOINT || 'http://127.0.0.1:11434';
const DEFAULT_MODEL = process.env.OLLAMA_MODEL || 'civs-brain';
const TIMEOUT_MS = Number(process.env.OLLAMA_TIMEOUT_MS || 60000);
// Where scripts/aiworld-train.js writes the offline-learned weights (closed learning loop).
const WEIGHTS_PATH =
  process.env.AIWORLD_WEIGHTS_PATH ||
  require('path').join(__dirname, '..', '..', 'reports', 'aiworld-weights', 'weights-shared.json');

const FOCUSES = ['survive', 'found', 'build', 'maintain', 'secure', 'explore', 'hunt', 'gather', 'torch', 'rest'];

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

function buildPrompt(snapshot, systemPrompt) {
  const sys =
    systemPrompt ||
    'You are an autonomous Minecraft villager. You must PLAY with purpose, not loop meaninglessly. ' +
      'Priority: survival above all. Given the world snapshot, choose ONE focus from ' +
      '[survive, found, build, maintain, secure, explore, hunt, gather, torch, rest]. ' +
      'Respond ONLY with JSON: {"focus":"...","reason":"...","target":null|"<concrete place or action>"}. ' +
      'Rules to AVOID stupidity: ' +
      '(1) ONLY flee (focus survive) when a HOSTILE is actually NEAR (nearestHostile distance < 12) or you are taking damage RIGHT NOW. Dying in the past (deaths high) or being in the dark is NOT an emergency by itself. ' +
      '(2) If it is dark (lightLevel <=7) but NO hostile is near, WORK anyway — do NOT stand still. ' +
      'If the settlement is already established (completedPlaces >= 3) and no hostile is near, PREFER build/maintain ' +
      '(keep growing the village, and building also lights the area) over endless torching. Only torch if you are literally in an unlit spot with no build site. ' +
      '(3) If deathsHere is high, do NOT repeat the same spot — when you work, pick a DIFFERENT site than where you died, and prefer building shelter/lighting over mining there. ' +
      '(4) If you are SAFE and lit, maintain the settlement (farm, repair, build) OR gather resources OR explore new ground — vary your focus so you do not loop one task. ' +
      '(5) NEVER oscillate: if your last focus failed, pick a DIFFERENT focus this time. ' +
      '(6) When a hostile is within ~20 blocks, choose hunt (go find and defeat it) instead of just guarding. ' +
      '(7) When food/hunger is low or you have no resources, choose gather (forage wood/stone/food). ' +
      '(8) When health is low but no hostile is near, choose rest (return to base and recover) rather than risking a fight. ' +
      '(9) When the settlement is established and you are safe, choose explore to discover new terrain and scan for threats/resources.' +
      '(10) CRITICAL: never pick "survive" unless there is a REAL threat in the snapshot. If "nearestHostile" is "none" AND "nearestThreatDist" is unknown or >= 12 AND survivalState is SAFE/CAUTION, you MUST pick a productive focus (build/maintain/gather/explore/torch) — never survive. Do not invent mobs that are not in the snapshot.' +
      'When you survive, set target to a safe lit place AWAY from where you died (e.g. a lit hilltop), not the same death spot.';
      'Be concrete: target should name where to go or what to do when you can.';
  const wm = snapshot.worldMemory || {};
  const remembered =
    (wm.threatsRemembered ? ` (${wm.threatsRemembered} threat(s) remembered)` : '') +
    (wm.blocksPlaced ? `, placed ${wm.blocksPlaced} block(s)` : '') +
    (wm.blocksBroken ? `, broke ${wm.blocksBroken} block(s)` : '');
  const deaths = snapshot.deaths != null ? snapshot.deaths : (wm.deaths || 0);
  const lastDmg = snapshot.lastDamageCause || wm.lastDamageCause || null;
  const light = snapshot.lightLevel != null ? snapshot.lightLevel : (wm.lightLevel != null ? wm.lightLevel : -1);
  const snap =
    'WORLD SNAPSHOT:\n' +
    `- health: ${snapshot.healthPct != null ? Math.round(snapshot.healthPct * 100) : '?'}%\n` +
    `- survivalState: ${snapshot.survivalState || 'SAFE'}\n` +
    `- position: (${snapshot.x ?? '?'}, ${snapshot.z ?? '?'})\n` +
    `- threats: ${snapshot.threats && snapshot.threats.length ? snapshot.threats.join(', ') : 'none'}\n` +
    `- nearestHostile: ${snapshot.nearestHostile ? JSON.stringify(snapshot.nearestHostile) : 'none'}\n` +
    `- nearestThreatDist: ${snapshot.nearestThreatDist != null && snapshot.nearestThreatDist >= 0 ? snapshot.nearestThreatDist : 'unknown'}\n` +
    `- dangerZoneRemembered: ${snapshot.dangerZone ? 'yes' : 'no'}\n` +
    `- deathsHere: ${deaths}\n` +
    `- lastDamageCause: ${lastDmg || 'none'}\n` +
    `- lightLevel: ${light >= 0 ? light : 'unknown'}${light > 0 && light <= 7 ? ' (DARK)' : ''}\n` +
    `- blockBelow: ${snapshot.blockBelow || wm.blockBelow || 'unknown'}\n` +
    `- memory:${remembered || ' nothing remembered yet'}\n` +
    `- currentFocus: ${snapshot.currentFocus || 'none'}\n` +
    `- completedPlaces: ${snapshot.completedPlaces || 0}\n` +
    `- availableJobs: ${FOCUSES.join(', ')}}\n`;
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

// The model may emit synonyms not in FOCUSES (farm/mine/chop/guard/defend/patrol...). Normalize
// them to the canonical focus vocabulary so valid intent is never discarded as "invalid".
const FOCUS_SYNONYMS = {
  farm: 'gather', farming: 'gather', harvest: 'gather', forage: 'gather',
  mine: 'gather', mining: 'gather', dig: 'gather', quarry: 'gather',
  chop: 'gather', chopwood: 'gather', wood: 'gather', lumber: 'gather', forestry: 'gather',
  craft: 'build', buildh: 'build', buildhouse: 'build', construct: 'build', repair: 'maintain',
  guard: 'secure', defend: 'secure', defence: 'secure', protect: 'secure', patrol: 'secure',
  fight: 'hunt', kill: 'hunt', attack: 'hunt', combat: 'hunt',
  explore: 'explore', scout: 'explore', wander: 'explore',
  light: 'torch', lightup: 'torch',
  rest: 'rest', sleep: 'rest', recover: 'rest', heal: 'rest',
  found: 'found', settle: 'found', establish: 'found',
  survive: 'survive', flee: 'survive', escape: 'survive', run: 'survive',
  maintain: 'maintain', upkeep: 'maintain', tidy: 'maintain',
};
function normalizeFocus(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const f = raw.trim().toLowerCase();
  if (FOCUSES.includes(f)) return f;
  if (FOCUS_SYNONYMS[f]) return FOCUS_SYNONYMS[f];
  // allow "<verb>:<target>" style (e.g. "hunt:zombie") — take the verb part
  const head = f.split(/[:#\-]/)[0];
  if (FOCUSES.includes(head)) return head;
  if (FOCUS_SYNONYMS[head]) return FOCUS_SYNONYMS[head];
  return null;
}
// The LLM sometimes invents a threat and returns 'survive' even when the snapshot shows
// NO hostile nearby and the survival monitor is SAFE/CAUTION. Fleeing from a ghost makes the
// Steve look dumb ("there's a mob! let's run!" with hostiles:0). This hard post-filter
// overrides a phantom survive with a productive focus when there is genuinely no threat.
function realThreat(snapshot) {
  if (snapshot.survivalState === 'DANGER' || snapshot.survivalState === 'ESCAPE' || snapshot.survivalState === 'RECOVER') return true;
  if (snapshot.nearestHostile && typeof snapshot.nearestHostile === 'object') return true;
  if (snapshot.threats && Array.isArray(snapshot.threats) && snapshot.threats.length) return true;
  const d = snapshot.nearestThreatDist;
  if (typeof d === 'number' && d >= 0 && d < 12) return true;
  return false;
}
function sanitizeFocus(focus, snapshot) {
  if (focus !== 'survive') return focus;
  if (realThreat(snapshot)) return 'survive'; // genuine emergency — keep it
  // Phantom survive: no real threat. Pick a productive focus instead (prefer what the
  // model actually wanted if it named a target/other focus, else diversification).
  const alt = diversifyFocus(loadWeights(WEIGHTS_PATH), snapshot.survivalState || 'SAFE');
  return alt && alt !== 'survive' ? alt : 'build';
}
// (shape: { version, bias: { context: { intent: bias } }, ... }). aiworld-train nests the
// per-context intents under `bias`, so normalize to a { context: { intent: bias } } map.
// Returns {} on any failure — learning is best-effort and never breaks the brain.
function loadWeights(path) {
  try {
    const raw = fs.readFileSync(path, 'utf8');
    const w = JSON.parse(raw);
    if (!w || typeof w !== 'object') return {};
    // Preferred shape from aiworld-train.js: contexts live under `bias`.
    if (w.bias && typeof w.bias === 'object') return w.bias;
    // Backward-compat: flat { SAFE: {...}, DANGER: {...} } at top level.
    const ctxKeys = Object.keys(w).filter((k) => /^(SAFE|DANGER|CAUTION|ESCAPE|RECOVER|DEFAULT)$/i.test(k));
    if (ctxKeys.length) return w;
    return {};
  } catch (_) {
    return {};
  }
}

// Build a short "what you've learned works" appendix for the current survival context,
// steering the LLM toward the intents that earned positive reward and away from negative.
function learnedBiasAppendix(weights, survivalState) {
  const ctx = weights[survivalState] || weights.SAFE || weights.DEFAULT || {};
  const entries = Object.entries(ctx).filter(([k]) => FOCUSES.includes(k));
  if (!entries.length) return '';
  const ranked = entries.sort((a, b) => b[1] - a[1]);
  const good = ranked.filter(([, v]) => v > 0).map(([k]) => k);
  const bad = ranked.filter(([, v]) => v < 0).map(([k]) => k);
  let s = '\nLEARNED PREFERENCES (from your own experience, context=' + survivalState + '):';
  if (good.length) s += ' prefer ' + good.join(', ') + ';';
  if (bad.length) s += ' avoid ' + bad.join(', ') + ';';
  s += ' these were reinforced by past outcomes.';
  return s;
}

// Offline fallback: when the model is down, pick the highest-weighted valid FOCUS for the
// current context (applies learning even without inference). Falls back to 'maintain'.
function fallbackFocus(weights, survivalState) {
  const ctx = weights[survivalState] || weights.SAFE || weights.DEFAULT || {};
  const ranked = Object.entries(ctx)
    .filter(([k]) => FOCUSES.includes(k))
    .sort((a, b) => b[1] - a[1]);
  return ranked.length ? ranked[0][0] : 'maintain';
}

// --- Anti-monotony / full-action-space driver -------------------------------------------
// The Steve must exercise EVERYTHING Minecraft offers, not loop the same 2-3 foci. We track
// the recently-chosen foci (module-level, per process) and, when survival allows, demote foci
// done recently and promote ones the Steve hasn't tried — learned weights break ties. This is
// what makes "fazer tudo" real and visible instead of "hunt/gather/explore forever".
const _recentFoci = [];
const RECENT_WINDOW = 6;

function recordRecentFocus(focus) {
  if (!focus) return;
  _recentFoci.push(focus);
  while (_recentFoci.length > RECENT_WINDOW) _recentFoci.shift();
}

/**
 * Given the learned weights + survival context + recent foci, choose a focus that:
 *  - respects survival (defensive foci win under threat),
 *  - otherwise PREFERS a focus the Steve hasn't done lately (diversity),
 *  - uses learned weights as the tie-breaker among equally-fresh candidates.
 * @returns {string} focus
 */
function diversifyFocus(weights, survivalState, recent) {
  const SURVIVAL_URGENT = survivalState === 'DANGER' || survivalState === 'ESCAPE' || survivalState === 'RECOVER';
  const DEFENSIVE = ['survive', 'hunt', 'defend', 'flee', 'guard', 'patrol'];
  const ctx = weights[survivalState] || weights.SAFE || weights.DEFAULT || {};
  const rec = recent && recent.length ? recent : _recentFoci;

  // Under threat, a defensive action is non-negotiable — don't diversify into danger.
  if (SURVIVAL_URGENT) {
    const def = FOCUSES.filter((f) => DEFENSIVE.includes(f));
    const ranked = def
      .map((f) => [f, ctx[f] || 0])
      .sort((a, b) => b[1] - a[1]);
    return ranked.length ? ranked[0][0] : 'hunt';
  }

  // Score each focus: learned weight MINUS a freshness penalty for recently-used foci.
  // 'rest' is a RECOVERY action, not a default job — keep it strictly last unless we are in
  // RECOVER (where it is appropriate) or it is the only fresh option. This stops the Steve
  // from idling/looking dumb when the model output is invalid or the weights favour rest.
  const isRecover = survivalState === 'RECOVER';
  const scored = FOCUSES.map((f) => {
    const learned = ctx[f] || 0;
    const recentCount = rec.filter((r) => r === f).length;
    const freshnessPenalty = recentCount * 0.5; // strongly prefer unexplored foci
    let restPenalty = 0;
    if (f === 'rest' && !isRecover) restPenalty = 5; // almost never pick rest unless recovering
    return { f, score: learned - freshnessPenalty - restPenalty };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored[0].f;
}

// Short diversity hint for the LLM prompt (so Ollama also avoids repeating itself).
function diversityHint(recent) {
  const rec = recent && recent.length ? recent : _recentFoci;
  if (!rec.length) return '';
  const counts = {};
  rec.forEach((f) => (counts[f] = (counts[f] || 0) + 1));
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k]) => k);
  return `\nRECENTLY DONE (avoid repeating): ${top.join(', ')}. Prefer a different useful focus to keep exercising the full skill set.`;
}

class OllamaBrain {
  constructor(opts = {}) {
    this.endpoint = opts.endpoint || DEFAULT_ENDPOINT;
    // model priority: explicit arg > OLLAMA_MODEL env > built-in default
    this.model = opts.model || process.env.OLLAMA_MODEL || DEFAULT_MODEL;
    this.systemPrompt = opts.systemPrompt || null;
    this.timeoutMs = opts.timeoutMs || TIMEOUT_MS;
    // transport: dependency-injected POST fn for testing without a real Ollama server.
    // Signature matches postJSON(endpoint, path, payload, timeoutMs) -> Promise<{status, body}>.
    // In production this stays undefined and the real postJSON (http) is used.
    this.transport = typeof opts.transport === 'function' ? opts.transport : null;
    this._available = null; // lazy: checked on first decide()
  }

  async _post(path, payload, timeoutMs) {
    if (this.transport) return this.transport(this.endpoint, path, payload, timeoutMs);
    return postJSON(this.endpoint, path, payload, timeoutMs);
  }

  /** True if Ollama answers a lightweight ping. Cached, but a FAILED check is only cached for a
   *  short cooldown (AVAIL_RECHECK_MS) — NOT forever — so a single transient Ollama blip cannot
   *  permanently disable the brain. Without this, one slow/failed call set _available=false and the
   *  Steve fell back to the dumb deterministic diversify FOREVER (the "still burro" symptom). */
  async isAvailable() {
    const now = Date.now();
    if (this._available === true) return true;
    if (this._available === false && now - (this._availableAt || 0) < 30000) return false;
    try {
      const r = await getJSON(this.endpoint, '/api/tags', Math.min(5000, this.timeoutMs));
      this._available = r.status === 200;
      this._availableAt = now;
    } catch (_) {
      this._available = false;
      this._availableAt = now;
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
    if (!available) {
      // Model down: return null so the worker falls back to the deterministic focus.
      // The worker (scripts/village-worker.js) already holds a valid focusCandidate
      // from chooseFocus(), so the NPC never breaks — but decide() must honor its
      // contract: null = caller decides the fallback.
      return null;
    }

    // Lazy-load the offline-trained weights once per process (best-effort; {} if missing).
    if (this._weights === undefined) {
      this._weights = loadWeights(WEIGHTS_PATH);
    }

    const survivalState = snapshot.survivalState || 'SAFE';
    const messages = buildPrompt(snapshot, this.systemPrompt);
    // Inject learned preferences into the user snapshot so the LLM is steered by its own
    // accumulated experience (closes the learning loop: experiences -> train -> brain bias).
    const bias = learnedBiasAppendix(this._weights, survivalState);
    if (bias) messages[1].content += bias;
    // Inject the recently-done hint so the LLM avoids looping the same 2-3 foci.
    const hint = diversityHint();
    if (hint) messages[1].content += hint;
    // Hermes-* fine-tunes expect a LEGACY `prompt` (not chat `messages`); sending `messages`
    // makes them return done_reason:"load" with no output. Concatenate system+user into one
    // prompt string. Models that prefer chat still parse this fine.
    const prompt = messages.map((m) => (m.role === 'system' ? `<<SYSTEM>>\n${m.content}\n` : `${m.content}`)).join('\n');
    let res;
    try {
      res = await this._post(
        '/api/generate',
        { model: this.model, prompt, stream: false, format: 'json' },
        this.timeoutMs
      );
    } catch (e) {
      this._available = false;
      // Model call failed mid-flight: return null so the worker falls back to deterministic focus.
      return null;
    }
    if (!res || res.status !== 200) {
      this._available = false;
      this._availableAt = Date.now();
      return null;
    }
    // Successful Ollama call — mark the brain available again so it recovers immediately
    // (no need to wait out the availability cooldown).
    this._available = true;
    this._availableAt = Date.now();

    let parsed = null;
    try {
      const json = JSON.parse(res.body);
      // Models with thinking/reasoning enabled (e.g. hermes-* fine-tunes) put the generated text in
      // `thinking` / `reasoning_content` and leave `response` empty. Fall back to those so the
      // brain still works instead of silently nulling out.
      const rawText =
        json.response ||
        json.thinking ||
        json.reasoning_content ||
        '';
      parsed = extractJSON(rawText);
    } catch (_) {
      return null;
    }
    let chosen;
    if (!parsed || !FOCUSES.includes(parsed.focus)) {
      // The model may have used a synonym (farm/mine/guard/...) — normalize before discarding.
      const norm = normalizeFocus(parsed && parsed.focus);
      if (norm) {
        recordRecentFocus(norm);
        return { focus: norm, reason: (parsed && parsed.reason) || 'ollama(normalized)', target: parsed && parsed.target != null ? parsed.target : null };
      }
      // Truly invalid: return null so the worker falls back to deterministic focus.
      // (The worker holds a valid focusCandidate from chooseFocus(); see decide() contract.)
      return null;
    }
    chosen = parsed.focus;
    // Hard safety net: never flee from a phantom threat (LLM invented a mob). If the snapshot
    // shows no real hostile, override a 'survive' with a productive focus.
    const safeFocus = sanitizeFocus(chosen, snapshot);
    if (safeFocus !== chosen) {
      recordRecentFocus(safeFocus);
      return { focus: safeFocus, reason: (parsed.reason || 'ollama') + ' [sanitized:no_real_threat]', target: parsed.target != null ? parsed.target : null };
    }
    // Remember this choice so future decisions diversify away from it (anti-monotony).
    recordRecentFocus(chosen);
    return {
      focus: chosen,
      reason: parsed.reason || 'ollama',
      target: parsed.target != null ? parsed.target : null,
    };
  }
}

module.exports = {
  OllamaBrain,
  FOCUSES,
  normalizeFocus,
  sanitizeFocus,
  realThreat,
  extractJSON,
  buildPrompt,
  loadWeights,
  learnedBiasAppendix,
  fallbackFocus,
  diversifyFocus,
  recordRecentFocus,
  diversityHint,
  _recentFoci,
};
