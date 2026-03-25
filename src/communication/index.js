/**
 * Communication System Factory - Creates and wires all communication domain modules
 *
 * Instantiates the 7 communication modules (channel, pheromone, stigmergy) and
 * returns a unified facade with lifecycle methods and dashboard query accessors.
 *
 * @module communication/index
 * @version 9.0.0
 */
import { ChannelManager } from './channel/channel-manager.js'
import { TaskChannel } from './channel/task-channel.js'
import { PheromoneEngine } from './pheromone/pheromone-engine.js'
import { ResponseMatrix } from './pheromone/response-matrix.js'
import TypeRegistry from './pheromone/type-registry.js'
import { StigmergicBoard } from './stigmergy/stigmergic-board.js'
import { GossipProtocol } from './stigmergy/gossip-protocol.js'

const VALID_CHANNEL_MESSAGE_TYPES = new Set(['finding', 'question', 'decision', 'progress', 'error'])

const PHEROMONE_TYPE_ALIASES = Object.freeze({
  progress: 'trail',
  dependency: 'trail',
  success: 'food',
  warning: 'alarm',
  failure: 'alarm',
  conflict: 'alarm',
  collaboration: 'recruit',
  dispatch: 'recruit',
  checkpoint: 'queen',
  discovery: 'dance',
})

function clampStrength(value, fallback = 0.5) {
  const numeric = typeof value === 'number' ? value : fallback
  return Math.max(0, Math.min(1, numeric))
}

function canonicalizePheromoneType(type, typeRegistry) {
  if (typeRegistry?.has?.(type)) return type
  return PHEROMONE_TYPE_ALIASES[type] || 'trail'
}

function normalizePheromoneDeposit(input, typeRegistry, scopeArg, intensityArg, metadataArg, emitterArg) {
  if (typeof input === 'string') {
    return {
      requestedType: input,
      canonicalType: canonicalizePheromoneType(input, typeRegistry),
      scope: scopeArg || 'global',
      intensity: clampStrength(intensityArg),
      metadata: metadataArg || {},
      emitterId: emitterArg || 'system',
    }
  }

  const trail = input || {}
  const requestedType = trail.type || 'trail'
  const canonicalType = canonicalizePheromoneType(requestedType, typeRegistry)
  const metadata = { ...(trail.metadata || {}) }
  if (trail.message) metadata.message = trail.message
  if (trail.id) metadata.trailId = trail.id
  if (requestedType !== canonicalType) metadata.aliasType = requestedType

  return {
    requestedType,
    canonicalType,
    scope: trail.scope || 'global',
    intensity: clampStrength(trail.intensity ?? trail.strength),
    metadata,
    emitterId: trail.depositor || trail.emitterId || trail.from || 'system',
  }
}

function inferMessageType(message = {}) {
  const explicitType = message.type || message.messageType
  if (VALID_CHANNEL_MESSAGE_TYPES.has(explicitType)) return explicitType
  if (explicitType === 'checkpoint_resolved') return 'decision'

  if (typeof message.content === 'string') {
    try {
      const parsed = JSON.parse(message.content)
      if (parsed?.type === 'checkpoint_resolved') return 'decision'
      if (VALID_CHANNEL_MESSAGE_TYPES.has(parsed?.type)) return parsed.type
    } catch (_) {
      // Ignore non-JSON payloads and use the default type below.
    }
  }

  if (message.priority >= 8) return 'decision'
  return 'progress'
}

function normalizeChannelData(message = {}) {
  if (message.data !== undefined) return message.data
  if (typeof message.content === 'string') {
    return {
      content: message.content,
      id: message.id,
      priority: message.priority,
      priorityLabel: message.priorityLabel,
      to: message.to,
      ts: message.timestamp || message.ts,
    }
  }
  return { ...message }
}

function summarizeChannel(channel) {
  const stats = channel.stats()
  return {
    channelId: stats.channelId,
    memberCount: stats.memberCount,
    messageCount: stats.messageCount,
    createdAt: stats.createdAt,
    closedAt: stats.closedAt,
    closed: stats.closed,
    members: channel.getMembers(),
    recentMessages: channel.getMessages({ limit: 10 }),
  }
}

