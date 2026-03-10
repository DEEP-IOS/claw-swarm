/**
 * ExecutionPlanner -- MoE Top-k 执行计划器 / MoE Top-k Execution Planner
 *
 * V5.0 新增模块: Mixture-of-Experts (MoE) 角色选择 + 执行计划生成/验证。
 * 使用 3 个专家评分函数加权求和, 实现智能角色推荐。
 * 当所有分数低于 minConfidence 时, 降级到 regex 关键词匹配。
 *
 * V5.0 new module: Mixture-of-Experts (MoE) role selection + execution plan
 * generation/validation. Uses 3 weighted expert scoring functions for
 * intelligent role recommendation. Falls back to regex keyword matching
 * when all scores are below minConfidence.
 *
 * 3 Expert Scoring Functions / 3 个专家评分函数:
 *   keywordExpert (weight 0.4): keyword overlap ratio between task description
 *     and role template keywords
 *   capabilityExpert (weight 0.3): 8D capability dimension matching
 *     (cosine similarity)
 *   historyExpert (weight 0.3): role_execution_stats historical success rate
 *
 * Weighted sum -> Top-K -> if max score < minConfidence -> fallback to regex
 *
 * @module L4-orchestration/execution-planner
 * @author DEEP-IOS
 */

import { nanoid } from 'nanoid';
import { CapabilityDimension, ExecutionPlanStatus } from '../L1-infrastructure/types.js';

// ============================================================================
// 常量 / Constants
// ============================================================================

/**
 * V5.0 八维能力维度键列表 / V5.0 Eight capability dimension keys
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

/** 默认专家权重 / Default expert weights */
const DEFAULT_WEIGHTS = {
  keyword: 0.4,
  capability: 0.3,
  history: 0.3,
};

/** 默认 Top-K 值 / Default Top-K value */
const DEFAULT_TOP_K = 3;

/** 默认最低信心阈值 / Default minimum confidence threshold */
const DEFAULT_MIN_CONFIDENCE = 0.25;

/** 历史评分所需最低执行次数 / Minimum executions for history scoring */
const MIN_EXECUTIONS_FOR_HISTORY = 3;

/** 默认历史分 (无数据时) / Default history score when no data */
const DEFAULT_HISTORY_SCORE = 0.5;

/**
 * Regex 降级关键词映射 / Regex fallback keyword mapping
 *
 * 当 MoE 评分全部低于 minConfidence 时, 使用 regex 匹配降级。
 * When all MoE scores are below minConfidence, fall back to regex matching.
 *
 * @type {Array<{role: string, pattern: RegExp}>}
 */
const REGEX_FALLBACK_PATTERNS = [
  { role: 'architect', pattern: /\b(architect|design|system\s*design|api\s*design|schema|component\s*structure)\b/i },
  { role: 'developer', pattern: /\b(implement|develop|code|build|create|fix|bug|feature|function|class)\b/i },
  { role: 'tester', pattern: /\b(test|testing|qa|quality\s*assurance|coverage|unit\s*test|integration\s*test|verify|validate)\b/i },
  { role: 'reviewer', pattern: /\b(review|audit|code\s*review|feedback|refactor|improve|optimize)\b/i },
  { role: 'devops', pattern: /\b(deploy|docker|kubernetes|ci\/?cd|pipeline|infrastructure|monitoring|server|cloud)\b/i },
  { role: 'designer', pattern: /\b(ui|ux|design|interface|layout|style|visual|responsive|accessibility)\b/i },
  { role: 'analyst', pattern: /\b(analy[sz]e|analysis|data|requirement|report|research|document|metric)\b/i },
];

// ============================================================================
// ExecutionPlanner 类 / ExecutionPlanner Class
// ============================================================================

