#!/usr/bin/env node
/**
 * Empirically validate OTel parent/child tree for the closest real path available
 * without requiring Hermes:
 *   scenario.run → scenario.step → minecraft.move_to → rcon.send
 *
 * Also simulates an MCP tool parent when --mcp is passed (in-process, no Hermes).
 *
 * Env:
 *   CIVS_OTEL_IN_MEMORY=1 (default here)
 *   CIVS_OTEL_FILE=path   optional JSONL dump
 *
 * Exit 0 only if the expected tree is observed.
 */
const path = require('path');
const fs = require('fs');

process.env.CIVS_OTEL_IN_MEMORY = process.env.CIVS_OTEL_IN_MEMORY || '1';
process.env.OTEL_TRACES_EXPORTER = process.env.OTEL_TRACES_EXPORTER || 'memory';
if (!process.env.CIVS_OTEL_FILE) {
  process.env.CIVS_OTEL_FILE = path.join(__dirname, '..', 'reports', 'otel-validate-spans.jsonl');
}

const tel = require('../lib/telemetry');
tel._resetForTests();
const init = tel.initTelemetry({ serviceName: 'civs-otel-validate' });
console.log('init', init);

const { Capabilities } = require('../lib/capabilities');
const { scenario } = require('../lib/dsl');
const { runScenario } = require('../lib/scenario');

async function main() {
  const wantMcp = process.argv.includes('--mcp');

  const fakeHarness = {
    raw: async (cmd) =>
      tel.withSpan(
        'rcon.send',
        {
          'rcon.operation': 'send',
          'rcon.command_prefix': String(cmd).split(/\s+/)[0],
        },
        async () => {
          if (String(cmd).includes('move_to')) {
            return 'TEST-RESULT json={"success":true,"action":"move_to","data":{"final_distance":0.2,"world":"world"}}';
          }
          return 'TEST-RESULT json={"success":true,"action":"observe","data":{"x":1,"y":2,"z":3,"world":"world"}}';
        }
      ),
  };
  const cap = new Capabilities(fakeHarness);
  const harness = { ...fakeHarness, cap };

  const runBody = async () => {
    const built = scenario('OtelValidateMoveTo')
      .step('move_to goal', async (ctx) => {
        const r = await ctx.harness.cap.moveTo('Steve', 808.5, -60, 800.5, 15000, 1.5);
        ctx.expectTrue('move_to success', r.success === true, r.reason || '');
      })
      .step('observe', async (ctx) => {
        const r = await ctx.harness.cap.observe('Steve');
        ctx.expectTrue('observe ok', r.success === true, r.reason || '');
      })
      .build();

    return runScenario(built, {
      harness,
      actor: { available: true, name: 'Steve', async disconnect() {}, async grantOp() {} },
      log: (m) => console.log(m),
      agentId: 'validate',
      agentRole: 'integration-runner',
    });
  };

  let suite;
  if (wantMcp) {
    suite = await tel.withSpan(
      'mcp.tool',
      {
        'mcp.tool': 'minecraft_move_to',
        'agent.role': 'minecraft-qa',
        'agent.id': 'validate-mcp',
        'minecraft.player': 'Steve',
      },
      async (span) => {
        tel.recordResultStatus(span, 'PASS');
        return runBody();
      }
    );
  } else {
    suite = await runBody();
  }

  await tel.shutdownTelemetry();
  const spans = tel.getMemorySpans();
  const file = process.env.CIVS_OTEL_FILE;
  if (file && fs.existsSync(file)) {
    console.log('FILE', file, 'bytes', fs.statSync(file).size);
  }

  function find(name) {
    return spans.filter((s) => s.name === name);
  }
  const tree = spans.map((s) => ({
    name: s.name,
    spanId: s.spanId,
    parentSpanId: s.parentSpanId,
    status: s.attributes && s.attributes['result.status'],
    attrs: s.attributes,
  }));
  console.log('SPANS', JSON.stringify(tree, null, 2));

  const run = find('scenario.run')[0];
  const steps = find('scenario.step');
  const move = find('minecraft.move_to')[0];
  const rcons = find('rcon.send');
  const asserts = find('scenario.assertion');

  const errors = [];
  if (!run) errors.push('missing scenario.run');
  if (steps.length < 2) errors.push('expected >=2 scenario.step');
  if (!move) errors.push('missing minecraft.move_to');
  if (!rcons.length) errors.push('missing rcon.send');
  if (!asserts.length) errors.push('missing scenario.assertion');

  if (run && steps[0] && steps[0].parentSpanId !== run.spanId) {
    errors.push('step not child of scenario.run');
  }
  if (move && steps[0] && move.parentSpanId !== steps[0].spanId) {
    errors.push('minecraft.move_to not child of first scenario.step');
  }
  const moveRcon = rcons.find((r) => r.parentSpanId === (move && move.spanId));
  if (!moveRcon) errors.push('rcon.send not child of minecraft.move_to');

  if (wantMcp) {
    const mcp = find('mcp.tool')[0];
    if (!mcp) errors.push('missing mcp.tool');
    else if (run && run.parentSpanId !== mcp.spanId)
      errors.push('scenario.run not child of mcp.tool');
  }

  if (suite.error) errors.push('suite.error=' + suite.error);
  if (suite.cases.some((c) => !c.ok)) errors.push('assertion failures');

  if (errors.length) {
    console.error('OTEL_VALIDATE FAIL', errors);
    process.exit(1);
  }
  console.log(
    'OTEL_VALIDATE PASS tree=scenario→step→move_to→rcon' + (wantMcp ? ' (under mcp.tool)' : '')
  );
}

main().catch((e) => {
  console.error('OTEL_VALIDATE ERROR', e);
  process.exit(2);
});
