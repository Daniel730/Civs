#!/usr/bin/env node
/**
 * Civs integration-test runner (two-layer architecture).
 *
 *   Cursor / CI  ->  Scenario (DSL)  ->  this runner
 *        ├─ ACTOR (raw keep-alive client / Mineflayer):  performs player actions -> production code
 *        └─ HARNESS (RCON):                               observes internal state + resets
 *        ->  Assertions  ->  JUnit XML  (+ evidence bundle on failure)
 *
 * Zero manual interaction. Config via env: RCON_HOST/PORT/PASSWORD, MC_HOST/PORT,
 * MC_SERVER_MAJOR, ACTOR (0/1, default 1), ACTOR_NAME, SERVER_LOG, REPORT.
 */
const fs = require('fs');
const path = require('path');
const { Harness } = require('./lib/harness');
const { runScenario } = require('./lib/scenario');
const { writeJUnit } = require('./lib/junit');
const { RawKeepAliveActor } = require('./lib/actor');
const { capture } = require('./lib/evidence');
const { initTelemetry, shutdownTelemetry, withSpan } = require('./lib/telemetry');

const cfg = {
  rconHost: process.env.RCON_HOST || '127.0.0.1',
  rconPort: Number.parseInt(process.env.RCON_PORT || '25575', 10),
  rconPassword: process.env.RCON_PASSWORD || 'civs-itest',
  mcHost: process.env.MC_HOST || '127.0.0.1',
  mcPort: Number.parseInt(process.env.MC_PORT || '25565', 10),
  serverMajor: process.env.MC_SERVER_MAJOR || '26.1.2',
  actorEnabled: process.env.ACTOR !== '0',
  actorName: process.env.ACTOR_NAME || 'Steve',
  serverLog: process.env.SERVER_LOG || '/tmp/paper.log',
  report: process.env.REPORT || path.join(__dirname, 'reports', 'junit.xml'),
};

function loadScenarios(filter) {
  const dir = path.join(__dirname, 'scenarios');
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.js') && (!filter || f.includes(filter)))
    .sort()
    .map((f) => require(path.join(dir, f)));
}

(async () => {
  const filterIdx = process.argv.indexOf('--scenario');
  const filter = filterIdx > -1 ? process.argv[filterIdx + 1] : null;
  const log = (m) => process.stdout.write(m + '\n');

  const tel = initTelemetry({
    serviceName: process.env.OTEL_SERVICE_NAME || 'civs-integration-runner',
  });
  if (tel.mode && tel.mode !== 'none' && tel.mode !== 'disabled') {
    log(
      `Telemetry: mode=${tel.mode}${tel.file ? ' file=' + tel.file : ''}${tel.ok ? '' : ' (degraded: ' + tel.error + ')'}`
    );
  }

  await withSpan(
    'runner.session',
    {
      'agent.role': 'integration-runner',
      'agent.id': process.env.AGENT_ID || 'runner',
    },
    async () => {
      const harness = new Harness({
        host: cfg.rconHost,
        port: cfg.rconPort,
        password: cfg.rconPassword,
      });
      await harness.connect();
      const ping = await harness.ping();
      log(`Harness connected: ${ping._raw}`);

      // Actor: holds a REAL online player so actions hit production code.
      let actor = {
        available: false,
        reason: 'actor disabled',
        name: cfg.actorName,
        async disconnect() {},
        async grantOp() {},
      };
      if (cfg.actorEnabled) {
        actor = new RawKeepAliveActor({
          host: cfg.mcHost,
          port: cfg.mcPort,
          username: cfg.actorName,
          version: cfg.serverMajor,
          sendCommand: (c) => harness.raw(c),
        });
        await actor.connect();
        log(
          `Actor '${cfg.actorName}': ${actor.available ? 'ONLINE (real player)' : 'UNAVAILABLE (' + actor.reason + ')'}`
        );
        if (actor.available) {
          await actor.grantOp();
          await new Promise((r) => setTimeout(r, 500));
        }
      }

      const evidenceDir = path.join(path.dirname(cfg.report), 'evidence');
      const deps = {
        harness,
        actor,
        log,
        serverLogPath: cfg.serverLog,
        agentId: process.env.AGENT_ID || 'runner',
        agentRole: 'integration-runner',
        // Capture an evidence bundle at failure time (before teardown).
        onFailure: async (ctx, suite) => {
          const dir = path.join(evidenceDir, suite.name.replace(/[^\w.-]+/g, '_'));
          await capture(dir, {
            harness,
            suite,
            serverLogPath: cfg.serverLog,
            playerName: ctx.playerName || actor.name,
          });
          log(`  evidence captured: ${dir}`);
        },
      };
      const scenarios = loadScenarios(filter).map((s) =>
        typeof s.build === 'function' ? s.build() : s
      );
      log(`Running ${scenarios.length} scenario(s)...`);

      const suites = [];
      for (const scenario of scenarios) {
        suites.push(await runScenario(scenario, deps));
      }

      const totals = writeJUnit(suites, cfg.report);
      log(`\nJUnit report: ${cfg.report}`);
      log(
        `TOTAL: ${totals.totalTests} assertions, ${totals.totalFail} failed, ${totals.totalErr} scenario error(s).`
      );

      try {
        await actor.disconnect();
      } catch (_) {}
      await harness.close();
      try {
        await shutdownTelemetry();
      } catch (_) {}
      process.exit(totals.totalFail === 0 && totals.totalErr === 0 ? 0 : 1);
    }
  );
})().catch(async (e) => {
  console.error('RUNNER FATAL:', e);
  try {
    await shutdownTelemetry();
  } catch (_) {}
  process.exit(2);
});
