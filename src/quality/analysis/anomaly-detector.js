/**
 * AnomalyDetector - Detects behavioral anomalies in agent execution patterns
 *
 * Maintains a sliding window of events per agent and applies four detection
 * heuristics: repeated failures, oscillating file edits, resource exhaustion,
 * and stalled progress. When anomalies are detected, the worst one is emitted
 * as an alarm signal and published on the bus.
 *
 * @module quality/analysis/anomaly-detector
 * @version 9.0.0
 */
import { ModuleBase } from '../../core/module-base.js';
import { DIM_ALARM, DIM_TRAIL, DIM_TASK } from '../../core/field/types.js';

// ─── AnomalyDetector ─────────────────────────────────────────────────

export class AnomalyDetector extends ModuleBase {
  static produces()   { return [DIM_ALARM]; }
  static consumes()   { return [DIM_TRAIL, DIM_ALARM, DIM_TASK]; }
  static publishes()  { return ['quality.anomaly.detected']; }
  static subscribes() { return ['agent.completed', 'agent.failed', 'tool.called']; }

  /**
   * @param {Object} deps
   * @param {Object} deps.field  - Signal field instance
   * @param {Object} deps.bus    - EventBus instance
   * @param {Object} [deps.config]
   * @param {number} [deps.config.windowSize=50] - Max events per agent history
   */
  constructor({ field, bus, config = {} }) {
    super({ field, bus, config });
    this._agentHistories = new Map();
    this._windowSize = config.windowSize ?? 50;
    this._stats = { totalDetections: 0, typeDistribution: {} };
  }

  // ─── Event Recording ─────────────────────────────────────────────

  /**
   * Record an event for an agent's history window.
   *
   * @param {string} agentId
   * @param {{ type: string, tokensUsed?: number, filePath?: string, content?: string }} event
   */
  recordEvent(agentId, event) {
    if (!this._agentHistories.has(agentId)) {
      this._agentHistories.set(agentId, []);
    }

    const history = this._agentHistories.get(agentId);
    history.push({
      ...event,
      timestamp: event.timestamp || Date.now(),
    });

    // Trim to window size, keeping most recent
    while (history.length > this._windowSize) {
      history.shift();
    }
  }

  // ─── Core Detection ──────────────────────────────────────────────

  /**
   * Run all anomaly detection heuristics against the agent's event history.
   *
   * @param {string} agentId
   * @returns {{ anomaly: boolean, type: string|null, confidence: number, description: string }}
   */
  detect(agentId) {
    const history = this._agentHistories.get(agentId);
    if (!history || history.length === 0) {
      return { anomaly: false, type: null, confidence: 0, description: '' };
    }

    const anomalies = [];

    // (a) Repeated failures: last 5 events, count failures
    const last5 = history.slice(-5);
    const failCount = last5.filter(e => e.type === 'failure').length;
    if (failCount >= 3) {
      anomalies.push({
        type: 'repeated_failures',
        confidence: failCount / 5,
        description: `${failCount} failures in last 5 events`,
      });
    }

    // (b) Oscillating outputs: A->B->A pattern on same file
    const fileEdits = history.filter(e => e.type === 'file_edit');
    if (fileEdits.length >= 3) {
      const oscillation = this._detectOscillation(fileEdits);
      if (oscillation) {
        anomalies.push({
          type: 'oscillating_outputs',
          confidence: 0.8,
          description: `Oscillating edits detected on ${oscillation}`,
        });
      }
    }

    // (c) Resource exhaustion: last 3 events with tokensUsed, monotonically increasing
    const tokenEvents = history.filter(e => e.tokensUsed != null).slice(-3);
    if (tokenEvents.length >= 3) {
      const tokenValues = tokenEvents.map(e => e.tokensUsed);
      if (this._isMonotonicallyIncreasing(tokenValues)) {
        anomalies.push({
          type: 'resource_exhaustion',
          confidence: 0.6,
          description: `Token usage monotonically increasing: ${tokenValues.join(' -> ')}`,
        });
      }
    }

    // (d) Stalled progress: last 10 events, no productive types
    const last10 = history.slice(-10);
    if (last10.length >= 10) {
      const productiveCount = last10.filter(
        e => e.type === 'file_edit' || e.type === 'result',
      ).length;
      if (productiveCount === 0) {
        anomalies.push({
          type: 'stalled_progress',
          confidence: 0.7,
          description: 'No productive events (file_edit or result) in last 10 events',
        });
      }
    }

    // No anomalies detected
    if (anomalies.length === 0) {
      return { anomaly: false, type: null, confidence: 0, description: '' };
    }

    // Sort by confidence descending, take the worst
    anomalies.sort((a, b) => b.confidence - a.confidence);
    const worst = anomalies[0];

    // Signal field emission
    this.field?.emit({
      dimension: DIM_ALARM,
      scope: agentId,
      strength: worst.confidence,
      emitterId: this.constructor.name,
      metadata: {
        event: 'anomaly_detected',
        anomalies: anomalies.map(a => ({ type: a.type, confidence: a.confidence })),
      },
    });

    // Bus publish
    this.bus?.publish(
      'quality.anomaly.detected',
      { agentId, anomalies, worst },
      this.constructor.name,
    );

    // Update stats
    this._stats.totalDetections++;
    this._stats.typeDistribution[worst.type] =
      (this._stats.typeDistribution[worst.type] || 0) + 1;

    return {
      anomaly: true,
      type: worst.type,
      confidence: worst.confidence,
      description: worst.description,
    };
  }

  // ─── Oscillation Detection ───────────────────────────────────────

  /**
   * Check for A->B->A pattern: same filePath appearing 3+ times
   * with alternating content (indicating edit reversal).
   *
   * @param {Array<{ filePath?: string, content?: string }>} fileEdits
   * @returns {string|null} filePath exhibiting oscillation, or null
   */
  _detectOscillation(fileEdits) {
    // Group edits by filePath
    const byPath = new Map();
    for (const edit of fileEdits) {
      if (!edit.filePath) continue;
      if (!byPath.has(edit.filePath)) {
        byPath.set(edit.filePath, []);
      }
      byPath.get(edit.filePath).push(edit);
    }

    for (const [filePath, edits] of byPath) {
      if (edits.length < 3) continue;

      // Check consecutive triples for A->B->A pattern
      for (let i = 0; i <= edits.length - 3; i++) {
        const a = edits[i].content || '';
        const b = edits[i + 1].content || '';
        const c = edits[i + 2].content || '';

        // A->B->A: first and third are similar, middle differs
        if (a === c && a !== b) {
          return filePath;
        }
      }
    }

    return null;
  }

  /**
   * Check if values are strictly monotonically increasing.
   * @param {number[]} values
   * @returns {boolean}
   */
  _isMonotonicallyIncreasing(values) {
    for (let i = 1; i < values.length; i++) {
      if (values[i] <= values[i - 1]) return false;
    }
    return values.length > 1;
  }

  // ─── Cleanup & Stats ─────────────────────────────────────────────

  /**
   * Delete event history for a specific agent.
   * @param {string} agentId
   */
  cleanup(agentId) {
    this._agentHistories.delete(agentId);
  }

  /**
   * Return aggregate detection statistics.
   * @returns {{ totalDetections: number, typeDistribution: Object }}
   */
  getStats() {
    return {
      totalDetections: this._stats.totalDetections,
      typeDistribution: { ...this._stats.typeDistribution },
    };
  }
}

export default AnomalyDetector;
