/**
 * FailureAnalyzer - Classifies agent and tool failures into actionable categories
 *
 * Ingests failure events from agents and tools, matches error text against
 * indicator patterns for each failure class, and emits classification results
 * with suggested recovery strategies. Tracks classification statistics
 * and persists audit records for post-mortem analysis.
 *
 * @module quality/analysis/failure-analyzer
 * @version 9.0.0
 */
import { ModuleBase } from '../../core/module-base.js';
import { DIM_ALARM, DIM_TRAIL } from '../../core/field/types.js';

// ─── Failure Classification Definitions ──────────────────────────────

const FAILURE_CLASSES = {
  TOOL_ERROR: {
    id: 'tool_error',
    indicators: [
      'tool call failed', 'schema validation', 'tool not found',
      'permission denied', '工具调用失败',
    ],
    defaultStrategy: 'retry_with_fix',
    severity: 'medium',
  },
  MODEL_HALLUCINATION: {
    id: 'model_hallucination',
    indicators: [
      'file not found', 'function not found', 'does not exist',
      'invented', '文件不存在', '不存在的API',
    ],
    defaultStrategy: 'add_context',
    severity: 'high',
  },
  CONTEXT_OVERFLOW: {
    id: 'context_overflow',
    indicators: [
      'context window', 'token limit', 'max_tokens',
      'truncated', '上下文溢出',
    ],
    defaultStrategy: 'split_task',
    severity: 'medium',
  },
  PERMISSION_DENIED: {
    id: 'permission_denied',
    indicators: [
      'permission', 'unauthorized', 'forbidden',
      'EACCES', '403', '权限',
    ],
    defaultStrategy: 'escalate',
    severity: 'high',
  },
  TASK_AMBIGUITY: {
    id: 'task_ambiguity',
    indicators: [
      'ambiguous', 'unclear', 'need clarification',
      '不确定', '需要澄清', '多种理解',
    ],
    defaultStrategy: 'clarify',
    severity: 'low',
  },
};

// ─── FailureAnalyzer ─────────────────────────────────────────────────

export class FailureAnalyzer extends ModuleBase {
  static produces()   { return [DIM_ALARM]; }
  static consumes()   { return [DIM_TRAIL]; }
  static publishes()  { return ['quality.failure.classified']; }
  static subscribes() { return ['agent.failed', 'tool.failed']; }

  /**
   * @param {Object} deps
   * @param {Object} deps.field  - Signal field instance
   * @param {Object} deps.bus    - EventBus instance
   * @param {Object} deps.store  - DomainStore instance
   * @param {Object} [deps.config]
   */
  constructor({ field, bus, store, config = {} }) {
    super({ field, bus, store, config });
    this._stats = { totalClassified: 0, classDistribution: {}, totalConfidence: 0 };
  }

  // ─── Core Classification ─────────────────────────────────────────

