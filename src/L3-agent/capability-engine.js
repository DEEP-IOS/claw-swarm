/**
 * CapabilityEngine — 8D 能力评估 + PARL 阶段奖励 / 8D Capability Assessment + PARL Reward
 *
 * v4.x 迁移增强: 从 4D (technical/delivery/collaboration/innovation) 扩展到 8D
 * (coding/architecture/testing/documentation/security/performance/communication/domain),
 * 新增 PARL (Phase-Adaptive Reward Learning) 机制, 根据项目进度自动调节
 * 速度权重与质量权重的比例。
 *
 * Migrated from v4.x and enhanced: expanded from 4D to 8D capability dimensions,
 * with PARL (Phase-Adaptive Reward Learning) that dynamically adjusts speed/quality
 * weighting based on project progress percentage.
 *
 * PARL 三阶段 / PARL Three Phases:
 *   progress < 30%:  speed×0.7 + quality×0.3  (探索期 / Exploration)
 *   progress 30-70%: speed×0.4 + quality×0.6  (收敛期 / Convergence)
 *   progress > 70%:  speed×0.2 + quality×0.8  (开发期 / Exploitation)
 *
 * @module L3-agent/capability-engine
 * @author DEEP-IOS
 */

import { CapabilityDimension } from '../L1-infrastructure/types.js';

// ============================================================================
// 常量 / Constants
// ============================================================================

/**
 * V5.0 八维能力维度列表 / V5.0 Eight capability dimensions
 * @type {string[]}
 */
const DIMENSIONS_8D = [
  CapabilityDimension.coding,
  CapabilityDimension.architecture,
  CapabilityDimension.testing,
  CapabilityDimension.documentation,
  CapabilityDimension.security,
  CapabilityDimension.performance,
  CapabilityDimension.communication,
  CapabilityDimension.domain,
];

/**
 * 每个维度的默认权重 (均匀分配) / Default weight per dimension (uniform)
 * @type {Record<string, number>}
 */
const DEFAULT_DIMENSION_WEIGHTS = Object.freeze({
  coding: 0.20,
  architecture: 0.15,
  testing: 0.12,
  documentation: 0.08,
  security: 0.12,
  performance: 0.10,
  communication: 0.10,
  domain: 0.13,
});

/**
 * PARL 阶段定义 / PARL phase definitions
 * 每阶段对应不同的 speedWeight/qualityWeight 组合
 * Each phase has different speed/quality weight combinations.
 * @type {Array<{name: string, maxProgress: number, speedWeight: number, qualityWeight: number}>}
 */
const PARL_PHASES = [
  { name: 'exploration',  maxProgress: 30,  speedWeight: 0.7, qualityWeight: 0.3 },
  { name: 'convergence',  maxProgress: 70,  speedWeight: 0.4, qualityWeight: 0.6 },
  { name: 'exploitation', maxProgress: 100, speedWeight: 0.2, qualityWeight: 0.8 },
];

/**
 * 任务类型到主维度的映射 / Task type to primary dimension mapping
 * @type {Record<string, string>}
 */
const TASK_TYPE_DIMENSION_MAP = {
  coding: 'coding',
  architecture: 'architecture',
  testing: 'testing',
  documentation: 'documentation',
  security: 'security',
  performance: 'performance',
  communication: 'communication',
  domain: 'domain',
  frontend: 'coding',
  backend: 'coding',
  database: 'architecture',
  devops: 'performance',
  design: 'architecture',
};

/** 默认初始分数 / Default initial score */
const DEFAULT_INITIAL_SCORE = 50;

/** 分数衰减因子 / Score decay factor for historical weighting */
const DECAY_FACTOR = 0.95;

/** 学习率 — 新证据对分数的更新速率 / Learning rate for score updates */
const LEARNING_RATE = 0.15;

// ============================================================================
// CapabilityEngine
// ============================================================================

export class CapabilityEngine {
  /**
   * @param {Object} deps - 依赖注入 / Dependency injection
   * @param {import('../L1-infrastructure/database/repositories/agent-repo.js').AgentRepository} deps.agentRepo
   * @param {import('../L2-communication/message-bus.js').MessageBus} deps.messageBus
   * @param {Object} deps.logger
   * @param {Object} [deps.config] - 可选配置覆盖 / Optional config overrides
   */
  constructor({ agentRepo, messageBus, logger, config = {} }) {
    /** @private */
    this._agentRepo = agentRepo;
    /** @private */
    this._messageBus = messageBus;
    /** @private */
    this._logger = logger;

    // 维度权重可配置 / Dimension weights are configurable
    /** @private */
    this._dimensionWeights = config.dimensionWeights || { ...DEFAULT_DIMENSION_WEIGHTS };

    /** @private */
    this._initialScore = config.initialScore ?? DEFAULT_INITIAL_SCORE;

    /** @private */
    this._learningRate = config.learningRate ?? LEARNING_RATE;

    /** @private */
    this._decayFactor = config.decayFactor ?? DECAY_FACTOR;

    // 内存缓存: agentId → { dimensions, overallScore, updatedAt }
    // Memory cache: agentId → { dimensions, overallScore, updatedAt }
    /** @private */
    this._cache = new Map();

    /** @private */
    this._cacheTTL = config.cacheTTL ?? 300_000; // 5 min
  }

