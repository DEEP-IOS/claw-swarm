/**
 * SignalCalibrator -- 互信息驱动的信号维度权重自校准
 * Mutual-information-driven auto-calibration of signal dimension weights.
 * Observes field snapshots correlated with task outcomes and computes MI
 * to determine how predictive each dimension is of success/failure.
 *
 * @module orchestration/adaptation/signal-calibrator
 * @version 9.0.0
 */

import { ModuleBase } from '../../core/module-base.js'
import {
  DIM_CALIBRATION,
  DIM_TRAIL,
  DIM_ALARM,
  DIM_REPUTATION,
  DIM_TASK,
  DIM_KNOWLEDGE,
  DIM_COORDINATION,
} from '../../core/field/types.js'

// ============================================================================
// Configuration
// ============================================================================

const DEFAULT_CONFIG = {
  calibrationInterval: 10,
  maxObservations: 100,
  minWeight: 0.5,
  maxWeight: 1.5,
}

/** Epsilon to prevent log(0) */
const EPSILON = 1e-10

// ============================================================================
// SignalCalibrator
// ============================================================================

export class SignalCalibrator extends ModuleBase {
  /** @returns {string[]} meta-level dimension */
  static produces() { return [DIM_CALIBRATION] }
  /** @returns {string[]} */
  static consumes() {
    return [DIM_TRAIL, DIM_ALARM, DIM_REPUTATION, DIM_TASK, DIM_KNOWLEDGE, DIM_COORDINATION]
  }
  /** @returns {string[]} */
  static publishes() { return ['calibration.completed'] }
  /** @returns {string[]} */
  static subscribes() { return ['dag.completed'] }

  /**
   * @param {Object} deps
   * @param {Object} deps.field   - SignalStore instance
   * @param {Object} deps.bus     - EventBus instance
   * @param {Object} [deps.store] - DomainStore instance for persistence
   * @param {Object} [deps.config]
   */
  constructor({ field, bus, store, config = {} } = {}) {
    super()
    this._field = field
    this._bus = bus
    this._store = store
    this._cfg = { ...DEFAULT_CONFIG, ...config }

    /** @type {Array<{ fieldSnapshot: Object, outcome: boolean }>} */
    this._observations = []

    /** @type {Object<string, number>} dimension -> weight */
    this._weights = {}

    /** @type {Map<string, number>} dimension -> MI score */
    this._miScores = new Map()
  }

  async start() {
    await this.restore()
  }

  async stop() {
    await this.persist()
  }

  // ━━━ Core API ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  /**
   * Record a field snapshot paired with a task outcome.
   * Triggers auto-calibration every `calibrationInterval` observations.
   *
   * @param {Object} fieldSnapshot - { dimension: strength } mapping
   * @param {boolean} outcome - true = success, false = failure
   */
  recordObservation(fieldSnapshot, outcome) {
    this._observations.push({ fieldSnapshot, outcome })

    // Evict oldest when exceeding capacity
    if (this._observations.length > this._cfg.maxObservations) {
      this._observations.shift()
    }

    // Auto-calibrate at interval
    if (this._observations.length % this._cfg.calibrationInterval === 0) {
      this.calibrate()
    }
  }

