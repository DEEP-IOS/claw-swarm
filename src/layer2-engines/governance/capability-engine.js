/**
 * CapabilityEngine — 4D capability scoring, tier management, task allocation,
 * and auto-evaluation.
 * 能力引擎 — 四维能力评分、等级管理、任务分配与自动评估。
 *
 * Maintains per-agent capability profiles across four weighted dimensions
 * (technical, delivery, collaboration, innovation) with sub-dimension detail.
 * Handles tier promotion/demotion with soft transitions (R1 fix), historical
 * bonus calculation with decay filtering (Bug #3 fix), cache invalidation on
 * both capability and contribution changes (Bug #6 fix), actual collaboration
 * scoring via ReputationLedger (Bug #1 fix), and documentation task type
 * support (Bug #4 fix).
 *
 * 维护每个代理在四个加权维度（技术、交付、协作、创新）上的能力档案，
 * 包含子维度详情。处理等级晋升/降级的软过渡（R1修复）、带衰减过滤的
 * 历史奖励计算（Bug #3修复）、能力和贡献变更时的缓存失效（Bug #6修复）、
 * 通过ReputationLedger的实际协作评分（Bug #1修复）以及文档任务类型支持
 * （Bug #4修复）。
 *
 * @module layer2-engines/governance/capability-engine
 * @author DEEP-IOS
 */

import { EventEmitter } from 'node:events';
import * as db from '../../layer1-core/db.js';
import { GovernanceError } from '../../layer1-core/errors.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Supported task type identifiers (Bug #4 fix: includes 'documentation'). */
const TASK_TYPES = [
  'architecture',
  'frontend',
  'backend',
  'database',
  'security',
  'testing',
  'devops',
  'documentation',
];

/** Weight multiplier for each skill proficiency level. */
const SKILL_LEVEL_WEIGHTS = {
  beginner: 0.5,
  intermediate: 1.0,
  advanced: 1.5,
  expert: 2.0,
};

/** Maps each task type to its relevant skill set for match scoring. */
const TASK_TYPE_SKILLS = {
  architecture: ['system-design', 'scalability', 'patterns'],
  frontend: ['javascript', 'react', 'ui-ux', 'css'],
  backend: ['api-design', 'database', 'performance', 'security'],
  database: ['sql', 'optimization', 'modeling'],
  security: ['auth', 'encryption', 'vulnerability'],
  testing: ['unit-test', 'integration-test', 'qa'],
  devops: ['ci-cd', 'docker', 'cloud', 'monitoring'],
  documentation: ['technical-writing', 'diagrams', 'documentation'],
};

/** Sub-dimensions within each top-level capability dimension. */
const SUB_DIMENSIONS = {
  technical: ['code-quality', 'architecture', 'debugging'],
  delivery: ['on-time', 'completeness', 'reliability'],
  collaboration: ['communication', 'knowledge-sharing', 'conflict-resolution'],
  innovation: ['creative-solutions', 'optimization', 'learning-speed'],
};

/** Ordered list of tier names from lowest to highest. */
const TIER_ORDER = ['trainee', 'junior', 'mid', 'senior', 'lead'];

// ---------------------------------------------------------------------------
// CapabilityEngine
// ---------------------------------------------------------------------------

class CapabilityEngine extends EventEmitter {
  /**
   * Create a CapabilityEngine instance.
   *
   * @param {object} [config={}] - Configuration object.
   * @param {object} [config.capability] - Capability dimension weights and scoring parameters.
   * @param {object} [config.tiers] - Tier definitions with minScore and taskLimit.
   * @param {object} [config.allocation] - Task allocation weight factors.
   * @param {object} [config.performance] - Performance tuning (cache TTL, precompute settings).
   */
  constructor(config = {}) {
    super();
    this.config = config;

    this.capConfig = config.capability || {
      dimensions: {
        technical: { weight: 0.4 },
        delivery: { weight: 0.3 },
        collaboration: { weight: 0.2 },
        innovation: { weight: 0.1 },
      },
      decayFactor: 0.9,
      maxHistoricalBonus: 10,
      initialScore: 50,
    };

    this.tierConfig = config.tiers || {
      trainee: { minScore: 0, taskLimit: 3 },
      junior: { minScore: 60, taskLimit: 5 },
      mid: { minScore: 75, taskLimit: 10 },
      senior: { minScore: 85, taskLimit: 15 },
      lead: { minScore: 92, taskLimit: 20 },
    };

    this.allocConfig = config.allocation || {
      skillWeight: 0.4,
      historyWeight: 0.3,
      loadWeight: 0.2,
      collaborationWeight: 0.1,
    };

    this.perfConfig = config.performance || {};

    // Profile cache (R6 fix: cleared on both capability AND contribution changes)
    this._cache = new Map();
    this._cacheTTL = this.perfConfig.cache?.ttl || 300000; // 5 min

    // Precomputed match matrix
    this._matchMatrix = new Map();
    this._precomputeInterval = null;

    // Ledger reference (set externally via setLedger)
    this._ledger = null;
    // EvaluationQueue reference (set externally via setEvaluationQueue)
    this._evaluationQueue = null;

    // Start precomputation if enabled
    if (this.perfConfig.precompute?.enabled) {
      this._startPrecompute();
    }
  }

