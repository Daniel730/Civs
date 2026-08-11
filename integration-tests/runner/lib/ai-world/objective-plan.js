/**
 * Map RPG objectives → high-level capability intents (not tick-level LLM control).
 *
 * BLOCKED notes are returned as intents with kind='blocked' when the world API
 * cannot support the objective yet.
 */

/**
 * @param {{ typeId?: string, type?: string, id?: string, block?: string, mob?: string, amount?: number, poi?: string, region?: string, description?: string }} objective
 * @param {object} [context]
 */
function planObjective(objective, context = {}) {
  const type = objective.typeId || objective.type || '';
  const amount = objective.amount || 1;
  const id = objective.id || type;

  switch (type) {
    case 'mine_block':
    case 'break_block':
      return {
        kind: 'gather_blocks',
        objectiveId: id,
        block: objective.block || 'stone',
        amount,
        steps: [
          { action: 'locate_block', block: objective.block || 'stone' },
          { action: 'move_to', from: 'located' },
          { action: 'break_block', repeat: amount },
          { action: 'observe_progress' },
        ],
        executable: true,
      };

    case 'kill_mob':
      return {
        kind: 'combat_mobs',
        objectiveId: id,
        mob: objective.mob || null,
        amount,
        steps: [
          { action: 'find_mob', mob: objective.mob },
          { action: 'move_to', from: 'mob' },
          { action: 'attack_nearest', entityType: objective.mob, repeat: amount },
          { action: 'observe_progress' },
        ],
        executable: true,
      };

    case 'custom_mob_kill':
      return {
        kind: 'combat_custom',
        objectiveId: id,
        mob: objective.mob,
        amount,
        steps: [
          { action: 'find_custom_mob', mob: objective.mob },
          { action: 'attack_nearest', repeat: amount },
          { action: 'observe_progress' },
        ],
        // Spawn-on-accept may place mobs; locating them still needs observation.
        executable: true,
        caution: 'custom_mob_location_may_require_scan',
      };

    case 'discover_poi':
    case 'visit_poi':
    case 'visit_region': {
      const key = objective.poi || objective.region;
      const known = context.knownPois && context.knownPois[key];
      if (!known) {
        return {
          kind: 'blocked',
          objectiveId: id,
          executable: false,
          reason: 'BLOCKED: POI/region coordinates not exposed to agents',
          requiredIntegration:
            'Expose POI locations via RpgBridge or a Civs/RPG observe adapter (id → world xyz).',
          steps: [],
        };
      }
      return {
        kind: 'travel',
        objectiveId: id,
        target: known,
        steps: [
          { action: 'move_to', x: known.x, y: known.y, z: known.z },
          { action: 'observe_progress' },
        ],
        executable: true,
      };
    }

    case 'skill_level':
    case 'civs_skill_xp':
      return {
        kind: 'blocked',
        objectiveId: id,
        executable: false,
        reason: 'BLOCKED: skill XP objectives need profession activity loops not yet wired',
        requiredIntegration:
          'Map skill objectives to gather/build/combat loops with progress observe.',
        steps: [],
      };

    default:
      return {
        kind: 'blocked',
        objectiveId: id,
        executable: false,
        reason: `BLOCKED: unsupported objective type ${type || 'unknown'}`,
        requiredIntegration:
          'Add objective→capability mapping in objective-plan.js after probing RPG types.',
        steps: [],
      };
  }
}

/**
 * Plan all objectives for a quest detail payload.
 * @param {{ objectives?: object[] }} questDetail
 * @param {object} [context]
 */
function planQuest(questDetail, context = {}) {
  const objectives = questDetail.objectives || [];
  const plans = objectives.map((o) => planObjective(o, context));
  const executable = plans.filter((p) => p.executable);
  const blocked = plans.filter((p) => !p.executable);
  return {
    questId: questDetail.id,
    plans,
    executableCount: executable.length,
    blockedCount: blocked.length,
    canStart: executable.length > 0 && blocked.length === 0,
    partial: executable.length > 0 && blocked.length > 0,
  };
}

module.exports = {
  planObjective,
  planQuest,
};
