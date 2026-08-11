/**
 * Client-visible walking helpers.
 *
 * FACT: CapabilityActions.move_to teleports every greedy step on the primary
 * thread in one RCON call (duration_ms≈0) — clients only see the final pose.
 * FACT: village-worker used to hard-teleport to an approach tile every job.
 *
 * Fix: walk with repeated /test act step calls from Node, sleeping between
 * steps so intervening server ticks flush movement packets. Teleport only as
 * rare recovery when distance is huge or gait is stuck.
 */

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

/**
 * Walk actor to stand using small visible steps.
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
 *   clearFooting?: (x:number,y:number,z:number) => Promise<void>,
 * }} [opts]
 */
async function walkTo(harness, actorName, stand, opts = {}) {
  const cap = harness.cap;
  const arrive = opts.arrive ?? 1.4;
  const stepLen = opts.stepLen ?? 0.45;
  const pauseMs = opts.pauseMs ?? 140;
  const timeoutMs = opts.timeoutMs ?? 14000;
  const recoverDistance = opts.recoverDistance ?? 40;
  const goal = {
    x: Math.floor(stand.x) + 0.5,
    y: Math.floor(stand.y),
    z: Math.floor(stand.z) + 0.5,
  };

  const startObs = await cap.observe(actorName);
  let cur = posFromObserve(startObs);
  const actions = [];
  let recoverTeleport = false;

  if (!cur) {
    return { success: false, reason: 'observe_failed', actions, recoverTeleport };
  }

  const initial = horizDist(cur, goal);
  if (initial > recoverDistance) {
    // Rare long-range recovery only — still land short of goal and walk in.
    const ax = Math.floor(goal.x) - 3;
    const az = Math.floor(goal.z) - 3;
    if (opts.clearFooting) await opts.clearFooting(ax, goal.y, az);
    await cap.teleport(actorName, ax + 0.5, goal.y, az + 0.5);
    recoverTeleport = true;
    actions.push({ recoverTeleport: true, reason: 'too_far', distance: initial });
    cur = { x: ax + 0.5, y: goal.y, z: az + 0.5 };
  }

  if (opts.clearFooting) {
    await opts.clearFooting(Math.floor(goal.x), goal.y, Math.floor(goal.z));
  }

  const deadline = Date.now() + timeoutMs;
  let steps = 0;
  let stalled = 0;
  let lastDist = horizDist(cur, goal);

  while (Date.now() < deadline) {
    const dist = horizDist(cur, goal);
    if (dist <= arrive) {
      return {
        success: true,
        reason: null,
        steps,
        final_distance: dist,
        recoverTeleport,
        navigator: 'walk_step',
        actions,
        x: cur.x,
        y: cur.y,
        z: cur.z,
      };
    }

    const step = await cap.step(actorName, goal.x, goal.y, goal.z, stepLen);
    steps += 1;
    actions.push({ step });
    await sleep(pauseMs);

    const obs = await cap.observe(actorName);
    const next = posFromObserve(obs);
    if (!next) {
      return {
        success: false,
        reason: 'observe_failed',
        steps,
        recoverTeleport,
        navigator: 'walk_step',
        actions,
      };
    }
    cur = next;
    const newDist = horizDist(cur, goal);
    if (newDist >= lastDist - 0.05) {
      stalled += 1;
      if (stalled >= 10) {
        // Soft recover once, then walk again briefly
        if (!recoverTeleport) {
          await cap.teleport(actorName, goal.x, goal.y, goal.z);
          recoverTeleport = true;
          actions.push({ recoverTeleport: true, reason: 'stuck_gait' });
          return {
            success: true,
            reason: 'recovered_stuck',
            steps,
            final_distance: 0,
            recoverTeleport,
            navigator: 'walk_step',
            actions,
            x: goal.x,
            y: goal.y,
            z: goal.z,
          };
        }
        return {
          success: false,
          reason: 'stuck',
          steps,
          final_distance: newDist,
          recoverTeleport,
          navigator: 'walk_step',
          actions,
          x: cur.x,
          y: cur.y,
          z: cur.z,
        };
      }
    } else {
      stalled = 0;
    }
    lastDist = newDist;
  }

  return {
    success: lastDist <= arrive + 0.5,
    reason: lastDist <= arrive + 0.5 ? null : 'timeout',
    steps,
    final_distance: lastDist,
    recoverTeleport,
    navigator: 'walk_step',
    actions,
    x: cur.x,
    y: cur.y,
    z: cur.z,
  };
}

module.exports = {
  walkTo,
  horizDist,
  posFromObserve,
  sleep,
};
