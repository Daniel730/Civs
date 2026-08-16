// Integration test (LIVE QA server required): prove diffInventory reflects the
// REAL observed inventory across a real break_block — no give/clear involved.
//
//   wsl -- bash -c '/home/dansilva/.nvm/versions/node/v25.8.0/bin/node \
//     /mnt/c/Users/Danie/Downloads/Civs-1.11.6/Civs-1.11.6/integration-tests/runner/scripts/test-inventory-diff-qa.js'
//
// Restores the world block it temporarily swaps, so it is safe to re-run.

const { Harness } = require('../lib/harness');
const { applyObserve, diffInventory } = require('../lib/inventory-diff');

const TARGET = 'OAK_LOG'; // the material we will break/observe

(async () => {
  const h = new Harness({ host: '127.0.0.1', port: 25576, password: 'civsqa', timeout: 20000 });
  await h.connect();
  const cap = h.cap;

  const beforeObs = await cap.observe('Steve');
  if (!beforeObs || beforeObs.success !== true) {
    throw new Error('observe(before) failed: ' + JSON.stringify(beforeObs));
  }
  const beforeMap = applyObserve(beforeObs);
  const d = (beforeObs && beforeObs.data) || {};
  const bx = Math.floor(d.x), by = Math.floor(d.y), bz = Math.floor(d.z);
  // Floor block is 1 below feet; break the one BESIDE Steve so he does not fall.
  const tx = bx + 1, ty = by - 1, tz = bz;

  // Snapshot + overwrite the adjacent floor block with the target material.
  const original = await h.block.at(tx, ty, tz);
  console.log(`[setup] Steve @ (${d.x},${d.y},${d.z})  target block (${tx},${ty},${tz}) was ${original}`);
  await h.block.set(tx, ty, tz, TARGET);

  const broke = await cap.breakBlock('Steve', tx, ty, tz);
  console.log('[break]', broke && broke._raw ? broke._raw : JSON.stringify(broke));

  // Let the dropped item get auto-collected (MC pickup delay ~0.5s).
  await new Promise((r) => setTimeout(r, 2000));

  const afterObs = await cap.observe('Steve');
  const afterMap = applyObserve(afterObs);

  // Restore the world exactly as we found it.
  if (original) await h.block.set(tx, ty, tz, original);

  const diff = diffInventory(beforeMap, afterMap, {
    expectedDrops: { [TARGET]: 1 },
    from: `break:${TARGET}`,
  });

  console.log('\n=== RESULT ===');
  console.log('before:', JSON.stringify(beforeMap));
  console.log('after :', JSON.stringify(afterMap));
  console.log('diff  :', JSON.stringify(diff, null, 2));

  const ok =
    (diff.gained.some((g) => g.item === TARGET) ||
      diff.dropped.some((x) => x.item === TARGET)) &&
    !diff.gained.some((g) => g.item !== TARGET);
  console.log('\nVERDICT:', ok ? 'PASS — real inventory diff reflects the broken block' : 'CHECK');
  await h.close();
  process.exit(ok ? 0 : 2);
})().catch((e) => {
  console.error('FAIL', e);
  process.exit(1);
});
