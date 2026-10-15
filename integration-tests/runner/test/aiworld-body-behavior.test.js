/**
 * Task B (Phase 1) — NPC "body" behaviour:
 *  - survival has priority over work (flee/defend/retreat/recover preempt the work tick)
 *  - work-walk must NEVER teleport as normal locomotion (allowTeleport:false)
 *
 * These are regression guards for the two bugs the live server exposed:
 *   (1) Steve kept building while a mob killed him (no survival preemption)
 *   (2) Steve teleported every tick (work-walk fell through to recovery teleport)
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { walkTo } = require('../lib/village/walk');
const { SurvivalMonitor, executeSurvival } = require('../lib/survival');

// Minimal harness double: records whether teleport was called and simulates a near goal.
function makeHarness({ allowTp = true, willArrive = true } = {}) {
  let teleported = false;
  const cap = {
    observe: async () => ({ success: true, data: { x: 10, y: 64, z: 10, health: 20, max_health: 20 } }),
    teleport: async () => { teleported = true; return { success: true }; },
    step: async () => ({ success: true }),
    sprint: async () => ({ success: true }),
    respawn: async () => ({ success: true }),
    raw: async () => ({ success: true }),
  };
  return {
    cap,
    get teleported() { return teleported; },
    raw: async () => ({ success: true }),
  };
}

test('work-walk Stage 4 does NOT teleport when allowTeleport:false', async () => {
  // Goal within recoverDistance (so we skip Stage 1 too_far teleport) but pathing fails ->
  // lands in Stage 4 recovery. With allowTeleport:false it must NOT teleport.
  let teleported = false;
  const cap = {
    observe: async () => ({ success: true, data: { x: 10, y: 64, z: 10, health: 20, max_health: 20 } }),
    teleport: async () => { teleported = true; return { success: true }; },
    step: async () => ({ success: true }),
    sprint: async () => ({ success: true }),
    respawn: async () => ({ success: true }),
    raw: async () => ({ success: true }),
  };
  const h = { cap, raw: async () => ({ success: true }) };
  const res = await walkTo(h, 'Steve', { x: 12, y: 64, z: 12 }, {
    allowTeleport: false,
    timeoutMs: 50,
    forceLegacy: true, // force legacy stepping which stalls in this double -> Stage 4
    clearFooting: async () => {},
  });
  assert.strictEqual(teleported, false, 'Stage 4 recovery must NOT teleport when allowTeleport:false');
  assert.strictEqual(res.recoverTeleport, false, 'recoverTeleport stays false without permission');
});

test('survival monitor maps DANGER/ESCAPE/RECOVER to non-work actions', () => {
  const m = new SurvivalMonitor({ actor: 'Steve', workOrigin: { x: 0, y: 64, z: 0 } });
  const danger = m.assess({ health: 8, max_health: 20, nearest_hostile: { name: 'zombie', distance: 3 } });
  assert.notStrictEqual(danger.action.kind, 'work', 'DANGER must recommend flee/defend/retreat, not work');
  const escape = m.assess({ health: 3, max_health: 20, nearest_hostile: { name: 'creeper', distance: 1 } });
  assert.strictEqual(escape.state, 'ESCAPE', 'critical health + close hostile -> ESCAPE');
  assert.notStrictEqual(escape.action.kind, 'work');
});

test('executeSurvival handles a flee action via injected walk stub', async () => {
  const h = { cap: { respawn: async () => ({ success: true }), raw: async () => ({}), step: async () => ({ success: true }), sprint: async () => ({ success: true }), observe: async () => ({ success: true, data: { x: 0, y: 64, z: 0 } }) }, raw: async () => ({}) };
  const m = new SurvivalMonitor({ actor: 'Steve', workOrigin: { x: 0, y: 64, z: 0 } });
  const a = m.assess({ health: 8, max_health: 20, nearest_hostile: { name: 'zombie', distance: 3 } });
  // Inject a walk stub so the test is deterministic (no real RCON/pathfinding).
  const walkStub = async () => ({ success: true, reason: null, recoverTeleport: false, navigator: 'stub' });
  const sv = await executeSurvival(h, 'Steve', a, {
    workOrigin: { x: 0, y: 64, z: 0 },
    walkTo: walkStub,
  });
  assert.ok(sv && typeof sv.handled === 'boolean', 'executeSurvival returns a handled flag');
  assert.strictEqual(sv.handled, true, 'a flee action must be handled (preempt work)');
});

test('SAFE assessment recommends work (no preempt)', () => {
  const m = new SurvivalMonitor({ actor: 'Steve', workOrigin: { x: 0, y: 64, z: 0 } });
  const safe = m.assess({ health: 20, max_health: 20 });
  assert.strictEqual(safe.state, 'SAFE');
  assert.strictEqual(safe.action.kind, 'work', 'SAFE must allow work to proceed');
});
