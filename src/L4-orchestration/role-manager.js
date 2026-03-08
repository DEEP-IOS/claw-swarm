/**
 * RoleManager -- 角色模板管理 / Role Template Management
 *
 * v4.x 迁移增强: 从关键词正则匹配升级为支持 8D 能力评分的角色模板系统,
 * 新增模板 CRUD、角色匹配(基于关键词+能力维度)、执行统计追踪、
 * 以及基于历史数据的角色推荐。
 *
 * Migrated from v4.x and enhanced: upgraded from keyword-regex matching
 * to a role template system with 8D capability scores. Added template CRUD,
 * role matching (keyword + capability-based), execution stats tracking,
 * and history-based role recommendation.
 *
 * 内置 7 个角色模板 / 7 Built-in Role Templates:
 *   architect, developer, tester, reviewer, devops, designer, analyst
 *
 * 每个模板包含 / Each template contains:
 *   name, description, capabilities (8D scores), keywords,
 *   systemPrompt, constraints
 *
 * @module L4-orchestration/role-manager
 * @author DEEP-IOS
 */

import { CapabilityDimension } from '../L1-infrastructure/types.js';

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

/**
 * 内置角色模板 / Built-in Role Templates
 *
 * 每个模板的 capabilities 是 8D 分数 (0-1), 表示该角色在各维度上的要求。
 * Each template's capabilities is an 8D score (0-1), representing the
 * required proficiency in each dimension for the role.
 *
 * @type {Record<string, Object>}
 */
