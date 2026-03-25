/**
 * BudgetForecaster -- Historical cost-based budget prediction with linear regression
 *
 * Records actual task costs and predicts future costs using least-squares
 * linear regression on complexity. Reads DIM_LEARNING to adjust predictions
 * when agents are improving (learning discount).
 *
 * Produces:  (none)
 * Consumes:  DIM_LEARNING, DIM_TASK
 * Publishes: forecast.updated
 * Subscribes: budget.report.generated
 *
 * @module orchestration/adaptation/budget-forecaster
 * @version 9.0.0
 * @author DEEP-IOS
 */

import { ModuleBase } from '../../core/module-base.js'
import { DIM_LEARNING, DIM_TASK } from '../../core/field/types.js'

// ============================================================================
// Constants
// ============================================================================

const MAX_HISTORY = 200

// ============================================================================
// BudgetForecaster
// ============================================================================

export class BudgetForecaster extends ModuleBase {

  static produces()    { return [] }
  static consumes()    { return [DIM_LEARNING, DIM_TASK] }
  static publishes()   { return ['forecast.updated'] }
  static subscribes()  { return ['budget.report.generated'] }

  /**
   * @param {Object} deps
   * @param {Object} deps.field  - Signal field
   * @param {Object} deps.bus    - Event bus
   * @param {Object} [deps.store] - Persistence store
   */
  constructor({ field, bus, store, ...rest } = {}) {
    super()
    this._field = field
    this._bus   = bus
    this._store = store || null

    /** @type {Array<{ taskType: string, complexity: number, actualCost: number, timestamp: number }>} */
    this._history = []
    this._unsubscribers = []
  }

  // --------------------------------------------------------------------------
  // Core API
  // --------------------------------------------------------------------------

  /**
   * Record an actual task cost observation.
   *
   * @param {string} taskType
   * @param {number} complexity - 0 to 1
   * @param {number} actualCost - actual tokens consumed
   */
  recordActual(taskType, complexity, actualCost) {
    this._history.push({
      taskType,
      complexity,
      actualCost,
      timestamp: Date.now(),
    })

    // Cap history length
    if (this._history.length > MAX_HISTORY) {
      this._history = this._history.slice(-MAX_HISTORY)
    }
  }

  /**
   * Predict cost for a task type and complexity using linear regression
   * on historical data, with a learning discount from DIM_LEARNING.
   *
   * @param {string} taskType
   * @param {number} complexity - 0 to 1
   * @returns {{ estimatedTokens: number, confidence: number, basedOn: number }}
   */
  predictCost(taskType, complexity) {
    const filtered = this._history.filter(h => h.taskType === taskType)

    if (filtered.length < 2) {
      // Not enough data -- fallback to simple average or default
      const avg = filtered.length === 1 ? filtered[0].actualCost : 2000
      return { estimatedTokens: Math.round(avg), confidence: 0.2, basedOn: filtered.length }
    }

    // Linear regression: cost = a * complexity + b
    const points = filtered.map(h => ({ x: h.complexity, y: h.actualCost }))
    const { a, b } = this._linearRegression(points)

    let estimated = a * complexity + b
    estimated = Math.max(0, estimated)

    // Learning discount: read DIM_LEARNING signal -- if improving, apply 0.85 factor
    let learningDiscount = 1.0
    if (this._field?.read) {
      const learningSignal = this._field.read({
        dimension: DIM_LEARNING,
        sortBy:    'emitTime',
        limit:     1,
      })
      if (learningSignal?.length > 0 && learningSignal[0].strength > 0.5) {
        learningDiscount = 0.85
      }
    }

    estimated *= learningDiscount

    // Confidence based on sample size
    const confidence = Math.min(0.9, filtered.length / 30)

    return {
      estimatedTokens: Math.round(estimated),
      confidence:      Math.round(confidence * 100) / 100,
      basedOn:         filtered.length,
    }
  }

