/**
 * QualityController - Multi-dimensional output quality auditor
 *
 * Evaluates agent outputs across four quality dimensions: correctness,
 * completeness, style, and documentation. Produces a composite quality
 * score and letter grade (A-F), then feeds the result back into the
 * reputation CRDT and signal field.
 *
 * Subscribes to 'agent.completed' events for automatic evaluation and
 * publishes 'quality.audit.completed' with full audit breakdowns.
 *
 * @module quality/gate/quality-controller
 * @version 9.0.0
 */
import { ModuleBase } from '../../core/module-base.js';
import { DIM_REPUTATION, DIM_TRAIL, DIM_KNOWLEDGE } from '../../core/field/types.js';

// ─── Dimension Weights ─────────────────────────────────────────────────

const WEIGHTS = {
  correctness:   0.40,
  completeness:  0.30,
  style:         0.15,
  documentation: 0.15,
};

// ─── Grade Thresholds ──────────────────────────────────────────────────

const GRADE_THRESHOLDS = [
  { min: 0.9, grade: 'A' },
  { min: 0.7, grade: 'B' },
  { min: 0.5, grade: 'C' },
  { min: 0.3, grade: 'D' },
];
const GRADE_DEFAULT = 'F';

// ─── QualityController ────────────────────────────────────────────────

export class QualityController extends ModuleBase {
  static produces()   { return [DIM_REPUTATION]; }
  static consumes()   { return [DIM_TRAIL, DIM_KNOWLEDGE]; }
  static publishes()  { return ['quality.audit.completed']; }
  static subscribes() { return ['agent.completed']; }

  /**
   * @param {Object} deps
   * @param {Object}  deps.field          - Signal field instance
   * @param {Object}  deps.bus            - EventBus instance
   * @param {Object}  deps.store          - DomainStore instance
   * @param {Object}  [deps.reputationCRDT] - ReputationCRDT instance for score feedback
   * @param {Object}  [deps.config]
   */
  constructor({ field, bus, store, reputationCRDT, config = {} }) {
    super({ field, bus, store, config });
    this.field = field;
    this.bus   = bus;
    this.store = store;
    this._reputationCRDT = reputationCRDT ?? null;
    this._stats = {
      totalAudits: 0,
      totalScore: 0,
      gradeDistribution: { A: 0, B: 0, C: 0, D: 0, F: 0 },
    };
    this._onAgentCompletedBound = this._onAgentCompleted.bind(this);
  }

  // ─── Lifecycle ───────────────────────────────────────────────────

  async start() {
    this.bus?.subscribe('agent.completed', this._onAgentCompletedBound);
  }

  async stop() {
    this.bus?.unsubscribe('agent.completed', this._onAgentCompletedBound);
  }

  // ─── Core Evaluation ─────────────────────────────────────────────

  /**
   * Evaluate the quality of an agent's output.
   *
   * @param {Object} agentOutput
   * @param {string} agentOutput.agentId
   * @param {string} [agentOutput.roleId]
   * @param {string} [agentOutput.taskDescription]
   * @param {*}      [agentOutput.result]
   * @param {Array}  [agentOutput.filesChanged]
   * @param {number} [agentOutput.tokensUsed]
   * @param {number} [agentOutput.durationMs]
   * @returns {{ qualityScore: number, breakdown: Object, grade: string }}
   */
  evaluateOutput(agentOutput) {
    const breakdown = {
      correctness:   this._evaluateCorrectness(agentOutput),
      completeness:  this._evaluateCompleteness(agentOutput),
      style:         this._evaluateStyle(agentOutput),
      documentation: this._evaluateDocumentation(agentOutput),
    };

    const qualityScore =
      breakdown.correctness   * WEIGHTS.correctness +
      breakdown.completeness  * WEIGHTS.completeness +
      breakdown.style         * WEIGHTS.style +
      breakdown.documentation * WEIGHTS.documentation;

    const grade = this._scoreToGrade(qualityScore);

    // --- Reputation CRDT feedback ---
    if (this._reputationCRDT) {
      if (qualityScore >= 0.7) {
        this._reputationCRDT.increment(agentOutput.agentId);
      } else if (qualityScore < 0.4) {
        this._reputationCRDT.decrement(agentOutput.agentId);
      }
    }

    // --- Signal field emission ---
    this.field?.emit({
      dimension: DIM_REPUTATION,
      scope: agentOutput.agentId,
      strength: Math.max(0, Math.min(qualityScore, 1)),
      emitterId: this.constructor.name,
      metadata: { event: 'quality_audited', grade, breakdown },
    });

    // --- Bus publish ---
    const auditPayload = {
      agentId: agentOutput.agentId,
      roleId: agentOutput.roleId ?? null,
      qualityScore,
      breakdown,
      grade,
      timestamp: Date.now(),
    };
    this.bus?.publish('quality.audit.completed', auditPayload, this.constructor.name);

    // --- Store audit record ---
    const recordKey = `audit-${agentOutput.agentId}-${Date.now()}`;
    this.store?.put('quality', recordKey, { key: recordKey, ...auditPayload });

    // --- Stats ---
    this._stats.totalAudits++;
    this._stats.totalScore += qualityScore;
    this._stats.gradeDistribution[grade] = (this._stats.gradeDistribution[grade] || 0) + 1;

    return { qualityScore, breakdown, grade };
  }

  // ─── Sub-evaluation: Correctness ─────────────────────────────────

