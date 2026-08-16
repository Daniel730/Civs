/**
 * Client-visible walking.
 *
 * History (all FACT, measured in `reports/probe-motion.json`):
 * - `CapabilityActions.move_to` teleports every greedy step inside a single RCON call, so
 *   clients only ever see the final pose.
 * - The Node-driven `step` loop that replaced it walked at 0.75 blocks/s, was stationary in
 *   76.5% of 200 ms position samples, spent 50 RCON commands on a 22-block approach and still
 *   ended in a recovery teleport (`displacementPerSample.cv` 1.93).
 *
 * Now the primary path is the server-side `walk_path` capability: bounded A* plus a per-tick
 * mover with yaw rate limits and acceleration ramps. Same route measured 3.89 blocks/s, 0%
 * stalled samples, `cv` 0.20, 3 RCON commands, no teleport.
 *
 * The legacy stepping loop is kept as a fallback so an old harness jar still works, and a
 * teleport is only ever used after the whole recovery ladder has failed.
 */

const {
  METRIC,
  countMetric,
  observeMetric,
  gaugeMetric,
} = require('../metrics');

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function horizDist(a, b) {
  const dx = (a.x ?? 0) - (b.x ?? 0);
  const dz = (a.z ?? 0) - (b.z ?? 0);
  return Math.sqrt(dx * dx + dz * dz);
}

function posFromObserve(obs) {
  if (!obs || !obs.data) return null;
  const d = obs.data;
  return {
    x: d.x ?? d.loc_x,
    y: d.y ?? d.loc_y,
    z: d.z ?? d.loc_z,
  };
}

/** Server-side `walk_path` presence, probed once per process. */
let _pathCapability = null;

function pathCapabilityKnown() {
  return _pathCapability;
}

function resetPathCapability() {
  _pathCapability = null;
}

/**
 * Drive one server-side path traversal and poll it to completion.
 *
 * @returns {Promise<{status:string, reason:string|null, plan?:object, status_data?:object,
 *   travelled?:number, distanceToGoal?:number, collisions?:number, stuckMs?:number}>}
 */
async function runPathLeg(harness, actorName, goal, opts) {
  const cap = harness.cap;
  const arrive = opts.arrive ?? 1.4;
  const speed = opts.speed ?? 4.3;
  const pollMs = opts.pollMs ?? 600;
  const timeoutMs = opts.timeoutMs ?? 14000;

  const t0 = Date.now();
  const started = await cap.act(actorName, 'walk_path', goal.x, goal.y, goal.z, arrive, speed);
  observeMetric(METRIC.MOVEMENT_COMMAND_LATENCY, Date.now() - t0, {
    actor: actorName,
    command: 'walk_path',
  });

  if (started && started.reason === 'unknown_action') {
    _pathCapability = false;
    return { status: 'UNSUPPORTED', reason: 'unknown_action' };
  }
  _pathCapability = true;
  if (!started || !started.success) {
    countMetric(METRIC.PATH_FAILURE, { actor: actorName, reason: (started && started.reason) || 'unknown' });
    return { status: 'NO_PATH', reason: (started && started.reason) || 'walk_path_failed' };
  }

  const deadline = Date.now() + timeoutMs;
  let last = null;
  let maxStuckMs = 0;
  let collisions = 0;
  while (Date.now() < deadline) {
    await sleep(pollMs);
    const st = await cap.act(actorName, 'walk_status');
    last = st;
    const d = (st && st.data) || {};
    if (typeof d.distance_to_goal === 'number') {
      gaugeMetric(METRIC.DISTANCE_TO_GOAL, d.distance_to_goal, { actor: actorName });
    }
    if (typeof d.stuck_ms === 'number') maxStuckMs = Math.max(maxStuckMs, d.stuck_ms);
    if (typeof d.collisions === 'number') collisions = Math.max(collisions, d.collisions);
    if (d.active === false || d.done === true) break;
  }
  const data = (last && last.data) || {};
  if (maxStuckMs > 0) observeMetric(METRIC.STUCK_DURATION, maxStuckMs, { actor: actorName });
  if (collisions > 0) countMetric(METRIC.COLLISION, { actor: actorName }, collisions);
  // The mover re-plans on its own when the body cannot follow the route; count those too.
  if (data.replans > 0) {
    countMetric(METRIC.REPLAN, { actor: actorName, reason: 'server_mover' }, data.replans);
  }

  const arrivedByServer = !!(last && last.success) && !last.reason;
  const distanceToGoal = typeof data.distance_to_goal === 'number' ? data.distance_to_goal : null;
  const arrived = arrivedByServer || (distanceToGoal != null && distanceToGoal <= arrive + 0.6);
  return {
    status: arrived ? 'ARRIVED' : 'INCOMPLETE',
    reason: arrived ? null : (last && last.reason) || 'poll_timeout',
    plan: started.data,
    status_data: data,
    travelled: data.travelled,
    distanceToGoal,
    collisions,
    serverReplans: data.replans || 0,
    stuckMs: maxStuckMs,
  };
}

