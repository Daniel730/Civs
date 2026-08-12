/**
 * Ollama brain — local LLM decision layer. Offline-safe: if no Ollama server answers, decide()
 * returns null so the worker falls back to the deterministic chooseFocus (NPC never breaks).
 */
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const ROOT = 'C:\\Users\\Danie\\Downloads\\Civs-1.11.6\\Civs-1.11.6\\integration-tests\\runner';

test('OllamaBrain.decide returns null when no server is reachable (fallback path)', async () => {
  const { OllamaBrain } = require(path.join(ROOT, 'lib', 'ai-world', 'ollama-brain'));
  // Point at a port where nothing listens -> isAvailable() false -> decide() null
  const brain = new OllamaBrain({ endpoint: 'http://127.0.0.1:9', model: 'x', timeoutMs: 300 });
  const decision = await brain.decide({ healthPct: 1, survivalState: 'DANGER', threats: ['zombie'] });
  assert.strictEqual(decision, null, 'no server -> null -> worker uses deterministic focus');
});

test('OllamaBrain.decide parses a JSON focus from the model response', async () => {
  const { OllamaBrain } = require(path.join(ROOT, 'lib', 'ai-world', 'ollama-brain'));
  // Stub the http layer by overriding postJSON via a fake module is overkill; instead test the
  // pure helpers (buildPrompt + extractJSON) which the worker depends on.
  const mod = require(path.join(ROOT, 'lib', 'ai-world', 'ollama-brain'));
  const json = mod.extractJSON('here is your answer: {"focus":"build","reason":"settlement needs a wall"} done');
  assert.ok(json && json.focus === 'build', 'extractJSON pulls the focus object out of prose');
  assert.strictEqual(json.reason, 'settlement needs a wall');
  const bad = mod.extractJSON('no json here');
  assert.strictEqual(bad, null, 'extractJSON returns null when no JSON present');
});

test('OllamaBrain reads OLLAMA_MODEL env as default model (trained civs-brain)', () => {
  const { OllamaBrain } = require(path.join(ROOT, 'lib', 'ai-world', 'ollama-brain'));
  const prev = process.env.OLLAMA_MODEL;
  process.env.OLLAMA_MODEL = 'civs-brain';
  try {
    const brain = new OllamaBrain({}); // no explicit model -> must pick up env
    assert.strictEqual(brain.model, 'civs-brain', 'defaults to trained civs-brain when env set');
  } finally {
    if (prev === undefined) delete process.env.OLLAMA_MODEL;
    else process.env.OLLAMA_MODEL = prev;
  }
});

test('OllamaBrain explicit model overrides env', () => {
  const { OllamaBrain } = require(path.join(ROOT, 'lib', 'ai-world', 'ollama-brain'));
  const prev = process.env.OLLAMA_MODEL;
  process.env.OLLAMA_MODEL = 'civs-brain';
  try {
    const brain = new OllamaBrain({ model: 'llama3.1:8b' });
    assert.strictEqual(brain.model, 'llama3.1:8b', 'explicit model wins over env');
  } finally {
    if (prev === undefined) delete process.env.OLLAMA_MODEL;
    else process.env.OLLAMA_MODEL = prev;
  }
});

test('OllamaBrain.buildPrompt injects full world-memory into the user snapshot', () => {
  const { buildPrompt } = require(path.join(ROOT, 'lib', 'ai-world', 'ollama-brain'));
  const [system, user] = buildPrompt({
    healthPct: 0.5,
    survivalState: 'CAUTION',
    x: 10, z: 20,
    threats: ['zombie'],
    nearestThreatDist: 8,
    dangerZone: false,
    worldMemory: { threatsRemembered: 3, blocksPlaced: 2, blocksBroken: 1 },
    currentFocus: 'build',
    completedPlaces: 3,
  });
  assert.ok(/memory:/.test(user.content), 'memory line present in prompt');
  assert.ok(user.content.includes('3 threat(s) remembered'), 'remembered threats shown');
  assert.ok(user.content.includes('placed 2 block(s)'), 'blocks placed shown');
  assert.ok(user.content.includes('broke 1 block(s)'), 'blocks broken shown');
  assert.ok(/health: 50%/.test(user.content), 'health percentage formatted');
});

test('OllamaBrain.buildPrompt shows "nothing remembered" when memory empty', () => {
  const { buildPrompt } = require(path.join(ROOT, 'lib', 'ai-world', 'ollama-brain'));
  const [, user] = buildPrompt({ healthPct: 1, survivalState: 'SAFE', worldMemory: {}, currentFocus: 'maintain', completedPlaces: 0 });
  assert.ok(/memory: nothing remembered yet/.test(user.content), 'empty memory stated clearly');
});

test('OllamaBrain.decide uses injected transport and returns model focus (memory-aware E2E)', async () => {
  const { OllamaBrain } = require(path.join(ROOT, 'lib', 'ai-world', 'ollama-brain'));
  // Mock transport: /api/tags -> 200 (available); /api/generate -> model says "build"
  const transport = async (endpoint, p, payload) => {
    if (p === '/api/tags') return { status: 200, body: '{}' };
    if (p === '/api/generate') {
      // Echo back that the model chose 'build' with a memory-aware reason
      return { status: 200, body: JSON.stringify({ response: '{"focus":"build","reason":"settlement needs walls; 3 threats remembered nearby","target":null}' }) };
    }
    return { status: 404, body: '' };
  };
  const brain = new OllamaBrain({ transport, model: 'hermes-agent-mc:latest' });
  const decision = await brain.decide({
    healthPct: 0.6, survivalState: 'CAUTION', x: 10, z: 20,
    threats: ['zombie'], nearestThreatDist: 8, dangerZone: false,
    worldMemory: { threatsRemembered: 3, blocksPlaced: 2, blocksBroken: 1 },
    currentFocus: 'maintain', completedPlaces: 3,
  });
  assert.ok(decision && decision.focus === 'build', 'model focus (build) accepted');
  assert.ok(/3 threats remembered/.test(decision.reason), 'model reason reflects memory context');
});

test('OllamaBrain.decide returns null on invalid focus from model (falls back)', async () => {
  const { OllamaBrain } = require(path.join(ROOT, 'lib', 'ai-world', 'ollama-brain'));
  const transport = async (endpoint, p) => {
    if (p === '/api/tags') return { status: 200, body: '{}' };
    if (p === '/api/generate') return { status: 200, body: JSON.stringify({ response: '{"focus":"fly_away","reason":"nonsense","target":null}' }) };
    return { status: 404, body: '' };
  };
  const brain = new OllamaBrain({ transport, model: 'x' });
  const decision = await brain.decide({ healthPct: 1, survivalState: 'SAFE', worldMemory: {} });
  assert.strictEqual(decision, null, 'invalid focus -> null -> deterministic fallback');
});
