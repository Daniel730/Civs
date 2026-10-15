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
    let abortedForHazard = null;
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
      // Hazard interrupt: poll the NPC's full observe (every ~1.2s) and abort if the body has
      // wandered into water OR is suffocating under a 1x1 overhang. The Paper pathfinder happily
      // walks through both — the agent takes suffocation/drowning damage every tick it stays
      // there ("GTA SA bug"). Aborting + REPLAN keeps the NPC player-like.
      if (Date.now() % 400 < pollMs) {
        try {
          const obs = await cap.observe(actorName);
          const od = (obs && obs.data) || {};
          if (od.in_water === true || od.head_in_water === true || od.block_below === 'WATER' || od.block_below === 'water') {
            abortedForHazard = 'in_water';
          } else if (od.last_damage_cause === 'SUFFOCATION' || od.suffocating === true) {
            abortedForHazard = 'suffocating';
          }
          if (abortedForHazard) {
            countMetric(METRIC.HAZARD_ABORT, { actor: actorName, hazard: abortedForHazard });
            try { await cap.act(actorName, 'walk_cancel'); } catch (_) { /* best effort */ }
            // PLAYER-LIKE: if we aborted because the body is in water, make the NPC swim UP
            // (jump) instead of sitting on the riverbed. A real player doesn't walk the floor.
            if (abortedForHazard === 'in_water') {
              try { await cap.act(actorName, 'jump'); } catch (_) { /* best effort */ }
            }
            break;
          }
        } catch (_) { /* observe is best effort */ }
      }
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
      status: abortedForHazard ? 'HAZARD_ABORTED' : (arrived ? 'ARRIVED' : 'INCOMPLETE'),
      reason: abortedForHazard || ((arrived ? null : (last && last.reason) || 'poll_timeout')),
      plan: started.data,
      status_data: data,
      travelled: data.travelled,
      distanceToGoal,
      collisions,
      serverReplans: data.replans || 0,
      stuckMs: maxStuckMs,
      hazard: abortedForHazard,
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

  // Pre-flight goal shape check: the goal cell must have a clear 2-block-tall column above it
  // (the NPC's body is 2 blocks tall). If the head block is solid (a 1x1 doorway, a low
  // overhang, a fence post directly over the goal), climbing up to the next clear Y prevents
  // P0.2 (2026-08-18): PRE-FLIGHT TARGET RESOLUTION.
  // Old code: if head blocked, bump goal.y upward until it found "air" (while(!isAir) y++).
  // That is exactly what created y=72 floating targets and the air-terraform bug.
  // New behavior: resolve a STANDABLE target column instead of blindly searching for air.
  //   - If the target already sits on valid terrain (support solid + feet/head clear), keep Y.
  //   - If the target is airborne (no support below), search DOWNWARD for the nearest real
  //     surface (solid support + clear feet + clear head) within a small horizontal
  //     neighborhood; if found, use that standing Y. If none, report UNREACHABLE_NO_SUPPORT.
  // Only active when harness.raw returns server-formatted strings ("Test passed"/"Test
  // failed"); test mocks / degraded RCON return objects or throw, in which case we skip
  // pre-flight entirely (best-effort, matching the legacy catch(_) behavior) so navigation
  // is never blocked by an unreadable probe.
  if (harness.raw) {
    const probeRaw = async (bx, by, bz) => {
      const r = await harness.raw(`execute in minecraft:overworld if block ${Math.floor(bx)} ${Math.floor(by)} ${Math.floor(bz)} minecraft:air`);
      return typeof r === 'string' ? String(r || '').toLowerCase().includes('test passed') : null; // null = unknown
    };
    const isAirAt = async (bx, by, bz) => {
      const v = await probeRaw(bx, by, bz);
      return v === null ? true : v; // unknown → treat as clear (best-effort)
    };
    const standableAt = async (bx, by, bz) => {
      const feet = await isAirAt(bx, by, bz);
      const head = await isAirAt(bx, by + 1, bz);
      const support = !(await isAirAt(bx, by - 1, bz)); // support is solid if NOT air
      return feet && head && support;
    };
    // Only activate the surface-resolution pre-flight when harness.raw actually returns
    // server-formatted replies ("Test passed"/"Test failed"). Unit-test stubs return
    // objects or generic strings like "ok", and degraded RCON may throw — in all those
    // cases we skip pre-flight (best-effort, matching the legacy catch(_) behavior) so
    // navigation is never blocked by an unreadable probe.
    let probeReadable = false;
    try {
      const sample = await harness.raw(`execute in minecraft:overworld if block ${Math.floor(goal.x)} ${Math.floor(goal.y)} ${Math.floor(goal.z)} minecraft:air`);
      probeReadable = typeof sample === 'string' && /test (passed|failed)/i.test(sample);
    } catch (_) { probeReadable = false; }
    if (probeReadable) {
      // Already standable? Keep Y (do not touch it).
      if (await standableAt(goal.x, goal.y, goal.z)) {
        // no-op: target is valid as-is
      } else {
        // Target is airborne (no support below). Try to resolve a real standing surface
        // by searching DOWNWARD (and a small horizontal neighborhood). If we find one, snap
        // to it — this kills the y=72 floating-target bug. If we CANNOT find any standable
        // column nearby, do NOT fabricate an airborne Y, but ALSO do not hard-block: leave
        // the original goal and let the server-side walk_path decide reachability. The P0.1
        // physics guard already prevents any world edit from an invalid body, so a bad
        // navigation target can never produce a floating build — at worst the walk fails and
        // the job re-plans. Blocking here was over-aggressive on irregular/narrow terrain.
        let resolved = null;
        for (let dy = 0; dy <= 12; dy++) {
          if (await standableAt(goal.x, goal.y - dy, goal.z)) { resolved = { x: goal.x, y: goal.y - dy, z: goal.z }; break; }
        }
        if (!resolved) {
          const nb = [[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,-1],[1,-1],[-1,1]];
          for (const [dx, dz] of nb) {
            for (let dy = 0; dy <= 6; dy++) {
              if (await standableAt(goal.x + dx, goal.y - dy, goal.z + dz)) { resolved = { x: goal.x + dx, y: goal.y - dy, z: goal.z + dz }; break; }
            }
            if (resolved) break;
          }
        }
        if (resolved) {
          goal.x = resolved.x; goal.y = resolved.y; goal.z = resolved.z;
        }
        // else: leave goal as-is; walk_path will report unreachable if truly invalid.
      }
    }
  }

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
      // Each hop is within A* range. FIX (2026-08-18): tolerate PARTIAL hops — a hop that
      // moved the body but didn't fully arrive is still progress; keep walking from where we
      // stopped. Only give up (honest `stuck`) when a hop made ZERO progress, or we run out
      // of time. Hazard aborts (in_water/suffocating) try a LATERAL hop to skirt the hazard
      // instead of bailing — this is what stopped Steve from looping on the riverbank.
      const stepDist = Math.max(8, Math.floor(recoverDistance * 0.8));
      let from = cur;
      let remaining = initial;
      let safetyHops = 0;
      const MAX_HOPS = 200; // hard ceiling so a pathological map can't loop forever
      while (remaining > recoverDistance && safetyHops < MAX_HOPS) {
        safetyHops += 1;
        const dx = goal.x - from.x;
        const dz = goal.z - from.z;
        const len = Math.sqrt(dx * dx + dz * dz) || 1;
        const hop = {
          x: Math.floor(from.x + (dx / len) * stepDist) + 0.5,
          y: goal.y,
          z: Math.floor(from.z + (dz / len) * stepDist) + 0.5,
        };
        const beforeHop = from;
        const leg = await runPathLeg(harness, actorName, hop, { ...opts, timeoutMs: 6000 });
        actions.push({ walkPathHop: { status: leg.status, reason: leg.reason, to: hop } });

        const afterHop = posFromObserve(await cap.observe(actorName)) || from;
        const moved = horizDist(beforeHop, afterHop);
        from = afterHop;
        remaining = horizDist(from, goal);

        if (leg.status === 'UNSUPPORTED') break; // legacy fallback handles it

        // HAZARD: server aborted the path because the body hit water/suffocation. Try a
        // lateral hop (perpendicular to travel) to skirt the hazard, then resume forward.
        if (leg.hazard && moved < 1.0) {
          const lateral = { x: -dz / len, z: dx / len }; // unit perpendicular
          for (const s of [1, -1]) {
            const side = {
              x: Math.floor(from.x + lateral.x * s * 4) + 0.5,
              y: goal.y,
              z: Math.floor(from.z + lateral.z * s * 4) + 0.5,
            };
            const sideLeg = await runPathLeg(harness, actorName, side, { ...opts, timeoutMs: 5000 });
            actions.push({ walkPathHopSide: { status: sideLeg.status, reason: sideLeg.reason, to: side } });
            const afterSide = posFromObserve(await cap.observe(actorName)) || from;
            if (horizDist(from, afterSide) > 1.0) { from = afterSide; remaining = horizDist(from, goal); break; }
          }
          // If we couldn't skirt, report honestly so the caller invalidates the target.
          if (horizDist(beforeHop, from) < 1.0) {
            countMetric(METRIC.GOAL_ABANDON, { actor: actorName, reason: 'hop_hazard_stuck' });
            return {
              success: false,
              reason: leg.reason || 'stuck',
              steps: actions.length,
              final_distance: remaining,
              recoverTeleport: false,
              navigator: 'walk_path_hops',
              actions,
              ...from,
            };
          }
          continue; // resumed forward progress after skirting hazard
        }

        // REAL STUCK: hop neither arrived nor moved. Honest failure.
        if (leg.status !== 'ARRIVED' && moved < 1.0) {
          countMetric(METRIC.GOAL_ABANDON, { actor: actorName, reason: 'out_of_path_range_stuck' });
          return {
            success: false,
            reason: leg.reason || 'stuck',
            steps: actions.length,
            final_distance: remaining,
            recoverTeleport: false,
            navigator: 'walk_path_hops',
            actions,
            ...from,
          };
        }
        // Otherwise: arrived OR moved-partially → loop continues from `from` (progress kept).
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