  // --------------------------------------------------------------------------
  // 8D 能力评估 / 8D Capability Evaluation
  // --------------------------------------------------------------------------

  /**
   * 评估 agent 在任务结果后的能力 / Evaluate agent capability after task outcome
   *
   * 根据任务结果更新相关维度分数, 应用 PARL 奖励计算。
   * Updates relevant dimension scores based on task outcome with PARL reward.
   *
   * @param {string} agentId
   * @param {Object} taskOutcome
   * @param {string} taskOutcome.taskType - 任务类型 / Task type
   * @param {boolean} taskOutcome.success - 是否成功 / Whether succeeded
   * @param {number} taskOutcome.quality - 质量评分 0-1 / Quality score 0-1
   * @param {number} taskOutcome.speed - 速度评分 0-1 / Speed score 0-1
   * @param {number} taskOutcome.complexity - 复杂度 1-10 / Complexity 1-10
   * @param {string[]} [taskOutcome.dimensions] - 涉及的维度 / Involved dimensions
   * @param {number} [taskOutcome.progressPercent] - 项目进度百分比 / Project progress %
   * @returns {{ dimensions: Record<string, number>, overallScore: number }}
   */
  evaluate(agentId, taskOutcome) {
    const {
      taskType,
      success,
      quality = 0,
      speed = 0,
      complexity = 1,
      dimensions: involvedDimensions,
      progressPercent = 50,
    } = taskOutcome;

    // 确定受影响的维度 / Determine affected dimensions
    const affectedDims = this._resolveAffectedDimensions(taskType, involvedDimensions);

    // 计算 PARL 奖励 / Compute PARL reward
    const reward = this.computePARLReward(taskOutcome, progressPercent);

    // 复杂度缩放: 更复杂的任务影响更大 / Complexity scaling
    const complexityScale = Math.min(complexity / 5, 2.0);

    // 成功/失败调整 / Success/failure adjustment
    const successMultiplier = success ? 1.0 : -0.5;

    // 获取当前档案 / Get current profile
    const profile = this.getCapabilityProfile(agentId);
    const updatedDimensions = { ...profile };

    // 更新受影响的维度 / Update affected dimensions
    for (const dim of affectedDims) {
      const currentScore = profile[dim] ?? this._initialScore;
      const delta = reward * complexityScale * successMultiplier * this._learningRate * 100;
      const newScore = Math.max(0, Math.min(100, currentScore + delta));
      updatedDimensions[dim] = Math.round(newScore * 100) / 100;

      // 持久化到数据库 / Persist to database
      this._agentRepo.updateCapabilityScore(agentId, dim, updatedDimensions[dim]);
    }

    // 计算综合评分 / Compute overall score
    const overallScore = this._computeOverallScore(updatedDimensions);

    // 清除缓存 / Clear cache
    this._cache.delete(agentId);

    // 发布事件 / Emit event
    this._messageBus.emit('capability.evaluated', {
      agentId,
      taskType,
      reward,
      affectedDimensions: affectedDims,
      overallScore,
    });

    this._logger.debug({ agentId, overallScore, affectedDims }, 'capability evaluated / 能力评估完成');

    return { dimensions: updatedDimensions, overallScore };
  }

  /**
   * 更新单个维度分数 / Update a single dimension score
   *
   * @param {string} agentId
   * @param {string} dimension - 8D 维度名 / 8D dimension name
   * @param {number} score - 新分数 0-100 / New score 0-100
   * @returns {void}
   */
  updateCapability(agentId, dimension, score) {
    if (!DIMENSIONS_8D.includes(dimension)) {
      this._logger.warn({ dimension }, 'unknown dimension / 未知维度, 跳过');
      return;
    }

    const clamped = Math.max(0, Math.min(100, score));
    this._agentRepo.updateCapabilityScore(agentId, dimension, clamped);
    this._cache.delete(agentId);

    this._messageBus.emit('capability.updated', { agentId, dimension, score: clamped });
  }

