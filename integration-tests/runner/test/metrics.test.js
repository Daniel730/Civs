const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const {
  METRIC,
  COUNTERS,
  HISTOGRAMS,
  MAX_SAMPLES,
  initMetrics,
  countMetric,
  observeMetric,
  gaugeMetric,
  timeMetric,
  metricsSnapshot,
  counterBreakdown,
  resetMetrics,
} = require('../lib/metrics');

describe('metrics', () => {
  beforeEach(() => {
    initMetrics({ serviceName: 'test' });
    resetMetrics();
  });

  it('exposes every metric named in the agent quality contract', () => {
    const snap = metricsSnapshot();
    for (const name of COUNTERS) {
      assert.equal(snap.counters[name], 0, `${name} missing from counters`);
    }
    for (const name of HISTOGRAMS) {
      assert.equal(snap.histograms[name].count, 0, `${name} missing from histograms`);
    }
    assert.ok(METRIC.DISTANCE_TO_GOAL in snap.gauges);
  });

  it('accumulates counters and keeps an attribute breakdown', () => {
    countMetric(METRIC.DEATH, { actor: 'Steve', cause: 'fall' });
    countMetric(METRIC.DEATH, { actor: 'Steve', cause: 'fall' });
    countMetric(METRIC.DEATH, { actor: 'Alex', cause: 'lava' });
    assert.equal(metricsSnapshot().counters[METRIC.DEATH], 3);
    const byAttr = counterBreakdown(METRIC.DEATH);
    assert.equal(byAttr['actor=Steve,cause=fall'], 2);
    assert.equal(byAttr['actor=Alex,cause=lava'], 1);
  });

  it('computes histogram quantiles', () => {
    for (const v of [10, 20, 30, 40, 50, 60, 70, 80, 90, 100]) {
      observeMetric(METRIC.DECISION_LATENCY, v);
    }
    const h = metricsSnapshot().histograms[METRIC.DECISION_LATENCY];
    assert.equal(h.count, 10);
    assert.equal(h.sum, 550);
    assert.equal(h.avg, 55);
    assert.equal(h.max, 100);
    assert.equal(h.p50, 60);
    assert.equal(h.p90, 100);
  });

  it('ignores non-numeric observations instead of poisoning the histogram', () => {
    observeMetric(METRIC.ACTION_LATENCY, 'slow');
    observeMetric(METRIC.ACTION_LATENCY, Number.NaN);
    observeMetric(METRIC.ACTION_LATENCY, 42);
    const h = metricsSnapshot().histograms[METRIC.ACTION_LATENCY];
    assert.equal(h.count, 1);
    assert.equal(h.sum, 42);
  });

  it('caps histogram samples so a 24/7 stream cannot grow unbounded', () => {
    for (let i = 0; i < MAX_SAMPLES + 50; i++) observeMetric(METRIC.STUCK_DURATION, i);
    const h = metricsSnapshot().histograms[METRIC.STUCK_DURATION];
    assert.equal(h.count, MAX_SAMPLES + 50);
    assert.equal(h.max, MAX_SAMPLES + 49);
  });

  it('gauges keep the last value per attribute set', () => {
    gaugeMetric(METRIC.DISTANCE_TO_GOAL, 30, { actor: 'Steve' });
    gaugeMetric(METRIC.DISTANCE_TO_GOAL, 4, { actor: 'Steve' });
    gaugeMetric(METRIC.DISTANCE_TO_GOAL, 12, { actor: 'Alex' });
    const g = metricsSnapshot().gauges[METRIC.DISTANCE_TO_GOAL];
    assert.equal(g.value, 12);
    assert.equal(g.by['actor=Steve'], 4);
    assert.equal(g.by['actor=Alex'], 12);
  });

  it('timeMetric records latency for failures too', async () => {
    await timeMetric(METRIC.MOVEMENT_COMMAND_LATENCY, { command: 'ok' }, async () => 'done');
    await assert.rejects(
      timeMetric(METRIC.MOVEMENT_COMMAND_LATENCY, { command: 'boom' }, async () => {
        throw new Error('boom');
      }),
      /boom/
    );
    assert.equal(metricsSnapshot().histograms[METRIC.MOVEMENT_COMMAND_LATENCY].count, 2);
  });
});
