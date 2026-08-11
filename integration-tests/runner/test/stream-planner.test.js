/**
 * Unit tests for stream shot planner / health (no Minecraft required).
 * Run from runner: node --test test/stream-planner.test.js
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { ShotPlanner } = require('../lib/stream/shot-planner');
const { summarize, STATES } = require('../lib/stream/health');

describe('ShotPlanner', () => {
  it('exposes cinematic modes', () => {
    assert.ok(ShotPlanner.modes.includes('follow'));
    assert.ok(ShotPlanner.modes.includes('overhead'));
    assert.ok(ShotPlanner.modes.includes('idle'));
  });

  it('respects cooldown and avoids immediate repeat', () => {
    let n = 0;
    const rng = () => {
      n += 1;
      return 0.1;
    };
    const p = new ShotPlanner({ cooldownMs: 60_000, minDurationMs: 1, maxDurationMs: 2, rng });
    const a = p.nextShot({ now: 1_000, force: true, mode: 'follow' });
    assert.equal(a.mode, 'follow');
    const b = p.nextShot({ now: 1_000 + 5_000 });
    assert.notEqual(b.mode, 'follow');
  });

  it('event priority prefers event/follow/orbit pool', () => {
    const p = new ShotPlanner({
      cooldownMs: 0,
      minDurationMs: 1,
      maxDurationMs: 2,
      rng: () => 0,
    });
    p.nextShot({ now: 1, force: true, mode: 'idle' });
    const e = p.nextShot({ now: 100, event: true });
    assert.ok(['event', 'follow', 'orbit'].includes(e.mode));
  });

  it('poseFor returns spectate for follow and teleport for wide', () => {
    const p = new ShotPlanner();
    const t = { x: 10, y: 64, z: 20 };
    assert.equal(p.poseFor('follow', t).kind, 'spectate');
    const wide = p.poseFor('wide', t);
    assert.equal(wide.kind, 'teleport_look');
    assert.ok(wide.y > t.y);
  });

  it('keeps history bounded', () => {
    const p = new ShotPlanner({
      historyLimit: 5,
      cooldownMs: 0,
      minDurationMs: 0,
      maxDurationMs: 1,
      rng: () => 0.5,
    });
    for (let i = 0; i < 20; i++) p.nextShot({ now: i * 10_000, force: true, mode: 'idle' });
    assert.ok(p.history.length <= 5);
  });
});

describe('stream health summarize', () => {
  it('worst-wins across components', () => {
    const s = summarize({
      minecraft: { state: 'HEALTHY' },
      obs: { state: 'DEGRADED' },
      stream: { state: 'BLOCKED' },
    });
    assert.equal(s.overall, 'BLOCKED');
    assert.ok(STATES.includes(s.overall));
  });

  it('healthy when all healthy', () => {
    const s = summarize({
      minecraft: { state: 'HEALTHY' },
      obs: { state: 'HEALTHY' },
    });
    assert.equal(s.overall, 'HEALTHY');
  });
});
