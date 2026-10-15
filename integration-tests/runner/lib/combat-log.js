'use strict';

/**
 * combat-log.js
 * -------------
 * Builds structured combat/survival events for the village worker, answering
 * Dan's questions about every damage/threat tick:
 *
 *   "Fui atingido? Por quem/tipo? Onde estava? Soterrado/sufocando?
 *    Posso revidar (arma no inventário? cooldown?)? Estou a arder / afogar /
 *    morrer de fome / no escuro?"
 *
 * IMPORTANT — field names. The harness `test observe <player>` payload is
 * FLAT + snake_case (verified against real QA experience logs):
 *   data.health, data.max_health, data.food, data.saturation,
 *   data.light_level, data.in_lava, data.in_water, data.remaining_air,
 *   data.last_damage_cause, data.nearest_hostile{type,distance,x,y,z},
 *   data.block_feet, data.held, data.inventory[{material,amount}],
 *   data.x / data.y / data.z, data.dead.
 * The event is built from THAT shape. Earlier versions read camelCase fields
 * (obs.data.nearbyEntities / obs.lightLevel / obs.data.inventory) that do not
 * exist, so attacker/light were always empty — that bug is fixed here.
 *
 * Pure functions + one small stateful tracker (CombatLog) for attack cadence.
 * No I/O, no RCON, no globals — easy to unit-test and to drop into the worker.
 */

const { checkTool } = require('./tool-check');

/** Melee swing cadence reference (ms). A sword/axe recovers full strength in
 * ~1.0s (20 ticks); we treat "ready to land a full hit" as this window since
 * the last swing. Configurable per-instance. */
const ATTACK_COOLDOWN_MS = 1000;

/** Light at/below this counts as "dark" (matches SurvivalMonitor.darkLight). */
const DARK_LIGHT = 5;

/** Food at/below this counts as "hungry"; at 0 the NPC starves. */
const LOW_FOOD = 6;

/** Air below this counts as drowning risk. */
const LOW_AIR = 100;

/** Hostile entity type tokens (kept broad; lowercased match). */
const HOSTILE_RE = /(zombie|skeleton|creeper|spider|enderman|husk|drowned|witch|slime|phantom|blaze|ghast|warden|ravager|piglin|zombified|guard|hostile|monster|vindicator|pillager|evoker|vex|bogged|breeze|strider|hoglin|zoglin|shulker|silverfish|endermite|cave_spider)/;

/**
 * Normalize a Minecraft damage-cause string to a stable category.
 * @returns {'suffocation'|'entity'|'fall'|'fire'|'drown'|'magic'|'starvation'|'unknown'}
 */
function categorizeDamage(cause) {
  if (!cause) return 'unknown';
  const c = String(cause).toUpperCase();
  if (c.includes('SUFFOCAT')) return 'suffocation';
  if (c.includes('ENTITY') || c.includes('ATTACK') || c.includes('MOB') || c.includes('PLAYER') || c.includes('PROJECTILE') || c.includes('SWEEP')) return 'entity';
  if (c.includes('FALL')) return 'fall';
  if (c.includes('FIRE') || c.includes('BURN') || c.includes('LAVA') || c.includes('HOT_FLOOR')) return 'fire';
  if (c.includes('DROWN') || c.includes('WATER')) return 'drown';
  if (c.includes('STARV') || c.includes('HUNGER')) return 'starvation';
  if (c.includes('MAGIC') || c.includes('POISON') || c.includes('WITHER')) return 'magic';
  return 'unknown';
}

/**
 * Extract the attacker from the harness `nearest_hostile` payload.
 * @param {{type?:string,name?:string,distance?:number,x?:number,y?:number,z?:number}|null|undefined} nh
 * @returns {{type:string,dist:number,pos:{x:?,y:?,z:?},name:string}|null}
 */