/**
 * MoE 执行计划器: Top-k 角色选择 + 计划生成/验证。
 * MoE execution planner: Top-k role selection + plan generation/validation.
 *
 * @example
 * ```js
 * const planner = new ExecutionPlanner({
 *   taskRepo, agentRepo, roleManager, messageBus, config, logger
 * });
 *
 * // MoE Top-k 角色推荐 / MoE Top-k role recommendation
 * const result = planner.planExecution('implement user auth with OAuth2', {
 *   topK: 3,
 *   minConfidence: 0.3,
 *   requirements: { security: 0.8, coding: 0.7 },
 * });
 * // result.roles → [{name: 'developer', ...}, {name: 'architect', ...}, ...]
 * // result.scores → [{role: 'developer', score: 0.72, details: {...}}, ...]
 * // result.fallback → false
 *
 * // 生成执行计划 / Generate execution plan
 * const plan = planner.generatePlan('implement user auth', result.roles);
 *
 * // 验证计划 / Validate plan
 * const validation = planner.validatePlan(plan);
 * ```
 */
export class ExecutionPlanner {
  /**
   * @param {Object} [deps] - 依赖注入 / Dependency injection
   * @param {Object} [deps.taskRepo] - 任务仓库 / Task repository
   * @param {Object} [deps.agentRepo] - Agent 仓库 / Agent repository
   * @param {import('./role-manager.js').RoleManager} [deps.roleManager] - 角色管理器 / Role manager
   * @param {import('../L2-communication/message-bus.js').MessageBus} [deps.messageBus] - 消息总线
   * @param {Object} [deps.config] - 配置 / Configuration
   * @param {Object} [deps.config.weights] - 专家权重 / Expert weights { keyword, capability, history }
   * @param {number} [deps.config.defaultTopK=3] - 默认 Top-K
   * @param {number} [deps.config.defaultMinConfidence=0.25] - 默认最低信心
   * @param {Object} [deps.logger] - 日志器 / Logger
   */
  constructor({ taskRepo, agentRepo, roleManager, messageBus, config = {}, logger, skillSymbiosis } = {}) {
    /** @private */
    this._taskRepo = taskRepo || null;

    /** @private */
    this._agentRepo = agentRepo || null;

    /** @private */
    this._roleManager = roleManager || null;

    /** @private */
    this._messageBus = messageBus || null;

    /** @private */
    this._logger = logger || console;

    /** @private @type {{ keyword: number, capability: number, history: number }} */
    this._weights = {
      keyword: config.weights?.keyword ?? DEFAULT_WEIGHTS.keyword,
      capability: config.weights?.capability ?? DEFAULT_WEIGHTS.capability,
      history: config.weights?.history ?? DEFAULT_WEIGHTS.history,
    };

    /** @private V5.7: skill-symbiosis 调度集成 */
    this._skillSymbiosis = skillSymbiosis || null;

    /** @private @type {number} */
    this._defaultTopK = config.defaultTopK ?? DEFAULT_TOP_K;

    /** @private @type {number} */
    this._defaultMinConfidence = config.defaultMinConfidence ?? DEFAULT_MIN_CONFIDENCE;

    /** @private @type {{ plans: number, selections: number, fallbacks: number }} */
    this._stats = {
      plans: 0,
      selections: 0,
      fallbacks: 0,
    };
  }

  // =========================================================================
  // MoE Top-K 角色选择 / MoE Top-K Role Selection
  // =========================================================================

