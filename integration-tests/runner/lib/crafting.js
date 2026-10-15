'use strict';

/**
 * Player-like crafting helpers.
 *
 * Rules:
 * - Crafting is allowed ONLY if the actor already has the required ingredients
 *   in inventory (`cap.inventory`). No material is ever granted.
 * - If materials are missing, callers must send the actor to gather/craft them
 *   instead of falling back to `giveItem`.
 */

const { EVENT, emitAgentEvent } = require('@daniel730/aiworld/events');

/**
 * Normalize a Minecraft material name to a bare uppercase id.
 * Real inventories report namespaced ids (`minecraft:cobblestone`), while recipes
 * are often written bare (`COBBLESTONE`). Comparing them without stripping the
 * namespace made a full inventory look empty, so a player-like actor refused to
 * craft with materials it actually held.
 */
function normMaterial(raw) {
  const s = String(raw == null ? '' : raw).trim().toUpperCase();
  const colon = s.lastIndexOf(':');
  return colon === -1 ? s : s.slice(colon + 1);
}

/**
 * @param {{ inventory: (player: string) => Promise<object>, craftItem: (actorName: string, material: string, amount: number) => Promise<{ success: boolean, reason?: string }> }} ports
 * @param {string} actorName
 * @param {{ ingredients: Array<{ material: string, amount: number }> }} recipe
 * @returns {{ canCraft: boolean, missing: Array<{ material: string, need: number, have: number }>, have: Record<string, number> }}
 */
async function checkMaterials(ports, actorName, recipe) {
  const rawInv = await ports.inventory(actorName);
  const items = Array.isArray((rawInv && rawInv.data && rawInv.data.items) ? rawInv.data.items : (rawInv && rawInv.items))
    ? (rawInv.data.items || rawInv.items)
    : [];

  const have = {};
  for (const it of items) {
    const mat = normMaterial(it && (it.material || it.type || ''));
    const qty = Number(it && (it.amount || it.count || 0));
    if (!mat || qty <= 0) continue;
    have[mat] = (have[mat] || 0) + qty;
  }

  const missing = [];
  for (const ing of (recipe && recipe.ingredients) || []) {
    const mat = normMaterial(ing.material);
    const need = Number(ing.amount || 0);
    if (!mat || need <= 0) continue;
    const cur = Number(have[mat] || 0);
    if (cur < need) {
      missing.push({ material: mat, need, have: cur });
    }
  }

  return { canCraft: missing.length === 0, missing, have };
}

/**
 * Decide whether to craft, and if so, emit events and return success.
 *
 * @returns {{ success: boolean, reason: string, missing?: Array<{ material: string, need: number, have: number }> }}
 */
async function craftIfPossible(ports, actorName, resultItem, amount, recipe, eventSink) {
  amount = Number(amount || 1);
  if (amount <= 0) amount = 1;

  const check = await checkMaterials(ports, actorName, recipe);
  if (!check.canCraft) {
    emitAgentEvent(eventSink, EVENT.INVENTORY_DIFF, {
      actorId: actorName,
      kind: 'craft_declined_missing_materials',
      resultItem: normMaterial(resultItem),
      amount,
      missing: check.missing,
    });
    return {
      success: false,
      reason: 'missing_materials',
      missing: check.missing,
      resultItem: normMaterial(resultItem),
    };
  }

  emitAgentEvent(eventSink, EVENT.ACTION, {
    actorId: actorName,
    kind: 'craft',
    resultItem: normMaterial(resultItem),
    amount,
    recipe,
  });

  // Player-like: craft from the actor's own inventory using the harness's craftItem method.
  // No giveItem is used; the craft consumes materials the NPC already holds.
  const crafted = await ports.craftItem(actorName, normMaterial(resultItem), amount);
  const ok = crafted && crafted.success === true;
  return {
    success: ok,
    reason: ok ? 'crafted' : (crafted && crafted.reason) || 'craft_failed',
    resultItem: normMaterial(resultItem),
    amount,
    missing: [],
    via: 'craft_item',
  };
}

/**
 * Build simple recipes for common tools from gathered materials.
 * Ingredients are kept minimal and deterministic.
 */
const RECIPES = {
  WOODEN_PICKAXE: { result: 'WOODEN_PICKAXE', ingredients: [{ material: 'OAK_PLANKS', amount: 3 }, { material: 'STICK', amount: 2 }] },
  STONE_PICKAXE: { result: 'STONE_PICKAXE', ingredients: [{ material: 'COBBLESTONE', amount: 3 }, { material: 'STICK', amount: 2 }] },
  WOODEN_AXE: { result: 'WOODEN_AXE', ingredients: [{ material: 'OAK_PLANKS', amount: 3 }, { material: 'STICK', amount: 2 }] },
  STONE_AXE: { result: 'STONE_AXE', ingredients: [{ material: 'COBBLESTONE', amount: 3 }, { material: 'STICK', amount: 2 }] },
  WOODEN_SHOVEL: { result: 'WOODEN_SHOVEL', ingredients: [{ material: 'OAK_PLANKS', amount: 1 }, { material: 'STICK', amount: 2 }] },
    STONE_SHOVEL: { result: 'STONE_SHOVEL', ingredients: [{ material: 'COBBLESTONE', amount: 1 }, { material: 'STICK', amount: 2 }] },
    WOODEN_SWORD: { result: 'WOODEN_SWORD', ingredients: [{ material: 'OAK_PLANKS', amount: 2 }, { material: 'STICK', amount: 1 }] },
    STONE_SWORD: { result: 'STONE_SWORD', ingredients: [{ material: 'COBBLESTONE', amount: 2 }, { material: 'STICK', amount: 1 }] },
};

function recipeFor(resultItem) {
  return RECIPES[normMaterial(resultItem)] || null;
}

/**
 * Map a canonical tool family (from expectedToolName) to the recipe for the
 * stone-tier tool the NPC should craft. Returns null if no craftable recipe.
 * @param {string} toolFamily  'pickaxe' | 'axe' | 'shovel' | 'sword'
 * @returns {{result: string, ingredients: Array<{material:string, amount:number}>}|null}
 */
function recipeForTool(toolFamily) {
  const map = {
    pickaxe: RECIPES.STONE_PICKAXE,
    axe: RECIPES.STONE_AXE,
    shovel: RECIPES.STONE_SHOVEL,
    sword: RECIPES.WOODEN_SWORD,
  };
  return map[toolFamily] || null;
}

module.exports = {
  craftIfPossible,
  checkMaterials,
  recipeFor,
  recipeForTool,
  RECIPES,
  normMaterial,
  // Intent-revealing aliases used by callers/tests: crafting is only ever done
  // from the actor's OWN inventory (no material is granted), so these names state
  // the player-like contract explicitly.
  craftWithOwnResources: craftIfPossible,
  canCraftFromInventory: checkMaterials,
};
