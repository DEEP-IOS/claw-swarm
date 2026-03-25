/**
 * ContractNet -- 合同网协议实现
 * Implements the Contract Net Protocol for task allocation:
 * issue a Call-For-Proposals, collect bids from candidate roles,
 * and evaluate them with a weighted scoring function that adapts
 * to budget, time, and risk constraints.
 *
 * @module orchestration/scheduling/contract-net
 * @version 9.0.0
 */

import { ModuleBase } from '../../core/module-base.js'
import { DIM_TASK, DIM_TRUST, DIM_REPUTATION } from '../../core/field/types.js'

// ── helpers ────────────────────────────────────────────────────────
const clamp = (v, min, max) => Math.min(Math.max(v, min), max)

/**
 * @typedef {Object} Bid
 * @property {string} roleId          - candidate role identifier
 * @property {string} cost            - 'CHEAP'|'MODERATE'|'EXPENSIVE'
 * @property {number} qualityEstimate - estimated output quality [0,1]
 * @property {number} speedEstimate   - estimated speed factor [0,1]
 * @property {number} trustScore      - trust from signal field [0,1]
 * @property {number} capabilityScore - capability match score [0,1]
 */

/**
 * @typedef {Object} EvaluationResult
 * @property {Bid}    winner - the winning bid
 * @property {number} score  - final score of the winner
 * @property {string} reason - human-readable rationale
 */

// ── main class ─────────────────────────────────────────────────────

export class ContractNet extends ModuleBase {
  /** @returns {string[]} */
  static produces() { return [DIM_TASK] }
  /** @returns {string[]} */
  static consumes() { return [DIM_TRUST, DIM_REPUTATION] }
  /** @returns {string[]} */
  static publishes() { return ['contract.cfp.issued', 'contract.bid.evaluated', 'contract.awarded'] }
  /** @returns {string[]} */
  static subscribes() { return [] }

  /**
   * @param {Object} opts
   * @param {Object} opts.field            - SignalField / SignalStore instance
   * @param {Object} opts.bus              - EventBus instance
   * @param {Object} [opts.capabilityEngine] - capability engine for role matching
   */
  constructor({ field, bus, capabilityEngine }) {
    super()
    /** @private */ this._field = field
    /** @private */ this._bus = bus
    /** @private */ this._capabilityEngine = capabilityEngine ?? null
    /** @private */
    this._stats = {
      cfpIssued: 0,
      bidsEvaluated: 0,
      awards: 0,
      lastWinner: null,
    }
  }

  // ════════════════════════════════════════════════════════════════
  //  PUBLIC API
  // ════════════════════════════════════════════════════════════════

  /**
   * Issue a Call-For-Proposals and generate bids for each candidate role.
   *
   * @param {Object}   task           - task descriptor
   * @param {string[]} candidateRoles - role ids to consider
   * @returns {Bid[]} generated bids, one per candidate
   */
  issueCall(task, candidateRoles) {
    if (!Array.isArray(candidateRoles) || candidateRoles.length === 0) return []

    if (typeof this._bus?.publish === 'function') {
      this._bus.publish('contract.cfp.issued', { task, candidateRoles, ts: Date.now() })
    }
    this._stats.cfpIssued++

    return candidateRoles.map((roleId) => ({
      roleId,
      cost: this._estimateCost(roleId),
      qualityEstimate: this._estimateQuality(roleId, task),
      speedEstimate: this._estimateSpeed(roleId, task),
      trustScore: this._getTrustScore(roleId),
      capabilityScore: this._getCapabilityScore(roleId, task),
    }))
  }

