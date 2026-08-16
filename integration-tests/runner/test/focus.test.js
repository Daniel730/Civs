const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { chooseFocus, biasJob, FOCUSES } = require('../lib/village/focus');

describe('settlement focus', () => {
  it('drops everything for survival', () => {
    const f = chooseFocus({ completedPlaces: { shack: true } }, { survivalState: 'ESCAPE' });
    assert.equal(f.focus, 'survive');
    assert.equal(f.reason, 'survival:ESCAPE');
  });

  it('treats CAUTION as workable', () => {
    const f = chooseFocus({}, { survivalState: 'CAUTION', townOk: true });
    assert.notEqual(f.focus, 'survive');
  });

  it('founds regions while attempts remain', () => {
    const f = chooseFocus({ completedPlaces: {}, blocked: {} }, { townOk: true });
    assert.equal(f.focus, 'found');
    assert.equal(f.reason, 'regions_remaining');
  });

  it('rebuilds a paused construction project', () => {
    const f = chooseFocus(
      {
        completedPlaces: { shack: true, potato_farm: true, inn: true, barracks: true },
        construction: { status: 'PROJECT_PAUSED' },
      },
      { townOk: true }
    );
    assert.equal(f.focus, 'build');
  });

  it('maintains an established settlement', () => {
    const f = chooseFocus(
      { completedPlaces: { shack: true, potato_farm: true, inn: true, barracks: true } },
      { townOk: true }
    );
    assert.equal(f.focus, 'maintain');
  });

  it('rebuilds the town when it is missing', () => {
    const f = chooseFocus({ completedPlaces: { shack: true } }, { townOk: false });
    assert.equal(f.focus, 'found');
    assert.equal(f.reason, 'town_missing');
  });

  it('produces a context key that changes with the facts it depends on', () => {
    const a = chooseFocus({ completedPlaces: {} }, { townOk: true, survivalState: 'SAFE' });
    const b = chooseFocus({ completedPlaces: {} }, { townOk: true, survivalState: 'SAFE' });
    const c = chooseFocus({ completedPlaces: { shack: true } }, { townOk: true, survivalState: 'SAFE' });
    assert.equal(a.contextKey, b.contextKey);
    assert.notEqual(a.contextKey, c.contextKey);
  });

  it('only ever returns a known focus', () => {
    for (const survivalState of ['SAFE', 'CAUTION', 'DANGER', 'ESCAPE', 'RECOVER']) {
      const f = chooseFocus({ completedPlaces: { shack: true } }, { survivalState, townOk: true });
      assert.ok(FOCUSES.includes(f.focus));
    }
  });
});

describe('biasJob', () => {
  it('never overrides founding a region', () => {
    const step = biasJob({ job: 'placeregion' }, 'secure', 3);
    assert.equal(step.job, 'placeregion');
    assert.equal(step.biasedFrom, undefined);
  });

  it('leaves a job that already serves the focus', () => {
    const step = biasJob({ job: 'guard' }, 'secure', 3);
    assert.equal(step.job, 'guard');
    assert.equal(step.biasedFrom, undefined);
  });

  it('keeps the rotation intact on two ticks out of three', () => {
    assert.equal(biasJob({ job: 'farmer' }, 'secure', 1).job, 'farmer');
    assert.equal(biasJob({ job: 'farmer' }, 'secure', 2).job, 'farmer');
    const biased = biasJob({ job: 'farmer' }, 'secure', 3);
    assert.notEqual(biased.job, 'farmer');
    assert.equal(biased.biasedFrom, 'farmer');
  });

  it('never substitutes a job the loop cannot schedule directly', () => {
    for (let tick = 0; tick < 60; tick += 3) {
      const step = biasJob({ job: 'patrol' }, 'found', tick);
      assert.notEqual(step.job, 'stockpile');
      if (step.biasedFrom) assert.notEqual(step.job, 'placeregion');
    }
  });

  it('tags every step with the focus for the log', () => {
    assert.equal(biasJob({ job: 'miner' }, 'build', 5).focus, 'build');
  });
});
