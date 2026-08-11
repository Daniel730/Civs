/**
 * Cinematic director.
 *
 * Replaces "look at the player" with "direct a shot". The old `ObservationDirector` is kept for
 * the capability e2e and as a fallback on an old harness jar; this is the production director.
 *
 * Split of responsibility:
 * - here (Node, deterministic, testable): who to be on, which shot, how long to hold it, when a
 *   cut is editorially justified;
 * - `cam_shot` (server, per tick): occlusion resolution, camera collision, eased transitions and
 *   live tracking with velocity look-ahead.
 *
 * A work tick no longer forces a cut. `biasTo` only records an event, so the job scheduler informs
 * the edit instead of driving it — recon measured 64 of 97 cuts caused directly by job ticks, with
 * cuts as close together as 3.3 s.
 */

const { SubjectDirector } = require('./subject-scoring');
const { selectShot, shotArgs } = require('./shots');
const { DirectorFSM, coverageState } = require('./director-fsm');
const { METRIC, countMetric, observeMetric, gaugeMetric } = require('../metrics');

const DEFAULT_SUBJECTS = Object.freeze(['Steve', 'Alex']);

class CinematicDirector {
  /**
   * @param {{
   *   camera: import('../camera').SpectatorCamera,
   *   harness: import('../harness').Harness,
   *   subjects?: string[],
   *   tickMs?: number,
   *   minDwellMs?: number,
   *   preferredDwellMs?: number,
   *   maxDwellMs?: number,
   *   fallbackOrigin?: {x:number,y:number,z:number},
   *   onLog?: (entry: object) => void,
   *   forceTarget?: string|null,
   *   now?: () => number,
   * }} opts
   */
  constructor(opts) {
    this.camera = opts.camera;
    this.harness = opts.harness;
    this.subjects = [...(opts.subjects || DEFAULT_SUBJECTS)];
    this.tickMs = opts.tickMs || 1500;
    this.onLog = typeof opts.onLog === 'function' ? opts.onLog : () => {};
    this.forceTarget = opts.forceTarget || process.env.CAM_FORCE_TARGET || null;
    this.now = typeof opts.now === 'function' ? opts.now : () => Date.now();
    this.fallbackOrigin = opts.fallbackOrigin || null;

    this.subjectDirector = new SubjectDirector({
      subjects: this.subjects,
      minDwellMs: opts.minDwellMs,
      preferredDwellMs: opts.preferredDwellMs,
      maxDwellMs: opts.maxDwellMs,
      now: this.now,
    });

    /** Explicit editorial state machine (issue #72). Deterministic — no LLM in the tick. */
    this.fsm = new DirectorFSM({
      camera: this.camera && this.camera.name,
      onLog: this.onLog,
      now: this.now,
    });

    this._timer = null;
    this._positions = new Map();
    this._shotIndex = new Map();
    this.plan = null;
    this.planStartedAt = 0;
    this.status = 'IDLE';
    this.lastError = null;
    this.lastSwitch = null;
    this.shotCount = 0;
    this.fallbackTicks = 0;
    this.camShotSupported = null;
    this.lastCamStatus = null;
    this.lastAgentSnapshot = {};
    this._ticks = 0;
  }

  get currentSubject() {
    return this.subjectDirector.current;
  }

  /** Subjects the camera has actually held a shot on. */
  get focusedSubjects() {
    return [...this._shotIndex.keys()];
  }

  start() {
    if (this._timer) return { status: 'DEGRADED', reason: 'already_running' };
    this.status = 'HEALTHY';
    this.fsm.transition('SEARCHING', 'director_started');
    this._timer = setInterval(() => {
      this.tick().catch((err) => {
        this.lastError = String(err && err.message ? err.message : err);
        this.status = 'DEGRADED';
        this.onLog({ status: 'DEGRADED', action: 'cinematic_tick_error', reason: this.lastError });
      });
    }, this.tickMs);
    this.onLog({
      status: 'PASS',
      action: 'cinematic_start',
      subjects: this.subjects,
      dwell: this.subjectDirector.snapshot().dwell,
    });
    return { status: 'HEALTHY' };
  }