  /**
   * 获取 agent 的 8D 能力档案 / Get agent's 8D capability profile
   *
   * @param {string} agentId
   * @returns {Record<string, number>} 8 个维度的分数 / Scores for 8 dimensions
   */
  getCapabilityProfile(agentId) {
    // 检查缓存 / Check cache
    const cached = this._cache.get(agentId);
    if (cached && (Date.now() - cached.updatedAt) < this._cacheTTL) {
      return { ...cached.dimensions };
    }

    // 从数据库加载 / Load from database
    const rows = this._agentRepo.getCapabilities(agentId);
    const profile = {};

    for (const dim of DIMENSIONS_8D) {
      const row = rows.find((r) => r.dimension === dim);
      profile[dim] = row ? row.score : this._initialScore;
    }

    // 更新缓存 / Update cache
    this._cache.set(agentId, {
      dimensions: { ...profile },
      updatedAt: Date.now(),
    });

    return profile;
  }

  // --------------------------------------------------------------------------
  // 任务匹配 / Task Matching
  // --------------------------------------------------------------------------

  /**
   * 计算 agent 能力与任务需求的匹配分数 / Compute match score between capabilities and requirements
   *
   * 使用加权余弦相似度, 对 8D 中每个维度计算归一化匹配度, 按权重聚合。
   * Uses weighted cosine similarity across 8D, aggregated by dimension weights.
   *
   * @param {Record<string, number>} agentCapabilities - 8D 能力分 (0-100) / 8D scores
   * @param {Record<string, number>} taskRequirements - 8D 需求分 (0-100) / 8D requirements
   * @returns {number} 匹配分 0-1 / Match score 0-1
   */
  computeMatch(agentCapabilities, taskRequirements) {
    let weightedSum = 0;
    let totalWeight = 0;

    for (const dim of DIMENSIONS_8D) {
      const agentScore = (agentCapabilities[dim] ?? this._initialScore) / 100;
      const requirement = (taskRequirements[dim] ?? 0) / 100;
      const weight = this._dimensionWeights[dim] || 0;

      if (requirement > 0) {
        // 满足率: agent分/需求分, 上限 1.0 / Fulfillment ratio, capped at 1.0
        const fulfillment = Math.min(agentScore / requirement, 1.0);
        weightedSum += fulfillment * weight;
        totalWeight += weight;
      }
    }

    if (totalWeight === 0) return 0.5; // 无需求维度, 返回中性分 / No requirements, neutral
    return Math.round((weightedSum / totalWeight) * 1000) / 1000;
  }

  // --------------------------------------------------------------------------
  // PARL 阶段自适应奖励 / PARL Phase-Adaptive Reward Learning
  // --------------------------------------------------------------------------

  /**
   * 获取 PARL 权重 / Get PARL weights for a given progress percentage
   *
   * @param {number} progressPercent - 项目完成百分比 0-100 / Project progress 0-100
   * @returns {{ speedWeight: number, qualityWeight: number, phase: string }}
   */
  getPARLWeights(progressPercent) {
    const p = Math.max(0, Math.min(100, progressPercent));

    for (const phase of PARL_PHASES) {
      if (p <= phase.maxProgress) {
        return {
          speedWeight: phase.speedWeight,
          qualityWeight: phase.qualityWeight,
          phase: phase.name,
        };
      }
    }

    // 默认开发期 / Default to exploitation
    const last = PARL_PHASES[PARL_PHASES.length - 1];
    return {
      speedWeight: last.speedWeight,
      qualityWeight: last.qualityWeight,
      phase: last.name,
    };
  }

  /**
   * 计算 PARL 奖励值 / Compute PARL reward value
   *
   * reward = speedWeight × speed + qualityWeight × quality
   * 阶段由 progressPercent 决定。
   * Phase is determined by progressPercent.
   *
   * @param {Object} taskOutcome
   * @param {number} taskOutcome.speed - 速度评分 0-1 / Speed score 0-1
   * @param {number} taskOutcome.quality - 质量评分 0-1 / Quality score 0-1
   * @param {number} progressPercent - 项目完成百分比 / Project progress %
   * @returns {number} 奖励值 0-1 / Reward value 0-1
   */
  computePARLReward(taskOutcome, progressPercent) {
    const { speed = 0, quality = 0 } = taskOutcome;
    const { speedWeight, qualityWeight } = this.getPARLWeights(progressPercent);

    const reward = speedWeight * Math.max(0, Math.min(1, speed))
                 + qualityWeight * Math.max(0, Math.min(1, quality));

    return Math.round(reward * 1000) / 1000;
  }

