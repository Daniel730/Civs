const test = require('node:test');
const assert = require('node:assert');
const {
  HermesBridge,
  HermesPlanner,
  LocalHermesStub,
  AgentBus,
  makeWorldMemory,
  evaluateTriggers,
  makeMessage,
} = require('@daniel730/aiworld/hermes-bridge');

test('evaluateTriggers: low confidence triggers consult', () => {
  const r = evaluateTriggers({}, {}, { confidence: 0.1 });
  assert.equal(r.consult, true);
  assert.ok(r.reasons.includes('low_confidence'));
});

test('evaluateTriggers: high novelty triggers consult', () => {
  const r = evaluateTriggers({}, {}, { novelty: 0.9 });
  assert.equal(r.consult, true);
  assert.ok(r.reasons.includes('high_novelty'));
});

test('evaluateTriggers: repeated failure triggers consult', () => {
  const r = evaluateTriggers({}, {}, { failedAttempts: 5 });
  assert.equal(r.consult, true);
  assert.ok(r.reasons.includes('repeated_failure'));
});

test('evaluateTriggers: explicit ask triggers consult', () => {
  const r = evaluateTriggers({}, {}, { explicitAsk: true });
  assert.equal(r.consult, true);
  assert.ok(r.reasons.includes('explicit_ask'));
});

test('evaluateTriggers: confident + known situation does NOT consult', () => {
  const r = evaluateTriggers({}, {}, { confidence: 0.9, novelty: 0.1, failedAttempts: 0 });
  assert.equal(r.consult, false);
});

test('HermesPlanner.propose returns operational advice via stub', async () => {
  const stub = new LocalHermesStub();
  const p = new HermesPlanner({ transport: stub, timeoutMs: 1000 });
  const res = await p.propose({
    agentId: 'Steve',
    goalKey: 'Steve:maintain:farmer:farm',
    stage: 'CONSULT_LLM',
    escalated: true,
    focus: 'maintain',
    job: 'farmer',
    noProgressMs: 30000,
    goalAgeMs: 60000,
  });
  assert.ok(res);
  assert.equal(res.focus, 'maintain'); // continue_current_plan maps to ctx.focus
  assert.ok(res.hermes);
  assert.equal(res.hermes.type, 'AI_RESPONSE');
  assert.ok(Array.isArray(res.hermes.actions));
  assert.ok(res.hermes.reasoning_summary); // operational only, no CoT
});

test('HermesPlanner: timeout + unavailable -> returns null (local policy safe)', async () => {
  // Stub that never resolves within the timeout window.
  const hanging = {
    async query() {
      return new Promise(() => {});
    },
  };
  const p = new HermesPlanner({ transport: hanging, timeoutMs: 50 });
  const res = await p.propose({
    agentId: 'Steve',
    goalKey: 'g',
    stage: 'CONSULT_LLM',
    escalated: true,
    focus: 'maintain',
  });
  assert.equal(res, null); // gate proceeds with deterministic ladder
});

test('HermesBridge.ask: returns operational response or safe fallback', async () => {
  const bridge = new HermesBridge({ transport: new LocalHermesStub() });
  const ans = await bridge.ask('Steve', 'I found a huge cave, should I explore?', {
    novelty: 0.8,
    healthPct: 0.9,
  });
  assert.ok(ans.decision);
  assert.ok(ans.reasoning_summary);
});

test('HermesBridge.ask: Hermes down -> local fallback, never throws', async () => {
  const down = {
    async query() {
      throw new Error('connection refused');
    },
  };
  const bridge = new HermesBridge({ transport: down, timeoutMs: 200 });
  const ans = await bridge.ask('Steve', 'help?', {});
  assert.equal(ans.source, 'fallback');
  assert.ok(ans.actions.includes('keep_working'));
});

test('AgentBus: publish/subscribe delivers messages (NPC <-> NPC, Hermes <-> NPC)', async () => {
  const bus = new AgentBus();
  const got = [];
  await bus.subscribe('Alex', (m) => got.push(m));
  await bus.publish(
    makeMessage({
      sender: 'Steve',
      receiver: 'Alex',
      intent: 'share',
      content: 'cave north',
      context: { factKey: 'cave:north' },
    })
  );
  assert.equal(got.length, 1);
  assert.equal(got[0].sender, 'Steve');
  assert.equal(got[0].content, 'cave north');
});

test('HermesBridge.tell with intent share mirrors into world memory', async () => {
  const bridge = new HermesBridge({ transport: new LocalHermesStub() });
  await bridge.tell('Steve', 'Alex', 'share', 'iron at north mine', { factKey: 'mine:north_iron' });
  const f = bridge.worldMemory.get('mine:north_iron');
  assert.ok(f);
  assert.equal(f.value, 'iron at north mine');
  assert.equal(f.stale, false);
});

test('HermesBridge.hermesAsks: Hermes can push a question to an agent', async () => {
  const bridge = new HermesBridge({ transport: new LocalHermesStub() });
  const got = [];
  await bridge.bus.subscribe('Steve', (m) => got.push(m));
  const r = await bridge.hermesAsks('Steve', 'what resources are missing?', { urgency: 'normal' });
  assert.equal(r.delivered, true);
  assert.equal(got[0].sender, 'hermes');
  assert.equal(got[0].content, 'what resources are missing?');
});

test('makeWorldMemory: stale flag can be set (brief §18 — memory may be wrong)', () => {
  const wm = makeWorldMemory();
  wm.set('bridge:state', 'intact', { stale: true });
  const f = wm.get('bridge:state');
  assert.equal(f.value, 'intact');
  assert.equal(f.stale, true);
});