  /**
   * MoE Top-K 角色推荐
   * MoE Top-K role recommendation
   *
   * 对所有角色模板使用 3 个专家评分函数加权求和:
   *   score = keywordExpert * w_k + capabilityExpert * w_c + historyExpert * w_h
   * 返回 Top-K 高分角色。若最高分 < minConfidence, 降级为 regex。
   *
   * Scores all role templates using 3 expert functions with weighted sum:
   *   score = keywordExpert * w_k + capabilityExpert * w_c + historyExpert * w_h
   * Returns Top-K highest scoring roles. Falls back to regex if max < minConfidence.
   *
   * @param {string} taskDescription - 任务描述 / Task description
   * @param {Object} [options]
   * @param {number} [options.topK] - 返回前 K 个 / Return top K (default: config.defaultTopK)
   * @param {number} [options.minConfidence] - 最低信心阈值 / Min confidence threshold
   * @param {Record<string, number>} [options.requirements] - 8D 能力需求 / 8D capability requirements
   * @returns {{
   *   roles: Array<Object>,
   *   scores: Array<{ role: string, score: number, details: { keyword: number, capability: number, history: number } }>,
   *   fallback: boolean
   * }}
   */
  planExecution(taskDescription, { topK, minConfidence, requirements } = {}) {
    const k = topK ?? this._defaultTopK;
    const confidence = minConfidence ?? this._defaultMinConfidence;

    this._stats.selections++;

    if (!taskDescription || typeof taskDescription !== 'string') {
      this._logger.warn?.('[ExecutionPlanner] 空任务描述 / Empty task description');
      return { roles: [], scores: [], fallback: false };
    }

    // 获取所有角色模板 / Get all role templates
    const templates = this._getTemplates();
    if (templates.length === 0) {
      this._logger.warn?.('[ExecutionPlanner] 无角色模板 / No role templates available');
      return { roles: [], scores: [], fallback: false };
    }

    // 对每个模板计算 MoE 综合分 / Score each template with MoE
    const scored = [];
    // V5.7: 动态归一化权重 (含共生专家) / Dynamic normalized weights (with symbiosis expert)
    const symbiosisWeight = this._skillSymbiosis ? 0.15 : 0;
    const baseSum = this._weights.keyword + this._weights.capability + this._weights.history;
    const totalSum = baseSum + symbiosisWeight;
    const scale = totalSum > 0 ? 1 / totalSum : 1;

    for (const template of templates) {
      const kwScore = this._keywordExpert(taskDescription, template);
      const capScore = this._capabilityExpert(requirements || {}, template);
      const histScore = this._historyExpert(template.name);
      const symScore = this._skillSymbiosis ? this._symbiosisExpert(template) : 0;

      const weightedScore =
        kwScore * this._weights.keyword * scale +
        capScore * this._weights.capability * scale +
        histScore * this._weights.history * scale +
        symScore * symbiosisWeight * scale;

      scored.push({
        template,
        score: Math.round(weightedScore * 10000) / 10000,
        details: {
          keyword: Math.round(kwScore * 10000) / 10000,
          capability: Math.round(capScore * 10000) / 10000,
          history: Math.round(histScore * 10000) / 10000,
          symbiosis: Math.round(symScore * 10000) / 10000,
        },
      });
    }

    // 按分数降序排列 / Sort by score descending
    scored.sort((a, b) => b.score - a.score);

    // 检查最高分是否达到 minConfidence / Check if max score meets minConfidence
    const maxScore = scored.length > 0 ? scored[0].score : 0;

    if (maxScore < confidence) {
      // 降级到 regex 匹配 / Fallback to regex matching
      this._stats.fallbacks++;
      this._logger.debug?.(
        `[ExecutionPlanner] MoE 分数不足 (max=${maxScore}), 降级 regex / ` +
        `MoE score insufficient (max=${maxScore}), falling back to regex`
      );

      const regexResult = this._regexFallback(taskDescription, k);

      this._emit('planner.fallback', {
        taskDescription: taskDescription.substring(0, 100),
        maxScore,
        minConfidence: confidence,
        regexMatches: regexResult.roles.map(r => r.name),
      });

      return regexResult;
    }

    // 取 Top-K / Take Top-K
    const topKResults = scored.slice(0, k);

    const roles = topKResults.map(s => this._deepClone(s.template));
    const scores = topKResults.map(s => ({
      role: s.template.name,
      score: s.score,
      details: s.details,
    }));

    this._emit('planner.selected', {
      taskDescription: taskDescription.substring(0, 100),
      topK: scores,
      fallback: false,
    });

    return { roles, scores, fallback: false };
  }