/**
 * Legacy fallback: many small `step` calls from Node. Slow and visibly stuttery — only used
 * when the harness has no `walk_path`, or as the last stage before a recovery teleport.
 */
async function legacyStepWalk(harness, actorName, goal, opts, startPos) {
  const cap = harness.cap;
  const arrive = opts.arrive ?? 1.4;
  const stepLen = opts.stepLen ?? 0.45;
  const pauseMs = opts.pauseMs ?? 140;
  const deadline = Date.now() + (opts.timeoutMs ?? 14000);
  let cur = startPos;
  let steps = 0;
  let stalled = 0;
  let lastDist = horizDist(cur, goal);

  while (Date.now() < deadline) {
    const dist = horizDist(cur, goal);
    if (dist <= arrive) return { arrived: true, steps, distance: dist, position: cur };
    await cap.step(actorName, goal.x, goal.y, goal.z, stepLen);
    steps += 1;
    await sleep(pauseMs);
    const next = posFromObserve(await cap.observe(actorName));
    if (!next) return { arrived: false, steps, reason: 'observe_failed', position: cur };
    cur = next;
    const newDist = horizDist(cur, goal);
    if (newDist >= lastDist - 0.05) {
      stalled += 1;
      if ((stalled === 4 || stalled === 8) && opts.clearFooting) {
        const ax = Math.floor(cur.x + (goal.x - cur.x) * 0.3);
        const az = Math.floor(cur.z + (goal.z - cur.z) * 0.3);
        await opts.clearFooting(ax, goal.y, az);
      }
      if (stalled >= 14) {
        return { arrived: false, steps, reason: 'stuck', distance: newDist, position: cur };
      }
    } else {
      stalled = 0;
    }
    lastDist = newDist;
  }
  return { arrived: lastDist <= arrive + 0.5, steps, reason: 'timeout', distance: lastDist, position: cur };
}

/**
 * Walk actor to `stand`.
 *
 * Recovery ladder, cheapest and least cheaty first:
 *   1. `walk_path` to the goal.
 *   2. `walk_path` to a nearby standable offset (a blocked doorway is usually a bad goal cell,
 *      not an unreachable area) — counted as a replan.
 *   3. legacy stepping loop, with footing clears.
 *   4. teleport — counted in `camera`-independent `goal_abandon` / recovery telemetry so the
 *      honest teleport rate stays visible.
 *
 * @param {{ cap: any, raw?: Function }} harness
 * @param {string} actorName
 * @param {{ x:number,y:number,z:number }} stand
 * @param {{
 *   arrive?: number,
 *   stepLen?: number,
 *   pauseMs?: number,
 *   timeoutMs?: number,
 *   recoverDistance?: number,
 *   speed?: number,
 *   pollMs?: number,
 *   allowTeleport?: boolean,
 *   forceLegacy?: boolean,
 *   clearFooting?: (x:number,y:number,z:number) => Promise<void>,
 * }} [opts]
 */
