/**
 * Intelligence System Factory - Creates and wires all intelligence domain modules.
 *
 * @module intelligence/index
 * @version 9.0.0
 */

import { createSocialSystem } from './social/index.js'
import { createArtifactSystem } from './artifacts/index.js'
import { createUnderstandingSystem } from './understanding/index.js'

import { ABCClassifier } from './identity/abc-classifier.js'
import { CapabilityEngine } from './identity/capability-engine.js'
import { CrossProvider } from './identity/cross-provider.js'
import { LifecycleManager } from './identity/lifecycle-manager.js'
import { ModelCapability } from './identity/model-capability.js'
import { PromptBuilder } from './identity/prompt-builder.js'
import { RoleRegistry } from './identity/role-registry.js'
import { SensitivityFilter } from './identity/sensitivity-filter.js'
import { SoulDesigner } from './identity/soul-designer.js'

import { ContextEngine } from './memory/context-engine.js'
import { EmbeddingEngine } from './memory/embedding-engine.js'
import { EpisodicMemory } from './memory/episodic-memory.js'
import { HybridRetrieval } from './memory/hybrid-retrieval.js'
import { SemanticMemory } from './memory/semantic-memory.js'
import { UserProfile } from './memory/user-profile.js'
import { VectorIndex } from './memory/vector-index.js'
import { WorkingMemory } from './memory/working-memory.js'

const BRIDGE_MEMORY_COLLECTION = 'bridge-memory'

function mapEpisodeToMemoryEntry(result) {
  const episode = result?.episode ?? result
  return {
    id: episode.id,
    type: episode.type || 'episode',
    content: episode.content || episode.goal || '',
    relevance: result?.score ?? episode.relevance ?? 0,
    score: result?.score ?? episode.score ?? 0,
    tags: episode.tags || [],
    source: episode.source || 'episodic',
    createdAt: episode.recordedAt || episode.createdAt || Date.now(),
    role: episode.role,
    lesson: episode.lessons?.[0] || null,
  }
}

function normalizeAgentRecord(agent) {
  if (!agent) return null
  return {
    id: agent.agentId ?? agent.id,
    agentId: agent.agentId ?? agent.id,
    role: agent.roleId ?? agent.role ?? 'unknown',
    roleId: agent.roleId ?? agent.role ?? 'unknown',
    state: agent.state ?? 'unknown',
    parentId: agent.parentId ?? null,
    spawnedAt: agent.spawnedAt ?? agent.startedAt ?? null,
    sessionId: agent.sessionId ?? agent.options?.sessionId ?? null,
    taskId: agent.taskId ?? null,
    model: agent.model ?? agent.options?.model ?? null,
    raw: agent,
  }
}

function getSoulPayload(soulDesigner, agentId) {
  return {
    soul: soulDesigner.loadSoulInstance(agentId),
    archetype: soulDesigner.getAgentArchetype(agentId),
  }
}

function makeBridgeMemoryFacade(store) {
  const getAll = () => store?.query?.(BRIDGE_MEMORY_COLLECTION, () => true) || []

  return {
    getAll,
    async record(entry) {
      store?.put?.(BRIDGE_MEMORY_COLLECTION, entry.id, entry)
      return entry
    },
    async delete(memoryId) {
      if (!store?.delete) return false
      return !!store.delete(BRIDGE_MEMORY_COLLECTION, memoryId)
    },
    search(query, { type, scope, limit = 20 } = {}) {
      const lower = String(query || '').toLowerCase()
      return getAll()
        .filter((entry) => {
          if (type && entry.type !== type) return false
          if (scope && entry.scope !== scope) return false
          const haystack = `${entry.content || ''} ${(entry.tags || []).join(' ')}`.toLowerCase()
          return haystack.includes(lower)
        })
        .map((entry) => ({ ...entry, relevance: 0.6 }))
        .slice(0, limit)
    },
    export({ type, scope, limit = 100 } = {}) {
      return getAll()
        .filter((entry) => (!type || entry.type === type) && (!scope || entry.scope === scope))
        .slice(0, limit)
    },
    stats({ scope } = {}) {
      const entries = getAll().filter((entry) => !scope || entry.scope === scope)
      const byType = {}
      for (const entry of entries) {
        byType[entry.type] = (byType[entry.type] || 0) + 1
      }
      return {
        totalEntries: entries.length,
        byType,
        oldestEntry: entries[0] || null,
        newestEntry: entries[entries.length - 1] || null,
        storageUsed: entries.reduce((sum, entry) => sum + JSON.stringify(entry).length, 0),
      }
    },
  }
}

