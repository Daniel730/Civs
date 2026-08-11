/**
 * Lightweight stream subsystem health aggregation (no network side effects).
 */
'use strict';

const STATES = Object.freeze(['HEALTHY', 'DEGRADED', 'FAILED', 'RECOVERING', 'BLOCKED']);

/**
 * @param {Record<string, { state: string, detail?: string, checkedAt?: string }>} components
 */
function summarize(components) {
  const order = ['FAILED', 'BLOCKED', 'RECOVERING', 'DEGRADED', 'HEALTHY'];
  let worst = 'HEALTHY';
  for (const c of Object.values(components)) {
    const s = STATES.includes(c.state) ? c.state : 'BLOCKED';
    if (order.indexOf(s) < order.indexOf(worst)) worst = s;
  }
  return {
    overall: worst,
    checkedAt: new Date().toISOString(),
    components,
  };
}

module.exports = { STATES, summarize };
