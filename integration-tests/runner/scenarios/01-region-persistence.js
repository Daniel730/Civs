'use strict';
/**
 * Player-driven region creation + persistence, expressed in the DSL.
 *
 * The ACTOR (a real online player) creates the region through Civs' production pipeline
 * (`/cv placeregion` -> RegionManager.createRegionFromPlacement -> RegionCreatedEvent ->
 * listeners). The HARNESS only OBSERVES the result and reloads from disk. The harness never
 * creates the region — that is the whole point of the two-layer split.
 *
 * (On this 26.1.2 server the raw actor can hold a Player and drive commands but cannot place
 *  blocks natively; the full block-place -> AllowedActionsListener chain runs with the
 *  Mineflayer actor on real ≤1.21.x servers. See docs/INTEGRATION-TESTING.md.)
 */
const { scenario } = require('../lib/dsl');
const TYPE = 'shelter';
const X = 500, Y = -60, Z = 500;

module.exports = scenario('RegionPersistence')
  .player('Steve')                 // actor: real online player, OP'd
  .teleport(X, Y + 2, Z)           // actor action
  .placeRegion(TYPE, X, Y, Z)      // actor action -> PRODUCTION region-creation pipeline
  .waitTicks(5)
  .expectRegion(TYPE, X, Y, Z)     // harness observes: region really registered
  .expectRegionCount(TYPE, 3)      // harness observes internal count (2 pre-existing + this one)
  .saveRegions()                   // persist to disk
  .wait(1000)                      // AsyncFileWriter flushes off-thread
  .reloadRegions()                 // reload region set FROM disk
  .expectRegion(TYPE, X, Y, Z)     // harness observes: survived reload (real serialization)
  // Ignore the known-benign errors from reloading the Civs_servidor pack, whose saved
  // regions reference a world UUID that doesn't exist on this fresh world (see AGENTS.md).
  .expectNoErrors({ ignore: [/Null world/, /invalid region/] })
  .resetRegion(X, Y, Z)            // teardown
  .build();
