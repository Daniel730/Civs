const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { selectShot, shotArgs, SHOTS, ACTIVITY_ROTATIONS } = require('../lib/observation/shots');
const { SubjectDirector, EVENT_PRIORITY } = require('../lib/observation/subject-scoring');
const { CinematicDirector } = require('../lib/observation/cinematic');
const { METRIC, initMetrics, resetMetrics, metricsSnapshot } = require('../lib/metrics');

describe('shot vocabulary', () => {
  it('opens on an establishing shot for a new subject', () => {
    const plan = selectShot({ subject: 'Steve', activity: 'builder', isNewSubject: true });
    assert.equal(plan.shot, 'establishing');
    assert.equal(plan.reason, 'new_subject');
    assert.ok(plan.transitionMs >= 2000, 'an establishing shot needs a slow move in');
  });

  it('uses travel framing for a moving subject', () => {
    const plan = selectShot({ subject: 'Steve', activity: 'builder', speed: 3.5, shotIndex: 0 });
    assert.equal(plan.reason, 'travelling');
    assert.ok(ACTIVITY_ROTATIONS.travelling.includes(plan.shot));
  });

  it('cuts close on a high-priority event', () => {
    const plan = selectShot({
      subject: 'Alex',
      activity: 'farmer',
      event: { kind: 'death', priority: 100 },
    });
    assert.equal(plan.shot, 'close');
    assert.equal(plan.reason, 'event:death');
  });

  it('rotates through the activity vocabulary and never repeats back to back', () => {
    const seen = [];
    let previous = null;
    for (let i = 0; i < 6; i++) {
      const plan = selectShot({ subject: 'Steve', activity: 'builder', shotIndex: i, previousShot: previous });
      assert.notEqual(plan.shot, previous, 'consecutive identical shots read as a frozen camera');
      previous = plan.shot;
      seen.push(plan.shot);
    }
    assert.ok(new Set(seen).size >= 3, 'builder coverage should use several angles');
  });

  it('advances the orbit angle so an orbit actually orbits', () => {
    const a = selectShot({ subject: 'Steve', activity: 'patrol', shotIndex: 2, previousShot: 'wide' });
    const b = selectShot({ subject: 'Steve', activity: 'patrol', shotIndex: 5, previousShot: 'wide' });
    assert.equal(a.shot, 'orbit');
    assert.equal(b.shot, 'orbit');
    assert.notEqual(a.yaw, b.yaw);
  });

  it('every shot declares a dwell window and a sane distance', () => {
    for (const [name, g] of Object.entries(SHOTS)) {
      assert.ok(g.minMs >= 2500, `${name} dwell floor too short to be watchable`);
      assert.ok(g.maxMs > g.minMs, `${name} max dwell must exceed min`);
      assert.ok(g.dist >= 2 && g.dist <= 48, `${name} distance out of range`);
    }
  });

  it('serialises to cam_shot arguments in the documented order', () => {
    const plan = selectShot({ subject: 'Steve', activity: 'miner', shotIndex: 0 });
    const args = shotArgs(plan);
    assert.equal(args.length, 6);
    assert.equal(args[0], plan.shot);
    assert.equal(args[1], plan.geometry.dist);
    assert.equal(args[3], plan.yaw);
  });
});

