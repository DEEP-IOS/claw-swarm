/**
 * ProgressTracker - Tracks multi-step task progress per DAG execution.
 *
 * Records individual steps (tool calls, file changes, agent actions),
 * generates human-readable summaries, and determines when to send
 * progress notifications based on time and step-count intervals.
 *
 * @module bridge/interaction/progress-tracker
 * @version 9.0.0
 */

export class ProgressTracker {
  /**
   * @param {Object} deps
   * @param {Object} deps.bus                    - EventBus for progress events
   * @param {Object} [deps.config={}]            - Configuration overrides
   * @param {number} [deps.config.notifyIntervalMs=30000]   - Min ms between notifications
   * @param {number} [deps.config.notifyStepInterval=5]     - Notify every N steps
   */
  constructor({ bus, config = {} }) {
    this._bus = bus;
    this._steps = new Map();          // dagId -> [{step}]
    this._lastNotifyAt = new Map();   // dagId -> timestamp
    this._notifyIntervalMs = config.notifyIntervalMs ?? 30000;
    this._notifyStepInterval = config.notifyStepInterval ?? 5;
  }

  /**
   * Record a completed step for a DAG execution.
   * @param {string} dagId
   * @param {Object} step
   * @param {string} [step.agentId]       - Agent that performed the step
   * @param {string} [step.tool]          - Tool that was called
   * @param {string} [step.description]   - Human-readable description
   * @param {string[]} [step.filesChanged] - Files modified in this step
   */
  recordStep(dagId, { agentId, tool, description, filesChanged }) {
    if (!this._steps.has(dagId)) {
      this._steps.set(dagId, []);
    }
    const step = {
      agentId: agentId || null,
      tool: tool || null,
      description: description || tool || 'Step',
      filesChanged: filesChanged || [],
      ts: Date.now(),
    };
    this._steps.get(dagId).push(step);
    this._bus?.publish('progress.step.recorded', { dagId, step: step.description, total: this._steps.get(dagId).length });
  }

  /**
   * Get a human-readable summary of all steps for a DAG execution.
   * @param {string} dagId
   * @returns {string}
   */
  getSummary(dagId) {
    const steps = this._steps.get(dagId);
    if (!steps || steps.length === 0) return 'No steps recorded.';

    const summaryLines = steps.map((s, i) => {
      const prefix = `${i + 1}.`;
      const desc = s.description || s.tool || 'Step';
      const files = s.filesChanged.length > 0
        ? ` [${s.filesChanged.length} file(s)]`
        : '';
      return `${prefix} ${desc}${files}`;
    });

    return `Completed ${steps.length} step(s):\n${summaryLines.join('\n')}`;
  }

  /**
   * Determine whether a notification should be sent for this DAG.
   * Returns true if enough time has elapsed or enough steps have accumulated.
   * @param {string} dagId
   * @returns {boolean}
   */
  shouldNotify(dagId) {
    const steps = this._steps.get(dagId);
    if (!steps || steps.length === 0) return false;

    const lastNotify = this._lastNotifyAt.get(dagId) || 0;
    const timeSinceNotify = Date.now() - lastNotify;

    // Time-based trigger
    if (timeSinceNotify >= this._notifyIntervalMs) {
      this._lastNotifyAt.set(dagId, Date.now());
      return true;
    }

    // Step-count trigger
    if (this._notifyStepInterval > 0 &&
        steps.length % this._notifyStepInterval === 0 &&
        steps.length > 0) {
      this._lastNotifyAt.set(dagId, Date.now());
      return true;
    }

    return false;
  }

  /**
   * Estimate completion pace based on step durations.
   * Returns null if insufficient data (< 2 steps).
   * @param {string} dagId
   * @returns {{ avgStepDurationMs: number, stepsCompleted: number, totalDurationMs: number } | null}
   */
  getEstimate(dagId) {
    const steps = this._steps.get(dagId);
    if (!steps || steps.length < 2) return null;

    const durations = [];
    for (let i = 1; i < steps.length; i++) {
      durations.push(steps[i].ts - steps[i - 1].ts);
    }

    const totalDuration = durations.reduce((a, b) => a + b, 0);
    const avgDuration = totalDuration / durations.length;

    return {
      avgStepDurationMs: Math.round(avgDuration),
      stepsCompleted: steps.length,
      totalDurationMs: totalDuration,
    };
  }

  /**
   * Get all recorded steps for a DAG (raw data).
   * @param {string} dagId
   * @returns {Array}
   */
  getSteps(dagId) {
    return this._steps.get(dagId) || [];
  }

  /**
   * Clean up tracking data for a completed or abandoned DAG.
   * @param {string} dagId
   */
  cleanup(dagId) {
    this._steps.delete(dagId);
    this._lastNotifyAt.delete(dagId);
  }

  /**
   * Return aggregate statistics across all tracked DAGs.
   * @returns {{ trackedDags: number, totalSteps: number }}
   */
  getStats() {
    let totalSteps = 0;
    for (const steps of this._steps.values()) {
      totalSteps += steps.length;
    }
    return {
      trackedDags: this._steps.size,
      totalSteps,
    };
  }
}
