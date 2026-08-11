/**
 * Multi-timescale goals. Circumstances can invalidate / replace current goals.
 */

function createGoal(partial) {
  return {
    id: partial.id || `goal_${Date.now()}`,
    kind: partial.kind || 'medium', // life | long | medium | current
    title: partial.title || '',
    motive: partial.motive || 'purpose',
    priority: partial.priority == null ? 0.5 : partial.priority,
    status: partial.status || 'active', // active | blocked | done | abandoned
    questId: partial.questId || null,
    createdAt: partial.createdAt || Date.now(),
    meta: partial.meta || {},
  };
}

/**
 * @param {object} agent
 * @param {ReturnType<typeof createGoal>} goal
 */
function setCurrentGoal(agent, goal) {
  agent.goals.current = goal;
  agent.state.activity = goal ? `goal:${goal.id}` : 'idle';
  agent.updatedAt = Date.now();
  return goal;
}

function completeCurrentGoal(agent, reason = 'done') {
  const g = agent.goals.current;
  if (!g) return null;
  g.status = reason === 'abandoned' ? 'abandoned' : 'done';
  agent.goals.current = null;
  agent.state.activity = 'idle';
  agent.updatedAt = Date.now();
  return g;
}

/**
 * Reconsider: drop current if circumstances contradict it.
 * @param {object} agent
 * @param {object} observation
 */
function reconsiderGoals(agent, observation) {
  const current = agent.goals.current;
  if (!current) return { changed: false };
  if (observation.danger && current.motive !== 'safety' && current.motive !== 'combat') {
    if ((agent.identity.personality.traits.brave || 0.5) < 0.55) {
      const safety = createGoal({
        kind: 'current',
        title: 'Seek safety',
        motive: 'safety',
        priority: 0.95,
      });
      setCurrentGoal(agent, safety);
      return { changed: true, reason: 'danger', goal: safety };
    }
  }
  if (observation.food != null && observation.food < 6 && current.motive !== 'hunger') {
    const food = createGoal({
      kind: 'current',
      title: 'Find food',
      motive: 'hunger',
      priority: 0.9,
    });
    setCurrentGoal(agent, food);
    return { changed: true, reason: 'hunger', goal: food };
  }
  return { changed: false };
}

module.exports = {
  createGoal,
  setCurrentGoal,
  completeCurrentGoal,
  reconsiderGoals,
};
