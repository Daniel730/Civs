/**
 * Agent survival layer.
 *
 * Recon found no survival logic at all: nothing read health, food, hostiles or hazards before
 * picking a job, and death was only handled after the fact by `ensureAlive()`. Worse, a bot that
 * died respawned at world spawn and *passed* the alive check, so it kept "working" 7.3 km from the
 * village while every walk failed (measured `final_distance` 7367).
 *
 * This module turns one enriched `observe` payload into a state and a recommended action. It is
 * pure: no RCON, no timers, injectable clock — so every escalation rule is unit-testable.
 *
 * States, most severe last:
 *   SAFE     work normally
 *   CAUTION  keep working but stay defensive and prefer short goals
 *   DANGER   stop working; fight back or fall back
 *   ESCAPE   leave immediately (lava, drowning, critical health)
 *   RECOVER  dead, or too far from the work area to be doing anything useful
 */

const { METRIC, countMetric, gaugeMetric } = require('../metrics');
const { getRetaliationAbility } = require('../combat-log');

const STATES = Object.freeze(['SAFE', 'CAUTION', 'DANGER', 'ESCAPE', 'RECOVER']);
const SEVERITY = Object.freeze({ SAFE: 0, CAUTION: 1, DANGER: 2, ESCAPE: 3, RECOVER: 4 });

/** Damage causes grouped into the buckets a stream operator actually cares about. */
const CAUSE_BUCKETS = Object.freeze({
  FALL: 'fall',
  LAVA: 'lava',
  FIRE: 'fire',
  FIRE_TICK: 'fire',
  HOT_FLOOR: 'fire',
  ENTITY_ATTACK: 'mob',
  ENTITY_SWEEP_ATTACK: 'mob',
  ENTITY_EXPLOSION: 'explosion',
  BLOCK_EXPLOSION: 'explosion',
  PROJECTILE: 'mob',
  DROWNING: 'drowning',
  SUFFOCATION: 'suffocation',
  STARVATION: 'starvation',
  VOID: 'void',
  LIGHTNING: 'lightning',
  MAGIC: 'magic',
  WITHER: 'wither',
  POISON: 'poison',
  CONTACT: 'contact',
  CRAMMING: 'cramming',
  FLY_INTO_WALL: 'kinetic',
  FREEZE: 'freeze',
});

function bucketCause(cause) {
  if (!cause) return 'unknown';
  return CAUSE_BUCKETS[String(cause).toUpperCase()] || String(cause).toLowerCase();
}

const DEFAULTS = Object.freeze({
  leashRadius: 120,
  criticalHealthPct: 0.25,
  lowHealthPct: 0.45,
  hostileDangerRange: 6,
  hostileCautionRange: 16,
  lowFood: 6,
  lowAir: 100,
  fallAlert: 4,
  darkLight: 5,
  /** Hold an escalated state for at least this long before relaxing (anti-flapping). */
  calmMs: 6000,
});

class SurvivalMonitor {
  /**
   * @param {{
   *   actor: string,
   *   workOrigin?: {x:number,y:number,z:number},
   *   leashRadius?: number,
   *   calmMs?: number,
   *   now?: () => number,
   * }} opts
   */
  constructor(opts = {}) {
    this.actor = opts.actor || 'agent';
    this.workOrigin = opts.workOrigin || null;
    this.cfg = { ...DEFAULTS, ...opts };
    this.now = typeof opts.now === 'function' ? opts.now : () => Date.now();

    this.state = 'SAFE';
    this.stateSince = this.now();
    this.lastReason = null;
    this.lastAssessment = null;
    this.deaths = 0;
    this.deathCauses = {};
    this._lastDeathStat = null;
    this._wasDead = false;
  }

  /** Straight-line distance from the work area, or null when no origin is configured. */
  distanceFromWork(pos) {
    if (!this.workOrigin || !pos) return null;
    const dx = (pos.x ?? 0) - this.workOrigin.x;
    const dz = (pos.z ?? 0) - this.workOrigin.z;
    return Math.sqrt(dx * dx + dz * dz);
  }

