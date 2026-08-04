'use strict';

/**
 * Optional Mineflayer "player actor". Mineflayer is the intended layer for real player
 * actions (move, pathfind, place/break, open GUIs, click, attack, collect). It works fully
 * against real Paper 1.21.x servers.
 *
 * IMPORTANT (empirical, this environment): the test server pings as "26.1", which Mineflayer
 * 4.37.1 rejects (its allowlist caps at 1.21.11). Monkey-patching the version gate lets login
 * succeed, but its high-level plugins assume 1.x packet shapes and crash / never emit `spawn`.
 * So on the 26.1.2 server the actor reports unavailable and scenarios fall back to the
 * server-side harness for both actions and assertions. See docs/INTEGRATION-TESTING.md.
 */
function patchVersionGate(serverMajor) {
  try {
    const ver = require('mineflayer/lib/version.js');
    if (!ver.testedVersions.includes(serverMajor)) ver.testedVersions.push(serverMajor);
    ver.latestSupportedVersion = serverMajor;
  } catch (_) { /* mineflayer not installed */ }
}

async function createActor(opts) {
  const options = Object.assign(
    { host: '127.0.0.1', port: 25565, username: 'ItestBot', auth: 'offline', enable: true },
    opts);

  if (!options.enable) {
    return { available: false, reason: 'actor disabled by config', async disconnect() {} };
  }

  let mineflayer;
  try { mineflayer = require('mineflayer'); }
  catch (_) { return { available: false, reason: 'mineflayer not installed', async disconnect() {} }; }

  if (options.serverMajor) patchVersionGate(options.serverMajor);

  return await new Promise((resolve) => {
    let settled = false;
    const finish = (obj) => { if (!settled) { settled = true; resolve(obj); } };
    let bot;
    try {
      bot = mineflayer.createBot({
        host: options.host, port: options.port, username: options.username,
        auth: options.auth, hideErrors: true,
      });
    } catch (e) {
      return finish({ available: false, reason: 'createBot threw: ' + e.message, async disconnect() {} });
    }
    const timeout = setTimeout(() => finish({
      available: false, reason: 'no spawn within 20s (protocol/plugin incompatibility)',
      async disconnect() { try { bot.quit(); } catch (_) {} },
    }), 20000);

    bot.once('spawn', () => {
      clearTimeout(timeout);
      finish({
        available: true,
        bot,
        username: bot.username,
        async chat(msg) { bot.chat(msg); },
        async command(cmd) { bot.chat('/' + cmd.replace(/^\//, '')); },
        position() { return bot.entity && bot.entity.position; },
        heldItemName() { return bot.heldItem ? bot.heldItem.name : null; },
        inventoryNames() { return bot.inventory.items().map((i) => i.name); },
        async disconnect() { try { bot.quit(); } catch (_) {} },
      });
    });
    bot.on('error', (e) => finish({ available: false, reason: 'error: ' + e.message, async disconnect() {} }));
    process.once('uncaughtException', (e) => finish({ available: false, reason: 'uncaught: ' + e.message, async disconnect() {} }));
  });
}

module.exports = { createActor };
