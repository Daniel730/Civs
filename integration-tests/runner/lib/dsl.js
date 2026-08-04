'use strict';
/**
 * Fluent scenario DSL. Turns a chain of player actions + expectations into a runnable
 * scenario. Actions are delegated to the ACTOR (production code path); expectations are
 * checked by the HARNESS (internal-state observation). Example:
 *
 *   scenario('Place shelter')
 *     .player('Steve')
 *     .teleport(500, -60, 500)
 *     .placeRegion('shelter', 500, -60, 500)   // -> actor -> /cv placeregion -> real pipeline
 *     .expectRegion('shelter', 500, -60, 500)  // -> harness -> RegionManager.getRegionAt
 *     .expectNoErrors()
 *     .resetRegion(500, -60, 500)
 *     .build();
 */
class ScenarioBuilder {
  constructor(name) {
    this.name = name;
    this.steps = [];
    this.teardown = [];
    this._checkNoErrors = false;
  }

  // --- actions (delegated to the actor) ---
  player(n) { this.steps.push({ kind: 'action', desc: `player ${n}`, run: async (ctx) => {
    ctx.playerName = n;
    if (ctx.actor && ctx.actor.available) { ctx.actor.name = n; await ctx.actor.grantOp(); }
  }}); return this; }

  teleport(x, y, z) { this.steps.push(this._action(`teleport ${x},${y},${z}`, (ctx) => ctx.actor.teleport(x, y, z))); return this; }
  give(item, qty = 1) { this.steps.push(this._action(`give ${qty}x ${item}`, (ctx) => ctx.actor.give(item, qty))); return this; }
  placeRegion(type, x, y, z) { this.steps.push(this._action(`placeRegion ${type} @ ${x},${y},${z}`, (ctx) => ctx.actor.placeRegion(type, x, y, z))); return this; }
  runCommand(cmd) { this.steps.push(this._action(`runCommand ${cmd}`, (ctx) => ctx.actor.runCommand(cmd))); return this; }
  waitTicks(n) { this.steps.push({ kind: 'wait', run: (ctx) => ctx.waitTicks(n) }); return this; }

  _action(desc, fn) {
    return { kind: 'action', desc, run: async (ctx) => {
      if (!ctx.actor || !ctx.actor.available) {
        ctx.expectTrue(`action requires actor: ${desc}`, false, ctx.actor ? ctx.actor.reason : 'no actor');
        throw new Error(`actor unavailable for action: ${desc}`);
      }
      await fn(ctx);
    }};
  }

  // --- expectations (delegated to the harness) ---
  expectRegion(type, x, y, z, world) {
    this.steps.push({ kind: 'expect', run: async (ctx) =>
      ctx.expect(`region ${type} exists at ${x},${y},${z}`, await ctx.harness.assert.region(type, x, y, z, world)) });
    return this;
  }
  expectMoney(player, op, amt) {
    this.steps.push({ kind: 'expect', run: async (ctx) =>
      ctx.expect(`economy ${player} ${op} ${amt}`, await ctx.harness.assert.economy(player, op, amt)) });
    return this;
  }
  expectPermission(player, node, val) {
    this.steps.push({ kind: 'expect', run: async (ctx) =>
      ctx.expect(`permission ${node}=${val}`, await ctx.harness.assert.permission(player, node, val)) });
    return this;
  }
  expectBlock(x, y, z, material, world) {
    this.steps.push({ kind: 'expect', run: async (ctx) =>
      ctx.expect(`block ${material} at ${x},${y},${z}`, await ctx.harness.assert.block(x, y, z, material, world)) });
    return this;
  }
  expectRegionCount(type, count) {
    this.steps.push({ kind: 'expect', run: async (ctx) =>
      ctx.expectEqual(`region count ${type}`, await ctx.harness.region.count(type), count) });
    return this;
  }
  /** @param {{ignore?: RegExp[]}} [opts] allowlist of known-benign log patterns. */
  expectNoErrors(opts) { this._checkNoErrors = true; this._noErrorsIgnore = (opts && opts.ignore) || []; return this; }

  // --- persistence / arrange (harness ops: reset/observe/fixture — never Civs creation) ---
  saveRegions() { this.steps.push({ kind: 'op', run: (ctx) => ctx.harness.region.save() }); return this; }
  reloadRegions() { this.steps.push({ kind: 'op', run: async (ctx) => {
    const r = await ctx.harness.region.reload();
    ctx.expectTrue('reload loaded regions from disk', parseInt(r.regions, 10) > 0, r._raw);
  }}); return this; }
  arrangeMoney(player, amt) { this.steps.push({ kind: 'op', run: (ctx) => ctx.harness.money.set(player, amt) }); return this; }
  arrangeBlock(x, y, z, material) { this.steps.push({ kind: 'op', run: (ctx) => ctx.harness.block.set(x, y, z, material) }); return this; }
  wait(ms) { this.steps.push({ kind: 'wait', run: () => new Promise((r) => setTimeout(r, ms)) }); return this; }
  /** Escape hatch for a custom step: fn(ctx). */
  step(desc, fn) { this.steps.push({ kind: 'op', desc, run: fn }); return this; }

  // --- teardown (harness reset; runs even on failure) ---
  resetRegion(x, y, z, world) { this.teardown.push((ctx) => ctx.harness.region.reset(x, y, z, world)); return this; }
  resetBlock(x, y, z, world) { this.teardown.push((ctx) => ctx.harness.block.reset(x, y, z, world)); return this; }
  cleanup(fn) { this.teardown.push(fn); return this; }

  build() {
    const self = this;
    return {
      name: this.name,
      async run(ctx) {
        const mark = ctx.markLog();
        for (const step of self.steps) await step.run(ctx);
        if (self._checkNoErrors) {
          const ignore = self._noErrorsIgnore || [];
          const errs = ctx.errorsSince(mark).filter((l) => !ignore.some((re) => re.test(l)));
          ctx.expectTrue('no server errors during scenario', errs.length === 0,
            errs.slice(0, 3).join(' | ') || 'clean');
        }
      },
      async cleanup(ctx) { for (const t of self.teardown) { try { await t(ctx); } catch (_) {} } },
    };
  }
}

function scenario(name) { return new ScenarioBuilder(name); }
module.exports = { scenario };
