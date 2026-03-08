/**
 * QualityController -- 3 层质量门控 / 3-Layer Quality Gate Controller
 *
 * 从 v4.x quality-controller.js (~527行) 迁移并升级:
 * Migrated and upgraded from v4.x quality-controller.js (~527 lines):
 *
 * - 3 个质量评审层级: self-review, peer-review, lead-review
 *   3 quality review tiers: self-review, peer-review, lead-review
 * - 多维度质量分数计算 (正确性、完整性、代码质量、文档、测试覆盖)
 *   Multi-criteria quality score computation (correctness, completeness, code quality, docs, test coverage)
 * - 门控通过/拒绝决策 / Gate pass/fail decisions
 * - 重试/终止逻辑 / Retry/abort logic
 * - 集成 MessageBus 事件 / Integration with MessageBus for events
 *
 * V5.0 适配:
 * - 构造函数接收 { taskRepo, agentRepo, messageBus, config, logger }
 * - 所有事件通过 messageBus.publish() 发布
 * - 质量评估记录通过 taskRepo 持久化
 *
 * @module L4-orchestration/quality-controller
 * @author DEEP-IOS
 */

import { nanoid } from 'nanoid';

// ============================================================================
// 常量 / Constants
// ============================================================================

/**
 * 质量评审层级 / Quality review tiers
 * 按严格程度递增 / In increasing order of strictness
 */
export const QualityTier = Object.freeze({
  SELF: 'self-review',
  PEER: 'peer-review',
  LEAD: 'lead-review',
});

/**
 * 质量维度 / Quality dimensions
 */
export const QualityDimension = Object.freeze({
  CORRECTNESS: 'correctness',     // 正确性 - Does it solve the problem correctly?
  COMPLETENESS: 'completeness',   // 完整性 - Are all requirements addressed?
  CODE_QUALITY: 'code_quality',   // 代码质量 - Clean code, no smells?
  DOCUMENTATION: 'documentation', // 文档 - Is it well documented?
  TEST_COVERAGE: 'test_coverage', // 测试覆盖 - Are tests comprehensive?
  PERFORMANCE: 'performance',     // 性能 - Meets performance requirements?
  SECURITY: 'security',           // 安全性 - No security vulnerabilities?
});

/**
 * 质量评估结果 / Quality evaluation verdict
 */
export const QualityVerdict = Object.freeze({
  PASS: 'pass',         // 通过 - Meets quality standards
  FAIL: 'fail',         // 未通过 - Below quality standards
  CONDITIONAL: 'conditional', // 有条件通过 - Minor issues, acceptable
});

/**
 * 各层级默认阈值 / Default thresholds per tier
 */
const DEFAULT_THRESHOLDS = {
  [QualityTier.SELF]: 0.6,
  [QualityTier.PEER]: 0.7,
  [QualityTier.LEAD]: 0.85,
};

/**
 * 各维度默认权重 / Default weights per dimension
 */
const DEFAULT_WEIGHTS = {
  [QualityDimension.CORRECTNESS]: 0.30,
  [QualityDimension.COMPLETENESS]: 0.25,
  [QualityDimension.CODE_QUALITY]: 0.15,
  [QualityDimension.DOCUMENTATION]: 0.10,
  [QualityDimension.TEST_COVERAGE]: 0.10,
  [QualityDimension.PERFORMANCE]: 0.05,
  [QualityDimension.SECURITY]: 0.05,
};

/**
 * 默认最大重试次数 / Default max retries
 */
const DEFAULT_MAX_RETRIES = 3;

/**
 * 评估历史最大任务数 (LRU) / Max tasks tracked in evaluation history (LRU)
 * 超出时驱逐最早的任务条目, 防止内存无限增长。
 * When exceeded, evict oldest task entries to prevent unbounded memory growth.
 */
const MAX_HISTORY_TASKS = 500;

/**
 * 有条件通过的分数下界 / Conditional pass lower bound
 * 分数 >= threshold * conditionalRatio 且 < threshold 时为有条件通过
 */
const DEFAULT_CONDITIONAL_RATIO = 0.85;

// ============================================================================
// 内部类型 / Internal Types
// ============================================================================

/**
 * @typedef {Object} DimensionScore
 * 单维度评分 / Single dimension score
 * @property {string} dimension - 维度名称
 * @property {number} score - 分数 (0-1)
 * @property {string} [feedback] - 反馈说明
 */

