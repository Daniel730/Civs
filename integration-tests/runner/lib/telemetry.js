/**
 * OpenTelemetry bootstrap for the Civs integration runner / Agent Gateway.
 *
 * Environment (all optional — telemetry never fails Minecraft QA):
 *   OTEL_SDK_DISABLED=true          — no-op tracer (default-safe)
 *   OTEL_SERVICE_NAME               — default civs-integration-runner
 *   OTEL_EXPORTER_OTLP_ENDPOINT     — e.g. http://127.0.0.1:4318
 *   OTEL_EXPORTER_OTLP_TRACES_ENDPOINT — overrides traces URL
 *   OTEL_TRACES_EXPORTER=console|otlp|none|memory|file
 *   CIVS_OTEL_FILE                  — if set, also write JSONL spans to this path
 *   CIVS_OTEL_IN_MEMORY=1           — keep spans in process for unit/validation tests
 *
 * Never invent attribute values. Never put passwords / tokens in attributes.
 */
const SECRET_KEY = /password|passwd|secret|token|authorization|api[_-]?key|rcon[_-]?pass/i;
const STATUS_VOCAB = new Set(['OBSERVED', 'PASS', 'FAIL', 'BLOCKED', 'UNKNOWN']);

let _api = null;
let _sdk = null;
let _tracer = null;
let _started = false;
let _memorySpans = [];
let _fileStream = null;
let _initError = null;
let _contextReady = false;

function safeAttrs(attrs) {
  if (!attrs || typeof attrs !== 'object') return undefined;
  const out = {};
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null) continue;
    if (SECRET_KEY.test(k)) continue;
    if (typeof v === 'string' && SECRET_KEY.test(v) && /[=:]/.test(String(k))) continue;
    if (typeof v === 'string' && /(?:password|passwd|token|secret)\s*[=:]\s*\S+/i.test(v)) continue;
    out[k] = typeof v === 'object' ? JSON.stringify(v) : v;
  }
  return out;
}

function resultStatusAttr(status) {
  if (status == null) return undefined;
  const s = String(status).toUpperCase();
  return STATUS_VOCAB.has(s) ? s : String(status);
}

function loadApi() {
  if (_api) return _api;
  try {
    _api = require('@opentelemetry/api');
    return _api;
  } catch (e) {
    _initError = e;
    return null;
  }
}

function parentSpanIdOf(span) {
  if (!span) return null;
  if (span.parentSpanId) return span.parentSpanId;
  try {
    if (typeof span.parentSpanContext === 'function') {
      const p = span.parentSpanContext();
      return (p && p.spanId) || null;
    }
    if (span.parentSpanContext && span.parentSpanContext.spanId) {
      return span.parentSpanContext.spanId;
    }
  } catch (_) {
    /* ignore */
  }
  return null;
}

function ensureContextManager(api) {
  if (_contextReady) return;
  try {
    const { AsyncLocalStorageContextManager } = require('@opentelemetry/context-async-hooks');
    api.context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
  } catch (_) {
    // Without async hooks, parent/child across await may be flat; still emit spans.
  }
  _contextReady = true;
}

/**
 * In-memory span processor for tests / local inspect (no external backend).
 */
class InMemorySpanProcessor {
  constructor(store) {
    this._store = store;
  }
  onStart() {}
  onEnd(span) {
    try {
      const ctx = span.spanContext();
      this._store.push({
        name: span.name,
        traceId: ctx.traceId,
        spanId: ctx.spanId,
        parentSpanId: parentSpanIdOf(span),
        status: span.status,
        attributes: { ...span.attributes },
        events: (span.events || []).map((ev) => ({
          name: ev.name,
          attributes: ev.attributes ? { ...ev.attributes } : undefined,
        })),
        startTime: span.startTime,
        endTime: span.endTime,
      });
    } catch (_) {
      /* never break host */
    }
  }
  shutdown() {
    return Promise.resolve();
  }
  forceFlush() {
    return Promise.resolve();
  }
}

/**
 * Optional JSONL file exporter for local inspect without a collector.
 */
class FileSpanExporter {
  constructor(filePath) {
    this._path = filePath;
    this._fs = require('fs');
    this._fs.mkdirSync(require('path').dirname(filePath), { recursive: true });
  }
  export(spans, resultCallback) {
    try {
      for (const span of spans) {
        const ctx = span.spanContext();
        const row = {
          name: span.name,
          traceId: ctx.traceId,
          spanId: ctx.spanId,
          parentSpanId: parentSpanIdOf(span),
          statusCode: span.status && span.status.code,
          attributes: span.attributes,
          events: span.events,
        };
        this._fs.appendFileSync(this._path, JSON.stringify(row) + '\n');
      }
      resultCallback({ code: 0 });
    } catch (e) {
      resultCallback({ code: 1, error: e });
    }
  }
  shutdown() {
    return Promise.resolve();
  }
}

