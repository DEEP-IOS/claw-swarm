/**
 * ResultSynthesizer -- Jaccard 去重 + 冲突检测 / Jaccard Dedup + Conflict Detection
 *
 * v4.x 直接迁移并增强: 保留核心 Jaccard 相似度算法和文件冲突检测,
 * 升级构造函数为依赖注入模式, 新增质量指标聚合和结构化的合并输出。
 *
 * Directly migrated from v4.x with enhancements: preserved core Jaccard
 * similarity algorithm and file conflict detection, upgraded constructor
 * to dependency injection pattern, added quality metrics aggregation
 * and structured merge output.
 *
 * [RESEARCH R4] Jaccard 相似度: J(A,B) = |A intersect B| / |A union B|
 * 使用 word-level bigrams 作为集合元素, 阈值可配置。
 * Jaccard similarity: J(A,B) = |A intersect B| / |A union B|
 * Uses word-level bigrams as set elements with configurable threshold.
 *
 * @module L4-orchestration/result-synthesizer
 * @author DEEP-IOS
 */

// ============================================================================
// 常量 / Constants
// ============================================================================

/** 默认 Jaccard 相似度阈值 / Default Jaccard similarity threshold */
const DEFAULT_SIMILARITY_THRESHOLD = 0.6;

/** 最低文本长度 (低于此值不做去重) / Min text length for dedup */
const MIN_TEXT_LENGTH = 50;

/**
 * 角色优先级排序 (用于冲突解决建议)
 * Role priority order (used for conflict resolution suggestions)
 * @type {string[]}
 */
const ROLE_PRIORITY_ORDER = [
  'architect',
  'developer',
  'backend',
  'frontend',
  'tester',
  'reviewer',
  'security',
  'devops',
  'designer',
  'analyst',
  'writer',
];

// ============================================================================
// ResultSynthesizer 类 / ResultSynthesizer Class
// ============================================================================

/**
 * 多角色产出合并器: 去重、冲突检测、质量聚合。
 * Multi-role result merger: deduplication, conflict detection, quality aggregation.
 *
 * @example
 * ```js
 * const synthesizer = new ResultSynthesizer({ config, logger });
 * const { merged, duplicates, conflicts, metrics } = synthesizer.merge(roles);
 * ```
 */
export class ResultSynthesizer {
  /**
   * @param {Object} [deps] - 依赖注入 / Dependency injection
   * @param {Object} [deps.config] - 配置 / Configuration
   * @param {number} [deps.config.similarityThreshold=0.6] - Jaccard 相似度阈值
   * @param {number} [deps.config.minTextLength=50] - 最低文本长度
   * @param {Object} [deps.logger] - 日志器 / Logger
   */
  constructor({ config = {}, logger } = {}) {
    /** @private @type {number} */
    this._similarityThreshold = config.similarityThreshold ?? DEFAULT_SIMILARITY_THRESHOLD;

    /** @private @type {number} */
    this._minTextLength = config.minTextLength ?? MIN_TEXT_LENGTH;

    /** @private */
    this._logger = logger || console;
  }

  // =========================================================================
  // 公共 API / Public API
  // =========================================================================

  /**
   * 合并多角色产出
   * Merge outputs from multiple roles
   *
   * 流程 / Pipeline:
   *   1. 分类 completed / failed
   *   2. 收集每角色产出到 artifacts
   *   3. 检测重复内容 (Jaccard)
   *   4. 检测文件路径冲突
   *   5. 聚合质量指标
   *
   * @param {Array<{ role: string|Object, result: Object, gate?: Object }>} roles
   *   - role: 角色名称或角色对象 / Role name or role object
   *   - result: 角色产出 / Role output
   *   - gate: 质量门控信息 (可选) / Quality gate info (optional)
   * @returns {{
   *   merged: { completed: Array, failed: Array, artifacts: Object },
   *   duplicates: Array<{ roleA: string, roleB: string, similarity: number }>,
   *   conflicts: Array<{ filePath: string, roles: string[], resolution: string }>,
   *   metrics: { completedCount: number, failedCount: number, avgQuality: number }
   * }}
   */
  merge(roles) {
    if (!roles || roles.length === 0) {
      return {
        merged: { completed: [], failed: [], artifacts: {} },
        duplicates: [],
        conflicts: [],
        metrics: { completedCount: 0, failedCount: 0, avgQuality: 0 },
      };
    }

    // 1. 分类 / Classify
    const completed = [];
    const failed = [];
    const artifacts = {};

    for (const entry of roles) {
      const roleName = this._resolveRoleName(entry.role);
      const resultData = entry.result;

      if (this._isFailed(resultData)) {
        failed.push({
          role: roleName,
          error: resultData?.error || 'Unknown error',
        });
      } else {
        completed.push({
          role: roleName,
          result: resultData,
          gate: entry.gate || null,
        });
        // 以角色名为键收集产出 / Collect artifacts keyed by role name
        artifacts[roleName] = resultData?.result || resultData;
      }
    }

    // 2. 检测重复 / Detect duplicates
    const duplicates = this.detectDuplicates(completed, this._similarityThreshold);

    // 3. 检测冲突 / Detect conflicts
    const conflicts = this.detectConflicts(artifacts);

    // 4. 聚合指标 / Aggregate metrics
    const metrics = this.aggregateMetrics(completed, failed);

    this._logger.debug?.(
      `[ResultSynthesizer] 合并完成 / Merge complete: ` +
      `completed=${completed.length}, failed=${failed.length}, ` +
      `duplicates=${duplicates.length}, conflicts=${conflicts.length}`
    );

    return {
      merged: { completed, failed, artifacts },
      duplicates,
      conflicts,
      metrics,
    };
  }

