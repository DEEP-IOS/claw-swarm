/**
 * DeadlineTracker -- 截止时间追踪与预警器
 * Tracks per-DAG time budgets (total and per-phase), emits warnings
 * when 90% consumed and DIM_ALARM signals when exceeded. Reads
 * DIM_LEARNING to adaptively adjust remaining-time estimates.
 *
 * @module orchestration/scheduling/deadline-tracker
 * @version 9.0.0
 */

import { ModuleBase } from '../../core/module-base.js'
import { DIM_ALARM, DIM_LEARNING, DIM_TASK } from '../../core/field/types.js'

/** Fraction of budget at which a warning is emitted */
const WARNING_THRESHOLD = 0.9

/**
 * @typedef {Object} DeadlineEntry
 * @property {number} totalBudgetMs             - total time budget (ms)
 * @property {number} startedAt                 - epoch ms when deadline was set
 * @property {Object<string, number>} phaseBudgets - phase name -> budget ms
 * @property {Object<string, number>} phaseActuals - phase name -> actual ms
 * @property {boolean} warningEmitted           - whether the 90% warning fired
 * @property {boolean} exceededEmitted          - whether the 100% event fired
 */

// ── main class ─────────────────────────────────────────────────────

export class DeadlineTracker extends ModuleBase {
  /** @returns {string[]} */
  static produces() { return [DIM_ALARM] }
  /** @returns {string[]} */
  static consumes() { return [DIM_LEARNING, DIM_TASK] }
  /** @returns {string[]} */
  static publishes() { return ['deadline.warning', 'deadline.exceeded'] }
  /** @returns {string[]} */
  static subscribes() { return ['dag.created', 'dag.phase.completed'] }

  /**
   * @param {Object} opts
   * @param {Object} opts.field - SignalField / SignalStore instance
   * @param {Object} opts.bus   - EventBus instance
   */
  constructor({ field, bus }) {
    super()
    /** @private */ this._field = field
    /** @private */ this._bus = bus

    /** @private @type {Map<string, DeadlineEntry>} dagId -> entry */
    this._deadlines = new Map()
  }

  // ════════════════════════════════════════════════════════════════
  //  PUBLIC API
  // ════════════════════════════════════════════════════════════════

  /**
   * Set (or reset) a deadline for a DAG.
   *
   * @param {string}  dagId         - DAG identifier
   * @param {number}  totalBudgetMs - total allowed time in ms
   * @param {Object<string, number>} [phaseBudgets] - per-phase budgets
   */
  setDeadline(dagId, totalBudgetMs, phaseBudgets) {
    this._deadlines.set(dagId, {
      totalBudgetMs,
      startedAt: Date.now(),
      phaseBudgets: phaseBudgets ?? {},
      phaseActuals: {},
      warningEmitted: false,
      exceededEmitted: false,
    })
  }

  /**
   * Check whether a DAG is overdue.
   *
   * Side-effects:
   *   - emits 'deadline.warning' when > 90% consumed
   *   - emits 'deadline.exceeded' + DIM_ALARM when > 100%
   *
   * @param {string} dagId
   * @returns {{ overdue: boolean, remaining: number, overduePhases: string[] }}
   */
  checkOverdue(dagId) {
    const entry = this._deadlines.get(dagId)
    if (!entry) return { overdue: false, remaining: Infinity, overduePhases: [] }

    const elapsed = Date.now() - entry.startedAt
    const remaining = entry.totalBudgetMs - elapsed
    const fraction = elapsed / entry.totalBudgetMs

    // Per-phase overdue check
    const overduePhases = []
    for (const [phase, budget] of Object.entries(entry.phaseBudgets)) {
      const actual = entry.phaseActuals[phase]
      if (typeof actual === 'number' && actual > budget) {
        overduePhases.push(phase)
      }
    }

    // 90% warning
    if (fraction >= WARNING_THRESHOLD && !entry.warningEmitted) {
      entry.warningEmitted = true
      if (typeof this._bus?.publish === 'function') {
        this._bus.publish('deadline.warning', {
          dagId, elapsed, totalBudgetMs: entry.totalBudgetMs,
          fraction: +fraction.toFixed(3), remaining,
        })
      }
    }

    // 100% exceeded
    const overdue = fraction >= 1
    if (overdue && !entry.exceededEmitted) {
      entry.exceededEmitted = true
      if (typeof this._bus?.publish === 'function') {
        this._bus.publish('deadline.exceeded', {
          dagId, elapsed, totalBudgetMs: entry.totalBudgetMs, overduePhases,
        })
      }
      // Emit DIM_ALARM signal
      if (typeof this._field?.emit === 'function') {
        this._field.emit({
          dimension: DIM_ALARM,
          scope: dagId,
          strength: Math.min(fraction, 1),
          emitterId: 'deadline-tracker',
          metadata: { overdueMs: elapsed - entry.totalBudgetMs },
        })
      }
    }

    return { overdue, remaining: Math.max(remaining, 0), overduePhases }
  }

  /**
   * Estimate remaining time using DIM_LEARNING to adjust predictions.
   *
   * If learning signal is strong, the estimate is more optimistic
   * (the agent is getting faster). Otherwise, raw linear projection.
   *
   * @param {string} dagId
   * @returns {number} estimated remaining ms (>= 0)
   */
  estimateRemaining(dagId) {
    const entry = this._deadlines.get(dagId)
    if (!entry) return 0

    const elapsed = Date.now() - entry.startedAt
    const rawRemaining = Math.max(entry.totalBudgetMs - elapsed, 0)

    // Read DIM_LEARNING to adjust
    let learningFactor = 1.0
    if (typeof this._field?.query === 'function') {
      try {
        const r = this._field.query({ scope: dagId, dimension: DIM_LEARNING, limit: 1 })
        let strength = 0
        if (Array.isArray(r) && r.length > 0 && typeof r[0].strength === 'number') {
          strength = r[0].strength
        } else if (typeof r === 'number') {
          strength = r
        }
        // Higher learning -> faster completion expected -> multiply remaining by reduction
        learningFactor = 1 - strength * 0.3  // [0.7, 1.0]
      } catch (_) { /* ignore */ }
    }

    return Math.max(Math.round(rawRemaining * learningFactor), 0)
  }

  /**
   * Record that a phase completed, storing its actual duration.
   *
   * @param {string} dagId
   * @param {string} phase            - phase name
   * @param {number} actualDurationMs - how long the phase actually took
   */
  recordPhaseCompletion(dagId, phase, actualDurationMs) {
    const entry = this._deadlines.get(dagId)
    if (!entry) return

    entry.phaseActuals[phase] = actualDurationMs
  }

  /**
   * Get full status for a DAG deadline.
   *
   * @param {string} dagId
   * @returns {Object|null} status or null if no deadline set
   */
  getDeadlineStatus(dagId) {
    const entry = this._deadlines.get(dagId)
    if (!entry) return null

    const elapsed = Date.now() - entry.startedAt
    return {
      dagId,
      totalBudgetMs: entry.totalBudgetMs,
      elapsed,
      remaining: Math.max(entry.totalBudgetMs - elapsed, 0),
      fraction: +(elapsed / entry.totalBudgetMs).toFixed(4),
      phaseBudgets: { ...entry.phaseBudgets },
      phaseActuals: { ...entry.phaseActuals },
      warningEmitted: entry.warningEmitted,
      exceededEmitted: entry.exceededEmitted,
    }
  }
}

export default DeadlineTracker