function getAttacker(nh) {
  if (!nh) return null;
  const type = String(nh.type || nh.name || 'hostile');
  const name = String(nh.name || nh.type || 'hostile');
  if (!HOSTILE_RE.test(type.toLowerCase()) && !HOSTILE_RE.test(name.toLowerCase())) {
    // Not a hostile we swing at (could be a passive animal / player ally) — report null.
    return null;
  }
  return {
    type,
    dist: Number(nh.distance != null ? nh.distance : (nh.dist != null ? nh.dist : 999)),
    pos: { x: nh.x, y: nh.y, z: nh.z },
    name,
  };
}

/**
 * Given the NPC's held item + inventory (arrays of {material,amount} or raw
 * strings), decide whether it can retaliate right now.
 * A weapon = any sword/axe/bow/crossbow/trident/mace in hand OR inventory.
 * @returns {{bool:boolean, weapon:string|null, ranged:boolean, reason:string}}
 */
function getRetaliationAbility(held, inventory) {
  const slots = [];
  if (held) slots.push({ material: held });
  if (Array.isArray(inventory)) {
    for (const s of inventory) {
      if (s && (s.material || s.item || s.name)) {
        slots.push({ material: s.material || s.item || s.name, amount: s.amount });
      } else if (typeof s === 'string') {
        slots.push({ material: s });
      }
    }
  }
  const weapons = [
    'netherite_sword', 'diamond_sword', 'iron_sword', 'stone_sword', 'golden_sword', 'wooden_sword',
    'netherite_axe', 'diamond_axe', 'iron_axe', 'stone_axe', 'golden_axe', 'wooden_axe',
    'bow', 'crossbow', 'trident', 'mace',
  ];
  const ranged = ['bow', 'crossbow', 'trident'];
  for (const s of slots) {
    const m = String(s.material || '').toLowerCase();
    const w = weapons.find((w) => m.includes(w));
    if (w) {
      return {
        bool: true,
        weapon: w,
        ranged: ranged.includes(w),
        reason: `armed with ${w}${s.amount != null ? ` (x${s.amount})` : ''}`,
      };
    }
  }
  return { bool: false, weapon: null, ranged: false, reason: 'no weapon in inventory' };
}

/**
 * Derive the survival hazards we can see from a flat observe payload.
 * All inputs are read defensively (NaN/undefined -> safe default).
 */
function deriveHazards(o) {
  o = o || {};
  const light = Number.isFinite(Number(o.light_level)) ? Number(o.light_level) : 15;
  const food = Number.isFinite(Number(o.food)) ? Number(o.food) : 20;
  const air = Number.isFinite(Number(o.remaining_air)) ? Number(o.remaining_air) : 300;
  const cause = o.last_damage_cause || null;
  const cat = categorizeDamage(cause);
  const inLava = o.in_lava === true;
  const inWater = o.in_water === true;
  const onFire = cat === 'fire' || inLava; // lava sets fire bucket; in_lava is the hard signal
  const drowning = air < LOW_AIR;
  const suffocating = cat === 'suffocation'; // buried in a wall / sand / under blocks
  const starving = food <= 0;
  const hungry = food <= LOW_FOOD;
  const starvationDamage = cat === 'starvation';
  const dark = light <= DARK_LIGHT;
  return {
    onFire,
    inLava,
    inWater,
    drowning,
    suffocating,
    starving,
    hungry,
    starvationDamage,
    dark,
    lightLevel: light,
  };
}

/**
 * CombatLog — a per-actor tracker that remembers the last time the NPC actually
 * swung at something, so each combat event can report the live attack cooldown
 * ("posso revidar? cooldown?"). Player-like: no RCON, no globals; the caller
 * records real attacks via noteAttack() at the moment it calls attackNearest.
 */
class CombatLog {
  /**
   * @param {{attackCooldownMs?:number, now?:()=>number, actor?:string}} [opts]
   */
  constructor(opts = {}) {
    this.actor = opts.actor || 'agent';
    this.attackCooldownMs = Number.isFinite(opts.attackCooldownMs) ? opts.attackCooldownMs : ATTACK_COOLDOWN_MS;
    this.now = typeof opts.now === 'function' ? opts.now : () => Date.now();
    /** @type {Record<string,number>} actor -> last attack epoch ms */
    this._lastAttack = {};
  }

