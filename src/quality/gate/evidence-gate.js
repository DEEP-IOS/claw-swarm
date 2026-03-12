/**
 * EvidenceGate - Tiered evidence evaluation gate for quality assurance
 *
 * Evaluates claims against provided evidence using a weighted tier system.
 * Evidence is categorized as PRIMARY (direct), CORROBORATION (supporting),
 * or INFERENCE (indirect reasoning). The gate computes a composite score
 * and decides whether a claim passes, gets flagged for review, or is blocked.
 *
 * Supports appeal workflows: previously evaluated claims can be re-evaluated
 * when additional evidence becomes available.
 *
 * @module quality/gate/evidence-gate
 * @version 9.0.0
 */
import { ModuleBase } from '../../core/module-base.js';
import { DIM_ALARM, DIM_REPUTATION, DIM_KNOWLEDGE, DIM_TRAIL } from '../../core/field/types.js';

// ─── Evidence Tier Definitions ─────────────────────────────────────────

const EVIDENCE_TIERS = {
  PRIMARY:       { weight: 1.0,  label: 'Direct evidence' },
  CORROBORATION: { weight: 0.75, label: 'Corroborating evidence' },
  INFERENCE:     { weight: 0.4,  label: 'Inference' },
};

/** Bonus multiplier when at least one PRIMARY evidence is present */
const PRIMARY_BONUS = 1.2;

// ─── Tier precedence (highest first) ───────────────────────────────────

const TIER_RANK = { PRIMARY: 3, CORROBORATION: 2, INFERENCE: 1 };

// ─── EvidenceGate ──────────────────────────────────────────────────────

export class EvidenceGate extends ModuleBase {
  static produces()   { return [DIM_ALARM, DIM_REPUTATION]; }
  static consumes()   { return [DIM_KNOWLEDGE, DIM_TRAIL]; }
  static publishes()  { return ['quality.gate.evaluated', 'quality.gate.appealed']; }
  static subscribes() { return []; }

  /**
   * @param {Object} deps
   * @param {Object} deps.field  - Signal field instance
   * @param {Object} deps.bus    - EventBus instance
   * @param {Object} deps.store  - DomainStore instance
   * @param {Object} [deps.config]
   * @param {number} [deps.config.hardThreshold=0.6] - Score at or above this passes
   * @param {number} [deps.config.softThreshold=0.3] - Score between soft and hard is flagged
   */
  constructor({ field, bus, store, config = {} }) {
    super({ field, bus, store, config });
    this.field = field;
    this.bus   = bus;
    this.store = store;
    this._hardThreshold = config.hardThreshold ?? 0.6;
    this._softThreshold = config.softThreshold ?? 0.3;
    this._stats = { totalEvaluations: 0, passed: 0, appeals: 0, totalScore: 0 };
  }

  // ─── Core Evaluation ─────────────────────────────────────────────

  /**
   * Evaluate a claim against a list of evidence items.
   *
   * @param {{ agentId: string, type: string, description: string }} claim
   * @param {Array<{ tier: string, description: string, data?: * }>} evidences
   * @returns {{ score: number, passed: boolean, blocked: boolean, flagged: boolean, reasons: string[], tier: string }}
   */
  evaluate(claim, evidences = []) {
    const score   = this._calculateScore(evidences);
    const gate    = this._determineGateResult(score);
    const reasons = this._generateReasons(evidences, score);
    const tier    = this._getHighestTier(evidences);

    const result = { score, ...gate, reasons, tier };

    // --- Signal field emissions ---
    if (gate.passed) {
      this.field?.emit({
        dimension: DIM_REPUTATION,
        scope: claim.agentId,
        strength: Math.min(score * 0.3, 1),
        emitterId: this.constructor.name,
        metadata: { event: 'gate_passed', claim: claim.type },
      });
    } else {
      this.field?.emit({
        dimension: DIM_ALARM,
        scope: claim.agentId,
        strength: Math.min(1 - score, 1),
        emitterId: this.constructor.name,
        metadata: { event: 'gate_failed', claim },
      });
    }

    // --- Bus publish ---
    this.bus?.publish(
      'quality.gate.evaluated',
      { claim, score, passed: gate.passed, blocked: gate.blocked, flagged: gate.flagged, reasons, tier },
      this.constructor.name,
    );

    // --- Store audit record ---
    const recordKey = `gate-${claim.agentId}-${Date.now()}`;
    this.store?.put('quality', recordKey, {
      key: recordKey,
      claim,
      evidences,
      ...result,
      timestamp: Date.now(),
    });

    // --- Stats ---
    this._stats.totalEvaluations++;
    this._stats.totalScore += score;
    if (gate.passed) this._stats.passed++;

    return result;
  }

  // ─── Appeal ──────────────────────────────────────────────────────

