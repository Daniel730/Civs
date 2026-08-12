const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const {
  DirectorFSM,
  STATES,
  TRANSITIONS,
  coverageState,
} = require('../lib/observation/director-fsm');
const { CinematicDirector } = require('../lib/observation/cinematic');
const { METRIC, initMetrics, resetMetrics, metricsSnapshot } = require('../lib/metrics');

describe('DirectorFSM core', () => {
  it('starts IDLE and exposes every named state', () => {
    const fsm = new DirectorFSM({ now: () => 0 });
    assert.equal(fsm.state, 'IDLE');
    for (const s of [
      'IDLE',
      'SEARCHING',
      'ESTABLISHING',
      'FOLLOWING',
      'ACTION',
      'DRAMATIC',
      'OBSERVING',
      'TRANSITIONING',
      'RECOVERING',
    ]) {
      assert.ok(STATES.includes(s), `${s} must be a named state`);
      assert.ok(TRANSITIONS[s], `${s} must declare outgoing edges`);
    }
  });

  it('records transitions with reason, held time and a log entry', () => {
    const logs = [];
    let now = 1000;
    const fsm = new DirectorFSM({ now: () => now, onLog: (e) => logs.push(e) });
    fsm.transition('SEARCHING', 'director_started');
    now += 500;
    const r = fsm.transition('TRANSITIONING', 'first_shot');
    assert.equal(r.changed, true);
    assert.equal(fsm.lastTransition.from, 'SEARCHING');
    assert.equal(fsm.lastTransition.heldMs, 500);
    assert.equal(logs.length, 2);
    assert.equal(logs[1].action, 'director_fsm_transition');
    assert.equal(logs[1].reason, 'first_shot');
  });

  it('is idempotent for a same-state transition', () => {
    const fsm = new DirectorFSM({ now: () => 0 });
    fsm.transition('SEARCHING', 'start');
    const r = fsm.transition('SEARCHING', 'again');
    assert.equal(r.changed, false);
    assert.equal(fsm.transitions, 1);
  });

  it('flags but survives an edge outside the grammar (stream must never wedge)', () => {
    const logs = [];
    const fsm = new DirectorFSM({ now: () => 0, onLog: (e) => logs.push(e) });
    // IDLE -> FOLLOWING is not a declared edge.
    const r = fsm.transition('FOLLOWING', 'forced');
    assert.equal(r.valid, false);
    assert.equal(fsm.state, 'FOLLOWING');
    assert.equal(fsm.invalidTransitions, 1);
    assert.equal(logs[0].status, 'DEGRADED');
  });

  it('rejects unknown state names', () => {
    const fsm = new DirectorFSM({ now: () => 0 });
    assert.throws(() => fsm.transition('PANIC', 'nope'));
  });

  it('maps event priority and activity to the right coverage state', () => {
    assert.equal(coverageState({ event: { priority: 100 } }), 'DRAMATIC');
    assert.equal(coverageState({ event: { priority: 75 } }), 'ACTION');
    assert.equal(coverageState({ isNewSubject: true }), 'ESTABLISHING');
    assert.equal(coverageState({ activity: 'idle' }), 'OBSERVING');
    assert.equal(coverageState({ activity: 'builder' }), 'FOLLOWING');
  });
});

