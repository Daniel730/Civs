'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  categorizeDamage,
  getAttacker,
  getRetaliationAbility,
  deriveHazards,
  CombatLog,
  DARK_LIGHT,
} = require('../lib/combat-log');

// A flat harness observe payload (verified shape from QA experience logs).
function observe(over = {}) {
  return {
    dead: false,
    health: 20,
    max_health: 20,
    food: 20,
    saturation: 20,
    light_level: 15,
    in_lava: false,
    in_water: false,
    remaining_air: 300,
    last_damage_cause: null,
    nearest_hostile: null,
    block_feet: 'AIR',
    held: 'IRON_AXE',
    inventory: [{ material: 'IRON_AXE', amount: 1 }, { material: 'COOKED_BEEF', amount: 2 }],
    x: 5200.5,
    y: 81,
    z: 5200.5,
    ...over,
  };
}

describe('combat-log categorizeDamage', () => {
  it('maps the real cause strings', () => {
    assert.equal(categorizeDamage('SUFFOCATION'), 'suffocation');
    assert.equal(categorizeDamage('ENTITY_ATTACK'), 'entity');
    assert.equal(categorizeDamage('PROJECTILE'), 'entity');
    assert.equal(categorizeDamage('FALL'), 'fall');
    assert.equal(categorizeDamage('LAVA'), 'fire');
    assert.equal(categorizeDamage('DROWNING'), 'drown');
    assert.equal(categorizeDamage('STARVATION'), 'starvation');
    assert.equal(categorizeDamage(null), 'unknown');
  });
});

describe('combat-log getAttacker', () => {
  it('extracts a hostile with pos/dist/name', () => {
    const a = getAttacker({ type: 'SPIDER', distance: 17.24, x: 1, y: 2, z: 3 });
    assert.ok(a);
    assert.equal(a.type, 'SPIDER');
    assert.equal(a.dist, 17.24);
    assert.deepEqual(a.pos, { x: 1, y: 2, z: 3 });
  });
  it('returns null for a non-hostile (passive animal / ally)', () => {
    assert.equal(getAttacker({ type: 'COW', distance: 3 }), null);
    assert.equal(getAttacker(null), null);
  });
});

describe('combat-log getRetaliationAbility', () => {
  it('detects a weapon in hand', () => {
    const r = getRetaliationAbility('DIAMOND_SWORD', [{ material: 'DIAMOND_SWORD' }]);
    assert.equal(r.bool, true);
    assert.equal(r.weapon, 'diamond_sword');
    assert.equal(r.ranged, false);
  });
  it('detects a ranged weapon', () => {
    const r = getRetaliationAbility(null, [{ material: 'BOW', amount: 1 }]);
    assert.equal(r.bool, true);
    assert.equal(r.weapon, 'bow');
    assert.equal(r.ranged, true);
  });
  it('reports no weapon with reason', () => {
    const r = getRetaliationAbility('AIR', [{ material: 'COBBLESTONE' }]);
    assert.equal(r.bool, false);
    assert.equal(r.weapon, null);
    assert.match(r.reason, /no weapon/);
  });
});

describe('combat-log deriveHazards', () => {
  it('flags dark when light_level <= DARK_LIGHT', () => {
    const h = deriveHazards(observe({ light_level: 3 }));
    assert.equal(h.dark, true);
    assert.equal(h.lightLevel, 3);
  });
  it('flags fire/lava', () => {
    const h = deriveHazards(observe({ in_lava: true, last_damage_cause: 'LAVA' }));
    assert.equal(h.onFire, true);
    assert.equal(h.inLava, true);
  });
  it('flags drowning when air is low', () => {
    const h = deriveHazards(observe({ in_water: true, remaining_air: 40 }));
    assert.equal(h.inWater, true);
    assert.equal(h.drowning, true);
  });
  it('flags starving at food 0', () => {
    const h = deriveHazards(observe({ food: 0, last_damage_cause: 'STARVATION' }));
    assert.equal(h.starving, true);
    assert.equal(h.starvationDamage, true);
  });
  it('flags hungry at/below 6', () => {
    assert.equal(deriveHazards(observe({ food: 6 })).hungry, true);
    assert.equal(deriveHazards(observe({ food: 20 })).hungry, false);
  });
  it('flags suffocation (buried)', () => {
    assert.equal(deriveHazards(observe({ last_damage_cause: 'SUFFOCATION' })).suffocating, true);
  });
});

describe('combat-log CombatLog.assess', () => {
  const now = () => 1_000_000;

  it('populates attacker + hazards from a real hostile observe', () => {
    const log = new CombatLog({ actor: 'Steve', now });
    const ev = log.assess(
      observe({
        health: 18,
        light_level: 4,
        last_damage_cause: 'ENTITY_ATTACK',
        nearest_hostile: { type: 'SKELETON', distance: 8.17, x: 9, y: 80, z: 9 },
        held: 'IRON_SWORD',
        inventory: [{ material: 'IRON_SWORD', amount: 1 }],
      }),
      { actor: 'Steve', survivalState: 'DANGER', job: 'guard' }
    );
    assert.equal(ev.kind, 'combat_survival');
    assert.equal(ev.damage.category, 'entity');
    assert.equal(ev.damage.attacker.type, 'SKELETON');
    assert.equal(ev.damage.attacker.dist, 8.17);
    assert.equal(ev.hazards.dark, true);
    assert.equal(ev.buriedSuffocating, false);
    assert.equal(ev.retaliation.bool, true);
    assert.equal(ev.retaliation.weapon, 'iron_sword');
    assert.equal(ev.context.healthPct, 0.9);
    assert.equal(ev.job, 'guard');
  });

  it('reports cooldown null before any attack, then counts down after one', () => {
    const log = new CombatLog({ actor: 'Steve', attackCooldownMs: 1000, now });
    const before = log.assess(observe(), { actor: 'Steve' });
    assert.equal(before.retaliation.attackCooldownMs, null);
    assert.equal(before.retaliation.canStrikeNow, null);

    log.noteAttack('Steve', now());
    const justAfter = log.assess(observe(), { actor: 'Steve', now: now() });
    assert.equal(justAfter.retaliation.attackCooldownMs, 1000);
    assert.equal(justAfter.retaliation.canStrikeNow, false);

    const ready = log.assess(observe(), { actor: 'Steve', now: now() + 1001 });
    assert.equal(ready.retaliation.attackCooldownMs, 0);
    assert.equal(ready.retaliation.canStrikeNow, true);
  });

  it('does not throw on a minimal/empty observe', () => {
    const log = new CombatLog({ actor: 'Steve', now });
    const ev = log.assess({}, { actor: 'Steve' });
    assert.equal(ev.kind, 'combat_survival');
    assert.equal(ev.damage.attacker, null);
    assert.equal(ev.retaliation.bool, false);
    assert.equal(ev.context.healthPct, 1);
  });
});