  /**
   * Classify a failure into one of the predefined failure classes.
   *
   * @param {{ agentId: string, error: string, toolName?: string, taskDescription?: string, lastOutput?: string }} failureContext
   * @returns {{ class: string, severity: string, suggestedStrategy: string, confidence: number, details: Object }}
   */
  classify(failureContext) {
    const { agentId, error, taskDescription, lastOutput } = failureContext;
    const searchText = `${error || ''} ${taskDescription || ''} ${lastOutput || ''}`.toLowerCase();

    let bestClass = null;
    let bestRatio = 0;
    let bestMatchCount = 0;

    for (const [, cls] of Object.entries(FAILURE_CLASSES)) {
      const { matched, total } = this._matchIndicators(searchText, cls.indicators);
      const ratio = total > 0 ? matched / total : 0;
      if (matched > 0 && ratio > bestRatio) {
        bestRatio = ratio;
        bestMatchCount = matched;
        bestClass = cls;
      }
    }

    // Default to TASK_AMBIGUITY if no class matched
    if (!bestClass) {
      bestClass = FAILURE_CLASSES.TASK_AMBIGUITY;
      bestRatio = 0;
    }

    const confidence = Math.max(0.2, Math.min(bestRatio, 1.0));
    const strength = this._severityToStrength(bestClass.severity);

    const result = {
      class: bestClass.id,
      severity: bestClass.severity,
      suggestedStrategy: bestClass.defaultStrategy,
      confidence,
      details: {
        matchCount: bestMatchCount,
        indicators: bestClass.indicators,
        searchTextLength: searchText.length,
      },
    };

    // Signal field emission
    this.field?.emit({
      dimension: DIM_ALARM,
      scope: agentId,
      strength,
      emitterId: this.constructor.name,
      metadata: {
        event: 'failure_classified',
        class: bestClass.id,
        strategy: bestClass.defaultStrategy,
      },
    });

    // Bus publish
    this.bus?.publish(
      'quality.failure.classified',
      { ...result, failureContext },
      this.constructor.name,
    );

    // Store audit record
    const recordKey = `failure-${agentId}-${Date.now()}`;
    this.store?.put('quality', recordKey, {
      key: recordKey,
      ...result,
      failureContext,
      timestamp: Date.now(),
    });

    // Update stats
    this._stats.totalClassified++;
    this._stats.totalConfidence += confidence;
    this._stats.classDistribution[bestClass.id] =
      (this._stats.classDistribution[bestClass.id] || 0) + 1;

    return result;
  }

  // ─── Indicator Matching ──────────────────────────────────────────

  /**
   * Count how many indicators match the given text.
   * @param {string} text - Lowercased search text
   * @param {string[]} indicators - Indicator phrases
   * @returns {{ matched: number, total: number }}
   */
  _matchIndicators(text, indicators) {
    let matched = 0;
    for (const indicator of indicators) {
      if (text.includes(indicator.toLowerCase())) {
        matched++;
      }
    }
    return { matched, total: indicators.length };
  }

  /**
   * Map severity label to signal strength value.
   * @param {string} severity
   * @returns {number}
   */
  _severityToStrength(severity) {
    const map = { low: 0.3, medium: 0.5, high: 0.7, critical: 1.0 };
    return map[severity] ?? 0.5;
  }

  // ─── Event Handlers ──────────────────────────────────────────────

  /**
   * Handler for agent.failed and tool.failed bus events.
   * Extracts failure context and delegates to classify().
   * @param {Object} event - Bus event payload
   */
  _onFailure(event) {
    const ctx = {
      agentId: event.agentId || event.scope || 'unknown',
      error: event.error || event.message || '',
      toolName: event.toolName || null,
      taskDescription: event.taskDescription || event.task || '',
      lastOutput: event.lastOutput || event.output || '',
    };
    this.classify(ctx);
  }

  // ─── History & Stats ─────────────────────────────────────────────

  /**
   * Retrieve classification history for a specific agent.
   * @param {string} agentId
   * @param {number} [limit=10]
   * @returns {Array<Object>}
   */
  getFailureHistory(agentId, limit = 10) {
    if (!this.store) return [];

    const records = this.store.query('quality', (value, key) => {
      return key.startsWith(`failure-${agentId}-`);
    });

    records.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    return records.slice(0, limit);
  }

  /**
   * Return the distribution of failure classes.
   * @returns {Object<string, number>}
   */
  getClassDistribution() {
    return { ...this._stats.classDistribution };
  }

  /**
   * Return aggregate classification statistics.
   * @returns {{ totalClassified: number, classDistribution: Object, avgConfidence: number }}
   */
  getStats() {
    const { totalClassified, classDistribution, totalConfidence } = this._stats;
    return {
      totalClassified,
      classDistribution: { ...classDistribution },
      avgConfidence: totalClassified > 0 ? totalConfidence / totalClassified : 0,
    };
  }
}

export default FailureAnalyzer;
