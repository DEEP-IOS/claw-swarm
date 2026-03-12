/**
 * CircuitBreaker - 工具级熔断器，防止故障级联扩散
 * Tool-level circuit breaker preventing cascading failure propagation
 *
 * 实现经典三态熔断模式（CLOSED → OPEN → HALF_OPEN → CLOSED），
 * 当工具连续失败达到阈值时断路，冷却后半开探测，探测成功则恢复。
 *
 * @module quality/resilience/circuit-breaker
 * @version 9.0.0
 */

import { ModuleBase } from '../../core/module-base.js'
import { DIM_ALARM } from '../../core/field/types.js'

// ============================================================================
// CircuitBreaker
// ============================================================================

export class CircuitBreaker extends ModuleBase {
  // --------------------------------------------------------------------------
  // Static declarations
  // --------------------------------------------------------------------------

  static produces() { return [DIM_ALARM] }
  static consumes() { return [] }
  static publishes() { return ['quality.breaker.opened', 'quality.breaker.closed', 'quality.breaker.half_opened'] }
  static subscribes() { return [] }

  // --------------------------------------------------------------------------
  // Constructor
  // --------------------------------------------------------------------------

  /**
   * @param {Object} opts
   * @param {import('../../core/field/signal-store.js').SignalStore} opts.field
   * @param {import('../../core/bus/event-bus.js').EventBus} opts.bus
   * @param {Object} [opts.config={}]
   */
  constructor({ field, bus, config = {} }) {
    super()

    /** @private */ this._field = field
    /** @private */ this._bus = bus

    /** @private */ this._failureThreshold = config.failureThreshold ?? 3
    /** @private */ this._cooldownMs = config.cooldownMs ?? 30000
    /** @private */ this._halfOpenSuccesses = config.halfOpenSuccesses ?? 2

    /**
     * @private
     * @type {Map<string, {state: string, failureCount: number, successCount: number, lastFailureAt: number, openedAt: number}>}
     */
    this._breakers = new Map()

    /** @private */
    this._stats = { totalTrips: 0 }
  }

  // --------------------------------------------------------------------------
  // Core Methods
  // --------------------------------------------------------------------------

  /**
   * Check if a tool is allowed to execute under the current breaker state
   * @param {string} toolName
   * @returns {{ allowed: boolean, state: string, retryAfterMs?: number }}
   */
  canExecute(toolName) {
    const breaker = this._getOrCreate(toolName)

    switch (breaker.state) {
      case 'CLOSED':
        return { allowed: true, state: 'CLOSED' }

      case 'OPEN': {
        const elapsed = Date.now() - breaker.openedAt
        if (elapsed >= this._cooldownMs) {
          // Cooldown expired — transition to HALF_OPEN
          breaker.state = 'HALF_OPEN'
          breaker.successCount = 0
          this._bus.publish('quality.breaker.half_opened', {
            toolName,
            cooldownElapsed: elapsed,
            timestamp: Date.now(),
          }, 'CircuitBreaker')
          return { allowed: true, state: 'HALF_OPEN' }
        }
        const remaining = this._cooldownMs - elapsed
        return { allowed: false, state: 'OPEN', retryAfterMs: remaining }
      }

      case 'HALF_OPEN':
        return { allowed: true, state: 'HALF_OPEN' }

      default:
        return { allowed: true, state: 'CLOSED' }
    }
  }

  /**
   * Record a successful tool execution
   * @param {string} toolName
   */
  recordSuccess(toolName) {
    const breaker = this._getOrCreate(toolName)

    switch (breaker.state) {
      case 'CLOSED':
        breaker.failureCount = 0
        break

      case 'HALF_OPEN':
        breaker.successCount++
        if (breaker.successCount >= this._halfOpenSuccesses) {
          // Enough successful probes — close the breaker
          breaker.state = 'CLOSED'
          breaker.failureCount = 0
          breaker.successCount = 0
          this._bus.publish('quality.breaker.closed', {
            toolName,
            timestamp: Date.now(),
          }, 'CircuitBreaker')
        }
        break
    }
  }

  /**
   * Record a tool execution failure
   * @param {string} toolName
   */
  recordFailure(toolName) {
    const breaker = this._getOrCreate(toolName)

    switch (breaker.state) {
      case 'CLOSED':
        breaker.failureCount++
        breaker.lastFailureAt = Date.now()
        if (breaker.failureCount >= this._failureThreshold) {
          this._tripBreaker(breaker, toolName)
        }
        break

      case 'HALF_OPEN':
        // Probe failed — immediately reopen
        this._tripBreaker(breaker, toolName)
        break
    }
  }

  // --------------------------------------------------------------------------
  // State Accessors
  // --------------------------------------------------------------------------

  /**
   * Get the current state of a specific breaker
   * @param {string} toolName
   * @returns {{ state: string, failureCount: number, successCount: number, lastFailureAt: number, openedAt: number }}
   */
  getState(toolName) {
    return { ...this._getOrCreate(toolName) }
  }

  /**
   * Get all breaker states as a plain object
   * @returns {Object<string, Object>}
   */
  getAllStates() {
    const result = {}
    for (const [name, state] of this._breakers) {
      result[name] = { ...state }
    }
    return result
  }

  /**
   * Force-reset a breaker to CLOSED state
   * @param {string} toolName
   */
  reset(toolName) {
    this._breakers.set(toolName, this._createBreakerState())
  }

  /**
   * Return aggregate statistics
   * @returns {{ totalTrips: number, breakersByState: Object<string, number> }}
   */
  getStats() {
    const breakersByState = { CLOSED: 0, OPEN: 0, HALF_OPEN: 0 }
    for (const [, state] of this._breakers) {
      breakersByState[state.state] = (breakersByState[state.state] || 0) + 1
    }
    return {
      totalTrips: this._stats.totalTrips,
      breakersByState,
    }
  }

  // --------------------------------------------------------------------------
  // Internal Helpers
  // --------------------------------------------------------------------------

  /**
   * Get existing breaker state or create a new CLOSED one
   * @private
   * @param {string} toolName
   * @returns {{ state: string, failureCount: number, successCount: number, lastFailureAt: number, openedAt: number }}
   */
  _getOrCreate(toolName) {
    let breaker = this._breakers.get(toolName)
    if (!breaker) {
      breaker = this._createBreakerState()
      this._breakers.set(toolName, breaker)
    }
    return breaker
  }

  /**
   * Create a fresh CLOSED breaker state
   * @private
   * @returns {{ state: string, failureCount: number, successCount: number, lastFailureAt: number, openedAt: number }}
   */
  _createBreakerState() {
    return {
      state: 'CLOSED',
      failureCount: 0,
      successCount: 0,
      lastFailureAt: 0,
      openedAt: 0,
    }
  }

  /**
   * Trip the breaker to OPEN state, emit alarm and publish event
   * @private
   * @param {Object} breaker
   * @param {string} toolName
   */
  _tripBreaker(breaker, toolName) {
    breaker.state = 'OPEN'
    breaker.openedAt = Date.now()
    breaker.successCount = 0
    this._stats.totalTrips++

    this._field.emit({
      dimension: DIM_ALARM,
      scope: toolName,
      strength: 0.8,
      emitterId: 'CircuitBreaker',
      metadata: { event: 'breaker_opened', failureCount: breaker.failureCount },
    })

    this._bus.publish('quality.breaker.opened', {
      toolName,
      failureCount: breaker.failureCount,
      timestamp: Date.now(),
    }, 'CircuitBreaker')
  }
}