function normalizeScopeCandidate(candidate) {
  if (typeof candidate === 'string') {
    return {
      scope: candidate,
      label: candidate,
      raw: candidate,
    }
  }

  const scope = candidate?.scope || candidate?.id || candidate?.path || candidate?.label || 'unknown'
  return {
    scope,
    label: candidate?.label || candidate?.id || candidate?.path || scope,
    raw: candidate,
  }
}

function toTrailRecord(signal, canonicalType) {
  const metadata = signal.metadata || {}
  return {
    id: signal.id,
    type: metadata.aliasType || metadata.pheromoneType || canonicalType,
    canonicalType,
    scope: signal.scope,
    intensity: signal._actualStrength ?? signal.strength ?? 0,
    message: metadata.message || '',
    metadata,
    depositor: signal.emitterId,
    emitterId: signal.emitterId,
    depositedAt: signal.emitTime,
    age: Math.max(0, Date.now() - (signal.emitTime || Date.now())),
    dimension: signal.dimension,
  }
}

function clampScore(value) {
  return Math.max(0, Math.min(1, value))
}

/**
 * Create the complete communication system with all 7 modules wired together.
 *
 * @param {Object} deps
 * @param {Object} deps.field       - SignalStore instance
 * @param {Object} deps.bus         - EventBus instance
 * @param {Object} deps.store       - DomainStore instance
 * @param {Object} [deps.config={}] - Per-module config overrides
 * @returns {Object} Communication system facade
 */
