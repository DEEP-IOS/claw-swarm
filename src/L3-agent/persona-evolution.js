/**
 * PersonaEvolution — GEP 引导进化协议 / Guided Evolution Protocol
 *
 * v4.x 迁移增强: 从简单的胜率记录扩展到完整的 GEP 协议, 包含四阶段进化:
 *   1. detect: 检测低绩效人格 (胜率 < 40%) / Detect underperformers
 *   2. mutate: 参数变异 (±10%) / Mutate persona parameters
 *   3. A/B test: 对照实验 / Controlled experiments
 *   4. promote: 高胜率人格封装为可复用胶囊 / Promote to reusable capsule
 *
 * Migrated from v4.x: expanded from simple win-rate tracking to the full GEP
 * protocol with four evolution phases: detect, mutate, A/B test, promote.
 *
 * GEP Protocol:
 *   detect:  detectUnderperformers(taskType, threshold=0.4) → personas with winRate < 40%
 *   mutate:  mutatePersona(personaId, rate=0.1) → ±10% parameter variation
 *   A/B test: startABTest(personaA, personaB, taskType, trials=3)
 *   promote: promoteToCapsule(personaId) → winRate > 70% → reusable capsule
 *
 * @module L3-agent/persona-evolution
 * @author DEEP-IOS
 */

import { nanoid } from 'nanoid';

// ============================================================================
// 常量 / Constants
// ============================================================================

/** 默认阈值: 低于此胜率视为低绩效 / Default underperformer threshold */
const DEFAULT_UNDERPERFORMER_THRESHOLD = 0.4;

/** 最少执行次数才能评估 / Minimum executions before evaluation */
const DEFAULT_MIN_EXECUTIONS = 5;

/** 默认变异率 / Default mutation rate */
const DEFAULT_MUTATION_RATE = 0.1;

/** 默认 A/B 试验次数 / Default A/B test trial count */
const DEFAULT_AB_TRIALS = 3;

/** 晋升为胶囊的最低胜率 / Minimum win rate for capsule promotion */
const CAPSULE_PROMOTION_THRESHOLD = 0.7;

/** 可变异的人格参数 / Mutable persona parameters */
const MUTABLE_PARAMS = [
  'creativity',
  'verbosity',
  'riskTolerance',
  'detailOrientation',
  'collaborativeness',
  'autonomy',
  'speed',
  'thoroughness',
];

// ============================================================================
// PersonaEvolution
// ============================================================================

export class PersonaEvolution {
  /**
   * @param {Object} deps - 依赖注入 / Dependency injection
   * @param {import('../L1-infrastructure/database/repositories/agent-repo.js').AgentRepository} deps.agentRepo
   * @param {import('../L2-communication/message-bus.js').MessageBus} deps.messageBus
   * @param {Object} deps.logger
   */
  constructor({ agentRepo, messageBus, logger }) {
    /** @private */
    this._agentRepo = agentRepo;
    /** @private */
    this._messageBus = messageBus;
    /** @private */
    this._logger = logger;

    /**
     * 进行中的 A/B 测试 / Active A/B tests
     * Map<testId, { personaA, personaB, taskType, trials, results: [] }>
     * @private
     */
    this._abTests = new Map();

    /**
     * 进化历史日志 / Evolution history log
     * @private @type {Array<Object>}
     */
    this._evolutionLog = [];

    /**
     * 人格配置缓存 / Persona config cache
     * Map<personaId, config>
     * @private
     */
    this._personaConfigs = new Map();
  }

  // --------------------------------------------------------------------------
  // Phase 1: 检测低绩效人格 / Detect Underperformers
  // --------------------------------------------------------------------------