  /**
   * Evaluate a set of bids and select a winner.
   *
   * Scoring formula:
   *   base = capability * 0.35 + trust * 0.25 + quality * 0.25
   *   + (budgetTight && cost=CHEAP) → +0.15
   *   + (timeTight && speed high) → +0.15
   *   + (riskHigh) → quality * 0.15 extra
   *
   * @param {Bid[]}  bids
   * @param {Object} [constraints]
   * @param {boolean} [constraints.budgetTight] - is budget constrained?
   * @param {boolean} [constraints.timeTight]   - is time constrained?
   * @param {boolean} [constraints.riskHigh]    - is risk elevated?
   * @returns {EvaluationResult|null} null if no bids
   */
  evaluateBids(bids, constraints = {}) {
    if (!Array.isArray(bids) || bids.length === 0) return null

    let bestBid = null
    let bestScore = -Infinity
    let bestReason = ''

    for (const bid of bids) {
      let score =
        (bid.capabilityScore ?? 0) * 0.35 +
        (bid.trustScore ?? 0) * 0.25 +
        (bid.qualityEstimate ?? 0) * 0.25

      const bonuses = []

      // Budget-tight bonus for cheap candidates
      if (constraints.budgetTight && bid.cost === 'CHEAP') {
        score += 0.15
        bonuses.push('budget-bonus')
      }

      // Time-tight bonus for fast candidates
      if (constraints.timeTight && (bid.speedEstimate ?? 0) > 0.7) {
        score += 0.15
        bonuses.push('speed-bonus')
      }

      // Risk-high extra weight on quality
      if (constraints.riskHigh) {
        score += (bid.qualityEstimate ?? 0) * 0.15
        bonuses.push('quality-risk-bonus')
      }

      if (score > bestScore) {
        bestScore = score
        bestBid = bid
        bestReason = `${bid.roleId}: base=${(score - bonuses.length * 0.15).toFixed(3)}` +
          (bonuses.length > 0 ? ` + ${bonuses.join('+')}` : '') +
          ` = ${score.toFixed(3)}`
      }
    }

    if (typeof this._bus?.publish === 'function') {
      this._bus.publish('contract.bid.evaluated', { bids, winner: bestBid, score: bestScore })
      this._bus.publish('contract.awarded', { winner: bestBid, score: bestScore, reason: bestReason })
    }
    this._stats.bidsEvaluated += bids.length
    this._stats.awards++
    this._stats.lastWinner = bestBid ? {
      roleId: bestBid.roleId,
      score: bestScore,
      reason: bestReason,
    } : null

    return { winner: bestBid, score: bestScore, reason: bestReason }
  }

  getStats() {
    return {
      ...this._stats,
    }
  }

  // ════════════════════════════════════════════════════════════════
  //  PRIVATE — Estimation Helpers
  // ════════════════════════════════════════════════════════════════

  /**
   * Estimate cost tier for a role based on its preferred model.
   * @private
   * @param {string} roleId
   * @returns {string} 'CHEAP'|'MODERATE'|'EXPENSIVE'
   */
  _estimateCost(roleId) {
    // heuristic: role name hints at complexity
    const lower = (roleId || '').toLowerCase()
    if (lower.includes('fast') || lower.includes('light')) return 'CHEAP'
    if (lower.includes('strong') || lower.includes('expert')) return 'EXPENSIVE'
    return 'MODERATE'
  }

  /**
   * Estimate output quality for a role on a given task.
   * @private
   * @param {string} roleId
   * @param {Object} task
   * @returns {number} [0,1]
   */
  _estimateQuality(roleId, task) {
    const capScore = this._getCapabilityScore(roleId, task)
    // quality positively correlated with capability
    return clamp(capScore * 0.8 + 0.1, 0, 1)
  }

  /**
   * Estimate speed factor for a role on a given task.
   * @private
   * @param {string} roleId
   * @param {Object} task
   * @returns {number} [0,1]
   */
  _estimateSpeed(roleId, task) {
    const lower = (roleId || '').toLowerCase()
    if (lower.includes('fast') || lower.includes('light')) return 0.9
    if (lower.includes('strong') || lower.includes('expert')) return 0.4
    return 0.6
  }

  /**
   * Read trust score from signal field for the given role scope.
   * @private
   * @param {string} roleId
   * @returns {number} [0,1]
   */
  _getTrustScore(roleId) {
    if (typeof this._field?.query !== 'function') return 0.5
    try {
      const results = this._field.query({ scope: roleId, dimension: DIM_TRUST, limit: 1 })
      if (Array.isArray(results) && results.length > 0) {
        return typeof results[0].strength === 'number' ? clamp(results[0].strength, 0, 1) : 0.5
      }
      if (typeof results === 'number') return clamp(results, 0, 1)
    } catch (_) { /* ignore */ }
    return 0.5
  }

  /**
   * Get capability score, using the capability engine if available.
   * @private
   * @param {string} roleId
   * @param {Object} task
   * @returns {number} [0,1]
   */
  _getCapabilityScore(roleId, task) {
    if (typeof this._capabilityEngine?.score === 'function') {
      try {
        const s = this._capabilityEngine.score(roleId, task)
        if (typeof s === 'number' && Number.isFinite(s)) return clamp(s, 0, 1)
      } catch (_) { /* ignore */ }
    }
    // default heuristic: 0.5
    return 0.5
  }
}

export default ContractNet