export function createCommunicationSystem({ field, bus, store, config = {} }) {
  // --- Module Instantiation ---------------------------------------------------

  const typeRegistry = new TypeRegistry()

  const channelManager = new ChannelManager({
    field,
    eventBus: bus,
    maxChannels: config.channel?.maxChannels,
  })

  const taskChannel = new TaskChannel({
    channelId: config.taskChannel?.channelId || 'global',
    field,
    eventBus: bus,
  })

  const pheromone = new PheromoneEngine({
    field,
    eventBus: bus,
    typeRegistry,
    config: config.pheromone || {},
  })

  const responseMatrix = new ResponseMatrix({
    pheromoneEngine: pheromone,
  })

  const gossip = new GossipProtocol({
    eventBus: bus,
    roundDurationMs: config.gossip?.roundDurationMs,
  })

  const board = new StigmergicBoard({
    field,
    eventBus: bus,
    domainStore: store,
    gossipProtocol: gossip,
  })

  // --- Module Array (for coupling verification) -------------------------------

  const _modules = [
    channelManager, taskChannel,
    pheromone, responseMatrix, typeRegistry,
    board, gossip,
  ]

  // --- Facade -----------------------------------------------------------------

  const ensureChannel = (channelId, members = []) => {
    const resolvedChannelId = channelId || 'global'
    let channel = channelManager.get(resolvedChannelId)
    if (!channel || channel.isClosed()) {
      if (channel?.isClosed?.()) {
        channelManager.close(resolvedChannelId)
      }
      channel = channelManager.create(resolvedChannelId)
    }

    for (const member of members) {
      const agentId = typeof member === 'string' ? member : member?.agentId || member?.id
      const role = typeof member === 'string' ? 'member' : member?.role || 'member'
      if (!agentId) continue
      channel.join(agentId, role)
    }

    return channel
  }

  const collectTrails = ({ type, scope, limit } = {}) => {
    const requestedType = type || null
    const canonicalTypes = requestedType
      ? [canonicalizePheromoneType(requestedType, typeRegistry)]
      : typeRegistry.list()

    let trails = []
    for (const canonicalType of canonicalTypes) {
      const signals = pheromone.read(canonicalType, scope)
      trails = trails.concat(signals.map((signal) => toTrailRecord(signal, canonicalType)))
    }

    if (requestedType) {
      trails = trails.filter((trail) =>
        trail.type === requestedType || trail.canonicalType === requestedType
      )
    }

    trails.sort((a, b) => (b.intensity || 0) - (a.intensity || 0))
    if (typeof limit === 'number' && limit > 0) {
      trails = trails.slice(0, limit)
    }
    return trails
  }

  const getPheromoneState = (scope) => {
    const trails = collectTrails({ scope })
    const byType = {}
    for (const trail of trails) {
      byType[trail.type] = (byType[trail.type] || 0) + 1
    }

    return {
      scope: scope || 'all',
      types: Object.keys(byType).length,
      trailCount: trails.length,
      trails,
      byType,
      activeTypes: Object.keys(byType),
      totalDeposits: pheromone.stats().depositCount,
      totalReads: pheromone.stats().readCount,
    }
  }

  const getActiveChannels = () => {
    const channels = channelManager
      .listActive()
      .map((channelId) => channelManager.get(channelId))
      .filter(Boolean)
      .map((channel) => summarizeChannel(channel))

    return {
      count: channels.length,
      channels,
    }
  }

  const getStigmergy = (scope) => {
    const entries = scope
      ? board._domainStore?.query?.('board', (entry) => entry.scope === scope) || []
      : board._domainStore?.queryAll?.('board') || []

    return {
      scope: scope || 'all',
      entryCount: entries.length,
      entries: entries.map((entry) => ({
        key: entry._key,
        scope: entry.scope,
        visibility: entry.visibility,
        writtenBy: entry.writtenBy,
        writtenAt: entry.writtenAt,
        age: Math.max(0, Date.now() - (entry.writtenAt || Date.now())),
        value: entry.value,
      })),
    }
  }

  const getTopIntensity = (scope, type) => {
    const [top] = collectTrails({ scope, type, limit: 1 })
    return top?.intensity || 0
  }

  const getVisibleKnowledgeEntries = (scope, readerAgentId, query) => {
    const entries = board.list(scope, readerAgentId)
    if (!query) return entries

    const lower = String(query).toLowerCase()
    return entries.filter((entry) => {
      const haystack = [
        entry._key,
        entry.scope,
        typeof entry.value === 'string' ? entry.value : JSON.stringify(entry.value),
      ].join(' ').toLowerCase()
      return haystack.includes(lower)
    })
  }

  const rankScopes = (candidates = [], options = {}) => {
    const strategy = options.strategy || 'avoid_duplicate_work'
    const readerAgentId = options.readerAgentId || 'system'
    const query = options.query || ''

    const ranked = candidates.map((candidate) => {
      const normalized = normalizeScopeCandidate(candidate)
      const trail = getTopIntensity(normalized.scope, 'trail')
      const alarm = getTopIntensity(normalized.scope, 'alarm')
      const dance = getTopIntensity(normalized.scope, 'dance')
      const food = getTopIntensity(normalized.scope, 'food')
      const knowledgeHits = getVisibleKnowledgeEntries(normalized.scope, readerAgentId, query).length
      const knowledgeScore = clampScore(knowledgeHits / 3)

      let score
      let reason

      switch (strategy) {
        case 'avoid_hazard':
          score = clampScore(
            (1 - alarm) * 0.7 +
            (1 - trail) * 0.2 +
            dance * 0.1
          )
          reason = `safe scope: alarm=${alarm.toFixed(2)}, trail=${trail.toFixed(2)}`
          break

        case 'knowledge_diffusion':
          score = clampScore(
            dance * 0.55 +
            knowledgeScore * 0.3 +
            (1 - alarm) * 0.15
          )
          reason = `knowledge scent: dance=${dance.toFixed(2)}, visibleEntries=${knowledgeHits}`
          break

        case 'resource_tilt':
          score = clampScore(
            food * 0.7 +
            dance * 0.15 +
            (1 - alarm) * 0.15
          )
          reason = `resource tilt: food=${food.toFixed(2)}, alarm=${alarm.toFixed(2)}`
          break

        case 'avoid_duplicate_work':
        default:
          score = clampScore(
            (1 - trail) * 0.65 +
            (1 - alarm) * 0.25 +
            dance * 0.1
          )
          reason = `fresh path: trail=${trail.toFixed(2)}, alarm=${alarm.toFixed(2)}`
          break
      }

      return {
        scope: normalized.scope,
        label: normalized.label,
        score,
        reason,
        signals: {
          trail,
          alarm,
          dance,
          food,
          visibleKnowledgeEntries: knowledgeHits,
        },
        candidate: normalized.raw,
      }
    })

    ranked.sort((a, b) => b.score - a.score)
    return ranked
  }

  const suggestKnowledgeSources = ({ query = '', readerAgentId = 'system', scope, limit = 5 } = {}) => {
    const allEntries = board._domainStore?.queryAll?.('board') || []
    const lower = String(query).toLowerCase()

    const visible = allEntries
      .map((entry) => board.read(entry._key, readerAgentId))
      .filter(Boolean)
      .filter((entry) => !scope || entry.scope === scope)
      .filter((entry) => {
        if (!lower) return true
        const haystack = [
          entry._key,
          entry.scope,
          typeof entry.value === 'string' ? entry.value : JSON.stringify(entry.value),
        ].join(' ').toLowerCase()
        return haystack.includes(lower)
      })
      .map((entry) => {
        const dance = getTopIntensity(entry.scope, 'dance')
        const score = clampScore(dance * 0.6 + Math.max(0, 1 - (Date.now() - entry.writtenAt) / 300000) * 0.4)
        return {
          key: entry._key,
          scope: entry.scope,
          writtenBy: entry.writtenBy,
          writtenAt: entry.writtenAt,
          age: Math.max(0, Date.now() - (entry.writtenAt || Date.now())),
          score,
          value: entry.value,
        }
      })

    visible.sort((a, b) => b.score - a.score)
    return visible.slice(0, limit)
  }

  const facade = {
    // Module instances
    channelManager,
    taskChannel,
    pheromone,
    responseMatrix,
    typeRegistry,
    board,
    gossip,

    // Module collection
    allModules: () => [..._modules],

    // Lifecycle
    start: async () => {
      for (const mod of _modules) {
        if (typeof mod.start === 'function') {
          await mod.start()
        }
      }

      // Wire GossipProtocol to stigmergy events — propagate visibility scheduling
      // when new entries are written to the board
      if (bus?.on) {
        bus.on('stigmergy.entry.written', (data) => {
          const key = data?.key || data?.entryKey
          const writer = data?.writtenBy || data?.agentId || 'system'
          const scope = data?.scope || 'global'
          const session = data?.session || data?.sessionId
          if (key) {
            gossip.scheduleVisibility(key, writer, scope, session)
          }
        })
      }
    },

    stop: async () => {
      for (const mod of _modules) {
        if (typeof mod.stop === 'function') {
          await mod.stop()
        }
      }
    },

    createChannel: (channelId, options = {}) =>
      summarizeChannel(ensureChannel(channelId, options.members || [])),

    post: (channelId, message = {}) => {
      const sender = message.from || message.agentId || 'system'
      const members = [sender]
      if (Array.isArray(message.to)) {
        members.push(...message.to)
      } else if (message.to) {
        members.push(message.to)
      }
      const channel = ensureChannel(channelId, members)
      const type = inferMessageType(message)
      channel.post(sender, { type, data: normalizeChannelData(message) })
      return {
        channelId: channelId || 'global',
        delivered: true,
        type,
        messageCount: channel.stats().messageCount,
      }
    },

    send: (envelope = {}) => {
      const channelId = envelope.channelId || envelope.scope || envelope.to || 'global'
      const result = facade.post(channelId, envelope)
      bus?.publish?.('communication.message.sent', {
        channelId,
        to: envelope.to,
        from: envelope.from,
        messageId: envelope.id,
        type: inferMessageType(envelope),
      }, 'communication')
      return result
    },

    depositPheromone: (...args) => {
      const normalized = normalizePheromoneDeposit(args[0], typeRegistry, args[1], args[2], args[3], args[4])
      return pheromone.deposit(
        normalized.canonicalType,
        normalized.scope,
        normalized.intensity,
        normalized.metadata,
        normalized.emitterId,
      )
    },

    readPheromones: (query = {}) => collectTrails(query),

    // Dashboard/query methods
    getPheromoneState,
    getActiveChannels,
    getStigmergy,
    rankScopes,
    suggestKnowledgeSources,
  }

  return facade
}

// --- Re-exports ---------------------------------------------------------------

export { ChannelManager } from './channel/channel-manager.js'
export { TaskChannel } from './channel/task-channel.js'
export { PheromoneEngine } from './pheromone/pheromone-engine.js'
export { ResponseMatrix } from './pheromone/response-matrix.js'
export { TypeRegistry } from './pheromone/type-registry.js'
export { StigmergicBoard } from './stigmergy/stigmergic-board.js'
export { GossipProtocol } from './stigmergy/gossip-protocol.js'