  /**
   * 检测指定任务类型下胜率低于阈值的人格 / Detect personas below win-rate threshold
   *
   * @param {string} taskType - 任务类型 / Task type
   * @param {Object} [options]
   * @param {number} [options.threshold=0.4] - 胜率阈值 / Win rate threshold
   * @param {number} [options.minExecutions=5] - 最少执行次数 / Min executions
   * @returns {Array<{ personaId: string, winRate: number, executions: number }>}
   */
  detectUnderperformers(taskType, options = {}) {
    const threshold = options.threshold ?? DEFAULT_UNDERPERFORMER_THRESHOLD;
    const minExec = options.minExecutions ?? DEFAULT_MIN_EXECUTIONS;

    // 获取所有人格统计 / Get all persona stats for this task type
    const agents = this._agentRepo.listAgents();
    const personaStats = new Map(); // personaId → { wins, total }

    for (const agent of agents) {
      const stats = this._agentRepo.getPersonaStats(agent.id, taskType);
      if (!stats || stats.count < minExec) continue;

      // 使用 agent 的 role 或 persona 字段作为 personaId
      // Use agent's role or persona field as personaId
      const personaId = agent.role || agent.id;
      const existing = personaStats.get(personaId) || { wins: 0, total: 0 };
      existing.wins += Math.round(stats.successRate * stats.count);
      existing.total += stats.count;
      personaStats.set(personaId, existing);
    }

    // 过滤低绩效 / Filter underperformers
    const underperformers = [];
    for (const [personaId, { wins, total }] of personaStats) {
      if (total < minExec) continue;
      const winRate = wins / total;
      if (winRate < threshold) {
        underperformers.push({ personaId, winRate: Math.round(winRate * 1000) / 1000, executions: total });
      }
    }

    this._logger.info(
      { taskType, threshold, found: underperformers.length },
      'underperformer detection complete / 低绩效检测完成',
    );

    this._messageBus.publish?.('persona.underperformers.detected', {
      taskType,
      count: underperformers.length,
      personaIds: underperformers.map((u) => u.personaId),
    });

    return underperformers;
  }

  // --------------------------------------------------------------------------
  // Phase 2: 参数变异 / Parameter Mutation
  // --------------------------------------------------------------------------

  /**
   * 对人格参数进行随机变异 / Apply random mutation to persona parameters
   *
   * 每个可变参数在 [1-rate, 1+rate] 范围内随机缩放。
   * Each mutable parameter is randomly scaled within [1-rate, 1+rate].
   *
   * @param {string} personaId - 人格 ID / Persona ID
   * @param {Object} [options]
   * @param {number} [options.mutationRate=0.1] - 变异幅度 / Mutation amplitude
   * @returns {Object} 变异后的配置 / Mutated configuration
   */
  mutatePersona(personaId, options = {}) {
    const rate = options.mutationRate ?? DEFAULT_MUTATION_RATE;

    // 获取当前配置 / Get current config
    const currentConfig = this._getPersonaConfig(personaId);
    const mutated = { ...currentConfig };

    const mutations = [];

    for (const param of MUTABLE_PARAMS) {
      if (typeof mutated[param] === 'number') {
        const original = mutated[param];
        // V5.1 fix: 加法变异替代乘法变异（消除零值陷阱）
        // V5.1 fix: Additive mutation replaces multiplicative (eliminates zero-value trap)
        // clamp(original + random(-rate, +rate), 0.001, 1.0)
        const delta = (Math.random() * 2 - 1) * rate;
        mutated[param] = Math.max(0.001, Math.min(1, original + delta));
        mutated[param] = Math.round(mutated[param] * 1000) / 1000;

        if (mutated[param] !== original) {
          mutations.push({ param, from: original, to: mutated[param] });
        }
      }
    }

    // 记录变异 / Record mutation
    mutated._mutationId = nanoid(12);
    mutated._parentPersonaId = personaId;
    mutated._mutationRate = rate;
    mutated._mutatedAt = Date.now();

    // 存入缓存 / Store in cache
    const mutatedId = `${personaId}_m${mutated._mutationId}`;
    this._personaConfigs.set(mutatedId, mutated);

    // 记录进化日志 / Log evolution event
    this._logEvolution('mutation', personaId, {
      mutatedId,
      rate,
      mutations,
    });

    this._messageBus.publish?.('persona.mutated', {
      personaId,
      mutatedId,
      mutations,
    });

    this._logger.debug(
      { personaId, mutatedId, mutationCount: mutations.length },
      'persona mutated / 人格变异完成',
    );

    return { ...mutated, id: mutatedId };
  }

