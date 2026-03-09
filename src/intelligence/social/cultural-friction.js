/**
 * CulturalFriction - Measures stylistic distance between LLM providers
 * Uses 5D provider profiles to compute collaboration friction
 */
import ModuleBase from '../../core/module-base.js';
import { DIM_REPUTATION, DIM_TRUST } from '../../core/field/types.js';

const PROFILES = {
  anthropic: {
    verbosity: 0.7,
    structuredness: 0.9,
    riskTolerance: 0.3,
    creativity: 0.6,
    followInstructions: 0.95
  },
  openai: {
    verbosity: 0.6,
    structuredness: 0.7,
    riskTolerance: 0.5,
    creativity: 0.8,
    followInstructions: 0.8
  },
  google: {
    verbosity: 0.8,
    structuredness: 0.6,
    riskTolerance: 0.4,
    creativity: 0.7,
    followInstructions: 0.75
  }
};

const DIMENSIONS = ['verbosity', 'structuredness', 'riskTolerance', 'creativity', 'followInstructions'];
const MAX_DISTANCE = Math.sqrt(DIMENSIONS.length); // sqrt(5) for normalization

class CulturalFriction extends ModuleBase {
  constructor({ field }) {
    super({ field });
    this._profiles = new Map(Object.entries(PROFILES));
  }

  static produces() { return []; }
  static consumes() { return [DIM_REPUTATION, DIM_TRUST]; }
  static publishes() { return ['friction.calculated']; }
  static subscribes() { return []; }

  computeFriction(providerA, providerB) {
    const profileA = this._profiles.get(providerA);
    const profileB = this._profiles.get(providerB);
    if (!profileA || !profileB) {
      return { distance: 0, normalized: 0, strategy: 'LIGHT_TOUCH', dominantDimension: null };
    }

    let sumSq = 0;
    let maxDiff = 0;
    let dominantDimension = null;

    for (const dim of DIMENSIONS) {
      const diff = Math.abs(profileA[dim] - profileB[dim]);
      sumSq += diff * diff;
      if (diff > maxDiff) {
        maxDiff = diff;
        dominantDimension = dim;
      }
    }

    const distance = Math.sqrt(sumSq);
    const normalized = distance / MAX_DISTANCE;

    let strategy;
    if (normalized < 0.2) {
      strategy = 'LIGHT_TOUCH';
    } else if (normalized < 0.5) {
      strategy = 'MODERATE';
    } else {
      strategy = 'DEEP';
    }

    return { distance, normalized, strategy, dominantDimension, providerA, providerB };
  }

  getProfile(provider) {
    return this._profiles.get(provider) || null;
  }

  registerProfile(provider, profile) {
    this._profiles.set(provider, { ...profile });
  }
}

export { CulturalFriction };
export default CulturalFriction;