  stop() {
    if (this._timer) clearInterval(this._timer);
    this._timer = null;
    this.status = 'IDLE';
    this.fsm.transition('IDLE', 'director_stopped');
  }

  /** What an agent is doing right now — drives shot choice and interest scoring. */
  setActivity(name, activity) {
    this.subjectDirector.update(name, { activity: activity || 'idle' });
  }

  /** Notable world event. High priority events may preempt the current dwell. */
  noteEvent(name, kind) {
    return this.subjectDirector.noteEvent(name, kind);
  }

  /**
   * Compatibility shim for the job loop. Deliberately does NOT cut: a work tick is evidence of
   * interest, not a directive.
   */
  biasTo(name, reason = 'work_tick') {
    if (!this.subjects.includes(name)) return { status: 'FAIL', reason: 'unknown_subject', name };
    this.noteEvent(name, 'job_tick');
    return { status: 'PASS', subject: name, switched: false, queued: true, reason };
  }

  forceFocus(name) {
    if (!this.subjects.includes(name)) return { status: 'FAIL', reason: 'unknown_subject' };
    this.forceTarget = name;
    return { status: 'PASS', subject: name };
  }

  clearForce() {
    this.forceTarget = null;
  }

  async tick() {
    if (!this.camera || !this.camera.actor || !this.camera.actor.available) {
      this.status = 'FAILED';
      this.fsm.transition('RECOVERING', 'camera_offline');
      return { status: 'FAILED', reason: 'camera_offline' };
    }
    this._ticks += 1;
    if (this.fsm.is('IDLE')) this.fsm.transition('SEARCHING', 'first_tick');
    const now = this.now();

    // Perception: one observe per subject, with a velocity estimate for look-ahead framing.
    let onlineCount = 0;
    for (const name of this.subjects) {
      const pos = await this._observe(name);
      const prev = this._positions.get(name);
      let speed = 0;
      if (pos && prev && now > prev.at) {
        const dx = pos.x - prev.x;
        const dz = pos.z - prev.z;
        speed = Math.sqrt(dx * dx + dz * dz) / ((now - prev.at) / 1000);
      }
      if (pos) {
        this._positions.set(name, { ...pos, at: now });
        onlineCount += 1;
      }
      this.subjectDirector.update(name, { online: !!pos, speed, position: pos });
      this.lastAgentSnapshot[name] = { at: now, online: !!pos, position: pos, speed };
    }

    if (onlineCount === 0) {
      countMetric(METRIC.CAMERA_SUBJECT_LOSS, { camera: this.camera.name });
      this.status = 'DEGRADED';
      this.fsm.transition('RECOVERING', 'no_subjects_online');
      return this._fallbackShot('no_subjects_online');
    }
    if (this.fsm.is('RECOVERING')) this.fsm.transition('SEARCHING', 'subjects_back_online');

    // Editorial decision.
    let subject = this.currentSubject;
    let isNewSubject = false;
    if (this.forceTarget) {
      if (this.forceTarget !== subject) {
        this.subjectDirector.commit(this.forceTarget, 'force_target');
        subject = this.forceTarget;
        isNewSubject = true;
      }
    } else {
      const decision = this.subjectDirector.decide();
      if (decision.switch && decision.subject) {
        const from = decision.from;
        this.subjectDirector.commit(decision.subject, decision.reason);
        subject = decision.subject;
        isNewSubject = true;
        this.lastSwitch = { at: now, from, to: subject, reason: decision.reason };
        countMetric(METRIC.CAMERA_TARGET_SWITCH, {
          camera: this.camera.name,
          reason: decision.reason,
        });
        this.onLog({
          status: 'PASS',
          action: 'camera_target_switch',
          from,
          to: subject,
          reason: decision.reason,
          scores: decision.scores,
          heldMs: decision.elapsedMs,
        });
      } else if (!subject && decision.subject) {
        this.subjectDirector.commit(decision.subject, decision.reason);
        subject = decision.subject;
        isNewSubject = true;
      }
    }
    if (!subject) {
      this.fsm.transition('SEARCHING', 'no_subject_selected');
      return this._fallbackShot('no_subject_selected');
    }

    const info = this.subjectDirector.subjects.get(subject);
    const shotElapsed = now - this.planStartedAt;
    const needShot =
      isNewSubject ||
      !this.plan ||
      shotElapsed >= this.plan.maxMs ||
      (shotElapsed >= this.plan.minMs && this.plan.activity !== (info && info.activity));

    if (needShot) {
      const cutReason = isNewSubject
        ? this.lastSwitch && this.lastSwitch.at === now
          ? this.lastSwitch.reason
          : 'new_subject'
        : !this.plan
          ? 'first_shot'
          : shotElapsed >= this.plan.maxMs
            ? 'dwell_expired'
            : 'activity_changed';
      this.fsm.transition('TRANSITIONING', cutReason);
      const index = (this._shotIndex.get(subject) || 0) + (isNewSubject ? 0 : 1);
      this._shotIndex.set(subject, index);
      const activeEvent = this.subjectDirector.activeEvent(subject);
      const plan = selectShot({
        subject,
        activity: info && info.activity,
        speed: info && info.speed,
        isNewSubject,
        shotIndex: index,
        previousShot: this.plan && this.plan.shot,
        event: activeEvent,
      });
      const applied = await this._applyShot(subject, plan);
      this.plan = { ...plan, activity: info && info.activity, applied: applied.status };
      this.planStartedAt = now;
      this.shotCount += 1;
      this.fsm.transition(
        coverageState({ event: activeEvent, activity: info && info.activity, isNewSubject }),
        `shot:${plan.shot}`
      );
      this.onLog({
        status: applied.status === 'PASS' ? 'PASS' : 'DEGRADED',
        action: 'camera_shot',
        subject,
        shot: plan.shot,
        reason: plan.reason,
        transitionMs: plan.transitionMs,
        distance: applied.distance,
        occluded: applied.occluded,
        repositioned: applied.repositioned,
      });
    } else if (this._ticks % 4 === 0) {
      await this._collectCamStatus();
    }

    // Steady coverage: ESTABLISHING settles into FOLLOWING/OBSERVING; event states decay when
    // their event expires.
    if (!needShot) {
      const steady = coverageState({
        event: this.subjectDirector.activeEvent(subject),
        activity: info && info.activity,
      });
      if (this.fsm.state !== steady) this.fsm.transition(steady, 'coverage_settled');
    }

    this.status = 'HEALTHY';
    const pos = this._positions.get(subject);
    if (pos) gaugeMetric(METRIC.DISTANCE_TO_GOAL, 0, { camera: this.camera.name, subject });
    return {
      status: this.status,
      state: this.fsm.state,
      subject,
      shot: this.plan && this.plan.shot,
      position: pos ? { x: pos.x, y: pos.y, z: pos.z } : null,
      shotElapsedMs: now - this.planStartedAt,
    };
  }