  /**
   * Appeal a previous evaluation by providing additional evidence.
   * Merges original + new evidence and re-evaluates.
   *
   * @param {string} evaluationId - The store key of the original evaluation
   * @param {Array<{ tier: string, description: string, data?: * }>} additionalEvidences
   * @returns {{ score: number, passed: boolean, blocked: boolean, flagged: boolean, reasons: string[], tier: string, previousScore: number } | null}
   */
  appeal(evaluationId, additionalEvidences = []) {
    const original = this.store?.get('quality', evaluationId);
    if (!original) return null;

    const mergedEvidences = [...(original.evidences || []), ...additionalEvidences];
    const previousScore   = original.score;

    // Re-evaluate with merged evidence
    const score   = this._calculateScore(mergedEvidences);
    const gate    = this._determineGateResult(score);
    const reasons = this._generateReasons(mergedEvidences, score);
    const tier    = this._getHighestTier(mergedEvidences);

    const result = { score, ...gate, reasons, tier, previousScore };

    // Update the stored record
    this.store?.put('quality', evaluationId, {
      ...original,
      evidences: mergedEvidences,
      ...result,
      appealed: true,
      appealTimestamp: Date.now(),
    });

    this.bus?.publish(
      'quality.gate.appealed',
      { evaluationId, newScore: score, previousScore, passed: gate.passed, claim: original.claim },
      this.constructor.name,
    );

    this._stats.appeals++;

    return result;
  }

  // ─── Score Calculation ───────────────────────────────────────────

  /**
   * Compute weighted average score from evidence tiers.
   * Applies a PRIMARY bonus when direct evidence is present.
   * @param {Array<{ tier: string }>} evidences
   * @returns {number} Normalized score in [0, 1]
   */
  _calculateScore(evidences) {
    if (!evidences || evidences.length === 0) return 0;

    let weightSum = 0;
    let hasPrimary = false;

    for (const ev of evidences) {
      const tierDef = EVIDENCE_TIERS[ev.tier];
      const weight  = tierDef ? tierDef.weight : 0;
      weightSum += weight;
      if (ev.tier === 'PRIMARY') hasPrimary = true;
    }

    let score = weightSum / evidences.length;

    // PRIMARY bonus: boost the average by 20 %, clamped to 1.0
    if (hasPrimary) {
      score = Math.min(score * PRIMARY_BONUS, 1.0);
    }

    return Math.max(0, Math.min(score, 1.0));
  }

  // ─── Threshold Logic ─────────────────────────────────────────────

  /**
   * Map a numeric score to gate pass / flag / block status.
   * @param {number} score
   * @returns {{ passed: boolean, blocked: boolean, flagged: boolean }}
   */
  _determineGateResult(score) {
    if (score >= this._hardThreshold) {
      return { passed: true, blocked: false, flagged: false };
    }
    if (score >= this._softThreshold) {
      return { passed: false, blocked: false, flagged: true };
    }
    return { passed: false, blocked: true, flagged: false };
  }

  // ─── Reason Generation ───────────────────────────────────────────

  /**
   * Build human-readable reasons describing each evidence contribution.
   * @param {Array<{ tier: string, description: string }>} evidences
   * @param {number} score
   * @returns {string[]}
   */
  _generateReasons(evidences, score) {
    const reasons = [];

    if (!evidences || evidences.length === 0) {
      reasons.push('No evidence provided; score defaults to 0.');
      return reasons;
    }

    for (const ev of evidences) {
      const tierDef = EVIDENCE_TIERS[ev.tier];
      if (tierDef) {
        reasons.push(
          `[${tierDef.label}] (w=${tierDef.weight}) ${ev.description || '(no description)'}`,
        );
      } else {
        reasons.push(`[Unknown tier: ${ev.tier}] ${ev.description || '(no description)'}`);
      }
    }

    reasons.push(`Composite score: ${score.toFixed(3)}`);

    if (score >= this._hardThreshold) {
      reasons.push('Result: PASSED (above hard threshold)');
    } else if (score >= this._softThreshold) {
      reasons.push('Result: FLAGGED (between soft and hard threshold)');
    } else {
      reasons.push('Result: BLOCKED (below soft threshold)');
    }

    return reasons;
  }

  // ─── Tier Resolution ─────────────────────────────────────────────

  /**
   * Determine the highest-ranked tier present in the evidence set.
   * @param {Array<{ tier: string }>} evidences
   * @returns {string} Tier label (e.g. 'Direct evidence') or 'None'
   */
  _getHighestTier(evidences) {
    if (!evidences || evidences.length === 0) return 'None';

    let best     = null;
    let bestRank = -1;

    for (const ev of evidences) {
      const rank = TIER_RANK[ev.tier] ?? 0;
      if (rank > bestRank) {
        bestRank = rank;
        best     = ev.tier;
      }
    }

    const tierDef = best ? EVIDENCE_TIERS[best] : null;
    return tierDef ? tierDef.label : 'None';
  }

  // ─── History & Stats ─────────────────────────────────────────────

  /**
   * Retrieve evaluation history for an agent from the store.
   * @param {string} agentId
   * @param {number} [limit=10]
   * @returns {Array<Object>}
   */
  getHistory(agentId, limit = 10) {
    if (!this.store) return [];

    const records = this.store.query('quality', (value, key) => {
      return key.startsWith(`gate-${agentId}-`);
    });

    // Sort newest first
    records.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    return records.slice(0, limit);
  }

  /**
   * Return aggregate gate statistics.
   * @returns {{ totalEvaluations: number, passRate: number, appealRate: number, avgScore: number }}
   */
  getStats() {
    const { totalEvaluations, passed, appeals, totalScore } = this._stats;
    return {
      totalEvaluations,
      passRate:   totalEvaluations > 0 ? passed / totalEvaluations : 0,
      appealRate: totalEvaluations > 0 ? appeals / totalEvaluations : 0,
      avgScore:   totalEvaluations > 0 ? totalScore / totalEvaluations : 0,
    };
  }
}

export default EvidenceGate;