describe('SubjectDirector', () => {
  function make(now) {
    return new SubjectDirector({
      subjects: ['Steve', 'Alex'],
      minDwellMs: 6000,
      preferredDwellMs: 15000,
      maxDwellMs: 30000,
      now: () => now.value,
    });
  }

  it('picks a first subject then holds it through the minimum dwell', () => {
    const now = { value: 1000 };
    const d = make(now);
    const first = d.decide();
    assert.equal(first.switch, true);
    assert.equal(first.reason, 'first_subject');
    d.commit(first.subject, first.reason);

    now.value += 2000;
    d.update('Alex', { activity: 'placeregion' });
    const hold = d.decide();
    assert.equal(hold.switch, false);
    assert.equal(hold.reason, 'min_dwell');
  });

  it('does not cut on job ticks alone (the old work_tick_bias bug)', () => {
    const now = { value: 0 };
    const d = make(now);
    d.update('Steve', { activity: 'miner' });
    d.update('Alex', { activity: 'miner' });
    d.commit('Steve', 'first');
    now.value += 7000;
    for (let i = 0; i < 5; i++) d.noteEvent('Alex', 'job_tick');
    const decision = d.decide();
    assert.equal(decision.switch, false);
    assert.equal(decision.reason, 'hysteresis_hold');
  });

  it('cuts when a challenger is clearly more interesting after the preferred dwell', () => {
    const now = { value: 0 };
    const d = make(now);
    d.update('Steve', { activity: 'stockpile' });
    d.update('Alex', { activity: 'placeregion' });
    d.commit('Steve', 'first');
    now.value += 16000;
    const decision = d.decide();
    assert.equal(decision.switch, true);
    assert.equal(decision.subject, 'Alex');
    assert.equal(decision.reason, 'preferred_dwell');
  });

  it('lets a death preempt the dwell but not instantly', () => {
    const now = { value: 0 };
    const d = make(now);
    d.update('Steve', { activity: 'builder' });
    d.update('Alex', { activity: 'builder' });
    d.commit('Steve', 'first');

    now.value += 1000;
    d.noteEvent('Alex', 'death');
    assert.equal(d.decide().switch, false, 'even a death must not cut in the first instant');

    now.value += 3000;
    const decision = d.decide();
    assert.equal(decision.switch, true);
    assert.equal(decision.reason, 'event_priority:death');
  });

  it('always cuts at the maximum dwell so no subject is watched forever', () => {
    const now = { value: 0 };
    const d = make(now);
    d.update('Steve', { activity: 'builder' });
    d.update('Alex', { activity: 'stockpile' });
    d.commit('Steve', 'first');
    now.value += 31000;
    const decision = d.decide();
    assert.equal(decision.switch, true);
    assert.equal(decision.reason, 'max_dwell');
  });

  it('leaves an offline subject immediately', () => {
    const now = { value: 0 };
    const d = make(now);
    d.commit('Steve', 'first');
    d.update('Steve', { online: false });
    const decision = d.decide();
    assert.equal(decision.switch, true);
    assert.equal(decision.subject, 'Alex');
    assert.equal(decision.reason, 'subject_lost');
  });

  it('reports no_subjects when everyone is offline', () => {
    const now = { value: 0 };
    const d = make(now);
    d.commit('Steve', 'first');
    d.update('Steve', { online: false });
    d.update('Alex', { online: false });
    assert.equal(d.decide().reason, 'no_subjects');
  });

  it('grows novelty for a subject that has been off screen', () => {
    const now = { value: 0 };
    const d = make(now);
    d.update('Steve', { activity: 'builder' });
    d.update('Alex', { activity: 'builder' });
    d.commit('Steve', 'first');
    now.value += 5000;
    d.commit('Alex', 'switch');
    const early = d.score('Steve');
    now.value += 20000;
    assert.ok(d.score('Steve') > early, 'time off screen should raise interest');
  });

  it('orders event priorities so survival beats routine', () => {
    assert.ok(EVENT_PRIORITY.death > EVENT_PRIORITY.region_placed);
    assert.ok(EVENT_PRIORITY.region_placed > EVENT_PRIORITY.job_tick);
  });

  it('collapses a repeated condition into one event', () => {
    const now = { value: 0 };
    const d = make(now);
    assert.equal(d.noteEvent('Alex', 'combat').suppressed, false);
    now.value += 8000;
    assert.equal(d.noteEvent('Alex', 'combat').suppressed, true, 'same fight, same event');
    now.value += 30000;
    assert.equal(d.noteEvent('Alex', 'combat').suppressed, false, 'a later fight is news again');
  });

  it('does not suppress a different kind of event', () => {
    const now = { value: 0 };
    const d = make(now);
    d.noteEvent('Alex', 'combat');
    assert.equal(d.noteEvent('Alex', 'death').suppressed, false);
  });

  it('ignores an event that predates the current shot', () => {
    const now = { value: 0 };
    const d = make(now);
    d.update('Steve', { activity: 'builder' });
    d.update('Alex', { activity: 'builder' });
    d.noteEvent('Alex', 'combat');
    now.value += 1000;
    d.commit('Steve', 'first');
    now.value += 7000;
    const decision = d.decide();
    assert.notEqual(decision.reason, 'event_priority:combat');
  });

  it('will not cut to a subject whose trouble is no worse than the one on screen', () => {
    const now = { value: 0 };
    const d = make(now);
    d.update('Steve', { activity: 'builder' });
    d.update('Alex', { activity: 'builder' });
    d.commit('Steve', 'first');
    now.value += 1000;
    d.noteEvent('Steve', 'combat');
    d.noteEvent('Alex', 'combat');
    now.value += 6000;
    assert.notEqual(d.decide().reason, 'event_priority:combat');
  });

  it('still cuts when the challenger is in worse trouble', () => {
    const now = { value: 0 };
    const d = make(now);
    d.update('Steve', { activity: 'builder' });
    d.update('Alex', { activity: 'builder' });
    d.commit('Steve', 'first');
    now.value += 1000;
    d.noteEvent('Steve', 'combat');
    d.noteEvent('Alex', 'death');
    now.value += 3000;
    const decision = d.decide();
    assert.equal(decision.switch, true);
    assert.equal(decision.subject, 'Alex');
    assert.equal(decision.reason, 'event_priority:death');
  });

  it('keeps cuts far enough apart to be watchable during a long fight', () => {
    const now = { value: 0 };
    const d = make(now);
    d.update('Steve', { activity: 'guard' });
    d.update('Alex', { activity: 'guard' });
    d.commit('Steve', 'first');
    const cuts = [];
    // 8 s work ticks reporting the same fight on both agents, for five minutes.
    for (let t = 0; t < 300000; t += 8000) {
      now.value += 8000;
      d.noteEvent('Steve', 'combat');
      d.noteEvent('Alex', 'combat');
      const decision = d.decide();
      if (decision.switch) {
        cuts.push(now.value);
        d.commit(decision.subject, decision.reason);
      }
    }
    const gaps = cuts.slice(1).map((v, i) => v - cuts[i]);
    assert.ok(cuts.length > 0, 'the camera must still cut occasionally');
    assert.ok(
      gaps.every((g) => g >= 6000),
      `every cut must respect the minimum dwell, saw ${JSON.stringify(gaps)}`
    );
    assert.ok(cuts.length <= 20, `five minutes of fighting should not produce ${cuts.length} cuts`);
  });
});