function exporterMode() {
  const mode = (process.env.OTEL_TRACES_EXPORTER || '').toLowerCase().trim();
  if (mode) return mode;
  if (process.env.OTEL_EXPORTER_OTLP_ENDPOINT || process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT) {
    return 'otlp';
  }
  if (process.env.CIVS_OTEL_IN_MEMORY === '1' || process.env.CIVS_OTEL_IN_MEMORY === 'true') {
    return 'memory';
  }
  if (process.env.CIVS_OTEL_FILE) return 'file';
  return 'none';
}

/**
 * Initialize tracing. Safe to call multiple times. Never throws to callers.
 * Uses provider.getTracer (not global) so tests can re-init after shutdown.
 * @param {{ serviceName?: string }} [opts]
 * @returns {{ ok: boolean, mode: string, error?: string }}
 */
function initTelemetry(opts = {}) {
  if (_started && _tracer) {
    return { ok: true, mode: exporterMode(), already: true, file: _fileStream || undefined };
  }
  if (process.env.OTEL_SDK_DISABLED === 'true' || process.env.OTEL_SDK_DISABLED === '1') {
    _started = true;
    _tracer = null;
    return { ok: true, mode: 'disabled' };
  }

  const mode = exporterMode();
  if (
    mode === 'none' &&
    !process.env.CIVS_OTEL_FILE &&
    process.env.CIVS_OTEL_IN_MEMORY !== '1' &&
    process.env.CIVS_OTEL_IN_MEMORY !== 'true'
  ) {
    _started = true;
    _tracer = null;
    return { ok: true, mode: 'none' };
  }

  try {
    const api = loadApi();
    if (!api) throw _initError || new Error('@opentelemetry/api missing');
    ensureContextManager(api);

    const resources = require('@opentelemetry/resources');
    const semconv = require('@opentelemetry/semantic-conventions');
    const {
      BasicTracerProvider,
      BatchSpanProcessor,
      SimpleSpanProcessor,
      ConsoleSpanExporter,
    } = require('@opentelemetry/sdk-trace-base');

    const serviceName =
      opts.serviceName || process.env.OTEL_SERVICE_NAME || 'civs-integration-runner';

    const serviceKey =
      semconv.ATTR_SERVICE_NAME ||
      (semconv.SemanticResourceAttributes && semconv.SemanticResourceAttributes.SERVICE_NAME) ||
      'service.name';
    const resource = new resources.Resource({ [serviceKey]: serviceName });

    _memorySpans = [];
    const spanProcessors = [];

    if (mode === 'console' || process.env.CIVS_OTEL_CONSOLE === '1') {
      spanProcessors.push(new SimpleSpanProcessor(new ConsoleSpanExporter()));
    }
    if (
      mode === 'memory' ||
      process.env.CIVS_OTEL_IN_MEMORY === '1' ||
      process.env.CIVS_OTEL_IN_MEMORY === 'true'
    ) {
      spanProcessors.push(new InMemorySpanProcessor(_memorySpans));
    }
    if (process.env.CIVS_OTEL_FILE || mode === 'file') {
      const fp =
        process.env.CIVS_OTEL_FILE ||
        require('path').join(require('os').tmpdir(), 'civs-otel-spans.jsonl');
      spanProcessors.push(new SimpleSpanProcessor(new FileSpanExporter(fp)));
      _fileStream = fp;
    }
    if (mode === 'otlp') {
      try {
        const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-http');
        const url =
          process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT ||
          (process.env.OTEL_EXPORTER_OTLP_ENDPOINT
            ? String(process.env.OTEL_EXPORTER_OTLP_ENDPOINT).replace(/\/$/, '') + '/v1/traces'
            : undefined);
        const exporter = new OTLPTraceExporter(url ? { url } : undefined);
        spanProcessors.push(new BatchSpanProcessor(exporter));
      } catch (e) {
        spanProcessors.push(new InMemorySpanProcessor(_memorySpans));
        _initError = e;
      }
    }

    if (spanProcessors.length === 0) {
      spanProcessors.push(new InMemorySpanProcessor(_memorySpans));
    }

    const provider = new BasicTracerProvider({ resource });
    for (const p of spanProcessors) provider.addSpanProcessor(p);

    // Best-effort global registration (only first call sticks in OTel API).
    try {
      api.trace.setGlobalTracerProvider(provider);
    } catch (_) {
      /* ignore */
    }

    _sdk = provider;
    // Always take tracer from OUR provider so re-init after shutdown works in tests.
    _tracer = provider.getTracer('civs-integration-runner', '0.1.0');
    _started = true;
    return { ok: true, mode, file: _fileStream || undefined };
  } catch (e) {
    _initError = e;
    _started = true;
    _tracer = null;
    return { ok: false, mode: 'error', error: String(e && e.message ? e.message : e) };
  }
}