  /**
   * Project total budget for a list of remaining tasks.
   *
   * @param {Array<{ taskType: string, complexity: number }>} remainingTasks
   * @returns {{ totalEstimate: number, perTask: Array<{ taskType: string, estimatedTokens: number }>, confidence: number }}
   */
  projectBudget(remainingTasks) {
    if (!remainingTasks?.length) {
      return { totalEstimate: 0, perTask: [], confidence: 0 }
    }

    let totalEstimate   = 0
    let confidenceSum   = 0
    const perTask       = []

    for (const task of remainingTasks) {
      const prediction = this.predictCost(task.taskType, task.complexity)
      perTask.push({ taskType: task.taskType, estimatedTokens: prediction.estimatedTokens })
      totalEstimate += prediction.estimatedTokens
      confidenceSum += prediction.confidence
    }

    const avgConfidence = remainingTasks.length > 0 ? confidenceSum / remainingTasks.length : 0

    this._bus?.publish?.('forecast.updated', {
      totalEstimate,
      taskCount:  remainingTasks.length,
      confidence: Math.round(avgConfidence * 100) / 100,
      timestamp:  Date.now(),
    })

    return {
      totalEstimate,
      perTask,
      confidence: Math.round(avgConfidence * 100) / 100,
    }
  }

  /**
   * Compute prediction accuracy metrics.
   *
   * @returns {{ meanAbsoluteError: number, r2Score: number }}
   */
  getAccuracy() {
    if (this._history.length < 3) {
      return { meanAbsoluteError: Infinity, r2Score: 0 }
    }

    // Group by taskType, run leave-one-out style evaluation
    const errors  = []
    const actuals = this._history.map(h => h.actualCost)
    const mean    = actuals.reduce((s, v) => s + v, 0) / actuals.length

    let ssTot = 0
    let ssRes = 0

    for (const entry of this._history) {
      // Predict using all OTHER entries of same type
      const others = this._history.filter(
        h => h.taskType === entry.taskType && h !== entry
      )
      if (others.length < 2) continue

      const points     = others.map(h => ({ x: h.complexity, y: h.actualCost }))
      const { a, b }   = this._linearRegression(points)
      const predicted  = a * entry.complexity + b
      const error      = Math.abs(predicted - entry.actualCost)

      errors.push(error)
      ssTot += (entry.actualCost - mean) ** 2
      ssRes += (entry.actualCost - predicted) ** 2
    }

    const mae = errors.length > 0
      ? Math.round(errors.reduce((s, e) => s + e, 0) / errors.length)
      : Infinity

    const r2 = ssTot > 0
      ? Math.round((1 - ssRes / ssTot) * 10000) / 10000
      : 0

    return { meanAbsoluteError: mae, r2Score: r2 }
  }

  // --------------------------------------------------------------------------
  // Lifecycle
  // --------------------------------------------------------------------------

  async start() {
    await this.restore()
    const listen = this._bus?.on?.bind(this._bus)
    if (!listen) return

    this._unsubscribers.push(
      listen('budget.report.generated', (payload) => this._onBudgetReportGenerated(payload)),
    )
  }

  async stop() {
    for (const unsubscribe of this._unsubscribers.splice(0)) {
      unsubscribe?.()
    }
    await this.persist()
  }

  async persist() {
    if (!this._store) return
    await this._store.set?.('budget-forecaster:history', this._history)
  }

  async restore() {
    if (!this._store) return
    const data = await this._store.get?.('budget-forecaster:history')
    if (Array.isArray(data)) {
      this._history = data.slice(-MAX_HISTORY)
    }
  }

  // --------------------------------------------------------------------------
  // Internal
  // --------------------------------------------------------------------------

  /**
   * Standard least-squares linear regression: y = a*x + b
   *
   * @param {Array<{ x: number, y: number }>} points
   * @returns {{ a: number, b: number }}
   * @private
   */
  _linearRegression(points) {
    const n = points.length
    if (n < 2) return { a: 0, b: n === 1 ? points[0].y : 0 }

    let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0
    for (const p of points) {
      sumX  += p.x
      sumY  += p.y
      sumXY += p.x * p.y
      sumXX += p.x * p.x
    }

    const denom = n * sumXX - sumX * sumX
    if (Math.abs(denom) < 1e-10) {
      return { a: 0, b: sumY / n }
    }

    const a = (n * sumXY - sumX * sumY) / denom
    const b = (sumY - a * sumX) / n

    return { a, b }
  }

  _onBudgetReportGenerated(payload) {
    const report = payload?.report ?? payload
    if (!report) return

    const taskType = report?.metadata?.intent?.primary
      ?? report?.metadata?.route?.route?.name
      ?? 'workflow'
    const complexity = report?.metadata?.route?.complexity
      ?? report?.metadata?.complexity
      ?? 0.5
    const actualCost = report?.spent

    if (typeof actualCost !== 'number' || !Number.isFinite(actualCost)) return
    this.recordActual(taskType, Math.max(0, Math.min(1, complexity)), actualCost)
  }
}
