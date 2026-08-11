/**
 * Unit tests for the two Steve/Alex follow-ups that live off-server:
 *   - harness.parseBalance: exact money delta at large balances (the #67 balance=1e6 case)
 *   - ConsultGate / StubPlanner: CONSULT_LLM hook, default off, never per-tick
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const { parseBalance, centsToMoney } = require('../lib/harness');
const { ConsultGate, StubPlanner, plannerFromEnv } = require('../lib/ai-world/consult-planner');
const { AntiStall, STALL_LADDER } = require('../lib/ai-world/intention-cache');

test.describe('parseBalance (money probe hardening)', () => {
  test('reproduces the balance=1e6 delta case exactly', () => {
    // Regression: parseFloat + float subtraction hid a 0.05 reward at 1e6.
    const before = parseBalance('1000000.00');
    const after = parseBalance('1000000.05');
    assert.equal(before, 100000000);
    assert.equal(after - before, 5); // exactly 5 cents, never 0
  });

  test('delta 0 at 1e6 really is 0 (no phantom deltas)', () => {
    assert.equal(parseBalance('1000000.00') - parseBalance('1000000.00'), 0);
    assert.equal(parseBalance('1.0E6') - parseBalance('1000000'), 0);
  });

  test('parses locale grouping and currency symbols', () => {
    assert.equal(parseBalance('1,000,000.25'), 100000025);
    assert.equal(parseBalance('$ 42.10'), 4210);
    assert.equal(parseBalance('-3.5'), -350);
  });

  test('scientific notation from the harness echo', () => {
    assert.equal(parseBalance('1.0E6'), 100000000);
  });

  test('rejects junk instead of returning NaN-ish values', () => {
    assert.equal(parseBalance(''), null);
    assert.equal(parseBalance(null), null);
    assert.equal(parseBalance('abc'), null);
  });

  test('centsToMoney round-trips', () => {
    assert.equal(centsToMoney(100000005), 1000000.05);
    assert.equal(centsToMoney(null), null);
  });
});

test.describe('ConsultGate (CONSULT_LLM hook)', () => {
  const consultStall = {
    stage: 'CONSULT_LLM',
    escalated: true,
    noProgressMs: 60000,
    goalAgeMs: 90000,
  };

  test('default off: no planner → log only, never consults', async () => {
    const logs = [];
    const gate = new ConsultGate({ onLog: (e) => logs.push(e) });
    assert.equal(gate.enabled, false);
    const r = await gate.maybeConsult(consultStall, { agentId: 'Steve', goalKey: 'g1' });
    assert.equal(r.consulted, false);
    assert.equal(r.reason, 'no_planner');
    assert.equal(logs[0].action, 'consult_llm_skipped');
  });

  test('never fires outside a fresh CONSULT_LLM escalation (never per-tick)', async () => {
    const planner = new StubPlanner();
    const gate = new ConsultGate({ planner, now: () => 0 });
    // Non-consult stages
    for (const stage of ['CONTINUE', 'LOCAL_RECOVERY', 'REPLAN', 'ABANDON_GOAL']) {
      const r = await gate.maybeConsult({ stage, escalated: true }, { agentId: 'a', goalKey: 'g' });
      assert.equal(r.consulted, false);
    }
    // CONSULT_LLM but not newly escalated (i.e. repeated ticks in the same stage)
    const r = await gate.maybeConsult(
      { stage: 'CONSULT_LLM', escalated: false },
      { agentId: 'a', goalKey: 'g' }
    );
    assert.equal(r.consulted, false);
    assert.equal(planner.calls.length, 0);
  });

  test('consults once per goalKey and honours cooldown', async () => {
    let now = 0;
    const planner = new StubPlanner();
    const gate = new ConsultGate({ planner, cooldownMs: 10000, now: () => now });
    const ctx = { agentId: 'Alex', goalKey: 'g1', focus: 'gather' };

    const r1 = await gate.maybeConsult(consultStall, ctx);
    assert.equal(r1.consulted, true);
    assert.equal(r1.suggestion.focus, 'build'); // deterministic rotation gather→build

    // Same goal again: suppressed even after cooldown.
    now = 60000;
    const r2 = await gate.maybeConsult(consultStall, ctx);
    assert.equal(r2.consulted, false);
    assert.equal(r2.reason, 'already_consulted_goal');

    // New goal, inside cooldown: suppressed.
    now = 5000;
    const r3 = await gate.maybeConsult(consultStall, { ...ctx, goalKey: 'g2' });
    assert.equal(r3.consulted, false);
    assert.equal(r3.reason, 'cooldown');

    // New goal, cooldown elapsed: consulted.
    now = 15000;
    const r4 = await gate.maybeConsult(consultStall, { ...ctx, goalKey: 'g2' });
    assert.equal(r4.consulted, true);
    assert.equal(planner.calls.length, 2);
  });

  test('planner errors degrade gracefully', async () => {
    const gate = new ConsultGate({
      planner: {
        propose: async () => {
          throw new Error('boom');
        },
      },
      now: () => 0,
    });
    const r = await gate.maybeConsult(consultStall, { agentId: 'S', goalKey: 'g' });
    assert.equal(r.consulted, false);
    assert.equal(r.reason, 'planner_error');
    assert.equal(gate.snapshot().errors, 1);
  });

  test('plannerFromEnv: default off, stub selectable, unknown rejected', () => {
    assert.equal(plannerFromEnv({}), null);
    assert.equal(plannerFromEnv({ AI_WORLD_CONSULT_PLANNER: 'off' }), null);
    assert.ok(plannerFromEnv({ AI_WORLD_CONSULT_PLANNER: 'stub' }) instanceof StubPlanner);
    assert.throws(() => plannerFromEnv({ AI_WORLD_CONSULT_PLANNER: 'gpt9' }));
  });

  test('integrates with the AntiStall ladder end to end', async () => {
    let now = 0;
    const stall = new AntiStall({ noProgressMs: 5000, now: () => now });
    const planner = new StubPlanner();
    const gate = new ConsultGate({ planner, cooldownMs: 0, now: () => now });
    stall.report('Steve', { goalKey: 'k', progressValue: 1, higherIsBetter: true });

    let consulted = 0;
    for (let i = 0; i < 40; i++) {
      now += 2000;
      const r = stall.report('Steve', { goalKey: 'k', progressValue: 1, higherIsBetter: true });
      const c = await gate.maybeConsult(r, { agentId: 'Steve', goalKey: 'k', focus: 'gather' });
      if (c.consulted) consulted += 1;
    }
    assert.ok(STALL_LADDER.includes('CONSULT_LLM'));
    assert.equal(consulted, 1); // 40 ticks through the ladder → exactly one consult
    assert.equal(planner.calls.length, 1);
  });
});
