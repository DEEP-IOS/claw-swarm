/**
 * ReputationLedger — 五维声誉评分 / 5-Dimensional Reputation Scoring
 *
 * v4.x 迁移增强: 从单一贡献积分扩展到五维声誉体系:
 *   1. competence  — 任务成功率与质量 / Task success rate & quality
 *   2. reliability — 一致性与可用性 / Consistency & uptime
 *   3. collaboration — 团队协作效能 / Teamwork effectiveness
 *   4. innovation — 创造性问题解决 / Creative problem solving
 *   5. trust — 综合可信度 (以上四维加权平均) / Overall trustworthiness
 *
 * Migrated from v4.x: expanded from single contribution points to 5-dimensional
 * reputation system. Trust is computed as a weighted average of the other four.
 *
 * @module L3-agent/reputation-ledger
 * @author DEEP-IOS
 */

// ============================================================================
// 常量 / Constants
// ============================================================================

/**
 * 五维声誉维度 / Five reputation dimensions
 * @type {string[]}
 */
const REPUTATION_DIMENSIONS = ['competence', 'reliability', 'collaboration', 'innovation'];

/**
 * Trust 计算权重 / Weights for trust computation
 * @type {Record<string, number>}
 */
const TRUST_WEIGHTS = Object.freeze({
  competence: 0.35,
  reliability: 0.30,
  collaboration: 0.20,
  innovation: 0.15,
});

/** 默认初始声誉分 / Default initial reputation score */
const DEFAULT_INITIAL_SCORE = 50;

/** 分数上限 / Maximum reputation score */
const MAX_SCORE = 100;

/** 分数下限 / Minimum reputation score */
const MIN_SCORE = 0;

/** 默认时间衰减因子 / Default time-based decay factor */
const DEFAULT_DECAY_FACTOR = 0.02;

/** 学习率 — 新事件对声誉的影响大小 / Learning rate for reputation updates */
const LEARNING_RATE = 0.1;

/** 历史事件最大保留数 / Maximum history entries per agent */
const MAX_HISTORY_SIZE = 500;

// ============================================================================
// ReputationLedger
// ============================================================================

export class ReputationLedger {
  /**
   * @param {Object} deps - 依赖注入 / Dependency injection
   * @param {import('../L1-infrastructure/database/repositories/agent-repo.js').AgentRepository} deps.agentRepo
   * @param {import('../L2-communication/message-bus.js').MessageBus} deps.messageBus
   * @param {Object} deps.logger
   * @param {Object} [deps.config] - 可选配置 / Optional config overrides
   */
  constructor({ agentRepo, messageBus, logger, config = {} }) {
    /** @private */
    this._agentRepo = agentRepo;
    /** @private */
    this._messageBus = messageBus;
    /** @private */
    this._logger = logger;

    /** @private */
    this._initialScore = config.initialScore ?? DEFAULT_INITIAL_SCORE;
    /** @private */
    this._decayFactor = config.decayFactor ?? DEFAULT_DECAY_FACTOR;
    /** @private */
    this._trustWeights = config.trustWeights || { ...TRUST_WEIGHTS };

    /**
     * 声誉事件历史 / Reputation event history
     * Map<agentId, Array<{ dimension, score, taskId, context, timestamp }>>
     * @private
     */
    this._history = new Map();
  }

  // --------------------------------------------------------------------------
  // 声誉事件记录 / Reputation Event Recording
  // --------------------------------------------------------------------------

