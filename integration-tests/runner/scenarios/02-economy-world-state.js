'use strict';
/**
 * Economy + world-state assertions in the DSL. Economy/block are arranged as fixtures
 * (not Civs game logic) and then OBSERVED via the harness; `expectNoErrors` scans the
 * server log for errors during the scenario.
 */
const { scenario } = require('../lib/dsl');
const PLAYER = 'Steve';
// Near-spawn coordinates: spawn chunks stay loaded, so block ops are fast & reliable.
const BX = 5, BY = -59, BZ = 5;

module.exports = scenario('EconomyAndWorldState')
  .arrangeMoney(PLAYER, 5000)
  .expectMoney(PLAYER, 'eq', 5000)
  .step('add 2500', (ctx) => ctx.harness.money.add(PLAYER, 2500))
  .expectMoney(PLAYER, 'ge', 7500)
  .expectMoney(PLAYER, 'le', 8000)
  .arrangeBlock(BX, BY, BZ, 'DIAMOND_BLOCK')
  .waitTicks(2)
  .expectBlock(BX, BY, BZ, 'DIAMOND_BLOCK')
  .expectNoErrors()
  .resetBlock(BX, BY, BZ)
  .build();
