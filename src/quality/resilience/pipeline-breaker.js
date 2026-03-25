/**
 * PipelineBreaker - DAG execution pipeline timeout breaker.
 *
 * Tracks time budgets for active DAGs, emits a warning signal at 80% budget,
 * and force-breaks the pipeline at 100%. It also listens to orchestration
 * deadline events so externally detected overruns can trip the breaker
 * without relying on local timers alone.
 *
 * @module quality/resilience/pipeline-breaker
 * @version 9.0.0
 */

import { ModuleBase } from '../../core/module-base.js'
import { DIM_ALARM, DIM_TASK, DIM_COORDINATION } from '../../core/field/types.js'

export class PipelineBreaker extends ModuleBase {
  static produces() { return [DIM_ALARM] }
  static consumes() { return [DIM_TASK, DIM_COORDINATION] }
  static publishes() { return ['quality.pipeline.broken'] }
  static subscribes() { return ['deadline.warning', 'deadline.exceeded'] }

  /**
   * @param {Object} opts
   * @param {import('../../core/field/signal-store.js').SignalStore} opts.field
   * @param {import('../../core/bus/event-bus.js').EventBus} opts.bus
   * @param {Object} [opts.config={}]
   */
  constructor({ field, bus, config = {} }) {
    super()

    this._field = field
    this._bus = bus

    /**
     * @private
     * @type {Map<string, { startedAt: number, budgetMs: number, warningTimerId: *, breakTimerId: *, broken: boolean }>}
     */
    this._dagTimers = new Map()

    /** @private */
    this._stats = { totalTracked: 0, totalBroken: 0, totalTimeToBreak: 0 }

    /** @private @type {Function|null} */
    this._onDeadlineWarning = null
    /** @private @type {Function|null} */
    this._onDeadlineExceeded = null
    /** @private @type {Function|null} */
    this._warnUnsub = null
    /** @private @type {Function|null} */
    this._exceededUnsub = null
  }

  async start() {
    this._onDeadlineWarning = (payload) => {
      if (!payload?.dagId) return
      const entry = this._dagTimers.get(payload.dagId)
      if (!entry || entry.broken) return

      this._field?.emit?.({
        dimension: DIM_ALARM,
        scope: payload.dagId,
        strength: 0.5,
        emitterId: 'PipelineBreaker',
        metadata: {
          event: 'pipeline_warning',
          reason: 'external_deadline_warning',
          budget: entry.budgetMs,
        },
      })
    }

    this._onDeadlineExceeded = (payload) => {
      if (!payload?.dagId) return
      const entry = this._dagTimers.get(payload.dagId)
      if (!entry || entry.broken) return
      this.break(payload.dagId, 'external_deadline_exceeded')
    }

    if (typeof this._bus?.on === 'function') {
      this._warnUnsub = this._bus.on('deadline.warning', this._onDeadlineWarning)
      this._exceededUnsub = this._bus.on('deadline.exceeded', this._onDeadlineExceeded)
      return
    }

    this._bus?.subscribe?.('deadline.warning', this._onDeadlineWarning)
    this._bus?.subscribe?.('deadline.exceeded', this._onDeadlineExceeded)
  }

  async stop() {
    this._warnUnsub?.()
    this._warnUnsub = null
    this._exceededUnsub?.()
    this._exceededUnsub = null

    if (this._onDeadlineWarning) {
      this._bus?.unsubscribe?.('deadline.warning', this._onDeadlineWarning)
      this._onDeadlineWarning = null
    }
    if (this._onDeadlineExceeded) {
      this._bus?.unsubscribe?.('deadline.exceeded', this._onDeadlineExceeded)
      this._onDeadlineExceeded = null
    }

    this._clearAllTimers()
  }

  /**
   * Start tracking a DAG execution with a time budget.
   * @param {string} dagId
   * @param {number} timeBudgetMs
   */
  startTracking(dagId, timeBudgetMs) {
    this.stopTracking(dagId)

    const entry = {
      startedAt: Date.now(),
      budgetMs: timeBudgetMs,
      warningTimerId: null,
      breakTimerId: null,
      broken: false,
    }

    const warningMs = Math.floor(timeBudgetMs * 0.8)
    entry.warningTimerId = setTimeout(() => {
      if (entry.broken) return
      this._field?.emit?.({
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

    entry.breakTimerId = setTimeout(() => {
      if (!entry.broken) {
        this.break(dagId, 'timeout')
      }
    }, timeBudgetMs)

    this._dagTimers.set(dagId, entry)
    this._stats.totalTracked++
  }

  /**
   * Force-break a DAG pipeline.
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

    if (entry.warningTimerId) {
      clearTimeout(entry.warningTimerId)
      entry.warningTimerId = null
    }
    if (entry.breakTimerId) {
      clearTimeout(entry.breakTimerId)
      entry.breakTimerId = null
    }

    const elapsed = Date.now() - entry.startedAt

    this._field?.emit?.({
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

    this._bus?.publish?.('quality.pipeline.broken', {
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
   * Stop tracking a DAG (normal completion).
   * @param {string} dagId
   * @returns {boolean}
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

  /** @private */
  _clearAllTimers() {
    for (const [, entry] of this._dagTimers) {
      if (entry.warningTimerId) clearTimeout(entry.warningTimerId)
      if (entry.breakTimerId) clearTimeout(entry.breakTimerId)
    }
    this._dagTimers.clear()
  }

  /**
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

export default PipelineBreaker