  // --------------------------------------------------------------------------
  // Phase 3: A/B 测试 / A/B Testing
  // --------------------------------------------------------------------------

  /**
   * 启动 A/B 对照测试 / Start an A/B comparison test
   *
   * 创建一个对照实验, 将 personaA 与 personaB 在同类型任务上对比。
   * Creates a controlled experiment comparing personaA vs personaB on a task type.
   *
   * @param {string} personaA - 人格 A (通常是原始版) / Persona A (usually original)
   * @param {string} personaB - 人格 B (通常是变异版) / Persona B (usually mutated)
   * @param {string} taskType - 任务类型 / Task type
   * @param {Object} [options]
   * @param {number} [options.trials=3] - 试验次数 / Number of trials
   * @returns {string} testId
   */
  startABTest(personaA, personaB, taskType, options = {}) {
    const trials = options.trials ?? DEFAULT_AB_TRIALS;
    const testId = `ab_${nanoid(10)}`;

    const test = {
      testId,
      personaA,
      personaB,
      taskType,
      trials,
      results: [],
      startedAt: Date.now(),
      status: 'running',
    };

    this._abTests.set(testId, test);

    this._logEvolution('ab_test_started', personaA, {
      testId,
      personaA,
      personaB,
      taskType,
      trials,
    });

    this._messageBus.publish?.('persona.abtest.started', {
      testId,
      personaA,
      personaB,
      taskType,
      trials,
    });

    this._logger.info(
      { testId, personaA, personaB, taskType, trials },
      'A/B test started / A/B 测试已启动',
    );

    return testId;
  }

  /**
   * 记录 A/B 测试结果 / Record an A/B test trial result
   *
   * @param {string} testId
   * @param {Object} result
   * @param {string} result.persona - 使用的人格 / Which persona was used
   * @param {boolean} result.success
   * @param {number} result.quality - 质量 0-1 / Quality 0-1
   * @param {number} result.speed - 速度 0-1 / Speed 0-1
   * @returns {boolean} 是否所有试验已完成 / Whether all trials are done
   */
  recordABResult(testId, result) {
    const test = this._abTests.get(testId);
    if (!test || test.status !== 'running') {
      this._logger.warn({ testId }, 'A/B test not found or not running / A/B 测试未找到或未运行');
      return false;
    }

    test.results.push({
      ...result,
      recordedAt: Date.now(),
    });

    // 检查是否所有试验已完成 / Check if all trials are done
    const totalNeeded = test.trials * 2; // 每个人格各 trials 次 / trials per persona
    return test.results.length >= totalNeeded;
  }

  /**
   * 评估 A/B 测试结果 / Evaluate A/B test outcome
   *
   * 比较两个人格的平均质量和胜率, 返回胜出者。
   * Compares average quality and win rate of both personas, returns the winner.
   *
   * @param {string} testId
   * @returns {{ winner: string|null, metrics: Object }}
   */
  evaluateABTest(testId) {
    const test = this._abTests.get(testId);
    if (!test) {
      return { winner: null, metrics: { error: 'test not found' } };
    }

    // 按人格分组 / Group by persona
    const statsA = this._computeTestStats(test.results, test.personaA);
    const statsB = this._computeTestStats(test.results, test.personaB);

    // 综合评分: quality×0.6 + winRate×0.4 / Composite: quality×0.6 + winRate×0.4
    const scoreA = (statsA.avgQuality * 0.6) + (statsA.winRate * 0.4);
    const scoreB = (statsB.avgQuality * 0.6) + (statsB.winRate * 0.4);

    const winner = scoreA >= scoreB ? test.personaA : test.personaB;

    test.status = 'completed';
    test.completedAt = Date.now();

    const metrics = {
      personaA: { ...statsA, compositeScore: Math.round(scoreA * 1000) / 1000 },
      personaB: { ...statsB, compositeScore: Math.round(scoreB * 1000) / 1000 },
      winner,
      margin: Math.round(Math.abs(scoreA - scoreB) * 1000) / 1000,
    };

    this._logEvolution('ab_test_completed', winner, { testId, metrics });
    this._messageBus.publish?.('persona.abtest.completed', { testId, winner, metrics });

    this._logger.info({ testId, winner, margin: metrics.margin }, 'A/B test evaluated / A/B 测试评估完成');

    // V5.1: 清理已完成测试, 防止 _abTests Map 无限增长
    // V5.1: Remove completed test to prevent unbounded _abTests Map growth
    this._abTests.delete(testId);

    return { winner, metrics };
  }

