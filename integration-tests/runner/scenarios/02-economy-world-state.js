'use strict';
/**
 * Economy + world-state assertions exercising the framework verbs against real server state:
 * set/add money and assert balance (Vault), place a block and assert its material, spawn an
 * entity, and read the Civs scheduler's internal pending-task count.
 */
const PLAYER = 'Tester';
// Near-spawn coordinates: spawn chunks stay loaded, so block/entity ops are fast & reliable.
const BX = 5, BY = -59, BZ = 5;

module.exports = {
  name: 'EconomyAndWorldState',

  async run(ctx) {
    // --- Economy (priority 5) ---
    await ctx.harness.money.set(PLAYER, 5000);
    ctx.expect('economy balance set to 5000', await ctx.harness.assert.economy(PLAYER, 'eq', 5000));
    await ctx.harness.money.add(PLAYER, 2500);
    ctx.expect('economy balance >= 7500 after add', await ctx.harness.assert.economy(PLAYER, 'ge', 7500));
    ctx.expect('economy balance <= 8000 (no overflow)', await ctx.harness.assert.economy(PLAYER, 'le', 8000));

    // --- Block state ---
    await ctx.harness.block.set(BX, BY, BZ, 'DIAMOND_BLOCK');
    await ctx.waitTicks(2);
    ctx.expect('placed block is DIAMOND_BLOCK', await ctx.harness.assert.block(BX, BY, BZ, 'DIAMOND_BLOCK'));

    // --- Entity spawn (world state) ---
    const spawn = await ctx.harness.spawnEntity('COW', 6, BY, 6);
    ctx.expectTrue('cow entity spawned', /uuid=|pending/.test(spawn._raw || ''), spawn._raw);

    // --- Scheduler internal state (priority 7) ---
    const sched = await ctx.harness.scheduler();
    ctx.expectTrue('civs scheduler pending-task count is readable',
      Number.isInteger(parseInt(sched.civsPendingTasks, 10)), sched._raw);
  },

  async cleanup(ctx) {
    await ctx.harness.block.set(BX, BY, BZ, 'AIR');
  },
};
