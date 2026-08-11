/**
 * Build hierarchical known-world perception from harness world + RPG POI observes.
 */

const { rememberFact } = require('./memory');

/**
 * @param {object} agent
 * @param {{ worldNearby?: object, rpgPois?: object }} raw
 */
function ingestWorldPerception(agent, raw = {}) {
  const world = (raw.worldNearby && raw.worldNearby.data) || raw.worldNearby || {};
  const poisPayload = (raw.rpgPois && raw.rpgPois.data) || raw.rpgPois || {};
  const pois = poisPayload.pois || [];

  const known = {
    biome: world.biome || null,
    time: world.time,
    weather: world.storm ? 'storm' : 'clear',
    nearbyPlayers: world.players || [],
    nearbyMobs: (world.entities || []).filter((e) => e.type && !/ITEM|EXPERIENCE/i.test(e.type)),
    nearbyResources: [],
    settlements: world.town ? [{ name: world.town }] : [],
    homes: [],
    markets: [],
    dangers: [],
    roads: [],
    pois: [],
    regions: world.regions || [],
  };

  for (const poi of pois) {
    known.pois.push(poi);
    if (poi.id) {
      rememberFact(
        agent.memory,
        `poi:${poi.id}`,
        { x: poi.x, y: poi.y, z: poi.z, world: poi.world, name: poi.name, radius: poi.radius },
        0.8
      );
    }
  }

  for (const region of known.regions) {
    if (region.type && /market|shop/i.test(region.type)) {
      known.markets.push(region);
    }
  }

  return known;
}

module.exports = {
  ingestWorldPerception,
};
