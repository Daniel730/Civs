/**
 * Lightweight DSL unit tests (no Minecraft) — mutation targets for #37.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { scenario } = require('../lib/dsl');

describe('scenario DSL', () => {
  it('builds named scenario with run/cleanup', () => {
    const s = scenario('place-shelter')
      .player('Steve')
      .teleport(1, 2, 3)
      .give('STONE', 4)
      .expectNoErrors()
      .build();
    assert.equal(s.name, 'place-shelter');
    assert.equal(typeof s.run, 'function');
    assert.equal(typeof s.cleanup, 'function');
  });

  it('chains fluent returns and records steps on builder', () => {
    const b = scenario('chain');
    assert.equal(b.player('Alex'), b);
    assert.equal(b.teleport(0, 64, 0), b);
    assert.equal(b.expectRegion('shelter', 10, 20, 30), b);
    assert.ok(b.steps.length >= 3);
    assert.equal(b.steps[0].kind, 'action');
    assert.match(b.steps[0].desc, /player/);
    assert.equal(b.steps[2].kind, 'expect');
  });

  it('scenario factory returns a builder', () => {
    const b = scenario('x');
    assert.equal(b.name, 'x');
    assert.ok(Array.isArray(b.steps));
  });
});
