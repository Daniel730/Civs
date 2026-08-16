'use strict';

/**
 * lib/tool-check.js
 * -----------------------------------------------------------------------------
 * Pure helpers that decide whether the item an NPC is holding (the "held" slot
 * reported by `cap.observe`) is the correct tool for the block / mob it is about
 * to mine or fight.
 *
 * Design goals:
 *   - No I/O, no RCON, no globals. Easy to unit-test and to drop into the
 *     village worker without touching its control flow.
 *   - Minecraft-agnostic keyword matching: block names arrive UPPER_SNAKE
 *     (e.g. OAK_LOG, COBBLESTONE, NETHERRACK) or as `minecraft:` ids; both are
 *     normalised before matching.
 *   - Returns a small, structured verdict the worker can branch on.
 *
 * Tool <-> block contract (from the task spec, PT keywords mapped to EN blocks):
 *   machado / axe      <-> madeira, log, planks, wood, sapling (+ leaves/stems)
 *   picareta / pickaxe <-> pedra, cobblestone, ore, minério, obsidian(†),
 *                          netherrack (+ common stone/ore variants)
 *                          † obsidian REQUIRES a diamond (or netherite) pickaxe
 *   pá / shovel        <-> areia, terra, dirt, gravel, snow (+ clay/soul sand…)
 *   espada / sword     <-> mob, hostil / hostile (combat, not a block)
 *   empty / none in hand + a minable target  -> UNMATCHED (go fetch/craft tool)
 * -----------------------------------------------------------------------------
 */

/**
 * Valid tool -> block keyword lists. A target block matches a tool when its
 * normalised name *includes* any keyword in the list. Keywords are kept broad
 * (substring match) on purpose so new wood/stone/ore variants keep working.
 */
const TOOL_TO_BLOCKS = {
  axe: [
    'wood', 'log', 'plank', 'sapling', 'leaves', 'stem', 'stripped',
  ],
  pickaxe: [
    'stone', 'cobble', 'ore', 'minerio', 'obsidian', 'netherrack',
    'andesite', 'diorite', 'granite', 'deepslate', 'basalt', 'blackstone',
    'coal', 'iron', 'gold', 'diamond', 'emerald', 'copper', 'redstone',
    'lapis', 'quartz', 'amethyst', 'nether', 'ancient_debris', 'raw_',
  ],
  shovel: [
    'sand', 'dirt', 'grass', 'gravel', 'snow', 'clay', 'soul_sand',
    'soul_soil', 'red_sand', 'coarse_dirt', 'rooted', 'mud', 'podzol',
    'mycelium', 'farmland', 'path',
  ],
  // Combat targets (entities, not blocks). Match BEFORE block lists.
  sword: [
    'mob', 'hostile', 'hostil', 'monster',
    'zombie', 'skeleton', 'creeper', 'spider', 'enderman', 'husk', 'drowned',
    'witch', 'slime', 'phantom', 'zombified', 'piglin', 'blaze', 'ghast',
    'warden', 'ravager', 'guard',
  ],
};

/** Mining-level tiers for pickaxes (obsidian needs >= diamond). */
const PICKAXE_TIERS = ['wood', 'stone', 'iron', 'gold', 'diamond', 'netherite'];

