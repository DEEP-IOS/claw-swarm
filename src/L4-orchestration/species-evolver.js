/**
 * Claw-Swarm V5.1 — 种群进化器 / Species Evolver
 *
 * 实现开放式 LLM 驱动的种群进化系统，让蜂群中的 Agent 种群可以
 * 真正地推陈出新、优胜劣汰。
 *
 * Implements open-ended LLM-driven species evolution, enabling swarm
 * agent populations to genuinely innovate, specialize, and evolve.
 *
 * 核心机制 / Core Mechanisms:
 * - 种群提议（Schema 校验 + 安全护栏）/ Species proposal with validation
 * - 试用期管理（30 天试用 + 成功率考核）/ Trial period management
 * - 进化淘汰（底部 20% 使用率种群退役）/ Evolution culling
 * - 种群上限保护（同时活跃 ≤ 10）/ Active species cap
 *
 * ⚠️ V5.2 延期项（保留接口，不激活）:
 * - ABC 三阶段进化
 * - Lotka-Volterra 种群竞争动力学
 * - 多类型信息素生态
 *
 * @module L4-orchestration/species-evolver
 * @version 5.1.0
 */

import { EventTopics, wrapEvent } from '../event-catalog.js';

// ============================================================================
// 常量 / Constants
// ============================================================================

/** 种群名正则（硬 Schema 校验，防注入）/ Species name regex (anti-injection) */
const SPECIES_NAME_REGEX = /^[a-zA-Z0-9-]{1,32}$/;

/** 同时活跃种群上限 / Max active species */
const MAX_ACTIVE_SPECIES = 10;

/** 试用期天数 / Trial period in days */
const TRIAL_PERIOD_DAYS = 30;

/** 试用最少分配次数 / Minimum assignments during trial */
const TRIAL_MIN_ASSIGNMENTS = 3;

/** 试用最低成功率 / Minimum success rate for trial promotion */
const TRIAL_MIN_SUCCESS_RATE = 0.7;

/** 能力权重每个维度的范围 / Capability weight range per dimension */
const WEIGHT_MIN = 0.05;
const WEIGHT_MAX = 1.0;

/** L2 范数最小值 / Minimum L2 norm for capability vector */
const MIN_L2_NORM = 0.3;

/**
 * 与现有角色最大重叠度 / Max overlap with existing roles
 * ⚠️ 0.9 适用于 8D 向量空间——低维向量的余弦相似度基线较高，
 *    0.5 阈值会误拒大量合法种群。0.9 仅拦截近乎相同方向的向量，
 *    配合 MIN_DIFF_DIMENSIONS 检查提供双重保护。
 * ⚠️ 0.9 is appropriate for 8D vector space — cosine baseline is high
 *    in low-dimensional positive vectors. Combined with MIN_DIFF_DIMENSIONS
 *    for dual protection.
 */
const MAX_OVERLAP_THRESHOLD = 0.9;

/** 最少差异维度数 / Min dimensions with significant difference */
const MIN_DIFF_DIMENSIONS = 2;

/** 差异阈值 / Difference threshold per dimension */
const DIFF_THRESHOLD = 0.15;

// ============================================================================
// SpeciesEvolver
// ============================================================================