  // =========================================================================
  // 执行计划生成 / Execution Plan Generation
  // =========================================================================

  /**
   * 根据任务描述和推荐角色生成执行计划
   * Generate an execution plan from task description and recommended roles
   *
   * 计划包含: ID、任务描述、推荐角色、阶段列表、约束、元数据。
   * Plan contains: ID, task description, recommended roles, phase list,
   * constraints, metadata.
   *
   * @param {string} taskDescription - 任务描述 / Task description
   * @param {Array<Object>} roles - 推荐的角色模板 / Recommended role templates
   * @returns {Object} executionPlan
   */
  generatePlan(taskDescription, roles) {
    this._stats.plans++;

    const planId = nanoid();
    const now = Date.now();

    // 构建阶段列表: 每个角色一个阶段 / Build phase list: one phase per role
    const phases = roles.map((role, index) => ({
      id: nanoid(),
      order: index + 1,
      roleName: role.name,
      description: role.description || `Phase ${index + 1}: ${role.name}`,
      systemPrompt: role.systemPrompt || '',
      constraints: role.constraints ? this._deepClone(role.constraints) : {},
      status: 'pending',
    }));

    // 合并约束 / Merge constraints
    const mergedConstraints = this._mergeConstraints(roles);

    const plan = {
      id: planId,
      taskDescription,
      status: ExecutionPlanStatus.draft,
      roles: roles.map(r => r.name),
      phases,
      constraints: mergedConstraints,
      metadata: {
        generatedBy: 'ExecutionPlanner/MoE',
        version: '5.0',
        roleCount: roles.length,
        phaseCount: phases.length,
      },
      maturityScore: this._computeMaturityScore(roles),
      createdAt: now,
      updatedAt: now,
    };

    this._emit('planner.planGenerated', {
      planId,
      taskDescription: taskDescription.substring(0, 100),
      roles: plan.roles,
      phaseCount: phases.length,
    });

    this._logger.debug?.(
      `[ExecutionPlanner] 计划生成 / Plan generated: ${planId} (${phases.length} phases)`
    );

    return plan;
  }

  // =========================================================================
  // 计划验证 / Plan Validation
  // =========================================================================

  /**
   * 验证执行计划的完整性和合理性
   * Validate an execution plan for completeness and soundness
   *
   * 检查项 / Validation checks:
   *   1. 基础结构完整性 (id, taskDescription, phases)
   *   2. 阶段非空
   *   3. 每个阶段有 roleName
   *   4. 阶段顺序正确
   *   5. 引用的角色模板存在
   *   6. 成熟度分数合理
   *
   * @param {Object} plan - 待验证的执行计划 / Plan to validate
   * @returns {{ valid: boolean, issues: string[] }}
   */
  validatePlan(plan) {
    const issues = [];

    // 1. 基础结构 / Basic structure
    if (!plan || typeof plan !== 'object') {
      return { valid: false, issues: ['Plan must be a non-null object'] };
    }

    if (!plan.id || typeof plan.id !== 'string') {
      issues.push('Plan must have a string "id"');
    }

    if (!plan.taskDescription || typeof plan.taskDescription !== 'string') {
      issues.push('Plan must have a non-empty string "taskDescription"');
    }

    // 2. 阶段非空 / Non-empty phases
    if (!Array.isArray(plan.phases) || plan.phases.length === 0) {
      issues.push('Plan must have at least one phase');
      return { valid: false, issues };
    }

    // 3. 每个阶段有 roleName / Each phase has roleName
    for (let i = 0; i < plan.phases.length; i++) {
      const phase = plan.phases[i];
      if (!phase.roleName || typeof phase.roleName !== 'string') {
        issues.push(`Phase ${i + 1} must have a string "roleName"`);
      }
      if (!phase.id) {
        issues.push(`Phase ${i + 1} must have an "id"`);
      }
    }

    // 4. 阶段顺序正确 / Phase order is correct
    for (let i = 0; i < plan.phases.length; i++) {
      if (plan.phases[i].order !== undefined && plan.phases[i].order !== i + 1) {
        issues.push(`Phase ${i + 1} has incorrect order: expected ${i + 1}, got ${plan.phases[i].order}`);
      }
    }

    // 5. 引用角色存在 / Referenced roles exist
    if (this._roleManager) {
      for (const phase of plan.phases) {
        if (phase.roleName) {
          const template = this._roleManager.getTemplate(phase.roleName);
          if (!template) {
            issues.push(`Role template "${phase.roleName}" not found in RoleManager`);
          }
        }
      }
    }

    // 6. 成熟度分数 / Maturity score
    if (plan.maturityScore !== undefined) {
      if (typeof plan.maturityScore !== 'number' || plan.maturityScore < 0 || plan.maturityScore > 1) {
        issues.push('maturityScore must be a number between 0 and 1');
      }
    }

    const valid = issues.length === 0;

    if (!valid) {
      this._logger.debug?.(
        `[ExecutionPlanner] 计划验证失败 / Plan validation failed: ${issues.length} issues`
      );
    }

    return { valid, issues };
  }