  /**
   * 在完成的结果中检测重复内容对
   * Detect duplicate content pairs among completed results
   *
   * 对每对已完成角色的产出文本计算 Jaccard 相似度,
   * 超过阈值的标记为重复对。
   * Computes Jaccard similarity for each pair of completed role outputs;
   * pairs exceeding the threshold are flagged as duplicates.
   *
   * @param {Array<{ role: string, result: Object }>} results - 已完成的结果列表
   * @param {number} [threshold] - 相似度阈值 (默认使用构造时配置)
   * @returns {Array<{ roleA: string, roleB: string, similarity: number }>}
   */
  detectDuplicates(results, threshold) {
    const thresh = threshold ?? this._similarityThreshold;
    const duplicates = [];

    for (let i = 0; i < results.length; i++) {
      for (let j = i + 1; j < results.length; j++) {
        const textA = this._extractText(results[i].result);
        const textB = this._extractText(results[j].result);

        // 文本过短时跳过 / Skip if text is too short
        if (textA.length < this._minTextLength || textB.length < this._minTextLength) {
          continue;
        }

        const similarity = this.computeJaccard(textA, textB);

        if (similarity >= thresh) {
          duplicates.push({
            roleA: results[i].role,
            roleB: results[j].role,
            similarity: Math.round(similarity * 100) / 100,
          });
        }
      }
    }

    return duplicates;
  }

  /**
   * 检测文件路径冲突: 同一文件被多个角色修改
   * Detect file path conflicts: same file modified by multiple roles
   *
   * @param {Object} artifactsByRole - { roleName: resultData }
   * @returns {Array<{ filePath: string, roles: string[], resolution: string }>}
   */
  detectConflicts(artifactsByRole) {
    const conflicts = [];

    if (!artifactsByRole || typeof artifactsByRole !== 'object') {
      return conflicts;
    }

    /** @type {Map<string, string[]>} filePath -> roles */
    const fileToRoles = new Map();

    // 扫描每个角色的产出, 提取文件路径
    // Scan each role's output and extract file paths
    for (const [roleName, result] of Object.entries(artifactsByRole)) {
      const files = this._extractFilePaths(result);
      for (const filePath of files) {
        if (!fileToRoles.has(filePath)) {
          fileToRoles.set(filePath, []);
        }
        fileToRoles.get(filePath).push(roleName);
      }
    }

    // 同一文件被 2+ 角色修改即为冲突
    // Same file modified by 2+ roles constitutes a conflict
    for (const [filePath, roles] of fileToRoles) {
      if (roles.length > 1) {
        conflicts.push({
          filePath,
          roles: [...roles],
          resolution: this._suggestResolution(roles),
        });
      }
    }

    return conflicts;
  }

  /**
   * 计算两段文本的 Jaccard 相似度
   * Compute Jaccard similarity between two texts
   *
   * J(A,B) = |A intersect B| / |A union B|
   * 使用 word-level bigrams 作为集合元素。
   * Uses word-level bigrams as set elements.
   *
   * @param {string} textA
   * @param {string} textB
   * @returns {number} 相似度 0.0 - 1.0 / Similarity 0.0 - 1.0
   */
  computeJaccard(textA, textB) {
    const bigramsA = this._getBigrams(textA);
    const bigramsB = this._getBigrams(textB);

    // 两个空集合视为完全相同 / Two empty sets are identical
    if (bigramsA.size === 0 && bigramsB.size === 0) return 1.0;
    // 一空一非空: 完全不同 / One empty, one not: totally different
    if (bigramsA.size === 0 || bigramsB.size === 0) return 0.0;

    // 计算交集大小 / Compute intersection size
    let intersection = 0;
    for (const gram of bigramsA) {
      if (bigramsB.has(gram)) intersection++;
    }

    // |A union B| = |A| + |B| - |A intersect B|
    const union = bigramsA.size + bigramsB.size - intersection;
    return union > 0 ? intersection / union : 0;
  }