  // --------------------------------------------------------------------------
  // 排名 / Rankings
  // --------------------------------------------------------------------------

  /**
   * 获取某维度的 Top Agent / Get top agents ranked by a specific dimension
   *
   * @param {string} dimension - 维度名 / Dimension name
   * @param {number} [limit=10] - 返回数量 / Number to return
   * @returns {Array<{ agentId: string, score: number }>}
   */
  getTopAgents(dimension, limit = 10) {
    if (!DIMENSIONS_8D.includes(dimension)) {
      this._logger.warn({ dimension }, 'unknown dimension for ranking / 未知排名维度');
      return [];
    }

    // 获取所有 agent / Get all agents
    const agents = this._agentRepo.listAgents('active');
    const ranked = [];

    for (const agent of agents) {
      const capabilities = this._agentRepo.getCapabilities(agent.id);
      const dimRow = capabilities.find((c) => c.dimension === dimension);
      const score = dimRow ? dimRow.score : this._initialScore;
      ranked.push({ agentId: agent.id, score });
    }

    // 降序排列 / Sort descending
    ranked.sort((a, b) => b.score - a.score);
    return ranked.slice(0, limit);
  }

  // --------------------------------------------------------------------------
  // 初始化 / Initialization
  // --------------------------------------------------------------------------

  /**
   * 为新 agent 初始化 8D 能力档案 / Initialize 8D capability profile for a new agent
   *
   * @param {string} agentId
   * @returns {void}
   */
  initializeProfile(agentId) {
    for (const dim of DIMENSIONS_8D) {
      this._agentRepo.createCapability(agentId, dim, this._initialScore);
    }

    this._logger.info({ agentId }, 'initialized 8D capability profile / 已初始化 8D 能力档案');
  }

  // --------------------------------------------------------------------------
  // 生命周期 / Lifecycle
  // --------------------------------------------------------------------------

  /**
   * 清除缓存 / Clear all cached profiles
   *
   * @param {string} [agentId] - 可选: 仅清除特定 agent / Optional: clear specific agent only
   * @returns {void}
   */
  clearCache(agentId) {
    if (agentId) {
      this._cache.delete(agentId);
    } else {
      this._cache.clear();
    }
  }

  /**
   * 关闭引擎 / Shutdown the engine gracefully
   * @returns {void}
   */
  shutdown() {
    this._cache.clear();
    this._logger.info('CapabilityEngine shut down / 能力引擎已关闭');
  }

  // --------------------------------------------------------------------------
  // 私有方法 / Private Methods
  // --------------------------------------------------------------------------

  /**
   * 解析受影响的维度 / Resolve which dimensions are affected by a task
   *
   * @param {string} taskType
   * @param {string[]} [explicitDimensions]
   * @returns {string[]}
   * @private
   */
  _resolveAffectedDimensions(taskType, explicitDimensions) {
    // 若显式提供维度, 过滤有效的 / If explicit dimensions given, filter valid ones
    if (Array.isArray(explicitDimensions) && explicitDimensions.length > 0) {
      return explicitDimensions.filter((d) => DIMENSIONS_8D.includes(d));
    }

    // 从任务类型映射 / Map from task type
    const primaryDim = TASK_TYPE_DIMENSION_MAP[taskType];
    if (primaryDim && DIMENSIONS_8D.includes(primaryDim)) {
      return [primaryDim];
    }

    // 默认影响 coding 维度 / Default to coding
    return [CapabilityDimension.coding];
  }

  /**
   * 计算 8D 加权综合评分 / Compute weighted overall score from 8D profile
   *
   * @param {Record<string, number>} profile - 8D 分数 / 8D scores
   * @returns {number} 综合评分 0-100 / Overall score 0-100
   * @private
   */
  _computeOverallScore(profile) {
    let weightedSum = 0;
    let totalWeight = 0;

    for (const dim of DIMENSIONS_8D) {
      const score = profile[dim] ?? this._initialScore;
      const weight = this._dimensionWeights[dim] || 0;
      weightedSum += score * weight;
      totalWeight += weight;
    }

    if (totalWeight === 0) return this._initialScore;
    return Math.round((weightedSum / totalWeight) * 100) / 100;
  }
}

/**
 * 导出维度列表供外部使用 / Export dimension list for external use
 * @type {string[]}
 */
export const CAPABILITY_DIMENSIONS = DIMENSIONS_8D;

/**
 * 导出 PARL 阶段配置 / Export PARL phase config
 */
export const PARL_PHASE_CONFIG = PARL_PHASES;
