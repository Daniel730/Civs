const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { ObservationDirector } = require('../lib/observation/director');
const { ViewerFollowLoop } = require('../lib/observation/viewer-follow');

function mockCamera() {
  return {
    actor: { available: true },
    targetName: 'Steve',
    setSubject(name) {
      this.targetName = name;
      return name;
    },
    async trackNearSubject(subject, pos) {
      this.last = { subject, pos };
      return { status: 'PASS', subject, target: pos };
    },
    snapshot() {
      return { subject: this.targetName, mode: 'track' };
    },
  };
}

function mockHarness(positions) {
  return {
    cap: {
      async observe(name) {
        const p = positions[name];
        if (!p) return { success: false };
        return { success: true, data: { x: p.x, y: p.y, z: p.z } };
      },
    },
    async raw(cmd) {
      this.cmds = this.cmds || [];
      this.cmds.push(cmd);
      if (cmd === 'list') {
        return `There are 4 of a max of 10 players online: ${Object.keys(positions).join(', ')}`;
      }
      return 'ok';
    },
  };
}

describe('ObservationDirector', () => {
  it('starts on Steve and switches to Alex after dwell', async () => {
    const camera = mockCamera();
    const harness = mockHarness({
      Steve: { x: 5200, y: 80, z: 5200 },
      Alex: { x: 5180, y: 80, z: 5180 },
    });
    let now = 1_000_000;
    const logs = [];
    const director = new ObservationDirector({
      camera,
      harness,
      subjects: ['Steve', 'Alex'],
      dwellMs: 5_000,
      tickMs: 60_000,
      now: () => now,
      onLog: (e) => logs.push(e),
    });
    // Don't start interval; drive ticks manually.
    director.currentSubject = 'Steve';
    director._subjectStartedAt = now;
    director.status = 'HEALTHY';

    const t1 = await director.tick();
    assert.equal(t1.subject, 'Steve');
    assert.equal(camera.last.subject, 'Steve');

    now += 6_000;
    const t2 = await director.tick();
    assert.equal(t2.subject, 'Alex');
    assert.equal(camera.last.subject, 'Alex');
    assert.ok(logs.some((l) => l.action === 'camera_target_switch' && l.to === 'Alex'));
    assert.deepEqual(director.focusedSubjects.sort(), ['Alex', 'Steve']);
  });

  it('forceFocus sticks on Alex', async () => {
    const camera = mockCamera();
    const harness = mockHarness({
      Steve: { x: 1, y: 80, z: 1 },
      Alex: { x: 2, y: 80, z: 2 },
    });
    let now = 0;
    const director = new ObservationDirector({
      camera,
      harness,
      subjects: ['Steve', 'Alex'],
      dwellMs: 1_000,
      tickMs: 60_000,
      now: () => now,
    });
    director.currentSubject = 'Steve';
    director._subjectStartedAt = 0;
    director.forceFocus('Alex', 'test');
    now = 50_000;
    const t = await director.tick();
    assert.equal(t.subject, 'Alex');
  });

  it('biasTo queues mid-dwell when subject already focused', async () => {
    const camera = mockCamera();
    const harness = mockHarness({
      Steve: { x: 1, y: 80, z: 1 },
      Alex: { x: 2, y: 80, z: 2 },
    });
    const director = new ObservationDirector({
      camera,
      harness,
      subjects: ['Steve', 'Alex'],
      dwellMs: 20_000,
      now: () => 1000,
    });
    director.currentSubject = 'Steve';
    director._subjectStartedAt = 0;
    director._focused.add('Steve');
    director._focused.add('Alex');
    const queued = director.biasTo('Alex');
    assert.equal(queued.queued, true);
    assert.equal(director.currentSubject, 'Steve');

    const director2 = new ObservationDirector({
      camera,
      harness,
      subjects: ['Steve', 'Alex'],
      dwellMs: 20_000,
      now: () => 15_000,
    });
    director2.currentSubject = 'Steve';
    director2._subjectStartedAt = 0;
    director2._focused.add('Steve');
    director2._focused.add('Alex');
    const r = director2.biasTo('Alex');
    assert.equal(r.status, 'PASS');
    assert.equal(r.switched, true);
    assert.equal(director2.currentSubject, 'Alex');
    assert.equal(director2.forceTarget, null);
  });

  it('biasTo switches immediately when subject never focused', () => {
    const director = new ObservationDirector({
      camera: mockCamera(),
      harness: mockHarness({ Steve: { x: 1, y: 1, z: 1 }, Alex: { x: 2, y: 2, z: 2 } }),
      subjects: ['Steve', 'Alex'],
      dwellMs: 20_000,
      now: () => 1000,
    });
    director.currentSubject = 'Steve';
    director._subjectStartedAt = 0;
    director._focused.add('Steve');
    const r = director.biasTo('Alex');
    assert.equal(r.switched, true);
    assert.equal(director.currentSubject, 'Alex');
  });

  it('dwell prefers queued bias then advances index correctly', async () => {
    const camera = mockCamera();
    const harness = mockHarness({
      Steve: { x: 5200, y: 80, z: 5200 },
      Alex: { x: 5180, y: 80, z: 5180 },
    });
    let now = 1_000_000;
    const director = new ObservationDirector({
      camera,
      harness,
      subjects: ['Steve', 'Alex'],
      dwellMs: 5_000,
      now: () => now,
    });
    director.currentSubject = 'Steve';
    director._syncIndex('Steve');
    director._subjectStartedAt = now;
    director._focused.add('Steve');
    director._focused.add('Alex');
    director.biasTo('Alex'); // queues
    assert.equal(director.currentSubject, 'Steve');
    now += 6_000;
    const t = await director.tick();
    assert.equal(t.subject, 'Alex');
    now += 6_000;
    const t2 = await director.tick();
    assert.equal(t2.subject, 'Steve');
  });

  it('no-op same-subject switch does not reset dwell', async () => {
    const logs = [];
    const director = new ObservationDirector({
      camera: mockCamera(),
      harness: mockHarness({ Steve: { x: 1, y: 1, z: 1 } }),
      subjects: ['Steve', 'Alex'],
      now: () => 5000,
      onLog: (e) => logs.push(e),
    });
    director.currentSubject = 'Steve';
    director._subjectStartedAt = 1000;
    director._switchTo('Steve', 'noop');
    assert.equal(director._subjectStartedAt, 1000);
    assert.ok(!logs.some((l) => l.action === 'camera_target_switch'));
  });

  it('can identify valid targets from subject list', () => {
    const director = new ObservationDirector({
      camera: mockCamera(),
      harness: mockHarness({}),
      subjects: ['Steve', 'Alex'],
    });
    assert.equal(director._resolveSubject('steve'), 'Steve');
    assert.equal(director._resolveSubject('ALEX'), 'Alex');
    assert.equal(director._resolveSubject('Bob'), null);
  });
});