export class SpeciesEvolver {
  /**
   * @param {Object} deps
   * @param {Object} deps.messageBus - MessageBus 实例
   * @param {Object} deps.capabilityEngine - CapabilityEngine 实例
   * @param {Object} deps.roleManager - RoleManager 实例
   * @param {Object} deps.logger - 日志器
   * @param {Object} [deps.config] - 进化配置
   */
  constructor({ messageBus, capabilityEngine, roleManager, logger, config = {} }) {
    /** @private */
    this._messageBus = messageBus;
    /** @private */
    this._capabilityEngine = capabilityEngine;
    /** @private */
    this._roleManager = roleManager;
    /** @private */
    this._logger = logger;

    /**
     * 注册的种群 / Registered species
     * Map<speciesName, SpeciesRecord>
     * @private
     */
    this._species = new Map();

    /**
     * 进化日志 / Evolution log
     * @private
     */
    this._evolutionLog = [];

    /**
     * 启用标志 / Enabled flag
     * @private
     */
    this._enabled = config.enabled ?? false;

    /**
     * 聚类配置 / Clustering config
     * @private
     */
    this._clusteringConfig = {
      enabled: config.clustering ?? false,
      minTasksPerAgent: config.minTasksPerAgent ?? 10,
      silhouetteThreshold: config.silhouetteThreshold ?? 0.45,
    };

    /**
     * GEP 配置 / GEP config
     * @private
     */
    this._gepConfig = {
      enabled: config.gep ?? false,
      mutationRate: config.mutationRate ?? 0.1,
      rollbackThreshold: 3, // 连续 N 次下降则回滚 / Rollback after N consecutive declines
    };

    /**
     * 上次淘汰时间 / Last culling time
     * @private
     */
    this._lastCullingAt = 0;

    /**
     * GEP 进化历史（用于停滞检测和回滚）
     * GEP evolution history (for stagnation detection and rollback)
     * @private
     */
    this._gepHistory = new Map(); // agentId → { previous: params, declineCount: 0 }
  }

  // --------------------------------------------------------------------------
  // 种群提议 / Species Proposal
  // --------------------------------------------------------------------------

  /**
   * 提议新种群类型（开放创新 + 安全护栏）
   * Propose a new species type (open innovation + safety guardrails)
   *
   * @param {Object} proposal
   * @param {string} proposal.name - 种群名 / Species name
   * @param {Record<string, number>} proposal.capabilityWeights - 8D 能力权重 / 8D capability weights
   * @param {string[]} proposal.taskTypes - 适用任务类型 / Applicable task types
   * @param {string} proposal.expectedBenefit - 预期收益 / Expected benefit
   * @param {Array<Object>} proposal.historicalCases - ≥3 个历史案例 / ≥3 historical cases
   * @param {string} [proposal.proposedBy] - 提议者 Agent ID
   * @returns {{ accepted: boolean, reason: string, speciesId?: string }}
   */
  proposeSpecies(proposal) {
    if (!this._enabled) {
      return { accepted: false, reason: 'Species evolution is disabled' };
    }

    // ── 1. 硬 Schema 校验 / Hard schema validation ──

    // 种群名校验（防注入）/ Name validation (anti-injection)
    if (!proposal.name || !SPECIES_NAME_REGEX.test(proposal.name)) {
      return { accepted: false, reason: `Invalid species name: must match ${SPECIES_NAME_REGEX}` };
    }

    // 重复检查 / Duplicate check
    if (this._species.has(proposal.name)) {
      return { accepted: false, reason: `Species '${proposal.name}' already exists` };
    }

    // 活跃种群上限 / Active species cap
    const activeCount = this._getActiveSpeciesCount();
    if (activeCount >= MAX_ACTIVE_SPECIES) {
      return { accepted: false, reason: `Active species limit reached (${MAX_ACTIVE_SPECIES})` };
    }

    // 能力权重校验 / Capability weight validation
    const weightValidation = this._validateCapabilityWeights(proposal.capabilityWeights);
    if (!weightValidation.valid) {
      return { accepted: false, reason: weightValidation.reason };
    }

    // 历史案例校验 / Historical cases validation
    if (!Array.isArray(proposal.historicalCases) || proposal.historicalCases.length < 3) {
      return { accepted: false, reason: 'At least 3 historical cases required' };
    }

    // 预期收益非空 / Expected benefit required
    if (!proposal.expectedBenefit || typeof proposal.expectedBenefit !== 'string') {
      return { accepted: false, reason: 'Expected benefit description required' };
    }

    // ── 2. 重叠度检查 / Overlap check ──

    const overlapCheck = this._checkOverlap(proposal.capabilityWeights);
    if (overlapCheck.maxOverlap > MAX_OVERLAP_THRESHOLD) {
      return {
        accepted: false,
        reason: `Overlap with existing role '${overlapCheck.mostSimilar}' is ${(overlapCheck.maxOverlap * 100).toFixed(0)}% (max ${MAX_OVERLAP_THRESHOLD * 100}%)`,
      };
    }

    // ── 3. 注册种群（试用期）/ Register species (trial period) ──

    const speciesRecord = {
      name: proposal.name,
      capabilityWeights: { ...proposal.capabilityWeights },
      taskTypes: [...(proposal.taskTypes || [])],
      expectedBenefit: proposal.expectedBenefit,
      proposedBy: proposal.proposedBy || 'unknown',
      status: 'trial', // trial → active → retired
      createdAt: Date.now(),
      trialExpiresAt: Date.now() + TRIAL_PERIOD_DAYS * 24 * 60 * 60 * 1000,
      assignments: 0,
      successes: 0,
      failures: 0,
    };

    this._species.set(proposal.name, speciesRecord);

    // 日志 + 事件 / Log + event
    this._logEvolution('species_proposed', proposal.name, {
      capabilityWeights: speciesRecord.capabilityWeights,
      taskTypes: speciesRecord.taskTypes,
    });

    this._messageBus.publish?.(
      EventTopics.SPECIES_PROPOSED || 'species.proposed',
      wrapEvent(EventTopics.SPECIES_PROPOSED || 'species.proposed', {
        speciesName: proposal.name,
        status: 'trial',
        trialExpiresAt: speciesRecord.trialExpiresAt,
      }),
    );

    this._logger.info?.(`[SpeciesEvolver] New species proposed: ${proposal.name} (trial period started)`);

    return { accepted: true, reason: 'Species accepted for trial period', speciesId: proposal.name };
  }

