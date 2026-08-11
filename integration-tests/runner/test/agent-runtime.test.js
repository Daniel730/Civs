const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const rt = require('../lib/ai-world/agent-runtime');
const { EVENT } = require('../lib/ai-world/events');

test('loadOrCreateAgent: fresh agent has bounded memory + goals', () => {
  const a = rt.loadOrCreateAgent('TestUnit', { occupation: 'builder' });
  assert.equal(a.identity.name, 'TestUnit');
  assert.equal(a.identity.occupation, 'builder');
  assert.ok(a.memory.episodic);
  assert.ok(a.memory.semantic);
  assert.ok(a.goals);
});

test('loadOrCreateAgent: restores a previously saved agent (survives restart)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-rt-'));
  const orig = rt.AGENTS_DIR;
  rt.AGENTS_DIR = dir; // point at a temp dir
  try {
    const a1 = rt.loadOrCreateAgent('PersistMe', { occupation: 'farmer' });
    rt.recordFact(a1, 'cave:north', { x: 1, z: 2 }, 0.9);
    rt.recordEpisode(a1, { type: 'quest_complete', summary: 'did a thing', importance: 0.8 });
    rt.saveAgent(a1);

    // Simulate a fresh process: same name → should load the saved memory.
    const a2 = rt.loadOrCreateAgent('PersistMe', { occupation: 'farmer' });
    assert.equal(a2.memory.semantic['cave:north'].value.x, 1);
    assert.equal(a2.memory.episodic.length, 1);
    assert.equal(a2.memory.episodic[0].summary, 'did a thing');
  } finally {
    rt.AGENTS_DIR = orig;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('scoreFor: builds observation + ranks intents by personality', () => {
  const a = rt.loadOrCreateAgent('Scorer', { occupation: 'builder' });
  const obs = { success: true, data: { health: 20, food: 18, x: 1, y: 64, z: 1 } };
  const { observation, candidates, topIntent } = rt.scoreFor(a, obs);
  assert.ok(observation.local);
  assert.ok(Array.isArray(candidates));
  assert.ok(candidates.length > 0);
  assert.equal(typeof topIntent, 'string');
  // Builder should rank 'build' / construction-flavoured intents above exploration.
  const build = candidates.find((c) => c.motive === 'construction');
  const explore = candidates.find((c) => c.motive === 'exploration');
  if (build && explore) assert.ok(build.score >= explore.score);
});

test('emit: mirrors important events into episodic memory', () => {
  const a = rt.loadOrCreateAgent('Emitter', { occupation: 'explorer' });
  const events = [];
  rt.emit(a, events, EVENT.QUEST_COMPLETE, { questId: 'q1', summary: 'finished quest' });
  assert.equal(events.length, 1);
  assert.equal(a.memory.episodic.length, 1);
  assert.equal(a.memory.episodic[0].type, 'quest_complete');
});

test('commitGoal / closeCurrentGoal: manage the agent current goal', () => {
  const a = rt.loadOrCreateAgent('Goaler', { occupation: 'guard' });
  assert.equal(a.goals.current, null);
  rt.commitGoal(a, { title: 'Build a fence', motive: 'construction', priority: 0.8 });
  assert.ok(a.goals.current);
  assert.equal(a.goals.current.title, 'Build a fence');
  const closed = rt.closeCurrentGoal(a, 'done');
  assert.equal(closed.status, 'done');
  assert.equal(a.goals.current, null);
});

test('recordSocial: updates social memory with trust bounds', () => {
  const a = rt.loadOrCreateAgent('Social', { occupation: 'merchant' });
  rt.recordSocial(a, 'Alex', { deltaTrust: 0.5, note: 'helped build' });
  assert.equal(a.memory.social.Alex.trust, 0.5);
  rt.recordSocial(a, 'Alex', { deltaTrust: 5 }); // clamps to +1
  assert.equal(a.memory.social.Alex.trust, 1);
});
