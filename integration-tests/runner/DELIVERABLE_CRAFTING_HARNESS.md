Deliverable: Player-like crafting harness for Civs NPCs

Problem
- NPCs logged `needsTool` with action='fetch_or_craft' but never executed crafting (0 calls to craftIfPossible).
- Java harness lacked a `craft_item` capability, so crafting never happened.

Solution implemented
- Added `craft_item` action to Java TestHarnessPlugin (CapabilityActions.java):
  - Consumes materials from the player's inventory.
  - Returns success/failure JSON with `insufficient_materials` or `inventory_full` reasons.
- Exposed `craftItem` in Node Capabilities class (capabilities.js).
- Updated lib/crafting.js:
  - craftIfPossible now uses ports.craftItem instead of giveItem.
  - Added recipeForTool helper to map tool family (pickaxe/axe/shovel/sword) to stone-tier recipe.
  - Added WOODEN_SWORD and STONE_SWORD to RECIPES.
- Updated test/crafting.test.js to include craftItem mock and verify crafting path.

Unit tests
- npm run test:unit (357/357 pass) — no regressions.
- crafting.test.js: 3/3 pass, including new craftItem path.

Next step (in-game validation)
- Start Civs QA server (WSL, RCON 25575).
- Run village-worker.js; verify NPC crafts STONE_PICKAXE using only materials it collected (no giveItem).
- Observe logs for kind:'craft' events and inventory diffs proving materials were consumed.

Files changed
- integration-tests/test-harness-plugin/src/main/java/org/civs/itest/harness/CapabilityActions.java (+craft_item)
- integration-tests/runner/lib/capabilities.js (+craftItem)
- integration-tests/runner/lib/crafting.js (craftIfPossible uses craftItem, added recipeForTool)
- integration-tests/runner/test/crafting.test.js (added craftItem mock)

Evidence
- Unit test output: 357/357 pass, crafting.test.js 3/3 pass.
- Crafting harness now exists and is callable from Node.
