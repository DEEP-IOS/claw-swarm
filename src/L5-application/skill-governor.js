/**
 * Claw-Swarm V5.1 — Skills 治理引擎 / Skill Governor
 *
 * 管理蜂群的 Skill 清单、角色-Skill 匹配、使用追踪和推荐。
 * Manages swarm skill inventory, role-skill matching, usage tracking,
 * and recommendations.
 *
 * 核心机制 / Core Mechanisms:
 * - Skill 清单管理（扫描 + 增量缓存）/ Skill inventory scanning + caching
 * - 角色-Skill 亲和匹配 / Role-Skill affinity matching
 * - Skill 使用效果追踪 / Skill usage tracking
 * - Skill 推荐引擎（基于任务类型 + 历史）/ Recommendation engine
 *
 * ⚠️ Skill 三级加载优先级（workspace > user > bundled）由 OpenClaw 核心管理，
 *    治理层只做推荐和统计，不强制限制。
 *
 * @module L5-application/skill-governor
 * @version 5.1.0
 */

import { EventTopics, wrapEvent } from '../event-catalog.js';
import fs from 'fs';
import path from 'path';

// ============================================================================
// 常量 / Constants
// ============================================================================

/** 推荐注入最大 token 数 / Max tokens for recommendation injection */
const MAX_RECOMMENDATION_TOKENS = 200;

/** 缓存 TTL (ms) / Cache TTL */
const CACHE_TTL_MS = 60_000; // 1 分钟

/** 使用记录上限 / Max usage records */
const MAX_USAGE_RECORDS = 500;

/** 最大推荐 skill 数 / Max skills to recommend */
const MAX_RECOMMENDATIONS = 5;

/**
 * 角色-Skill 亲和度映射（默认权重）
 * Role-Skill affinity mapping (default weights)
 *
 * 键为角色名/角色模式，值为 skill slug 到亲和度的映射
 */
const ROLE_SKILL_AFFINITY = {
  // scout-bee / explorer / researcher
  'scout': {
    'deep-research-pro': 0.9, 'research-engine': 0.9, 'web-search-pro': 0.85,
    'academic-deep-research': 0.85, 'in-depth-research': 0.85,
    'market-research': 0.8, 'intelligence-suite': 0.8,
    'arxiv-watcher': 0.75, 'web-scraper': 0.7, 'news': 0.7,
    'browser-autopilot': 0.6, 'agent-browser': 0.6,
  },
  // worker-bee / implementer / coder
  'worker': {
    'bash': 0.9, 'github': 0.85, 'task': 0.8, 'task-system': 0.8,
    'data-analyst': 0.7, 'mermaid-architect': 0.7, 'mermaid-diagrams': 0.65,
    'self-improving': 0.6,
  },
  // guard-bee / reviewer / quality controller
  'guard': {
    'github': 0.8, 'self-improving': 0.7, 'bash': 0.65,
    'knowledge-graph': 0.6, 'agent-memory': 0.55,
  },
  // queen / coordinator / orchestrator
  'queen': {
    'task': 0.85, 'task-system': 0.85, 'project-router': 0.8,
    'intelligence-suite': 0.75, 'knowledge-graph': 0.7,
    'agent-memory': 0.65, 'self-improving': 0.6,
  },
  // 金融领域 / Finance domain
  'finance': {
    'tushare-finance': 0.95, 'finance-accounting': 0.9,
    'data-analyst': 0.85, 'market-research': 0.8,
  },
};

/**
 * 任务类型到 skill 类别的映射
 * Task type to skill category mapping
 */
const TASK_SKILL_MAPPING = {
  research: ['deep-research-pro', 'research-engine', 'web-search-pro', 'academic-deep-research', 'in-depth-research'],
  coding: ['bash', 'github', 'self-improving'],
  review: ['github', 'self-improving'],
  analysis: ['data-analyst', 'tushare-finance', 'finance-accounting'],
  writing: ['writing', 'academic-writing', 'human-writing', 'content-generation'],
  monitoring: ['web-monitor', 'web-monitor-pro', 'content-watcher', 'news'],
  visualization: ['mermaid-architect', 'mermaid-diagrams', 'seedance'],
};


// ============================================================================
// SkillGovernor
// ============================================================================

