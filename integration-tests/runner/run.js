#!/usr/bin/env node
'use strict';
/**
 * Civs integration-test runner.
 *
 *   Cursor / CI  ->  Scenario Generator (scenarios/*.js)  ->  this runner
 *        ->  Harness (RCON)  +  Actor (Mineflayer, when supported)  ->  Paper server
 *        ->  Assertions (server-side internal state)  ->  JUnit XML report
 *
 * Zero manual interaction: connect, run every scenario, write JUnit XML, exit non-zero on
 * failure. Config via env: RCON_HOST, RCON_PORT, RCON_PASSWORD, MC_HOST, MC_PORT,
 * MC_SERVER_MAJOR, ACTOR (0/1), REPORT (path).
 */
const fs = require('fs');
const path = require('path');
const { Harness } = require('./lib/harness');
const { runScenario } = require('./lib/scenario');
const { writeJUnit } = require('./lib/junit');
const { createActor } = require('./lib/actor-mineflayer');

const cfg = {
  rconHost: process.env.RCON_HOST || '127.0.0.1',
  rconPort: parseInt(process.env.RCON_PORT || '25575', 10),
  rconPassword: process.env.RCON_PASSWORD || 'civs-itest',
  mcHost: process.env.MC_HOST || '127.0.0.1',
  mcPort: parseInt(process.env.MC_PORT || '25565', 10),
  serverMajor: process.env.MC_SERVER_MAJOR || null, // e.g. "26.1" to attempt the version patch
  actor: process.env.ACTOR === '1',
  report: process.env.REPORT || path.join(__dirname, 'reports', 'junit.xml'),
};

function loadScenarios(filter) {
  const dir = path.join(__dirname, 'scenarios');
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith('.js') && (!filter || f.includes(filter)))
    .sort()
    .map((f) => require(path.join(dir, f)));
}

(async () => {
  const filterIdx = process.argv.indexOf('--scenario');
  const filter = filterIdx > -1 ? process.argv[filterIdx + 1] : null;
  const log = (m) => process.stdout.write(m + '\n');

  const harness = new Harness({ host: cfg.rconHost, port: cfg.rconPort, password: cfg.rconPassword });
  await harness.connect();
  const ping = await harness.ping();
  log(`Harness connected: ${ping._raw}`);
  if (ping.civs !== 'true') log('WARNING: Civs not detected by harness.');

  // Optional player-action actor (Mineflayer). Falls back gracefully when unsupported.
  let actor = { available: false, reason: 'actor not requested', async disconnect() {} };
  if (cfg.actor) {
    actor = await createActor({ host: cfg.mcHost, port: cfg.mcPort, serverMajor: cfg.serverMajor });
    log(`Actor: ${actor.available ? 'AVAILABLE as ' + actor.username : 'UNAVAILABLE (' + actor.reason + ')'}`);
  }

  const scenarios = loadScenarios(filter);
  log(`Running ${scenarios.length} scenario(s)...`);
  const suites = [];
  for (const scenario of scenarios) {
    suites.push(await runScenario(scenario, { harness, actor, log }));
  }

  const totals = writeJUnit(suites, cfg.report);
  log(`\nJUnit report: ${cfg.report}`);
  log(`TOTAL: ${totals.totalTests} assertions, ${totals.totalFail} failed, ${totals.totalErr} scenario error(s).`);

  try { await actor.disconnect(); } catch (_) {}
  await harness.close();
  process.exit(totals.totalFail === 0 && totals.totalErr === 0 ? 0 : 1);
})().catch((e) => { console.error('RUNNER FATAL:', e); process.exit(2); });
