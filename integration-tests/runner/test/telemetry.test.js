/**
 * Unit tests for OpenTelemetry instrumentation (no Minecraft server required).
 * Run: npm run test:unit
 */
const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');

const tel = require('../lib/telemetry');

function bootMemory(serviceName) {
  process.env.CIVS_OTEL_IN_MEMORY = '1';
  process.env.OTEL_TRACES_EXPORTER = 'memory';
  delete process.env.OTEL_SDK_DISABLED;
  delete process.env.CIVS_OTEL_FILE;
  tel._resetForTests();
  const r = tel.initTelemetry({ serviceName: serviceName || 'civs-otel-unit' });
  tel.clearMemorySpans();
  return r;
}

describe('telemetry secrets', () => {
  it('redacts password/token keys from attributes', () => {
    const safe = tel.safeAttrs({
      'minecraft.player': 'Steve',
      'rcon.password': 'super-secret',
      password: 'x',
      api_key: 'abc',
      'result.status': 'PASS',
    });
    assert.equal(safe['minecraft.player'], 'Steve');
    assert.equal(safe['result.status'], 'PASS');
    assert.equal(safe['rcon.password'], undefined);
    assert.equal(safe.password, undefined);
    assert.equal(safe.api_key, undefined);
  });

  it('preserves status vocabulary', () => {
    for (const s of ['OBSERVED', 'PASS', 'FAIL', 'BLOCKED', 'UNKNOWN']) {
      assert.equal(tel.resultStatusAttr(s), s);
    }
  });
});

describe('telemetry optional when no exporter', () => {
  it('init with no exporter is non-destructive no-op', async () => {
    delete process.env.OTEL_TRACES_EXPORTER;
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    delete process.env.CIVS_OTEL_IN_MEMORY;
    delete process.env.CIVS_OTEL_FILE;
    delete process.env.OTEL_SDK_DISABLED;
    await tel.shutdownTelemetry();
    tel._resetForTests();
    const r = tel.initTelemetry();
    assert.equal(r.ok, true);
    assert.equal(r.mode, 'none');
    const out = await tel.withSpan('should.noop', { 'rcon.password': 'nope' }, async () => 'ok');
    assert.equal(out, 'ok');
    assert.equal(tel.getMemorySpans().length, 0);
  });

  it('disabled SDK still runs callbacks', async () => {
    process.env.OTEL_SDK_DISABLED = 'true';
    await tel.shutdownTelemetry();
    tel._resetForTests();
    const r = tel.initTelemetry();
    assert.equal(r.mode, 'disabled');
    assert.equal(await tel.withSpan('x', {}, () => 42), 42);
    delete process.env.OTEL_SDK_DISABLED;
  });
});

describe('spans success failure nesting', () => {
  before(() => {
    bootMemory('civs-otel-unit');
  });
  beforeEach(() => {
    tel.clearMemorySpans();
  });
  after(async () => {
    await tel.shutdownTelemetry();
  });

  it('records spans on successful operations', async () => {
    await tel.withSpan('op.ok', { 'minecraft.action': 'observe' }, async (span) => {
      tel.recordResultStatus(span, 'PASS');
      return { status: 'PASS' };
    });
    const spans = tel.getMemorySpans();
    assert.ok(
      spans.some((s) => s.name === 'op.ok'),
      JSON.stringify(spans.map((s) => s.name))
    );
    const s = spans.find((s) => s.name === 'op.ok');
    assert.equal(s.attributes['minecraft.action'], 'observe');
    assert.equal(s.attributes['result.status'], 'PASS');
  });

  it('records errors on failures', async () => {
    await assert.rejects(async () => {
      await tel.withSpan('op.fail', { 'minecraft.capability': 'move_to' }, async () => {
        const err = new Error('boom');
        err.name = 'CapError';
        throw err;
      });
    }, /boom/);
    const spans = tel.getMemorySpans();
    const s = spans.find((s) => s.name === 'op.fail');
    assert.ok(s, JSON.stringify(spans.map((s) => s.name)));
    assert.equal(s.attributes['error.type'], 'CapError');
    assert.equal(s.attributes['result.status'], 'FAIL');
    assert.equal(s.status.code, 2); // SpanStatusCode.ERROR
    assert.ok((s.events || []).some((e) => e.name === 'exception'));
  });

  it('nests parent/child spans', async () => {
    await tel.withSpan('parent', { 'scenario.name': 'Demo' }, async () => {
      await tel.withSpan('child', { 'scenario.step': 'move' }, async () => {
        await tel.withSpan('grandchild', { 'rcon.operation': 'send' }, async () => 'x');
      });
    });
    const spans = tel.getMemorySpans();
    const parent = spans.find((s) => s.name === 'parent');
    const child = spans.find((s) => s.name === 'child');
    const grand = spans.find((s) => s.name === 'grandchild');
    assert.ok(
      parent && child && grand,
      JSON.stringify(spans.map((s) => ({ n: s.name, p: s.parentSpanId })))
    );
    assert.equal(child.parentSpanId, parent.spanId);
    assert.equal(grand.parentSpanId, child.spanId);
    assert.equal(parent.traceId, child.traceId);
    assert.equal(child.traceId, grand.traceId);
  });
});

