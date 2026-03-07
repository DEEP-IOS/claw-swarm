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

  const channelManager = new ChannelManager({
    field,
    eventBus: bus,
    maxChannels: config.channel?.maxChannels,
  })

  const taskChannel = new TaskChannel({
    field,
    eventBus: bus,
  })

  const pheromone = new PheromoneEngine({
    field,
    eventBus: bus,
    store,
    config: config.pheromone || {},
  })

  const responseMatrix = new ResponseMatrix({
    field,
    config: config.responseMatrix || {},
  })

  const typeRegistry = new TypeRegistry()

  const board = new StigmergicBoard({
    field,
    eventBus: bus,
    domainStore: store,
  })

  const gossip = new GossipProtocol({
    eventBus: bus,
    roundDurationMs: config.gossip?.roundDurationMs,
  })

  // --- Module Array (for coupling verification) -------------------------------

  const _modules = [
    channelManager, taskChannel,
    pheromone, responseMatrix, typeRegistry,
    board, gossip,
  ]

  // --- Facade -----------------------------------------------------------------

  return {
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
    },

    stop: async () => {
      for (const mod of _modules) {
        if (typeof mod.stop === 'function') {
          await mod.stop()
        }
      }
    },

    // Dashboard query methods
    getPheromoneState: () =>
      pheromone.getStats?.() || {
        types: pheromone._types?.size || 0,
        trails: pheromone._trails?.size || 0,
      },

    getActiveChannels: () =>
      channelManager.getActiveChannels?.() || {
        count: channelManager._channels?.size || 0,
      },

    getStigmergy: () =>
      board.getEntries?.() || {
        entries: board._entries?.size || 0,
      },
  }
}

// --- Re-exports ---------------------------------------------------------------

export { ChannelManager } from './channel/channel-manager.js'
export { TaskChannel } from './channel/task-channel.js'
export { PheromoneEngine } from './pheromone/pheromone-engine.js'
export { ResponseMatrix } from './pheromone/response-matrix.js'
export { TypeRegistry } from './pheromone/type-registry.js'
export { StigmergicBoard } from './stigmergy/stigmergic-board.js'
export { GossipProtocol } from './stigmergy/gossip-protocol.js'
