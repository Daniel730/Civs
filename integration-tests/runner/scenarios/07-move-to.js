/**
 * Empirically validates greedy server-side move_to / step (no Mineflayer pathfinder).
 * Open flat pad: teleport to A, move_to B ~8 blocks away, assert arrival distance.
 *
 * NOTE (D-AP-021): greedy move_to is now the documented FALLBACK rung only — production
 * callers navigate via lib/village/walk.walkTo (walk_path/walk_status). This scenario is
 * kept deliberately on the raw capability so the fallback stays regression-tested.
 */
const { scenario } = require('../lib/dsl');

const A = { x: 800, y: -60, z: 800 };
const B = { x: 808, y: -60, z: 800 };

module.exports = scenario('MoveToNavigation')
  .player('Steve')
  .teleport(A.x, A.y, A.z)
  .step('prepare flat pads', async (ctx) => {
    // Ensure walkable stone under start/goal (creative flat-ish area)
    await ctx.harness.block.set(A.x, A.y - 1, A.z, 'STONE');
    await ctx.harness.block.set(B.x, B.y - 1, B.z, 'STONE');
    for (let x = A.x; x <= B.x; x++) {
      await ctx.harness.block.set(x, A.y - 1, A.z, 'STONE');
      await ctx.harness.block.set(x, A.y, A.z, 'AIR');
      await ctx.harness.block.set(x, A.y + 1, A.z, 'AIR');
    }
  })
  .teleport(A.x + 0.5, A.y, A.z + 0.5)
  .step('move_to goal', async (ctx) => {
    const r = await ctx.harness.cap.moveTo(
      ctx.playerName,
      B.x + 0.5,
      B.y,
      B.z + 0.5,
      15000,
      1.5,
      0.9
    );
    ctx.expectTrue('move_to success', r.success === true, r.reason || r._raw);
    const dist = r.data && typeof r.data.final_distance === 'number' ? r.data.final_distance : 99;
    ctx.expectTrue(
      'arrived within 1.5',
      dist <= 1.5,
      'final_distance=' + dist + ' data=' + JSON.stringify(r.data)
    );
  })
  .step('observe near goal', async (ctx) => {
    const obs = await ctx.harness.cap.observe(ctx.playerName);
    ctx.expectTrue('observe ok', obs.success === true, obs.reason || obs._raw);
    const dx = Math.abs((obs.data.x || 0) - (B.x + 0.5));
    const dz = Math.abs((obs.data.z || 0) - (B.z + 0.5));
    ctx.expectTrue(
      'near goal xz',
      Math.hypot(dx, dz) <= 1.5,
      JSON.stringify({ dx, dz, data: obs.data })
    );
  })
  .expectNoErrors({ ignore: [/\[CivsTestHarness\]/] })
  .build();
