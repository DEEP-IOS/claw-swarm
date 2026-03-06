/**
 * ReputationLedger — Contribution points, behavior tags, collaboration scoring,
 * and leaderboard.
 * 声誉账本 — 贡献积分、行为标签、协作评分与排行榜。
 *
 * Tracks agent contributions with quality/impact multipliers, auto-assigns
 * behavior tags based on performance thresholds, records pairwise collaboration
 * scores, and provides a contribution-based leaderboard. Normalizes collaboration
 * scores against the global maximum (Bug #1 / R6 fix).
 *
 * 跟踪代理贡献（含质量/影响力乘数），根据绩效阈值自动分配行为标签，
 * 记录成对协作评分，并提供基于贡献的排行榜。协作评分相对全局最大值
 * 进行归一化（Bug #1 / R6修复）。
 *
 * @module layer2-engines/governance/reputation-ledger
 * @author DEEP-IOS
 */

import { EventEmitter } from 'node:events';
import * as db from '../../layer1-core/db.js';

/** @type {Record<string, string>} Maps task.type values to contribution categories. */
const TASK_CATEGORY_MAP = {
  architecture: 'design',
  frontend:     'development',
  backend:      'development',
  testing:      'quality',
  security:     'quality',
  devops:       'operations',
  documentation: 'documentation',
};

class ReputationLedger extends EventEmitter {
  /**
   * Create a ReputationLedger instance.
   *
   * @param {object} [config={}] - Configuration object.
   * @param {object} [config.contribution] - Point calculation multipliers.
   * @param {number} [config.contribution.baseMultiplier=10] - Base points per complexity unit.
   * @param {number} [config.contribution.timeBonus=1.2] - Multiplier for early completion.
   * @param {number} [config.contribution.innovationBonus=1.3] - Multiplier for innovative work.
   * @param {number} [config.contribution.collaborationBonus=1.1] - Multiplier for helping others.
   */
  constructor(config = {}) {
    super();
    this.contributionConfig = config.contribution || {
      baseMultiplier: 10,
      timeBonus: 1.2,
      innovationBonus: 1.3,
      collaborationBonus: 1.1,
    };
  }

  /**
   * Record a contribution for an agent after completing a task.
   *
   * Calculates points, persists the contribution record, and updates the
   * agent's cumulative contribution_points.
   *
   * @param {string} agentId - The contributing agent's identifier.
   * @param {object} task - Task descriptor.
   * @param {string} task.id - Task identifier.
   * @param {number} [task.complexity=1] - Task complexity factor.
   * @param {string} [task.type] - Task type used for categorization.
   * @param {object} outcome - Task outcome metrics.
   * @param {number} [outcome.quality] - Quality score (0-1 range).
   * @param {number} [outcome.impact] - Impact score.
   * @param {boolean} [outcome.earlyCompletion] - Whether the task finished ahead of schedule.
   * @param {boolean} [outcome.hasInnovation] - Whether the solution was innovative.
   * @param {boolean} [outcome.helpedOthers] - Whether the agent assisted other agents.
   * @returns {{ points: number, category: string }} Calculated points and category.
   */
  recordContribution(agentId, task, outcome) {
    const points = this.calculatePoints(task, outcome);
    const category = this.categorizeTask(task);

    db.createContribution(
      agentId,
      task.id,
      points,
      category,
      outcome.quality,
      outcome.impact || null,
      null,
    );

    db.updateAgent(agentId, {
      contribution_points: db.getTotalPoints(agentId),
    });

    this.emit('contributionRecorded', { agentId, points, category });
    return { points, category };
  }

  /**
   * Calculate contribution points for a task/outcome pair.
   *
   * Applies base complexity scaling and conditional multipliers for quality,
   * timeliness, innovation, and collaboration.
   *
   * @param {object} task - Task descriptor.
   * @param {number} [task.complexity=1] - Complexity factor.
   * @param {object} outcome - Task outcome metrics.
   * @param {number} [outcome.quality=0] - Quality multiplier.
   * @param {boolean} [outcome.earlyCompletion] - Early completion flag.
   * @param {boolean} [outcome.hasInnovation] - Innovation flag.
   * @param {boolean} [outcome.helpedOthers] - Collaboration flag.
   * @returns {number} Rounded point value.
   */
  calculatePoints(task, outcome) {
    const base = (task.complexity || 1) * this.contributionConfig.baseMultiplier;
    const qualityMult = outcome.quality || 0;
    const timeMult = outcome.earlyCompletion
      ? this.contributionConfig.timeBonus
      : 1.0;
    const innovMult = outcome.hasInnovation
      ? this.contributionConfig.innovationBonus
      : 1.0;
    const collabMult = outcome.helpedOthers
      ? this.contributionConfig.collaborationBonus
      : 1.0;

    return Math.round(base * qualityMult * timeMult * innovMult * collabMult);
  }

  /**
   * Map a task's type to a contribution category.
   *
   * @param {object} task - Task descriptor.
   * @param {string} [task.type] - Raw task type string.
   * @returns {string} Contribution category (design, development, quality, operations, documentation, or general).
   */
  categorizeTask(task) {
    return TASK_CATEGORY_MAP[task.type] || 'general';
  }