describe('CinematicDirector FSM integration', () => {
  function fakeCamera(name = 'Cam') {
    return {
      name,
      actor: { available: true },
      targetName: null,
      setSubject(n) {
        this.targetName = n;
      },
      orbits: 0,
      async orbitTick() {
        this.orbits += 1;
        return { status: 'PASS' };
      },
      async trackNearSubject() {
        return { status: 'PASS' };
      },
      snapshot() {
        return { subject: this.targetName };
      },
    };
  }

  function fakeHarness(positions) {
    return {
      cap: {
        async observe(name) {
          const p = positions[name];
          if (!p) return { success: false };
          return { success: true, data: { x: p.x, y: p.y, z: p.z, health: 20 } };
        },
        async act(_player, action) {
          if (action === 'cam_shot') {
            return { success: true, reason: null, data: { distance: 6 } };
          }
          return { success: true, data: {} };
        },
      },
      async raw() {
        return 'ok';
      },
    };
  }

  beforeEach(() => {
    initMetrics({ serviceName: 'test' });
    resetMetrics();
  });

  it('IDLE → SEARCHING → TRANSITIONING → ESTABLISHING on the first shot', async () => {
    const positions = { Steve: { x: 0, y: 80, z: 0 } };
    const d = new CinematicDirector({
      camera: fakeCamera(),
      harness: fakeHarness(positions),
      subjects: ['Steve'],
      now: () => 1000,
    });
    assert.equal(d.fsm.state, 'IDLE');
    const r = await d.tick();
    assert.equal(r.state, 'ESTABLISHING');
    const path = d.fsm.history.map((t) => t.to);
    assert.deepEqual(path, ['SEARCHING', 'TRANSITIONING', 'ESTABLISHING']);
    assert.ok(metricsSnapshot().counters[METRIC.CAMERA_FSM_TRANSITION] >= 3);
  });

  it('ESTABLISHING settles into FOLLOWING while the shot holds', async () => {
    let now = 0;
    const positions = { Steve: { x: 0, y: 80, z: 0 } };
    const d = new CinematicDirector({
      camera: fakeCamera(),
      harness: fakeHarness(positions),
      subjects: ['Steve'],
      now: () => now,
    });
    d.setActivity('Steve', 'builder');
    await d.tick();
    now += 1500;
    const r = await d.tick();
    assert.equal(r.state, 'FOLLOWING');
  });

  it('an idle subject is covered in OBSERVING, not FOLLOWING', async () => {
    let now = 0;
    const positions = { Steve: { x: 0, y: 80, z: 0 } };
    const d = new CinematicDirector({
      camera: fakeCamera(),
      harness: fakeHarness(positions),
      subjects: ['Steve'],
      now: () => now,
    });
    await d.tick(); // activity defaults to idle
    now += 1500;
    const r = await d.tick();
    assert.equal(r.state, 'OBSERVING');
  });

  it('all subjects offline → RECOVERING with the fallback orbit, then back to coverage', async () => {
    let now = 0;
    const positions = { Steve: { x: 0, y: 80, z: 0 } };
    const camera = fakeCamera();
    const d = new CinematicDirector({
      camera,
      harness: fakeHarness(positions),
      subjects: ['Steve'],
      fallbackOrigin: { x: 100, y: 80, z: 100 },
      now: () => now,
    });
    await d.tick();
    delete positions.Steve;
    // Advance past the observe grace period (4s) so the subject is genuinely marked offline.
    now += 5000;
    const r = await d.tick();
    assert.equal(d.fsm.state, 'RECOVERING');
    assert.equal(r.fallback, 'orbit');
    assert.equal(camera.orbits, 1);
    positions.Steve = { x: 0, y: 80, z: 0 };
    now += 1500;
    const back = await d.tick();
    assert.notEqual(d.fsm.state, 'RECOVERING');
    assert.ok(['ESTABLISHING', 'FOLLOWING', 'OBSERVING'].includes(back.state));
  });

  it('camera offline → RECOVERING', async () => {
    const camera = fakeCamera();
    camera.actor.available = false;
    const d = new CinematicDirector({
      camera,
      harness: fakeHarness({}),
      subjects: ['Steve'],
      now: () => 0,
    });
    const r = await d.tick();
    assert.equal(r.status, 'FAILED');
    assert.equal(d.fsm.state, 'RECOVERING');
  });

  it('a survival-grade event drives the state to DRAMATIC', async () => {
    let now = 0;
    const positions = { Steve: { x: 0, y: 80, z: 0 } };
    const d = new CinematicDirector({
      camera: fakeCamera(),
      harness: fakeHarness(positions),
      subjects: ['Steve'],
      now: () => now,
    });
    d.setActivity('Steve', 'builder');
    await d.tick();
    now += 7000;
    d.noteEvent('Steve', 'death');
    d.setActivity('Steve', 'guard'); // activity change past minMs forces a re-shot
    const r = await d.tick();
    assert.equal(r.state, 'DRAMATIC');
    now += 1500;
    // Event expires (ttl 12 s) → coverage decays back out of DRAMATIC.
    now += 13000;
    await d.tick();
    assert.notEqual(d.fsm.state, 'DRAMATIC');
  });

  it('a high-priority (non-survival) event lands in ACTION', async () => {
    let now = 0;
    const positions = { Steve: { x: 0, y: 80, z: 0 } };
    const d = new CinematicDirector({
      camera: fakeCamera(),
      harness: fakeHarness(positions),
      subjects: ['Steve'],
      now: () => now,
    });
    d.setActivity('Steve', 'builder');
    await d.tick();
    now += 7000;
    d.noteEvent('Steve', 'region_placed'); // priority 80
    d.setActivity('Steve', 'placeregion');
    const r = await d.tick();
    assert.equal(r.state, 'ACTION');
  });

  it('an expired dwell passes through TRANSITIONING with reason dwell_expired', async () => {
    let now = 0;
    const positions = { Steve: { x: 0, y: 80, z: 0 } };
    const d = new CinematicDirector({
      camera: fakeCamera(),
      harness: fakeHarness(positions),
      subjects: ['Steve'],
      now: () => now,
    });
    d.setActivity('Steve', 'builder');
    await d.tick();
    now += 25000; // beyond any shot maxMs
    await d.tick();
    const dwellCut = d.fsm.history.find(
      (t) => t.to === 'TRANSITIONING' && t.reason === 'dwell_expired'
    );
    assert.ok(dwellCut, 'expected a TRANSITIONING edge with reason dwell_expired');
  });

  it('subject switch passes through TRANSITIONING and every edge stays in the grammar', async () => {
    let now = 0;
    const positions = { Steve: { x: 0, y: 80, z: 0 }, Alex: { x: 30, y: 80, z: 30 } };
    const d = new CinematicDirector({
      camera: fakeCamera(),
      harness: fakeHarness(positions),
      subjects: ['Steve', 'Alex'],
      now: () => now,
    });
    d.setActivity('Steve', 'stockpile');
    d.setActivity('Alex', 'placeregion');
    for (let i = 0; i < 30; i++) {
      now += 1500;
      await d.tick();
    }
    assert.ok(d.fsm.transitions > 3, 'a long run should produce several transitions');
    assert.equal(d.fsm.invalidTransitions, 0, 'no edge may leave the declared grammar');
  });

  it('stop() returns the FSM to IDLE', async () => {
    const d = new CinematicDirector({
      camera: fakeCamera(),
      harness: fakeHarness({ Steve: { x: 0, y: 80, z: 0 } }),
      subjects: ['Steve'],
      now: () => 0,
    });
    await d.tick();
    d.stop();
    assert.equal(d.fsm.state, 'IDLE');
  });

  it('snapshot exposes the FSM state for the health endpoint', async () => {
    const d = new CinematicDirector({
      camera: fakeCamera(),
      harness: fakeHarness({ Steve: { x: 0, y: 80, z: 0 } }),
      subjects: ['Steve'],
      now: () => 0,
    });
    await d.tick();
    const snap = d.snapshot();
    assert.equal(snap.fsm.state, 'ESTABLISHING');
    assert.ok(snap.fsm.transitions >= 1);
  });
});