const BUILTIN_TEMPLATES = {
  architect: {
    name: 'architect',
    description: 'Designs system architecture, component structure and technical decisions',
    capabilities: {
      coding: 0.6,
      architecture: 0.95,
      testing: 0.4,
      documentation: 0.7,
      security: 0.6,
      performance: 0.7,
      communication: 0.8,
      domain: 0.7,
    },
    keywords: [
      'architecture', 'design', 'system', 'component', 'structure',
      'planning', 'api', 'schema', 'pattern', 'module',
    ],
    systemPrompt: 'You are a senior software architect. Focus on system design, component boundaries, API contracts, and scalability patterns.',
    constraints: {
      maxFiles: 20,
      reviewRequired: true,
      priority: 1,
    },
  },

  developer: {
    name: 'developer',
    description: 'Implements features, writes code, and handles core development tasks',
    capabilities: {
      coding: 0.95,
      architecture: 0.5,
      testing: 0.6,
      documentation: 0.4,
      security: 0.4,
      performance: 0.6,
      communication: 0.5,
      domain: 0.5,
    },
    keywords: [
      'implement', 'code', 'develop', 'feature', 'function',
      'class', 'module', 'build', 'create', 'fix', 'bug',
    ],
    systemPrompt: 'You are an experienced software developer. Focus on clean code, proper error handling, and efficient implementation.',
    constraints: {
      maxFiles: 30,
      reviewRequired: false,
      priority: 2,
    },
  },

  tester: {
    name: 'tester',
    description: 'Writes tests, validates functionality, and ensures quality through testing',
    capabilities: {
      coding: 0.6,
      architecture: 0.3,
      testing: 0.95,
      documentation: 0.5,
      security: 0.5,
      performance: 0.4,
      communication: 0.5,
      domain: 0.4,
    },
    keywords: [
      'test', 'testing', 'qa', 'quality', 'verify', 'validate',
      'coverage', 'assertion', 'mock', 'integration', 'unit',
    ],
    systemPrompt: 'You are a QA engineer. Focus on comprehensive test coverage, edge cases, and regression testing.',
    constraints: {
      maxFiles: 25,
      reviewRequired: false,
      priority: 3,
    },
  },

  reviewer: {
    name: 'reviewer',
    description: 'Reviews code, provides feedback, and ensures code quality standards',
    capabilities: {
      coding: 0.8,
      architecture: 0.7,
      testing: 0.6,
      documentation: 0.6,
      security: 0.7,
      performance: 0.7,
      communication: 0.9,
      domain: 0.6,
    },
    keywords: [
      'review', 'audit', 'feedback', 'quality', 'standard',
      'best practice', 'refactor', 'improve', 'optimize',
    ],
    systemPrompt: 'You are a code reviewer. Focus on code quality, best practices, security issues, and maintainability.',
    constraints: {
      maxFiles: 50,
      reviewRequired: false,
      priority: 3,
    },
  },

  devops: {
    name: 'devops',
    description: 'Handles deployment, CI/CD, infrastructure, and operational concerns',
    capabilities: {
      coding: 0.5,
      architecture: 0.6,
      testing: 0.4,
      documentation: 0.5,
      security: 0.7,
      performance: 0.8,
      communication: 0.5,
      domain: 0.6,
    },
    keywords: [
      'deploy', 'docker', 'kubernetes', 'ci', 'cd', 'pipeline',
      'infrastructure', 'monitoring', 'ops', 'server', 'cloud',
    ],
    systemPrompt: 'You are a DevOps engineer. Focus on deployment automation, infrastructure reliability, and operational excellence.',
    constraints: {
      maxFiles: 15,
      reviewRequired: true,
      priority: 4,
    },
  },

  designer: {
    name: 'designer',
    description: 'Designs user interfaces, UX flows, and visual components',
    capabilities: {
      coding: 0.5,
      architecture: 0.4,
      testing: 0.3,
      documentation: 0.6,
      security: 0.2,
      performance: 0.4,
      communication: 0.8,
      domain: 0.5,
    },
    keywords: [
      'design', 'ui', 'ux', 'interface', 'layout', 'style',
      'component', 'visual', 'responsive', 'accessibility',
    ],
    systemPrompt: 'You are a UI/UX designer. Focus on user experience, visual consistency, and accessibility.',
    constraints: {
      maxFiles: 20,
      reviewRequired: false,
      priority: 3,
    },
  },

  analyst: {
    name: 'analyst',
    description: 'Analyzes data, requirements, and provides insights for decision making',
    capabilities: {
      coding: 0.4,
      architecture: 0.5,
      testing: 0.3,
      documentation: 0.8,
      security: 0.4,
      performance: 0.5,
      communication: 0.9,
      domain: 0.8,
    },
    keywords: [
      'analyze', 'analysis', 'data', 'requirement', 'report',
      'insight', 'statistics', 'metrics', 'research', 'document',
    ],
    systemPrompt: 'You are a technical analyst. Focus on requirements analysis, data interpretation, and clear documentation.',
    constraints: {
      maxFiles: 10,
      reviewRequired: false,
      priority: 2,
    },
  },
};

// ============================================================================
// RoleManager 类 / RoleManager Class
// ============================================================================

/**
 * 角色模板管理器: CRUD 模板、匹配角色、执行统计。
 * Role template manager: template CRUD, role matching, execution statistics.
 *
 * @example
 * ```js
 * const rm = new RoleManager({ taskRepo, messageBus, config, logger });
 * const best = rm.matchRole('implement user authentication', { security: 0.8 });
 * rm.recordExecution('developer', { success: true, quality: 0.85, duration: 12000 });
 * ```
 */