function getTracer() {
  if (!_started) initTelemetry();
  return _tracer;
}

function _finishOk(span, api, result) {
  try {
    if (result && typeof result === 'object') {
      if (result.status != null) {
        span.setAttribute('result.status', resultStatusAttr(result.status));
      }
      if (
        result.ok === false ||
        result.success === false ||
        (result.status && ['FAIL', 'BLOCKED'].includes(String(result.status).toUpperCase()))
      ) {
        if (api) span.setStatus({ code: api.SpanStatusCode.ERROR });
      } else if (result.status && String(result.status).toUpperCase() === 'PASS') {
        if (api) span.setStatus({ code: api.SpanStatusCode.OK });
      }
    }
  } catch (_) {
    /* ignore */
  }
}

function _finishErr(span, api, err) {
  try {
    if (api) {
      span.recordException(err);
      span.setStatus({
        code: api.SpanStatusCode.ERROR,
        message: String(err && err.message ? err.message : err).slice(0, 500),
      });
      span.setAttribute('error.type', err && err.name ? err.name : 'Error');
      span.setAttribute('result.status', 'FAIL');
    }
  } catch (_) {
    /* ignore */
  }
}

/**
 * Run `fn` inside a span. Supports sync and async callbacks.
 * Never throws due to telemetry; rethrows fn errors.
 */
function withSpan(name, attrs, fn) {
  const tracer = getTracer();
  if (!tracer || typeof tracer.startActiveSpan !== 'function') {
    return fn();
  }
  const api = loadApi();
  return tracer.startActiveSpan(name, { attributes: safeAttrs(attrs) || {} }, (span) => {
    try {
      const result = fn(span);
      if (result && typeof result.then === 'function') {
        return Promise.resolve(result).then(
          (v) => {
            _finishOk(span, api, v);
            span.end();
            return v;
          },
          (err) => {
            _finishErr(span, api, err);
            span.end();
            throw err;
          }
        );
      }
      _finishOk(span, api, result);
      span.end();
      return result;
    } catch (err) {
      _finishErr(span, api, err);
      span.end();
      throw err;
    }
  });
}

function setSpanAttrs(span, attrs) {
  if (!span || !attrs) return;
  try {
    const safe = safeAttrs(attrs);
    if (!safe) return;
    for (const [k, v] of Object.entries(safe)) span.setAttribute(k, v);
  } catch (_) {
    /* ignore */
  }
}

function recordResultStatus(span, status) {
  if (!span || status == null) return;
  try {
    const s = resultStatusAttr(status);
    span.setAttribute('result.status', s);
    const api = loadApi();
    if (!api) return;
    const up = String(s).toUpperCase();
    if (up === 'FAIL' || up === 'BLOCKED') {
      span.setStatus({ code: api.SpanStatusCode.ERROR, message: up });
    } else if (up === 'PASS' || up === 'OBSERVED') {
      span.setStatus({ code: api.SpanStatusCode.OK });
    }
  } catch (_) {
    /* ignore */
  }
}

async function shutdownTelemetry() {
  try {
    if (_sdk && typeof _sdk.shutdown === 'function') await _sdk.shutdown();
  } catch (_) {
    /* ignore */
  }
  _sdk = null;
  _tracer = null;
  _started = false;
}

function getMemorySpans() {
  return _memorySpans.slice();
}

function clearMemorySpans() {
  _memorySpans.length = 0;
}

/** Test helper: allow re-init (does not reset OTel global singleton). */
function _resetForTests() {
  _started = false;
  _tracer = null;
  _sdk = null;
  _memorySpans = [];
  _fileStream = null;
  _initError = null;
}

function redactSecretsFromObject(obj) {
  return safeAttrs(obj) || {};
}

module.exports = {
  initTelemetry,
  shutdownTelemetry,
  withSpan,
  setSpanAttrs,
  recordResultStatus,
  getTracer,
  getMemorySpans,
  clearMemorySpans,
  safeAttrs,
  resultStatusAttr,
  redactSecretsFromObject,
  STATUS_VOCAB,
  SECRET_KEY,
  _resetForTests,
};
