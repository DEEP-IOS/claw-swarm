/**
 * GlobalModulator -- Exploit/Explore 全局调节器
 * Dynamically switches between EXPLOIT and EXPLORE modes based on
 * recent success rate (EMA) and task novelty (Shannon entropy).
 *
 * @module orchestration/adaptation/global-modulator
 * @version 9.0.0
 */

import { ModuleBase } from '../../core/module-base.js'
import {
  DIM_COORDINATION,
  DIM_TRAIL,
  DIM_ALARM,
  DIM_REPUTATION,
} from '../../core/field/types.js'

// ============================================================================
// Constants
// ============================================================================

const MODES = {
  EXPLOIT: { name: 'exploit', modelBias: 'prefer_proven', explorationRate: 0.1 },
  EXPLORE: { name: 'explore', modelBias: 'prefer_novel', explorationRate: 0.4 },
}

/** EMA smoothing factor */
const EMA_ALPHA = 0.2

/** Max task history entries for novelty calculation */
const MAX_HISTORY = 20

// ============================================================================
// GlobalModulator
// ============================================================================

export class GlobalModulator extends ModuleBase {
  /** @returns {string[]} */
  static produces() { return [DIM_COORDINATION] }
  /** @returns {string[]} */
  static consumes() { return [DIM_TRAIL, DIM_ALARM, DIM_REPUTATION] }
  /** @returns {string[]} */
  static publishes() { return ['modulator.mode.changed'] }
  /** @returns {string[]} */
  static subscribes() { return ['agent.completed', 'agent.failed'] }

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

    /** @type {'EXPLOIT'|'EXPLORE'} */
    this._mode = 'EXPLOIT'
    /** @type {number} EMA of recent success rate [0, 1] */
    this._recentSuccessRate = 0.5
    /** @type {string[]} recent task types (sliding window) */
    this._taskHistory = []
    /** @type {number} total mode changes */
    this._modeChanges = 0
  }

  async start() {}
  async stop() {}

  // ━━━ Core API ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  /**
   * Record an outcome and potentially switch modes.
   * @param {boolean} success
   * @param {string} taskType
   */
  recordOutcome(success, taskType) {
    // Update EMA success rate
    const value = success ? 1.0 : 0.0
    this._recentSuccessRate =
      EMA_ALPHA * value + (1 - EMA_ALPHA) * this._recentSuccessRate

    // Record task type in sliding window
    this._taskHistory.push(taskType)
    if (this._taskHistory.length > MAX_HISTORY) {
      this._taskHistory.shift()
    }

    this.updateMode()
  }

  /**
   * Evaluate current signals and decide whether to switch mode.
   * - successRate > 0.7 AND novelty < 0.3 => EXPLOIT
   * - successRate < 0.4 OR novelty > 0.7  => EXPLORE
   */
  updateMode() {
    const novelty = this._computeNovelty()
    const prev = this._mode
    let next = prev

    if (this._recentSuccessRate > 0.7 && novelty < 0.3) {
      next = 'EXPLOIT'
    } else if (this._recentSuccessRate < 0.4 || novelty > 0.7) {
      next = 'EXPLORE'
    }

    if (next !== prev) {
      this._mode = next
      this._modeChanges++

      // Emit coordination signal into the field
      this._field?.emit?.({
        dimension: DIM_COORDINATION,
        scope: 'global',
        strength: next === 'EXPLORE' ? 0.8 : 0.3,
        emitterId: 'global-modulator',
        metadata: { mode: next, successRate: this._recentSuccessRate, novelty },
      })

      // Publish bus event
      this._bus?.publish?.('modulator.mode.changed', {
        from: prev,
        to: next,
        successRate: this._recentSuccessRate,
        novelty,
        timestamp: Date.now(),
      })
    }
  }

  /**
   * Compute novelty score from recent task type distribution using
   * Shannon entropy normalized to [0, 1].
   * @returns {number} novelty in [0, 1]
   * @private
   */
  _computeNovelty() {
    if (this._taskHistory.length === 0) return 0.5

    // Count frequencies
    const freq = new Map()
    for (const t of this._taskHistory) {
      freq.set(t, (freq.get(t) || 0) + 1)
    }

    const n = this._taskHistory.length
    const uniqueTypes = freq.size
    if (uniqueTypes <= 1) return 0.0 // all same type => no novelty

    // Shannon entropy: H = -sum(p * log2(p))
    let entropy = 0
    for (const count of freq.values()) {
      const p = count / n
      if (p > 0) entropy -= p * Math.log2(p)
    }

    // Normalize by max possible entropy (log2 of unique count)
    const maxEntropy = Math.log2(uniqueTypes)
    return maxEntropy > 0 ? entropy / maxEntropy : 0
  }

  /** @returns {'EXPLOIT'|'EXPLORE'} */
  getMode() { return this._mode }

  /** @returns {number} */
  getExplorationRate() { return MODES[this._mode].explorationRate }

  /**
   * @returns {{ mode: string, explorationRate: number, successRate: number,
   *             modeChanges: number, historySize: number }}
   */
  getStats() {
    return {
      mode: this._mode,
      explorationRate: MODES[this._mode].explorationRate,
      successRate: Math.round(this._recentSuccessRate * 1000) / 1000,
      modeChanges: this._modeChanges,
      historySize: this._taskHistory.length,
    }
  }
}
