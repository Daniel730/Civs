/**
 * Task B Phase 2 + World memory (W) — body now travels, flees directionally, and absorbs the world.
 * Regression guards for the live bugs Dan saw:
 *   - still teleports when it cannot reach a far goal (B3: Stage-1 recovery teleport)
 *   - flees blindly toward origin instead of away from the threat (B4)
 *   - re-derives everything each tick, never "absorbing" the world (W1-W3)
 */
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

test('B3: walkTo Stage-1 has a no-teleport branch when allowTeleport:false', () => {
  // Deterministic static check: the Stage-1 block must branch on allowTeleport so that, with
  // allowTeleport:false, it walks in hops instead of calling cap.teleport. We assert the source
  // contains the guarded branch (the runtime walkTo integration is covered by B2 + live QA).
  const fs = require('fs');
  const src = fs.readFileSync(path.join(ROOT, 'lib', 'village', 'walk.js'), 'utf8');
  const stage1 = src.slice(src.indexOf('if (initial > recoverDistance)'));
  assert.ok(/if \(allowTeleport\)/.test(stage1), 'Stage-1 branches on allowTeleport');
  assert.ok(/walk_path_hops/.test(stage1), 'no-teleport path walks in hops');
  assert.ok(/recoverTeleport:\s*false/.test(stage1), 'no-teleport path keeps recoverTeleport false');
});

test('B4: flee computes a point AWAY from the threat when threat position is known', async () => {
  const { executeSurvival } = require(path.join(ROOT, 'lib', 'survival'));
  // assessment carrying raw.nearest_hostile with an absolute position to the NORTH of the agent
  const assessment = {
    state: 'ESCAPE',
    raw: { x: 100, z: 100, nearest_hostile: { x: 100, z: 90, distance: 10, type: 'zombie' } },
    action: { kind: 'flee', target: { x: 0, y: 64, z: 0 }, sprint: true, priority: 90 },
  };
  let fledTo = null;
  const cap = {
    observe: async () => ({ success: true, data: { x: 100, y: 64, z: 100, health: 5, max_health: 20 } }),
    teleport: async () => ({ success: true }),
    step: async () => ({ success: true }),
    sprint: async () => ({ success: true }),
    respawn: async () => ({ success: true }),
    raw: async () => ({ success: true }),
  };
  const walkStub = async (h, name, to) => { fledTo = to; return { success: true, reason: null, recoverTeleport: false, navigator: 'stub' }; };
  const sv = await executeSurvival({ cap, raw: async () => ({}) }, 'Steve', assessment, {
    workOrigin: { x: 0, y: 64, z: 0 },
    walkTo: walkStub,
  });
  assert.strictEqual(sv.handled, true, 'flee handled');
  assert.ok(fledTo, 'a flee destination was chosen');
  // Threat is to the NORTH (z=90 < agent z=100), so flee point must be SOUTH (z > 100)
  assert.ok(fledTo.z > 100, 'flee moves AWAY from threat (south), got z=' + (fledTo && fledTo.z));
});

test('W1-W3: WorldMemory records threats, exposes features, and chooseFocus avoids danger zones', () => {
  const { WorldMemory } = require('@daniel730/aiworld/world-memory');
  const wm = new WorldMemory({ agentId: 'Steve', ttlMs: 60000 });
  wm.noteThreat({ x: 50, z: 50, type: 'zombie', distance: 3 });
  const f1 = wm.features({ x: 52, z: 52 });
  assert.strictEqual(f1.threatSeen, 1, 'threat remembered');
  assert.strictEqual(f1.dangerZone, 1, 'threat within 12 blocks flags danger zone');
  assert.ok(f1.nearestThreatDist > 0 && f1.nearestThreatDist < 12, 'nearest threat distance computed');

  // chooseFocus must force 'survive' when worldMemory.dangerZone is set (W3)
  const { chooseFocus } = require(path.join(ROOT, 'lib', 'village', 'focus'));
  const fc = chooseFocus({ completedPlaces: { a: true, b: true, c: true }, construction: null }, {
    survivalState: 'CAUTION', townOk: true, worldMemory: { dangerZone: 1 },
  });
  assert.strictEqual(fc.focus, 'survive', 'W3: danger-zone memory overrides CAUTION work -> survive');
  assert.strictEqual(fc.reason, 'world_memory:danger_zone');

  // Without memory, CAUTION + settlement established -> maintain (unchanged behaviour)
  const fc2 = chooseFocus({ completedPlaces: { a: true, b: true, c: true }, construction: null }, {
    survivalState: 'CAUTION', townOk: true,
  });
  assert.strictEqual(fc2.focus, 'maintain', 'no memory + CAUTION -> normal maintain');
});