  /**
   * 聚合质量指标
   * Aggregate quality metrics across roles
   *
   * @param {Array<{ role: string, result: Object, gate?: Object }>} completed
   * @param {Array<{ role: string, error: string }>} [failed=[]]
   * @returns {{ completedCount: number, failedCount: number, avgQuality: number }}
   */
  aggregateMetrics(completed, failed = []) {
    const completedCount = completed.length;
    const failedCount = failed.length;

    // 平均质量分: 从 gate.score 提取, 默认 0.7
    // Average quality: extracted from gate.score, defaults to 0.7
    let totalScore = 0;
    for (const entry of completed) {
      totalScore += entry.gate?.score ?? 0.7;
    }

    const avgQuality = completedCount > 0
      ? Math.round((totalScore / completedCount) * 100) / 100
      : 0;

    return { completedCount, failedCount, avgQuality };
  }

  // =========================================================================
  // 内部方法 / Internal Methods
  // =========================================================================

  /**
   * 解析角色名称
   * Resolve role name from various formats
   *
   * @private
   * @param {string|Object} role
   * @returns {string}
   */
  _resolveRoleName(role) {
    if (typeof role === 'string') return role;
    return role?.name || 'unknown';
  }

  /**
   * 判断结果是否为失败
   * Determine if a result represents a failure
   *
   * @private
   * @param {Object} result
   * @returns {boolean}
   */
  _isFailed(result) {
    return result?.status === 'failed' || !!result?.error;
  }

  /**
   * 从角色结果中提取文本
   * Extract text from role result
   *
   * 按优先级尝试多种属性, 最后回退到 JSON 序列化。
   * Tries multiple properties by priority, falls back to JSON serialization.
   *
   * @private
   * @param {*} result
   * @returns {string}
   */
  _extractText(result) {
    if (typeof result === 'string') return result;
    if (result?.output) return String(result.output);
    if (result?.result) return String(result.result);
    if (result?.content) return String(result.content);
    if (result?.text) return String(result.text);
    try {
      return JSON.stringify(result);
    } catch {
      return '';
    }
  }

  /**
   * 从结果中提取文件路径
   * Extract file paths from result
   *
   * 使用正则匹配常见的源代码文件路径和文件名模式。
   * Uses regex to match common source file paths and filename patterns.
   *
   * @private
   * @param {*} result
   * @returns {string[]}
   */
  _extractFilePaths(result) {
    const text = this._extractText(result);
    if (!text) return [];

    const patterns = [
      // 目录路径模式 / Directory path pattern
      /(?:^|\s)((?:src|lib|test|tests|app|components|pages|api|utils|hooks|services|models|controllers|routes|middleware|config|public|assets|styles)\/[\w./-]+\.\w{1,10})/gm,
      // 文件名模式 / Filename pattern
      /(?:^|\s)([\w.-]+\.(?:js|ts|jsx|tsx|css|scss|html|json|yaml|yml|md|py|go|rs|java|rb|php|sql|sh|bash))\b/gm,
    ];

    const files = new Set();
    for (const pattern of patterns) {
      // 重置 lastIndex (RegExp 有状态) / Reset lastIndex (RegExp is stateful)
      pattern.lastIndex = 0;
      let match;
      while ((match = pattern.exec(text)) !== null) {
        files.add(match[1].trim());
      }
    }

    return [...files];
  }

  /**
   * 冲突解决建议
   * Suggest conflict resolution strategy
   *
   * 按角色优先级排序, 建议采用最高优先级角色的产出。
   * Sorts by role priority and suggests using the highest-priority role's output.
   *
   * @private
   * @param {string[]} roles
   * @returns {string}
   */
  _suggestResolution(roles) {
    for (const priorityRole of ROLE_PRIORITY_ORDER) {
      const match = roles.find((r) =>
        r.toLowerCase().includes(priorityRole.toLowerCase())
      );
      if (match) {
        return `Prefer output from "${match}" (higher priority role)`;
      }
    }

    return `Manual review needed: ${roles.join(', ')} modified the same file`;
  }

  /**
   * 提取 word-level bigrams
   * Extract word-level bigrams from text
   *
   * 将文本小写化、按空白符分词、过滤短词,
   * 然后取相邻词对构成 bigram 集合。
   * Lowercases text, splits by whitespace, filters short words,
   * then builds bigram set from adjacent word pairs.
   *
   * @private
   * @param {string} text
   * @returns {Set<string>}
   */
  _getBigrams(text) {
    const words = text
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 1);

    const bigrams = new Set();

    for (let i = 0; i < words.length - 1; i++) {
      bigrams.add(`${words[i]} ${words[i + 1]}`);
    }

    return bigrams;
  }
}