  /**
   * 清理过期的 A/B 测试记录 / Prune stale A/B test records
   *
   * 移除超过 maxAge 仍未完成的测试（防止僵尸测试占用内存）。
   * Remove tests that have been pending for longer than maxAge.
   *
   * @param {number} [maxAgeMs=3600000] - 最大存活时间 (默认 1h) / Max age in ms (default 1h)
   * @returns {number} 清理数量 / Number of pruned tests
   */
  pruneStaleTests(maxAgeMs = 3600000) {
    const now = Date.now();
    let pruned = 0;
    for (const [id, test] of this._abTests) {
      const age = now - (test.startedAt || 0);
      if (age > maxAgeMs) {
        this._abTests.delete(id);
        pruned++;
      }
    }
    return pruned;
  }

  // --------------------------------------------------------------------------
  // Phase 4: 胶囊封装 / Capsule Promotion
  // --------------------------------------------------------------------------

  /**
   * 将高绩效人格封装为可复用胶囊 / Promote high-performing persona to reusable capsule
   *
   * 当人格胜率 > 70% 时, 将其配置固化为 persona_capsule 记录。
   * When persona win rate > 70%, freeze its config as a persona capsule.
   *
   * @param {string} personaId
   * @returns {string|null} capsuleId 或 null (若不符合条件) / capsuleId or null
   */
  promoteToCapsule(personaId) {
    // 获取人格统计 / Get persona stats
    const stats = this._agentRepo.getPersonaStats(personaId, null);

    if (!stats || stats.count < DEFAULT_MIN_EXECUTIONS) {
      this._logger.warn(
        { personaId, executions: stats?.count },
        'insufficient data for promotion / 数据不足, 无法封装',
      );
      return null;
    }

    if (stats.successRate < CAPSULE_PROMOTION_THRESHOLD) {
      this._logger.info(
        { personaId, winRate: stats.successRate },
        'win rate below promotion threshold / 胜率低于封装阈值',
      );
      return null;
    }

    // 生成胶囊 / Generate capsule
    const capsuleId = `capsule_${nanoid(10)}`;
    const config = this._getPersonaConfig(personaId);

    const capsule = {
      id: capsuleId,
      sourcePersonaId: personaId,
      config: { ...config },
      stats: {
        winRate: stats.successRate,
        avgQuality: stats.avgQuality,
        executions: stats.count,
      },
      promotedAt: Date.now(),
    };

    // 持久化 (通过 agentRepo 或消息总线通知外部存储)
    // Persist via agentRepo or notify external storage via message bus
    this._messageBus.publish?.('persona.capsule.promoted', capsule);

    this._logEvolution('capsule_promoted', personaId, { capsuleId, stats: capsule.stats });

    this._logger.info(
      { personaId, capsuleId, winRate: stats.successRate },
      'persona promoted to capsule / 人格已封装为胶囊',
    );

    return capsuleId;
  }

  // --------------------------------------------------------------------------
  // 统计与历史 / Stats & History
  // --------------------------------------------------------------------------