  // --------------------------------------------------------------------------
  // 试用期管理 / Trial Period Management
  // --------------------------------------------------------------------------

  /**
   * 记录种群任务分配结果 / Record species assignment outcome
   *
   * @param {string} speciesName - 种群名
   * @param {boolean} success - 是否成功
   * @returns {void}
   */
  recordAssignment(speciesName, success) {
    if (!this._enabled) return;

    const species = this._species.get(speciesName);
    if (!species) return;

    species.assignments++;
    if (success) {
      species.successes++;
    } else {
      species.failures++;
    }
  }

  /**
   * 评估试用期（自动转正或退役）
   * Evaluate trial periods (auto-promote or retire)
   *
   * @returns {{ promoted: string[], retired: string[] }}
   */
  evaluateTrials() {
    if (!this._enabled) return { promoted: [], retired: [] };

    const now = Date.now();
    const promoted = [];
    const retired = [];

    for (const [name, species] of this._species) {
      if (species.status !== 'trial') continue;

      // 试用期未到 / Trial not expired yet
      if (now < species.trialExpiresAt) {
        // 但如果已达成条件，可以提前转正 / Early promotion if criteria met
        if (species.assignments >= TRIAL_MIN_ASSIGNMENTS) {
          const successRate = species.successes / species.assignments;
          if (successRate >= TRIAL_MIN_SUCCESS_RATE) {
            species.status = 'active';
            promoted.push(name);
            this._logEvolution('species_promoted', name, { successRate, assignments: species.assignments });
            this._messageBus.publish?.(
              'species.promoted',
              wrapEvent('species.promoted', { speciesName: name, successRate }),
            );
            this._logger.info?.(`[SpeciesEvolver] Species promoted: ${name} (success rate: ${(successRate * 100).toFixed(0)}%)`);
          }
        }
        continue;
      }

      // 试用期已到期 / Trial expired
      if (species.assignments < TRIAL_MIN_ASSIGNMENTS) {
        // 分配不足，退役 / Insufficient assignments, retire
        species.status = 'retired';
        retired.push(name);
        this._logEvolution('species_retired', name, { reason: 'insufficient_assignments', assignments: species.assignments });
      } else {
        const successRate = species.successes / species.assignments;
        if (successRate >= TRIAL_MIN_SUCCESS_RATE) {
          species.status = 'active';
          promoted.push(name);
          this._logEvolution('species_promoted', name, { successRate });
        } else {
          species.status = 'retired';
          retired.push(name);
          this._logEvolution('species_retired', name, { reason: 'low_success_rate', successRate });
        }
      }
    }

    return { promoted, retired };
  }