  /** Record a real attack swing for cooldown tracking. */
  noteAttack(actor, now = this.now()) {
    this._lastAttack[actor || this.actor] = now;
  }

  /** ms remaining until the next full-strength swing, or null if never attacked. */
  attackCooldownMsFor(actor, now = this.now()) {
    const last = this._lastAttack[actor || this.actor];
    if (last == null) return null;
    return Math.max(0, this.attackCooldownMs - (now - last));
  }

  /**
   * Build a full combat/survival event from a flat observe payload.
   * @param {object} observeData  `(await harness.cap.observe(name)).data`
   * @param {{
   *   actor?:string,
   *   survivalState?:string,
   *   job?:string|null,
   *   target?:string|null,   // block id (STONE) or 'mob' for tool-match check
   *   heldItem?:string|null,
   *   now?:number,
   * }} [meta]
   * @returns {object} structured event (already carries kind:'combat_survival')
   */
  assess(observeData, meta = {}) {
    const o = observeData || {};
    const actor = meta.actor || this.actor;
    const now = typeof meta.now === 'number' ? meta.now : this.now();

    const health = Number(o.health);
    const maxHealth = Number(o.max_health) > 0 ? Number(o.max_health) : 20;
    const healthPct = Number.isFinite(health) ? Math.max(0, Math.min(1, health / maxHealth)) : 1;
    const food = Number.isFinite(Number(o.food)) ? Number(o.food) : 20;
    const saturation = Number.isFinite(Number(o.saturation)) ? Number(o.saturation) : food;

    const damageCat = categorizeDamage(o.last_damage_cause);
    const attacker = getAttacker(o.nearest_hostile);
    const retaliation = getRetaliationAbility(o.held, o.inventory);
    const hazards = deriveHazards(o);

    const cd = this.attackCooldownMsFor(actor, now);
    const retaliationWithCd = Object.assign({}, retaliation, {
      attackCooldownMs: cd,
      // null => never attacked yet (unknown); otherwise true when the swing is ready
      canStrikeNow: cd == null ? null : cd <= 0,
    });

    // Tool-match: only when we know what the NPC is about to hit.
    let toolMatch = null;
    const target = meta.target || null;
    const held = meta.heldItem != null ? meta.heldItem : o.held;
    if (target && held) {
      try {
        const v = checkTool(held, target);
        toolMatch = {
          matched: v.matched,
          actual: v.actualTool,
          expected: v.expectedTool,
          reason: v.reason,
        };
      } catch (_) {
        /* tool-check not available */
      }
    }

    return {
      ts: new Date(now).toISOString(),
      kind: 'combat_survival',
      actor,
      survivalState: meta.survivalState || 'SAFE',
      damage: {
        cause: o.last_damage_cause || null,
        category: damageCat,
        attacker,
      },
      retaliation: retaliationWithCd,
      // "bury/suffocate" family — kept at top level for report grep-ability
      buriedSuffocating: hazards.suffocating,
      hazards: {
        onFire: hazards.onFire,
        inLava: hazards.inLava,
        inWater: hazards.inWater,
        drowning: hazards.drowning,
        suffocating: hazards.suffocating,
        starving: hazards.starving,
        hungry: hazards.hungry,
        starvationDamage: hazards.starvationDamage,
        dark: hazards.dark,
      },
      context: {
        healthPct: Math.round(healthPct * 1000) / 1000,
        food,
        hungerPct: Math.round((food / 20) * 1000) / 1000,
        saturation,
        lightLevel: hazards.lightLevel,
        biome: null,
        position: { x: o.x, y: o.y, z: o.z },
      },
      toolMatch,
      job: meta.job || null,
    };
  }
}

module.exports = {
  ATTACK_COOLDOWN_MS,
  DARK_LIGHT,
  LOW_FOOD,
  LOW_AIR,
  categorizeDamage,
  getAttacker,
  getRetaliationAbility,
  deriveHazards,
  CombatLog,
};
