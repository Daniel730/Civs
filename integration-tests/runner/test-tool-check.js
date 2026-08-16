'use strict';
// Deterministic checkTool test harness (task step 4).
const { checkTool } = require('./lib/tool-check');

const cases = [
  ['STONE', 'AIR', false, 'pickaxe'],            // empty hands -> unmatched, needs pickaxe
  ['OAK_LOG', 'IRON_AXE', true, 'axe'],          // correct tool -> matched
  ['obsidian', 'IRON_PICKAXE', false, 'diamond_pickaxe'], // too weak -> unmatched
  ['OAK_LOG', 'AIR', false, 'axe'],              // empty hands on log -> needs axe
  ['mob', 'AIR', false, 'sword'],                // guard combat target -> needs sword
  ['GRASS_BLOCK', 'IRON_AXE', false, 'shovel'],  // wrong tool -> switch_or_fetch
];

let pass = 0;
for (const [target, held, expMatched, expTool] of cases) {
  const v = checkTool(held, target);
  const ok = v.matched === expMatched && (v.expectedTool === expTool || (expTool === null && v.expectedTool === null));
  if (ok) pass++;
  console.log(
    `case target=${target} held=${held} -> matched=${v.matched} expectedTool=${v.expectedTool} actualTool=${v.actualTool} | ${ok ? 'PASS' : 'FAIL'}`
  );
}
console.log(`\nSUMMARY: ${pass}/${cases.length} cases passed`);