  /**
   * Heuristic correctness score based on presence of result, files, and absence of error signals.
   * @param {Object} output
   * @returns {number} Score in [0, 1]
   */
  _evaluateCorrectness(output) {
    let score = 0;

    // Result exists and is non-empty
    if (output.result != null) {
      const resultStr = typeof output.result === 'string'
        ? output.result
        : JSON.stringify(output.result);
      score += resultStr.length > 0 ? 0.4 : 0;
    }

    // Files were actually changed (non-empty array)
    const files = output.filesChanged;
    if (Array.isArray(files) && files.length > 0) {
      score += 0.3;
    }

    // No explicit error marker in result
    const resultText = typeof output.result === 'string' ? output.result.toLowerCase() : '';
    const hasError = resultText.includes('error') || resultText.includes('failed') || resultText.includes('exception');
    score += hasError ? 0 : 0.3;

    return Math.max(0, Math.min(score, 1));
  }

  // ─── Sub-evaluation: Completeness ────────────────────────────────

  /**
   * Heuristic completeness score. Compares result length relative to task description length.
   * A result that is substantially longer than the task description suggests thorough work.
   * @param {Object} output
   * @returns {number} Score in [0, 1]
   */
  _evaluateCompleteness(output) {
    const taskLen   = typeof output.taskDescription === 'string' ? output.taskDescription.length : 0;
    const resultStr = typeof output.result === 'string'
      ? output.result
      : (output.result != null ? JSON.stringify(output.result) : '');
    const resultLen = resultStr.length;

    if (taskLen === 0 && resultLen === 0) return 0.5; // No data to judge
    if (taskLen === 0) return resultLen > 0 ? 0.7 : 0.3;
    if (resultLen === 0) return 0.1;

    // Ratio of result to task description. A ratio >= 2 is considered highly complete.
    const ratio = resultLen / taskLen;

    if (ratio >= 2.0)  return 1.0;
    if (ratio >= 1.0)  return 0.8;
    if (ratio >= 0.5)  return 0.6;
    if (ratio >= 0.2)  return 0.4;
    return 0.2;
  }

  // ─── Sub-evaluation: Style ───────────────────────────────────────

  /**
   * Heuristic style score based on file change count and whether changes are of reasonable size.
   * Having some files changed (but not an excessive number) indicates focused work.
   * @param {Object} output
   * @returns {number} Score in [0, 1]
   */
  _evaluateStyle(output) {
    const files = output.filesChanged;
    if (!Array.isArray(files)) return 0.5; // Neutral when no file data

    const count = files.length;
    if (count === 0) return 0.3;

    // Sweet spot: 1-5 files is typically well-scoped
    if (count >= 1 && count <= 5)  return 1.0;
    if (count <= 10)               return 0.8;
    if (count <= 20)               return 0.6;
    // Too many files suggests overly broad changes
    return 0.4;
  }

  // ─── Sub-evaluation: Documentation ───────────────────────────────

  /**
   * Heuristic documentation score. Checks whether the result contains
   * explanatory or descriptive text patterns.
   * @param {Object} output
   * @returns {number} Score in [0, 1]
   */
  _evaluateDocumentation(output) {
    const resultStr = typeof output.result === 'string'
      ? output.result
      : (output.result != null ? JSON.stringify(output.result) : '');

    if (resultStr.length === 0) return 0.2;

    let score = 0.3; // Baseline for having any result

    // Presence of structured markers suggests documentation effort
    const docPatterns = [
      /\b(summary|overview|description|note|explanation)\b/i,
      /\b(step|steps|procedure|approach)\b/i,
      /\b(because|therefore|since|reason)\b/i,
      /\b(changed|updated|added|removed|fixed|created)\b/i,
    ];

    for (const pattern of docPatterns) {
      if (pattern.test(resultStr)) {
        score += 0.15;
      }
    }

    // Longer explanatory text is generally better documentation
    if (resultStr.length > 200)  score += 0.1;
    if (resultStr.length > 500)  score += 0.1;

    return Math.max(0, Math.min(score, 1));
  }

  // ─── Grade Mapping ───────────────────────────────────────────────

  /**
   * Map a numeric quality score to a letter grade.
   * @param {number} score
   * @returns {string} One of 'A', 'B', 'C', 'D', 'F'
   */
  _scoreToGrade(score) {
    for (const entry of GRADE_THRESHOLDS) {
      if (score >= entry.min) return entry.grade;
    }
    return GRADE_DEFAULT;
  }

  // ─── Event Handler ───────────────────────────────────────────────

  /**
   * Handler for 'agent.completed' bus events.
   * Extracts the output payload and runs evaluateOutput.
   * @param {Object} envelope - EventBus envelope { topic, ts, source, data }
   */
  _onAgentCompleted(envelope) {
    const data = envelope?.data || envelope;
    if (!data || !data.agentId) return;
    this.evaluateOutput(data);
  }

  // ─── History & Stats ─────────────────────────────────────────────

  /**
   * Retrieve audit history for an agent from the store.
   * @param {string} agentId
   * @param {number} [limit=10]
   * @returns {Array<Object>}
   */
  getAuditHistory(agentId, limit = 10) {
    if (!this.store) return [];

    const records = this.store.query('quality', (value, key) => {
      return key.startsWith(`audit-${agentId}-`);
    });

    records.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    return records.slice(0, limit);
  }

  /**
   * Return aggregate audit statistics.
   * @returns {{ totalAudits: number, avgScore: number, gradeDistribution: Object }}
   */
  getStats() {
    const { totalAudits, totalScore, gradeDistribution } = this._stats;
    return {
      totalAudits,
      avgScore: totalAudits > 0 ? totalScore / totalAudits : 0,
      gradeDistribution: { ...gradeDistribution },
    };
  }
}

export default QualityController;