export class RoleManager {
  /**
   * @param {Object} [deps] - 依赖注入 / Dependency injection
   * @param {Object} [deps.taskRepo] - 任务仓库 / Task repository
   * @param {import('../L2-communication/message-bus.js').MessageBus} [deps.messageBus] - 消息总线
   * @param {Object} [deps.config] - 配置 / Configuration
   * @param {Object} [deps.config.customTemplates] - 额外自定义模板 / Additional custom templates
   * @param {number} [deps.config.matchThreshold=0.1] - 匹配最低分阈值 / Min match score threshold
   * @param {Object} [deps.logger] - 日志器 / Logger
   */
  constructor({ taskRepo, messageBus, config = {}, logger } = {}) {
    /** @private */
    this._taskRepo = taskRepo;

    /** @private */
    this._messageBus = messageBus;

    /** @private */
    this._logger = logger || console;

    /** @private @type {number} */
    this._matchThreshold = config.matchThreshold ?? 0.1;

    /**
     * 所有已注册模板: name -> template
     * All registered templates: name -> template
     * @private @type {Map<string, Object>}
     */
    this._templates = new Map();

    /**
     * 执行统计: roleName -> { executions, successes, failures, totalQuality, totalDuration }
     * Execution stats: roleName -> { executions, successes, failures, totalQuality, totalDuration }
     * @private @type {Map<string, Object>}
     */
    this._executionStats = new Map();

    // 加载内置模板 / Load built-in templates
    for (const [name, template] of Object.entries(BUILTIN_TEMPLATES)) {
      this._templates.set(name, this._deepClone(template));
    }

    // 加载配置中的自定义模板 / Load custom templates from config
    if (config.customTemplates && typeof config.customTemplates === 'object') {
      for (const [name, template] of Object.entries(config.customTemplates)) {
        this._templates.set(name, this._deepClone(template));
      }
    }
  }

  // =========================================================================
  // 模板 CRUD / Template CRUD
  // =========================================================================

  /**
   * 注册新模板或更新已有模板
   * Register a new template or update an existing one
   *
   * @param {Object} template - 角色模板
   * @param {string} template.name - 模板名称 (唯一标识) / Template name (unique identifier)
   * @param {string} template.description - 描述 / Description
   * @param {Record<string, number>} template.capabilities - 8D 能力要求分数 / 8D capability requirement scores
   * @param {string[]} template.keywords - 关键词列表 / Keyword list
   * @param {string} template.systemPrompt - 系统提示词 / System prompt
   * @param {Object} [template.constraints] - 约束条件 / Constraints
   * @returns {string} 模板名称 (作为 ID) / Template name (as ID)
   * @throws {Error} 模板数据无效时 / When template data is invalid
   */
  registerTemplate(template) {
    this._validateTemplate(template);

    const name = template.name;

    // 检查是否有高度相似的已存在角色 (余弦相似度 > 0.95)
    // Check for highly similar existing role (cosine similarity > 0.95)
    const similar = this._findSimilarRole(template.capabilities);
    if (similar && similar.name !== name) {
      this._logger.debug?.(
        `[RoleManager] 合并相似角色 / Merging similar role: "${name}" → "${similar.name}"`
      );
      // 合并: 更新描述和 systemPrompt, 合并关键词
      // Merge: update description and systemPrompt, merge keywords
      const merged = this._deepClone(similar);
      merged.keywords = [...new Set([...(merged.keywords || []), ...(template.keywords || [])])];
      if (template.systemPrompt) merged.systemPrompt = template.systemPrompt;
      merged._meta = similar._meta || { createdAt: Date.now(), lastUsedAt: Date.now(), usageCount: 0 };
      merged._meta.lastUsedAt = Date.now();
      this._templates.set(similar.name, merged);
      return similar.name;
    }

    const clone = this._deepClone(template);
    // 添加生命周期元数据 / Add lifecycle metadata
    clone._meta = {
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
      usageCount: 0,
      isBuiltin: !!BUILTIN_TEMPLATES[name],
    };
    this._templates.set(name, clone);

    // 发布事件 / Publish event
    if (this._messageBus) {
      this._messageBus.publish('role.template_registered', { name });
    }

    this._logger.debug?.(
      `[RoleManager] 模板注册 / Template registered: ${name}`
    );

    return name;
  }

  /**
   * 获取指定名称的模板
   * Get a template by name
   *
   * @param {string} name - 模板名称
   * @returns {Object|null} 模板的深拷贝或 null / Deep copy of template or null
   */
  getTemplate(name) {
    const template = this._templates.get(name);
    if (!template) return null;
    return this._deepClone(template);
  }

  /**
   * 列出所有已注册模板
   * List all registered templates
   *
   * @returns {Array<Object>} 所有模板的深拷贝数组 / Deep copies of all templates
   */
  listTemplates() {
    const result = [];
    for (const template of this._templates.values()) {
      result.push(this._deepClone(template));
    }
    return result;
  }