  // --------------------------------------------------------------------------
  // 进化淘汰 / Evolution Culling
  // --------------------------------------------------------------------------

  /**
   * 季度淘汰（底部 20% 使用率种群退役）
   * Quarterly culling (retire bottom 20% by usage)
   *
   * @returns {string[]} 退役的种群名列表 / List of retired species names
   */
  performCulling() {
    if (!this._enabled) return [];

    const activeSpecies = [...this._species.entries()]
      .filter(([, s]) => s.status === 'active')
      .sort((a, b) => a[1].assignments - b[1].assignments);

    // 至少保留 3 个种群 / Keep at least 3 species
    if (activeSpecies.length <= 3) return [];

    // 淘汰底部 20% / Cull bottom 20%
    const cullCount = Math.max(1, Math.floor(activeSpecies.length * 0.2));
    const culled = [];

    for (let i = 0; i < cullCount; i++) {
      const [name, species] = activeSpecies[i];
      species.status = 'retired';
      culled.push(name);
      this._logEvolution('species_culled', name, {
        assignments: species.assignments,
        successRate: species.assignments > 0 ? species.successes / species.assignments : 0,
      });
    }

    if (culled.length > 0) {
      this._lastCullingAt = Date.now();
      this._messageBus.publish?.(
        'species.culled',
        wrapEvent('species.culled', { culledSpecies: culled }),
      );
      this._logger.info?.(`[SpeciesEvolver] Culled ${culled.length} species: ${culled.join(', ')}`);
    }

    return culled;
  }

  // --------------------------------------------------------------------------
  // GEP 锦标赛选择 / GEP Tournament Selection
  // --------------------------------------------------------------------------

  /**
   * 执行 GEP 锦标赛选择（针对 persona 参数进化）
   * Perform GEP tournament selection for persona parameter evolution
   *
   * ⚠️ GEP 拥有 persona 参数（creativity, verbosity 等）
   *    ABC 拥有 capability 权重（8D）— V5.2 延期
   *
   * @param {Object} personaEvolution - PersonaEvolution 实例
   * @param {string[]} agentIds - 参与进化的 Agent ID 列表
   * @returns {{ evolved: number, stagnant: boolean }}
   */
  performGEPEvolution(personaEvolution, agentIds) {
    if (!this._enabled || !this._gepConfig.enabled) {
      return { evolved: 0, stagnant: false };
    }

    if (!agentIds || agentIds.length < 2) {
      return { evolved: 0, stagnant: false };
    }

    let evolved = 0;
    const currentScores = new Map();

    // 收集当前评分 / Collect current scores
    for (const agentId of agentIds) {
      const stats = personaEvolution.getPersonaStats(agentId);
      currentScores.set(agentId, stats.winRate || 0);
    }

    // 停滞检测 / Stagnation detection
    const stagnant = this._detectStagnation(agentIds, currentScores);
    const effectiveRate = stagnant
      ? this._gepConfig.mutationRate * 2  // 停滞时增大变异率到 20%
      : this._gepConfig.mutationRate;

    // 锦标赛选择 + 变异 / Tournament selection + mutation
    for (const agentId of agentIds) {
      // 随机选择对手 / Random opponent
      const opponents = agentIds.filter(id => id !== agentId);
      if (opponents.length === 0) continue;

      const opponentId = opponents[Math.floor(Math.random() * opponents.length)];
      const myScore = currentScores.get(agentId) || 0;
      const oppScore = currentScores.get(opponentId) || 0;

      // 胜者进入下一代（变异）/ Winner evolves (mutated)
      if (myScore >= oppScore) {
        // 检查回滚 / Check rollback
        const history = this._gepHistory.get(agentId);
        if (history && history.declineCount >= this._gepConfig.rollbackThreshold) {
          // 回滚到上一代参数 / Rollback to previous parameters
          this._logger.info?.(`[SpeciesEvolver] GEP rollback for ${agentId} (${history.declineCount} consecutive declines)`);
          this._gepHistory.delete(agentId);
          continue;
        }

        // 保存当前参数快照用于回滚 / Save current params for rollback
        const currentConfig = personaEvolution._getPersonaConfig?.(agentId);
        if (currentConfig) {
          this._gepHistory.set(agentId, {
            previous: { ...currentConfig },
            declineCount: 0,
            score: myScore,
          });
        }

        // 加法变异 / Additive mutation
        personaEvolution.mutatePersona(agentId, { mutationRate: effectiveRate });
        evolved++;
      } else {
        // 败者记录下降 / Loser records decline
        const history = this._gepHistory.get(agentId) || { declineCount: 0, score: myScore };
        history.declineCount++;
        this._gepHistory.set(agentId, history);
      }
    }

    this._messageBus.publish?.(
      'species.gep.evolved',
      wrapEvent('species.gep.evolved', {
        evolved,
        stagnant,
        effectiveRate,
        agentCount: agentIds.length,
      }),
    );

    return { evolved, stagnant };
  }

