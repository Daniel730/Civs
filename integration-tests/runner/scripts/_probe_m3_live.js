// TEMP probe: live proof of M3 tool-block matching against the real QA server.
// OBSERVE-ONLY — never breaks/places/gives. Connects, reads Steve's REAL
// data.held + data.inventory via cap.observe, then runs the actual lib/tool-check
// checkTool() against the miner/lumberjack/guard targets the worker uses. This
// proves the previously-broken `ctx.obs?.data` read path now sees real data.
const { Harness } = require('../lib/harness');
const { checkTool, findToolInInventory, expectedToolName } = require('../lib/tool-check');

const PLAYER = process.argv[2] || 'Steve';

(async () => {
  const h = new Harness({ host: '127.0.0.1', port: 25576, password: 'civsqa', timeout: 20000 });
  await h.connect();
  const ping = await h.ping();
  if (!ping || ping.pong !== '1') {
    console.log('PING FAIL', JSON.stringify(ping));
    process.exit(2);
  }

  const obs = await h.cap.observe(PLAYER).catch((e) => ({ err: String(e) }));
  if (!obs || !obs.data) {
    console.log('OBSERVE FAIL', JSON.stringify(obs));
    await h.close();
    process.exit(2);
  }

  const d = obs.data;
  console.log('=== LIVE OBSERVE (player=' + PLAYER + ') ===');
  console.log('held   :', JSON.stringify(d.held));
  console.log('inv(Material:amount):', JSON.stringify(d.inventory));
  console.log('pos    :', d.x, d.y, d.z);

  const JOB_TARGET = {
    miner: 'STONE',
    lumberjack: 'OAK_LOG',
    guard: 'mob',
    beautify: 'STONE',
    farmer: 'GRASS_BLOCK',
    builder: 'STONE',
  };

  console.log('\n=== M3 VERDICTS (live held vs each job target) ===');
  let anyMismatch = false;
  for (const [job, target] of Object.entries(JOB_TARGET)) {
    const held = d.held != null ? d.held : null;
    const inventory = Array.isArray(d.inventory) ? d.inventory : [];
    const verdict = checkTool(held, target);
    const owned = !verdict.matched ? findToolInInventory(inventory, verdict.expectedTool) : null;
    if (!verdict.matched) anyMismatch = true;
    console.log(
      `[${job}] target=${target} held=${held || 'AIR'} -> matched=${verdict.matched}` +
        (verdict.matched ? '' : ` expected=${verdict.expectedTool} action=${verdict.action}` +
          (owned ? ` ownedInInv=${owned}` : ' (not owned -> fetch/craft)'))
    );
  }

  console.log('\n=== CANONICAL TOOLS TO FETCH/CRAFT ===');
  console.log('STONE ->', expectedToolName('STONE'));
  console.log('OAK_LOG ->', expectedToolName('OAK_LOG'));
  console.log('OBSIDIAN ->', expectedToolName('OBSIDIAN'));

  console.log('\nRESULT:', anyMismatch ? 'MISMATCH DETECTED (M3 logging would fire)' : 'ALL HELD ITEMS CORRECT FOR CURRENT JOBS');
  await h.close();
  process.exit(0);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