  /**
   * 记录声誉事件 / Record a reputation event
   *
   * 根据事件更新指定维度的声誉分数, 使用指数移动平均 (EMA) 平滑更新。
   * Updates the specified dimension score using Exponential Moving Average.
   *
   * @param {string} agentId
   * @param {Object} event
   * @param {string} event.dimension - 声誉维度 / Reputation dimension
   * @param {number} event.score - 本次事件评分 0-100 / Event score 0-100
   * @param {string} [event.taskId] - 相关任务 ID / Related task ID
   * @param {Object} [event.context] - 上下文信息 / Context info
   * @returns {void}
   */
  recordEvent(agentId, event) {
    const { dimension, score, taskId, context } = event;

    if (!REPUTATION_DIMENSIONS.includes(dimension)) {
      this._logger.warn({ dimension }, 'unknown reputation dimension / 未知声誉维度');
      return;
    }

    const clampedScore = Math.max(MIN_SCORE, Math.min(MAX_SCORE, score));

    // 获取当前声誉 / Get current reputation
    const current = this._getDimensionScore(agentId, dimension);

    // EMA 更新: new = current × (1-α) + event × α / EMA update
    const updated = current * (1 - LEARNING_RATE) + clampedScore * LEARNING_RATE;
    const roundedScore = Math.round(Math.max(MIN_SCORE, Math.min(MAX_SCORE, updated)) * 100) / 100;

    // 持久化 / Persist — 使用 capabilities 表存储声誉维度
    // Using capabilities table with reputation dimension prefix
    this._agentRepo.createCapability(agentId, `rep_${dimension}`, roundedScore);

    // 记录历史 / Record history
    this._addHistory(agentId, {
      dimension,
      score: clampedScore,
      previousScore: current,
      newScore: roundedScore,
      taskId: taskId || null,
      context: context || null,
      timestamp: Date.now(),
    });

    // 发布事件 / Emit event
    this._messageBus.publish?.('reputation.updated', {
      agentId,
      dimension,
      previousScore: current,
      newScore: roundedScore,
      eventScore: clampedScore,
    });

    this._logger.debug(
      { agentId, dimension, from: current, to: roundedScore },
      'reputation updated / 声誉已更新',
    );
  }

  // --------------------------------------------------------------------------
  // 声誉查询 / Reputation Queries
  // --------------------------------------------------------------------------

  /**
   * 获取 agent 完整五维声誉 / Get agent's full 5D reputation profile
   *
   * @param {string} agentId
   * @returns {{ competence: number, reliability: number, collaboration: number, innovation: number, trust: number, overall: number }}
   */
  getReputation(agentId) {
    const profile = {};

    for (const dim of REPUTATION_DIMENSIONS) {
      profile[dim] = this._getDimensionScore(agentId, dim);
    }

    // 计算 trust (加权平均) / Compute trust (weighted average)
    profile.trust = this._computeTrustScore(profile);

    // overall = trust (方便使用) / overall = trust for convenience
    profile.overall = profile.trust;

    return profile;
  }

  /**
   * 计算信任评分 / Compute weighted trust score
   *
   * trust = Σ(dimension × weight) 其中 weights 归一化为 1
   * trust = Σ(dimension × weight) where weights sum to 1
   *
   * @param {string} agentId
   * @returns {number} 信任评分 0-100 / Trust score 0-100
   */
  computeTrust(agentId) {
    const profile = {};
    for (const dim of REPUTATION_DIMENSIONS) {
      profile[dim] = this._getDimensionScore(agentId, dim);
    }
    return this._computeTrustScore(profile);
  }

  // --------------------------------------------------------------------------
  // 排行榜 / Leaderboard
  // --------------------------------------------------------------------------

  /**
   * 获取声誉排行榜 / Get reputation leaderboard
   *
   * @param {Object} [options]
   * @param {string} [options.dimension='trust'] - 排名维度 / Ranking dimension
   * @param {number} [options.limit=10] - 返回数量 / Number to return
   * @returns {Array<{ agentId: string, score: number, name: string }>}
   */
  getLeaderboard(options = {}) {
    const dimension = options.dimension || 'trust';
    const limit = options.limit || 10;

    const agents = this._agentRepo.listAgents('active');
    const ranked = [];

    for (const agent of agents) {
      let score;
      if (dimension === 'trust' || dimension === 'overall') {
        score = this.computeTrust(agent.id);
      } else if (REPUTATION_DIMENSIONS.includes(dimension)) {
        score = this._getDimensionScore(agent.id, dimension);
      } else {
        score = this._initialScore;
      }

      ranked.push({
        agentId: agent.id,
        name: agent.name || agent.id,
        score: Math.round(score * 100) / 100,
      });
    }

    ranked.sort((a, b) => b.score - a.score);
    return ranked.slice(0, limit);
  }

