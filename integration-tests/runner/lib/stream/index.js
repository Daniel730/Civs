/**
 * Slim stream surface for overnight NPC cinematic (FallbackDirector).
 * Full OBS/health tooling lives on feat/stream-nightshift-51 (#51/#52).
 */
module.exports = {
  ...require('./shot-planner'),
  ...require('./fallback-director'),
};
