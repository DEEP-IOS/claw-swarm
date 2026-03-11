/**
 * ResponseThreshold -- 角色激活阈值自适应管理
 * Per-role activation thresholds that adapt based on outcome feedback,
 * reputation signals, and learning trajectory.
 *
 * @module orchestration/adaptation/response-threshold
 * @version 9.0.0
 */

import { ModuleBase } from '../../core/module-base.js'
import {
  DIM_COORDINATION,
  DIM_REPUTATION,
  DIM_LEARNING,
} from '../../core/field/types.js'

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_THRESHOLD = 0.5
const MIN_THRESHOLD = 0.1
const MAX_THRESHOLD = 0.9

/** Adjustment deltas */
const SUCCESS_DELTA = -0.02
const FAILURE_DELTA = +0.05
const HIGH_REPUTATION_BONUS = -0.01   // reputation > 0.8
const LOW_REPUTATION_PENALTY = +0.02  // reputation < 0.3
const LEARNING_IMPROVING_BONUS = -0.01
const LEARNING_DECLINING_PENALTY = +0.01

// ============================================================================
// ResponseThreshold
// ============================================================================

export class ResponseThreshold extends ModuleBase {
  /** @returns {string[]} */
  static produces() { return [DIM_COORDINATION] }
  /** @returns {string[]} */
  static consumes() { return [DIM_REPUTATION, DIM_LEARNING] }
  /** @returns {string[]} */
  static publishes() { return ['threshold.adjusted'] }
  /** @returns {string[]} */
  static subscribes() { return ['agent.completed', 'agent.failed'] }

  /**
   * @param {Object} deps
   * @param {Object} deps.field - SignalStore instance
   * @param {Object} deps.bus   - EventBus instance
   * @param {Object} [deps.store] - DomainStore instance for persistence
   */
  constructor({ field, bus, store } = {}) {
    super()
    this._field = field
    this._bus = bus
    this._store = store

    /** @type {Map<string, { value: number, lastAdjusted: number, adjustCount: number }>} */
    this._thresholds = new Map()
  }

  async start() {
    await this.restore()
  }

  async stop() {
    await this.persist()
  }

  // ━━━ Core API ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  /**
   * Get the current threshold for a role. Initializes to DEFAULT if absent.
   * @param {string} roleId
   * @returns {number}
   */
  getThreshold(roleId) {
    if (!this._thresholds.has(roleId)) {
      this._thresholds.set(roleId, {
        value: DEFAULT_THRESHOLD,
        lastAdjusted: Date.now(),
        adjustCount: 0,
      })
    }
    return this._thresholds.get(roleId).value
  }

  /**
   * Check whether a role should be activated given the current field strength.
   * @param {string} roleId
   * @param {number} fieldStrength - aggregated field strength for this role
   * @returns {boolean}
   */
  isActivatable(roleId, fieldStrength) {
    return fieldStrength >= this.getThreshold(roleId)
  }

  /**
   * Record task outcome and adjust threshold for a role.
   * Reads DIM_REPUTATION and DIM_LEARNING from the field for fine-tuning.
   *
   * @param {string} roleId
   * @param {boolean} success
   */
  recordOutcome(roleId, success) {
    const entry = this._thresholds.get(roleId) || {
      value: DEFAULT_THRESHOLD,
      lastAdjusted: Date.now(),
      adjustCount: 0,
    }

    // Base adjustment
    let delta = success ? SUCCESS_DELTA : FAILURE_DELTA

    // Read field signals for the role scope
    const vector = this._field?.superpose?.(roleId) || {}
    const reputation = vector[DIM_REPUTATION] ?? 0.5
    const learning = vector[DIM_LEARNING] ?? 0.5

    // Reputation modifiers
    if (reputation > 0.8) delta += HIGH_REPUTATION_BONUS
    else if (reputation < 0.3) delta += LOW_REPUTATION_PENALTY

    // Learning trajectory modifiers
    if (learning > 0.6) delta += LEARNING_IMPROVING_BONUS
    else if (learning < 0.3) delta += LEARNING_DECLINING_PENALTY

    // Apply and clamp
    entry.value = Math.max(MIN_THRESHOLD, Math.min(MAX_THRESHOLD, entry.value + delta))
    entry.lastAdjusted = Date.now()
    entry.adjustCount++
    this._thresholds.set(roleId, entry)

    // Emit coordination signal into the field
    this._field?.emit?.({
      dimension: DIM_COORDINATION,
      scope: roleId,
      strength: 1 - entry.value, // lower threshold => stronger coordination signal
      emitterId: 'response-threshold',
      metadata: { roleId, threshold: entry.value, success },
    })

    // Publish event
    this._bus?.publish?.('threshold.adjusted', {
      roleId,
      threshold: entry.value,
      delta,
      success,
      reputation,
      learning,
      adjustCount: entry.adjustCount,
      timestamp: Date.now(),
    })
  }

  /**
   * @returns {Object<string, { value: number, lastAdjusted: number, adjustCount: number }>}
   */
  getAllThresholds() {
    return Object.fromEntries(this._thresholds)
  }

  /**
   * Reset a specific role to default threshold.
   * @param {string} roleId
   */
  reset(roleId) {
    this._thresholds.set(roleId, {
      value: DEFAULT_THRESHOLD,
      lastAdjusted: Date.now(),
      adjustCount: 0,
    })
  }

  /**
   * Persist thresholds to the domain store.
   */
  async persist() {
    if (!this._store) return
    const data = Object.fromEntries(this._thresholds)
    this._store.put?.('response-threshold', 'thresholds', data)
  }

  /**
   * Restore thresholds from the domain store.
   */
  async restore() {
    if (!this._store) return
    const data = this._store.get?.('response-threshold', 'thresholds')
    if (data && typeof data === 'object') {
      for (const [roleId, entry] of Object.entries(data)) {
        this._thresholds.set(roleId, entry)
      }
    }
  }
}