  /**
   * 获取人格统计信息 / Get persona statistics
   *
   * @param {string} personaId
   * @returns {{ winRate: number, executions: number, avgQuality: number }}
   */
  getPersonaStats(personaId) {
    const stats = this._agentRepo.getPersonaStats(personaId, null);
    return {
      winRate: stats?.successRate || 0,
      executions: stats?.count || 0,
      avgQuality: stats?.avgQuality || 0,
    };
  }

  /**
   * 获取人格进化历史 / Get evolution history for a persona
   *
   * @param {string} personaId
   * @returns {Array<Object>} 进化日志条目 / Evolution log entries
   */
  getEvolutionHistory(personaId) {
    return this._evolutionLog.filter(
      (entry) => entry.personaId === personaId || entry.details?.mutatedId?.startsWith(personaId),
    );
  }

  /**
   * 记录人格任务结果 (v4.x 兼容) / Record persona task outcome (v4.x compat)
   *
   * @param {Object} outcome
   * @param {string} outcome.personaId
   * @param {string} outcome.taskType
   * @param {boolean} outcome.success
   * @param {number} [outcome.qualityScore]
   * @param {number} [outcome.durationMs]
   * @returns {void}
   */
  recordOutcome(outcome) {
    this._agentRepo.recordPersonaOutcome({
      personaId: outcome.personaId,
      taskType: outcome.taskType,
      success: outcome.success ? 1 : 0,
      qualityScore: outcome.qualityScore ?? null,
      durationMs: outcome.durationMs ?? null,
      notes: null,
    });

    this._messageBus.publish?.('persona.outcome.recorded', {
      personaId: outcome.personaId,
      taskType: outcome.taskType,
      success: outcome.success,
    });
  }

  // --------------------------------------------------------------------------
  // 私有方法 / Private Methods
  // --------------------------------------------------------------------------

  /**
   * 获取人格配置 (缓存或默认) / Get persona config from cache or defaults
   *
   * @param {string} personaId
   * @returns {Object}
   * @private
   */
  _getPersonaConfig(personaId) {
    if (this._personaConfigs.has(personaId)) {
      return { ...this._personaConfigs.get(personaId) };
    }

    // 返回默认配置 / Return default config
    const defaults = {};
    for (const param of MUTABLE_PARAMS) {
      defaults[param] = 0.5; // 中性起点 / Neutral starting point
    }
    defaults.id = personaId;
    return defaults;
  }

  /**
   * 计算测试统计 / Compute test statistics for a persona within an A/B test
   *
   * @param {Array<Object>} results - 全部结果 / All results
   * @param {string} personaId - 要计算的人格 / Persona to compute for
   * @returns {{ winRate: number, avgQuality: number, avgSpeed: number, count: number }}
   * @private
   */
  _computeTestStats(results, personaId) {
    const personaResults = results.filter((r) => r.persona === personaId);
    if (personaResults.length === 0) {
      return { winRate: 0, avgQuality: 0, avgSpeed: 0, count: 0 };
    }

    const count = personaResults.length;
    const wins = personaResults.filter((r) => r.success).length;
    const avgQuality = personaResults.reduce((s, r) => s + (r.quality || 0), 0) / count;
    const avgSpeed = personaResults.reduce((s, r) => s + (r.speed || 0), 0) / count;

    return {
      winRate: Math.round((wins / count) * 1000) / 1000,
      avgQuality: Math.round(avgQuality * 1000) / 1000,
      avgSpeed: Math.round(avgSpeed * 1000) / 1000,
      count,
    };
  }

  /**
   * 记录进化日志 / Add entry to evolution log
   *
   * @param {string} type - 事件类型 / Event type
   * @param {string} personaId
   * @param {Object} details
   * @private
   */
  _logEvolution(type, personaId, details) {
    this._evolutionLog.push({
      type,
      personaId,
      details,
      timestamp: Date.now(),
    });

    // 限制日志大小 / Cap log size
    if (this._evolutionLog.length > 1000) {
      this._evolutionLog = this._evolutionLog.slice(-500);
    }
  }
}
