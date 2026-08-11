/**
 * OpenTelemetry metrics for the AI agents and the cinematic camera.
 *
 * `lib/telemetry.js` only produces traces, which made agent quality unmeasurable —
 * every claim about "slow AI" or "jerky camera" had to be scraped out of the JSONL log
 * by hand. This module adds the counter/histogram/gauge surface named in the AI World
 * and Cinematic Director docs.
 *
 * Design constraints:
 * - Uses the already-vendored `@opentelemetry/api` meter. When no MeterProvider is
 *   registered the API returns a no-op meter, so nothing breaks and nothing is lost:
 *   an in-process registry always keeps the values so tests and `metrics_snapshot`
 *   log rows have real numbers with or without a collector.
 * - Never throws into the agent loop.
 */

const METRIC = Object.freeze({
  DECISION_LATENCY: 'decision_latency_ms',
  ACTION_LATENCY: 'action_latency_ms',
  MOVEMENT_COMMAND_LATENCY: 'movement_command_latency_ms',
  NO_PROGRESS: 'time_without_meaningful_progress_ms',
  DISTANCE_TO_GOAL: 'distance_to_current_goal',
  STUCK_DURATION: 'stuck_duration_ms',
  COLLISION: 'collision_count',
  DEATH: 'death_count',
  REPLAN: 'replan_count',
  GOAL_ABANDON: 'goal_abandon_count',
  PATH_FAILURE: 'path_failure_count',
  CAMERA_SUBJECT_LOSS: 'camera_subject_loss_count',
  CAMERA_OCCLUSION: 'camera_occlusion_count',
  CAMERA_REPOSITION: 'camera_reposition_count',
  CAMERA_TELEPORT: 'camera_teleport_count',
  CAMERA_TARGET_SWITCH: 'camera_target_switch_count',
  CAMERA_FSM_TRANSITION: 'camera_fsm_transition_count',
});

const HISTOGRAMS = Object.freeze([
  METRIC.DECISION_LATENCY,
  METRIC.ACTION_LATENCY,
  METRIC.MOVEMENT_COMMAND_LATENCY,
  METRIC.NO_PROGRESS,
  METRIC.STUCK_DURATION,
]);

const COUNTERS = Object.freeze([
  METRIC.COLLISION,
  METRIC.DEATH,
  METRIC.REPLAN,
  METRIC.GOAL_ABANDON,
  METRIC.PATH_FAILURE,
  METRIC.CAMERA_SUBJECT_LOSS,
  METRIC.CAMERA_OCCLUSION,
  METRIC.CAMERA_REPOSITION,
  METRIC.CAMERA_TELEPORT,
  METRIC.CAMERA_TARGET_SWITCH,
  METRIC.CAMERA_FSM_TRANSITION,
]);

const GAUGES = Object.freeze([METRIC.DISTANCE_TO_GOAL]);

/** Cap per-histogram samples so a 24/7 stream cannot grow unbounded. */
const MAX_SAMPLES = 2048;

const UNITS = Object.freeze({
  [METRIC.DECISION_LATENCY]: 'ms',
  [METRIC.ACTION_LATENCY]: 'ms',
  [METRIC.MOVEMENT_COMMAND_LATENCY]: 'ms',
  [METRIC.NO_PROGRESS]: 'ms',
  [METRIC.STUCK_DURATION]: 'ms',
  [METRIC.DISTANCE_TO_GOAL]: 'block',
});

let _meter = null;
let _instruments = new Map();
let _registry = newRegistry();
let _started = false;
let _mode = 'uninitialized';

function newRegistry() {
  const reg = { counters: new Map(), histograms: new Map(), gauges: new Map() };
  for (const name of COUNTERS) reg.counters.set(name, { value: 0, byAttr: new Map() });
  for (const name of HISTOGRAMS) reg.histograms.set(name, { samples: [], count: 0, sum: 0 });
  for (const name of GAUGES) reg.gauges.set(name, { value: null, at: null, byAttr: new Map() });
  return reg;
}

function attrKey(attrs) {
  if (!attrs) return '';
  const keys = Object.keys(attrs).sort();
  if (!keys.length) return '';
  return keys.map((k) => `${k}=${attrs[k]}`).join(',');
}

/**
 * Bind to the OTel meter (no-op provider is fine) and reset the in-process registry.
 * @param {{ serviceName?: string }} [opts]
 */
function initMetrics(opts = {}) {
  _registry = newRegistry();
  _instruments = new Map();
  try {
    const api = require('@opentelemetry/api');
    _meter = api.metrics.getMeter(opts.serviceName || 'civs-agents', '0.1.0');
    _mode = typeof _meter.createCounter === 'function' ? 'otel' : 'registry_only';
  } catch (_) {
    _meter = null;
    _mode = 'registry_only';
  }
  _started = true;
  return { ok: true, mode: _mode };
}

function ensureStarted() {
  if (!_started) initMetrics();
}

