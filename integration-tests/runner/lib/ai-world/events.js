/**
 * Structured world events for observability + future Cinematic Director.
 * Agents must NOT be camera-aware — Director observes these events.
 */

const { withSpan, setSpanAttrs, recordResultStatus } = require('../telemetry');

/**
 * @param {string} type
 * @param {object} payload
 */
function createWorldEvent(type, payload = {}) {
  return {
    type,
    at: Date.now(),
    ...payload,
  };
}

function emitAgentEvent(sink, type, payload) {
  const ev = createWorldEvent(type, payload);
  if (typeof sink === 'function') sink(ev);
  else if (sink && Array.isArray(sink)) sink.push(ev);
  else if (sink && typeof sink.write === 'function') {
    sink.write(`${JSON.stringify(ev)}\n`);
  }
  // OTel boundary spans (not per-tick)
  const spanName = type.startsWith('ai.') ? type : `ai.${type}`;
  try {
    withSpan(spanName, { 'ai.event': type, 'ai.agent_id': payload && payload.agentId }, (span) => {
      setSpanAttrs(span, {
        'ai.quest_id': payload && payload.questId,
        'ai.reason': payload && payload.reason,
      });
      recordResultStatus(span, payload && payload.success === false ? 'FAIL' : 'OBSERVED');
      return ev;
    });
  } catch {
    // telemetry must never break agents
  }
  return ev;
}

/** Well-known event types for Director + OTel. */
const EVENT = Object.freeze({
  OBSERVE: 'ai.npc.observe',
  GOAL_SELECT: 'ai.npc.goal.select',
  PLAN: 'ai.npc.plan',
  ACTION: 'ai.npc.action',
  QUEST: 'ai.npc.quest',
  QUEST_EVALUATE: 'ai.npc.quest.evaluate',
  QUEST_ACCEPT: 'ai.npc.quest.accept',
  QUEST_PROGRESS: 'ai.npc.quest.progress',
  QUEST_COMPLETE: "ai.npc.quest.complete",
  QUEST_COMPLETE_SNAKE: "quest_complete",
  QUEST_FAIL: 'ai.npc.quest.fail',
  REPLAN: 'ai.npc.replan',
  SOCIAL: 'ai.npc.social',
  CONSTRUCTION: 'ai.npc.construction.plan',
  MEMORY: 'ai.npc.memory.update',
});

module.exports = {
  EVENT,
  createWorldEvent,
  emitAgentEvent,
};
