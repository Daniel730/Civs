/**
 * Executes the action recommended by {@link SurvivalMonitor}.
 *
 * Kept separate from the classifier so the decision rules stay pure/unit-testable while the
 * side effects (respawn, flee, fight, walk home) live in one auditable place. Every branch
 * prefers real movement; teleport only appears in the `recover` path, where the agent is either
 * dead or provably outside its work area and walking home is not an option.
 */

const { walkTo } = require('../village/walk');
const { METRIC, countMetric, timeMetric } = require('../metrics');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * @param {object} harness
 * @param {string} actorName
 * @param {object} assessment result of SurvivalMonitor#assess
 * @param {{
 *   workOrigin: {x:number,y:number,z:number},
 *   findSurfaceY?: (x:number,z:number) => Promise<number>,
 *   fleeDistance?: number,
 * }} ctx
 */
async function executeSurvival(harness, actorName, assessment, ctx = {}) {
  const cap = harness.cap;
  const action = assessment && assessment.action;
  if (!action || action.kind === 'work') {
    return { status: 'PASS', handled: false, kind: 'work' };
  }
  const origin = ctx.workOrigin || action.target || null;
  const steps = [];
  // Allow callers (tests) to inject a walk implementation; default to the real one.
  const walkToFn = ctx.walkTo || walkTo;

  return timeMetric(
    METRIC.ACTION_LATENCY,
    { actor: actorName, action: `survival_${action.kind}` },
    async () => {
      if (action.kind === 'recover') {
        if (action.respawn) {
          const respawn = await cap.respawn(actorName);
          steps.push({ respawn: respawn && respawn.success });
          await harness.raw(`gamemode survival ${actorName}`);
          await sleep(300);
        }
        if (origin) {
          // Respawn drops the bot at world spawn, which can be kilometres away: close the gap,
          // then walk the last stretch so the arrival still reads as a person arriving.
          const y = ctx.findSurfaceY
            ? await ctx.findSurfaceY(origin.x + 3, origin.z + 3)
            : origin.y;
          const tp = await cap.teleport(actorName, origin.x + 3, (y || origin.y) + 1, origin.z + 3);
          steps.push({ returnTeleport: !!(tp && tp.success) });
          countMetric(METRIC.GOAL_ABANDON, { actor: actorName, reason: 'survival_recover' });
          const walk = await walkToFn(
            harness,
            actorName,
            { x: origin.x, y: (y || origin.y) + 1, z: origin.z },
            {
              arrive: 2.0,
              timeoutMs: 9000,
              allowTeleport: false,
            }
          );
          steps.push({ walkHome: { success: walk.success, navigator: walk.navigator } });
        }
        return { status: 'PASS', handled: true, kind: 'recover', steps };
      }

      if (action.kind === 'flee') {
        await cap.sprint(actorName, true);
        let fleeTo = origin;
        // B4: flee AWAY from the threat, not blindly to origin. If we know the threat's position,
        // compute a point opposite it (and beyond origin if that also moves us away from home).
        try {
          const me = await cap.observe(actorName);
          const raw = assessment.raw || {};
          const h = raw.nearest_hostile || {};
          if (me && me.data && typeof h.x === 'number' && typeof h.z === 'number') {
            const ax = me.data.x, az = me.data.z;
            const dx = ax - h.x, dz = az - h.z; // vector away from threat
            const len = Math.sqrt(dx * dx + dz * dz) || 1;
            const run = Math.min(20, Math.max(8, (h.distance || 6) + 6));
            fleeTo = { x: ax + (dx / len) * run, y: me.data.y || (origin && origin.y) || 64, z: az + (dz / len) * run };
          }
        } catch (_) { /* observe may fail; fall back to origin */ }
        if (fleeTo) {
          const walk = await walkToFn(
            harness,
            actorName,
            { x: fleeTo.x, y: fleeTo.y, z: fleeTo.z },
            {
              arrive: 3.0,
              timeoutMs: 8000,
              speed: 5.4,
              allowTeleport: false,
            }
          );
          // In ESCAPE the agent is critical: if real movement stalls (stuck/mob shove),
          // fall back to a recovery teleport to the safe origin rather than standing still
          // and dying. D-AP-021: teleport only as last resort — this branch is that last resort.
          if (!walk.success && (walk.reason === 'stuck' || walk.reason === 'poll_timeout')) {
            const tp = await cap.teleport(actorName, origin.x, origin.y + 1, origin.z);
            countMetric(METRIC.GOAL_ABANDON, { actor: actorName, reason: 'flee_stuck_recover' });
            steps.push({
              flee: {
                success: !!(tp && tp.success),
                navigator: 'recovery_teleport',
                reason: walk.reason,
              },
            });
          } else {
            steps.push({
              flee: { success: walk.success, navigator: walk.navigator, reason: walk.reason },
            });
          }
        }
        await cap.sprint(actorName, false);
        return { status: 'PASS', handled: true, kind: 'flee', steps };
      }

      if (action.kind === 'defend') {
        // Gear is granted on spawn/respawn; ensure the sword is in hand before swinging.
        if (typeof cap.giveItem === 'function') {
          await cap.giveItem(actorName, 'DIAMOND_SWORD', 1).catch(() => {});
          await cap.hotbar(actorName, 0).catch(() => {});
        }
        for (let i = 0; i < 3; i++) {
          if (typeof cap.attackNearest !== 'function') break;
          const hit = await cap.attackNearest(actorName);
          steps.push({ attack: !!(hit && hit.success), reason: hit && hit.reason });
          if (typeof cap.swing === 'function') await cap.swing(actorName);
          await sleep(250);
          if (!hit || !hit.success) break;
        }
        return { status: 'PASS', handled: true, kind: 'defend', steps };
      }

      if (action.kind === 'retreat') {
        await cap.sprint(actorName, true);
        if (origin) {
          const walk = await walkTo(
            harness,
            actorName,
            { x: origin.x, y: origin.y, z: origin.z },
            {
              arrive: 3.0,
              timeoutMs: 7000,
              speed: 5.4,
              allowTeleport: false,
            }
          );
          // D-AP-021: teleport only as last resort — mirror the flee branch so a
          // stalled walk_path (server without walk_path, or the NPC wedged in a pit)
          // still moves the agent home instead of leaving it idle in DANGER.
          if (!walk.success && (walk.reason === 'stuck' || walk.reason === 'poll_timeout')) {
            const tp = await cap.teleport(actorName, origin.x, origin.y + 1, origin.z);
            countMetric(METRIC.GOAL_ABANDON, { actor: actorName, reason: 'retreat_stuck_recover' });
            steps.push({
              retreat: {
                success: !!(tp && tp.success),
                navigator: 'recovery_teleport',
                reason: walk.reason,
              },
            });
          } else {
            steps.push({ retreat: { success: walk.success, reason: walk.reason } });
          }
        }
        await cap.sprint(actorName, false);
        return { status: 'PASS', handled: true, kind: 'retreat', steps };
      }

      if (action.kind === 'heal') {
        // Hurt but not under attack: get food in hand and eat so natural regen can close
        // the health gap. Try the harness `eat` action first, then generic `use` (right-click).
        // If neither raises health we leave it to the next tick's assessment (the agent is not
        // under attack, so standing and regenerating is acceptable) — we do NOT respawn here,
        // because the harness respawn does not restore health and would just loop.
        // Never throws — survival must not crash the tick.
        if (typeof cap.giveItem === 'function') await cap.giveItem(actorName, 'COOKED_BEEF', 2).catch(() => {});
        if (typeof cap.hotbar === 'function') await cap.hotbar(actorName, 0).catch(() => {});
        if (typeof cap.act === 'function') { await cap.act(actorName, 'eat').catch(() => {}); await cap.act(actorName, 'use').catch(() => {}); }
        await sleep(3000);
        let hpAfter = null;
        try {
          const after = await cap.observe(actorName);
          const d2 = (after && after.data) || {};
          hpAfter = Number.isFinite(Number(d2.health)) && Number(d2.max_health) > 0
            ? Number(d2.health) / Number(d2.max_health)
            : null;
        } catch (_) { /* observe may fail */ }
        steps.push({ heal: { gave: 'COOKED_BEEF', healthPctAfter: hpAfter } });
        return { status: 'PASS', handled: true, kind: 'heal', steps };
      }

      return { status: 'PASS', handled: false, kind: action.kind, steps };
    }
  );
}

module.exports = { executeSurvival };