  /**
   * 移除指定模板
   * Remove a specific template
   *
   * @param {string} name - 模板名称
   * @returns {boolean} 是否删除成功 / Whether deletion succeeded
   */
  removeTemplate(name) {
    const existed = this._templates.delete(name);

    if (existed && this._messageBus) {
      this._messageBus.publish('role.template_removed', { name });
    }

    return existed;
  }

  // =========================================================================
  // 角色生命周期 / Role Lifecycle
  // =========================================================================

  /**
   * 清理僵尸角色: 超过 maxAgeDays 未使用且使用次数 < minUsage 的非内置角色
   * Prune stale roles: non-builtin roles unused for maxAgeDays with usageCount < minUsage
   *
   * @param {Object} [options]
   * @param {number} [options.maxAgeDays=30] - 最大未使用天数 / Max unused days
   * @param {number} [options.minUsage=3] - 最小使用次数 / Min usage count to keep
   * @returns {string[]} 被删除的角色名 / Names of pruned roles
   */
  pruneStaleRoles({ maxAgeDays = 30, minUsage = 3 } = {}) {
    const now = Date.now();
    const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;
    const pruned = [];

    for (const [name, template] of this._templates) {
      // 永远不清理内置模板 / Never prune built-in templates
      if (BUILTIN_TEMPLATES[name]) continue;
      if (template._meta?.isBuiltin) continue;

      const meta = template._meta;
      if (!meta) continue;

      const unused = now - (meta.lastUsedAt || meta.createdAt) > maxAgeMs;
      const lowUsage = (meta.usageCount || 0) < minUsage;

      if (unused && lowUsage) {
        this._templates.delete(name);
        pruned.push(name);
        this._logger.debug?.(
          `[RoleManager] 清理僵尸角色 / Pruned stale role: "${name}" (age=${Math.round((now - meta.createdAt) / 86400000)}d, usage=${meta.usageCount})`
        );
      }
    }

    if (pruned.length > 0 && this._messageBus) {
      this._messageBus.publish('role.templates_pruned', { pruned, count: pruned.length });
    }

    return pruned;
  }

  // =========================================================================
  // 角色匹配 / Role Matching
  // =========================================================================

  /**
   * 为任务描述和需求找到最佳匹配的角色模板
   * Find the best matching role template for a task description and requirements
   *
   * 匹配算法 / Matching algorithm:
   *   1. 关键词匹配分 (0-1): 任务描述中命中的模板关键词比例
   *      Keyword match score (0-1): proportion of template keywords found in task description
   *   2. 能力匹配分 (0-1): 模板 8D 分与需求 8D 分的余弦相似度
   *      Capability match score (0-1): cosine similarity between template & requirement 8D scores
   *   3. 综合分 = keyword * 0.4 + capability * 0.6
   *      Combined = keyword * 0.4 + capability * 0.6
   *
   * @param {string} taskDescription - 任务描述
   * @param {Record<string, number>} [requirements={}] - 期望的 8D 能力需求
   * @returns {Object|null} 最佳匹配模板 (深拷贝) 或 null / Best match template (deep copy) or null
   */
  matchRole(taskDescription, requirements = {}) {
    if (!taskDescription || typeof taskDescription !== 'string') {
      return null;
    }

    const descLower = taskDescription.toLowerCase();
    let bestTemplate = null;
    let bestScore = -1;

    for (const template of this._templates.values()) {
      // 1. 关键词匹配 / Keyword matching
      const keywordScore = this._computeKeywordScore(descLower, template.keywords || []);

      // 2. 能力匹配 / Capability matching
      const capabilityScore = this._computeCapabilityMatch(
        template.capabilities || {},
        requirements
      );

      // 3. 综合评分 / Combined score
      const combinedScore = keywordScore * 0.4 + capabilityScore * 0.6;

      if (combinedScore > bestScore) {
        bestScore = combinedScore;
        bestTemplate = template;
      }
    }

    // 分数低于阈值则返回 null / Return null if score below threshold
    if (bestScore < this._matchThreshold) {
      this._logger.debug?.(
        `[RoleManager] 无匹配模板 / No matching template for: "${taskDescription}" (bestScore=${bestScore})`
      );
      return null;
    }

    this._logger.debug?.(
      `[RoleManager] 匹配结果 / Match result: "${bestTemplate.name}" ` +
      `(score=${Math.round(bestScore * 100) / 100})`
    );

    return this._deepClone(bestTemplate);
  }