  // =========================================================================
  // 统计 / Statistics
  // =========================================================================

  /**
   * 获取计划器统计
   * Get planner statistics
   *
   * @returns {{ plans: number, selections: number, fallbacks: number, fallbackRate: number }}
   */
  getStats() {
    const fallbackRate = this._stats.selections > 0
      ? Math.round((this._stats.fallbacks / this._stats.selections) * 10000) / 10000
      : 0;

    return {
      ...this._stats,
      fallbackRate,
    };
  }

  // =========================================================================
  // 3 个专家函数 / 3 Expert Functions
  // =========================================================================

  /**
   * 关键词专家: 任务描述与角色关键词的重叠比率
   * Keyword expert: overlap ratio between task description and role keywords
   *
   * 算法: 计算任务描述中命中的角色模板关键词数 / 模板关键词总数。
   * Algorithm: count of template keywords found in task description / total template keywords.
   *
   * @param {string} taskDescription - 任务描述 / Task description
   * @param {Object} roleTemplate - 角色模板 / Role template
   * @returns {number} 分数 0-1 / Score 0-1
   */
  _keywordExpert(taskDescription, roleTemplate) {
    const keywords = roleTemplate.keywords;
    if (!keywords || !Array.isArray(keywords) || keywords.length === 0) {
      return 0;
    }

    const descLower = taskDescription.toLowerCase();
    let hits = 0;

    for (const kw of keywords) {
      if (descLower.includes(kw.toLowerCase())) {
        hits++;
      }
    }

    return hits / keywords.length;
  }