function instrument(kind, name) {
  const key = `${kind}:${name}`;
  if (_instruments.has(key)) return _instruments.get(key);
  let inst = null;
  try {
    if (_meter) {
      const cfg = { unit: UNITS[name] || '1', description: name };
      if (kind === 'counter' && typeof _meter.createCounter === 'function') {
        inst = _meter.createCounter(name, cfg);
      } else if (kind === 'histogram' && typeof _meter.createHistogram === 'function') {
        inst = _meter.createHistogram(name, cfg);
      } else if (kind === 'gauge' && typeof _meter.createGauge === 'function') {
        inst = _meter.createGauge(name, cfg);
      }
    }
  } catch (_) {
    inst = null;
  }
  _instruments.set(key, inst);
  return inst;
}

/**
 * Increment a counter metric.
 * @param {string} name one of METRIC.*_count
 * @param {object} [attrs]
 * @param {number} [delta]
 */
function countMetric(name, attrs, delta = 1) {
  ensureStarted();
  if (!Number.isFinite(delta)) return;
  const slot = _registry.counters.get(name) || { value: 0, byAttr: new Map() };
  slot.value += delta;
  const k = attrKey(attrs);
  if (k) slot.byAttr.set(k, (slot.byAttr.get(k) || 0) + delta);
  _registry.counters.set(name, slot);
  const inst = instrument('counter', name);
  try {
    if (inst) inst.add(delta, attrs || undefined);
  } catch (_) {
    /* metrics never break the agent loop */
  }
}

/**
 * Record a histogram observation (latencies, durations).
 * @param {string} name
 * @param {number} value
 * @param {object} [attrs]
 */
function observeMetric(name, value, attrs) {
  ensureStarted();
  const v = Number(value);
  if (!Number.isFinite(v)) return;
  const slot = _registry.histograms.get(name) || { samples: [], count: 0, sum: 0 };
  slot.count += 1;
  slot.sum += v;
  slot.samples.push(v);
  if (slot.samples.length > MAX_SAMPLES) slot.samples.shift();
  _registry.histograms.set(name, slot);
  const inst = instrument('histogram', name);
  try {
    if (inst) inst.record(v, attrs || undefined);
  } catch (_) {
    /* ignore */
  }
}

/**
 * Set a gauge metric (last-value semantics).
 * @param {string} name
 * @param {number} value
 * @param {object} [attrs]
 */
function gaugeMetric(name, value, attrs) {
  ensureStarted();
  const v = Number(value);
  if (!Number.isFinite(v)) return;
  const slot = _registry.gauges.get(name) || { value: null, at: null, byAttr: new Map() };
  slot.value = v;
  slot.at = Date.now();
  const k = attrKey(attrs);
  if (k) slot.byAttr.set(k, v);
  _registry.gauges.set(name, slot);
  const inst = instrument('gauge', name);
  try {
    if (inst) inst.record(v, attrs || undefined);
  } catch (_) {
    /* ignore */
  }
}

/**
 * Time an async function into a histogram. Records on both success and failure so a
 * hung capability call still shows up as latency.
 * @template T
 * @param {string} name
 * @param {object|null} attrs
 * @param {() => Promise<T>} fn
 * @returns {Promise<T>}
 */
async function timeMetric(name, attrs, fn) {
  const t0 = Date.now();
  try {
    const out = await fn();
    observeMetric(name, Date.now() - t0, attrs);
    return out;
  } catch (err) {
    observeMetric(name, Date.now() - t0, { ...(attrs || {}), outcome: 'error' });
    throw err;
  }
}

function quantile(sorted, p) {
  if (!sorted.length) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(sorted.length * p)));
  return sorted[idx];
}

/** Plain-object view of every metric, safe to log or assert on. */
function metricsSnapshot() {
  ensureStarted();
  const counters = {};
  for (const [name, slot] of _registry.counters) {
    counters[name] = slot.value;
  }
  const histograms = {};
  for (const [name, slot] of _registry.histograms) {
    const sorted = [...slot.samples].sort((a, b) => a - b);
    histograms[name] = {
      count: slot.count,
      sum: Math.round(slot.sum * 100) / 100,
      avg: slot.count ? Math.round((slot.sum / slot.count) * 100) / 100 : null,
      p50: quantile(sorted, 0.5),
      p90: quantile(sorted, 0.9),
      p99: quantile(sorted, 0.99),
      max: sorted.length ? sorted[sorted.length - 1] : null,
    };
  }
  const gauges = {};
  for (const [name, slot] of _registry.gauges) {
    gauges[name] = { value: slot.value, at: slot.at, by: Object.fromEntries(slot.byAttr) };
  }
  return { mode: _mode, counters, histograms, gauges };
}

/** Per-attribute counter breakdown (e.g. death causes). */
function counterBreakdown(name) {
  ensureStarted();
  const slot = _registry.counters.get(name);
  if (!slot) return {};
  return Object.fromEntries(slot.byAttr);
}

function resetMetrics() {
  _registry = newRegistry();
}

module.exports = {
  METRIC,
  HISTOGRAMS,
  COUNTERS,
  GAUGES,
  MAX_SAMPLES,
  initMetrics,
  countMetric,
  observeMetric,
  gaugeMetric,
  timeMetric,
  metricsSnapshot,
  counterBreakdown,
  resetMetrics,
};