  /**
   * Count a death exactly once, from either the `dead` flag or the DEATHS statistic.
   * @param {object} d enriched observe payload
   */
  noteDeath(d) {
    const stat = typeof d.deaths === 'number' && d.deaths >= 0 ? d.deaths : null;
    let died = false;
    if (stat != null) {
      if (this._lastDeathStat != null && stat > this._lastDeathStat) died = true;
      this._lastDeathStat = stat;
    }
    const deadNow = d.dead === true || Number(d.health) <= 0;
    if (deadNow && !this._wasDead) died = true;
    this._wasDead = deadNow;
    if (!died) return null;
    const cause = bucketCause(d.last_damage_cause);
    this.deaths += 1;
    this.deathCauses[cause] = (this.deathCauses[cause] || 0) + 1;
    countMetric(METRIC.DEATH, { actor: this.actor, cause });
    return cause;
  }

  /**
   * Classify the raw threat picture. Deterministic and stateless — hysteresis is applied
   * separately in {@link assess} so the raw verdict stays inspectable.
   * @param {object} d enriched observe payload
   */
  classify(d) {
    const threats = [];
    const health = Number(d.health);
    const maxHealth = Number(d.max_health) > 0 ? Number(d.max_health) : 20;
    const pct = Number.isFinite(health) ? health / maxHealth : 1;
    const hostiles = Number(d.hostiles) || 0;
    const hasNearestHostile = !!(d.nearest_hostile && Number.isFinite(Number(d.nearest_hostile.distance)));
    const nearest = d.nearest_hostile && Number(d.nearest_hostile.distance);
    const pos = { x: d.x, y: d.y, z: d.z };
    const fromWork = this.distanceFromWork(pos);

    if (d.dead === true || health <= 0) {
      return { state: 'RECOVER', reason: 'dead', threats: ['dead'], healthPct: pct, fromWork };
    }
    if (fromWork != null && fromWork > this.cfg.leashRadius) {
      return {
        state: 'RECOVER',
        reason: 'out_of_work_area',
        threats: ['stranded'],
        healthPct: pct,
        fromWork,
      };
    }
    if (d.in_lava === true) threats.push('lava');
    if (pct <= this.cfg.criticalHealthPct) threats.push('critical_health');
    if (Number.isFinite(Number(d.remaining_air)) && Number(d.remaining_air) < this.cfg.lowAir) {
      threats.push('drowning');
    }
    if (threats.length) {
      return { state: 'ESCAPE', reason: threats[0], threats, healthPct: pct, fromWork };
    }

    if (pct <= this.cfg.lowHealthPct) threats.push('low_health');
    if ((hostiles > 0 || hasNearestHostile) && Number.isFinite(nearest) && nearest <= this.cfg.hostileDangerRange) {
      threats.push('hostile_close');
    }
    if (threats.length) {
      return { state: 'DANGER', reason: threats[0], threats, healthPct: pct, fromWork };
    }

    if ((hostiles > 0 || hasNearestHostile) && Number.isFinite(nearest) && nearest <= this.cfg.hostileCautionRange) {
      threats.push('hostile_nearby');
    }
    if (Number(d.food) <= this.cfg.lowFood) threats.push('hungry');
    if (Number(d.fall_distance) > this.cfg.fallAlert) threats.push('falling');
    if (Number(d.light_level) <= this.cfg.darkLight) threats.push('dark');
    if (d.in_water === true) threats.push('in_water');
    if (threats.length) {
      return { state: 'CAUTION', reason: threats[0], threats, healthPct: pct, fromWork };
    }
    return { state: 'SAFE', reason: null, threats: [], healthPct: pct, fromWork };
  }

