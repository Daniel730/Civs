/**
 * Context detection for the cinematic director — turns cheap, in-scope facts into a
 * small structured "what is happening around the subject" signal the shot selector can use.
 *
 * Phase 7 of the Living AI World audit. The brief asks the camera to read the *scene*, not
 * just the subject: a miner underground should get tight, intimate shots; open-air building
 * should get wides; a fresh discovery warrants a slow panoramic. This module is pure and
 * clock/position-injectable so it is unit-testable without a live server.
 *
 * Detection is intentionally heuristic and cheap (no extra observes):
 *   - space: 'closed' (underground/cave/mine) vs 'indoor' (enclosed build) vs 'open' (sky).
 *   - combat: a danger/combat event is live.
 *   - discovery: high novelty (the subject just did something unprecedented) -> panoramic.
 *
 * @param {{
 *   activity?: string,
 *   event?: {kind:string, priority:number}|null,
 *   novelty?: number,
 *   surfaceY?: number|null,
 *   y?: number|null,
 *   inVehicle?: boolean,
 * }} ctx
 * @returns {{ space: 'open'|'indoor'|'closed', combat: boolean, discovery: boolean,
 *   reason: string }}
 */
function detectContext(ctx = {}) {
  const activity = ctx.activity || 'idle';
  const event = ctx.event || null;
  const novelty = Number.isFinite(ctx.novelty) ? ctx.novelty : 0;
  const surfaceY = ctx.surfaceY != null ? ctx.surfaceY : null;
  const y = ctx.y != null ? ctx.y : null;

  let space = 'open';
  const reasons = [];

  // Underground: below the surface by more than 3 blocks => cave/mine shaft.
  if (surfaceY != null && y != null && y < surfaceY - 3) {
    space = 'closed';
    reasons.push('underground');
  }
  // Mining is almost always enclosed (shaft/cave), even if we lack a surface reading.
  if (activity === 'miner') {
    space = 'closed';
    reasons.push('mining');
  }
  // A danger/combat event implies an enclosed or tense pocket regardless of y.
  const combat = !!(
    event &&
    (event.kind === 'danger' || event.kind === 'combat' || event.priority >= 70)
  );
  if (combat && space === 'open') {
    space = 'indoor';
    reasons.push('combat_enclosure');
  }

  const discovery = novelty >= 0.6;
  if (discovery) reasons.push('discovery');

  return {
    space,
    combat,
    discovery,
    reason: reasons.join(',') || 'default',
  };
}

/**
 * Modulate an activity rotation by the detected space. Indoor/closed favours tight, intimate
 * shots; open favours wides so the environment reads. Pure — returns the shot list to use.
 * @param {string} activity
 * @param {{ space: 'open'|'indoor'|'closed', combat: boolean, discovery: boolean }} ctx
 * @returns {string[]}
 */
function spaceRotation(activity, ctx = {}) {
  const base =
    require('./shots').ACTIVITY_ROTATIONS[activity] || require('./shots').ACTIVITY_ROTATIONS.idle;
  if (ctx.discovery) {
    // A fresh discovery earns one slow panoramic before returning to the rotation.
    return ['panoramic', ...base];
  }
  if (ctx.space === 'closed' || ctx.space === 'indoor') {
    // Tight, character-driven angles for enclosed spaces.
    const tight = ['low', 'close', 'over_shoulder', 'medium'];
    // Intersect with the activity rotation so we keep activity flavour where possible.
    const merged = base.filter((s) => tight.includes(s));
    return merged.length ? merged : tight;
  }
  if (ctx.space === 'open') {
    // Open spaces: lead with the environment (wide/establishing) then the rotation.
    const openLead = ['establishing', 'wide'];
    const merged = openLead.concat(base.filter((s) => !openLead.includes(s)));
    return merged;
  }
  return base;
}

module.exports = { detectContext, spaceRotation };
