/**
 * VotingSystem — Weighted voting for promotions, admissions, and solutions.
 * 投票系统 — 用于晋升、准入和方案决策的加权投票。
 *
 * Implements vote weight calculation based on capability score, contribution
 * points, recent activity, and seniority. Supports rate-limited vote casting
 * (Bug #7 fix), proper dual-field close updates (Bug #2 fix), and threshold-
 * based resolution for promotion and admission votes.
 *
 * 基于能力评分、贡献积分、近期活跃度和资历实现投票权重计算。支持投票
 * 速率限制（Bug #7修复）、正确的双字段关闭更新（Bug #2修复）以及基于
 * 阈值的晋升和准入投票决议。
 *
 * @module layer2-engines/governance/voting-system
 * @author DEEP-IOS
 */

import { EventEmitter } from 'node:events';
import crypto from 'node:crypto';
import * as db from '../../layer1-core/db.js';
import { VotingError } from '../../layer1-core/errors.js';

// ---------------------------------------------------------------------------
// VotingSystem
// ---------------------------------------------------------------------------

class VotingSystem extends EventEmitter {
  /**
   * Create a VotingSystem instance.
   *
   * @param {object} [config={}] - Configuration object.
   * @param {object} [config.voting] - Voting behaviour parameters.
   * @param {number} [config.voting.promotionThreshold=0.6] - Approval rate required for promotions.
   * @param {number} [config.voting.admissionThreshold=0.5] - Approval rate required for admissions.
   * @param {number} [config.voting.voteExpiryHours=24] - Hours until a vote session expires.
   * @param {number} [config.voting.maxVotesPerAgentPerDay=20] - Daily voting limit per agent.
   */
  constructor(config = {}) {
    super();
    this.config = config;
    this.votingConfig = config.voting || {
      promotionThreshold: 0.6,
      admissionThreshold: 0.5,
      voteExpiryHours: 24,
      maxVotesPerAgentPerDay: 20,
    };
  }

  // -------------------------------------------------------------------------
  // Weight calculation
  // -------------------------------------------------------------------------

  /**
   * Calculate the voting weight for an agent based on their capability score,
   * contribution ranking, recent activity, and seniority.
   *
   * Uses the score snapshot stored in the DB rather than triggering a
   * real-time recalculation (R2 fix).
   *
   * @param {string} agentId - Agent identifier.
   * @returns {number} Integer voting weight (minimum 1).
   */
  calculateVotingWeight(agentId) {
    const agent = db.getAgent(agentId);
    if (!agent) return 1;

    // Capability weight: 40% of total_score
    const capabilityWeight = (agent.total_score || 0) * 0.4;

    // Contribution weight: relative to the highest contributor (30 points max)
    const maxContribRow = db.getDb().prepare(
      'SELECT MAX(contribution_points) AS max FROM agents',
    ).get();
    const maxContrib = maxContribRow?.max || 1;
    const contributionWeight = ((agent.contribution_points || 0) / (maxContrib || 1)) * 30;

    // Activity weight: recent task count in last 7 days (20 points max)
    const activityRow = db.getDb().prepare(
      "SELECT COUNT(*) AS cnt FROM contributions WHERE agent_id = ? AND timestamp > datetime('now', '-7 days')",
    ).get(agentId);
    const rawActivity = Math.min((activityRow?.cnt || 0) * 10, 100);
    const activityWeight = rawActivity * 0.2;

    // Seniority weight: days since registration (10 points max)
    let seniorityDays = 0;
    if (agent.created_at) {
      seniorityDays = Math.floor(
        (Date.now() - new Date(agent.created_at).getTime()) / 86400000,
      );
    }
    const rawSeniority = Math.min(seniorityDays, 100);
    const seniorityWeight = rawSeniority * 0.1;

    const totalWeight = capabilityWeight + contributionWeight + activityWeight + seniorityWeight;
    return Math.max(1, Math.floor(totalWeight));
  }

  // -------------------------------------------------------------------------
  // Vote session management
  // -------------------------------------------------------------------------

