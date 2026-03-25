/**
 * DeadlineTracker
 *
 * Tracks per-DAG time budgets, emits warnings when 90% is consumed, and
 * raises an alarm when the budget is exceeded. The tracker now wires itself
 * to live orchestration events instead of only exposing passive helpers.
 *
 * @module orchestration/scheduling/deadline-tracker
 */

import { ModuleBase } from '../../core/module-base.js';
import { DIM_ALARM, DIM_LEARNING, DIM_TASK } from '../../core/field/types.js';

const WARNING_THRESHOLD = 0.9;
const DEFAULT_CONFIG = Object.freeze({
  defaultBudgetMs: 20 * 60 * 1000,
});

export class DeadlineTracker extends ModuleBase {
  static produces() { return [DIM_ALARM]; }
  static consumes() { return [DIM_LEARNING, DIM_TASK]; }
  static publishes() { return ['deadline.warning', 'deadline.exceeded']; }
  static subscribes() { return ['dag.created', 'dag.phase.completed']; }

  constructor({ field, bus, config = {} } = {}) {
    super();
    this._field = field;
    this._bus = bus;
    this._config = { ...DEFAULT_CONFIG, ...config };

    /** @type {Map<string, { totalBudgetMs: number, startedAt: number, phaseBudgets: Record<string, number>, phaseActuals: Record<string, number>, warningEmitted: boolean, exceededEmitted: boolean }>} */
    this._deadlines = new Map();
    /** @type {Function[]} */
    this._unsubscribers = [];
  }

  async start() {
    const listen = this._bus?.on?.bind(this._bus);
    if (!listen) return;

    this._unsubscribers.push(
      listen('dag.created', (payload) => this._onDagCreated(payload)),
      listen('dag.phase.completed', (payload) => this._onPhaseCompleted(payload)),
    );
  }

  async stop() {
    for (const unsubscribe of this._unsubscribers.splice(0)) {
      unsubscribe?.();
    }
  }

  setDeadline(dagId, totalBudgetMs, phaseBudgets) {
    this._deadlines.set(dagId, {
      totalBudgetMs,
      startedAt: Date.now(),
      phaseBudgets: phaseBudgets ?? {},
      phaseActuals: {},
      warningEmitted: false,
      exceededEmitted: false,
    });
  }

  checkOverdue(dagId) {
    const entry = this._deadlines.get(dagId);
    if (!entry) {
      return { overdue: false, remaining: Infinity, overduePhases: [] };
    }

    const elapsed = Date.now() - entry.startedAt;
    const remaining = entry.totalBudgetMs - elapsed;
    const fraction = entry.totalBudgetMs > 0 ? elapsed / entry.totalBudgetMs : 0;

    const overduePhases = [];
    for (const [phase, budget] of Object.entries(entry.phaseBudgets)) {
      const actual = entry.phaseActuals[phase];
      if (typeof actual === 'number' && actual > budget) {
        overduePhases.push(phase);
      }
    }

    if (fraction >= WARNING_THRESHOLD && !entry.warningEmitted) {
      entry.warningEmitted = true;
      this._bus?.publish?.('deadline.warning', {
        dagId,
        elapsed,
        totalBudgetMs: entry.totalBudgetMs,
        fraction: +fraction.toFixed(3),
        remaining,
      });
    }

    const overdue = fraction >= 1;
    if (overdue && !entry.exceededEmitted) {
      entry.exceededEmitted = true;
      this._bus?.publish?.('deadline.exceeded', {
        dagId,
        elapsed,
        totalBudgetMs: entry.totalBudgetMs,
        overduePhases,
      });
      this._field?.emit?.({
        dimension: DIM_ALARM,
        scope: dagId,
        strength: Math.min(1, Math.max(0, fraction)),
        emitterId: 'deadline-tracker',
        metadata: {
          overdueMs: Math.max(0, elapsed - entry.totalBudgetMs),
        },
      });
    }

    return {
      overdue,
      remaining: Math.max(remaining, 0),
      overduePhases,
    };
  }

  estimateRemaining(dagId) {
    const entry = this._deadlines.get(dagId);
    if (!entry) return 0;

    const elapsed = Date.now() - entry.startedAt;
    const rawRemaining = Math.max(entry.totalBudgetMs - elapsed, 0);

    let learningFactor = 1.0;
    if (typeof this._field?.query === 'function') {
      try {
        const result = this._field.query({ scope: dagId, dimension: DIM_LEARNING, limit: 1 });
        let strength = 0;
        if (Array.isArray(result) && result.length > 0 && typeof result[0].strength === 'number') {
          strength = result[0].strength;
        } else if (typeof result === 'number') {
          strength = result;
        }
        learningFactor = 1 - strength * 0.3;
      } catch {
        // Best effort only.
      }
    }

    return Math.max(Math.round(rawRemaining * learningFactor), 0);
  }

  recordPhaseCompletion(dagId, phase, actualDurationMs) {
    const entry = this._deadlines.get(dagId);
    if (!entry) return;
    entry.phaseActuals[phase] = actualDurationMs;
  }

  getDeadlineStatus(dagId) {
    const entry = this._deadlines.get(dagId);
    if (!entry) return null;

    const elapsed = Date.now() - entry.startedAt;
    return {
      dagId,
      totalBudgetMs: entry.totalBudgetMs,
      elapsed,
      remaining: Math.max(entry.totalBudgetMs - elapsed, 0),
      fraction: entry.totalBudgetMs > 0 ? +(elapsed / entry.totalBudgetMs).toFixed(4) : 0,
      phaseBudgets: { ...entry.phaseBudgets },
      phaseActuals: { ...entry.phaseActuals },
      warningEmitted: entry.warningEmitted,
      exceededEmitted: entry.exceededEmitted,
    };
  }

  getStats() {
    const deadlines = [...this._deadlines.keys()].map((dagId) => this.getDeadlineStatus(dagId));
    const warningCount = deadlines.filter((entry) => entry?.warningEmitted).length;
    const exceededCount = deadlines.filter((entry) => entry?.exceededEmitted).length;

    return {
      trackedCount: deadlines.length,
      warningCount,
      exceededCount,
      deadlines,
    };
  }

  _onDagCreated(payload) {
    const dagId = payload?.dagId;
    if (!dagId || this._deadlines.has(dagId)) return;

    const explicitBudget = payload?.timeBudgetMs ?? payload?.deadlineMs;
    if (typeof explicitBudget === 'number' && explicitBudget > 0) {
      this.setDeadline(dagId, explicitBudget, payload?.phaseBudgets);
    }
  }

  _onPhaseCompleted(payload) {
    const dagId = payload?.dagId;
    const phase = payload?.phase ?? payload?.role ?? payload?.nodeId;
    if (!dagId || !phase) return;

    if (typeof payload?.durationMs === 'number') {
      this.recordPhaseCompletion(dagId, phase, payload.durationMs);
    }
    this.checkOverdue(dagId);
  }
}

export default DeadlineTracker;
