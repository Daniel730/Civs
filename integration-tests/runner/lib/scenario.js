const { withSpan, setSpanAttrs, recordResultStatus } = require('./telemetry');

/**
 * Per-scenario execution context. Records assertions as JUnit test cases so a scenario
 * yields a `<testsuite>` with one `<testcase>` per assertion. Provides the required
 * framework verbs: execute command, wait ticks, and assert (inventory/chat/block/region/
 * economy/permission).
 */
class ScenarioContext {
  constructor({ harness, actor, log, serverLogPath, scenarioName, scenarioId }) {
    this.harness = harness; // low-level state OBSERVATION (server-side, via RCON)
    this.actor = actor; // player ACTIONS (real Player via raw client / Mineflayer)
    this.log = log || (() => {});
    this.serverLogPath = serverLogPath || null;
    this.scenarioName = scenarioName || null;
    this.scenarioId = scenarioId || null;
    this.cases = []; // { name, ok, message, timeMs }
    this._stepIndex = 0;
  }

  /** Byte offset of the server log now (a marker to diff error lines against later). */
  markLog() {
    try {
      return this.serverLogPath ? require('fs').statSync(this.serverLogPath).size : 0;
    } catch (_) {
      return 0;
    }
  }
  /** ERROR/SEVERE/Exception lines appended to the server log since `mark`. */
  errorsSince(mark) {
    if (!this.serverLogPath) return [];
    try {
      const fs = require('fs');
      const size = fs.statSync(this.serverLogPath).size;
      const fd = fs.openSync(this.serverLogPath, 'r');
      const len = Math.max(0, size - mark);
      const buf = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, mark);
      fs.closeSync(fd);
      // eslint-disable-next-line no-control-regex
      return buf
        .toString('utf8')
        .replace(/\u0000/g, '')
        .replace(/\x1b\[[0-9;]*m/g, '')
        .split('\n')
        .filter((l) => /\bERROR\b|\bSEVERE\b|Exception/.test(l));
    } catch (_) {
      return [];
    }
  }

  _record(name, ok, message, started) {
    const timeMs = Date.now() - started;
    this.cases.push({ name, ok, message: message || '', timeMs });
    this.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${message ? ' — ' + message : ''}`);
    return ok;
  }

  /** Record an assertion from a Harness assert.* result ({ ok, message }). */
  expect(name, assertResult) {
    return withSpan(
      'scenario.assertion',
      {
        'scenario.name': this.scenarioName || undefined,
        'scenario.id': this.scenarioId || undefined,
        'assertion.name': name,
      },
      (span) => {
        const started = Date.now();
        const r = assertResult || { ok: false, message: 'no result' };
        const ok = !!r.ok;
        this._record(name, ok, r.message, started);
        recordResultStatus(span, ok ? 'PASS' : 'FAIL');
        setSpanAttrs(span, {
          'assertion.message': r.message ? String(r.message).slice(0, 200) : undefined,
        });
        return ok;
      }
    );
  }

  expectTrue(name, cond, message) {
    return withSpan(
      'scenario.assertion',
      {
        'scenario.name': this.scenarioName || undefined,
        'scenario.id': this.scenarioId || undefined,
        'assertion.name': name,
      },
      (span) => {
        const ok = this._record(name, !!cond, message, Date.now());
        recordResultStatus(span, ok ? 'PASS' : 'FAIL');
        return ok;
      }
    );
  }

  expectEqual(name, actual, expected) {
    return withSpan(
      'scenario.assertion',
      {
        'scenario.name': this.scenarioName || undefined,
        'scenario.id': this.scenarioId || undefined,
        'assertion.name': name,
      },
      (span) => {
        const ok = String(actual) === String(expected);
        this._record(name, ok, `expected=${expected} actual=${actual}`, Date.now());
        recordResultStatus(span, ok ? 'PASS' : 'FAIL');
        return ok;
      }
    );
  }

  /** Run any server command through the harness (RCON). */
  exec(cmd) {
    return this.harness.raw(cmd);
  }

  wait(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }
  waitTicks(n) {
    return this.wait(Math.max(0, n) * 50);
  } // 20 tps => 50ms/tick

  /**
   * Optional retry helper for flaky observe/assert sequences.
   * Records a parent `scenario.retry` span with attempt count.
   */
  async withRetry(name, attempts, fn) {
    const max = Math.max(1, attempts | 0);
    return withSpan(
      'scenario.retry',
      {
        'scenario.name': this.scenarioName || undefined,
        'scenario.step': name,
        'retry.max': max,
      },
      async (span) => {
        let lastErr = null;
        for (let i = 1; i <= max; i++) {
          setSpanAttrs(span, { 'retry.attempt': i });
          try {
            const out = await fn(i);
            recordResultStatus(span, 'PASS');
            return out;
          } catch (e) {
            lastErr = e;
          }
        }
        recordResultStatus(span, 'FAIL');
        throw lastErr || new Error('retry exhausted: ' + name);
      }
    );
  }
}

/** Runs setup()/run()/cleanup() for one scenario, returning a JUnit testsuite object. */
async function runScenario(scenario, deps) {
  const started = Date.now();
  const scenarioName = scenario.name;
  const scenarioId = scenario.id || scenarioName;
  const ctx = new ScenarioContext({
    ...deps,
    scenarioName,
    scenarioId,
  });
  const suite = { name: scenario.name, cases: ctx.cases, error: null };
  deps.log(`\n=== Scenario: ${scenario.name} ===`);
  return withSpan(
    'scenario.run',
    {
      'scenario.name': scenarioName,
      'scenario.id': scenarioId,
      'agent.id': deps.agentId || undefined,
      'agent.role': deps.agentRole || undefined,
      'minecraft.player': (deps.actor && deps.actor.name) || undefined,
    },
    async (span) => {
      try {
        if (scenario.setup) {
          await withSpan(
            'scenario.setup',
            {
              'scenario.name': scenarioName,
              'scenario.id': scenarioId,
            },
            () => scenario.setup(ctx)
          );
        }
        await scenario.run(ctx);
        const failed = ctx.cases.some((c) => !c.ok);
        recordResultStatus(span, failed ? 'FAIL' : 'PASS');
      } catch (e) {
        suite.error = `${e.name}: ${e.message}`;
        deps.log(`  ERROR ${suite.error}`);
        recordResultStatus(span, 'FAIL');
        setSpanAttrs(span, { 'error.type': e.name || 'Error' });
        // Exception already recorded by withSpan on throw — rethrow path handled below without rethrow
      } finally {
        suite.timeMs = Date.now() - started;
        const failed = suite.error || ctx.cases.some((c) => !c.ok);
        if (failed && deps.onFailure) {
          try {
            await deps.onFailure(ctx, suite);
          } catch (e) {
            deps.log(`  evidence error: ${e.message}`);
          }
        }
        try {
          if (scenario.cleanup) await scenario.cleanup(ctx);
        } catch (e) {
          deps.log(`  cleanup error: ${e.message}`);
        }
      }
      suite.timeMs = Date.now() - started;
      return suite;
    }
  );
}

module.exports = { ScenarioContext, runScenario };
