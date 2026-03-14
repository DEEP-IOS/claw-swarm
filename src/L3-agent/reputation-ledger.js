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
 * 六维声誉维度 / Six reputation dimensions (V6.0: +centrality, +influence)
 * @type {string[]}
 */
const REPUTATION_DIMENSIONS = ['competence', 'reliability', 'collaboration', 'innovation', 'centrality', 'influence'];

/**
 * Trust 计算权重 / Weights for trust computation (V6.0: 6D)
 * @type {Record<string, number>}
 */
const TRUST_WEIGHTS = Object.freeze({
  competence: 0.30,
  reliability: 0.25,
  collaboration: 0.15,
  innovation: 0.10,
  centrality: 0.10,
  influence: 0.10,
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

  /**
   * V6.0: 半衰期指数衰减 / Half-life exponential decay
   *
   * effectiveScore = Σ(score_i × e^(-t_i/halfLife)) / Σ(e^(-t_i/halfLife))
   *
   * @param {string} agentId
   * @param {Object} [options]
   * @param {number} [options.halfLifeDays=14] - 半衰期 (天) / Half-life in days
   * @returns {Object} 衰减后的声誉 / Decayed reputation profile
   */
  decayWithHalfLife(agentId, { halfLifeDays = 14 } = {}) {
    const history = this._history.get(agentId) || [];
    if (history.length === 0) return this.getReputation(agentId);

    const now = Date.now();
    const halfLifeMs = halfLifeDays * 86400000;
    const lambda = Math.LN2 / halfLifeMs;

    // 按维度加权平均 / Weighted average per dimension
    const profile = {};
    for (const dim of REPUTATION_DIMENSIONS) {
      const dimEvents = history.filter((h) => h.dimension === dim);
      if (dimEvents.length === 0) {
        profile[dim] = this._getDimensionScore(agentId, dim);
        continue;
      }

      let weightedSum = 0;
      let weightSum = 0;
      for (const evt of dimEvents) {
        const age = now - (evt.timestamp || now);
        const weight = Math.exp(-lambda * age);
        weightedSum += (evt.newScore || evt.score) * weight;
        weightSum += weight;
      }

      profile[dim] = weightSum > 0 ? weightedSum / weightSum : this._initialScore;
    }

    return profile;
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

  // --------------------------------------------------------------------------
  // V6.2: 寄生 Agent 检测 / Parasite Agent Detection
  // --------------------------------------------------------------------------

  /**
   * V6.2: 寄生 Agent 检测 / Parasite agent detection
   *
   * 检测消耗资源但不贡献的 Agent。
   * Detects agents that consume resources without contributing.
   *
   * 判定标准: collaboration 维度持续为 0 但 competence 正常。
   * Criteria: collaboration dimension consistently 0 but competence normal.
   *
   * parasiteScore = (1 - avgCollaboration) * competence * activityFactor
   * 其中 activityFactor = min(1, eventCount / minEvents)
   * where activityFactor = min(1, eventCount / minEvents)
   *
   * 当 parasiteScore > threshold 时发布 'parasite.detected' 事件。
   * Publishes 'parasite.detected' event when parasiteScore > threshold.
   *
   * @param {Object} [options]
   * @param {number} [options.threshold=0.7] - 寄生判定阈值 / Parasite detection threshold
   * @param {number} [options.minEvents=5] - 最少事件数 / Minimum events required
   * @returns {Array<{ agentId: string, parasiteScore: number, collaboration: number, competence: number }>}
   */
  detectParasites({ threshold = 0.7, minEvents = 5 } = {}) {
    const agents = this._agentRepo.listAgents('active');
    const parasites = [];

    for (const agent of agents) {
      const profile = this.getContributionProfile(agent.id);

      // 需要足够的事件数据才能做出判断 / Need sufficient event data to make judgment
      const history = this._history.get(agent.id) || [];
      const eventCount = history.length;
      const activityFactor = Math.min(1, eventCount / minEvents);

      if (activityFactor < 1) continue; // 事件不足, 跳过 / Insufficient events, skip

      // 归一化到 0-1 范围 / Normalize to 0-1 range
      const normalizedCollab = profile.collaborationMean / MAX_SCORE;
      const normalizedCompetence = profile.competenceMean / MAX_SCORE;

      // parasiteScore: 低协作 + 正常能力 = 寄生行为
      // parasiteScore: low collaboration + normal competence = parasitic behavior
      const parasiteScore = (1 - normalizedCollab) * normalizedCompetence * activityFactor;
      const rounded = Math.round(parasiteScore * 1000) / 1000;

      if (rounded > threshold) {
        parasites.push({
          agentId: agent.id,
          parasiteScore: rounded,
          collaboration: profile.collaborationMean,
          competence: profile.competenceMean,
        });

        // 发布寄生检测事件 / Publish parasite detected event
        this._messageBus.publish?.('parasite.detected', {
          agentId: agent.id,
          parasiteScore: rounded,
          collaboration: profile.collaborationMean,
          competence: profile.competenceMean,
          contributionRatio: profile.contributionRatio,
        });

        this._logger.warn(
          { agentId: agent.id, parasiteScore: rounded },
          'parasite agent detected / 检测到寄生 Agent',
        );
      }
    }

    return parasites.sort((a, b) => b.parasiteScore - a.parasiteScore);
  }

  /**
   * V6.2: 获取 Agent 贡献率 / Get agent contribution ratio
   *
   * 基于声誉历史计算 collaboration 与 competence 的均值和贡献率。
   * Computes collaboration and competence means and contribution ratio from reputation history.
   *
   * contributionRatio = collaborationMean / max(competenceMean, 1)
   * 高贡献率 = 协作产出与能力匹配; 低贡献率 = 可能存在搭便车行为。
   * High ratio = collaboration matches competence; Low ratio = possible free-riding.
   *
   * @param {string} agentId
   * @returns {{ contributionRatio: number, collaborationMean: number, competenceMean: number }}
   */
  getContributionProfile(agentId) {
    const collaborationScore = this._getDimensionScore(agentId, 'collaboration');
    const competenceScore = this._getDimensionScore(agentId, 'competence');

    // 从历史记录计算均值 (如有) / Compute mean from history (if available)
    const history = this._history.get(agentId) || [];

    const collabEvents = history.filter((h) => h.dimension === 'collaboration');
    const compEvents = history.filter((h) => h.dimension === 'competence');

    const collaborationMean = collabEvents.length > 0
      ? collabEvents.reduce((sum, h) => sum + h.score, 0) / collabEvents.length
      : collaborationScore;

    const competenceMean = compEvents.length > 0
      ? compEvents.reduce((sum, h) => sum + h.score, 0) / compEvents.length
      : competenceScore;

    // 贡献率: 协作产出 / 能力水平 / Contribution ratio: collaboration output / competence level
    const contributionRatio = competenceMean > 0
      ? Math.round((collaborationMean / competenceMean) * 1000) / 1000
      : 0;

    return {
      contributionRatio,
      collaborationMean: Math.round(collaborationMean * 100) / 100,
      competenceMean: Math.round(competenceMean * 100) / 100,
    };
  }

  // --------------------------------------------------------------------------
  // V6.0: SNA + Shapley 集成 / SNA + Shapley Integration
  // --------------------------------------------------------------------------

  /**
   * V6.0: 更新 SNA 指标到声誉 / Update SNA metrics to reputation dimensions
   *
   * @param {string} agentId
   * @param {{ degreeCentrality: number, betweennessCentrality: number }} snaMetrics
   */
  updateSNAScores(agentId, snaMetrics) {
    // centrality = 度中心性 × 100 (归一化到 0-100)
    if (snaMetrics.degreeCentrality !== undefined) {
      this.recordEvent(agentId, {
        dimension: 'centrality',
        score: Math.min(100, snaMetrics.degreeCentrality * 100),
        context: { source: 'sna', metric: 'degree' },
      });
    }

    // influence = 介数中心性 × 100
    if (snaMetrics.betweennessCentrality !== undefined) {
      this.recordEvent(agentId, {
        dimension: 'influence',
        score: Math.min(100, snaMetrics.betweennessCentrality * 100),
        context: { source: 'sna', metric: 'betweenness' },
      });
    }
  }

  /**
   * V6.0: 记录 Shapley 信用 / Record Shapley credit
   *
   * 信用值映射到 competence 维度的增量事件。
   * Credit maps to competence dimension incremental event.
   *
   * @param {string} agentId
   * @param {number} credit - Shapley 信用 (0-1)
   * @param {string} [dagId]
   */
  recordShapleyCredit(agentId, credit, dagId) {
    // Shapley 信用映射到 competence 分数: credit × 100
    this.recordEvent(agentId, {
      dimension: 'competence',
      score: Math.min(100, credit * 100),
      taskId: dagId,
      context: { source: 'shapley', credit },
    });
  }
}

/**
 * 导出声誉维度列表 / Export reputation dimensions
 * @type {string[]}
 */
export const REPUTATION_DIMS = REPUTATION_DIMENSIONS;
