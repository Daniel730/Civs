/**
 * Shot vocabulary for the cinematic director.
 *
 * The old camera had exactly one shot: teleport to a fixed 8-block radius / 4-block height offset
 * and `look_at` the subject, with the orbit angle advancing 0.2 rad every 2 s regardless of what
 * the subject was doing. That reads as "a bot looking at a player", not as coverage of a scene.
 *
 * Here a shot is a named piece of camera grammar with geometry, a transition length and a dwell
 * window. Selection is deterministic and pure so it can be asserted in unit tests; the server-side
 * `cam_shot` capability is what actually resolves occlusion and eases the rig.
 *
 * `yaw` is degrees around the subject measured from *behind* the subject's facing, so 0 is directly
 * behind, 90 is a profile and 180 is a face-on view.
 */

const SHOTS = Object.freeze({
  establishing: {
    dist: 20,
    height: 10,
    yaw: 35,
    lead: 0,
    transitionMs: 2400,
    minMs: 3500,
    maxMs: 7000,
  },
  wide: { dist: 13, height: 5.5, yaw: 55, lead: 4, transitionMs: 1600, minMs: 3000, maxMs: 8000 },
  medium: {
    dist: 6.5,
    height: 2.4,
    yaw: 45,
    lead: 6,
    transitionMs: 1200,
    minMs: 3000,
    maxMs: 9000,
  },
  over_shoulder: {
    dist: 3.4,
    height: 1.9,
    yaw: 18,
    lead: 8,
    transitionMs: 1000,
    minMs: 3500,
    maxMs: 10000,
  },
  close: { dist: 2.8, height: 1.7, yaw: 155, lead: 2, transitionMs: 900, minMs: 2500, maxMs: 6000 },
  low: { dist: 5, height: 0.6, yaw: 70, lead: 4, transitionMs: 1100, minMs: 3000, maxMs: 8000 },
  profile: {
    dist: 7.5,
    height: 2.1,
    yaw: 90,
    lead: 10,
    transitionMs: 1200,
    minMs: 3000,
    maxMs: 9000,
  },
  orbit: { dist: 8, height: 3.2, yaw: 45, lead: 4, transitionMs: 1400, minMs: 4000, maxMs: 12000 },
  top_down: { dist: 5, height: 15, yaw: 20, lead: 0, transitionMs: 1800, minMs: 3000, maxMs: 7000 },
  panoramic: {
    dist: 26,
    height: 13,
    yaw: 35,
    lead: 0,
    transitionMs: 2600,
    minMs: 5000,
    maxMs: 14000,
  },
  reaction: {
    dist: 3.6,
    height: 1.9,
    yaw: 130,
    lead: 2,
    transitionMs: 900,
    minMs: 2500,
    maxMs: 5000,
  },
});

const SHOT_NAMES = Object.freeze(Object.keys(SHOTS));

const { spaceRotation } = require('./context');

/**
 * Per-activity shot rotations. Order matters: it is the cut rhythm for that activity.
 * Static, precise work gets tight angles; travel gets profiles and wides so motion reads.
 */
const ACTIVITY_ROTATIONS = Object.freeze({
  builder: ['low', 'over_shoulder', 'top_down', 'medium'],
  beautify: ['top_down', 'low', 'medium'],
  farmer: ['medium', 'top_down', 'over_shoulder'],
  stockpile: ['medium', 'wide'],
  miner: ['over_shoulder', 'low', 'close'],
  lumberjack: ['over_shoulder', 'low', 'medium'],
  patrol: ['profile', 'wide', 'orbit'],
  guard: ['profile', 'medium', 'wide'],
  placeregion: ['establishing', 'top_down', 'medium'],
  travelling: ['profile', 'wide', 'over_shoulder'],
  idle: ['medium', 'orbit', 'wide'],
});

/** Subject speed (blocks/s) above which travel framing beats activity framing. */
const TRAVEL_SPEED = 1.6;

/**
 * Pick the next shot.
 *
 * Rules, in order:
 *  1. A fresh subject always opens on an establishing shot — the viewer needs to be told where
 *     they now are before being shown detail.
 *  2. A high-priority event cuts to a close/reaction angle.
 *  3. A moving subject uses the travel rotation.
 *  4. Otherwise rotate through the activity's own rotation, never repeating the previous shot.
 *
 * @param {{
 *   subject: string,
 *   activity?: string,
 *   speed?: number,
 *   isNewSubject?: boolean,
 *   shotIndex?: number,
 *   previousShot?: string|null,
 *   event?: {kind:string, priority:number}|null,
 * }} ctx
 * @returns {{ shot: string, geometry: object, reason: string, transitionMs: number,
 *   minMs: number, maxMs: number, yaw: number }}
 */
function selectShot(ctx = {}) {
  const index = Number.isFinite(ctx.shotIndex) ? ctx.shotIndex : 0;
  const previous = ctx.previousShot || null;
  let shot;
  let reason;

  if (ctx.isNewSubject) {
    shot = 'establishing';
    reason = 'new_subject';
  } else if (ctx.event && ctx.event.priority >= 70) {
    shot = previous === 'close' ? 'reaction' : 'close';
    reason = `event:${ctx.event.kind}`;
  } else if ((ctx.speed || 0) >= TRAVEL_SPEED) {
    const rot = ACTIVITY_ROTATIONS.travelling;
    shot = rot[index % rot.length];
    reason = 'travelling';
  } else if (ctx.context && (ctx.context.space !== 'open' || ctx.context.discovery)) {
    // Phase 7: modulate the rotation by the detected scene context. Enclosed/indoor spaces get
    // tight shots; a fresh discovery opens on a slow panoramic. Open + non-discovery falls through
    // to the normal activity rotation below.
    const rot = spaceRotation(ctx.activity, ctx.context);
    shot = rot[index % rot.length];
    reason = `context:${ctx.context.reason}`;
    if (shot === previous && rot.length > 1) {
      shot = rot[(index + 1) % rot.length];
      reason += ':rotated';
    }
  } else {
    const rot = ACTIVITY_ROTATIONS[ctx.activity] || ACTIVITY_ROTATIONS.idle;
    shot = rot[index % rot.length];
    reason = `activity:${ctx.activity || 'idle'}`;
    if (shot === previous && rot.length > 1) {
      shot = rot[(index + 1) % rot.length];
      reason += ':rotated';
    }
  }

  const geometry = SHOTS[shot] || SHOTS.medium;
  // Orbit is the one shot that is supposed to keep moving around the subject.
  const yaw = shot === 'orbit' ? (geometry.yaw + index * 47) % 360 : geometry.yaw;
  return {
    shot,
    geometry,
    reason,
    yaw,
    transitionMs: geometry.transitionMs,
    minMs: geometry.minMs,
    maxMs: geometry.maxMs,
  };
}

/**
 * Arguments for the `cam_shot` capability.
 * @param {{shot:string, geometry:object, yaw:number, transitionMs:number}} plan
 */
function shotArgs(plan) {
  const g = plan.geometry;
  return [plan.shot, g.dist, g.height, plan.yaw, plan.transitionMs, g.lead];
}

module.exports = {
  SHOTS,
  SHOT_NAMES,
  ACTIVITY_ROTATIONS,
  TRAVEL_SPEED,
  selectShot,
  shotArgs,
  spaceRotation,
};