  /**
   * 能力专家: 8D 能力维度匹配 (余弦相似度)
   * Capability expert: 8D capability dimension matching (cosine similarity)
   *
   * 将需求的 8D 向量与模板的 8D 向量做余弦相似度计算。
   * 若无需求维度则返回默认分 0.5。
   *
   * Computes cosine similarity between the requirements 8D vector and
   * the template's 8D vector. Returns default 0.5 if no requirements.
   *
   * @param {Record<string, number>} requirements - 8D 能力需求 / 8D capability requirements
   * @param {Object} roleTemplate - 角色模板 / Role template
   * @returns {number} 分数 0-1 / Score 0-1
   */
  _capabilityExpert(requirements, roleTemplate) {
    const templateCaps = roleTemplate.capabilities;
    if (!templateCaps || typeof templateCaps !== 'object') {
      return 0;
    }

    // 无需求时返回默认分 / No requirements → default score
    if (!requirements || Object.keys(requirements).length === 0) {
      return 0.5;
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (const dim of DIMENSIONS_8D) {
      const a = templateCaps[dim] || 0;
      const b = requirements[dim] || 0;

      dotProduct += a * b;
      normA += a * a;
      normB += b * b;
    }

    normA = Math.sqrt(normA);
    normB = Math.sqrt(normB);

    if (normA === 0 || normB === 0) return 0;

    return dotProduct / (normA * normB);
  }

  /**
   * 历史专家: role_execution_stats 中的历史成功率
   * History expert: historical success rate from role_execution_stats
   *
   * 从 RoleManager 的执行统计中获取角色历史成功率。
   * 如果执行次数 < MIN_EXECUTIONS_FOR_HISTORY, 返回默认分。
   *
   * Gets role historical success rate from RoleManager's execution stats.
   * If executions < MIN_EXECUTIONS_FOR_HISTORY, returns default score.
   *
   * @param {string} roleName - 角色名称 / Role name
   * @returns {number} 分数 0-1 / Score 0-1
   */
  _historyExpert(roleName) {
    if (!this._roleManager) {
      return DEFAULT_HISTORY_SCORE;
    }

    const stats = this._roleManager.getRoleStats(roleName);
    if (!stats || stats.executions < MIN_EXECUTIONS_FOR_HISTORY) {
      return DEFAULT_HISTORY_SCORE;
    }

    // 综合成功率和平均质量 / Combine success rate and average quality
    // 成功率 * 0.6 + 平均质量 * 0.4
    const successComponent = stats.successRate * 0.6;
    const qualityComponent = (stats.avgQuality || 0.5) * 0.4;

    return Math.min(1, successComponent + qualityComponent);
  }

  // =========================================================================
  // V5.7: 共生专家 / Symbiosis Expert
  // =========================================================================

  /**
   * V5.7: 共生专家 — 评估角色模板的团队互补潜力
   *
   * @param {Object} roleTemplate - 角色模板
   * @returns {number} 分数 0-1
   * @private
   */
  _symbiosisExpert(roleTemplate) {
    if (!this._skillSymbiosis) return 0.5;
    const stats = this._skillSymbiosis.getStats();
    if (stats.trackedPairs === 0) return 0.5;

    const partners = this._skillSymbiosis.recommendPartners(roleTemplate.name, 3);
    if (partners.length === 0) return 0.5;

    const avgComp = partners.reduce((sum, p) => sum + p.complementarity, 0) / partners.length;
    return avgComp;
  }

  // =========================================================================
  // Regex 降级 / Regex Fallback
  // =========================================================================

  /**
   * Regex 降级匹配: 当 MoE 分数全部低于 minConfidence 时使用
   * Regex fallback matching: used when all MoE scores are below minConfidence
   *
   * 使用预定义的 regex 模式匹配任务描述中的关键词,
   * 返回匹配到的角色模板。
   *
   * Uses predefined regex patterns to match keywords in task description,
   * returns matched role templates.
   *
   * @private
   * @param {string} taskDescription
   * @param {number} topK
   * @returns {{ roles: Array<Object>, scores: Array<Object>, fallback: boolean }}
   */
  _regexFallback(taskDescription, topK) {
    const matchedRoles = [];
    const matchedScores = [];

    for (const { role, pattern } of REGEX_FALLBACK_PATTERNS) {
      const matches = taskDescription.match(pattern);
      if (matches) {
        const template = this._getTemplateByName(role);
        if (template) {
          // Regex 匹配数作为伪分数 / Match count as pseudo-score
          const pseudoScore = Math.min(1, matches.length * 0.3);
          matchedRoles.push(template);
          matchedScores.push({
            role,
            score: pseudoScore,
            details: { keyword: pseudoScore, capability: 0, history: 0 },
          });
        }
      }
    }

    // 按伪分数降序 / Sort by pseudo-score descending
    const indices = matchedScores.map((_, i) => i);
    indices.sort((a, b) => matchedScores[b].score - matchedScores[a].score);

    const sortedRoles = indices.slice(0, topK).map(i => matchedRoles[i]);
    const sortedScores = indices.slice(0, topK).map(i => matchedScores[i]);

    // 如果 regex 也没匹配到, 返回默认 developer / If no regex match, default to developer
    if (sortedRoles.length === 0) {
      const defaultTemplate = this._getTemplateByName('developer');
      if (defaultTemplate) {
        sortedRoles.push(defaultTemplate);
        sortedScores.push({
          role: 'developer',
          score: 0.1,
          details: { keyword: 0, capability: 0, history: 0 },
        });
      }
    }

    return {
      roles: sortedRoles,
      scores: sortedScores,
      fallback: true,
    };
  }

  // =========================================================================
  // 内部方法 / Internal Methods
  // =========================================================================

  /**
   * 获取所有角色模板 / Get all role templates
   *
   * @private
   * @returns {Array<Object>}
   */
  _getTemplates() {
    if (this._roleManager) {
      return this._roleManager.listTemplates();
    }
    return [];
  }

  /**
   * 按名称获取角色模板 / Get role template by name
   *
   * @private
   * @param {string} name
   * @returns {Object|null}
   */
  _getTemplateByName(name) {
    if (this._roleManager) {
      return this._roleManager.getTemplate(name);
    }
    return null;
  }

  /**
   * 合并多个角色的约束条件
   * Merge constraints from multiple roles
   *
   * 取最严格的约束: maxFiles 取最大值, reviewRequired 取 OR。
   * Takes strictest constraints: maxFiles = max, reviewRequired = OR.
   *
   * @private
   * @param {Array<Object>} roles
   * @returns {Object}
   */
  _mergeConstraints(roles) {
    let maxFiles = 0;
    let reviewRequired = false;
    let minPriority = Infinity;

    for (const role of roles) {
      const c = role.constraints || {};
      if (c.maxFiles && c.maxFiles > maxFiles) {
        maxFiles = c.maxFiles;
      }
      if (c.reviewRequired) {
        reviewRequired = true;
      }
      if (c.priority !== undefined && c.priority < minPriority) {
        minPriority = c.priority;
      }
    }

    return {
      maxFiles: maxFiles || 30,
      reviewRequired,
      priority: minPriority === Infinity ? 5 : minPriority,
    };
  }

  /**
   * 计算计划成熟度分数
   * Compute plan maturity score
   *
   * 成熟度 = 角色覆盖广度 * 0.5 + 平均历史分 * 0.5
   * Maturity = role coverage breadth * 0.5 + avg history score * 0.5
   *
   * @private
   * @param {Array<Object>} roles
   * @returns {number} 0-1
   */
  _computeMaturityScore(roles) {
    if (roles.length === 0) return 0;

    // 角色覆盖广度: 涉及多少个不同角色 / Role coverage breadth
    const uniqueRoles = new Set(roles.map(r => r.name));
    const coverageBreadth = Math.min(1, uniqueRoles.size / 4); // 4 个以上视为高覆盖

    // 平均历史分 / Average history score
    let histSum = 0;
    for (const role of roles) {
      histSum += this._historyExpert(role.name);
    }
    const avgHist = histSum / roles.length;

    return Math.round((coverageBreadth * 0.5 + avgHist * 0.5) * 10000) / 10000;
  }

  /**
   * 发布消息总线事件
   * Publish to message bus
   *
   * @private
   * @param {string} topic
   * @param {Object} data
   */
  _emit(topic, data) {
    if (this._messageBus) {
      try {
        this._messageBus.publish(topic, data, { senderId: 'execution-planner' });
      } catch {
        // 忽略消息总线错误 / Ignore message bus errors
      }
    }
  }

  /**
   * 深拷贝对象 / Deep clone an object
   *
   * @private
   * @param {Object} obj
   * @returns {Object}
   */
  _deepClone(obj) {
    return JSON.parse(JSON.stringify(obj));
  }
}
