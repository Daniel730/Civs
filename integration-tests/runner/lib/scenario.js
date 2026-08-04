'use strict';

/**
 * Per-scenario execution context. Records assertions as JUnit test cases so a scenario
 * yields a `<testsuite>` with one `<testcase>` per assertion. Provides the required
 * framework verbs: execute command, wait ticks, and assert (inventory/chat/block/region/
 * economy/permission).
 */
class ScenarioContext {
  constructor({ harness, actor, log }) {
    this.harness = harness;   // low-level state assertions (server-side, via RCON)
    this.actor = actor;       // player actions (Mineflayer) — may be unavailable
    this.log = log || (() => {});
    this.cases = [];          // { name, ok, message, timeMs }
  }

  _record(name, ok, message, started) {
    const timeMs = Date.now() - started;
    this.cases.push({ name, ok, message: message || '', timeMs });
    this.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${message ? ' — ' + message : ''}`);
    return ok;
  }

  /** Record an assertion from a Harness assert.* result ({ ok, message }). */
  expect(name, assertResult) {
    const started = Date.now();
    const r = assertResult || { ok: false, message: 'no result' };
    return this._record(name, !!r.ok, r.message, started);
  }

  expectTrue(name, cond, message) {
    return this._record(name, !!cond, message, Date.now());
  }

  expectEqual(name, actual, expected) {
    const ok = String(actual) === String(expected);
    return this._record(name, ok, `expected=${expected} actual=${actual}`, Date.now());
  }

  /** Run any server command through the harness (RCON). */
  exec(cmd) { return this.harness.raw(cmd); }

  wait(ms) { return new Promise((r) => setTimeout(r, ms)); }
  waitTicks(n) { return this.wait(Math.max(0, n) * 50); } // 20 tps => 50ms/tick
}

/** Runs setup()/run()/cleanup() for one scenario, returning a JUnit testsuite object. */
async function runScenario(scenario, deps) {
  const started = Date.now();
  const ctx = new ScenarioContext(deps);
  const suite = { name: scenario.name, cases: ctx.cases, error: null };
  deps.log(`\n=== Scenario: ${scenario.name} ===`);
  try {
    if (scenario.setup) await scenario.setup(ctx);
    await scenario.run(ctx);
  } catch (e) {
    suite.error = `${e.name}: ${e.message}`;
    deps.log(`  ERROR ${suite.error}`);
  } finally {
    try { if (scenario.cleanup) await scenario.cleanup(ctx); }
    catch (e) { deps.log(`  cleanup error: ${e.message}`); }
  }
  suite.timeMs = Date.now() - started;
  return suite;
}

module.exports = { ScenarioContext, runScenario };
