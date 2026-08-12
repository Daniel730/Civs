/**

* NPC Cooperation — inter-NPC communication channel (brief §11).
*
* Built on top of the existing AgentBus (from hermes-bridge.js, the same bus Hermes
* publishes to — brief §16 makes NPC<->Hermes bidirectional). The cooperation layer adds:
*   - Semantic "share" messages between NPCs (e.g. Steve tells Alex about a cave, a new build,
*     a mob he saw).
*   - On-line subscribe: every NPC that is currently online receives peer messages.
*   - Semantic conflict resolution when two agents share overlapping facts: SPATIAL is accepted
*     first (most objective), then SPECIFIC, then INTERPRETATIVE (subjective — may be ignored).
*
* This is deliberately lightweight and purely additive — it never steers the agent's execution
* (work/job rotation stays in village-worker.js). Messages accumulate in the agent's own memory
* (semantic facts) so the NPC remembers what a peer told it across ticks/restarts.
*
* Phase 6 of the Living AI World audit. No LLM in the tick; Hermes is available as a fallback
* for questions the NPCs can't resolve together (brief §31).
*/

const { AgentBus, makeMessage } = require('./hermes-bridge');

// Resolution order for conflicting shared facts (brief §11 semantics).
const SEMANTIC_RESOLUTION = ['SPATIAL', 'SPECIFIC', 'INTERPRETATIVE'];

/** Extract a coarse semantic intent from a village job/focus event. */
function semanticFor({ who, job, site, focus, observation }) {
  const obs = observation || {};
  const hostiles = obs.hostiles;
  const blockBelow = obs.block_below;
  // Emergency signals (combat/health) take priority over job-based signals — an agent in
  // danger must always be able to broadcast even when it has no current job.
  if ((hostiles || 0) > 0) {
    return {
      intent: 'share',
      content: `combat: ${hostiles} hostile(s) nearby (nearest ${obs.nearest_hostile?.type || 'unknown'} at ${obs.nearest_hostile?.distance || '?'}m)`,
      factKey: `combat:watch`,
      priority: 0.8,
      space: 'indoor',
    };
  }
  if (obs.low_health || (typeof obs.health === 'number' && obs.health < 0.2)) {
    return {
      intent: 'share',
      content: `status: I am low on health (${Math.round((obs.health || 1) * 100)}%)`,
      factKey: `health:${who}`,
      priority: 0.7,
      space: 'indoor',
    };
  }
  if (!job && !focus) return null;
  const x = obs.x,
    y = obs.y,
    z = obs.z;
  const reason = (obs && obs.data && obs.data.reason) || '';

  if (job === 'miner') {
    return {
      intent: 'share',
      content: `mining: I am mining at (${Math.round(x)}/${Math.round(z)}) on ${blockBelow || 'stone'}`,
      factKey: `miner:${Math.round(x)}:${Math.round(z)}`,
      priority: 0.4,
      space: 'closed',
    };
  }
  if (job === 'builder' && site) {
    return {
      intent: 'share',
      content: `building: I am building at ${site} (${Math.round(x)}/${Math.round(z)})`,
      factKey: `build:${site}:${Math.round(x)}:${Math.round(z)}`,
      priority: 0.3,
      space: 'open',
    };
  }
  if (job === 'farmer') {
    return {
      intent: 'share',
      content: `farming: I am farming at (${Math.round(x)}/${Math.round(z)})`,
      factKey: `farm:${Math.round(x)}:${Math.round(z)}`,
      priority: 0.2,
      space: 'open',
    };
  }
  return null;
}

/**
 * Wrap the existing AgentBus with NPC-cooperation semantics: subscribe one peer, publish a
 * share message to all, and resolve semantic conflicts against an agent's own memory.
 */
class AgentCooperation {
  /**
   * @param {object} opts
   * @param {AgentBus} [opts.bus]     existing bus (creates one if omitted)
   * @param {object}  [opts.worldMemory] shared world memory (makeWorldMemory if omitted)
   * @param {function} [opts.now]
   */
  constructor(opts = {}) {
    this.bus = opts.bus || new AgentBus();
    this.worldMemory = opts.worldMemory || require('./hermes-bridge').makeWorldMemory();
    this.now = typeof opts.now === 'function' ? opts.now : () => Date.now();
    this._subs = new Map(); // agentId -> Set<handler>
  }

  /** Let `agentId` receive messages from peers that publish to 'all' or to this agent. */
  subscribe(agentId, handler) {
    if (!this._subs.has(agentId)) this._subs.set(agentId, new Set());
    this._subs.get(agentId).add(handler);
    // Register on 'all' so broadcasts from share() reach this agent.
    this.bus.subscribe('all', handler);
    return () => this.unsubscribe(agentId, handler);
  }

  /** Remove a handler for `agentId`. */
  unsubscribe(agentId, handler) {
    if (!this._subs.has(agentId)) return;
    this._subs.get(agentId).delete(handler);
    this.bus.unsubscribe('all', handler);
  }

  /** Send `from` a share message to all peers (or just `to`). */
  async share(from, to, content, opts = {}) {
    const msg = makeMessage({
      sender: from,
      receiver: to || 'all',
      intent: 'share',
      type: 'SEMANTIC',
      content,
      priority: opts.priority || 0.3,
      context: { factKey: opts.factKey, space: opts.space, at: this.now() },
    });
    // Mirror spatial facts into shared worldMemory (most objective — persisted across peers).
    if (opts.factKey && opts.space === 'SPATIAL') {
      await this.worldMemory.set(opts.factKey, content, { stale: false });
    }
    return this.bus.publish(msg);
  }

  /** Publish a semantic event for `who`'s current situation (derived from the worker loop). */
  async publishSituation(agentId, situation) {
    if (!situation) return null;
    return this.share(agentId, 'all', situation.content, {
      factKey: situation.factKey,
      priority: situation.priority,
      space: situation.space,
    });
  }
}

module.exports = { AgentCooperation, semanticFor, SEMANTIC_RESOLUTION };
