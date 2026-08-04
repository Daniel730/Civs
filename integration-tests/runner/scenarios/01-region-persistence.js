'use strict';
/**
 * Region lifecycle + PERSISTENCE — the flagship integration test that unit tests cannot do.
 * Creates a region on the live server, verifies it via the plugin's internal state, saves it
 * to disk, reloads regions from disk, and verifies it survived (real serialization round-trip
 * against a running Paper server).
 */
const TYPE = 'shelter';
const X = 500, Y = -60, Z = 500;

module.exports = {
  name: 'RegionPersistence',

  async setup(ctx) {
    await ctx.harness.region.remove(X, Y, Z); // clean slate
  },

  async run(ctx) {
    const before = await ctx.harness.region.count(TYPE);

    const created = await ctx.harness.region.create(TYPE, X, Y, Z);
    ctx.expectEqual('createregion returns the region type', created.created, TYPE);
    ctx.expect('region exists at target coords', await ctx.harness.assert.region(TYPE, X, Y, Z));

    const after = await ctx.harness.region.count(TYPE);
    ctx.expectEqual('region count incremented by one', after, before + 1);

    // Persist to disk, then reload the region set FROM disk and re-check.
    await ctx.harness.region.save();
    await ctx.wait(1000); // AsyncFileWriter writes off-thread; let it flush
    const reload = await ctx.harness.region.reload();
    ctx.expectTrue('reload loaded regions from disk', parseInt(reload.regions, 10) > 0, reload._raw);
    ctx.expect('region PERSISTS after reload from disk', await ctx.harness.assert.region(TYPE, X, Y, Z));
  },

  async cleanup(ctx) {
    await ctx.harness.region.remove(X, Y, Z);
    await ctx.harness.region.save();
  },
};