  /**
   * Create a new vote session for a target agent.
   *
   * @param {string} targetId - Agent or candidate being voted on.
   * @param {string} voteType - Vote type ('promotion', 'admission', or 'solution').
   * @param {object} [options={}] - Optional overrides.
   * @param {number} [options.expiryHours] - Custom expiry duration in hours.
   * @returns {{ voteId: string, targetId: string, voteType: string, expiresAt: string }}
   */
  createVote(targetId, voteType, options = {}) {
    const voteId = `vote_${crypto.randomBytes(8).toString('hex')}_${Date.now()}`;
    const expiryHours = options.expiryHours || this.votingConfig.voteExpiryHours;
    const expiresAt = new Date(Date.now() + expiryHours * 3600000).toISOString();

    db.createVoteResult(voteId, targetId, voteType, expiresAt);

    this.emit('voteCreated', { voteId, targetId, voteType, expiresAt });
    return { voteId, targetId, voteType, expiresAt };
  }

  /**
   * Cast a vote on an open vote session (Bug #7 fix: rate limiting).
   *
   * Validates the vote session exists and is still pending, checks for
   * duplicate votes, enforces the daily per-agent rate limit, and records
   * the weighted vote.
   *
   * @param {string} voteId - Vote session identifier.
   * @param {string} voterId - Voting agent's identifier.
   * @param {string} choice - Vote choice ('approve' or 'reject').
   * @returns {{ voteId: string, voterId: string, choice: string, weight: number }}
   * @throws {VotingError} On rate limit, closed/expired vote, or duplicate.
   */
  castVote(voteId, voterId, choice) {
    // Rate limit check (Bug #7 fix)
    const todayCount = db.getVotesCountToday(voterId);
    if (todayCount >= this.votingConfig.maxVotesPerAgentPerDay) {
      throw new VotingError('Daily vote limit exceeded', { voteId });
    }

    // Validate vote session exists
    const result = db.getVoteResult(voteId);
    if (!result) {
      throw new VotingError('Vote session not found', { voteId });
    }

    // Check session is still open
    if (result.status !== 'pending') {
      throw new VotingError('Vote is closed or expired', { voteId });
    }

    // Check expiry
    if (result.expires_at && new Date(result.expires_at).getTime() < Date.now()) {
      throw new VotingError('Vote session has expired', { voteId });
    }

    // Check for duplicate vote
    const existingVotes = db.getVotesByVoteId(voteId);
    const duplicate = existingVotes.find((v) => v.voter_id === voterId);
    if (duplicate) {
      throw new VotingError('Agent has already voted in this session', { voteId });
    }

    // Calculate weight and record
    const weight = this.calculateVotingWeight(voterId);

    db.createVoteRecord(
      voteId,
      voterId,
      result.target_id,
      result.vote_type,
      choice,
      weight,
      result.expires_at,
    );

    db.updateVoteResult(voteId, {
      total_weight: (result.total_weight || 0) + weight,
    });

    this.emit('voteCast', { voteId, voterId, choice, weight });
    return { voteId, voterId, choice, weight };
  }

  /**
   * Close a vote session and calculate the final result.
   *
   * Tallies approval and rejection weights, determines the outcome based on
   * vote type thresholds, and updates both the result and status fields
   * (Bug #2 fix: BOTH fields updated atomically).
   *
   * @param {string} voteId - Vote session identifier.
   * @returns {{ voteId: string, result: string, approvalRate: number, approvalWeight: number, rejectionWeight: number }}
   * @throws {VotingError} If the vote session is not found.
   */
  closeVote(voteId) {
    const voteResult = db.getVoteResult(voteId);
    if (!voteResult) {
      throw new VotingError('Vote session not found', { voteId });
    }

    const votes = db.getVotesByVoteId(voteId);

    let approvalWeight = 0;
    let rejectionWeight = 0;
    for (const v of votes) {
      if (v.choice === 'approve') {
        approvalWeight += v.weight;
      } else {
        rejectionWeight += v.weight;
      }
    }

    const totalWeight = approvalWeight + rejectionWeight;
    const approvalRate = totalWeight > 0 ? approvalWeight / totalWeight : 0;

    // Determine result based on vote type
    let resultStr;
    if (voteResult.vote_type === 'promotion') {
      resultStr = approvalRate >= this.votingConfig.promotionThreshold ? 'passed' : 'failed';
    } else if (voteResult.vote_type === 'admission') {
      resultStr = approvalRate >= this.votingConfig.admissionThreshold ? 'passed' : 'failed';
    } else {
      // Solution votes: simple majority
      resultStr = approvalWeight >= rejectionWeight ? 'passed' : 'failed';
    }

    // Bug #2 fix: update BOTH result AND status
    db.updateVoteResult(voteId, {
      result: resultStr,
      status: 'closed',
      approval_weight: approvalWeight,
      rejection_weight: rejectionWeight,
      concluded_at: new Date().toISOString(),
    });

    this.emit('voteClosed', { voteId, result: resultStr, approvalRate, approvalWeight, rejectionWeight });
    return { voteId, result: resultStr, approvalRate, approvalWeight, rejectionWeight };
  }