  // =========================================================================
  // 执行统计 / Execution Stats
  // =========================================================================

  /**
   * 记录角色执行结果
   * Record role execution result
   *
   * @param {string} roleName - 角色名称
   * @param {Object} result
   * @param {boolean} result.success - 是否成功
   * @param {number} [result.quality] - 质量分 (0-1)
   * @param {number} [result.duration] - 执行时长 (ms)
   * @returns {void}
   */
  recordExecution(roleName, { success, quality, duration } = {}) {
    let stats = this._executionStats.get(roleName);

    if (!stats) {
      stats = {
        executions: 0,
        successes: 0,
        failures: 0,
        totalQuality: 0,
        qualityCount: 0,
        totalDuration: 0,
        durationCount: 0,
        lastExecutedAt: 0,
      };
      this._executionStats.set(roleName, stats);
    }

    stats.executions++;
    stats.lastExecutedAt = Date.now();

    // 更新角色生命周期元数据 / Update role lifecycle metadata
    const template = this._templates.get(roleName);
    if (template?._meta) {
      template._meta.lastUsedAt = Date.now();
      template._meta.usageCount = (template._meta.usageCount || 0) + 1;
    }

    if (success) {
      stats.successes++;
    } else {
      stats.failures++;
    }

    if (quality !== undefined && quality !== null) {
      stats.totalQuality += quality;
      stats.qualityCount++;
    }

    if (duration !== undefined && duration !== null) {
      stats.totalDuration += duration;
      stats.durationCount++;
    }

    // 发布统计更新事件 / Publish stats update event
    if (this._messageBus) {
      this._messageBus.publish('role.execution_recorded', {
        roleName,
        success,
        quality,
        duration,
      });
    }
  }

  /**
   * 获取指定角色的执行统计
   * Get execution statistics for a specific role
   *
   * @param {string} roleName
   * @returns {{
   *   executions: number,
   *   successes: number,
   *   failures: number,
   *   successRate: number,
   *   avgQuality: number,
   *   avgDuration: number,
   *   lastExecutedAt: number
   * }|null}
   */
  getRoleStats(roleName) {
    const stats = this._executionStats.get(roleName);
    if (!stats) return null;

    const successRate = stats.executions > 0
      ? Math.round((stats.successes / stats.executions) * 100) / 100
      : 0;

    const avgQuality = stats.qualityCount > 0
      ? Math.round((stats.totalQuality / stats.qualityCount) * 100) / 100
      : 0;

    const avgDuration = stats.durationCount > 0
      ? Math.round(stats.totalDuration / stats.durationCount)
      : 0;

    return {
      executions: stats.executions,
      successes: stats.successes,
      failures: stats.failures,
      successRate,
      avgQuality,
      avgDuration,
      lastExecutedAt: stats.lastExecutedAt,
    };
  }

  // =========================================================================
  // 角色推荐 / Role Recommendation
  // =========================================================================

