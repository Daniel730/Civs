/**
 * Vertical slice state machine with physical execution + event-driven replan.
 *
 * Authoritative quest state = RpgBridge (QuestManager), never performCommand alone.
 */

const { buildObservation } = require('./perception');
const { decide } = require('./decision');
const { evaluateQuest } = require('./quest-eval');
const { planQuest } = require('./objective-plan');
const { rememberEpisode, setWorking, clearWorking } = require('./memory');
const { completeCurrentGoal } = require('./goals');
const { tryRetry, resetRetry, notePosition, isTimedOut, invalidatePlan } = require('./anti-stupid');
const { EVENT, emitAgentEvent } = require('./events');
const { executeMineObjective } = require('./mine-executor');
const { ingestWorldPerception } = require('./world-adapter');

const PHASE = Object.freeze({
  IDLE: 'idle',
  OBSERVE: 'observe',
  DECIDE: 'decide',
  EVALUATE: 'evaluate',
  ACCEPT: 'accept',
  PLAN: 'plan',
  ACT: 'act',
  PROGRESS: 'progress',
  COMPLETE: 'complete',
  REMEMBER: 'remember',
  REPLAN: 'replan',
  FAIL: 'fail',
});

/**
 * @param {object} agent
 * @param {object} ports
 */
function createQuestLoop(agent, ports) {
  const session = {
    phase: PHASE.IDLE,
    questId: null,
    questDetail: null,
    evaluation: null,
    plan: null,
    startedAt: null,
    lastObservation: null,
    lastError: null,
    replanCount: 0,
    moneyBefore: null,
    progressLog: [],
  };

  async function tick() {
    try {
      switch (session.phase) {
        case PHASE.IDLE:
        case PHASE.OBSERVE:
          return observe();
        case PHASE.DECIDE:
          return doDecide();
        case PHASE.EVALUATE:
          return evaluate();
        case PHASE.ACCEPT:
          return accept();
        case PHASE.PLAN:
          return plan();
        case PHASE.ACT:
          return act();
        case PHASE.PROGRESS:
          return progress();
        case PHASE.COMPLETE:
          return complete();
        case PHASE.REMEMBER:
          return remember();
        case PHASE.REPLAN:
          return replan();
        case PHASE.FAIL:
          return failCleanup();
        default:
          session.phase = PHASE.IDLE;
          return { phase: session.phase };
      }
    } catch (e) {
      session.lastError = e.message || String(e);
      session.phase = PHASE.FAIL;
      return { phase: PHASE.FAIL, error: session.lastError };
    }
  }

  async function observe() {
    session.phase = PHASE.OBSERVE;
    emitAgentEvent(ports.eventSink, EVENT.OBSERVE, { agentId: agent.identity.id });
    const playerObserve = await ports.observePlayer();
    const rpgObserve = await ports.observeRpg();
    let known = ports.known || {};
    if (typeof ports.observeWorld === 'function' || typeof ports.observePois === 'function') {
      const worldNearby =
        typeof ports.observeWorld === 'function' ? await ports.observeWorld() : null;
      const rpgPois = typeof ports.observePois === 'function' ? await ports.observePois() : null;
      known = {
        ...known,
        ...ingestWorldPerception(agent, { worldNearby, rpgPois }),
      };
    }
    const observation = buildObservation({ playerObserve, rpgObserve, known });
    session.lastObservation = observation;
    agent.state.location = observation.local.location;
    agent.state.health = observation.health;
    agent.state.food = observation.food;
    if (observation.local.location) {
      notePosition(agent.guard, observation.local.location);
    }
    if (observation.danger && session.questId) {
      session.lastError = 'danger_detected';
      session.phase = PHASE.REPLAN;
      return { phase: session.phase, observation };
    }
    setWorking(agent.memory, { observationAt: observation.at });
    session.phase = session.questId && agent.state.activeQuestId ? PHASE.PROGRESS : PHASE.DECIDE;
    return { phase: session.phase, observation };
  }

  async function doDecide() {
    let candidates = [];
    if (typeof ports.listQuestCandidates === 'function') {
      candidates = (await ports.listQuestCandidates()) || [];
    } else if (typeof ports.nextQuest === 'function') {
      const n = await ports.nextQuest();
      if (n) candidates = [n];
    }
    const active = (session.lastObservation.quests && session.lastObservation.quests.active) || [];
    if (agent.state.activeQuestId && active.includes(agent.state.activeQuestId)) {
      session.questId = agent.state.activeQuestId;
      session.phase = PHASE.PLAN;
      return { phase: session.phase, questId: session.questId, reused: true };
    }

    emitAgentEvent(ports.eventSink, EVENT.GOAL_SELECT, { agentId: agent.identity.id });
    const decision = decide(agent, session.lastObservation, { questCandidates: candidates });
    emitAgentEvent(ports.eventSink, EVENT.PLAN, {
      agentId: agent.identity.id,
      intent: decision.intent,
      model: decision.model,
      reason: decision.reason,
    });

    if (decision.intent === 'pursue_quest' && decision.quest) {
      session.questId = decision.quest.id;
      session.evaluation = decision.evaluation;
      session.phase = PHASE.EVALUATE;
      return { phase: session.phase, decision };
    }

    rememberEpisode(agent.memory, {
      type: 'decision',
      summary: `Chose ${decision.intent}`,
      importance: 0.3,
      tags: [decision.intent],
    });
    session.phase = PHASE.IDLE;
    return { phase: session.phase, decision };
  }

  async function evaluate() {
    let detail = { id: session.questId };
    if (typeof ports.questDetail === 'function') {
      const r = await ports.questDetail(session.questId);
      detail = (r && r.data) || r || detail;
      if (r && r.success === false) {
        session.lastError = r.reason || 'quest_detail_failed';
        session.phase = PHASE.FAIL;
        return { phase: session.phase, error: session.lastError };
      }
    }
    session.questDetail = detail;
    const evaluation = evaluateQuest(agent, detail);
    session.evaluation = evaluation;
    emitAgentEvent(ports.eventSink, EVENT.QUEST_EVALUATE, {
      agentId: agent.identity.id,
      questId: session.questId,
      score: evaluation.score,
      accept: evaluation.accept,
      reasons: evaluation.reasons,
    });
    if (!evaluation.accept) {
      rememberEpisode(agent.memory, {
        type: 'quest_rejected',
        summary: `Rejected ${session.questId} score=${evaluation.score}`,
        importance: 0.4,
        tags: [session.questId],
      });
      session.phase = PHASE.IDLE;
      return { phase: session.phase, evaluation };
    }
    session.phase = PHASE.ACCEPT;
    return { phase: session.phase, evaluation, detail };
  }

  async function accept() {
    const active = (session.lastObservation.quests && session.lastObservation.quests.active) || [];
    if (active.includes(session.questId)) {
      agent.state.activeQuestId = session.questId;
      session.phase = PHASE.PLAN;
      return { phase: session.phase, alreadyActive: true };
    }
    if (typeof ports.getMoney === 'function') {
      session.moneyBefore = await ports.getMoney();
    }
    const r = await ports.acceptQuest(session.questId);
    // Domain success only — never trust transport/performCommand alone
    if (!r || r.success !== true) {
      session.lastError = (r && r.reason) || 'accept_failed';
      rememberEpisode(agent.memory, {
        type: 'quest_failed',
        summary: `Accept failed ${session.questId}: ${session.lastError}`,
        importance: 0.6,
        tags: [session.questId, 'failure'],
      });
      session.phase = PHASE.FAIL;
      return { phase: session.phase, result: r };
    }
    const verify = await ports.observeRpg();
    const activeAfter = (verify.data && verify.data.active_quests) || [];
    if (!activeAfter.includes(session.questId)) {
      session.lastError = `accept_not_reflected:${(r.data && r.data.result) || r.reason || 'unknown'}`;
      session.phase = PHASE.FAIL;
      return { phase: session.phase, result: r, verify };
    }
    agent.state.activeQuestId = session.questId;
    emitAgentEvent(ports.eventSink, EVENT.QUEST_ACCEPT, {
      agentId: agent.identity.id,
      questId: session.questId,
      result: r.data && r.data.result,
    });
    session.phase = PHASE.PLAN;
    return { phase: session.phase, result: r };
  }

  async function plan() {
    let detail = session.questDetail;
    if (!detail && typeof ports.questDetail === 'function') {
      const r = await ports.questDetail(session.questId);
      detail = (r && r.data) || r;
      session.questDetail = detail;
    }
    const knownPois = {};
    for (const [k, v] of Object.entries(agent.memory.semantic || {})) {
      if (k.startsWith('poi:') && v.value) knownPois[k.slice(4)] = v.value;
    }
    const plan = planQuest(detail || { id: session.questId, objectives: [] }, { knownPois });
    session.plan = plan;
    session.startedAt = Date.now();
    agent.state.currentPlan = plan;
    emitAgentEvent(ports.eventSink, EVENT.PLAN, {
      agentId: agent.identity.id,
      questId: session.questId,
      canStart: plan.canStart,
      blockedCount: plan.blockedCount,
      executableCount: plan.executableCount,
    });

    if (plan.executableCount === 0) {
      session.lastError =
        plan.plans
          .map((p) => p.reason)
          .filter(Boolean)
          .join('; ') || 'plan_blocked';
      session.phase = PHASE.FAIL;
      return { phase: session.phase, plan };
    }
    session.phase = PHASE.ACT;
    return { phase: session.phase, plan };
  }

  async function act() {
    if (session.startedAt && isTimedOut(session.startedAt, ports.actionTimeoutMs || 180_000)) {
      session.lastError = 'action_timeout';
      session.phase = PHASE.REPLAN;
      return { phase: session.phase, error: session.lastError };
    }

    const gather = (session.plan.plans || []).find(
      (p) => p.executable && (p.kind === 'gather_blocks' || p.kind === 'gather')
    );
    if (gather && typeof ports.findBlock === 'function') {
      const obj = (session.questDetail && session.questDetail.objectives) || [];
      const mineObj = obj.find((o) => o.id === gather.objectiveId) || obj[0] || {};
      const result = await executeMineObjective(agent, ports, {
        questId: session.questId,
        objectiveId: gather.objectiveId || mineObj.id,
        block: gather.block || mineObj.block || 'stone',
        amount: gather.amount || mineObj.amount || 10,
        seedBlocks: ports.seedBlocks === true,
        searchRadius: ports.searchRadius || 8,
        timeoutMs: ports.mineTimeoutMs || 120_000,
      });
      session.progressLog.push(result);
      if (result.success) {
        session.phase = PHASE.PROGRESS;
        return { phase: session.phase, result };
      }
      session.lastError = result.reason || 'mine_failed';
      session.phase = result.replan ? PHASE.REPLAN : PHASE.FAIL;
      return { phase: session.phase, result };
    }

    // Generic step executor fallback
    if (!ports.executeStep) {
      session.phase = PHASE.PROGRESS;
      return { phase: session.phase, skipped: true };
    }
    const flatSteps = [];
    for (const p of session.plan.plans) {
      if (!p.executable) continue;
      for (const s of p.steps) flatSteps.push({ ...s, objectiveId: p.objectiveId });
    }
    for (const step of flatSteps) {
      const result = await ports.executeStep(step, {
        agent,
        questId: session.questId,
        observation: session.lastObservation,
      });
      emitAgentEvent(ports.eventSink, EVENT.ACTION, {
        agentId: agent.identity.id,
        questId: session.questId,
        step: step.action,
        success: result && result.success,
        reason: result && result.reason,
      });
      if (!result || result.success !== true) {
        session.lastError = (result && result.reason) || 'step_failed';
        session.phase = PHASE.REPLAN;
        return { phase: session.phase, result };
      }
    }
    session.phase = PHASE.PROGRESS;
    return { phase: session.phase };
  }

  async function progress() {
    const detailR =
      typeof ports.questDetail === 'function' ? await ports.questDetail(session.questId) : null;
    const detail = (detailR && detailR.data) || session.questDetail || {};
    const rpg = await ports.observeRpg();
    const data = (rpg && rpg.data) || {};
    const completed = data.completed_quests || [];
    const active = data.active_quests || [];
    const objectives = detail.objectives || [];
    const allObjComplete =
      objectives.length > 0 &&
      objectives.every((o) => o.complete === true || o.progress >= o.amount);
    const progressCompleted = Number(detail.progress_completed || 0);
    const progressTotal = Number(detail.progress_total || 0);

    emitAgentEvent(ports.eventSink, EVENT.QUEST_PROGRESS, {
      agentId: agent.identity.id,
      questId: session.questId,
      active: active.includes(session.questId),
      completed: completed.includes(session.questId),
      progress_completed: progressCompleted,
      progress_total: progressTotal,
      objectives,
    });

    if (
      completed.includes(session.questId) ||
      detail.status === 'COMPLETED' ||
      (progressTotal > 0 && progressCompleted >= progressTotal) ||
      allObjComplete
    ) {
      session.phase = PHASE.COMPLETE;
      return { phase: session.phase, detail, rpg: data };
    }
    if (!active.includes(session.questId) && agent.state.activeQuestId === session.questId) {
      session.lastError = 'quest_no_longer_active';
      session.phase = PHASE.FAIL;
      return { phase: session.phase };
    }
    // Still in progress
    session.phase = PHASE.ACT;
    return { phase: session.phase, inProgress: true, detail };
  }

  async function replan() {
    session.replanCount += 1;
    emitAgentEvent(ports.eventSink, EVENT.REPLAN, {
      agentId: agent.identity.id,
      questId: session.questId,
      error: session.lastError,
      replanCount: session.replanCount,
    });
    invalidatePlan(agent.guard, session.questId || 'plan');
    const retry = tryRetry(agent.guard, `replan:${session.questId}`);
    if (!retry.ok || session.replanCount > 5) {
      session.phase = PHASE.FAIL;
      return { phase: session.phase, error: session.lastError || 'replan_exhausted' };
    }
    rememberEpisode(agent.memory, {
      type: 'replan',
      summary: `Replan ${session.questId}: ${session.lastError}`,
      importance: 0.55,
      tags: [session.questId || 'unknown', 'failure'],
    });
    session.lastError = null;
    session.phase = PHASE.PLAN;
    return { phase: session.phase, replanCount: session.replanCount };
  }

  async function complete() {
    let rewardApplied = null;
    if (typeof ports.getMoney === 'function' && session.moneyBefore != null) {
      const after = await ports.getMoney();
      rewardApplied = {
        moneyBefore: session.moneyBefore,
        moneyAfter: after,
        delta: after - session.moneyBefore,
      };
    }
    // Final authoritative check
    const rpg = await ports.observeRpg();
    const completed = (rpg.data && rpg.data.completed_quests) || [];
    const verified = completed.includes(session.questId);
    emitAgentEvent(ports.eventSink, EVENT.QUEST_COMPLETE, {
      agentId: agent.identity.id,
      questId: session.questId,
      verified,
      rewardApplied,
    });
    if (!verified) {
      // Objectives done but quest not marked complete yet — still record; may need tick
      rememberEpisode(agent.memory, {
        type: 'quest_objectives_done',
        summary: `Objectives done for ${session.questId}; completed_quests verified=${verified}`,
        importance: 0.75,
        tags: [session.questId],
      });
    }
    agent.state.activeQuestId = null;
    completeCurrentGoal(agent, 'done');
    session.phase = PHASE.REMEMBER;
    return { phase: session.phase, verified, rewardApplied };
  }

  async function remember() {
    rememberEpisode(agent.memory, {
      type: 'quest_complete',
      summary: `Completed quest ${session.questId}`,
      importance: 0.85,
      tags: [session.questId, 'success'],
    });
    clearWorking(agent.memory);
    emitAgentEvent(ports.eventSink, EVENT.MEMORY, {
      agentId: agent.identity.id,
      questId: session.questId,
      kind: 'quest_complete',
    });
    if (typeof ports.persist === 'function') {
      await ports.persist(agent);
    }
    session.phase = PHASE.IDLE;
    const doneId = session.questId;
    session.questId = null;
    session.questDetail = null;
    session.plan = null;
    session.replanCount = 0;
    return { phase: session.phase, remembered: true, questId: doneId };
  }

  async function failCleanup() {
    emitAgentEvent(ports.eventSink, EVENT.QUEST_FAIL, {
      agentId: agent.identity.id,
      questId: session.questId,
      error: session.lastError,
    });
    rememberEpisode(agent.memory, {
      type: 'quest_failed',
      summary: `Failed quest ${session.questId}: ${session.lastError}`,
      importance: 0.7,
      tags: [session.questId || 'unknown', 'failure'],
    });
    completeCurrentGoal(agent, 'abandoned');
    clearWorking(agent.memory);
    if (typeof ports.persist === 'function') {
      await ports.persist(agent);
    }
    session.phase = PHASE.IDLE;
    const err = session.lastError;
    session.lastError = null;
    session.questId = null;
    session.plan = null;
    return { phase: session.phase, failed: true, error: err };
  }

  return { PHASE, session, tick };
}

module.exports = {
  PHASE,
  createQuestLoop,
};