  /** Issue the shot through `cam_shot`, or fall back to the legacy tracker. */
  async _applyShot(subject, plan) {
    const args = shotArgs(plan);
    if (this.camShotSupported !== false) {
      const t0 = Date.now();
      const res = await this.harness.cap.act(this.camera.name, 'cam_shot', subject, ...args);
      observeMetric(METRIC.MOVEMENT_COMMAND_LATENCY, Date.now() - t0, {
        camera: this.camera.name,
        command: 'cam_shot',
      });
      if (res && res.reason === 'unknown_action') {
        this.camShotSupported = false;
      } else {
        this.camShotSupported = true;
        if (this.camera && typeof this.camera.setSubject === 'function') {
          this.camera.setSubject(subject);
        }
        const d = (res && res.data) || {};
        if (d.occluded)
          countMetric(METRIC.CAMERA_OCCLUSION, { camera: this.camera.name, shot: plan.shot });
        if (d.repositioned)
          countMetric(METRIC.CAMERA_REPOSITION, { camera: this.camera.name, shot: plan.shot });
        if (res && !res.success && res.reason === 'subject_offline') {
          countMetric(METRIC.CAMERA_SUBJECT_LOSS, { camera: this.camera.name });
        }
        return {
          status: res && res.success ? 'PASS' : 'DEGRADED',
          reason: res && res.reason,
          distance: d.distance,
          occluded: !!d.occluded,
          repositioned: !!d.repositioned,
        };
      }
    }
    // Legacy path: single teleport + look. Counted honestly as a camera teleport.
    const pos = this._positions.get(subject);
    if (!pos) return { status: 'DEGRADED', reason: 'no_position' };
    const tracked = await this.camera.trackNearSubject(subject, pos, (plan.yaw * Math.PI) / 180);
    countMetric(METRIC.CAMERA_TELEPORT, { camera: this.camera.name, path: 'legacy_track' });
    return { status: tracked && tracked.status === 'PASS' ? 'PASS' : 'DEGRADED', legacy: true };
  }

