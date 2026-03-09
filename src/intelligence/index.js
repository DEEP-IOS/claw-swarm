/**
 * Intelligence System Factory - Creates and wires all intelligence domain modules
 *
 * Composes three sub-domain factories (social, artifacts, understanding) with
 * individually-instantiated identity and memory modules into a unified facade.
 * Provides cross-domain accessor methods required by SwarmCoreV9 wiring and
 * dashboard query methods for the observation layer.
 *
 * @module intelligence/index
 * @version 9.0.0
 */

// --- Sub-domain factories -----------------------------------------------------
import { createSocialSystem } from './social/index.js'
import { createArtifactSystem } from './artifacts/index.js'
import { createUnderstandingSystem } from './understanding/index.js'

// --- Identity modules (no barrel index.js) ------------------------------------
import { CapabilityEngine } from './identity/capability-engine.js'
import { CrossProvider } from './identity/cross-provider.js'
import { LifecycleManager } from './identity/lifecycle-manager.js'
import { ModelCapability } from './identity/model-capability.js'
import { PromptBuilder } from './identity/prompt-builder.js'
import { RoleRegistry } from './identity/role-registry.js'
import { SensitivityFilter } from './identity/sensitivity-filter.js'
import { SoulDesigner } from './identity/soul-designer.js'

// --- Memory modules (no barrel index.js) --------------------------------------
import { ContextEngine } from './memory/context-engine.js'
import { EmbeddingEngine } from './memory/embedding-engine.js'
import { EpisodicMemory } from './memory/episodic-memory.js'
import { HybridRetrieval } from './memory/hybrid-retrieval.js'
import { SemanticMemory } from './memory/semantic-memory.js'
import { UserProfile } from './memory/user-profile.js'
import { VectorIndex } from './memory/vector-index.js'
import { WorkingMemory } from './memory/working-memory.js'

/**
 * Create the complete intelligence system with all sub-domains wired together.
 *
 * @param {Object} deps
 * @param {Object} deps.field       - SignalStore instance
 * @param {Object} deps.bus         - EventBus instance
 * @param {Object} deps.store       - DomainStore instance
 * @param {Object} [deps.config={}] - Per-module config overrides
 * @returns {Object} Intelligence system facade
 */
export function createIntelligenceSystem({ field, bus, store, config = {} }) {
  // --- Sub-domain systems -----------------------------------------------------

  const social = createSocialSystem({ field, bus, store })
  const artifacts = createArtifactSystem({ field, bus, store })
  const understanding = createUnderstandingSystem({ field, bus })

  // --- Identity modules -------------------------------------------------------

  const capabilityEngine = new CapabilityEngine({
    field, bus,
    config: config.capability || {},
  })

  const crossProvider = new CrossProvider({
    field,
    config: config.crossProvider || {},
  })

  const lifecycleManager = new LifecycleManager({
    field, bus, store,
    config: config.lifecycle || {},
  })

  const modelCapability = new ModelCapability({
    field,
    config: config.modelCapability || {},
  })

  const promptBuilder = new PromptBuilder({
    field, bus,
    config: config.promptBuilder || {},
  })

  const roleRegistry = new RoleRegistry({
    field, bus,
    config: config.roleRegistry || {},
  })

  const sensitivityFilter = new SensitivityFilter({
    field,
    config: config.sensitivity || {},
  })

  const soulDesigner = new SoulDesigner({
    field, store,
    config: config.soul || {},
  })

  const _identityModules = [
    capabilityEngine, crossProvider, lifecycleManager, modelCapability,
    promptBuilder, roleRegistry, sensitivityFilter, soulDesigner,
  ]

  // --- Memory modules ---------------------------------------------------------

  const contextEngine = new ContextEngine({
    field, bus,
    config: config.context || {},
  })

  const embeddingEngine = new EmbeddingEngine({
    config: config.embedding || {},
  })

  const episodicMemory = new EpisodicMemory({
    field, bus, store,
    config: config.episodic || {},
  })

  const hybridRetrieval = new HybridRetrieval({
    field, store,
    config: config.retrieval || {},
  })

  const semanticMemory = new SemanticMemory({
    field, bus, store,
    config: config.semantic || {},
  })

  const userProfile = new UserProfile({
    field, store,
    config: config.userProfile || {},
  })

  const vectorIndex = new VectorIndex({
    config: config.vector || {},
  })

  const workingMemory = new WorkingMemory({
    config: config.workingMemory || {},
  })

  const _memoryModules = [
    contextEngine, embeddingEngine, episodicMemory, hybridRetrieval,
    semanticMemory, userProfile, vectorIndex, workingMemory,
  ]

  // --- Facade -----------------------------------------------------------------

  return {
    // Sub-systems
    social,
    artifacts,
    understanding,

    // Identity modules
    capabilityEngine,
    crossProvider,
    lifecycleManager,
    modelCapability,
    promptBuilder,
    roleRegistry,
    sensitivityFilter,
    soulDesigner,

    // Memory modules
    contextEngine,
    embeddingEngine,
    episodicMemory,
    hybridRetrieval,
    semanticMemory,
    userProfile,
    vectorIndex,
    workingMemory,

    // Module collection
    allModules: () => [
      ...social.allModules(),
      ...artifacts.allModules(),
      ...understanding.allModules(),
      ..._identityModules,
      ..._memoryModules,
    ],

    // Lifecycle
    start: async () => {
      await social.start()
      await artifacts.start()
      await understanding.start()
      for (const mod of _identityModules) {
        if (typeof mod.start === 'function') await mod.start()
      }
      for (const mod of _memoryModules) {
        if (typeof mod.start === 'function') await mod.start()
      }
    },

    stop: async () => {
      for (const mod of _memoryModules) {
        if (typeof mod.stop === 'function') await mod.stop()
      }
      for (const mod of _identityModules) {
        if (typeof mod.stop === 'function') await mod.stop()
      }
      await understanding.stop()
      await artifacts.stop()
      await social.stop()
    },

    // --- Cross-domain accessors (for SwarmCoreV9 wiring) ----------------------

    getCapabilityEngine: () => capabilityEngine,
    getHybridRetrieval: () => hybridRetrieval,
    getRoleRegistry: () => roleRegistry,
    getModelCapability: () => modelCapability,
    getArtifactRegistry: () => artifacts.artifacts,
    getReputationCRDT: () => social.reputation,

    // --- Dashboard query methods ----------------------------------------------

    getActiveAgents: () =>
      lifecycleManager.getActiveAgents?.() || [],

    getReputation: () =>
      social.reputation.getAll?.() || {},

    getSNA: () =>
      social.sna.getMetrics?.() || {},

    getEmotionalStates: () =>
      social.emotion.getAll?.() || {},

    getTrust: () =>
      social.trust.getAll?.() || {},

    getMemoryStats: () => ({
      working: workingMemory.getStats?.(),
      episodic: episodicMemory.getStats?.(),
      semantic: semanticMemory.getStats?.(),
    }),
  }
}

// --- Re-exports ---------------------------------------------------------------

// Sub-domain factories
export { createSocialSystem } from './social/index.js'
export { createArtifactSystem } from './artifacts/index.js'
export { createUnderstandingSystem } from './understanding/index.js'

// Identity (re-export from local imports)
export {
  CapabilityEngine, CrossProvider, LifecycleManager, ModelCapability,
  PromptBuilder, RoleRegistry, SensitivityFilter, SoulDesigner,
}

// Memory (re-export from local imports)
export {
  ContextEngine, EmbeddingEngine, EpisodicMemory, HybridRetrieval,
  SemanticMemory, UserProfile, VectorIndex, WorkingMemory,
}
