/**
 * Deterministic physical mine loop using existing capabilities only.
 * Authoritative progress comes from rpg quest_detail — never from break_block alone.
 */

const { tryRetry, resetRetry, notePosition, allowAction, isTimedOut } = require('./anti-stupid');
const { EVENT, emitAgentEvent } = require('./events');

/**
 * @param {object} agent
 * @param {{
 *   findBlock: (material: string, radius?: number) => Promise<object>,
 *   moveTo: (x: number, y: number, z: number) => Promise<object>,
 *   breakBlock: (x: number, y: number, z: number) => Promise<object>,
 *   questDetail: (questId: string) => Promise<object>,
 *   observePlayer?: () => Promise<object>,
 *   giveItem?: (material: string, amount?: number) => Promise<object>,
 *   placeBlock?: (x: number, y: number, z: number, material: string) => Promise<object>,
 *   setblock?: (x: number, y: number, z: number, material: string) => Promise<object>,
 *   eventSink?: *,
 * }} ports
 * @param {{
 *   questId: string,
 *   objectiveId: string,
 *   block: string,
 *   amount: number,
 *   searchRadius?: number,
 *   maxBreaks?: number,
 *   timeoutMs?: number,
 *   seedBlocks?: boolean,
 * }} spec
 */
async function executeMineObjective(agent, ports, spec) {
  const startedAt = Date.now();
  const timeoutMs = spec.timeoutMs || 120_000;
  const searchRadius = spec.searchRadius || 8;
  const maxBreaks = spec.maxBreaks || Math.max(spec.amount * 3, 20);
  const material = String(spec.block || 'stone').toUpperCase();
  let breaks = 0;
  let lastProgress = -1;
  const history = [];

  const readProgress = async () => {
    const detail = await ports.questDetail(spec.questId);
    if (!detail || detail.success === false) {
      return { ok: false, reason: (detail && detail.reason) || 'quest_detail_failed', detail };
    }
    const data = detail.data || detail;
    const objectives = data.objectives || [];
    const obj = objectives.find((o) => o.id === spec.objectiveId) || objectives[0];
    const progress = obj ? Number(obj.progress || 0) : 0;
    const amount = obj ? Number(obj.amount || spec.amount) : spec.amount;
    const complete = obj ? obj.complete === true : false;
    const questComplete =
      data.status === 'COMPLETED' ||
      (Array.isArray(data.completed_quests) && data.completed_quests.includes(spec.questId));
    // Also treat progress_completed/progress_total if present
    const progressCompleted = Number(data.progress_completed || 0);
    const progressTotal = Number(data.progress_total || 0);
    return {
      ok: true,
      progress,
      amount,
      complete,
      questComplete: questComplete || (progressTotal > 0 && progressCompleted >= progressTotal),
      status: data.status,
      detail: data,
    };
  };

  let prog = await readProgress();
  if (!prog.ok) {
    return { success: false, reason: prog.reason, history };
  }
  lastProgress = prog.progress;
  emitAgentEvent(ports.eventSink, EVENT.QUEST_PROGRESS, {
    agentId: agent.identity.id,
    questId: spec.questId,
    progress: prog.progress,
    amount: prog.amount,
  });

  if (prog.complete || prog.progress >= prog.amount) {
    return {
      success: true,
      reason: 'already_complete',
      progress: prog.progress,
      amount: prog.amount,
      history,
    };
  }

  while (!isTimedOut(startedAt, timeoutMs) && breaks < maxBreaks) {
    prog = await readProgress();
    if (!prog.ok) {
      return { success: false, reason: prog.reason, history, replan: true };
    }
    if (prog.complete || prog.progress >= prog.amount) {
      return {
        success: true,
        reason: 'objective_complete',
        progress: prog.progress,
        amount: prog.amount,
        questComplete: prog.questComplete,
        history,
      };
    }

    // No progress after a successful break → something wrong with RPG wiring
    if (lastProgress >= 0 && prog.progress === lastProgress && breaks > 0) {
      const stallKey = `mine_stall:${spec.questId}`;
      const retry = tryRetry(agent.guard, stallKey);
      if (!retry.ok) {
        return {
          success: false,
          reason: 'progress_stalled',
          progress: prog.progress,
          amount: prog.amount,
          history,
          replan: true,
        };
      }
    } else if (prog.progress > lastProgress) {
      resetRetry(agent.guard, `mine_stall:${spec.questId}`);
      resetRetry(agent.guard, `find_block:${material}`);
      lastProgress = prog.progress;
      emitAgentEvent(ports.eventSink, EVENT.QUEST_PROGRESS, {
        agentId: agent.identity.id,
        questId: spec.questId,
        progress: prog.progress,
        amount: prog.amount,
      });
    }

    let found = await ports.findBlock(material, searchRadius);
    if (!found || found.success !== true) {
      if (spec.seedBlocks && typeof ports.setblock === 'function' && ports.observePlayer) {
        const obs = await ports.observePlayer();
        const d = (obs && obs.data) || obs || {};
        const x = Math.floor(d.x || 0) + 2;
        const y = Math.floor(d.y || 64);
        const z = Math.floor(d.z || 0);
        await ports.setblock(x, y, z, material);
        found = await ports.findBlock(material, searchRadius);
      }
      if (!found || found.success !== true) {
        const retry = tryRetry(agent.guard, `find_block:${material}`);
        history.push({ action: 'find_block', success: false, reason: found && found.reason });
        if (!retry.ok) {
          return {
            success: false,
            reason: 'target_unavailable',
            progress: prog.progress,
            amount: prog.amount,
            history,
            replan: true,
          };
        }
        continue;
      }
    }

    const nearest = found.data && found.data.nearest;
    if (!nearest) {
      return { success: false, reason: 'find_block_malformed', history, replan: true };
    }

    const standY = nearest.y;
    const move = await ports.moveTo(nearest.x + 0.5, standY, nearest.z + 0.5);
    history.push({
      action: 'move_to',
      success: move && move.success,
      reason: move && move.reason,
      target: nearest,
    });
    if (ports.observePlayer) {
      const obs = await ports.observePlayer();
      const loc = (obs && obs.data) || {};
      if (loc.x != null) notePosition(agent.guard, { x: loc.x, y: loc.y, z: loc.z });
    }
    if (!move || move.success !== true) {
      const reason = (move && move.reason) || 'move_failed';
      const retry = tryRetry(agent.guard, `move:${nearest.x},${nearest.y},${nearest.z}`);
      if (!retry.ok || reason === 'stuck' || reason === 'no_progress') {
        return {
          success: false,
          reason: `path_blocked:${reason}`,
          progress: prog.progress,
          history,
          replan: true,
        };
      }
      continue;
    }

    const actKey = `break:${nearest.x},${nearest.y},${nearest.z}`;
    const allowed = allowAction(agent.guard, actKey);
    if (!allowed.ok) {
      continue;
    }

    // Prefer a pickaxe in hotbar if giveItem available once
    if (typeof ports.giveItem === 'function' && breaks === 0) {
      await ports.giveItem('STONE_PICKAXE', 1);
    }

    emitAgentEvent(ports.eventSink, EVENT.ACTION, {
      agentId: agent.identity.id,
      questId: spec.questId,
      step: 'break_block',
      x: nearest.x,
      y: nearest.y,
      z: nearest.z,
    });
    const broke = await ports.breakBlock(nearest.x, nearest.y, nearest.z);
    breaks += 1;
    history.push({
      action: 'break_block',
      success: broke && broke.success,
      reason: broke && broke.reason,
      target: nearest,
    });
    if (!broke || broke.success !== true) {
      const reason = (broke && broke.reason) || 'break_failed';
      if (reason === 'inventory_full' || reason.includes('inventory')) {
        return { success: false, reason: 'inventory_full', history, replan: true };
      }
      const retry = tryRetry(agent.guard, actKey);
      if (!retry.ok) {
        return { success: false, reason: `break_failed:${reason}`, history, replan: true };
      }
    } else {
      resetRetry(agent.guard, actKey);
      // Allow re-mining nearby tiles immediately after a successful dig.
      delete agent.guard.cooldowns[actKey];
    }
  }

  prog = await readProgress();
  if (prog.ok && (prog.complete || prog.progress >= prog.amount)) {
    return {
      success: true,
      reason: 'objective_complete',
      progress: prog.progress,
      amount: prog.amount,
      questComplete: prog.questComplete,
      history,
    };
  }
  return {
    success: false,
    reason: isTimedOut(startedAt, timeoutMs) ? 'action_timeout' : 'max_breaks',
    progress: prog.ok ? prog.progress : lastProgress,
    amount: spec.amount,
    history,
    replan: true,
  };
}

module.exports = {
  executeMineObjective,
};
