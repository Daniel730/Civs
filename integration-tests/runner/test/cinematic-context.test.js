const test = require('node:test');
const assert = require('node:assert');
const { CinematicDirector } = require('../lib/observation/cinematic');

/** Minimal camera mock: available, records setSubject, trackNearSubject ok. */
function fakeCamera() {
  return {
    name: 'Cam',
    actor: { available: true },
    setSubject(subject) {
      this._subject = subject;
    },
    trackNearSubject() {
      return { status: 'PASS' };
    },
    snapshot() {
      return { subject: this._subject };
    },
  };
}

/** Harness mock: observe returns a fixed underground position; act(cam_shot) succeeds. */
function fakeHarness(y = 40) {
  return {
    cap: {
      observe() {
        return Promise.resolve({ success: true, data: { x: 5203, y, z: 5193 } });
      },
      act() {
        return Promise.resolve({
          success: true,
          reason: 'ok',
          data: { distance: 5, occluded: false, repositioned: false },
        });
      },
    },
  };
}

test('Phase 7 integration: miner underground -> camera_shot context:mining', async () => {
  const onLog = [];
  const cam = fakeCamera();
  const dir = new CinematicDirector({
    camera: cam,
    harness: fakeHarness(40), // y=40, surface ~70 => underground
    subjects: ['Steve', 'Alex'],
    tickMs: 10,
    minDwellMs: 10,
    preferredDwellMs: 20,
    maxDwellMs: 50,
    onLog: (e) => onLog.push(e),
  });
  dir.start();
  // Pin the camera on Steve so we actually exercise post-establishing shots.
  dir.forceFocus('Steve');
  dir.setActivity('Steve', 'miner');
  // First tick opens on 'new_subject' (establishing). Force the plan to expire so the next
  // tick re-selects a shot using the detected context (the real establishing.maxMs is 7s,
  // far longer than this test's dwell window).
  await dir.tick();
  dir.plan = null;
  for (let i = 0; i < 6; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await dir.tick();
  }
  dir.stop();
  const shots = onLog.filter((e) => e.action === 'camera_shot');
  assert.ok(shots.length > 1, `expected >1 camera_shot, got ${shots.length}`);
  const contextShots = shots.filter((e) => e.reason && e.reason.startsWith('context:'));
  // The miner context must surface as a context: shot at least once (after the opening shot).
  assert.ok(
    contextShots.length > 0,
    `expected context: shots, got reasons: ${shots.map((s) => s.reason).join('|')}`
  );
  assert.ok(
    contextShots.some((s) => s.reason.includes('mining')),
    `expected context:mining, reasons: ${contextShots.map((s) => s.reason).join('|')}`
  );
});

test('Phase 7 integration: open builder still uses activity rotation (no context shot)', async () => {
  const onLog = [];
  const cam = fakeCamera();
  const dir = new CinematicDirector({
    camera: cam,
    harness: fakeHarness(72), // y=72, above surface => open
    subjects: ['Steve', 'Alex'],
    tickMs: 10,
    minDwellMs: 10,
    preferredDwellMs: 20,
    maxDwellMs: 50,
    onLog: (e) => onLog.push(e),
  });
  dir.start();
  dir.forceFocus('Steve');
  dir.setActivity('Steve', 'builder');
  await dir.tick();
  dir.plan = null;
  for (let i = 0; i < 6; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await dir.tick();
  }
  dir.stop();
  const shots = onLog.filter((e) => e.action === 'camera_shot');
  const contextShots = shots.filter((e) => e.reason && e.reason.startsWith('context:'));
  // Open + non-discovery => no context: shot (falls through to activity rotation).
  assert.ok(
    contextShots.length === 0,
    `expected no context: shots for open builder, got: ${contextShots.map((s) => s.reason).join('|')}`
  );
});
