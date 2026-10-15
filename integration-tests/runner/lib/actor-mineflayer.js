/**
 * Optional Mineflayer "player actor". Mineflayer is the intended layer for real player
 * actions (move, pathfind, place/break, open GUIs, click, attack, collect). It works fully
 * against real Paper 1.21.x servers.
 *
 * EMPIRICAL (2026-08-18, this environment): the test server pings as "26.1" (Paper 26.1.2).
 * Mineflayer 4.37.1's version gate caps at 1.21.11, so we monkey-patch it to accept 26.1.2.
 * Whether the HIGH-LEVEL plugins (physics/pathfinder/block) actually work on 26.1.2 is UNPROVEN
 * — that is exactly what Fase A tests: does the bot emit `spawn` within the timeout? If yes,
 * Mineflayer is viable here and we proceed to B (replace harness body). If no, it is blocked on
 * 26.1.2 and we fall back (or downgrade the server / bump mineflayer).
 */
function patchVersionGate(serverMajor) {
  try {
    const ver = require('mineflayer/lib/version.js');
    if (!ver.testedVersions.includes(serverMajor)) ver.testedVersions.push(serverMajor);
    ver.latestSupportedVersion = serverMajor;
    return true;
  } catch (_) {
    /* mineflayer not installed */
    return false;
  }
}

async function createActor(opts) {
  const options = Object.assign(
    { host: '127.0.0.1', port: 25565, username: 'ItestBot', auth: 'offline', enable: true },
    opts
  );

  if (!options.enable) {
    return { available: false, reason: 'actor disabled by config', async disconnect() {} };
  }

  let mineflayer;
  try {
    mineflayer = require('mineflayer');
  } catch (_) {
    return { available: false, reason: 'mineflayer not installed', async disconnect() {} };
  }

  const patched = options.serverMajor ? patchVersionGate(options.serverMajor) : false;

  return await new Promise((resolve) => {
    let settled = false;
    const finish = (obj) => {
      if (!settled) {
        settled = true;
        resolve(obj);
      }
    };
    let bot;
    try {
      bot = mineflayer.createBot({
        host: options.host,
        port: options.port,
        username: options.username,
        auth: options.auth,
        version: options.serverMajor || undefined,
        hideErrors: true,
        // offline-mode server (seen in QA logs: SERVER IS RUNNING IN OFFLINE/INSECURE MODE)
        skipValidation: true,
      });
    } catch (e) {
      return finish({
        available: false,
        reason: 'createBot threw: ' + e.message,
        async disconnect() {},
      });
    }
    const timeout = setTimeout(
      () =>
        finish({
          available: false,
          reason: 'no spawn within 20s (protocol/plugin incompatibility on 26.1.2)',
          async disconnect() {
            try {
              bot.quit();
            } catch (_) {}
          },
        }),
      20000
    );

    bot.once('spawn', () => {
      clearTimeout(timeout);
      finish({
        available: true,
        patchedVersionGate: patched,
        serverMajor: options.serverMajor,
        bot,
        username: bot.username,
        position() {
          return bot.entity && bot.entity.position;
        },
        heldItemName() {
          return bot.heldItem ? bot.heldItem.name : null;
        },
        inventoryNames() {
          return bot.inventory.items().map((i) => i.name);
        },
        async disconnect() {
          try {
            bot.quit();
          } catch (_) {}
        },
      });
    });
    bot.on('error', (e) =>
      finish({ available: false, reason: 'error: ' + e.message, async disconnect() {} })
    );
    bot.on('kick', (reason) =>
      finish({
        available: false,
        reason: 'kick: ' + (reason || '').toString().slice(0, 120),
        async disconnect() {},
      })
    );
  });
}

module.exports = { createActor };