export class SkillGovernor {
  /**
   * @param {Object} deps
   * @param {Object} deps.messageBus - MessageBus 实例
   * @param {Object} [deps.capabilityEngine] - CapabilityEngine 实例
   * @param {Object} [deps.roleManager] - RoleManager 实例
   * @param {Object} deps.logger - 日志器
   * @param {Object} [deps.config] - 配置
   * @param {boolean} [deps.config.enabled] - 是否启用
   * @param {boolean} [deps.config.useCapabilityWeighting] - 是否使用能力加权（默认 true）
   * @param {string[]} [deps.config.skillDirs] - Skill 目录列表
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

    /** @private */
    this._enabled = config.enabled ?? false;

    /** @private */
    this._useCapabilityWeighting = config.useCapabilityWeighting ?? true;

    /**
     * Skill 目录列表 / Skill directories to scan
     * @private
     */
    this._skillDirs = config.skillDirs || [];

    /**
     * Skill 清单缓存 / Skill inventory cache
     * Map<slug, SkillInfo>
     * @private
     */
    this._inventory = new Map();

    /**
     * 使用记录 / Usage records
     * Array<{ skillSlug, agentId, success, timestamp, durationMs }>
     * @private
     */
    this._usageRecords = [];

    /**
     * 推荐缓存 / Recommendation cache
     * @private
     */
    this._recommendationCache = {
      key: '',
      value: '',
      expiresAt: 0,
    };

    /**
     * 文件监视器列表（用于清理）/ File watchers for cleanup
     * @private
     */
    this._watchers = [];

    /**
     * 上次扫描时间 / Last scan time
     * @private
     */
    this._lastScanAt = 0;