  /**
   * Full assessment: death accounting, classification, hysteresis and a recommended action.
   * @param {object} observeData enriched observe payload (`observe(...).data`)
   */
  assess(observeData) {
    const d = observeData || {};
    const deathCause = this.noteDeath(d);
    const raw = this.classify(d);
    const now = this.now();
    const prev = this.state;

    let next = raw.state;
    if (SEVERITY[raw.state] < SEVERITY[prev]) {
      // Relax only after the calm window; flapping SAFE/DANGER would thrash the job loop.
      const heldFor = now - this.stateSince;
      if (heldFor < this.cfg.calmMs) next = prev;
    }
    const changed = next !== prev;
    if (changed) {
      this.state = next;
      this.stateSince = now;
    }
    this.lastReason = raw.reason;

    const assessment = {
      actor: this.actor,
      state: next,
      previous: prev,
      changed,
      rawState: raw.state,
      reason: raw.reason,
      threats: raw.threats,
      healthPct: Math.round((raw.healthPct || 0) * 100) / 100,
      distanceFromWork: raw.fromWork == null ? null : Math.round(raw.fromWork * 10) / 10,
      deathCause,
      deaths: this.deaths,
      stateForMs: now - this.stateSince,
      action: this.recommend(next, raw, d),
    };
    if (raw.fromWork != null) {
      gaugeMetric(METRIC.DISTANCE_TO_GOAL, raw.fromWork, { actor: this.actor, goal: 'work_area' });
    }
    this.lastAssessment = assessment;
    return assessment;
  }

  /**
   * Recommended action for a state. Survival always outranks jobs: only SAFE and CAUTION
   * return `work`.
   */
  recommend(state, raw, d) {
    const retaliation = getRetaliationAbility(d.held, d.inventory);
    const canStrike = retaliation.bool;
    switch (state) {
      case 'RECOVER':
        return {
          kind: 'recover',
          respawn: raw.reason === 'dead',
          returnToWork: true,
          priority: 100,
          reason: raw.reason,
        };
      case 'ESCAPE': {
        const hasHostile = !!(d.nearest_hostile && Number.isFinite(Number(d.nearest_hostile.distance)));
        // M12: armed NPCs fight hostiles even in ESCAPE; unarmed flee as before.
        if (canStrike && hasHostile) {
          return {
            kind: 'defend',
            target: (d.nearest_hostile && d.nearest_hostile.type) || 'nearest',
            priority: 95,
            reason: raw.reason,
          };
        }
        return {
          kind: 'flee',
          target: this.workOrigin,
          sprint: true,
          priority: 90,
          reason: raw.reason,
        };
      }
      case 'DANGER': {
        const hasHostile = raw.threats.includes('hostile_close');
        // M12: an armed NPC retaliates regardless of low health; unarmed use old rules.
        const canFight = canStrike && hasHostile;
        // D-AP-021-adjacent: low health with NO hostile nearby means the agent is just
        // hurt, not under attack. Retreating home is a no-op if already home (it just
        // stands idle), so heal instead — give food and let regen close the gap.
        if (!hasHostile && raw.threats.includes('low_health')) {
          return {
            kind: 'heal',
            priority: 60,
            reason: raw.reason,
          };
        }
        return {
          kind: canFight ? 'defend' : 'retreat',
          target: canFight
            ? (d.nearest_hostile && d.nearest_hostile.type) || 'nearest'
            : this.workOrigin,
          priority: 70,
          reason: raw.reason,
        };
      }
      case 'CAUTION':
        return {
          kind: 'work',
          guarded: true,
          shortGoalsOnly: true,
          priority: 20,
          reason: raw.reason,
        };
      default:
        return { kind: 'work', guarded: false, shortGoalsOnly: false, priority: 10, reason: null };
    }
  }

  snapshot() {
    return {
      actor: this.actor,
      state: this.state,
      since: this.stateSince,
      reason: this.lastReason,
      deaths: this.deaths,
      deathCauses: { ...this.deathCauses },
      leashRadius: this.cfg.leashRadius,
      workOrigin: this.workOrigin,
      last: this.lastAssessment,
    };
  }
}

module.exports = { SurvivalMonitor, STATES, SEVERITY, bucketCause, CAUSE_BUCKETS, DEFAULTS };