describe('CinematicDirector', () => {
  function fakeCamera(name = 'Cam') {
    return {
      name,
      actor: { available: true },
      targetName: 'Steve',
      setSubject(n) {
        this.targetName = n;
      },
      orbits: 0,
      async orbitTick() {
        this.orbits += 1;
        return { status: 'PASS' };
      },
      async trackNearSubject(subject, pos) {
        this.legacy = { subject, pos };
        return { status: 'PASS' };
      },
      snapshot() {
        return { subject: this.targetName };
      },
    };
  }

  function fakeHarness(positions, opts = {}) {
    const acts = [];
    return {
      acts,
      cap: {
        async observe(name) {
          const p = positions[name];
          if (!p) return { success: false };
          return { success: true, data: { x: p.x, y: p.y, z: p.z, health: 20 } };
        },
        async act(player, action, ...args) {
          acts.push({ player, action, args });
          if (opts.noCamShot && action === 'cam_shot') {
            return { success: false, reason: 'unknown_action', data: {} };
          }
          if (action === 'cam_shot') {
            return { success: true, reason: null, data: { distance: 6, occluded: false, repositioned: false } };
          }
          if (action === 'cam_status') {
            return {
              success: true,
              data: { occlusion_events: opts.occlusion || 0, reposition_events: 0, subject_lost: 0 },
            };
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

  it('issues a cam_shot for the selected subject', async () => {
    const camera = fakeCamera();
    const harness = fakeHarness({ Steve: { x: 0, y: 80, z: 0 }, Alex: { x: 20, y: 80, z: 20 } });
    const now = 1000;
    const d = new CinematicDirector({
      camera,
      harness,
      subjects: ['Steve', 'Alex'],
      now: () => now,
    });
    const r = await d.tick();
    assert.equal(r.status, 'HEALTHY');
    const shot = harness.acts.find((a) => a.action === 'cam_shot');
    assert.ok(shot, 'expected a cam_shot call');
    assert.equal(shot.args[0], r.subject);
    assert.equal(shot.args[1], 'establishing');
    assert.equal(metricsSnapshot().counters[METRIC.CAMERA_TARGET_SWITCH] >= 0, true);
  });

  it('a work tick records interest but never forces a cut', async () => {
    const camera = fakeCamera();
    const harness = fakeHarness({ Steve: { x: 0, y: 80, z: 0 }, Alex: { x: 5, y: 80, z: 5 } });
    let now = 0;
    const d = new CinematicDirector({ camera, harness, subjects: ['Steve', 'Alex'], now: () => now });
    await d.tick();
    const held = d.currentSubject;
    now += 1500;
    const other = held === 'Steve' ? 'Alex' : 'Steve';
    const bias = d.biasTo(other, 'work_tick');
    assert.equal(bias.switched, false);
    await d.tick();
    assert.equal(d.currentSubject, held);
  });

  it('holds a shot until its dwell window expires, then cuts to a new angle', async () => {
    const camera = fakeCamera();
    const harness = fakeHarness({ Steve: { x: 0, y: 80, z: 0 } });
    let now = 0;
    const d = new CinematicDirector({ camera, harness, subjects: ['Steve'], now: () => now });
    await d.tick();
    const firstShot = d.plan.shot;
    now += 1500;
    await d.tick();
    assert.equal(d.plan.shot, firstShot, 'shot changed before its dwell window elapsed');
    now += 20000;
    await d.tick();
    assert.notEqual(d.plan.shot, firstShot);
    assert.ok(d.shotCount >= 2);
  });

  it('falls back to an orbit when every subject is offline', async () => {
    const camera = fakeCamera();
    const harness = fakeHarness({});
    const d = new CinematicDirector({
      camera,
      harness,
      subjects: ['Steve'],
      fallbackOrigin: { x: 5200, y: 80, z: 5200 },
    });
    const r = await d.tick();
    assert.equal(r.fallback, 'orbit');
    assert.equal(camera.orbits, 1);
    assert.equal(metricsSnapshot().counters[METRIC.CAMERA_SUBJECT_LOSS], 1);
  });

  it('degrades to the legacy tracker when the harness has no cam_shot', async () => {
    const camera = fakeCamera();
    const harness = fakeHarness({ Steve: { x: 1, y: 80, z: 1 } }, { noCamShot: true });
    const d = new CinematicDirector({ camera, harness, subjects: ['Steve'] });
    await d.tick();
    assert.equal(d.camShotSupported, false);
    assert.equal(camera.legacy.subject, 'Steve');
    assert.equal(metricsSnapshot().counters[METRIC.CAMERA_TELEPORT], 1);
  });

  it('reports camera occlusion deltas from the server tracker', async () => {
    const camera = fakeCamera();
    const harness = fakeHarness({ Steve: { x: 1, y: 80, z: 1 } }, { occlusion: 3 });
    const d = new CinematicDirector({ camera, harness, subjects: ['Steve'] });
    await d.tick();
    d._ticks = 3;
    await d._collectCamStatus();
    assert.equal(metricsSnapshot().counters[METRIC.CAMERA_OCCLUSION], 3);
    await d._collectCamStatus();
    assert.equal(metricsSnapshot().counters[METRIC.CAMERA_OCCLUSION], 3, 'cumulative counters must not double count');
  });

  it('treats a dead subject as unavailable', async () => {
    const camera = fakeCamera();
    const harness = {
      cap: {
        async observe() {
          return { success: true, data: { x: 1, y: 80, z: 1, dead: true } };
        },
        async act() {
          return { success: true, data: {} };
        },
      },
      async raw() {
        return 'ok';
      },
    };
    const d = new CinematicDirector({
      camera,
      harness,
      subjects: ['Steve'],
      fallbackOrigin: { x: 0, y: 80, z: 0 },
    });
    const r = await d.tick();
    assert.equal(r.reason, 'no_subjects_online');
  });
});