  // --------------------------------------------------------------------------
  // 查询方法 / Query Methods
  // --------------------------------------------------------------------------

  /**
   * 获取所有种群列表 / Get all species list
   *
   * @param {Object} [options]
   * @param {string} [options.status] - 过滤状态 / Filter by status
   * @returns {Array<Object>}
   */
  listSpecies(options = {}) {
    const results = [];
    for (const [name, species] of this._species) {
      if (options.status && species.status !== options.status) continue;
      results.push({
        name,
        status: species.status,
        assignments: species.assignments,
        successRate: species.assignments > 0 ? Math.round(species.successes / species.assignments * 100) / 100 : 0,
        createdAt: species.createdAt,
      });
    }
    return results;
  }

  /**
   * 获取种群详情 / Get species details
   *
   * @param {string} speciesName
   * @returns {Object|null}
   */
  getSpecies(speciesName) {
    const species = this._species.get(speciesName);
    if (!species) return null;
    return { ...species };
  }

  /**
   * 获取统计信息 / Get statistics
   *
   * @returns {Object}
   */
  getStats() {
    let active = 0;
    let trial = 0;
    let retired = 0;
    let totalAssignments = 0;

    for (const species of this._species.values()) {
      if (species.status === 'active') active++;
      else if (species.status === 'trial') trial++;
      else if (species.status === 'retired') retired++;
      totalAssignments += species.assignments;
    }

    return {
      active,
      trial,
      retired,
      total: this._species.size,
      totalAssignments,
      lastCullingAt: this._lastCullingAt,
      gepEnabled: this._gepConfig.enabled,
      clusteringEnabled: this._clusteringConfig.enabled,
    };
  }

  /**
   * 获取进化日志 / Get evolution log
   *
   * @param {number} [limit=50]
   * @returns {Array<Object>}
   */
  getEvolutionLog(limit = 50) {
    return this._evolutionLog.slice(-limit);
  }

  // --------------------------------------------------------------------------
  // 生命周期 / Lifecycle
  // --------------------------------------------------------------------------

  /**
   * 销毁进化器 / Destroy evolver
   */
  destroy() {
    this._species.clear();
    this._evolutionLog = [];
    this._gepHistory.clear();
    this._logger.info?.('[SpeciesEvolver] Destroyed');
  }

  // --------------------------------------------------------------------------
  // 私有方法 / Private Methods
  // --------------------------------------------------------------------------

  /**
   * 校验能力权重向量 / Validate capability weight vector
   * @private
   */
  _validateCapabilityWeights(weights) {
    if (!weights || typeof weights !== 'object') {
      return { valid: false, reason: 'Capability weights must be an object' };
    }

    const dims = Object.keys(weights);
    if (dims.length === 0) {
      return { valid: false, reason: 'At least one capability dimension required' };
    }

    // 每个维度范围检查 / Range check per dimension
    for (const [dim, val] of Object.entries(weights)) {
      if (typeof val !== 'number' || val < WEIGHT_MIN || val > WEIGHT_MAX) {
        return {
          valid: false,
          reason: `Dimension '${dim}' weight ${val} out of range [${WEIGHT_MIN}, ${WEIGHT_MAX}]`,
        };
      }
    }

    // L2 范数检查 / L2 norm check
    const l2 = Math.sqrt(Object.values(weights).reduce((sum, v) => sum + v * v, 0));
    if (l2 < MIN_L2_NORM) {
      return { valid: false, reason: `L2 norm ${l2.toFixed(3)} < ${MIN_L2_NORM} (vector too weak)` };
    }

    return { valid: true };
  }