/**
 * @typedef {Object} EvaluationRecord
 * 评估记录 / Evaluation record
 * @property {string} id - 记录 ID
 * @property {string} taskId - 任务 ID
 * @property {string} tier - 评审层级
 * @property {number} score - 综合分数
 * @property {string} verdict - 通过/失败/有条件
 * @property {DimensionScore[]} dimensions - 各维度评分
 * @property {string[]} feedback - 反馈列表
 * @property {string|null} reviewerId - 评审者 ID
 * @property {number} timestamp - 时间戳
 */

/**
 * @typedef {Object} EvaluationResult
 * 评估返回结果 / Evaluation return result
 * @property {boolean} passed - 是否通过
 * @property {number} score - 综合分数 (0-1)
 * @property {string} tier - 评审层级
 * @property {string} verdict - 判定结果
 * @property {string[]} feedback - 反馈列表
 * @property {DimensionScore[]} dimensions - 各维度详情
 * @property {string} evaluationId - 评估记录 ID
 */

// ============================================================================
// QualityController 主类 / Main Class
// ============================================================================

export class QualityController {
  /**
   * @param {Object} deps - 依赖注入 / Dependency injection
   * @param {import('../L1-infrastructure/database/repositories/task-repo.js').TaskRepository} deps.taskRepo
   * @param {import('../L1-infrastructure/database/repositories/agent-repo.js').AgentRepository} deps.agentRepo
   * @param {import('../L2-communication/message-bus.js').MessageBus} deps.messageBus
   * @param {Object} [deps.config] - 质量控制配置 / Quality control config
   * @param {Object} [deps.logger] - 日志器 / Logger
   */
  constructor({ taskRepo, agentRepo, messageBus, config = {}, logger = console }) {
    /** @type {import('../L1-infrastructure/database/repositories/task-repo.js').TaskRepository} */
    this._taskRepo = taskRepo;

    /** @type {import('../L1-infrastructure/database/repositories/agent-repo.js').AgentRepository} */
    this._agentRepo = agentRepo;

    /** @type {import('../L2-communication/message-bus.js').MessageBus} */
    this._messageBus = messageBus;

    /** @type {Object} 质量控制配置 / Quality control configuration */
    this._config = {
      thresholds: { ...DEFAULT_THRESHOLDS, ...config.thresholds },
      weights: { ...DEFAULT_WEIGHTS, ...config.weights },
      maxRetries: config.maxRetries ?? DEFAULT_MAX_RETRIES,
      conditionalRatio: config.conditionalRatio ?? DEFAULT_CONDITIONAL_RATIO,
      autoEscalate: config.autoEscalate !== false, // 默认开启自动升级 / Auto-escalate by default
      ...config,
    };

    /** @type {Object} */
    this._logger = logger;

    /**
     * 评估历史 (按 taskId 索引)
     * Evaluation history (indexed by taskId)
     * @type {Map<string, EvaluationRecord[]>}
     */
    this._evaluationHistory = new Map();

    /**
     * 失败计数 (按 taskId 索引)
     * Failure count (indexed by taskId)
     * @type {Map<string, number>}
     */
    this._failCounts = new Map();

    /**
     * 外部评分函数 (可插拔)
     * External scoring functions (pluggable)
     * @type {Map<string, (result: Object, context: Object) => number>}
     */
    this._scoringFunctions = new Map();

    this._logger.info?.('[QualityController] 初始化完成 / Initialized');
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 配置 / Configuration
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  /**
   * 注册自定义评分函数
   * Register a custom scoring function for a quality dimension
   *
   * @param {string} dimension - 维度名称 (来自 QualityDimension 或自定义)
   * @param {(result: Object, context: Object) => number} scoreFn - 评分函数, 返回 0-1
   */
  registerScoringFunction(dimension, scoreFn) {
    this._scoringFunctions.set(dimension, scoreFn);
    this._logger.debug?.(
      `[QualityController] 注册评分函数 / Scoring function registered: ${dimension}`,
    );
  }

  /**
   * 获取指定层级的通过阈值
   * Get pass threshold for a specific tier
   *
   * @param {string} tier - 评审层级
   * @returns {number} 阈值 (0-1)
   */
  getThreshold(tier) {
    return this._config.thresholds[tier] ?? DEFAULT_THRESHOLDS[QualityTier.PEER];
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 核心评估 / Core Evaluation
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  /**
   * 评估任务结果质量
   * Evaluate task result quality
   *
   * 自动确定评审层级 (或由 options.tier 指定)。
   * 计算多维度质量分数, 与阈值比较, 做出通过/拒绝决策。
   *
   * Automatically determines review tier (or use options.tier).
   * Computes multi-dimensional quality score, compares with threshold, makes pass/fail decision.
   *
   * @param {string} taskId - 任务 ID
   * @param {Object} result - 任务执行结果
   * @param {Object} [options]
   * @param {string} [options.tier] - 强制指定评审层级
   * @param {string} [options.reviewerId] - 评审者 Agent ID
   * @param {DimensionScore[]} [options.scores] - 外部提供的维度评分
   * @param {string} [options.taskType] - 任务类型 (用于调整权重)
   * @returns {Promise<EvaluationResult>}
   */
  async evaluate(taskId, result, options = {}) {
    const tier = options.tier || this._determineTier(taskId);
    const threshold = this.getThreshold(tier);

    this._logger.info?.(
      `[QualityController] 开始 ${tier} 评估 / Starting ${tier} evaluation for task: ${taskId}`,
    );

    this._messageBus.publish('quality.evaluation.started', {
      taskId,
      tier,
      threshold,
    });

    // Step 1: 计算各维度分数 / Compute dimension scores
    const dimensions = options.scores
      ? this._normalizeDimensionScores(options.scores)
      : await this._computeDimensionScores(taskId, result, options);

    // Step 2: 加权聚合为综合分数 / Weighted aggregation into composite score
    const score = this._computeCompositeScore(dimensions);

    // Step 3: 做出判定 / Make verdict
    const verdict = this._makeVerdict(score, threshold);

    // Step 4: 生成反馈 / Generate feedback
    const feedback = this._generateFeedback(dimensions, threshold, tier, verdict);

    // Step 5: 创建评估记录 / Create evaluation record
    const evaluationId = nanoid();
    /** @type {EvaluationRecord} */
    const record = {
      id: evaluationId,
      taskId,
      tier,
      score: Math.round(score * 1000) / 1000, // 保留 3 位小数
      verdict,
      dimensions,
      feedback,
      reviewerId: options.reviewerId || null,
      timestamp: Date.now(),
    };

    // 存储评估记录 / Store evaluation record
    this.recordEvaluation(taskId, record);

    // 更新失败计数 / Update failure count
    if (verdict === QualityVerdict.FAIL) {
      const count = (this._failCounts.get(taskId) || 0) + 1;
      this._failCounts.set(taskId, count);
    }

    const passed = verdict === QualityVerdict.PASS || verdict === QualityVerdict.CONDITIONAL;

    // 发布评估结果事件 / Publish evaluation result event
    this._messageBus.publish('quality.evaluation.completed', {
      taskId,
      tier,
      score: record.score,
      verdict,
      passed,
      evaluationId,
    });

    // 自动升级逻辑 / Auto-escalation logic
    if (!passed && this._config.autoEscalate) {
      await this._handleEscalation(taskId, tier, record);
    }

    this._logger.info?.(
      `[QualityController] ${tier} 评估完成 / ${tier} evaluation complete: ` +
      `score=${record.score}, verdict=${verdict}, passed=${passed}`,
    );

    return {
      passed,
      score: record.score,
      tier,
      verdict,
      feedback,
      dimensions,
      evaluationId,
    };
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 维度评分 / Dimension Scoring
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  /**
   * 计算各维度质量分数
   * Compute quality scores for each dimension
   *
   * 优先使用注册的自定义评分函数, 否则使用内置启发式。
   * Uses registered custom scoring functions first, falls back to built-in heuristics.
   *
   * @private
   * @param {string} taskId
   * @param {Object} result - 任务结果
   * @param {Object} options
   * @returns {Promise<DimensionScore[]>}
   */
  async _computeDimensionScores(taskId, result, options) {
    const dimensions = [];
    const context = { taskId, taskType: options.taskType, result };

    for (const [dimension, weight] of Object.entries(this._config.weights)) {
      if (weight <= 0) continue; // 跳过权重为 0 的维度

      let score;
      let feedback = '';

      // 检查自定义评分函数 / Check custom scoring function
      const customFn = this._scoringFunctions.get(dimension);
      if (customFn) {
        try {
          score = customFn(result, context);
          score = Math.max(0, Math.min(1, score)); // 钳位到 [0,1]
        } catch (err) {
          this._logger.warn?.(
            `[QualityController] 自定义评分函数失败 / Custom scoring failed for ${dimension}: ${err.message}`,
          );
          score = 0.5; // 默认中等分 / Default to median
          feedback = `评分函数异常, 使用默认值 / Scoring error, using default`;
        }
      } else {
        // 内置启发式评分 / Built-in heuristic scoring
        const heuristic = this._builtinHeuristic(dimension, result);
        score = heuristic.score;
        feedback = heuristic.feedback;
      }

      dimensions.push({ dimension, score, feedback, weight });
    }

    return dimensions;
  }

  /**
   * 内置启发式评分
   * Built-in heuristic scoring
   *
   * 基于结果数据的结构性分析。真正的评分应通过 registerScoringFunction 注入。
   * Based on structural analysis of result data. Real scoring should be injected via registerScoringFunction.
   *
   * @private
   * @param {string} dimension
   * @param {Object} result
   * @returns {{ score: number, feedback: string }}
   */
  _builtinHeuristic(dimension, result) {
    // 如果 result 中直接包含对应维度的分数, 直接使用
    // If result directly contains a score for this dimension, use it
    if (result && typeof result[dimension] === 'number') {
      return {
        score: Math.max(0, Math.min(1, result[dimension])),
        feedback: '',
      };
    }

    // 如果 result 中有 qualityScores 对象 / If result has qualityScores object
    if (result?.qualityScores && typeof result.qualityScores[dimension] === 'number') {
      return {
        score: Math.max(0, Math.min(1, result.qualityScores[dimension])),
        feedback: '',
      };
    }

    // 通用启发式 / Generic heuristic
    switch (dimension) {
      case QualityDimension.CORRECTNESS:
        return this._heuristicCorrectness(result);
      case QualityDimension.COMPLETENESS:
        return this._heuristicCompleteness(result);
      case QualityDimension.CODE_QUALITY:
        return this._heuristicCodeQuality(result);
      case QualityDimension.DOCUMENTATION:
        return this._heuristicDocumentation(result);
      case QualityDimension.TEST_COVERAGE:
        return this._heuristicTestCoverage(result);
      case QualityDimension.PERFORMANCE:
        return this._heuristicPerformance(result);
      case QualityDimension.SECURITY:
        return this._heuristicSecurity(result);
      default:
        return { score: 0.5, feedback: `未知维度 / Unknown dimension: ${dimension}` };
    }
  }

  /**
   * 正确性启发式 / Correctness heuristic
   * @private
   */
  _heuristicCorrectness(result) {
    if (!result) return { score: 0, feedback: '无结果 / No result' };
    if (result.error) return { score: 0.1, feedback: `结果含错误 / Result has error: ${result.error}` };
    if (result.success === false) return { score: 0.2, feedback: '执行报告失败 / Execution reported failure' };
    if (result.simulated) return { score: 0.5, feedback: '模拟执行 / Simulated execution' };
    if (result.output || result.content || result.data) return { score: 0.8, feedback: '有输出内容 / Has output content' };
    return { score: 0.6, feedback: '基础结果检查通过 / Basic result check passed' };
  }

  /**
   * 完整性启发式 / Completeness heuristic
   * @private
   */
  _heuristicCompleteness(result) {
    if (!result) return { score: 0, feedback: '无结果 / No result' };

    let completenessScore = 0.5;
    const feedback = [];

    // 检查是否有预期的输出字段 / Check for expected output fields
    if (result.artifacts && result.artifacts.length > 0) {
      completenessScore += 0.2;
      feedback.push(`${result.artifacts.length} 个产物 / artifacts`);
    }
    if (result.subtaskResults) {
      const total = Object.keys(result.subtaskResults).length;
      const completed = Object.values(result.subtaskResults).filter(
        (r) => r.status === 'completed',
      ).length;
      completenessScore = total > 0 ? completed / total : 0.5;
      feedback.push(`子任务完成率 / Subtask completion: ${completed}/${total}`);
    }
    if (result.checklist) {
      const total = result.checklist.length;
      const checked = result.checklist.filter((c) => c.done || c.checked).length;
      completenessScore = total > 0 ? checked / total : 0.5;
      feedback.push(`清单完成率 / Checklist: ${checked}/${total}`);
    }

    return {
      score: Math.max(0, Math.min(1, completenessScore)),
      feedback: feedback.join('; ') || '基础完整性检查 / Basic completeness check',
    };
  }

  /**
   * 代码质量启发式 / Code quality heuristic
   * @private
   */
  _heuristicCodeQuality(result) {
    if (!result) return { score: 0.5, feedback: '' };

    let score = 0.6;
    const feedback = [];

    if (result.lintErrors !== undefined) {
      score = result.lintErrors === 0 ? 0.9 : Math.max(0.2, 0.9 - result.lintErrors * 0.05);
      feedback.push(`Lint 错误: ${result.lintErrors}`);
    }
    if (result.codeSmells !== undefined) {
      const penalty = Math.min(0.3, result.codeSmells * 0.03);
      score = Math.max(0.2, score - penalty);
      feedback.push(`代码异味: ${result.codeSmells}`);
    }

    return { score: Math.max(0, Math.min(1, score)), feedback: feedback.join('; ') || '' };
  }

  /**
   * 文档启发式 / Documentation heuristic
   * @private
   */
  _heuristicDocumentation(result) {
    if (!result) return { score: 0.5, feedback: '' };

    if (typeof result.documentationScore === 'number') {
      return { score: Math.max(0, Math.min(1, result.documentationScore)), feedback: '' };
    }
    if (result.hasDocumentation === true) return { score: 0.8, feedback: '有文档 / Has documentation' };
    if (result.hasDocumentation === false) return { score: 0.2, feedback: '缺少文档 / Missing documentation' };

    return { score: 0.5, feedback: '无文档信息 / No documentation info' };
  }

  /**
   * 测试覆盖启发式 / Test coverage heuristic
   * @private
   */
  _heuristicTestCoverage(result) {
    if (!result) return { score: 0.5, feedback: '' };

    if (typeof result.testCoverage === 'number') {
      return {
        score: Math.max(0, Math.min(1, result.testCoverage / 100)),
        feedback: `覆盖率 / Coverage: ${result.testCoverage}%`,
      };
    }
    if (typeof result.testsPass === 'number' && typeof result.testsTotal === 'number') {
      const rate = result.testsTotal > 0 ? result.testsPass / result.testsTotal : 0;
      return { score: rate, feedback: `测试通过率 / Pass rate: ${result.testsPass}/${result.testsTotal}` };
    }

    return { score: 0.5, feedback: '无测试信息 / No test info' };
  }

  /**
   * 性能启发式 / Performance heuristic
   * @private
   */
  _heuristicPerformance(result) {
    if (!result) return { score: 0.5, feedback: '' };
    if (typeof result.performanceScore === 'number') {
      return { score: Math.max(0, Math.min(1, result.performanceScore)), feedback: '' };
    }
    return { score: 0.6, feedback: '无性能数据 / No performance data' };
  }

  /**
   * 安全性启发式 / Security heuristic
   * @private
   */
  _heuristicSecurity(result) {
    if (!result) return { score: 0.5, feedback: '' };

    if (result.vulnerabilities !== undefined) {
      const score = result.vulnerabilities === 0 ? 0.95 : Math.max(0.1, 0.95 - result.vulnerabilities * 0.15);
      return { score, feedback: `漏洞: ${result.vulnerabilities}` };
    }
    if (typeof result.securityScore === 'number') {
      return { score: Math.max(0, Math.min(1, result.securityScore)), feedback: '' };
    }

    return { score: 0.6, feedback: '无安全性数据 / No security data' };
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 分数计算 / Score Computation
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  /**
   * 加权综合分数计算
   * Weighted composite score computation
   *
   * score = sum(dimension_score_i * weight_i) / sum(weight_i)
   *
   * @private
   * @param {DimensionScore[]} dimensions
   * @returns {number} 综合分数 (0-1)
   */
  _computeCompositeScore(dimensions) {
    let weightedSum = 0;
    let totalWeight = 0;

    for (const dim of dimensions) {
      const weight = dim.weight ?? (this._config.weights[dim.dimension] || 0.1);
      weightedSum += dim.score * weight;
      totalWeight += weight;
    }

    if (totalWeight === 0) return 0;
    return weightedSum / totalWeight;
  }

  /**
   * 标准化外部提供的维度评分
   * Normalize externally provided dimension scores
   *
   * @private
   * @param {DimensionScore[]} scores
   * @returns {DimensionScore[]}
   */
  _normalizeDimensionScores(scores) {
    return scores.map((s) => ({
      dimension: s.dimension,
      score: Math.max(0, Math.min(1, s.score || 0)),
      feedback: s.feedback || '',
      weight: s.weight ?? (this._config.weights[s.dimension] || 0.1),
    }));
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 判定 / Verdict
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  /**
   * 做出质量判定
   * Make quality verdict
   *
   * - score >= threshold: PASS
   * - score >= threshold * conditionalRatio: CONDITIONAL
   * - score < threshold * conditionalRatio: FAIL
   *
   * @private
   * @param {number} score
   * @param {number} threshold
   * @returns {string} QualityVerdict
   */
  _makeVerdict(score, threshold) {
    if (score >= threshold) {
      return QualityVerdict.PASS;
    }

    const conditionalThreshold = threshold * this._config.conditionalRatio;
    if (score >= conditionalThreshold) {
      return QualityVerdict.CONDITIONAL;
    }

    return QualityVerdict.FAIL;
  }

  /**
   * 生成反馈信息
   * Generate feedback messages
   *
   * @private
   * @param {DimensionScore[]} dimensions
   * @param {number} threshold
   * @param {string} tier
   * @param {string} verdict
   * @returns {string[]}
   */
  _generateFeedback(dimensions, threshold, tier, verdict) {
    const feedback = [];

    // 总体反馈 / Overall feedback
    if (verdict === QualityVerdict.PASS) {
      feedback.push(`通过 ${tier} 质量门控 / Passed ${tier} quality gate`);
    } else if (verdict === QualityVerdict.CONDITIONAL) {
      feedback.push(
        `有条件通过 ${tier} 质量门控, 建议改善低分维度 / ` +
        `Conditionally passed ${tier}, recommend improving low-scoring dimensions`,
      );
    } else {
      feedback.push(`未通过 ${tier} 质量门控 (阈值 ${threshold}) / Failed ${tier} quality gate (threshold ${threshold})`);
    }

    // 低分维度反馈 / Low-scoring dimension feedback
    const sortedDimensions = [...dimensions].sort((a, b) => a.score - b.score);
    for (const dim of sortedDimensions) {
      if (dim.score < 0.5) {
        feedback.push(
          `${dim.dimension}: 分数过低 (${dim.score.toFixed(2)})` +
          (dim.feedback ? ` - ${dim.feedback}` : '') +
          ` / Score too low`,
        );
      }
    }

    // 高分维度肯定 / High-scoring dimension acknowledgment
    for (const dim of sortedDimensions) {
      if (dim.score >= 0.85) {
        feedback.push(
          `${dim.dimension}: 优秀 (${dim.score.toFixed(2)}) / Excellent`,
        );
      }
    }

    return feedback;
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 层级确定 / Tier Determination
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  /**
   * 自动确定评审层级
   * Automatically determine review tier
   *
   * 策略:
   * - 第一次评估: self-review
   * - self-review 失败后: peer-review
   * - peer-review 失败后: lead-review
   *
   * Strategy:
   * - First evaluation: self-review
   * - After self-review fails: peer-review
   * - After peer-review fails: lead-review
   *
   * @private
   * @param {string} taskId
   * @returns {string} QualityTier
   */
  _determineTier(taskId) {
    const history = this._evaluationHistory.get(taskId) || [];

    if (history.length === 0) {
      return QualityTier.SELF;
    }

    // 检查上一次评估的层级和结果 / Check last evaluation tier and result
    const lastEval = history[history.length - 1];

    if (lastEval.verdict === QualityVerdict.FAIL) {
      switch (lastEval.tier) {
        case QualityTier.SELF:
          return QualityTier.PEER;
        case QualityTier.PEER:
          return QualityTier.LEAD;
        case QualityTier.LEAD:
          return QualityTier.LEAD; // 已是最高级别 / Already highest tier
        default:
          return QualityTier.PEER;
      }
    }

    // 上次通过或有条件通过, 保持同级 / Last passed or conditional, keep same tier
    return lastEval.tier;
  }

  /**
   * 处理评审升级
   * Handle review tier escalation
   *
   * @private
   * @param {string} taskId
   * @param {string} currentTier
   * @param {EvaluationRecord} record
   */
  async _handleEscalation(taskId, currentTier, record) {
    const nextTier = this._getNextTier(currentTier);
    if (!nextTier || nextTier === currentTier) {
      // 已在最高层级, 无法升级 / Already at highest tier
      this._messageBus.publish('quality.escalation.maxReached', {
        taskId,
        currentTier,
        failCount: this._failCounts.get(taskId) || 0,
      });
      return;
    }

    this._messageBus.publish('quality.escalation.triggered', {
      taskId,
      fromTier: currentTier,
      toTier: nextTier,
      score: record.score,
      failCount: this._failCounts.get(taskId) || 0,
    });

    this._logger.info?.(
      `[QualityController] 评审升级 / Escalating: ${taskId} from ${currentTier} to ${nextTier}`,
    );
  }

  /**
   * 获取下一个评审层级
   * Get next review tier
   *
   * @private
   * @param {string} currentTier
   * @returns {string|null}
   */
  _getNextTier(currentTier) {
    switch (currentTier) {
      case QualityTier.SELF: return QualityTier.PEER;
      case QualityTier.PEER: return QualityTier.LEAD;
      case QualityTier.LEAD: return null; // 已是最高 / Already highest
      default: return QualityTier.PEER;
    }
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 重试逻辑 / Retry Logic
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  /**
   * 判断任务是否应该重试
   * Determine if a task should be retried
   *
   * @param {string} taskId - 任务 ID
   * @param {number} [failCount] - 当前失败次数 (可选, 默认从内部计数)
   * @returns {boolean}
   */
  shouldRetry(taskId, failCount) {
    const actualFailCount = failCount ?? (this._failCounts.get(taskId) || 0);

    if (actualFailCount >= this._config.maxRetries) {
      this._logger.warn?.(
        `[QualityController] 任务超出最大重试次数 / Task exceeded max retries: ${taskId} ` +
        `(${actualFailCount}/${this._config.maxRetries})`,
      );

      this._messageBus.publish('quality.retry.exhausted', {
        taskId,
        failCount: actualFailCount,
        maxRetries: this._config.maxRetries,
      });

      return false;
    }

    // 检查最近评估分数趋势 / Check recent score trend
    const history = this._evaluationHistory.get(taskId) || [];
    if (history.length >= 2) {
      const recent = history.slice(-2);
      const improving = recent[1].score > recent[0].score;

      if (!improving && actualFailCount >= 2) {
        this._logger.warn?.(
          `[QualityController] 分数无改善, 不建议重试 / No improvement, retry not recommended: ${taskId}`,
        );
        return false;
      }
    }

    return true;
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 评估记录 / Evaluation Records
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  /**
   * 记录评估结果
   * Record an evaluation result
   *
   * 存储到内存和数据库。
   * Stores to both memory and database.
   *
   * @param {string} taskId
   * @param {EvaluationRecord} evaluation
   */
  recordEvaluation(taskId, evaluation) {
    // 内存存储 / Memory storage
    if (!this._evaluationHistory.has(taskId)) {
      this._evaluationHistory.set(taskId, []);
    }
    this._evaluationHistory.get(taskId).push(evaluation);

    // LRU 驱逐: 超出最大跟踪任务数时, 删除最早的任务条目
    // LRU eviction: when exceeding max tracked tasks, remove oldest task entries
    if (this._evaluationHistory.size > MAX_HISTORY_TASKS) {
      const oldestKey = this._evaluationHistory.keys().next().value;
      this._evaluationHistory.delete(oldestKey);
      this._failCounts.delete(oldestKey);
    }

    // 数据库持久化 (通过 checkpoint) / DB persistence (via checkpoint)
    try {
      this._taskRepo.saveCheckpoint(
        evaluation.id,
        taskId,
        `quality_${evaluation.tier}`,
        'quality_evaluation',
        {
          tier: evaluation.tier,
          score: evaluation.score,
          verdict: evaluation.verdict,
          dimensions: evaluation.dimensions,
          feedback: evaluation.feedback,
          reviewerId: evaluation.reviewerId,
        },
      );
    } catch (err) {
      this._logger.warn?.(
        `[QualityController] 持久化评估记录失败 / Failed to persist evaluation: ${err.message}`,
      );
    }
  }

  /**
   * 获取任务的完整质量报告
   * Get full quality report for a task
   *
   * @param {string} taskId
   * @returns {Object|null} 质量报告 / Quality report
   */
  getQualityReport(taskId) {
    const history = this._evaluationHistory.get(taskId);
    if (!history || history.length === 0) {
      // 尝试从数据库恢复 / Try restoring from database
      const checkpoints = this._taskRepo.getCheckpoints(taskId);
      const qualityCheckpoints = checkpoints.filter(
        (cp) => cp.trigger === 'quality_evaluation',
      );

      if (qualityCheckpoints.length === 0) return null;

      return {
        taskId,
        evaluationCount: qualityCheckpoints.length,
        evaluations: qualityCheckpoints.map((cp) => cp.data),
        source: 'database',
      };
    }

    const latestEval = history[history.length - 1];
    const failCount = this._failCounts.get(taskId) || 0;

    // 分数趋势 / Score trend
    const scores = history.map((e) => e.score);
    const trend = scores.length >= 2
      ? scores[scores.length - 1] - scores[scores.length - 2]
      : 0;

    // 维度平均分 / Dimension averages
    const dimAverages = {};
    const dimCounts = {};
    for (const eval_ of history) {
      for (const dim of (eval_.dimensions || [])) {
        if (!dimAverages[dim.dimension]) {
          dimAverages[dim.dimension] = 0;
          dimCounts[dim.dimension] = 0;
        }
        dimAverages[dim.dimension] += dim.score;
        dimCounts[dim.dimension]++;
      }
    }
    for (const dim of Object.keys(dimAverages)) {
      dimAverages[dim] = Math.round((dimAverages[dim] / dimCounts[dim]) * 1000) / 1000;
    }

    // 弱项维度 / Weakest dimensions
    const weakDimensions = Object.entries(dimAverages)
      .filter(([, avg]) => avg < 0.5)
      .sort(([, a], [, b]) => a - b)
      .map(([dim, avg]) => ({ dimension: dim, averageScore: avg }));

    return {
      taskId,
      evaluationCount: history.length,
      failCount,
      canRetry: this.shouldRetry(taskId),
      latestScore: latestEval.score,
      latestVerdict: latestEval.verdict,
      latestTier: latestEval.tier,
      scoreTrend: Math.round(trend * 1000) / 1000,
      dimensionAverages: dimAverages,
      weakDimensions,
      evaluations: history.map((e) => ({
        id: e.id,
        tier: e.tier,
        score: e.score,
        verdict: e.verdict,
        timestamp: e.timestamp,
      })),
      source: 'memory',
    };
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 工具方法 / Utility Methods
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  /**
   * 获取统计信息
   * Get quality controller statistics
   *
   * @returns {Object}
   */
  getStats() {
    let totalEvaluations = 0;
    let totalPassed = 0;
    let totalFailed = 0;
    let totalConditional = 0;

    for (const history of this._evaluationHistory.values()) {
      for (const record of history) {
        totalEvaluations++;
        switch (record.verdict) {
          case QualityVerdict.PASS: totalPassed++; break;
          case QualityVerdict.FAIL: totalFailed++; break;
          case QualityVerdict.CONDITIONAL: totalConditional++; break;
        }
      }
    }

    return {
      totalEvaluations,
      totalPassed,
      totalFailed,
      totalConditional,
      passRate: totalEvaluations > 0 ? Math.round((totalPassed / totalEvaluations) * 1000) / 1000 : 0,
      tasksTracked: this._evaluationHistory.size,
      config: {
        thresholds: { ...this._config.thresholds },
        maxRetries: this._config.maxRetries,
      },
    };
  }

  /**
   * 清理指定任务的评估历史
   * Clear evaluation history for a specific task
   *
   * @param {string} taskId
   */
  clearHistory(taskId) {
    this._evaluationHistory.delete(taskId);
    this._failCounts.delete(taskId);
  }

  /**
   * 清理所有评估历史
   * Clear all evaluation history
   */
  clearAllHistory() {
    this._evaluationHistory.clear();
    this._failCounts.clear();
  }

  /**
   * 销毁质量控制器
   * Destroy quality controller
   */
  destroy() {
    this.clearAllHistory();
    this._scoringFunctions.clear();
    this._logger.info?.('[QualityController] 已销毁 / Destroyed');
  }
}
