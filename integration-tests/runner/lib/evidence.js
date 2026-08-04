'use strict';
const fs = require('fs');
const path = require('path');

/**
 * On scenario failure, capture a bundle of evidence so CI can show exactly WHY it failed:
 * server log tail, JSON snapshots of internal state (regions, scheduler, economy,
 * inventory), and timings. (A screenshot is added only when a GUI client actor is
 * available — not on this headless 26.1.2 server; see docs.)
 */
async function capture(dir, { harness, suite, serverLogPath, playerName }) {
  fs.mkdirSync(dir, { recursive: true });
  const write = (name, data) => fs.writeFileSync(path.join(dir, name),
    typeof data === 'string' ? data : JSON.stringify(data, null, 2));

  // server log tail
  try {
    if (serverLogPath && fs.existsSync(serverLogPath)) {
      const buf = fs.readFileSync(serverLogPath);
      const tail = buf.slice(Math.max(0, buf.length - 64 * 1024)).toString('utf8')
        .replace(/\u0000/g, '').replace(/\x1b\[[0-9;]*m/g, '');
      write('server.log', tail);
    }
  } catch (e) { write('server.log', 'capture error: ' + e.message); }

  // internal-state snapshots (best-effort)
  const safe = async (fn, fallback) => { try { return await fn(); } catch (e) { return { error: e.message, ...fallback }; } };
  write('loaded-regions.json', await safe(() => harness.dump.regions(), {}));
  write('scheduler.json', await safe(() => harness.dump.scheduler(), {}));
  if (playerName) {
    write('economy.json', await safe(() => harness.dump.economy(playerName), {}));
    write('inventory.json', await safe(() => harness.dump.inventory(playerName), {}));
  }

  // timings + failure summary
  const failing = (suite.cases || []).filter((c) => !c.ok);
  write('timings.txt', [
    `scenario: ${suite.name}`,
    `total: ${suite.timeMs || 0} ms`,
    ...(suite.cases || []).map((c) => `${c.ok ? 'PASS' : 'FAIL'}  ${c.timeMs}ms  ${c.name}`),
  ].join('\n') + '\n');
  write('failure-summary.json', {
    scenario: suite.name,
    error: suite.error || null,
    failedAssertions: failing.map((c) => ({ name: c.name, message: c.message })),
  });

  return dir;
}

module.exports = { capture };
