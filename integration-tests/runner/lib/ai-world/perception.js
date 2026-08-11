/**
 * Hierarchical perception — compress capability/rpg observe into LOCAL / REGIONAL / KNOWN.
 * Never dump the whole Minecraft world into an LLM.
 */

/**
 * @param {{ playerObserve?: object, rpgObserve?: object, known?: object }} inputs
 */
function buildObservation(inputs = {}) {
  const p = (inputs.playerObserve && inputs.playerObserve.data) || inputs.playerObserve || {};
  const rpg = (inputs.rpgObserve && inputs.rpgObserve.data) || inputs.rpgObserve || {};
  const known = inputs.known || {};

  const local = {
    health: p.health,
    food: p.food,
    location: p.location || (p.x != null ? { world: p.world, x: p.x, y: p.y, z: p.z } : null),
    inventory: p.inventory || p.items || [],
    sneaking: p.sneaking,
    sprinting: p.sprinting,
    gamemode: p.gamemode,
  };

  const regional = {
    biome: p.biome || known.biome || null,
    time: p.time || known.time || null,
    weather: p.weather || known.weather || null,
    nearbyPlayers: known.nearbyPlayers || [],
    nearbyMobs: known.nearbyMobs || [],
    nearbyResources: known.nearbyResources || [],
  };

  const knownWorld = {
    settlements: known.settlements || [],
    homes: known.homes || [],
    markets: known.markets || [],
    dangers: known.dangers || [],
    roads: known.roads || [],
    pois: known.pois || [],
  };

  const quests = {
    archetype: rpg.archetype || null,
    tracked: rpg.tracked_quest || null,
    active: rpg.active_quests || [],
    completed: rpg.completed_quests || [],
    pathEssence: rpg.path_essence,
  };

  const danger =
    (regional.nearbyMobs && regional.nearbyMobs.length > 0) ||
    (local.health != null && local.health < 8);

  return {
    at: Date.now(),
    local,
    regional,
    knownWorld,
    quests,
    danger: Boolean(danger),
    food: local.food,
    health: local.health,
  };
}

module.exports = {
  buildObservation,
};
