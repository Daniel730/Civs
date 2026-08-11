const test = require('node:test');
const assert = require('node:assert');
const { detectContext, spaceRotation } = require('../lib/observation/context');
const { selectShot, SHOTS } = require('../lib/observation/shots');

test('detectContext: miner underground is closed space', () => {
  const ctx = detectContext({ activity: 'miner', y: 40, surfaceY: 70 });
  assert.strictEqual(ctx.space, 'closed');
  assert.ok(ctx.reason.includes('mining') || ctx.reason.includes('underground'));
});

test('detectContext: builder above surface is open', () => {
  const ctx = detectContext({ activity: 'builder', y: 72, surfaceY: 70 });
  assert.strictEqual(ctx.space, 'open');
});

test('detectContext: combat event implies indoor enclosure', () => {
  const ctx = detectContext({ activity: 'farmer', event: { kind: 'combat', priority: 85 } });
  assert.strictEqual(ctx.combat, true);
  assert.strictEqual(ctx.space, 'indoor');
});

test('detectContext: high novelty is a discovery', () => {
  const ctx = detectContext({ activity: 'farmer', novelty: 0.7 });
  assert.strictEqual(ctx.discovery, true);
});

test('spaceRotation: closed space favours tight shots', () => {
  const rot = spaceRotation('miner', { space: 'closed', combat: false, discovery: false });
  for (const s of rot)
    assert.ok(['low', 'close', 'over_shoulder', 'medium'].includes(s), `unexpected ${s}`);
});

test('spaceRotation: open space leads with environment wides', () => {
  const rot = spaceRotation('builder', { space: 'open', combat: false, discovery: false });
  assert.strictEqual(rot[0], 'establishing');
  assert.strictEqual(rot[1], 'wide');
});

test('spaceRotation: discovery opens on a panoramic', () => {
  const rot = spaceRotation('farmer', { space: 'open', combat: false, discovery: true });
  assert.strictEqual(rot[0], 'panoramic');
});

test('selectShot: context closed miner picks a tight shot, not establishing', () => {
  const plan = selectShot({
    subject: 'Steve',
    activity: 'miner',
    isNewSubject: false,
    shotIndex: 0,
    previousShot: 'medium',
    event: null,
    context: { space: 'closed', combat: false, discovery: false, reason: 'mining' },
  });
  assert.ok(['low', 'close', 'over_shoulder', 'medium'].includes(plan.shot));
  assert.strictEqual(plan.reason.startsWith('context:'), true);
  assert.ok(SHOTS[plan.shot]);
});

test('selectShot: discovery context opens on panoramic', () => {
  const plan = selectShot({
    subject: 'Steve',
    activity: 'farmer',
    isNewSubject: false,
    shotIndex: 0,
    previousShot: 'medium',
    event: null,
    context: { space: 'open', combat: false, discovery: true, reason: 'discovery' },
  });
  assert.strictEqual(plan.shot, 'panoramic');
});

test('selectShot: open non-dislosure still uses activity rotation', () => {
  const plan = selectShot({
    subject: 'Steve',
    activity: 'builder',
    isNewSubject: false,
    shotIndex: 0,
    previousShot: null,
    event: null,
    context: { space: 'open', combat: false, discovery: false, reason: 'default' },
  });
  assert.ok(['low', 'over_shoulder', 'top_down', 'medium'].includes(plan.shot));
});