/** Normalise an item/block name to lower_snake without the `minecraft:` prefix. */
function normalize(name) {
  if (name == null) return '';
  return String(name)
    .toLowerCase()
    .replace(/^minecraft:/, '')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

function matchesAny(normalized, keywords) {
  return keywords.some((k) => normalized.includes(k));
}

/** Extract the tier of a pickaxe material name (iron_pickaxe -> 'iron'). */
function pickaxeTier(normalizedHeld) {
  for (const tier of PICKAXE_TIERS) {
    if (normalizedHeld.startsWith(`${tier}_`) || normalizedHeld === tier) return tier;
  }
  return 'any'; // unknown/generic pickaxe — treated as insufficient for obsidian
}

/**
 * Classify a held item into a tool family.
 * @returns {{tool: 'axe'|'pickaxe'|'shovel'|'sword'|'none', tier: string|null}}
 */
function classifyHeld(held) {
  const h = normalize(held);
  if (!h || h === 'air' || h === 'none' || h === 'empty') {
    return { tool: 'none', tier: null };
  }
  // Order matters: 'pickaxe' contains 'axe', so test it first.
  if (h.includes('pickaxe')) return { tool: 'pickaxe', tier: pickaxeTier(h) };
  if (h.includes('axe')) return { tool: 'axe', tier: null };
  if (h.includes('shovel')) return { tool: 'shovel', tier: null };
  if (h.includes('sword')) return { tool: 'sword', tier: null };
  // Anything else (blocks, food, books…) is not a relevant tool.
  return { tool: 'none', tier: null };
}

/**
 * What tool does a given target (block id or 'mob'/'hostile') require?
 * @returns {{tool: 'axe'|'pickaxe'|'shovel'|'sword'|null, requiredTier: string|null}}
 *          requiredTier is only set for obsidian (must be 'diamond'/'netherite').
 */
function expectedToolFor(target) {
  const t = normalize(target);
  if (!t) return { tool: null, requiredTier: null };

  // Combat first — explicit mob/hostile tokens.
  if (matchesAny(t, TOOL_TO_BLOCKS.sword)) {
    return { tool: 'sword', requiredTier: null };
  }
  // Obsidian is a pickaxe job but demands a diamond-tier pickaxe.
  if (t.includes('obsidian')) {
    return { tool: 'pickaxe', requiredTier: 'diamond' };
  }
  if (matchesAny(t, TOOL_TO_BLOCKS.axe)) return { tool: 'axe', requiredTier: null };
  if (matchesAny(t, TOOL_TO_BLOCKS.pickaxe)) return { tool: 'pickaxe', requiredTier: null };
  if (matchesAny(t, TOOL_TO_BLOCKS.shovel)) return { tool: 'shovel', requiredTier: null };

  return { tool: null, requiredTier: null };
}

/** Render the canonical tool name a worker should fetch/craft/equip. */
function expectedToolName(target) {
  const { tool, requiredTier } = expectedToolFor(target);
  if (tool === null) return null;
  return requiredTier ? `${requiredTier}_${tool}` : tool;
}

/**
 * THE function. Given the held item and the target block/mob, decide whether the
 * NPC can mine/fight right now or must first fetch/craft the correct tool.
 *
 * @param {string|null} held      observed `data.held` (e.g. 'IRON_AXE','OAK_PLANKS','AIR')
 * @param {string}      target    block id (e.g. 'OAK_LOG','COBBLESTONE') or 'mob'/'hostile'
 * @returns {{
 *   matched: boolean,
 *   expectedTool: string|null,   // canonical name to fetch/equip (e.g. 'axe','diamond_pickaxe')
 *   actualTool: string,          // classified held tool family ('none' if empty/block)
 *   targetCategory: string|null, // 'axe'|'pickaxe'|'shovel'|'sword'
 *   requiredTier: string|null,
 *   action: string|null,         // 'fetch_or_craft' | 'switch_or_fetch' | null
 *   reason: string
 * }}
 */
function checkTool(held, target) {
  const actual = classifyHeld(held);
  const expected = expectedToolFor(target);
  const needStr = expectedToolName(target);

  // Target is not a known tool-dependent block/mob -> bare hands are fine.
  if (expected.tool === null) {
    return {
      matched: true,
      expectedTool: null,
      actualTool: actual.tool,
      targetCategory: null,
      requiredTier: null,
      action: null,
      unknown: true,
      reason: `${target} is not a known minable block or mob; bare hands suffice`,
    };
  }

  // Empty hands (or holding a non-tool block) on a minable target -> must get tool.
  if (actual.tool === 'none') {
    return {
      matched: false,
      expectedTool: needStr,
      actualTool: 'none',
      targetCategory: expected.tool,
      requiredTier: expected.requiredTier,
      action: 'fetch_or_craft',
      reason: `empty hands — ${target} needs ${needStr}; fetch or craft it before mining`,
    };
  }

  // Right tool family in hand.
  if (actual.tool === expected.tool) {
    if (expected.requiredTier) {
      const okTier =
        actual.tool === 'pickaxe' &&
        (actual.tier === 'diamond' || actual.tier === 'netherite');
      if (!okTier) {
        return {
          matched: false,
          expectedTool: needStr,
          actualTool: actual.tool,
          targetCategory: expected.tool,
          requiredTier: expected.requiredTier,
          action: 'fetch_or_craft',
          reason: `${held} is too weak for ${target}; need ${needStr}`,
        };
      }
    }
    return {
      matched: true,
      expectedTool: expected.tool,
      actualTool: actual.tool,
      targetCategory: expected.tool,
      requiredTier: expected.requiredTier,
      action: null,
      reason: `${held} is the correct tool for ${target}`,
    };
  }

  // Holding a tool, but the wrong one for this target.
  return {
    matched: false,
    expectedTool: needStr,
    actualTool: actual.tool,
    targetCategory: expected.tool,
    requiredTier: expected.requiredTier,
    action: 'switch_or_fetch',
    reason: `holding ${held} (${actual.tool}) but ${target} needs ${needStr}`,
  };
}

/**
 * Given a real inventory array (from `data.inventory`, each {material,amount}),
 * find a held material that satisfies the needed tool. Returns the material
 * string to hotbar-select/equip, or null if the tool is missing (must be crafted
 * or fetched). Honours the diamond-tier requirement for obsidian.
 *
 * @param {Array<{material:string,amount:number}>|null} inventory
 * @param {string} neededTool  canonical name from expectedToolName() ('axe','diamond_pickaxe'…)
 * @returns {string|null}
 */
function findToolInInventory(inventory, neededTool) {
  if (!Array.isArray(inventory)) return null;
  const need = normalize(neededTool);
  for (const slot of inventory) {
    const mat = slot && typeof slot.material === 'string' ? slot.material : slot;
    if (typeof mat !== 'string') continue;
    const m = normalize(mat);
    if (need === 'diamond_pickaxe') {
      if (m === 'diamond_pickaxe' || m === 'netherite_pickaxe') return mat;
    } else if (need === 'pickaxe') {
      if (m.includes('pickaxe')) return mat;
    } else if (need === 'axe') {
      if (m.includes('axe') && !m.includes('pickaxe')) return mat;
    } else if (need === 'shovel') {
      if (m.includes('shovel')) return mat;
    } else if (need === 'sword') {
      if (m.includes('sword')) return mat;
    }
  }
  return null;
}

module.exports = {
  TOOL_TO_BLOCKS,
  PICKAXE_TIERS,
  normalize,
  classifyHeld,
  expectedToolFor,
  expectedToolName,
  checkTool,
  findToolInInventory,
};

/* =============================================================================
 * INTEGRATION NOTE — where to call this from scripts/village-worker.js
 * =============================================================================
 * M2 owns village-worker.js, so DO NOT edit it here. When wiring this in, add:
 *
 *     const { checkTool, expectedToolName, findToolInInventory } = require('../lib/tool-check');
 *
 * and insert a single pre-mining guard. The natural hook is right before the
 * existing hotbar select / breakBlock calls in runJob() (around the
 * `if (['miner','builder','beautify','farmer','lumberjack','guard'].includes(step.job))`
 * block, and again immediately before each `cap.breakBlock(...)` for miner /
 * lumberjack / beautify). Concretely:
 *
 *   // --- tool-check guard (lib/tool-check.js) -------------------------------
 *   const JOB_TARGET = {
 *     miner:      'STONE',            // or 'ORE' depending on what was found
 *     lumberjack: 'OAK_LOG',
 *     beautify:   cleanupBlockMaterial, // the material being torn down
 *     guard:      'mob',              // combat target
 *   };
 *   const target = JOB_TARGET[step.job];
 *   if (target) {
 *     const verdict = checkTool(ctx.observed?.data?.held, target);
 *     log({ kind: 'tool_check', job: step.job, target, ...verdict });
 *     if (!verdict.matched) {
 *       // 1) try the NPC's own inventory first (no admin, no giveItem)
 *       const have = findToolInInventory(ctx.observed?.data?.inventory, verdict.expectedTool);
 *       if (have) {
 *         await cap.hotbar(actorName, inventorySlotOf(have)).catch(() => {});
 *       } else {
 *         // 2) unmatched & not in inventory -> NPC must go fetch/craft the
 *         //    right tool BEFORE breaking. Raise a 'needs_tool' pause so the
 *         //    worker routes to a crafting/chest station instead of swinging
 *         //    bare-handed (which is slow and, for obsidian, impossible).
 *         results.toolMismatch = verdict;
 *         state.needsTool = verdict.expectedTool; // consulted by the planner
 *         return results; // skip breakBlock this tick; retry once equipped
 *       }
 *     }
 *   }
 *   // -----------------------------------------------------------------------
 *
 * Behaviour it enables:
 *   - matched:true        -> proceed to breakBlock as today.
 *   - unmatched + in inv  -> auto-select the correct tool (honest, player-like).
 *   - unmatched + missing -> log mismatch + set state.needsTool so the NPC
 *                            fetches/crafts the tool before mining (no more
 *                            bare-handed obsidian / wrong-tool stalls).
 * The held item comes straight from `cap.observe` (`data.held`); the inventory
 * from `data.inventory`. No new RCON commands are introduced — only routing.
 * ============================================================================= */