describe('ViewerFollowLoop', () => {
  it('reasserts spectate Cam when Viewer is online', async () => {
    const harness = mockHarness({ Cam: { x: 0, y: 80, z: 0 }, Viewer: { x: 1, y: 80, z: 1 } });
    // include Cam+Viewer in list via keys
    harness.raw = async (cmd) => {
      harness.cmds = harness.cmds || [];
      harness.cmds.push(cmd);
      if (cmd === 'list') return 'There are 2 of a max of 10 players online: Cam, Viewer';
      return 'ok';
    };
    const loop = new ViewerFollowLoop({
      harness,
      viewerName: 'Viewer',
      cameraName: 'Cam',
      intervalMs: 60_000,
    });
    const r = await loop.tick();
    assert.equal(r.status, 'PASS');
    assert.ok(harness.cmds.some((c) => c.includes('spectate Cam')));
    assert.equal(loop.snapshot().tracked || loop.snapshot().lastResult.tracked, 'Cam');
  });

  it('degrades when Viewer offline', async () => {
    const harness = {
      async raw(cmd) {
        if (cmd === 'list') return 'There are 1 of a max of 10 players online: Cam';
        return 'ok';
      },
    };
    const loop = new ViewerFollowLoop({ harness, viewerName: 'Viewer', cameraName: 'Cam' });
    const r = await loop.tick();
    assert.equal(r.status, 'DEGRADED');
    assert.equal(r.reason, 'viewer_offline');
  });
});
