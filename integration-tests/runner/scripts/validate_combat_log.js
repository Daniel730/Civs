'use strict';
/*
 * validate_combat_log.js — real execution of the shipped CombatLog.assess.
 * Forges combat_survival events with realistic flat observe payloads
 * (the exact shape the worker passes: harness.cap.observe(name).data, per
 * lib/combat-log.js header). Used to validate field population when the
 * live QA server is not reachable from this sandbox (RCON/MCP ECONNREFUSED).
 */
const assert = require('node:assert/strict');
const { CombatLog } = require('../lib/combat-log');

const NOW = 1_700_000_000_000;

// ---- Event 1: real combat scenario (entity attacker, armed, dark) ----------
const combatObserve = {
  dead: false,
  health: 14,
  max_health: 20,
  food: 18,
  saturation: 16,
  light_level: 3,            // <= DARK_LIGHT(5) => dark
  in_lava: false,
  in_water: false,
  remaining_air: 300,
  last_damage_cause: 'ENTITY_ATTACK',
  nearest_hostile: { type: 'SKELETON', distance: 8.17, x: 9, y: 80, z: 9 },
  block_feet: 'GRASS_BLOCK',
  held: 'IRON_SWORD',
  inventory: [
    { material: 'IRON_SWORD', amount: 1 },
    { material: 'COOKED_BEEF', amount: 2 },
  ],
  x: 5200.5, y: 81, z: 5200.5,
};

const log = new CombatLog({ actor: 'Steve', now: () => NOW });
log.noteAttack('Steve', NOW); // so attackCooldownMs is a real number

const combatEvt = log.assess(combatObserve, {
  actor: 'Steve',
  survivalState: 'DANGER',
  job: 'guard',
  target: 'mob',          // populate toolMatch (sword vs mob)
  heldItem: 'IRON_SWORD',
});

// ---- Event 2: environmental hazards (prove every hazard flag can be true) ---
const hazardObserve = {
  health: 6,
  max_health: 20,
  food: 0,                 // starving
  saturation: 0,
  light_level: 2,          // dark
  in_lava: true,           // onFire + inLava
  in_water: true,          // inWater
  remaining_air: 40,       // drowning (< LOW_AIR 100)
  last_damage_cause: 'SUFFOCATION', // suffocating -> buriedSuffocating
  nearest_hostile: null,
  held: 'AIR',
  inventory: [],
  x: 12.0, y: 50, z: -8.0,
};
const hazardEvt = log.assess(hazardObserve, { actor: 'Steve', survivalState: 'ESCAPE' });

// ---------------- field-population assertion --------------------------------
function check(name, evt, path, expectPopulated) {
  const parts = path.split('.');
  let cur = evt;
  for (const p of parts) cur = cur == null ? undefined : cur[p];
  const present = cur !== undefined;
  const ok = expectPopulated ? present && cur !== null : present;
  console.log(`  [${ok ? 'OK ' : 'FAIL'}] ${name.padEnd(34)} ${path} = ${JSON.stringify(cur)}`);
  assert.ok(present, `field missing: ${path}`);
  if (expectPopulated) assert.ok(cur !== null, `field null: ${path}`);
  return cur;
}

console.log('\n=== Event 1 (combat_survival): field population ===');
assert.equal(combatEvt.kind, 'combat_survival');
check('damage.cause',            combatEvt, 'damage.cause',            true);
check('damage.category',         combatEvt, 'damage.category',         true);
check('damage.attacker',         combatEvt, 'damage.attacker',         true);
check('damage.attacker.type',    combatEvt, 'damage.attacker.type',    true);
check('damage.attacker.dist',    combatEvt, 'damage.attacker.dist',    true);
check('retaliation.bool',        combatEvt, 'retaliation.bool',        true);
check('retaliation.weapon',      combatEvt, 'retaliation.weapon',      true);
check('retaliation.attackCooldownMs', combatEvt, 'retaliation.attackCooldownMs', true);
check('buriedSuffocating',       combatEvt, 'buriedSuffocating',       true);
check('hazards.onFire',          combatEvt, 'hazards.onFire',          true);
check('hazards.inLava',          combatEvt, 'hazards.inLava',          true);
check('hazards.drowning',        combatEvt, 'hazards.drowning',        true);
check('hazards.suffocating',     combatEvt, 'hazards.suffocating',     true);
check('hazards.starving',        combatEvt, 'hazards.starving',        true);
check('hazards.dark',            combatEvt, 'hazards.dark',            true);
check('context.healthPct',       combatEvt, 'context.healthPct',       true);
check('context.food',            combatEvt, 'context.food',            true);
check('context.lightLevel',      combatEvt, 'context.lightLevel',      true);
check('context.position',        combatEvt, 'context.position',        true);
check('context.position.x',      combatEvt, 'context.position.x',      true);
check('toolMatch',               combatEvt, 'toolMatch',               true);
check('toolMatch.matched',       combatEvt, 'toolMatch.matched',       true);

console.log('\n=== Event 2 (environmental): every hazard flag ===');
check('hazards.onFire',          hazardEvt, 'hazards.onFire',          true);
check('hazards.inLava',          hazardEvt, 'hazards.inLava',          true);
check('hazards.inWater',         hazardEvt, 'hazards.inWater',         true);
check('hazards.drowning',        hazardEvt, 'hazards.drowning',        true);
check('hazards.suffocating',     hazardEvt, 'hazards.suffocating',     true);
check('hazards.starving',        hazardEvt, 'hazards.starving',        true);
check('hazards.dark',            hazardEvt, 'hazards.dark',            true);
check('buriedSuffocating',       hazardEvt, 'buriedSuffocating',       true);

console.log('\n=== FORGED combat_survival EVENT (primary) ===');
console.log(JSON.stringify(combatEvt, null, 2));

console.log('\n=== FORGED combat_survival EVENT (all-hazards) ===');
console.log(JSON.stringify(hazardEvt, null, 2));

console.log('\nALL FIELD-POPULATION ASSERTIONS PASSED');