  // -------------------------------------------------------------------------
  // External references
  // -------------------------------------------------------------------------

  /**
   * Set the reference to a ReputationLedger instance for collaboration scoring.
   *
   * @param {import('./reputation-ledger.js').ReputationLedger} ledger - Ledger instance.
   * @returns {void}
   */
  setLedger(ledger) {
    this._ledger = ledger;
  }

  /**
   * Set the reference to an EvaluationQueue instance for deferred scoring.
   *
   * @param {import('./evaluation-queue.js').EvaluationQueue} queue - Queue instance.
   * @returns {void}
   */
  setEvaluationQueue(queue) {
    this._evaluationQueue = queue;
  }

  // -------------------------------------------------------------------------
  // Agent registration
  // -------------------------------------------------------------------------

  /**
   * Register a new agent with initialized capabilities and optional skills.
   *
   * @param {object} agentData - Agent descriptor.
   * @param {string} agentData.id - Unique agent identifier (required).
   * @param {string} agentData.name - Display name (required).
   * @param {string} [agentData.role='general'] - Agent role.
   * @param {string} [agentData.tier='trainee'] - Starting tier.
   * @param {Array<{name: string, level: string}>} [agentData.skills] - Initial skill certifications.
   * @returns {object} The created agent record.
   * @throws {GovernanceError} If id or name is missing.
   */
  registerAgent(agentData) {
    if (!agentData.id || !agentData.name) {
      throw new GovernanceError('Agent id and name are required', {
        agentId: agentData.id || '',
      });
    }

    db.createAgent(
      agentData.id,
      agentData.name,
      agentData.role || 'general',
      agentData.tier || 'trainee',
    );

    this.initializeCapabilities(agentData.id);

    if (Array.isArray(agentData.skills)) {
      for (const skill of agentData.skills) {
        this.certifySkill(agentData.id, skill.name, skill.level);
      }
    }

    const agent = db.getAgent(agentData.id);
    this.emit('agentRegistered', agentData);
    return agent;
  }