async function walkTo(harness, actorName, stand, opts = {}) {
  const cap = harness.cap;
  const arrive = opts.arrive ?? 1.4;
  const recoverDistance = opts.recoverDistance ?? 40;
  const allowTeleport = opts.allowTeleport !== false;
  const goal = {
    x: Math.floor(stand.x) + 0.5,
    y: Math.floor(stand.y),
    z: Math.floor(stand.z) + 0.5,
  };

  const t0 = Date.now();
  let cur = posFromObserve(await cap.observe(actorName));
  if (!cur) {
    return { success: false, reason: 'observe_failed', actions: [], recoverTeleport: false };
  }

  const actions = [];
  let recoverTeleport = false;
  let replans = 0;
  const initial = horizDist(cur, goal);
  gaugeMetric(METRIC.DISTANCE_TO_GOAL, initial, { actor: actorName });

  if (initial <= arrive) {
    return {
      success: true,
      reason: null,
      steps: 0,
      final_distance: initial,
      recoverTeleport: false,
      navigator: 'already_there',
      actions,
      ...cur,
    };
  }

  // Beyond A* range there is nothing to path over — close the gap, then walk in properly.
  if (initial > recoverDistance) {
    if (allowTeleport) {
      // Legacy behaviour: teleport to just outside the goal, then walk the last stretch.
      const ax = Math.floor(goal.x) - 3;
      const az = Math.floor(goal.z) - 3;
      if (opts.clearFooting) await opts.clearFooting(ax, goal.y, az);
      const tp = await cap.teleport(actorName, ax + 0.5, goal.y, az + 0.5);
      recoverTeleport = true;
      countMetric(METRIC.GOAL_ABANDON, { actor: actorName, reason: 'out_of_path_range' });
      actions.push({ recoverTeleport: true, reason: 'too_far', distance: initial, ok: !!(tp && tp.success) });
      cur = posFromObserve(await cap.observe(actorName)) || cur;
    } else {
      // B3: no-teleport mode. Walk the gap in foot-steps via intermediate waypoints so the
      // agent actually travels (and is observable) instead of teleporting as "locomotion".
      // Each hop is within A* range; if any hop stalls we report stuck honestly.
      const stepDist = Math.max(8, Math.floor(recoverDistance * 0.8));
      let from = cur;
      let remaining = initial;
      while (remaining > recoverDistance) {
        const dx = goal.x - from.x;
        const dz = goal.z - from.z;
        const len = Math.sqrt(dx * dx + dz * dz) || 1;
        const hop = {
          x: Math.floor(from.x + (dx / len) * stepDist) + 0.5,
          y: goal.y,
          z: Math.floor(from.z + (dz / len) * stepDist) + 0.5,
        };
        const leg = await runPathLeg(harness, actorName, hop, { ...opts, timeoutMs: 6000 });
        actions.push({ walkPathHop: { status: leg.status, reason: leg.reason, to: hop } });
        if (leg.status !== 'ARRIVED' && leg.status !== 'UNSUPPORTED') {
          countMetric(METRIC.GOAL_ABANDON, { actor: actorName, reason: 'out_of_path_range_stuck' });
          return {
            success: false,
            reason: 'stuck',
            steps: actions.length,
            final_distance: horizDist(from, goal),
            recoverTeleport: false,
            navigator: 'walk_path_hops',
            actions,
            ...from,
          };
        }
        from = posFromObserve(await cap.observe(actorName)) || from;
        remaining = horizDist(from, goal);
      }
      cur = from;
    }
  }

  const useLegacy = opts.forceLegacy === true || _pathCapability === false;
  let leg = null;
  if (!useLegacy) {
    leg = await runPathLeg(harness, actorName, goal, opts);
    actions.push({ walkPath: { status: leg.status, reason: leg.reason, plan: leg.plan } });

    // A goal cell inside a doorway/wall is common; try standable neighbours before giving up.
    if (leg.status === 'NO_PATH' || leg.status === 'INCOMPLETE') {
      for (const [dx, dz] of [
        [2, 0],
        [-2, 0],
        [0, 2],
        [0, -2],
      ]) {
        const alt = { x: goal.x + dx, y: goal.y, z: goal.z + dz };
        replans += 1;
        countMetric(METRIC.REPLAN, { actor: actorName, reason: leg.reason || 'no_path' });
        const retry = await runPathLeg(harness, actorName, alt, { ...opts, timeoutMs: 8000 });
        actions.push({ walkPathRetry: { offset: [dx, dz], status: retry.status, reason: retry.reason } });
        if (retry.status === 'ARRIVED' || retry.status === 'UNSUPPORTED') {
          leg = retry;
          break;
        }
      }
    }
  }

  cur = posFromObserve(await cap.observe(actorName)) || cur;
  let dist = horizDist(cur, goal);

  if (leg && leg.status === 'ARRIVED' && dist <= arrive + 0.8) {
    observeMetric(METRIC.ACTION_LATENCY, Date.now() - t0, { actor: actorName, action: 'walk' });
    gaugeMetric(METRIC.DISTANCE_TO_GOAL, dist, { actor: actorName });
    return {
      success: true,
      reason: null,
      steps: (leg.plan && leg.plan.waypoints) || 0,
      final_distance: dist,
      recoverTeleport,
      navigator: 'walk_path',
      travelled: leg.travelled,
      collisions: leg.collisions,
      replans,
      actions,
      ...cur,
    };
  }

  // Stage 3: legacy stepping. Still real movement, just slower and uglier.
  // ANTI-STUPID WALK FIX: the legacy step loop is what made Steve climb fences, sink into
  // holes, and walk head-first into leaves — it blindly steps toward an (often non-standable)
  // goal cell. We only fall back to it when the caller explicitly wants legacy movement
  // (old harness without walk_path). Otherwise we report the goal as unreachable so the caller
  // can INVALIDATE the bad target (anti-stupid) instead of letting Steve hurt himself on a fence.
  const allowLegacyFallback = opts.forceLegacy === true || (leg && (leg.status === 'UNSUPPORTED' || leg.status === 'INCOMPLETE' || leg.status === 'NO_PATH')) || _pathCapability === false;
  let legacy = null;
  if (allowLegacyFallback) {
    if (opts.clearFooting) {
      await opts.clearFooting(Math.floor(goal.x), goal.y, Math.floor(goal.z));
    }
    legacy = await legacyStepWalk(harness, actorName, goal, opts, cur);
    actions.push({ legacyWalk: { steps: legacy.steps, arrived: legacy.arrived, reason: legacy.reason } });
    cur = legacy.position || cur;
    dist = horizDist(cur, goal);
    if (legacy.arrived) {
      observeMetric(METRIC.ACTION_LATENCY, Date.now() - t0, { actor: actorName, action: 'walk' });
      return {
        success: true,
        reason: null,
        steps: legacy.steps,
        final_distance: dist,
        recoverTeleport,
        navigator: 'walk_step',
        replans,
        actions,
        ...cur,
      };
    }
  } else {
    // Honest: walk_path + standable offsets failed. Report unreachable so the caller invalidates
    // this target (anti-stupid) rather than Steve face-planting into a fence/hole/leaves.
    countMetric(METRIC.NO_PROGRESS, { actor: actorName, reason: 'unreachable_standable' });
    actions.push({ unreachable: { reason: (leg && leg.reason) || 'no_path_or_offsets_failed', goal } });
    return {
      success: false,
      reason: (leg && leg.reason) || 'unreachable_standable',
      steps: 0,
      final_distance: dist,
      recoverTeleport,
      navigator: 'walk_path',
      replans,
      actions,
      ...cur,
    };
  }

  observeMetric(METRIC.NO_PROGRESS, Date.now() - t0, { actor: actorName });
  countMetric(METRIC.PATH_FAILURE, { actor: actorName, reason: legacy.reason || 'stuck' });

  // Stage 4: last resort (legacy path only). Callers that must not cheat pass allowTeleport:false.
  if (allowTeleport && !recoverTeleport) {
    await cap.teleport(actorName, goal.x, goal.y, goal.z);
    countMetric(METRIC.GOAL_ABANDON, { actor: actorName, reason: 'recovery_teleport' });
    actions.push({ recoverTeleport: true, reason: 'ladder_exhausted' });
    return {
      success: true,
      reason: 'recovered_stuck',
      steps: legacy.steps,
      final_distance: 0,
      recoverTeleport: true,
      navigator: 'recovery_teleport',
      replans,
      actions,
      x: goal.x,
      y: goal.y,
      z: goal.z,
    };
  }

  return {
    success: false,
    reason: legacy.reason || 'stuck',
    steps: legacy.steps,
    final_distance: dist,
    recoverTeleport,
    navigator: 'walk_path',
    replans,
    actions,
    ...cur,
  };
}

module.exports = {
  walkTo,
  runPathLeg,
  legacyStepWalk,
  horizDist,
  posFromObserve,
  pathCapabilityKnown,
  resetPathCapability,
  sleep,
};