describe('scenario → step → capability relationships', () => {
  it('emits nested scenario/step/capability/rcon tree', async () => {
    bootMemory('civs-otel-tree');

    const { withSpan, getMemorySpans } = tel;
    const fakeHarness = {
      raw: async (cmd) =>
        withSpan(
          'rcon.send',
          {
            'rcon.operation': 'send',
            'rcon.command_prefix': String(cmd).split(/\s+/)[0],
          },
          async () =>
            'TEST-RESULT json={"success":true,"action":"move_to","data":{"final_distance":0.4,"world":"world"}}'
        ),
    };

    // capabilities/scenario/dsl already require('./telemetry') — same singleton as `tel`.
    const { Capabilities } = require('../lib/capabilities');
    const { scenario } = require('../lib/dsl');
    const { runScenario } = require('../lib/scenario');
    const cap = new Capabilities(fakeHarness);

    const built = scenario('OtelTreeDemo')
      .step('move_to goal', async (ctx) => {
        const r = await ctx.harness.cap.moveTo('Steve', 1, 2, 3, 1000, 1.5);
        ctx.expectTrue('move_to success', r.success === true, r.reason || '');
      })
      .build();

    const harness = { ...fakeHarness, cap, assert: {} };
    const actor = { available: true, name: 'Steve', async disconnect() {}, async grantOp() {} };
    const suite = await runScenario(built, {
      harness,
      actor,
      log: () => {},
      agentId: 'unit',
      agentRole: 'integration-runner',
    });
    assert.equal(suite.error, null);
    assert.ok(suite.cases.every((c) => c.ok));

    const spans = getMemorySpans();
    const names = spans.map((s) => s.name);
    assert.ok(names.includes('scenario.run'), names.join(','));
    assert.ok(names.includes('scenario.step'), names.join(','));
    assert.ok(names.includes('minecraft.move_to'), names.join(','));
    assert.ok(names.includes('rcon.send'), names.join(','));
    assert.ok(names.includes('scenario.assertion'), names.join(','));

    const run = spans.find((s) => s.name === 'scenario.run');
    const step = spans.find((s) => s.name === 'scenario.step');
    const move = spans.find((s) => s.name === 'minecraft.move_to');
    const rcon = spans.find((s) => s.name === 'rcon.send');
    assert.equal(step.parentSpanId, run.spanId);
    assert.equal(move.parentSpanId, step.spanId);
    assert.equal(rcon.parentSpanId, move.spanId);
    assert.equal(run.attributes['scenario.name'], 'OtelTreeDemo');
    assert.equal(move.attributes['minecraft.capability'], 'move_to');
    assert.equal(move.attributes['result.status'], 'PASS');

    for (const s of spans) {
      for (const k of Object.keys(s.attributes || {})) {
        assert.ok(!/password|secret|token|api[_-]?key/i.test(k), 'leaked key ' + k);
        const v = String(s.attributes[k]);
        assert.ok(!/password\s*[=:]/i.test(v), 'leaked value in ' + k);
      }
    }
  });
});

describe('file exporter local inspect', () => {
  it('writes JSONL spans without failing host', async () => {
    const file = path.join(os.tmpdir(), `civs-otel-test-${Date.now()}.jsonl`);
    await tel.shutdownTelemetry();
    tel._resetForTests();
    process.env.CIVS_OTEL_FILE = file;
    process.env.OTEL_TRACES_EXPORTER = 'file';
    delete process.env.CIVS_OTEL_IN_MEMORY;
    tel.initTelemetry({ serviceName: 'civs-otel-file' });
    await tel.withSpan('file.span', { 'mcp.tool': 'minecraft_observe' }, async (span) => {
      tel.recordResultStatus(span, 'OBSERVED');
      return { status: 'OBSERVED' };
    });
    await tel.shutdownTelemetry();
    assert.ok(fs.existsSync(file), 'missing ' + file);
    const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
    assert.ok(lines.length >= 1);
    const row = JSON.parse(lines[0]);
    assert.equal(row.name, 'file.span');
    assert.equal(row.attributes['mcp.tool'], 'minecraft_observe');
    fs.unlinkSync(file);
    delete process.env.CIVS_OTEL_FILE;
    delete process.env.OTEL_TRACES_EXPORTER;
  });
});

describe('mcp tool span status vocabulary', () => {
  it('distinguishes FAIL vs BLOCKED vs PASS', async () => {
    bootMemory('civs-otel-status');
    for (const status of ['PASS', 'FAIL', 'BLOCKED', 'OBSERVED', 'UNKNOWN']) {
      await tel.withSpan('mcp.tool', { 'mcp.tool': 't' }, async (span) => {
        tel.recordResultStatus(span, status);
        return { status };
      });
    }
    const statuses = tel.getMemorySpans().map((s) => s.attributes['result.status']);
    assert.deepEqual(statuses.sort(), ['BLOCKED', 'FAIL', 'OBSERVED', 'PASS', 'UNKNOWN'].sort());
  });
});
