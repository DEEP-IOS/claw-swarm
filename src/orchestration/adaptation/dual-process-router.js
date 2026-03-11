/**
 * DualProcessRouter -- System 1/2 双过程路由决策
 * Dual-process routing: fast (System 1) vs thorough (System 2) based on
 * field-vector complexity scoring with adaptive threshold.
 *
 * @module orchestration/adaptation/dual-process-router
 * @version 9.0.0
 */

import { ModuleBase } from '../../core/module-base.js'
import {
  DIM_TASK,
  DIM_ALARM,
  DIM_KNOWLEDGE,
} from '../../core/field/types.js'

// ============================================================================
// Configuration & Constants
// ============================================================================

const DEFAULT_CONFIG = {
  complexityThreshold: 0.4,
  thresholdAdjustStep: 0.02,
  minThreshold: 0.2,
  maxThreshold: 0.7,
}

const ROUTING_RESULT = {
  SYSTEM_1: { name: 'fast', model: 'fast', maxAgents: 1, reviewRequired: false },
  SYSTEM_2: { name: 'thorough', model: 'strong', maxAgents: 3, reviewRequired: true },
}

// ============================================================================
// DualProcessRouter
// ============================================================================

export class DualProcessRouter extends ModuleBase {
  /** @returns {string[]} */
  static produces() { return [DIM_TASK] }
  /** @returns {string[]} */
  static consumes() { return [DIM_ALARM, DIM_TASK, DIM_KNOWLEDGE] }
  /** @returns {string[]} */
  static publishes() { return ['routing.decided'] }
  /** @returns {string[]} */
  static subscribes() { return ['intent.classified'] }

  /**
   * @param {Object} deps
   * @param {Object} deps.field  - SignalStore instance
   * @param {Object} deps.bus    - EventBus instance
   * @param {Object} [deps.config]
   */
  constructor({ field, bus, config = {} } = {}) {
    super()
    this._field = field
    this._bus = bus
    this._cfg = { ...DEFAULT_CONFIG, ...config }
    this._threshold = this._cfg.complexityThreshold

    /** @type {{ system1Count: number, system2Count: number, overrideCount: number }} */
    this._stats = { system1Count: 0, system2Count: 0, overrideCount: 0 }
  }

  async start() {}
  async stop() {}

  // ━━━ Core API ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  /**
   * Route an intent to System 1 (fast) or System 2 (thorough).
   *
   * Complexity formula:
   *   base = (1 - confidence) * 0.3
   *        + riskLevel weight (high=0.4, medium=0.2, else 0)
   *        + alarm > 0.3 => +0.2
   *        + knowledge < 0.3 => +0.1
   *
   * @param {{ confidence: number, riskLevel: string, scope?: string }} intentResult
   * @param {{ scope?: string }} [scopeEstimate]
   * @returns {{ route: Object, complexity: number, threshold: number }}
   */
  route(intentResult, scopeEstimate = {}) {
    const scope = scopeEstimate.scope || intentResult.scope || 'global'

    // Read field vector for the scope
    const vector = this._field?.superpose?.(scope) || {}
    const alarmStrength = vector[DIM_ALARM] ?? 0
    const knowledgeStrength = vector[DIM_KNOWLEDGE] ?? 0

    // Compute complexity score
    const confidence = intentResult.confidence ?? 0.5
    const risk = intentResult.riskLevel || 'low'

    let complexity = (1 - confidence) * 0.3
    if (risk === 'high') complexity += 0.4
    else if (risk === 'medium') complexity += 0.2

    if (alarmStrength > 0.3) complexity += 0.2
    if (knowledgeStrength < 0.3) complexity += 0.1

    complexity = Math.min(1, complexity)

    // Decide route
    const isSystem1 = complexity < this._threshold
    const route = isSystem1
      ? { ...ROUTING_RESULT.SYSTEM_1 }
      : { ...ROUTING_RESULT.SYSTEM_2 }

    if (isSystem1) this._stats.system1Count++
    else this._stats.system2Count++

    // Publish event
    const payload = { route, complexity, threshold: this._threshold, scope }
    this._bus?.publish?.('routing.decided', payload)

    return payload
  }

  /**
   * Adjust threshold based on outcome feedback.
   * - System 1 failure => lower threshold (be more cautious)
   * - System 2 excessive success => raise threshold (allow more fast paths)
   *
   * @param {{ system: 1|2, success: boolean }} feedback
   */
  adjustThreshold(feedback) {
    const { system, success } = feedback
    const step = this._cfg.thresholdAdjustStep

    if (system === 1 && !success) {
      // System 1 failed -- lower threshold so more goes to System 2
      this._threshold -= step
      this._stats.overrideCount++
    } else if (system === 2 && success) {
      // System 2 succeeded easily -- raise threshold
      this._threshold += step
    }

    this._threshold = Math.max(
      this._cfg.minThreshold,
      Math.min(this._cfg.maxThreshold, this._threshold),
    )
  }

  /**
   * @returns {{ system1Count: number, system2Count: number, threshold: number, overrideCount: number }}
   */
  getStats() {
    return {
      system1Count: this._stats.system1Count,
      system2Count: this._stats.system2Count,
      threshold: this._threshold,
      overrideCount: this._stats.overrideCount,
    }
  }
}
