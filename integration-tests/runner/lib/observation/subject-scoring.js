/**
 * Who the camera should be on, and when it is allowed to change its mind.
 *
 * Recon measured 97 subject switches where 64 were driven purely by the job loop
 * (`work_tick_bias`) with a minimum gap of 3.3 s. That is the job scheduler directing the show.
 *
 * This module scores subjects on interest and applies hysteresis plus a dwell window, so cuts
 * happen for editorial reasons: the current subject keeps a stickiness bonus, a challenger has to
 * beat it by a margin, and no cut may happen before `minDwellMs` unless something genuinely
 * urgent happened.
 *
 * Pure and clock-injectable.
 */

/** Editorial interest per activity — what makes better television. */
const ACTIVITY_INTEREST = Object.freeze({
  placeregion: 1.0,
  builder: 0.85,
  beautify: 0.6,
  miner: 0.7,
  lumberjack: 0.65,
  farmer: 0.55,
  guard: 0.6,
  patrol: 0.5,
  stockpile: 0.35,
  idle: 0.2,
});

/** Event priorities. >= 70 can preempt an in-progress dwell. */
const EVENT_PRIORITY = Object.freeze({
  death: 100,
  danger: 90,
  combat: 85,
  region_placed: 80,
  construction_complete: 75,
  state_transition: 40,
  job_tick: 20,
});

const DEFAULTS = Object.freeze({
  minDwellMs: 6000,
  preferredDwellMs: 15000,
  maxDwellMs: 32000,
  /** Challenger must beat the current subject by this fraction to earn a cut. */
  hysteresisMargin: 0.25,
  /** Bonus the on-screen subject keeps, so ties never cause a cut. */
  stickiness: 0.3,
  /** Interest gained per second a subject has been off screen, capped. */
  noveltyPerSecond: 0.02,
  noveltyCap: 0.5,
  /** Events older than this stop influencing scores. */
  eventTtlMs: 12000,
  /**
   * Minimum spacing between two events of the same kind for the same subject.
   *
   * A threat is a *condition*, not an instant: the first live run cut every 7.5 s because both
   * agents reported `combat` on every 8 s work tick while the same zombies were around. Repeats
   * inside this window are dropped, so a long fight is one editorial event, not forty.
   */
  eventCooldownMs: 25000,
});

class SubjectDirector {
  /**
   * @param {{
   *   subjects?: string[],
   *   minDwellMs?: number,
   *   preferredDwellMs?: number,
   *   maxDwellMs?: number,
   *   hysteresisMargin?: number,
   *   stickiness?: number,
   *   now?: () => number,
   * }} opts
   */
  constructor(opts = {}) {
    this.cfg = { ...DEFAULTS, ...opts };
    this.now = typeof opts.now === 'function' ? opts.now : () => Date.now();
    this.subjects = new Map();
    for (const name of opts.subjects || []) this.track(name);
    this.current = null;
    this.currentSince = this.now();
    this.switches = 0;
    this.lastDecision = null;
  }

  track(name) {
    if (!this.subjects.has(name)) {
      this.subjects.set(name, {
        name,
        online: true,
        activity: 'idle',
        speed: 0,
        lastSeenOnScreen: 0,
        events: [],
        lastEventAt: new Map(),
        position: null,
      });
    }
    return this.subjects.get(name);
  }

  /**
   * Feed the director what an agent is doing.
   * @param {string} name
   * @param {{online?:boolean, activity?:string, speed?:number, position?:object}} update
   */
  update(name, update = {}) {
    const s = this.track(name);
    if (update.online != null) s.online = !!update.online;
    if (update.activity) s.activity = update.activity;
    if (update.speed != null) s.speed = Number(update.speed) || 0;
    if (update.position) s.position = update.position;
    return s;
  }

  /**
   * Record a notable event for a subject. High-priority events can preempt a dwell.
   * @param {string} name
   * @param {string} kind key of EVENT_PRIORITY (unknown kinds get priority 30)
   */
  noteEvent(name, kind) {
    const s = this.track(name);
    const priority = EVENT_PRIORITY[kind] != null ? EVENT_PRIORITY[kind] : 30;
    const now = this.now();
    const lastSame = s.lastEventAt.get(kind);
    if (lastSame != null && now - lastSame < this.cfg.eventCooldownMs) {
      return { kind, priority, suppressed: true, sinceMs: now - lastSame };
    }
    s.lastEventAt.set(kind, now);
    s.events.push({ kind, priority, at: now });
    if (s.events.length > 16) s.events.shift();
    return { kind, priority, suppressed: false };
  }

  /** Highest-priority live event for a subject, or null. */
  activeEvent(name) {
    const s = this.subjects.get(name);
    if (!s) return null;
    const now = this.now();
    let best = null;
    for (const ev of s.events) {
      if (now - ev.at > this.cfg.eventTtlMs) continue;
      if (!best || ev.priority > best.priority) best = ev;
    }
    return best;
  }

