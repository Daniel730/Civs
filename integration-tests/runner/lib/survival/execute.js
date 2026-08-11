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

  return timeMetric(METRIC.ACTION_LATENCY, { actor: actorName, action: `survival_${action.kind}` }, async () => {
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
        const y = ctx.findSurfaceY ? await ctx.findSurfaceY(origin.x + 3, origin.z + 3) : origin.y;
        const tp = await cap.teleport(actorName, origin.x + 3, (y || origin.y) + 1, origin.z + 3);
        steps.push({ returnTeleport: !!(tp && tp.success) });
        countMetric(METRIC.GOAL_ABANDON, { actor: actorName, reason: 'survival_recover' });
        const walk = await walkTo(harness, actorName, { x: origin.x, y: (y || origin.y) + 1, z: origin.z }, {
          arrive: 2.0,
          timeoutMs: 9000,
          allowTeleport: false,
        });
        steps.push({ walkHome: { success: walk.success, navigator: walk.navigator } });
      }
      return { status: 'PASS', handled: true, kind: 'recover', steps };
    }

    if (action.kind === 'flee') {
      await cap.sprint(actorName, true);
      if (origin) {
        const walk = await walkTo(harness, actorName, { x: origin.x, y: origin.y, z: origin.z }, {
          arrive: 3.0,
          timeoutMs: 8000,
          speed: 5.4,
          allowTeleport: false,
        });
        steps.push({ flee: { success: walk.success, navigator: walk.navigator, reason: walk.reason } });
      }
      await cap.sprint(actorName, false);
      return { status: 'PASS', handled: true, kind: 'flee', steps };
    }

    if (action.kind === 'defend') {
      await cap.giveItem(actorName, 'IRON_SWORD', 1);
      await cap.hotbar(actorName, 0);
      for (let i = 0; i < 3; i++) {
        const hit = await cap.attackNearest(actorName);
        steps.push({ attack: !!(hit && hit.success), reason: hit && hit.reason });
        await cap.swing(actorName);
        await sleep(250);
        if (!hit || !hit.success) break;
      }
      return { status: 'PASS', handled: true, kind: 'defend', steps };
    }

    if (action.kind === 'retreat') {
      await cap.sprint(actorName, true);
      if (origin) {
        const walk = await walkTo(harness, actorName, { x: origin.x, y: origin.y, z: origin.z }, {
          arrive: 3.0,
          timeoutMs: 7000,
          speed: 5.4,
          allowTeleport: false,
        });
        steps.push({ retreat: { success: walk.success, reason: walk.reason } });
      }
      await cap.sprint(actorName, false);
      return { status: 'PASS', handled: true, kind: 'retreat', steps };
    }

    return { status: 'PASS', handled: false, kind: action.kind, steps };
  });
}

module.exports = { executeSurvival };