  /**
   * Compute mutual information between each consumed dimension's signal
   * strength and task outcome, then derive dimension weights.
   *
   * MI algorithm:
   *   1. For each dimension, binarize values (> median = high, else low)
   *   2. Compute joint and marginal probabilities
   *   3. MI = sum P(x,y) * log2(P(x,y) / (P(x)*P(y)))
   *   4. Normalize MI to [minWeight, maxWeight]
   *
   * @returns {{ weights: Object, miScores: Object, sampleSize: number }}
   */
  calibrate() {
    const consumed = SignalCalibrator.consumes()
    const n = this._observations.length
    if (n === 0) return { weights: { ...this._weights }, miScores: {}, sampleSize: 0 }

    // Extract outcome array: success = 1, failure = 0
    const outcomes = this._observations.map((o) => o.outcome ? 1 : 0)

    // Compute MI per dimension
    let maxMI = 0
    const rawMI = {}

    for (const dim of consumed) {
      const values = this._observations.map((o) => o.fieldSnapshot[dim] ?? 0)
      const mi = this._computeMI(values, outcomes, n)
      rawMI[dim] = mi
      this._miScores.set(dim, mi)
      if (mi > maxMI) maxMI = mi
    }

    // Normalize MI -> weights in [minWeight, maxWeight]
    const { minWeight, maxWeight } = this._cfg
    for (const dim of consumed) {
      if (maxMI > 0) {
        this._weights[dim] = minWeight + (rawMI[dim] / maxMI) * (maxWeight - minWeight)
      } else {
        this._weights[dim] = 1.0 // no data => neutral weight
      }
    }

    // Emit calibration signal into the field
    this._field?.emit?.({
      dimension: DIM_CALIBRATION,
      scope: 'global',
      strength: 0.7,
      emitterId: 'signal-calibrator',
      metadata: { weights: { ...this._weights }, sampleSize: n },
    })

    // Publish event
    const result = {
      weights: { ...this._weights },
      miScores: Object.fromEntries(this._miScores),
      sampleSize: n,
    }
    this._bus?.publish?.('calibration.completed', result)

    return result
  }

  /** @returns {Object<string, number>} dimension -> weight */
  getWeights() { return { ...this._weights } }

  /** @returns {Object<string, number>} dimension -> MI score */
  getMIScores() { return Object.fromEntries(this._miScores) }

  // ━━━ Persistence ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  async persist() {
    if (!this._store) return
    this._store.put?.('signal-calibrator', 'state', {
      weights: this._weights,
      miScores: Object.fromEntries(this._miScores),
      observationCount: this._observations.length,
    })
  }

  async restore() {
    if (!this._store) return
    const data = this._store.get?.('signal-calibrator', 'state')
    if (data && typeof data === 'object') {
      if (data.weights) this._weights = { ...data.weights }
      if (data.miScores) {
        this._miScores = new Map(Object.entries(data.miScores))
      }
    }
  }

  // ━━━ Internal: Mutual Information ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  /**
   * Compute MI(X;Y) where X = binarized dimension values, Y = outcome.
   *
   * @param {number[]} values  - raw dimension strengths
   * @param {number[]} outcomes - 0/1 array
   * @param {number} n - sample count
   * @returns {number} mutual information in bits
   * @private
   */
  _computeMI(values, outcomes, n) {
    if (n < 2) return 0

    // Find median for binarization
    const sorted = [...values].sort((a, b) => a - b)
    const median = sorted[Math.floor(n / 2)]

    // Binarize: high = 1 (> median), low = 0
    const bins = values.map((v) => v > median ? 1 : 0)

    // Count joint and marginal frequencies
    // x in {0=low, 1=high}, y in {0=failure, 1=success}
    const joint = [[0, 0], [0, 0]] // joint[x][y]
    const xCount = [0, 0]
    const yCount = [0, 0]

    for (let i = 0; i < n; i++) {
      const x = bins[i]
      const y = outcomes[i]
      joint[x][y]++
      xCount[x]++
      yCount[y]++
    }

    // MI = sum over x,y of P(x,y) * log2(P(x,y) / (P(x)*P(y)))
    let mi = 0
    for (let x = 0; x <= 1; x++) {
      for (let y = 0; y <= 1; y++) {
        const pxy = joint[x][y] / n
        const px = xCount[x] / n
        const py = yCount[y] / n

        if (pxy > EPSILON && px > EPSILON && py > EPSILON) {
          mi += pxy * Math.log2(pxy / (px * py))
        }
      }
    }

    return Math.max(0, mi)
  }
}