  /**
   * Initialize the four capability dimensions and their sub-dimensions for an
   * agent at the configured initial score.
   *
   * @param {string} agentId - Agent identifier.
   * @returns {void}
   */
  initializeCapabilities(agentId) {
    const initial = this.capConfig.initialScore;

    for (const dimension of Object.keys(SUB_DIMENSIONS)) {
      db.createCapability(agentId, dimension, initial);

      for (const subDim of SUB_DIMENSIONS[dimension]) {
        db.createCapabilityDetail(agentId, dimension, subDim, initial);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Profile access
  // -------------------------------------------------------------------------

  /**
   * Get the full profile for an agent including capabilities, skills, and
   * behavior tags. Results are cached with a configurable TTL.
   *
   * @param {string} agentId - Agent identifier.
   * @returns {object|null} Agent profile object or null if not found.
   */
  getAgentProfile(agentId) {
    const cached = this._cache.get(agentId);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.data;
    }

    const agent = db.getAgent(agentId);
    if (!agent) return null;

    const capabilities = db.getCapabilities(agentId);
    const skills = db.getSkills(agentId);
    const tags = db.getBehaviorTags(agentId);

    const profile = { ...agent, capabilities, skills, tags };

    this._cache.set(agentId, {
      data: profile,
      expiresAt: Date.now() + this._cacheTTL,
    });

    return profile;
  }

  /**
   * Clear cached agent profiles. Pass an agentId to clear a single entry, or
   * omit to clear the entire cache (Bug #6 fix).
   *
   * @param {string|null} [agentId=null] - Specific agent to clear, or null for all.
   * @returns {void}
   */
  clearCache(agentId = null) {
    if (agentId) {
      this._cache.delete(agentId);
    } else {
      this._cache.clear();
    }
  }

  // -------------------------------------------------------------------------
  // Capability scoring
  // -------------------------------------------------------------------------

  /**
   * Update a single capability dimension score for an agent, optionally
   * including sub-dimension scores.
   *
   * @param {string} agentId - Agent identifier.
   * @param {string} dimension - Capability dimension name.
   * @param {number} score - New dimension score (0-100).
   * @param {object|null} [subScores=null] - Map of sub-dimension names to scores.
   * @returns {void}
   */
  updateCapabilityScore(agentId, dimension, score, subScores = null) {
    db.updateCapabilityScore(agentId, dimension, score);

    if (subScores && typeof subScores === 'object') {
      for (const [subDim, subScore] of Object.entries(subScores)) {
        db.createCapabilityDetail(agentId, dimension, subDim, subScore);
      }
    }

    this.clearCache(agentId); // Bug #6 fix
    this.emit('capabilityUpdated', { agentId, dimension, score });
  }

  /**
   * Recalculate and persist the total composite score for an agent.
   *
   * Computes the weighted sum of dimension scores plus a historical bonus
   * derived from recent completed contributions with decay (Bug #3 fix).
   *
   * @param {string} agentId - Agent identifier.
   * @returns {number} The updated total score (0-100).
   */
  updateTotalScore(agentId) {
    const capabilities = db.getCapabilities(agentId);

    let weightedSum = 0;
    for (const cap of capabilities) {
      const dimConfig = this.capConfig.dimensions[cap.dimension];
      if (dimConfig) {
        weightedSum += cap.score * dimConfig.weight;
      }
    }

    const historicalBonus = this.calculateHistoricalBonus(agentId);
    let total = weightedSum + historicalBonus;
    total = Math.max(0, Math.min(100, total));

    db.updateAgent(agentId, { total_score: total });
    this.clearCache(agentId);

    return total;
  }

  /**
   * Calculate the historical performance bonus for an agent.
   *
   * Only considers contributions with a non-null quality_score (Bug #3 fix —
   * filters to completed tasks only). Requires at least 5 qualifying
   * contributions before awarding any bonus. Applies exponential decay so
   * recent work is weighted more heavily.
   *
   * @param {string} agentId - Agent identifier.
   * @returns {number} Historical bonus value, capped at maxHistoricalBonus.
   */
  calculateHistoricalBonus(agentId) {
    const contributions = db.getContributions(agentId, 10);
    const qualifying = contributions.filter(
      (c) => c.quality_score !== null && c.quality_score !== undefined,
    );

    if (qualifying.length < 5) return 0;

    const decay = this.capConfig.decayFactor;
    let sum = 0;
    for (let i = 0; i < qualifying.length; i++) {
      sum += qualifying[i].quality_score * Math.pow(decay, i);
    }

    return Math.min(sum, this.capConfig.maxHistoricalBonus);
  }

  // -------------------------------------------------------------------------
  // Task evaluation
  // -------------------------------------------------------------------------

  /**
   * Evaluate an agent's performance after completing a task and update
   * capability scores accordingly. When an EvaluationQueue is configured,
   * updates are deferred; otherwise they are applied immediately.
   *
   * @param {string} agentId - Agent identifier.
   * @param {object} task - Task descriptor with at least `id` and `type`.
   * @param {object} outcome - Task outcome metrics (quality, impact, flags).
   * @returns {void}
   */
  evaluateTaskCompletion(agentId, task, outcome) {
    const updates = this.calculateDimensionUpdates(task, outcome);

    if (this._evaluationQueue) {
      this._evaluationQueue.enqueue(agentId, {
        dimension: updates.dimension,
        score: updates.scoreDelta,
        task,
        outcome,
      });
    } else {
      const capabilities = db.getCapabilities(agentId);
      const current = capabilities.find((c) => c.dimension === updates.dimension);
      const currentScore = current ? current.score : this.capConfig.initialScore;
      const newScore = Math.max(0, Math.min(100, currentScore + updates.scoreDelta));

      this.updateCapabilityScore(agentId, updates.dimension, newScore);
      this.updateTotalScore(agentId);
    }

    this.clearCache(agentId); // Bug #6 fix — also clear on contribution
    this.emit('taskEvaluated', { agentId, task, outcome, updates });
  }

  /**
   * Map a task type and outcome to the primary capability dimension and score
   * delta (Bug #4 fix: includes 'documentation' task type).
   *
   * @param {object} task - Task descriptor.
   * @param {string} [task.type] - Task type identifier.
   * @param {object} outcome - Task outcome metrics.
   * @param {number} [outcome.quality=0] - Quality score (0-1).
   * @param {boolean} [outcome.helpedOthers] - Whether collaboration occurred.
   * @param {boolean} [outcome.hasInnovation] - Whether innovation was demonstrated.
   * @returns {{ dimension: string, scoreDelta: number }}
   */
  calculateDimensionUpdates(task, outcome) {
    let dimension = 'technical';

    const type = task.type || '';
    if (['architecture', 'backend', 'frontend', 'database', 'documentation'].includes(type)) {
      dimension = 'technical';
    } else if (['testing', 'devops'].includes(type)) {
      dimension = 'delivery';
    }

    if (outcome.helpedOthers) {
      dimension = 'collaboration';
    }
    if (outcome.hasInnovation) {
      dimension = 'innovation';
    }

    return {
      dimension,
      scoreDelta: (outcome.quality || 0) * 10,
    };
  }

  // -------------------------------------------------------------------------
  // Tier management
  // -------------------------------------------------------------------------

  /**
   * Evaluate whether an agent is eligible for a tier change (promotion,
   * demotion, or suspension).
   *
   * @param {string} agentId - Agent identifier.
   * @returns {object|null} Tier change recommendation, or null if agent not found.
   */
  evaluateTierChange(agentId) {
    const agent = db.getAgent(agentId);
    if (!agent) return null;

    const score = agent.total_score || 0;
    const currentTier = agent.tier;
    const currentIdx = TIER_ORDER.indexOf(currentTier);

    // Check promotion eligibility
    if (currentIdx < TIER_ORDER.length - 1) {
      const nextTier = TIER_ORDER[currentIdx + 1];
      const nextMinScore = this.tierConfig[nextTier].minScore;
      if (score >= nextMinScore) {
        return {
          eligible: true,
          type: 'promotion',
          from: currentTier,
          to: nextTier,
          score,
          reason: `Score ${score} meets ${nextTier} threshold (${nextMinScore})`,
        };
      }
    }

    // Check demotion eligibility
    if (currentIdx > 0) {
      const currentMinScore = this.tierConfig[currentTier].minScore;
      if (score < currentMinScore - 10) {
        const prevTier = TIER_ORDER[currentIdx - 1];
        return {
          eligible: true,
          type: 'demotion',
          from: currentTier,
          to: prevTier,
          score,
          reason: `Score ${score} fell below ${currentTier} threshold minus buffer (${currentMinScore - 10})`,
        };
      }
    }

    // Check suspension (7+ failures in last 10 tasks)
    if (agent.failure_count > 0) {
      const recent = db.getContributions(agentId, 10);
      const failures = recent.filter(
        (c) => c.quality_score !== null && c.quality_score < 0.3,
      ).length;
      if (failures >= 7) {
        return {
          eligible: true,
          type: 'suspension',
          from: currentTier,
          to: null,
          score,
          reason: `${failures} failures in last 10 tasks exceeds suspension threshold`,
        };
      }
    }

    return { eligible: false, score };
  }

  /**
   * Apply a tier change to an agent (R1 fix: soft transition with grace
   * period for demotions when the agent has active tasks exceeding the new
   * tier limit).
   *
   * @param {string} agentId - Agent identifier.
   * @param {object} change - Tier change recommendation from evaluateTierChange.
   * @param {string} change.type - Change type: 'promotion', 'demotion', or 'suspension'.
   * @param {string} [change.to] - Target tier name.
   * @returns {void}
   */
  applyTierChange(agentId, change) {
    const activeTasks = db.getDb().prepare(
      "SELECT COUNT(*) AS cnt FROM swarm_tasks WHERE status = 'executing'",
    ).get();
    const activeTaskCount = activeTasks?.cnt || 0;

    if (change.type === 'demotion') {
      const newTierLimit = this.tierConfig[change.to]?.taskLimit || 0;
      if (activeTaskCount > newTierLimit) {
        db.updateAgent(agentId, { status: 'active', tier: change.to });
        console.log(
          `[SwarmLite] Agent ${agentId} demoted to ${change.to} with grace period ` +
          `(${activeTaskCount} active tasks exceed limit ${newTierLimit})`,
        );
      } else {
        db.updateAgent(agentId, { tier: change.to });
      }
    } else if (change.type === 'promotion') {
      db.updateAgent(agentId, { tier: change.to });
    } else if (change.type === 'suspension') {
      db.updateAgent(agentId, { status: 'suspended' });
    }

    this.clearCache(agentId);
    this.emit('tierChanged', { agentId, change });
  }

  // -------------------------------------------------------------------------
  // Skill certification
  // -------------------------------------------------------------------------

  /**
   * Certify a skill for an agent with a proficiency level and optional
   * evidence. Skills expire after one year.
   *
   * @param {string} agentId - Agent identifier.
   * @param {string} skillName - Skill name (e.g. 'javascript', 'sql').
   * @param {string} level - Proficiency level (beginner, intermediate, advanced, expert).
   * @param {string|null} [evidence=null] - Evidence or notes supporting the certification.
   * @returns {void}
   */
  certifySkill(agentId, skillName, level, evidence = null) {
    const expiryDate = new Date(Date.now() + 365 * 24 * 3600000).toISOString();

    db.createSkill(agentId, skillName, level, evidence, null, expiryDate);

    this.clearCache(agentId);
    this.emit('skillCertified', { agentId, skillName, level });
  }

  // -------------------------------------------------------------------------
  // Task allocation
  // -------------------------------------------------------------------------

  /**
   * Allocate the best-matching agent(s) for a task based on skills, history,
   * load, and collaboration scores.
   *
   * @param {object} task - Task descriptor.
   * @param {string} task.type - Task type (must be one of TASK_TYPES).
   * @param {number} [task.requiredAgents=1] - Number of agents to allocate.
   * @param {string[]|null} [availableAgents=null] - Candidate agent IDs, or null for all active.
   * @returns {Array<{agentId: string, score: number, reasons: string[]}>} Ranked allocations.
   */
  allocateTask(task, availableAgents = null) {
    const agentIds = availableAgents || db.listAgents('active').map((a) => a.id);
    const scored = [];

    for (const agentId of agentIds) {
      const matrixKey = `${agentId}:${task.type}`;
      let score = this._matchMatrix.get(matrixKey);

      if (score === undefined) {
        score = this.calculateMatchScore(agentId, task.type);
      }

      const reasons = this._getAllocationReasons(agentId, task.type, score);
      scored.push({ agentId, score, reasons });
    }

    scored.sort((a, b) => b.score - a.score);

    const count = task.requiredAgents || 1;
    return scored.slice(0, count);
  }

  /**
   * Calculate the composite match score between an agent and a task type
   * (Bug #1 fix: uses actual collaboration score from ReputationLedger
   * instead of a hardcoded fallback).
   *
   * @param {string} agentId - Agent identifier.
   * @param {string} taskType - Task type identifier.
   * @returns {number} Weighted match score.
   */
  calculateMatchScore(agentId, taskType) {
    // Skill match
    const requiredSkills = TASK_TYPE_SKILLS[taskType] || [];
    let skillMatch = 0;
    if (requiredSkills.length > 0) {
      let totalWeight = 0;
      for (const skill of requiredSkills) {
        const level = db.getAgentSkillLevel(agentId, skill);
        if (level) {
          totalWeight += SKILL_LEVEL_WEIGHTS[level] || 0;
        }
      }
      skillMatch = totalWeight / (requiredSkills.length * SKILL_LEVEL_WEIGHTS.expert);
    }

    // History score
    const agent = db.getAgent(agentId);
    const historyScore = ((agent?.total_score) || 50) / 100;

    // Load score
    const tierLimit = this.tierConfig[agent?.tier || 'trainee']?.taskLimit || 3;
    const activeTaskRow = db.getDb().prepare(
      "SELECT COUNT(*) AS cnt FROM swarm_tasks WHERE status = 'executing'",
    ).get();
    const activeTaskCount = activeTaskRow?.cnt || 0;
    const loadScore = Math.max(0, 1 - (activeTaskCount / tierLimit));

    // Collaboration score (Bug #1 fix: actual collab score via ledger)
    let collabScore = 0.5;
    if (this._ledger) {
      collabScore = this._ledger.getAgentCollaborationScore(agentId);
    }

    return (
      skillMatch * this.allocConfig.skillWeight +
      historyScore * this.allocConfig.historyWeight +
      loadScore * this.allocConfig.loadWeight +
      collabScore * this.allocConfig.collaborationWeight
    );
  }

  /**
   * Build an array of human-readable allocation reasons for an agent-task
   * match.
   *
   * @param {string} agentId - Agent identifier.
   * @param {string} taskType - Task type identifier.
   * @param {number} score - Computed match score.
   * @returns {string[]} Reason codes.
   * @private
   */
  _getAllocationReasons(agentId, taskType, score) {
    const reasons = [];

    // Compute individual components for reason tagging
    const requiredSkills = TASK_TYPE_SKILLS[taskType] || [];
    if (requiredSkills.length > 0) {
      let totalWeight = 0;
      for (const skill of requiredSkills) {
        const level = db.getAgentSkillLevel(agentId, skill);
        if (level) {
          totalWeight += SKILL_LEVEL_WEIGHTS[level] || 0;
        }
      }
      const skillMatch = totalWeight / (requiredSkills.length * SKILL_LEVEL_WEIGHTS.expert);
      if (skillMatch > 0.7) reasons.push('high-skill-match');
    }

    const agent = db.getAgent(agentId);
    const historyScore = ((agent?.total_score) || 50) / 100;
    if (historyScore > 0.8) reasons.push('proven-track-record');

    const tierLimit = this.tierConfig[agent?.tier || 'trainee']?.taskLimit || 3;
    const activeTaskRow = db.getDb().prepare(
      "SELECT COUNT(*) AS cnt FROM swarm_tasks WHERE status = 'executing'",
    ).get();
    const activeTaskCount = activeTaskRow?.cnt || 0;
    const loadScore = Math.max(0, 1 - (activeTaskCount / tierLimit));
    if (loadScore > 0.8) reasons.push('low-load');

    return reasons.length > 0 ? reasons : ['default-assignment'];
  }

  // -------------------------------------------------------------------------
  // Match matrix precomputation
  // -------------------------------------------------------------------------

  /**
   * Precompute the match score matrix for all active agents across all task
   * types. Results are stored in an internal map keyed by `agentId:taskType`.
   *
   * @returns {void}
   */
  precomputeMatchMatrix() {
    const agents = db.listAgents('active');

    for (const agent of agents) {
      for (const taskType of TASK_TYPES) {
        const score = this.calculateMatchScore(agent.id, taskType);
        this._matchMatrix.set(`${agent.id}:${taskType}`, score);
      }
    }

    this.emit('matrixPrecomputed', { agentCount: agents.length, taskTypes: TASK_TYPES.length });
  }

  /**
   * Start periodic match matrix precomputation.
   *
   * @returns {void}
   * @private
   */
  _startPrecompute() {
    this.precomputeMatchMatrix();

    this._precomputeInterval = setInterval(
      () => this.precomputeMatchMatrix(),
      this.perfConfig.precompute?.updateInterval || 3600000,
    );
    this._precomputeInterval.unref();
  }

  // -------------------------------------------------------------------------
  // Auto-evaluation
  // -------------------------------------------------------------------------

  /**
   * Run automatic tier evaluation for all active agents. Emits a
   * `tierChangeRecommended` event for each eligible agent and an
   * `autoEvaluationCompleted` event when finished.
   *
   * @returns {void}
   */
  runAutoEvaluation() {
    const agents = db.listAgents('active');
    const recommendations = [];

    for (const agent of agents) {
      const result = this.evaluateTierChange(agent.id);
      if (result && result.eligible) {
        recommendations.push({ agentId: agent.id, ...result });
        this.emit('tierChangeRecommended', { agentId: agent.id, ...result });
      }
    }

    this.emit('autoEvaluationCompleted', { evaluated: agents.length, recommendations });
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /**
   * Gracefully shut down the capability engine. Stops the precomputation
   * interval and clears the profile cache.
   *
   * @returns {void}
   */
  shutdown() {
    if (this._precomputeInterval) {
      clearInterval(this._precomputeInterval);
      this._precomputeInterval = null;
    }

    this._cache.clear();
  }
}

export { CapabilityEngine };