export function createIntelligenceSystem({ field, bus, store, communication = null, config = {} }) {
  const capabilityEngine = new CapabilityEngine({
    signalStore: field,
    domainStore: store,
    eventBus: bus,
    config: config.capability || {},
  })

  const social = createSocialSystem({ field, bus, store, capabilityEngine })
  const artifacts = createArtifactSystem({ field, bus, store })
  const understanding = createUnderstandingSystem({ field, bus })

  const crossProvider = new CrossProvider({
    signalStore: field,
    domainStore: store,
    eventBus: bus,
    config: config.crossProvider || {},
  })

  const lifecycleManager = new LifecycleManager({
    signalStore: field,
    domainStore: store,
    eventBus: bus,
    config: config.lifecycle || {},
  })

  const modelCapability = new ModelCapability({
    field,
    config: config.modelCapability || {},
  })

  const roleRegistry = new RoleRegistry({
    field,
    eventBus: bus,
    domainStore: store,
    config: config.roleRegistry || {},
  })

  const sensitivityFilter = new SensitivityFilter({
    signalStore: field,
    roleRegistry,
    config: config.sensitivity || {},
  })

  const soulDesigner = new SoulDesigner({
    signalStore: field,
    domainStore: store,
    config: config.soul || {},
  })

  const contextEngine = new ContextEngine({
    ...(config.context || {}),
  })

  const embeddingEngine = new EmbeddingEngine({
    ...(config.embedding || {}),
  })

  const vectorIndex = new VectorIndex({
    ...(config.vector || {}),
  })

  const episodicMemory = new EpisodicMemory({
    domainStore: store,
    field,
    eventBus: bus,
    embeddingEngine,
    vectorIndex,
  })

  const semanticMemory = new SemanticMemory({
    domainStore: store,
    field,
    eventBus: bus,
  })

  const hybridRetrieval = new HybridRetrieval({
    episodicMemory,
    semanticMemory,
    vectorIndex,
    embeddingEngine,
    field,
  })

  const userProfile = new UserProfile({
    domainStore: store,
    eventBus: bus,
    config: config.userProfile || {},
  })

  const workingMemory = new WorkingMemory({
    eventBus: bus,
    defaultCapacity: config.workingMemory?.defaultCapacity || 15,
  })

  const promptBuilder = new PromptBuilder({
    roleRegistry,
    sensitivityFilter,
    hybridRetrieval,
    stigmergicBoard: communication?.stigmergicBoard ?? communication?.board ?? null,
    contextEngine,
    soulDesigner,
    userProfile,
    field,
    capabilityEngine,
  })

  const abcClassifier = new ABCClassifier({
    bus,
    store,
  })

  const _identityModules = [
    abcClassifier,
    capabilityEngine,
    crossProvider,
    lifecycleManager,
    modelCapability,
    promptBuilder,
    roleRegistry,
    sensitivityFilter,
    soulDesigner,
  ]

  const _memoryModules = [
    contextEngine,
    embeddingEngine,
    episodicMemory,
    hybridRetrieval,
    semanticMemory,
    userProfile,
    vectorIndex,
    workingMemory,
  ]

  const bridgeMemory = makeBridgeMemoryFacade(store)

  const getEnrichedAgentInfo = (agentId) => {
    const normalized = normalizeAgentRecord(lifecycleManager.getState(agentId))
    if (!normalized) return {}

    const { soul, archetype } = getSoulPayload(soulDesigner, agentId)

    return {
      ...normalized,
      capabilities: capabilityEngine.getVector8D(agentId),
      abc: abcClassifier.getRole(agentId),
      soul,
      archetype,
      emotion: social.emotion.getEmotion?.(agentId) ?? null,
      reputation: social.reputation.getScore?.(agentId) ?? null,
      trust: social.trust.getTrust?.(agentId) ?? null,
    }
  }

  const getAllAgentRecords = () => {
    const records = []
    const rawAgents = lifecycleManager?._agents
    if (!(rawAgents instanceof Map)) return records
    for (const agent of rawAgents.values()) {
      const normalized = normalizeAgentRecord(agent)
      if (normalized) records.push(normalized)
    }
    return records
  }

  const getRoleSensitivityProfiles = () => roleRegistry.list().map((roleId) => {
    const role = roleRegistry.get(roleId)
    const sensitivity = roleRegistry.getSensitivity(roleId) || {}
    const topDimensions = Object.entries(sensitivity)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 3)
      .map(([dimension, value]) => ({ dimension, value }))

    return {
      roleId,
      name: role?.name || roleId,
      preferredModel: role?.preferredModel || 'balanced',
      toolCount: Array.isArray(role?.tools) ? role.tools.length : 0,
      sensitivity,
      topDimensions,
    }
  })

  const intelligence = {
    social,
    artifacts,
    understanding,

    abcClassifier,
    capabilityEngine,
    crossProvider,
    lifecycleManager,
    modelCapability,
    promptBuilder,
    roleRegistry,
    sensitivityFilter,
    soulDesigner,

    contextEngine,
    embeddingEngine,
    episodicMemory,
    hybridRetrieval,
    semanticMemory,
    userProfile,
    vectorIndex,
    workingMemory,

    allModules: () => [
      ...social.allModules(),
      ...artifacts.allModules(),
      ...understanding.allModules(),
      ..._identityModules,
      ..._memoryModules,
    ],

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
      for (const mod of [..._memoryModules].reverse()) {
        if (typeof mod.stop === 'function') await mod.stop()
      }
      for (const mod of [..._identityModules].reverse()) {
        if (typeof mod.stop === 'function') await mod.stop()
      }
      await understanding.stop()
      await artifacts.stop()
      await social.stop()
    },

    getCapabilityEngine: () => capabilityEngine,
    getHybridRetrieval: () => hybridRetrieval,
    getRoleRegistry: () => roleRegistry,
    getModelCapability: () => modelCapability,
    getArtifactRegistry: () => artifacts.artifacts,
    getReputationCRDT: () => social.reputation,

    classifyIntent: (userInput, historyContext = {}) =>
      understanding.intent.classify(userInput, historyContext),

    isIntentAmbiguous: (intentResult) =>
      understanding.clarifier.isAmbiguous(intentResult),

    generateClarificationQuestions: (intentResult, codebaseContext = {}) =>
      understanding.clarifier.generateQuestions(intentResult, codebaseContext),

    refineRequirement: (original, answers) =>
      understanding.clarifier.refineRequirement(original, answers),

    estimateScope: (input, codebaseInfo = {}) => {
      const intentResult = typeof input === 'string'
        ? understanding.intent.classify(input, codebaseInfo.historyContext || {})
        : input
      return understanding.scope.estimate(intentResult, codebaseInfo)
    },

    buildPrompt: async (roleId, agentContext = {}, taskContext = {}) => {
      const agentId = agentContext.agentId || taskContext.agentId || `prompt-${roleId}`
      const goal = taskContext.goal || taskContext.task || agentContext.task || ''
      const scope = taskContext.scope || agentContext.scope || 'global'
      return promptBuilder.build(agentId, roleId, {
        ...taskContext,
        ...agentContext,
        goal,
        scope,
      })
    },

    searchMemory: async (query, options = {}) => {
      const retrievalResults = await hybridRetrieval.search(query, {
        topK: options.limit || 5,
        role: options.role,
        scope: options.scope,
      })
      const mapped = retrievalResults.map(mapEpisodeToMemoryEntry)
      const manual = bridgeMemory.search(query, options)
      return [...mapped, ...manual].slice(0, options.limit || 20)
    },

    recordMemory: async (entry) => bridgeMemory.record(entry),
    forgetMemory: async (memoryId) => bridgeMemory.delete(memoryId),
    exportMemory: async (options = {}) => bridgeMemory.export(options),

    appendToMemory: (bufferId, entry) => {
      if (!bufferId) return false
      workingMemory.create(bufferId)
      workingMemory.push(bufferId, entry)
      return true
    },

    getArtifacts: (dagId, type) => artifacts.artifacts.getArtifacts(dagId, type),

    getAgentInfo: (agentId) => getEnrichedAgentInfo(agentId),

    getAllAgentStates: () => Object.fromEntries(
      getAllAgentRecords().map((agent) => [agent.id, agent]),
    ),

    getCapabilities: (agentId = null) => {
      if (agentId) return capabilityEngine.getVector8D(agentId)
      return Object.fromEntries(
        getAllAgentRecords().map((agent) => [agent.id, capabilityEngine.getVector8D(agent.id)]),
      )
    },

    getIdentityMap: () => {
      const roles = roleRegistry.list().map((roleId) => {
        const role = roleRegistry.get(roleId)
        return {
          id: roleId,
          name: role?.name || roleId,
          preferredModel: role?.preferredModel || 'balanced',
          tools: role?.tools || [],
        }
      })
      return {
        roles,
        abcRoles: abcClassifier.getAllRoles(),
        activeAgents: getAllAgentRecords(),
      }
    },

    getRoleSensitivityProfiles,

    getSoul: (agentId) => getSoulPayload(soulDesigner, agentId),
    getABCRoles: () => abcClassifier.getAllRoles(),

    getContextWindowStats: () => ({
      maxTokens: contextEngine._maxTokens,
      reservedTokens: contextEngine._reservedTokens,
      workingMemoryBuffers: workingMemory._buffers?.size || 0,
      workingMemoryEntries: [...(workingMemory._buffers?.values() || [])]
        .reduce((sum, buffer) => sum + (buffer?.size?.() || 0), 0),
    }),

    getCulturalFriction: () => {
      const providers = ['anthropic', 'openai', 'google']
      const pairs = []
      for (let index = 0; index < providers.length; index++) {
        for (let inner = index + 1; inner < providers.length; inner++) {
          pairs.push(social.friction.computeFriction(providers[index], providers[inner]))
        }
      }
      return { pairs }
    },

    getActiveAgents: () => getAllAgentRecords().filter((agent) => agent.state === 'active'),
    getReputation: () => social.reputation.getAll?.() || {},
    getSNA: () => social.sna.getMetrics?.() || {},
    getEmotionalStates: () => social.emotion.getAll?.() || {},
    getTrust: () => social.trust.getAll?.() || {},
    getMemoryStats: () => ({
      working: {
        buffers: workingMemory._buffers?.size || 0,
      },
      episodic: episodicMemory.stats?.() || {},
      semantic: semanticMemory.stats?.() || {},
      bridge: bridgeMemory.stats(),
    }),
  }

  return intelligence
}

export { createSocialSystem } from './social/index.js'
export { createArtifactSystem } from './artifacts/index.js'
export { createUnderstandingSystem } from './understanding/index.js'

export {
  ABCClassifier,
  CapabilityEngine,
  CrossProvider,
  LifecycleManager,
  ModelCapability,
  PromptBuilder,
  RoleRegistry,
  SensitivityFilter,
  SoulDesigner,
}

export {
  ContextEngine,
  EmbeddingEngine,
  EpisodicMemory,
  HybridRetrieval,
  SemanticMemory,
  UserProfile,
  VectorIndex,
  WorkingMemory,
}