  /**
   * 基于任务关键词推荐角色
   * Recommend a role based on task keywords
   *
   * 与 matchRole 不同, getRecommendation 只使用关键词匹配,
   * 适用于还不确定能力需求的场景。
   * Unlike matchRole, getRecommendation uses keyword matching only,
   * suitable when capability requirements are not yet determined.
   *
   * @param {string[]} taskKeywords - 任务关键词
   * @returns {Object|null} 推荐的模板 (深拷贝) 或 null
   */
  getRecommendation(taskKeywords) {
    if (!taskKeywords || !Array.isArray(taskKeywords) || taskKeywords.length === 0) {
      return null;
    }

    // 构建描述文本用于匹配 / Build description text for matching
    const descLower = taskKeywords.map((k) => k.toLowerCase()).join(' ');

    let bestTemplate = null;
    let bestScore = -1;

    for (const template of this._templates.values()) {
      const keywordScore = this._computeKeywordScore(descLower, template.keywords || []);

      // 考虑历史成功率加权 / Weight by historical success rate
      const stats = this._executionStats.get(template.name);
      const historyBonus = stats && stats.executions >= 3
        ? (stats.successes / stats.executions) * 0.2
        : 0;

      const finalScore = keywordScore + historyBonus;

      if (finalScore > bestScore) {
        bestScore = finalScore;
        bestTemplate = template;
      }
    }

    if (bestScore < this._matchThreshold) return null;

    return this._deepClone(bestTemplate);
  }

  // =========================================================================
  // 内部方法 / Internal Methods
  // =========================================================================

  /**
   * 计算关键词匹配分
   * Compute keyword match score
   *
   * 返回任务描述中命中的模板关键词占模板总关键词的比例。
   * Returns the proportion of template keywords found in the task description.
   *
   * @private
   * @param {string} descLower - 小写化的任务描述
   * @param {string[]} keywords - 模板关键词列表
   * @returns {number} 0.0 - 1.0
   */
  _computeKeywordScore(descLower, keywords) {
    if (keywords.length === 0) return 0;

    let hits = 0;
    for (const kw of keywords) {
      if (descLower.includes(kw.toLowerCase())) {
        hits++;
      }
    }

    return hits / keywords.length;
  }

  /**
   * 计算 8D 能力匹配分 (余弦相似度)
   * Compute 8D capability match score (cosine similarity)
   *
   * cosine(A, B) = (A dot B) / (|A| * |B|)
   *
   * @private
   * @param {Record<string, number>} templateCaps - 模板能力分
   * @param {Record<string, number>} requirements - 需求能力分
   * @returns {number} 0.0 - 1.0
   */
  _computeCapabilityMatch(templateCaps, requirements) {
    // 如果没有需求, 返回基础分 / If no requirements, return base score
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
   * 查找与给定能力向量高度相似的已有角色 (余弦相似度 > 0.95)
   * Find existing role highly similar to given capabilities (cosine similarity > 0.95)
   *
   * @private
   * @param {Record<string, number>} capabilities
   * @returns {Object|null} 最相似的模板或 null / Most similar template or null
   */
  _findSimilarRole(capabilities) {
    if (!capabilities || Object.keys(capabilities).length === 0) return null;

    let bestTemplate = null;
    let bestSimilarity = 0;

    for (const template of this._templates.values()) {
      const similarity = this._computeCapabilityMatch(template.capabilities || {}, capabilities);
      if (similarity > 0.95 && similarity > bestSimilarity) {
        bestSimilarity = similarity;
        bestTemplate = template;
      }
    }

    return bestTemplate;
  }

  /**
   * 验证模板数据完整性
   * Validate template data integrity
   *
   * @private
   * @param {Object} template
   * @throws {Error} 数据无效时 / When data is invalid
   */
  _validateTemplate(template) {
    if (!template || typeof template !== 'object') {
      throw new Error('Template must be a non-null object');
    }

    if (typeof template.name !== 'string' || template.name.trim().length === 0) {
      throw new Error('Template must have a non-empty string "name"');
    }

    if (typeof template.description !== 'string') {
      throw new Error('Template must have a string "description"');
    }

    if (!template.capabilities || typeof template.capabilities !== 'object') {
      throw new Error('Template must have an object "capabilities" with 8D scores');
    }

    if (!Array.isArray(template.keywords)) {
      throw new Error('Template must have an array "keywords"');
    }

    if (typeof template.systemPrompt !== 'string') {
      throw new Error('Template must have a string "systemPrompt"');
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