    /**
     * 扫描就绪标志 / Scan ready flag
     * @private
     */
    this._scanComplete = false;
  }

  // --------------------------------------------------------------------------
  // Skill 清单管理 / Skill Inventory Management
  // --------------------------------------------------------------------------

  /**
   * 扫描 Skill 目录并构建清单（gateway_start 时调用）
   * Scan skill directories and build inventory (called at gateway_start)
   *
   * @param {string[]} [additionalDirs] - 额外 skill 目录
   * @returns {number} 发现的 skill 数量
   */
  scanSkills(additionalDirs = []) {
    if (!this._enabled) return 0;

    const allDirs = [...this._skillDirs, ...additionalDirs];
    let totalFound = 0;

    for (const dir of allDirs) {
      try {
        if (!fs.existsSync(dir)) {
          this._logger.debug?.(`[SkillGovernor] Skill directory not found: ${dir}`);
          continue;
        }

        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isDirectory()) continue;

          const skillDir = path.join(dir, entry.name);
          const info = this._parseSkillDir(skillDir, entry.name);
          if (info) {
            // 后扫描的目录覆盖先扫描的（workspace > user > bundled）
            // Later directories override earlier ones (workspace > user > bundled)
            this._inventory.set(info.slug, info);
            totalFound++;
          }
        }
      } catch (err) {
        this._logger.warn?.(`[SkillGovernor] Error scanning ${dir}: ${err.message}`);
      }
    }

    this._lastScanAt = Date.now();
    this._scanComplete = true;

    this._logger.info?.(`[SkillGovernor] Scanned ${allDirs.length} directories, found ${totalFound} skills (${this._inventory.size} unique)`);

    // 发布事件 / Publish event
    this._messageBus.publish?.(
      EventTopics.SKILL_INVENTORY_UPDATED || 'skill.inventory.updated',
      wrapEvent(EventTopics.SKILL_INVENTORY_UPDATED || 'skill.inventory.updated', {
        totalSkills: this._inventory.size,
        directories: allDirs.length,
      }),
    );

    return this._inventory.size;
  }

  /**
   * 启动文件监视（增量更新，fs.watchFile 轮询模式）
   * Start file watching (incremental updates, fs.watchFile polling mode)
   *
   * ⚠️ fs.watch 在 Windows NTFS 上不可靠——使用 fs.watchFile 轮询替代
   */
  startWatching() {
    if (!this._enabled) return;

    for (const dir of this._skillDirs) {
      try {
        if (!fs.existsSync(dir)) continue;

        // 使用 fs.watchFile 轮询模式（500ms 间隔，更可靠）
        // Use fs.watchFile poll mode (500ms interval, more reliable)
        const sentinel = path.join(dir, '.skills-sentinel');

        // 创建哨兵文件用于监控目录变化 / Create sentinel file for monitoring
        try {
          if (!fs.existsSync(sentinel)) {
            fs.writeFileSync(sentinel, String(Date.now()));
          }

          fs.watchFile(sentinel, { interval: 5000 }, () => {
            this._logger.debug?.(`[SkillGovernor] Detected change in ${dir}, rescanning...`);
            this._rescanDir(dir);
          });

          this._watchers.push({ type: 'watchFile', path: sentinel });
        } catch {
          // 无法创建哨兵文件则跳过 / Skip if sentinel cannot be created
          this._logger.debug?.(`[SkillGovernor] Cannot create sentinel in ${dir}, watching disabled`);
        }
      } catch (err) {
        this._logger.warn?.(`[SkillGovernor] Failed to watch ${dir}: ${err.message}`);
      }
    }
  }

  // --------------------------------------------------------------------------
  // Skill 使用追踪 / Skill Usage Tracking
  // --------------------------------------------------------------------------

  /**
   * 记录 Skill 使用结果 / Record skill usage result
   *
   * @param {Object} record
   * @param {string} record.skillSlug - Skill slug
   * @param {string} record.agentId - Agent ID
   * @param {boolean} record.success - 是否成功
   * @param {number} [record.durationMs] - 执行时长
   * @param {string} [record.taskType] - 任务类型
   */
  recordUsage(record) {
    if (!this._enabled) return;

    this._usageRecords.push({
      skillSlug: record.skillSlug,
      agentId: record.agentId,
      success: !!record.success,
      durationMs: record.durationMs || 0,
      taskType: record.taskType || 'unknown',
      timestamp: Date.now(),
    });

    // 裁剪 / Trim
    if (this._usageRecords.length > MAX_USAGE_RECORDS) {
      this._usageRecords = this._usageRecords.slice(-MAX_USAGE_RECORDS);
    }

    // 更新 inventory 中的统计 / Update inventory stats
    const skill = this._inventory.get(record.skillSlug);
    if (skill) {
      skill.usageCount = (skill.usageCount || 0) + 1;
      skill.successCount = (skill.successCount || 0) + (record.success ? 1 : 0);
      skill.lastUsedAt = Date.now();
    }

    // 清除推荐缓存 / Invalidate recommendation cache
    this._recommendationCache.expiresAt = 0;
  }

  /**
   * 从 tool_call 事件推断 skill slug
   * Infer skill slug from tool_call event
   *
   * @param {string} toolName - 工具名
   * @returns {string|null}
   */
  inferSkillFromTool(toolName) {
    if (!toolName) return null;

    // 尝试精确匹配 inventory / Try exact match in inventory
    const normalized = toolName.toLowerCase().replace(/[_\s]+/g, '-');

    // 检查是否是 skill 提供的工具（通常工具名包含 skill slug）
    // Check if tool is from a skill (tool names often contain skill slug)
    for (const [slug] of this._inventory) {
      if (normalized.includes(slug) || normalized.startsWith(slug.split('-')[0])) {
        return slug;
      }
    }

    return null;
  }

  // --------------------------------------------------------------------------
  // Skill 推荐引擎 / Skill Recommendation Engine
  // --------------------------------------------------------------------------

  /**
   * 生成 Skill 推荐文本（用于 appendSystemContext 注入）
   * Generate skill recommendation text (for appendSystemContext injection)
   *
   * @param {Object} context
   * @param {string} [context.agentRole] - Agent 角色（scout/worker/guard/queen）
   * @param {string} [context.taskType] - 当前任务类型
   * @param {string} [context.agentId] - Agent ID
   * @returns {string} 推荐文本（≤ 200 tokens）
   */
  getRecommendations(context = {}) {
    if (!this._enabled || this._inventory.size === 0) return '';

    // 缓存检查 / Cache check
    const cacheKey = `${context.agentRole}:${context.taskType}:${context.agentId}`;
    if (this._recommendationCache.key === cacheKey && Date.now() < this._recommendationCache.expiresAt) {
      return this._recommendationCache.value;
    }

    const scores = this._computeSkillScores(context);

    // 取 top N 推荐 / Take top N recommendations
    const topSkills = scores
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_RECOMMENDATIONS)
      .filter(s => s.score > 0.1); // 过滤低分 / Filter low scores

    if (topSkills.length === 0) return '';

    // 生成推荐文本（硬限制 ≤ 200 tokens ≈ 400 字符）
    // Generate recommendation text (hard limit ≤ 200 tokens ≈ 400 chars)
    const skillList = topSkills
      .map(s => `${s.slug} (${s.description || s.name})`)
      .join(', ');

    let text = `[Skill Recommendations] Available skills for this task: ${skillList}`;

    // 字符估算裁剪（中文 1 字 ≈ 2 tokens，英文 4 字符 ≈ 1 token）
    // Character-based truncation (Chinese: 1 char ≈ 2 tokens, English: 4 chars ≈ 1 token)
    const maxChars = MAX_RECOMMENDATION_TOKENS * 3; // ~600 chars conservative estimate
    if (text.length > maxChars) {
      text = text.slice(0, maxChars - 3) + '...';
    }

    // 缓存结果 / Cache result
    this._recommendationCache = {
      key: cacheKey,
      value: text,
      expiresAt: Date.now() + CACHE_TTL_MS,
    };

    return text;
  }

  // --------------------------------------------------------------------------
  // 查询方法 / Query Methods
  // --------------------------------------------------------------------------

  /**
   * 获取 Skill 清单 / Get skill inventory
   *
   * @param {Object} [options]
   * @param {string} [options.category] - 按类别过滤
   * @returns {Array<Object>}
   */
  getInventory(options = {}) {
    const results = [];
    for (const [slug, info] of this._inventory) {
      if (options.category) {
        // 检查是否属于该类别 / Check category membership
        const categorySkills = TASK_SKILL_MAPPING[options.category] || [];
        if (!categorySkills.includes(slug)) continue;
      }
      results.push({ ...info });
    }
    return results;
  }

  /**
   * 获取使用统计 / Get usage statistics
   *
   * @param {string} [skillSlug] - 特定 skill 的统计
   * @returns {Object}
   */
  getUsageStats(skillSlug) {
    if (skillSlug) {
      const records = this._usageRecords.filter(r => r.skillSlug === skillSlug);
      const successCount = records.filter(r => r.success).length;
      return {
        slug: skillSlug,
        totalUses: records.length,
        successRate: records.length > 0 ? successCount / records.length : 0,
        avgDuration: records.length > 0
          ? records.reduce((s, r) => s + r.durationMs, 0) / records.length
          : 0,
        lastUsed: records.length > 0 ? records[records.length - 1].timestamp : null,
      };
    }

    // 全局统计 / Global stats
    const bySkill = {};
    for (const r of this._usageRecords) {
      if (!bySkill[r.skillSlug]) {
        bySkill[r.skillSlug] = { total: 0, success: 0 };
      }
      bySkill[r.skillSlug].total++;
      if (r.success) bySkill[r.skillSlug].success++;
    }

    return {
      totalRecords: this._usageRecords.length,
      inventorySize: this._inventory.size,
      scanComplete: this._scanComplete,
      lastScanAt: this._lastScanAt,
      topSkills: Object.entries(bySkill)
        .sort((a, b) => b[1].total - a[1].total)
        .slice(0, 10)
        .map(([slug, stats]) => ({
          slug,
          uses: stats.total,
          successRate: stats.total > 0 ? Math.round(stats.success / stats.total * 100) / 100 : 0,
        })),
    };
  }

  /**
   * 获取能力缺口建议 / Get capability gap suggestions
   *
   * 根据蜂群当前能力缺口，建议安装新的 skills。
   * Based on current swarm capability gaps, suggest installing new skills.
   *
   * @returns {Array<{ category: string, reason: string }>}
   */
  getGapSuggestions() {
    if (!this._enabled) return [];

    const suggestions = [];
    const inventorySlugs = new Set(this._inventory.keys());

    // 检查每个任务类别的 skill 覆盖率
    // Check skill coverage for each task category
    for (const [category, skillSlugs] of Object.entries(TASK_SKILL_MAPPING)) {
      const covered = skillSlugs.filter(s => inventorySlugs.has(s)).length;
      const coverage = skillSlugs.length > 0 ? covered / skillSlugs.length : 1;

      if (coverage < 0.3) {
        suggestions.push({
          category,
          reason: `Low skill coverage for '${category}' tasks (${Math.round(coverage * 100)}%)`,
          missing: skillSlugs.filter(s => !inventorySlugs.has(s)),
        });
      }
    }

    return suggestions;
  }

  // --------------------------------------------------------------------------
  // 生命周期 / Lifecycle
  // --------------------------------------------------------------------------

  /**
   * 销毁 / Destroy
   */
  destroy() {
    // 清理文件监视器 / Clean up file watchers
    for (const w of this._watchers) {
      try {
        if (w.type === 'watchFile') {
          fs.unwatchFile(w.path);
        }
      } catch {
        // ignore
      }
    }
    this._watchers = [];

    this._inventory.clear();
    this._usageRecords = [];
    this._recommendationCache = { key: '', value: '', expiresAt: 0 };

    this._logger.info?.('[SkillGovernor] Destroyed');
  }

  // --------------------------------------------------------------------------
  // 私有方法 / Private Methods
  // --------------------------------------------------------------------------

  /**
   * 解析 Skill 目录 / Parse skill directory
   * @private
   */
  _parseSkillDir(dirPath, dirName) {
    try {
      const skillMdPath = path.join(dirPath, 'SKILL.md');
      const metaJsonPath = path.join(dirPath, '_meta.json');

      let slug = dirName;
      let name = dirName;
      let description = '';
      let version = '0.0.0';
      let author = '';

      // 解析 _meta.json / Parse _meta.json
      if (fs.existsSync(metaJsonPath)) {
        try {
          const meta = JSON.parse(fs.readFileSync(metaJsonPath, 'utf-8'));
          if (meta.slug) slug = meta.slug;
          if (meta.version) version = meta.version;
        } catch {
          // JSON 解析失败则继续 / Continue on parse error
        }
      }

      // 解析 SKILL.md 前言 / Parse SKILL.md front matter
      if (fs.existsSync(skillMdPath)) {
        try {
          const content = fs.readFileSync(skillMdPath, 'utf-8');
          const parsed = this._parseFrontMatter(content);
          if (parsed.name) name = parsed.name;
          if (parsed.description) description = parsed.description;
          if (parsed.version) version = parsed.version;
          if (parsed.author) author = parsed.author;
          if (parsed.slug) slug = parsed.slug;
        } catch {
          // 解析失败则继续 / Continue on parse error
        }
      }

      return {
        slug,
        name,
        description: typeof description === 'string' ? description.slice(0, 200) : '',
        version,
        author,
        dirPath,
        usageCount: 0,
        successCount: 0,
        lastUsedAt: null,
      };
    } catch {
      return null;
    }
  }

  /**
   * 解析 SKILL.md 的 YAML 前言 / Parse SKILL.md YAML front matter
   * @private
   */
  _parseFrontMatter(content) {
    const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
    if (!match) return {};

    const result = {};
    const lines = match[1].split('\n');

    for (const line of lines) {
      const colonIdx = line.indexOf(':');
      if (colonIdx === -1) continue;

      const key = line.slice(0, colonIdx).trim();
      let value = line.slice(colonIdx + 1).trim();

      // 去掉引号 / Remove quotes
      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }

      if (key && value) {
        result[key] = value;
      }
    }

    return result;
  }

  /**
   * 计算 skill 推荐分数 / Compute skill recommendation scores
   * @private
   */
  _computeSkillScores(context) {
    const { agentRole, taskType, agentId } = context;
    const scores = [];

    for (const [slug, info] of this._inventory) {
      let score = 0;

      // 1. 角色亲和度（60% 或 100%）/ Role affinity (60% or 100%)
      const roleWeight = this._useCapabilityWeighting ? 0.6 : 1.0;
      let roleAffinity = 0;

      if (agentRole) {
        // 匹配角色关键词 / Match role keywords
        for (const [roleKey, affinityMap] of Object.entries(ROLE_SKILL_AFFINITY)) {
          if (agentRole.toLowerCase().includes(roleKey)) {
            roleAffinity = Math.max(roleAffinity, affinityMap[slug] || 0);
          }
        }
      }

      // 2. 任务类型匹配 / Task type match
      let taskAffinity = 0;
      if (taskType) {
        const taskSkills = TASK_SKILL_MAPPING[taskType] || [];
        if (taskSkills.includes(slug)) {
          taskAffinity = 0.8;
        }
      }

      // 合并角色和任务亲和度 / Combine role and task affinity
      const combinedAffinity = Math.max(roleAffinity, taskAffinity);

      // 3. 能力加权（40%）/ Capability weighting (40%)
      let capabilityScore = 0.5; // 中性默认 / Neutral default

      if (this._useCapabilityWeighting && this._capabilityEngine && agentId) {
        try {
          const profile = this._capabilityEngine.getCapabilityProfile?.(agentId);
          if (profile) {
            // 基于 agent 强项和 skill 类别的匹配
            // Match based on agent strengths and skill category
            capabilityScore = this._computeCapabilityMatch(profile, slug);
          }
        } catch {
          // fallback 到中性值 / Fallback to neutral
        }
      }

      score = combinedAffinity * roleWeight + capabilityScore * (1 - roleWeight);

      // 4. 历史成功率加成 / Historical success bonus
      const usageStats = this._getSkillUsageStats(slug);
      if (usageStats.total > 0) {
        const historyBonus = usageStats.successRate * 0.1; // 最多 +10%
        score += historyBonus;
      }

      // 5. 最近使用衰减（避免重复推荐相同 skill）
      // Recency decay (avoid repeatedly recommending the same skill)
      if (info.lastUsedAt) {
        const minutesSinceUse = (Date.now() - info.lastUsedAt) / 60_000;
        if (minutesSinceUse < 5) {
          score *= 0.7; // 最近 5 分钟内使用过，降权
        }
      }

      if (score > 0) {
        scores.push({
          slug,
          name: info.name,
          description: info.description,
          score,
        });
      }
    }

    return scores;
  }

  /**
   * 计算 agent 能力与 skill 的匹配度
   * Compute capability match between agent and skill
   * @private
   */
  _computeCapabilityMatch(profile, skillSlug) {
    // 基于 skill 类别推断相关能力维度
    // Infer relevant capability dimensions from skill category
    const dimensionMap = {
      // 研究类 skill → communication + domain
      'deep-research-pro': { communication: 0.4, domain: 0.6 },
      'research-engine': { communication: 0.4, domain: 0.6 },
      'web-search-pro': { communication: 0.5, domain: 0.5 },
      // 编码类 skill → coding + performance
      'bash': { coding: 0.8, performance: 0.2 },
      'github': { coding: 0.6, performance: 0.4 },
      // 分析类 skill → domain + coding
      'data-analyst': { domain: 0.6, coding: 0.4 },
      'tushare-finance': { domain: 0.8, coding: 0.2 },
    };

    const weights = dimensionMap[skillSlug];
    if (!weights) return 0.5; // 未知 skill 返回中性 / Unknown skill returns neutral

    let matchScore = 0;
    let totalWeight = 0;

    for (const [dim, weight] of Object.entries(weights)) {
      const profileValue = profile[dim] ?? 50;
      matchScore += (profileValue / 100) * weight;
      totalWeight += weight;
    }

    return totalWeight > 0 ? matchScore / totalWeight : 0.5;
  }

  /**
   * 获取 skill 的使用统计（内存中）/ Get skill usage stats (in-memory)
   * @private
   */
  _getSkillUsageStats(slug) {
    const records = this._usageRecords.filter(r => r.skillSlug === slug);
    const successCount = records.filter(r => r.success).length;
    return {
      total: records.length,
      successRate: records.length > 0 ? successCount / records.length : 0,
    };
  }

  /**
   * 重新扫描单个目录 / Rescan single directory
   * @private
   */
  _rescanDir(dir) {
    try {
      if (!fs.existsSync(dir)) return;

      const entries = fs.readdirSync(dir, { withFileTypes: true });
      let added = 0;

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;

        const skillDir = path.join(dir, entry.name);
        const info = this._parseSkillDir(skillDir, entry.name);
        if (info && !this._inventory.has(info.slug)) {
          this._inventory.set(info.slug, info);
          added++;
        }
      }

      if (added > 0) {
        this._logger.info?.(`[SkillGovernor] Incremental scan: ${added} new skills in ${dir}`);
        this._messageBus.publish?.(
          'skill.inventory.updated',
          wrapEvent('skill.inventory.updated', {
            totalSkills: this._inventory.size,
            newSkills: added,
          }),
        );
      }
    } catch (err) {
      this._logger.warn?.(`[SkillGovernor] Rescan error for ${dir}: ${err.message}`);
    }
  }
}
