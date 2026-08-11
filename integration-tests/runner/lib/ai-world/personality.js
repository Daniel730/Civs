/**
 * Personality + profession modifiers for goal/quest scoring.
 * Traits must influence scores — cosmetic fields are forbidden.
 */

const PROFESSIONS = Object.freeze({
  builder: {
    construction: 1.4,
    gathering: 1.2,
    money: 0.9,
    exploration: 0.7,
    combat: 0.6,
    social: 0.8,
  },
  merchant: {
    money: 1.5,
    trading: 1.5,
    social: 1.2,
    construction: 0.7,
    combat: 0.5,
    exploration: 0.8,
  },
  farmer: {
    gathering: 1.3,
    construction: 0.9,
    money: 1.0,
    combat: 0.5,
    exploration: 0.6,
    social: 1.0,
  },
  explorer: {
    exploration: 1.6,
    discovery: 1.5,
    combat: 0.9,
    money: 0.8,
    construction: 0.6,
    social: 0.7,
  },
  guard: { safety: 1.6, combat: 1.4, exploration: 0.6, money: 0.7, construction: 0.7, social: 0.9 },
  adventurer: { combat: 1.4, exploration: 1.3, money: 1.1, construction: 0.5, social: 0.8 },
  scholar: { discovery: 1.4, exploration: 1.1, safety: 1.2, combat: 0.4, money: 0.7, social: 0.9 },
  social: { social: 1.6, money: 0.9, construction: 0.7, combat: 0.5, exploration: 0.9 },
});

const TRAIT_DEFAULTS = Object.freeze({
  brave: 0.5,
  greedy: 0.5,
  curious: 0.5,
  social: 0.5,
  builder: 0.5,
  cautious: 0.5,
});

/**
 * @param {string} occupation
 * @param {Partial<typeof TRAIT_DEFAULTS>} [traits]
 */
function createPersonality(occupation = 'explorer', traits = {}) {
  const prof = PROFESSIONS[occupation] || PROFESSIONS.explorer;
  return {
    occupation,
    traits: { ...TRAIT_DEFAULTS, ...traits },
    weights: { ...prof },
  };
}

/**
 * Multiply a base score by personality for a motive key.
 * @param {{ traits: Record<string, number>, weights: Record<string, number> }} personality
 * @param {string} motive  e.g. money, combat, exploration, construction, safety, social
 * @param {number} base
 */
function applyPersonality(personality, motive, base) {
  const w = (personality.weights && personality.weights[motive]) || 1;
  let t = 1;
  const traits = personality.traits || {};
  if (motive === 'combat' || motive === 'exploration') {
    t *= 0.6 + (traits.brave || 0.5);
    t *= 1.4 - (traits.cautious || 0.5) * 0.6;
  }
  if (motive === 'money' || motive === 'trading') {
    t *= 0.6 + (traits.greedy || 0.5);
  }
  if (motive === 'exploration' || motive === 'discovery') {
    t *= 0.6 + (traits.curious || 0.5);
  }
  if (motive === 'social') {
    t *= 0.6 + (traits.social || 0.5);
  }
  if (motive === 'construction') {
    t *= 0.6 + (traits.builder || 0.5);
  }
  if (motive === 'safety') {
    t *= 0.6 + (traits.cautious || 0.5);
  }
  return base * w * t;
}

module.exports = {
  PROFESSIONS,
  TRAIT_DEFAULTS,
  createPersonality,
  applyPersonality,
};
