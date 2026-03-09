/**
 * Social Intelligence Subsystem - Factory and re-exports
 * Creates and wires all social modules with shared dependencies
 */
import { ReputationCRDT } from './reputation-crdt.js';
import { SNAAnalyzer } from './sna-analyzer.js';
import { EmotionalState } from './emotional-state.js';
import { CulturalFriction } from './cultural-friction.js';
import { TrustDynamics } from './trust-dynamics.js';
import { EILayer } from './ei-layer.js';
import { SelfReflection } from './self-reflection.js';
import { EpisodeLearner } from './episode-learner.js';

export function createSocialSystem(deps) {
  const { field, bus, store, capabilityEngine } = deps;

  const reputation = new ReputationCRDT({ field, bus, store });
  const sna = new SNAAnalyzer({ field, bus });
  const emotion = new EmotionalState({ field, bus });
  const friction = new CulturalFriction({ field });
  const trust = new TrustDynamics({ field, bus, store });
  const ei = new EILayer({ field });
  const reflection = new SelfReflection({ field, bus, store, capabilityEngine, reputationCRDT: reputation });
  const learner = new EpisodeLearner({ field, bus, store });

  const modules = { reputation, sna, emotion, friction, trust, ei, reflection, learner };

  return {
    ...modules,
    allModules() {
      return Object.values(modules);
    },
    async start() {
      for (const mod of Object.values(modules)) {
        if (typeof mod.start === 'function') await mod.start();
      }
    },
    async stop() {
      for (const mod of Object.values(modules)) {
        if (typeof mod.stop === 'function') await mod.stop();
      }
    }
  };
}

export {
  ReputationCRDT,
  SNAAnalyzer,
  EmotionalState,
  CulturalFriction,
  TrustDynamics,
  EILayer,
  SelfReflection,
  EpisodeLearner
};

export default createSocialSystem;
