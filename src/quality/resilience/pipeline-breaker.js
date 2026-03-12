/**
 * PipelineBreaker - DAG 执行管道超时熔断器
 * DAG execution pipeline timeout breaker
 *
 * 为每个 DAG 执行追踪时间预算，在 80% 时发出预警信号，
 * 100% 时强制熔断并通知编排层停止执行，防止无限挂起。
 *
 * @module quality/resilience/pipeline-breaker
 * @version 9.0.0
 */

import { ModuleBase } from '../../core/module-base.js'
import { DIM_ALARM, DIM_TASK, DIM_COORDINATION } from '../../core/field/types.js'

// ============================================================================
// PipelineBreaker
// ============================================================================

export class PipelineBreaker extends ModuleBase {
  // --------------------------------------------------------------------------
  // Static declarations
  // --------------------------------------------------------------------------

  static produces() { return [DIM_ALARM] }
  static consumes() { return [DIM_TASK, DIM_COORDINATION] }
  static publishes() { return ['quality.pipeline.broken'] }
  static subscribes() { return ['orchestration.deadline.warning'] }

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

    /**
     * @private
     * @type {Map<string, { startedAt: number, budgetMs: number, warningTimerId: *, breakTimerId: *, broken: boolean }>}
     */
    this._dagTimers = new Map()

    /** @private */
    this._stats = { totalTracked: 0, totalBroken: 0, totalTimeToBreak: 0 }

    /** @private @type {Function|null} */
    this._onDeadlineWarning = null
  }

  // --------------------------------------------------------------------------
  // Lifecycle
  // --------------------------------------------------------------------------

  async start() {
    this._onDeadlineWarning = (envelope) => {
      const data = envelope?.data
      if (data && data.dagId) {
        // External deadline warning — break immediately if still tracking
        const entry = this._dagTimers.get(data.dagId)
        if (entry && !entry.broken) {
          this.break(data.dagId, 'external_deadline_warning')
        }
      }
    }
    this._bus.subscribe('orchestration.deadline.warning', this._onDeadlineWarning)
  }

  async stop() {
    if (this._onDeadlineWarning) {
      this._bus.unsubscribe('orchestration.deadline.warning', this._onDeadlineWarning)
      this._onDeadlineWarning = null
    }
    this._clearAllTimers()
  }

  // --------------------------------------------------------------------------
  // Tracking
  // --------------------------------------------------------------------------

  /**
   * Start tracking a DAG execution with a time budget
   * @param {string} dagId
   * @param {number} timeBudgetMs
   */
  startTracking(dagId, timeBudgetMs) {
    // Clean up if already tracking this dag
    this.stopTracking(dagId)

    const entry = {
      startedAt: Date.now(),
      budgetMs: timeBudgetMs,
      warningTimerId: null,
      breakTimerId: null,
      broken: false,
    }

    // Warning at 80% of budget
    const warningMs = Math.floor(timeBudgetMs * 0.8)
    entry.warningTimerId = setTimeout(() => {
      if (entry.broken) return
      this._field.emit({
        dimension: DIM_ALARM,
        scope: dagId,
        strength: 0.5,
        emitterId: 'PipelineBreaker',
        metadata: {
          event: 'pipeline_warning',
          elapsed: warningMs,
          budget: timeBudgetMs,
        },
      })
    }, warningMs)

    // Break at 100% of budget
    entry.breakTimerId = setTimeout(() => {
      if (!entry.broken) {
        this.break(dagId, 'timeout')
      }
    }, timeBudgetMs)

    this._dagTimers.set(dagId, entry)
    this._stats.totalTracked++
  }

  /**
   * Force-break a DAG pipeline
   * @param {string} dagId
   * @param {string} reason
   * @returns {{ dagId: string, reason: string, elapsed: number }}
   */
  break(dagId, reason) {
    const entry = this._dagTimers.get(dagId)
    if (!entry) {
      return { dagId, reason, elapsed: 0 }
    }

    entry.broken = true

    // Clear timers
    if (entry.warningTimerId) {
      clearTimeout(entry.warningTimerId)
      entry.warningTimerId = null
    }
    if (entry.breakTimerId) {
      clearTimeout(entry.breakTimerId)
      entry.breakTimerId = null
    }

    const elapsed = Date.now() - entry.startedAt

    this._field.emit({
      dimension: DIM_ALARM,
      scope: dagId,
      strength: 1.0,
      emitterId: 'PipelineBreaker',
      metadata: {
        event: 'pipeline_broken',
        reason,
        elapsed,
        budget: entry.budgetMs,
      },
    })

    this._bus.publish('quality.pipeline.broken', {
      dagId,
      reason,
      elapsed,
      budget: entry.budgetMs,
      timestamp: Date.now(),
    }, 'PipelineBreaker')

    this._stats.totalBroken++
    this._stats.totalTimeToBreak += elapsed

    return { dagId, reason, elapsed }
  }

  /**
   * Stop tracking a DAG (normal completion)
   * @param {string} dagId
   * @returns {boolean} true if was tracking, false otherwise
   */
  stopTracking(dagId) {
    const entry = this._dagTimers.get(dagId)
    if (!entry) return false

    if (entry.warningTimerId) {
      clearTimeout(entry.warningTimerId)
      entry.warningTimerId = null
    }
    if (entry.breakTimerId) {
      clearTimeout(entry.breakTimerId)
      entry.breakTimerId = null
    }

    this._dagTimers.delete(dagId)
    return true
  }

  // --------------------------------------------------------------------------
  // Internal Helpers
  // --------------------------------------------------------------------------

  /**
   * Clear all active timers (used during stop())
   * @private
   */
  _clearAllTimers() {
    for (const [dagId, entry] of this._dagTimers) {
      if (entry.warningTimerId) clearTimeout(entry.warningTimerId)
      if (entry.breakTimerId) clearTimeout(entry.breakTimerId)
    }
    this._dagTimers.clear()
  }

  // --------------------------------------------------------------------------
  // Accessors
  // --------------------------------------------------------------------------

  /**
   * List all active DAG trackers
   * @returns {Array<{ dagId: string, startedAt: number, budgetMs: number, broken: boolean, elapsed: number }>}
   */
  getActiveTrackers() {
    const now = Date.now()
    const result = []
    for (const [dagId, entry] of this._dagTimers) {
      result.push({
        dagId,
        startedAt: entry.startedAt,
        budgetMs: entry.budgetMs,
        broken: entry.broken,
        elapsed: now - entry.startedAt,
      })
    }
    return result
  }

  /**
   * Return statistics
   * @returns {{ totalTracked: number, totalBroken: number, avgTimeToBreak: number }}
   */
  getStats() {
    const avgTimeToBreak = this._stats.totalBroken > 0
      ? Math.round(this._stats.totalTimeToBreak / this._stats.totalBroken)
      : 0

    return {
      totalTracked: this._stats.totalTracked,
      totalBroken: this._stats.totalBroken,
      avgTimeToBreak,
    }
  }
}