  // --------------------------------------------------------------------------
  // 时间衰减 / Time-Based Decay
  // --------------------------------------------------------------------------

  /**
   * 对 agent 声誉应用时间衰减 / Apply time-based decay to agent reputation
   *
   * 所有四个基础维度按 factor 衰减: score = score × (1 - factor)
   * All four base dimensions decay: score = score × (1 - factor)
   * 分数不低于 MIN_SCORE。/ Score doesn't go below MIN_SCORE.
   *
   * @param {string} agentId
   * @param {Object} [options]
   * @param {number} [options.factor] - 衰减因子 / Decay factor (0-1)
   * @returns {void}
   */
  decay(agentId, options = {}) {
    const factor = options.factor ?? this._decayFactor;

    for (const dim of REPUTATION_DIMENSIONS) {
      const current = this._getDimensionScore(agentId, dim);
      const decayed = Math.max(MIN_SCORE, current * (1 - factor));
      const rounded = Math.round(decayed * 100) / 100;

      this._agentRepo.createCapability(agentId, `rep_${dim}`, rounded);
    }

    this._messageBus.publish?.('reputation.decayed', { agentId, factor });
    this._logger.debug({ agentId, factor }, 'reputation decayed / 声誉已衰减');
  }

  // --------------------------------------------------------------------------
  // 历史记录 / History
  // --------------------------------------------------------------------------

  /**
   * 获取 agent 的声誉事件历史 / Get agent's reputation event history
   *
   * @param {string} agentId
   * @param {Object} [options]
   * @param {number} [options.limit=50] - 返回条数 / Number of entries
   * @returns {Array<Object>}
   */
  getHistory(agentId, options = {}) {
    const limit = options.limit || 50;
    const history = this._history.get(agentId) || [];
    return history.slice(-limit);
  }

  // --------------------------------------------------------------------------
  // 私有方法 / Private Methods
  // --------------------------------------------------------------------------

  /**
   * 获取单个维度的声誉分数 / Get single dimension reputation score
   *
   * @param {string} agentId
   * @param {string} dimension
   * @returns {number}
   * @private
   */
  _getDimensionScore(agentId, dimension) {
    const capabilities = this._agentRepo.getCapabilities(agentId);
    const row = capabilities.find((c) => c.dimension === `rep_${dimension}`);
    return row ? row.score : this._initialScore;
  }

  /**
   * 计算加权信任分 / Compute weighted trust score from profile
   *
   * @param {Record<string, number>} profile - 四维分数 / Four dimension scores
   * @returns {number} 0-100
   * @private
   */
  _computeTrustScore(profile) {
    let weightedSum = 0;
    let totalWeight = 0;

    for (const dim of REPUTATION_DIMENSIONS) {
      const weight = this._trustWeights[dim] || 0;
      const score = profile[dim] ?? this._initialScore;
      weightedSum += score * weight;
      totalWeight += weight;
    }

    if (totalWeight === 0) return this._initialScore;
    return Math.round((weightedSum / totalWeight) * 100) / 100;
  }

  /**
   * 添加历史记录 / Add entry to history
   *
   * @param {string} agentId
   * @param {Object} entry
   * @private
   */
  _addHistory(agentId, entry) {
    if (!this._history.has(agentId)) {
      this._history.set(agentId, []);
    }

    const history = this._history.get(agentId);
    history.push(entry);

    // 限制大小 / Cap size
    if (history.length > MAX_HISTORY_SIZE) {
      this._history.set(agentId, history.slice(-Math.floor(MAX_HISTORY_SIZE / 2)));
    }
  }
}

/**
 * 导出声誉维度列表 / Export reputation dimensions
 * @type {string[]}
 */
export const REPUTATION_DIMS = REPUTATION_DIMENSIONS;