  /**
   * Automatically assign behavior tags to an agent based on recent performance.
   *
   * Each metric is checked against a threshold; qualifying tags are persisted
   * via the DB and an event is emitted for each one.
   *
   * @param {string} agentId - Agent to evaluate.
   * @param {object} behavior - Aggregated behavior metrics.
   * @param {number} [behavior.avgCompletionRatio] - Average task completion ratio.
   * @param {number} [behavior.avgQuality] - Average quality score.
   * @param {number} [behavior.consistencyRate] - Rate of consistent output.
   * @param {number} [behavior.innovationCount] - Count of innovative contributions.
   * @param {number} [behavior.helpedOthersCount] - Count of collaboration assists.
   * @returns {void}
   */
  autoTag(agentId, behavior) {
    const tagChecks = [
      { condition: behavior.avgCompletionRatio < 0.8, tag: 'fast-executor', weight: 1.2 },
      { condition: behavior.avgQuality > 0.9,         tag: 'quality-guarantor', weight: 1.3 },
      { condition: behavior.consistencyRate > 0.95,    tag: 'reliable', weight: 1.1 },
      { condition: behavior.innovationCount > 5,       tag: 'innovator', weight: 1.2 },
      { condition: behavior.helpedOthersCount > 10,    tag: 'team-player', weight: 1.1 },
    ];

    for (const { condition, tag, weight } of tagChecks) {
      if (condition) {
        db.addBehaviorTag(agentId, tag, weight, 'auto');
        this.emit('behaviorTagged', { agentId, tag, weight });
      }
    }
  }

  /**
   * Get the combined tag weight multiplier for an agent.
   *
   * Returns the product of all assigned tag weights, or 1.0 if no tags exist.
   *
   * @param {string} agentId - Agent identifier.
   * @returns {number} Composite tag multiplier.
   */
  getTagMultiplier(agentId) {
    const tags = db.getBehaviorTags(agentId);
    if (tags.length === 0) return 1.0;
    return tags.reduce((product, t) => product * t.weight, 1.0);
  }

  /**
   * Record a collaboration event between two agents on a task.
   *
   * @param {string} agentAId - First agent identifier.
   * @param {string} agentBId - Second agent identifier.
   * @param {string} taskId - Task on which they collaborated.
   * @param {number} score - Collaboration quality score.
   * @returns {void}
   */
  recordCollaboration(agentAId, agentBId, taskId, score) {
    db.recordCollaboration(agentAId, agentBId, taskId, score);
    this.emit('collaborationRecorded', { agentAId, agentBId, taskId, score });
  }

  /**
   * Get the normalized collaboration score between two specific agents.
   *
   * Normalizes the pair's average score against the global maximum
   * collaboration score (Bug #1 fix — replaces hardcoded 0.5 fallback).
   *
   * @param {string} agentAId - First agent identifier.
   * @param {string} agentBId - Second agent identifier.
   * @returns {number} Normalized score between 0 and 1, or 0.5 if no data.
   */
  getCollaborationScore(agentAId, agentBId) {
    const raw = db.getCollaborationScore(agentAId, agentBId);
    const max = db.getMaxCollaborationScore();

    if (raw === null || max === null || max <= 0) return 0.5;
    return raw / max;
  }

  /**
   * Get a single agent's overall collaboration score, normalized globally.
   *
   * @param {string} agentId - Agent identifier.
   * @returns {number} Normalized average collaboration score, or 0.5 as fallback.
   */
  getAgentCollaborationScore(agentId) {
    const avg = db.getAgentAvgCollaboration(agentId);
    const max = db.getMaxCollaborationScore();

    if (avg === null || max === null || max <= 0) return 0.5;
    return avg / max;
  }

  /**
   * Get the contribution-based leaderboard of active agents.
   *
   * @param {number} [limit=10] - Maximum number of agents to return.
   * @returns {Array<{ id: string, name: string, role: string, tier: string, total_score: number, contribution_points: number }>}
   */
  getLeaderboard(limit = 10) {
    const stmt = db.getDb().prepare(
      `SELECT id, name, role, tier, total_score, contribution_points
       FROM agents
       WHERE status = 'active'
       ORDER BY contribution_points DESC
       LIMIT ?`,
    );
    return stmt.all(limit);
  }

  /**
   * Get an agent's total accumulated contribution points.
   *
   * @param {string} agentId - Agent identifier.
   * @returns {number} Total points.
   */
  getTotalPoints(agentId) {
    return db.getTotalPoints(agentId);
  }

  /**
   * Get an agent's recent contribution history.
   *
   * @param {string} agentId - Agent identifier.
   * @param {number} [limit=50] - Maximum records to return.
   * @returns {object[]} Contribution records ordered by timestamp descending.
   */
  getContributionHistory(agentId, limit = 50) {
    return db.getContributions(agentId, limit);
  }
}

export { ReputationLedger };
