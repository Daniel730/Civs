const { Rcon } = require('rcon-client');
const { Capabilities } = require('./capabilities');
const { withSpan, setSpanAttrs, recordResultStatus } = require('./telemetry');

const STRIP_COLOR = /\u00a7[0-9a-fk-or]|\u00a7x(\u00a7[0-9a-f]){6}|\x1b\[[0-9;]*m/gi;

/**
 * Parse a Vault balance reply into integer cents (exact decimal, no float drift).
 *
 * Why not `Number.parseFloat`: on the #67 live run a reward delta at balance=1000000
 * read as 0 because the harness echoes large balances in locale/scientific-ish forms
 * ("1,000,000.00", "1.0E6") and float subtraction of near-equal large doubles hid the
 * small reward. Working in integer cents keeps deltas exact up to 2^53 cents.
 *
 * @param {string|number|null|undefined} raw
 * @returns {number|null} balance in cents, or null when unparseable
 */
function parseBalance(raw) {
  if (raw == null) return null;
  let s = String(raw).trim().replace(/[$\s]/g, '');
  if (!s) return null;
  // Locale thousands separators: strip commas used as grouping (1,000,000.25).
  if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, '');
  // Scientific notation ("1.0E6") has no exact decimal digits — expand via Number,
  // then re-render with cent precision.
  if (/[eE]/.test(s)) {
    const n = Number(s);
    if (!Number.isFinite(n)) return null;
    s = n.toFixed(2);
  }
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(s);
  if (!m) return null;
  const sign = m[1] === '-' ? -1n : 1n;
  const frac = ((m[3] || '') + '00').slice(0, 2);
  const cents = sign * (BigInt(m[2]) * 100n + BigInt(frac));
  const abs = cents < 0n ? -cents : cents;
  if (abs > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return Number(cents);
}

/** Convert integer cents back to a currency number for display. */
function centsToMoney(cents) {
  return cents == null ? null : cents / 100;
}

/**
 * Typed client for the CivsTestHarness plugin (and raw `/cv` admin commands) over RCON.
 * Every harness reply is a single line: TEST-OK / TEST-FAIL / TEST-RESULT / TEST-ERROR.
 * Assertion helpers return { ok, message }; query helpers return parsed key/value objects.
 */
class Harness {
  constructor(opts) {
    this.opts = Object.assign(
      { host: '127.0.0.1', port: 25575, password: 'civs-itest', timeout: 15000 },
      opts
    );
    this.rcon = null;
    this.cap = new Capabilities(this);
  }

  async connect() {
    return withSpan(
      'rcon.connect',
      {
        'rcon.operation': 'connect',
        'net.peer.name': this.opts.host,
        'net.peer.port': this.opts.port,
      },
      async (span) => {
        // Never put password in span attributes (opts may contain it).
        this.rcon = await Rcon.connect(this.opts);
        recordResultStatus(span, 'PASS');
        return this;
      }
    );
  }
  async close() {
    return withSpan('rcon.close', { 'rcon.operation': 'close' }, async (span) => {
      if (this.rcon) await this.rcon.end();
      recordResultStatus(span, 'PASS');
    });
  }

  /** Send any raw server command; returns the color-stripped response text. */
  async raw(cmd) {
    const op =
      String(cmd || '')
        .trim()
        .split(/\s+/)[0] || 'raw';
    return withSpan(
      'rcon.send',
      {
        'rcon.operation': 'send',
        'rcon.command_prefix': op,
      },
      async (span) => {
        const res = await this.rcon.send(cmd);
        const text = String(res).replace(STRIP_COLOR, '').trim();
        setSpanAttrs(span, {
          'rcon.reply_prefix': text.slice(0, 24),
        });
        return text;
      }
    );
  }

  /** Run a Civs command, e.g. cv('reload') or cv('placeregion', 'Tester', 'shelter'). */
  cv(...args) {
    return this.raw(['cv', ...args].join(' '));
  }

  /** Parse "TEST-RESULT k=v k2=v2" into an object. */
  _kv(line) {
    const out = { _raw: line };
    const body = line.replace(/^TEST-RESULT\s*/, '');
    for (const tok of body.split(/\s+/)) {
      const i = tok.indexOf('=');
      if (i > 0) out[tok.slice(0, i)] = tok.slice(i + 1);
    }
    return out;
  }
  /** Parse a TEST-OK/TEST-FAIL assertion reply into { ok, message }. */
  _assert(line) {
    if (line.startsWith('TEST-OK')) return { ok: true, message: line.slice(7).trim() };
    if (line.startsWith('TEST-FAIL')) return { ok: false, message: line.slice(9).trim() };
    return { ok: false, message: 'unexpected harness reply: ' + line };
  }

  async ping() {
    return this._kv(await this.raw('test ping'));
  }
  async scheduler() {
    return this._kv(await this.raw('test scheduler'));
  }

  money = {
    get: async (p) =>
      centsToMoney(parseBalance(this._kv(await this.raw(`test money get ${p}`)).balance)),
    /** Exact integer-cents read for delta probes (no float subtraction). */
    getCents: async (p) => parseBalance(this._kv(await this.raw(`test money get ${p}`)).balance),
    set: async (p, amt) => this.raw(`test money set ${p} ${amt}`),
    add: async (p, amt) => this.raw(`test money add ${p} ${amt}`),
  };

  // Observation + reset only. The harness does NOT create regions — that's the actor's job.
  region = {
    count: async (type) =>
      Number.parseInt(this._kv(await this.raw(`test region count ${type}`)).count, 10),
    at: async (x, y, z, world) =>
      this._kv(await this.raw(`test region at ${x} ${y} ${z}${world ? ' ' + world : ''}`)),
    reset: async (x, y, z, world) =>
      this._kv(await this.raw(`test reset region ${x} ${y} ${z}${world ? ' ' + world : ''}`)),
    save: async () => this.raw('test saveregions'),
    reload: async () => this._kv(await this.raw('test reloadregions')),
  };

  block = {
    at: async (x, y, z, world) =>
      this._kv(await this.raw(`test block ${x} ${y} ${z}${world ? ' ' + world : ''}`)).material,
    // Generic world fixture (not a Civs game action): reliable main-thread block placement.
    set: async (x, y, z, material, world) =>
      this._kv(
        await this.raw(`test setblock ${x} ${y} ${z} ${material}${world ? ' ' + world : ''}`)
      ),
    reset: async (x, y, z, world) =>
      this._kv(await this.raw(`test reset block ${x} ${y} ${z}${world ? ' ' + world : ''}`)),
  };

  // Read-only JSON snapshots of internal state (for failure evidence).
  dump = {
    regions: async () => this._json(await this.raw('test dump regions')),
    scheduler: async () => this._json(await this.raw('test dump scheduler')),
    economy: async (p) => this._json(await this.raw(`test dump economy ${p}`)),
    inventory: async (p) => this._json(await this.raw(`test dump inventory ${p}`)),
  };
  _json(line) {
    const i = line.indexOf('json=');
    if (i < 0) return { _raw: line };
    try {
      return JSON.parse(line.slice(i + 5));
    } catch (e) {
      return { _raw: line, _parseError: e.message };
    }
  }

  async spawnEntity(type, x, y, z, world) {
    return this._kv(
      await this.raw(`test spawnentity ${type} ${x} ${y} ${z}${world ? ' ' + world : ''}`)
    );
  }
  async held(p) {
    return this._kv(await this.raw(`test held ${p}`));
  }
  async inventory(p) {
    return this._kv(await this.raw(`test inventory ${p}`));
  }
  async teleport(p, x, y, z) {
    return this.raw(`tp ${p} ${x} ${y} ${z}`);
  }

  // Assertion helpers (return { ok, message }).
  assert = {
    economy: async (p, op, amt) =>
      this._assert(await this.raw(`test assert economy ${p} ${op} ${amt}`)),
    region: async (type, x, y, z, world) =>
      this._assert(
        await this.raw(`test assert region ${type} ${x} ${y} ${z}${world ? ' ' + world : ''}`)
      ),
    permission: async (p, node, val) =>
      this._assert(await this.raw(`test assert permission ${p} ${node} ${val}`)),
    block: async (x, y, z, material, world) =>
      this._assert(
        await this.raw(`test assert block ${x} ${y} ${z} ${material}${world ? ' ' + world : ''}`)
      ),
    inventory: async (p, material, min) =>
      this._assert(
        await this.raw(`test assert inventory ${p} ${material}${min != null ? ' ' + min : ''}`)
      ),
    town: async (name) => this._assert(await this.raw(`test assert town ${name} exists`)),
  };
}

module.exports = { Harness, parseBalance, centsToMoney };
