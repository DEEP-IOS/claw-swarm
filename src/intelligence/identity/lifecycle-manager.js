/**
 * LifecycleManager — 代理生命周期状态机
 * Agent lifecycle finite state machine (FSM) management
 *
 * FSM: IDLE -> SPAWNING -> ACTIVE -> COMPLETING -> ENDED
 *       (any) -> FAILED -> ENDED
 *
 * @module intelligence/identity/lifecycle-manager
 * @version 9.0.0
 */

import { ModuleBase } from '../../core/module-base.js'
import { DIM_COORDINATION, DIM_ALARM } from '../../core/field/types.js'

/** Valid FSM states */
const STATES = Object.freeze({
  IDLE: 'idle',
  SPAWNING: 'spawning',
  ACTIVE: 'active',
  COMPLETING: 'completing',
  ENDED: 'ended',
  FAILED: 'failed',
})

/** Legal transitions: fromState -> Set of toStates */
const TRANSITIONS = Object.freeze({
  [STATES.IDLE]:       new Set([STATES.SPAWNING, STATES.FAILED]),
  [STATES.SPAWNING]:   new Set([STATES.ACTIVE, STATES.FAILED]),
  [STATES.ACTIVE]:     new Set([STATES.COMPLETING, STATES.FAILED]),
  [STATES.COMPLETING]: new Set([STATES.ENDED, STATES.FAILED]),
  [STATES.ENDED]:      new Set(),
  [STATES.FAILED]:     new Set([STATES.ENDED]),
})

export class LifecycleManager extends ModuleBase {
  /** @returns {string[]} */
  static produces() { return [DIM_COORDINATION] }
  /** @returns {string[]} */
  static consumes() { return [DIM_ALARM] }
  /** @returns {string[]} */
  static publishes() { return ['agent.lifecycle.spawned', 'agent.lifecycle.active', 'agent.lifecycle.completed', 'agent.lifecycle.failed', 'agent.lifecycle.ended'] }
  /** @returns {string[]} */
  static subscribes() { return [] }

  /**
   * @param {Object} deps
   * @param {Object} deps.signalStore - SignalStore instance
   * @param {Object} deps.domainStore - DomainStore instance
   * @param {Object} deps.eventBus - EventBus instance
   */
  constructor({ signalStore, domainStore, eventBus } = {}) {
    super()
    this._signalStore = signalStore
    this._domainStore = domainStore
    this._eventBus = eventBus
    /** @type {Map<string, Object>} agentId -> { state, roleId, spawnedAt, ... } */
    this._agents = new Map()
  }

  async start() {}
  async stop() {}

  /**
   * Validate and execute a state transition
   * @private
   * @param {string} agentId
   * @param {string} toState
   * @throws {Error} if transition is illegal
   */
  _transition(agentId, toState) {
    const agent = this._agents.get(agentId)
    if (!agent) throw new Error('Unknown agent: ' + agentId)

    const allowed = TRANSITIONS[agent.state]
    if (!allowed || !allowed.has(toState)) {
      throw new Error('Illegal transition: ' + agent.state + ' -> ' + toState + ' for agent ' + agentId)
    }

    agent.state = toState
    agent.lastTransitionAt = Date.now()
  }

  /**
   * Spawn a new agent - transition IDLE -> SPAWNING -> (event)
   * @param {string} agentId
   * @param {string} roleId
   * @param {Object} [options={}]
   * @returns {Object} Agent state record
   */
  spawn(agentId, roleId, options = {}) {
    if (this._agents.has(agentId)) {
      throw new Error('Agent already exists: ' + agentId)
    }

    const record = {
      agentId,
      roleId,
      state: STATES.IDLE,
      spawnedAt: Date.now(),
      lastTransitionAt: Date.now(),
      options,
      error: null,
    }
    this._agents.set(agentId, record)

    // IDLE -> SPAWNING
    this._transition(agentId, STATES.SPAWNING)

    // Emit coordination signal
    if (this._signalStore) {
      this._signalStore.emit({
        dimension: DIM_COORDINATION,
        scope: agentId,
        strength: 0.6,
        emitterId: 'lifecycle-manager',
        metadata: { event: 'spawning', roleId },
      })
    }

    if (this._eventBus) {
      this._eventBus.publish('agent.lifecycle.spawned', { agentId, roleId, provider: options.provider })
    }

    return { ...record }
  }

  /**
   * Mark agent as ready/active - transition SPAWNING -> ACTIVE
   * @param {string} agentId
   */
  markReady(agentId) {
    this._transition(agentId, STATES.ACTIVE)

    if (this._signalStore) {
      this._signalStore.emit({
        dimension: DIM_COORDINATION,
        scope: agentId,
        strength: 0.8,
        emitterId: 'lifecycle-manager',
        metadata: { event: 'active' },
      })
    }

    if (this._eventBus) {
      this._eventBus.publish('agent.lifecycle.active', { agentId })
    }
  }

  /**
   * Mark agent as completing - transition ACTIVE -> COMPLETING
   * @param {string} agentId
   * @param {*} [result]
   */
  markCompleted(agentId, result) {
    this._transition(agentId, STATES.COMPLETING)
    const agent = this._agents.get(agentId)
    agent.result = result

    if (this._eventBus) {
      this._eventBus.publish('agent.lifecycle.completed', { agentId, result })
    }
  }

  /**
   * Mark agent as failed - transition (any) -> FAILED
   * @param {string} agentId
   * @param {Error|string} error
   */
  markFailed(agentId, error) {
    this._transition(agentId, STATES.FAILED)
    const agent = this._agents.get(agentId)
    agent.error = error instanceof Error ? error.message : String(error)

    // Emit alarm signal
    if (this._signalStore) {
      this._signalStore.emit({
        dimension: DIM_ALARM,
        scope: agentId,
        strength: 0.9,
        emitterId: 'lifecycle-manager',
        metadata: { event: 'failed', error: agent.error },
      })
    }

    if (this._eventBus) {
      this._eventBus.publish('agent.lifecycle.failed', { agentId, error: agent.error })
    }
  }

  /**
   * Mark agent as ended - transition COMPLETING|FAILED -> ENDED
   * @param {string} agentId
   */
  markEnded(agentId) {
    this._transition(agentId, STATES.ENDED)

    if (this._signalStore) {
      this._signalStore.emit({
        dimension: DIM_COORDINATION,
        scope: agentId,
        strength: 0.2,
        emitterId: 'lifecycle-manager',
        metadata: { event: 'ended' },
      })
    }

    if (this._eventBus) {
      this._eventBus.publish('agent.lifecycle.ended', { agentId })
    }
  }

  /**
   * Get the current state of an agent
   * @param {string} agentId
   * @returns {Object|null} Agent state record or null
   */
  getState(agentId) {
    const agent = this._agents.get(agentId)
    return agent ? { ...agent } : null
  }

  /**
   * Get all agents currently in ACTIVE state
   * @returns {Object[]}
   */
  getActiveAgents() {
    const result = []
    for (const [, agent] of this._agents) {
      if (agent.state === STATES.ACTIVE) {
        result.push({ ...agent })
      }
    }
    return result
  }

  /**
   * Get statistics about agent states
   * @returns {Object} { total, idle, spawning, active, completing, ended, failed }
   */
  getStats() {
    const stats = { total: 0, idle: 0, spawning: 0, active: 0, completing: 0, ended: 0, failed: 0 }
    for (const [, agent] of this._agents) {
      stats.total++
      stats[agent.state]++
    }
    return stats
  }
}

/** Exported FSM states for external reference */
LifecycleManager.STATES = STATES

export default LifecycleManager