  async _collectCamStatus() {
    if (this.camShotSupported === false) return null;
    const st = await this.harness.cap.act(this.camera.name, 'cam_status');
    if (!st || st.reason === 'unknown_action') return null;
    const d = st.data || {};
    const prev = this.lastCamStatus || {};
    // Server-side counters are cumulative; only report the delta.
    const occDelta = Math.max(0, (d.occlusion_events || 0) - (prev.occlusion_events || 0));
    const repDelta = Math.max(0, (d.reposition_events || 0) - (prev.reposition_events || 0));
    const lostDelta = Math.max(0, (d.subject_lost || 0) - (prev.subject_lost || 0));
    const cutDelta = Math.max(0, (d.cuts || 0) - (prev.cuts || 0));
    if (occDelta) countMetric(METRIC.CAMERA_OCCLUSION, { camera: this.camera.name }, occDelta);
    if (repDelta) countMetric(METRIC.CAMERA_REPOSITION, { camera: this.camera.name }, repDelta);
    if (lostDelta) countMetric(METRIC.CAMERA_SUBJECT_LOSS, { camera: this.camera.name }, lostDelta);
    // A server-side hard cut is a teleport: count it rather than pretend the rig glided.
    if (cutDelta)
      countMetric(METRIC.CAMERA_TELEPORT, { camera: this.camera.name, path: 'shot_cut' }, cutDelta);
    this.lastCamStatus = d;
    return d;
  }

  /**
   * 24/7 requirement: never leave the stream on a frozen frame. With no live subject the camera
   * orbits the settlement instead.
   */
  async _fallbackShot(reason) {
    this.fallbackTicks += 1;
    const origin = this.fallbackOrigin;
    if (!origin || typeof this.camera.orbitTick !== 'function') {
      return { status: 'DEGRADED', reason };
    }
    const res = await this.camera.orbitTick(origin.x, origin.y, origin.z, 16, 8);
    countMetric(METRIC.CAMERA_TELEPORT, { camera: this.camera.name, path: 'fallback_orbit' });
    if (this.fallbackTicks === 1 || this.fallbackTicks % 20 === 0) {
      this.onLog({
        status: 'DEGRADED',
        action: 'camera_fallback',
        reason,
        ticks: this.fallbackTicks,
        orbit: res && res.status,
      });
    }
    return { status: 'DEGRADED', reason, fallback: 'orbit' };
  }

  async _observe(name) {
    try {
      const obs = await this.harness.cap.observe(name);
      if (!obs || !obs.success || !obs.data) return null;
      const x = obs.data.x ?? obs.data.loc_x;
      const y = obs.data.y ?? obs.data.loc_y;
      const z = obs.data.z ?? obs.data.loc_z;
      if ([x, y, z].some((v) => typeof v !== 'number' || Number.isNaN(v))) return null;
      if (obs.data.dead === true) return null;
      return { x, y, z, data: obs.data };
    } catch (_) {
      return null;
    }
  }

  snapshot() {
    return {
      status: this.status,
      fsm: this.fsm.snapshot(),
      currentSubject: this.currentSubject,
      shot: this.plan && this.plan.shot,
      shotCount: this.shotCount,
      shotElapsedMs: this.now() - this.planStartedAt,
      lastSwitch: this.lastSwitch,
      camShotSupported: this.camShotSupported,
      fallbackTicks: this.fallbackTicks,
      lastError: this.lastError,
      director: this.subjectDirector.snapshot(),
      camStatus: this.lastCamStatus,
      agents: { ...this.lastAgentSnapshot },
      camera: this.camera ? this.camera.snapshot() : null,
    };
  }
}

module.exports = { CinematicDirector, DEFAULT_SUBJECTS };