  /** Interest score for one subject. Offline subjects score 0 and can never be chosen. */
  score(name) {
    const s = this.subjects.get(name);
    if (!s || !s.online) return 0;
    const now = this.now();
    let value = ACTIVITY_INTEREST[s.activity] != null ? ACTIVITY_INTEREST[s.activity] : 0.3;

    const ev = this.activeEvent(name);
    if (ev) value += ev.priority / 100;

    if (s.lastSeenOnScreen) {
      const offScreenSec = (now - s.lastSeenOnScreen) / 1000;
      value += Math.min(this.cfg.noveltyCap, offScreenSec * this.cfg.noveltyPerSecond);
    } else {
      // Never shown yet — worth cutting to at least once.
      value += this.cfg.noveltyCap;
    }
    if (s.speed > 0.5) value += 0.1;
    if (name === this.current) value += this.cfg.stickiness;
    return Math.round(value * 1000) / 1000;
  }

  scores() {
    const out = {};
    for (const name of this.subjects.keys()) out[name] = this.score(name);
    return out;
  }

  /**
   * Decide whether to cut, and to whom.
   * @returns {{ switch: boolean, subject: string|null, from: string|null, reason: string,
   *   elapsedMs: number, scores: object }}
   */
  decide() {
    const now = this.now();
    const elapsed = now - this.currentSince;
    const scores = this.scores();
    const online = [...this.subjects.values()].filter((s) => s.online).map((s) => s.name);

    if (!online.length) {
      return { switch: false, subject: null, from: this.current, reason: 'no_subjects', elapsedMs: elapsed, scores };
    }
    if (!this.current || !online.includes(this.current)) {
      const pick = online.reduce((a, b) => (scores[b] > scores[a] ? b : a), online[0]);
      return {
        switch: true,
        subject: pick,
        from: this.current,
        reason: this.current ? 'subject_lost' : 'first_subject',
        elapsedMs: elapsed,
        scores,
      };
    }

    const challengers = online.filter((n) => n !== this.current);
    if (!challengers.length) {
      return { switch: false, subject: this.current, from: this.current, reason: 'only_subject', elapsedMs: elapsed, scores };
    }
    const best = challengers.reduce((a, b) => (scores[b] > scores[a] ? b : a), challengers[0]);
    const currentScore = scores[this.current] || 0;
    const bestScore = scores[best] || 0;
    const beatsCurrent = bestScore > currentScore * (1 + this.cfg.hysteresisMargin);
    const ev = this.activeEvent(best);
    const currentEvent = this.activeEvent(this.current);
    const currentPriority = currentEvent ? currentEvent.priority : 0;
    /**
     * Only an event that (a) is urgent, (b) happened *after* the current shot began and (c) beats
     * whatever is happening to the on-screen subject may preempt a dwell. Without (b) a stale event
     * kept pulling the camera back and forth between two subjects who were both in trouble.
     */
    const urgent = !!ev && ev.priority >= 70 && ev.at > this.currentSince && ev.priority > currentPriority;
    // Only a death-grade event earns a cut before the minimum dwell has elapsed.
    const minForEvent = ev && ev.priority >= 90 ? this.cfg.minDwellMs / 2 : this.cfg.minDwellMs;

    if (elapsed >= this.cfg.maxDwellMs) {
      return { switch: true, subject: best, from: this.current, reason: 'max_dwell', elapsedMs: elapsed, scores };
    }
    if (urgent && elapsed >= minForEvent) {
      return {
        switch: true,
        subject: best,
        from: this.current,
        reason: `event_priority:${ev.kind}`,
        elapsedMs: elapsed,
        scores,
      };
    }
    if (elapsed < this.cfg.minDwellMs) {
      return { switch: false, subject: this.current, from: this.current, reason: 'min_dwell', elapsedMs: elapsed, scores };
    }
    if (elapsed >= this.cfg.preferredDwellMs && beatsCurrent) {
      return { switch: true, subject: best, from: this.current, reason: 'preferred_dwell', elapsedMs: elapsed, scores };
    }
    if (beatsCurrent && bestScore > currentScore + this.cfg.stickiness) {
      return { switch: true, subject: best, from: this.current, reason: 'score_margin', elapsedMs: elapsed, scores };
    }
    return { switch: false, subject: this.current, from: this.current, reason: 'hysteresis_hold', elapsedMs: elapsed, scores };
  }

  /** Commit a decision. Call after the camera actually moved. */
  commit(subject, reason) {
    const now = this.now();
    if (this.current && this.current !== subject) {
      const prev = this.subjects.get(this.current);
      if (prev) prev.lastSeenOnScreen = now;
      this.switches += 1;
    }
    const s = this.track(subject);
    s.events = [];
    this.current = subject;
    this.currentSince = now;
    this.lastDecision = { subject, reason, at: now };
    return this.lastDecision;
  }

  snapshot() {
    return {
      current: this.current,
      currentForMs: this.now() - this.currentSince,
      switches: this.switches,
      scores: this.scores(),
      dwell: {
        minMs: this.cfg.minDwellMs,
        preferredMs: this.cfg.preferredDwellMs,
        maxMs: this.cfg.maxDwellMs,
      },
      subjects: [...this.subjects.values()].map((s) => ({
        name: s.name,
        online: s.online,
        activity: s.activity,
        speed: Math.round(s.speed * 100) / 100,
        events: s.events.length,
      })),
    };
  }
}

module.exports = { SubjectDirector, ACTIVITY_INTEREST, EVENT_PRIORITY, DEFAULTS };