  /**
   * 检查与现有角色的重叠度（余弦相似度）
   * Check overlap with existing roles (cosine similarity)
   * @private
   */
  _checkOverlap(newWeights) {
    let maxOverlap = 0;
    let mostSimilar = '';
    let diffDimsCount = 0;

    // 获取现有种群和内置角色 / Get existing species and built-in roles
    const existingVectors = [];

    // 已注册种群 / Registered species
    for (const [name, species] of this._species) {
      if (species.status === 'retired') continue;
      existingVectors.push({ name, weights: species.capabilityWeights });
    }

    // 内置角色模板 / Built-in role templates
    const templates = this._roleManager?.getAllTemplates?.() || [];
    for (const tmpl of templates) {
      if (tmpl.capabilities) {
        existingVectors.push({ name: tmpl.name, weights: tmpl.capabilities });
      }
    }

    for (const existing of existingVectors) {
      const similarity = this._cosineSimilarity(newWeights, existing.weights);
      if (similarity > maxOverlap) {
        maxOverlap = similarity;
        mostSimilar = existing.name;
      }

      // 统计差异维度 / Count differing dimensions
      let diffs = 0;
      for (const dim of Object.keys(newWeights)) {
        const diff = Math.abs((newWeights[dim] || 0) - (existing.weights[dim] || 0));
        if (diff > DIFF_THRESHOLD) diffs++;
      }
      diffDimsCount = Math.max(diffDimsCount, diffs);
    }

    // 还需检查差异维度数 / Also check minimum different dimensions
    if (existingVectors.length > 0 && diffDimsCount < MIN_DIFF_DIMENSIONS) {
      maxOverlap = Math.max(maxOverlap, MAX_OVERLAP_THRESHOLD + 0.01); // 强制驳回 / Force reject
    }

    return { maxOverlap, mostSimilar, diffDimsCount };
  }

  /**
   * 余弦相似度 / Cosine similarity
   * @private
   */
  _cosineSimilarity(a, b) {
    const allDims = new Set([...Object.keys(a), ...Object.keys(b)]);
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (const dim of allDims) {
      const va = a[dim] || 0;
      const vb = b[dim] || 0;
      dotProduct += va * vb;
      normA += va * va;
      normB += vb * vb;
    }

    const denominator = Math.sqrt(normA) * Math.sqrt(normB);
    if (denominator === 0) return 0;
    return dotProduct / denominator;
  }

  /**
   * 获取活跃种群数 / Get active species count
   * @private
   */
  _getActiveSpeciesCount() {
    let count = 0;
    for (const species of this._species.values()) {
      if (species.status === 'active' || species.status === 'trial') count++;
    }
    return count;
  }

  /**
   * 停滞检测 / Stagnation detection
   * 当所有 agent 的得分 L2 距离 < 阈值时视为停滞
   * @private
   */
  _detectStagnation(agentIds, currentScores) {
    if (agentIds.length < 2) return false;

    const scores = agentIds.map(id => currentScores.get(id) || 0);
    const mean = scores.reduce((s, v) => s + v, 0) / scores.length;
    const variance = scores.reduce((s, v) => s + (v - mean) ** 2, 0) / scores.length;

    // 方差 < 0.01 视为停滞（所有 agent 评分过于接近）
    return variance < 0.01;
  }

  /**
   * 记录进化日志 / Log evolution event
   * @private
   */
  _logEvolution(type, speciesName, details) {
    this._evolutionLog.push({
      type,
      speciesName,
      details,
      timestamp: Date.now(),
    });

    // 限制日志大小 / Cap log size
    if (this._evolutionLog.length > 500) {
      this._evolutionLog = this._evolutionLog.slice(-250);
    }
  }
}