  // -------------------------------------------------------------------------
  // Convenience triggers
  // -------------------------------------------------------------------------

  /**
   * Trigger a promotion vote for an agent seeking a higher tier.
   *
   * Creates a vote session and returns the list of eligible senior/lead
   * voters.
   *
   * @param {string} agentId - Agent being considered for promotion.
   * @param {string} proposedTier - Target tier name.
   * @returns {{ voteId: string, targetId: string, proposedTier: string, eligibleVoters: object[] }}
   */
  triggerPromotionVote(agentId, proposedTier) {
    const { voteId } = this.createVote(agentId, 'promotion');

    const allAgents = db.listAgents('active');
    const eligibleVoters = allAgents.filter(
      (a) => (a.tier === 'senior' || a.tier === 'lead') && a.id !== agentId,
    );

    return { voteId, targetId: agentId, proposedTier, eligibleVoters };
  }

  /**
   * Trigger an admission vote for a new candidate.
   *
   * Creates a vote session and returns all voters at junior tier or above.
   *
   * @param {string} candidateId - Candidate agent identifier.
   * @returns {{ voteId: string, candidateId: string, eligibleVoters: object[] }}
   */
  triggerAdmissionVote(candidateId) {
    const { voteId } = this.createVote(candidateId, 'admission');

    const eligibleTiers = ['junior', 'mid', 'senior', 'lead'];
    const allAgents = db.listAgents('active');
    const eligibleVoters = allAgents.filter(
      (a) => eligibleTiers.includes(a.tier) && a.id !== candidateId,
    );

    return { voteId, candidateId, eligibleVoters };
  }

  /**
   * Evaluate competing solution proposals by aggregating voting weights.
   *
   * Each proposal's author receives their calculated voting weight. Solutions
   * are grouped, summed, and ranked to determine a winner.
   *
   * @param {Array<{agentId: string, solution: string}>} proposals - Array of solution proposals.
   * @returns {{ winner: string|null, winnerWeight: number, totalWeight: number, distribution: Array<{solution: string, weight: number}> }}
   */
  proposeSolution(proposals) {
    const solutionWeights = new Map();
    let totalWeight = 0;

    for (const proposal of proposals) {
      const weight = this.calculateVotingWeight(proposal.agentId);
      const current = solutionWeights.get(proposal.solution) || 0;
      solutionWeights.set(proposal.solution, current + weight);
      totalWeight += weight;
    }

    const distribution = [];
    for (const [solution, weight] of solutionWeights.entries()) {
      distribution.push({ solution, weight });
    }
    distribution.sort((a, b) => b.weight - a.weight);

    const winner = distribution.length > 0 ? distribution[0].solution : null;
    const winnerWeight = distribution.length > 0 ? distribution[0].weight : 0;

    return { winner, winnerWeight, totalWeight, distribution };
  }

  // -------------------------------------------------------------------------
  // Query helpers
  // -------------------------------------------------------------------------

  /**
   * Get full details for a vote session including all individual votes.
   *
   * @param {string} voteId - Vote session identifier.
   * @returns {object|null} Combined result and votes object, or null.
   */
  getVoteDetails(voteId) {
    const result = db.getVoteResult(voteId);
    if (!result) return null;

    const votes = db.getVotesByVoteId(voteId);
    return { ...result, votes };
  }

  /**
   * Get all pending (open and non-expired) vote sessions, optionally
   * filtered to a specific target agent.
   *
   * @param {string|null} [agentId=null] - Filter by target agent, or null for all.
   * @returns {object[]} Array of pending vote result records.
   */
  getPendingVotes(agentId = null) {
    const stmt = db.getDb().prepare(
      "SELECT * FROM vote_results WHERE status = 'pending' AND (expires_at IS NULL OR expires_at > datetime('now'))",
    );
    let pending = stmt.all();

    if (agentId) {
      pending = pending.filter((v) => v.target_id === agentId);
    }

    return pending;
  }
}

export { VotingSystem };
