/**
 * CriticalPathAnalyzer -- CPM 关键路径分析 / Critical Path Method Analysis
 *
 * 从 v4.x critical-path.js (~300行) 直接迁移, 核心算法不变:
 * Direct migration from v4.x critical-path.js (~300 lines), core algorithm unchanged:
 *
 * - 前向遍历: 计算 ES (最早开始) 和 EF (最早完成)
 *   Forward pass: calculate ES (Earliest Start) and EF (Earliest Finish)
 * - 后向遍历: 计算 LS (最晚开始) 和 LF (最晚完成)
 *   Backward pass: calculate LS (Latest Start) and LF (Latest Finish)
 * - 松弛时间: Slack = LS - ES, 关键路径 = slack=0 的节点链
 *   Slack = LS - ES, critical path = chain of nodes with slack=0
 * - 瓶颈拆分建议: 对关键路径上的长时任务提出拆分建议
 *   Bottleneck split suggestions for long-duration critical path tasks
 *
 * V5.0 适配:
 * - 构造函数接收 { logger } (纯计算模块, 不依赖 DB/MessageBus)
 * - export class + JSDoc 类型
 * - 预留 ABC 调度接口
 *
 * @module L4-orchestration/critical-path
 * @author DEEP-IOS
 */

// ============================================================================
// 常量 / Constants
// ============================================================================

/** 默认瓶颈拆分阈值 (ms) / Default bottleneck split threshold */
const DEFAULT_BOTTLENECK_THRESHOLD_MS = 120000;

// ============================================================================
// 内部类型 / Internal Types
// ============================================================================

/**
 * @typedef {Object} RoleInput
 * CPM 角色输入 / Role input for CPM analysis
 * @property {string} name - 角色名称 / Role name
 * @property {number} duration - 预估时长 (ms) / Estimated duration in ms
 * @property {string[]} [dependencies] - 依赖角色名称列表 / Dependency role names
 * @property {string[]} [dependsOn] - 依赖角色名称列表 (别名) / Alias for dependencies
 * @property {number} [priority] - 优先级 / Priority
 */

/**
 * @typedef {Object} RoleAnalysis
 * CPM 分析后的角色数据 / Role data after CPM analysis
 * @property {string} name - 角色名称
 * @property {number} duration - 时长 (ms)
 * @property {string[]} dependencies - 依赖列表
 * @property {number} ES - 最早开始时间 / Earliest Start
 * @property {number} EF - 最早完成时间 / Earliest Finish
 * @property {number} LS - 最晚开始时间 / Latest Start
 * @property {number} LF - 最晚完成时间 / Latest Finish
 * @property {number} slack - 松弛时间 / Slack time
 * @property {boolean} isCritical - 是否在关键路径上
 */

/**
 * @typedef {Object} AnalysisResult
 * CPM 分析结果 / CPM analysis result
 * @property {string[]} criticalPath - 关键路径角色名序列 / Critical path role names
 * @property {number} totalDuration - 项目总工期 (ms) / Total project duration
 * @property {Map<string, RoleAnalysis>} roleAnalysis - 每个角色的详细分析
 * @property {number} criticalPathLength - 关键路径长度
 * @property {number} parallelismFactor - 并行度因子 (总工作量/总工期)
 */

// ============================================================================
// CriticalPathAnalyzer 主类 / Main Class
// ============================================================================

export class CriticalPathAnalyzer {
  /**
   * @param {Object} [deps] - 依赖注入 / Dependency injection
   * @param {Object} [deps.logger] - 日志器 / Logger
   */
  constructor({ logger = console } = {}) {
    /** @type {Object} */
    this._logger = logger;

    /**
     * 角色分析结果缓存 / Cached role analysis results
     * @type {Map<string, RoleAnalysis>}
     */
    this._roleAnalysis = new Map();

    /**
     * 关键路径角色名序列 / Critical path role name sequence
     * @type {string[]}
     */
    this._criticalPath = [];

    /**
     * 项目总工期 / Total project duration
     * @type {number}
     */
    this._totalDuration = 0;

    /**
     * 是否已分析 / Whether analysis has been performed
     * @type {boolean}
     */
    this._analyzed = false;

    /** @type {import('../L1-infrastructure/worker-pool.js').WorkerPool | null} V6.0 Worker 委托 */
    this._workerPool = null;
  }

  /**
   * V6.0: 设置 Worker 线程池
   * V6.0: Set worker pool for CPM delegation
   *
   * @param {import('../L1-infrastructure/worker-pool.js').WorkerPool} pool
   */
  setWorkerPool(pool) {
    this._workerPool = pool;
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 核心分析 / Core Analysis
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  /**
   * 执行 CPM 分析
   * Perform CPM (Critical Path Method) analysis
   *
   * @param {RoleInput[]} roles - 角色列表 (含时长和依赖)
   * @returns {AnalysisResult} 分析结果
   * @throws {Error} 角色列表为空或存在循环依赖
   */
  analyze(roles) {
    if (!roles || roles.length === 0) {
      throw new Error('角色列表不能为空 / Roles list cannot be empty');
    }

    this.reset();

    this._logger.debug?.(
      `[CriticalPath] 开始 CPM 分析, ${roles.length} 个角色 / ` +
      `Starting CPM analysis with ${roles.length} roles`,
    );

    // Step 1: 标准化角色数据 / Normalize role data
    const normalized = this._normalizeRoles(roles);

    // Step 2: 拓扑排序 / Topological sort
    const sortedNames = this._topologicalSort(normalized);

    // Step 3: 前向遍历 (计算 ES, EF) / Forward pass (compute ES, EF)
    this._forwardPass(sortedNames, normalized);

    // Step 4: 后向遍历 (计算 LS, LF) / Backward pass (compute LS, LF)
    this._backwardPass(sortedNames, normalized);

    // Step 5: 计算松弛时间, 标记关键路径 / Compute slack, mark critical path
    this._computeSlack(normalized);

    // Step 6: 提取关键路径序列 / Extract critical path sequence
    this._extractCriticalPath(sortedNames, normalized);

    this._analyzed = true;

    // 计算并行度因子 / Compute parallelism factor
    let totalWork = 0;
    for (const role of normalized.values()) {
      totalWork += role.duration;
    }
    const parallelismFactor = this._totalDuration > 0
      ? totalWork / this._totalDuration
      : 1;

    const result = {
      criticalPath: [...this._criticalPath],
      totalDuration: this._totalDuration,
      roleAnalysis: new Map(this._roleAnalysis),
      criticalPathLength: this._criticalPath.length,
      parallelismFactor: Math.round(parallelismFactor * 100) / 100,
    };

    this._logger.info?.(
      `[CriticalPath] CPM 分析完成 / Analysis complete: ` +
      `总工期=${this._totalDuration}ms, 关键路径=${this._criticalPath.join(' -> ')}, ` +
      `并行度=${result.parallelismFactor}`,
    );

    return result;
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 查询接口 / Query Interface
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  /**
   * 检查某角色是否在关键路径上
   * Check if a role is on the critical path
   *
   * @param {string} roleName - 角色名称
   * @returns {boolean}
   */
  isCritical(roleName) {
    if (!this._analyzed) return false;
    const analysis = this._roleAnalysis.get(roleName);
    return analysis ? analysis.isCritical : false;
  }

  /**
   * 获取某角色的松弛时间
   * Get slack time for a role
   *
   * @param {string} roleName - 角色名称
   * @returns {number} 松弛时间 (ms), 未找到返回 -1
   */
  getSlack(roleName) {
    if (!this._analyzed) return -1;
    const analysis = this._roleAnalysis.get(roleName);
    return analysis ? analysis.slack : -1;
  }

  /**
   * 获取关键路径上的瓶颈拆分建议
   * Suggest splitting bottleneck tasks on the critical path
   *
   * 对于关键路径上时长超过阈值的角色, 建议拆分为更小的子角色。
   * For roles on critical path with duration exceeding threshold, suggest splitting.
   *
   * @param {number} [threshold] - 拆分阈值 (ms), 默认 120000
   * @returns {Array<{ roleName: string, duration: number, suggestion: string, splitCount: number }>}
   */
  suggestBottleneckSplits(threshold = DEFAULT_BOTTLENECK_THRESHOLD_MS) {
    if (!this._analyzed) return [];

    const suggestions = [];

    for (const roleName of this._criticalPath) {
      const analysis = this._roleAnalysis.get(roleName);
      if (!analysis) continue;

      if (analysis.duration > threshold) {
        // 建议拆分数量: 向上取整 (时长/阈值)
        // Suggested split count: ceil(duration / threshold)
        const splitCount = Math.ceil(analysis.duration / threshold);

        // 计算潜在节省 / Calculate potential savings
        const splitDuration = Math.ceil(analysis.duration / splitCount);
        const potentialSaving = analysis.duration - splitDuration;

        suggestions.push({
          roleName,
          duration: analysis.duration,
          slack: analysis.slack,
          suggestion:
            `角色 "${roleName}" 时长 ${analysis.duration}ms 超过阈值 ${threshold}ms, ` +
            `建议拆分为 ${splitCount} 个子角色, 每个约 ${splitDuration}ms。` +
            `潜在节省: ${potentialSaving}ms / ` +
            `Role "${roleName}" duration ${analysis.duration}ms exceeds threshold ${threshold}ms, ` +
            `suggest splitting into ${splitCount} sub-roles of ~${splitDuration}ms each. ` +
            `Potential saving: ${potentialSaving}ms`,
          splitCount,
          splitDuration,
          potentialSaving,
        });
      }
    }

    if (suggestions.length > 0) {
      this._logger.info?.(
        `[CriticalPath] 发现 ${suggestions.length} 个瓶颈拆分建议 / ` +
        `Found ${suggestions.length} bottleneck split suggestions`,
      );
    }

    return suggestions;
  }

  /**
   * 重置分析状态
   * Reset analysis state
   */
  reset() {
    this._roleAnalysis.clear();
    this._criticalPath = [];
    this._totalDuration = 0;
    this._analyzed = false;
  }

  /**
   * V6.0: Worker 委托版分析 (异步)
   * V6.0: Worker-delegated CPM analysis (async)
   *
   * @param {RoleInput[]} roles
   * @returns {Promise<AnalysisResult>}
   */
  async analyzeAsync(roles) {
    if (!this._workerPool) {
      return this.analyze(roles);
    }

    try {
      const normalizedRoles = roles.map((r) => ({
        name: r.name,
        duration: r.duration || 1,
        dependencies: r.dependencies || r.dependsOn || [],
      }));

      const result = await this._workerPool.submit('criticalPath', {
        roles: normalizedRoles,
      });

      if (result.error) {
        throw new Error(result.error);
      }

      // 更新内部缓存 / Update internal caches
      this.reset();
      this._criticalPath = result.criticalPath;
      this._totalDuration = result.totalDuration;
      for (const [name, analysis] of Object.entries(result.roleAnalysis)) {
        this._roleAnalysis.set(name, analysis);
      }
      this._analyzed = true;

      return {
        criticalPath: result.criticalPath,
        totalDuration: result.totalDuration,
        roleAnalysis: this._roleAnalysis,
        criticalPathLength: result.criticalPath.length,
        parallelismFactor: result.parallelismFactor,
      };
    } catch (err) {
      this._logger.warn?.(`[CriticalPath] Worker analyze failed, fallback to sync: ${err.message}`);
      return this.analyze(roles);
    }
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 内部算法 / Internal Algorithm
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  /**
   * 标准化角色数据
   * Normalize role input data
   *
   * @private
   * @param {RoleInput[]} roles
   * @returns {Map<string, Object>} 标准化后的角色 Map
   */
  _normalizeRoles(roles) {
    const normalized = new Map();

    for (const role of roles) {
      const name = role.name;
      if (!name) {
        throw new Error('角色必须有名称 / Role must have a name');
      }
      if (normalized.has(name)) {
        throw new Error(`角色名称重复 / Duplicate role name: ${name}`);
      }

      normalized.set(name, {
        name,
        duration: Math.max(0, role.duration || 0),
        dependencies: role.dependencies || role.dependsOn || [],
        priority: role.priority || 0,
        ES: 0,  // 最早开始 / Earliest Start
        EF: 0,  // 最早完成 / Earliest Finish
        LS: 0,  // 最晚开始 / Latest Start
        LF: 0,  // 最晚完成 / Latest Finish
        slack: 0,
        isCritical: false,
      });
    }

    // 验证依赖存在性 / Validate dependency references
    for (const [name, role] of normalized) {
      for (const dep of role.dependencies) {
        if (!normalized.has(dep)) {
          this._logger.warn?.(
            `[CriticalPath] 角色 "${name}" 依赖不存在的角色 "${dep}", 忽略 / ` +
            `Role "${name}" depends on non-existent role "${dep}", ignoring`,
          );
        }
      }
      // 过滤掉不存在的依赖 / Filter out non-existent deps
      role.dependencies = role.dependencies.filter((dep) => normalized.has(dep));
    }

    return normalized;
  }

  /**
   * Kahn 拓扑排序
   * Kahn's topological sort
   *
   * @private
   * @param {Map<string, Object>} roles
   * @returns {string[]} 拓扑排序后的角色名序列
   * @throws {Error} 检测到循环依赖
   */
  _topologicalSort(roles) {
    const inDegree = new Map();
    const adjacency = new Map();

    for (const [name] of roles) {
      inDegree.set(name, 0);
      adjacency.set(name, []);
    }

    for (const [name, role] of roles) {
      for (const dep of role.dependencies) {
        adjacency.get(dep).push(name);
        inDegree.set(name, (inDegree.get(name) || 0) + 1);
      }
    }

    const queue = [];
    for (const [name, deg] of inDegree) {
      if (deg === 0) queue.push(name);
    }

    const sorted = [];
    while (queue.length > 0) {
      const current = queue.shift();
      sorted.push(current);

      for (const neighbor of (adjacency.get(current) || [])) {
        const newDeg = (inDegree.get(neighbor) || 1) - 1;
        inDegree.set(neighbor, newDeg);
        if (newDeg === 0) queue.push(neighbor);
      }
    }

    if (sorted.length < roles.size) {
      const cycleNodes = [...roles.keys()].filter(
        (name) => (inDegree.get(name) || 0) > 0,
      );
      throw new Error(
        `检测到循环依赖 / Cycle detected among roles: [${cycleNodes.join(', ')}]`,
      );
    }

    return sorted;
  }

  /**
   * 前向遍历: 计算 ES 和 EF
   * Forward pass: compute Earliest Start and Earliest Finish
   *
   * ES = max(EF of all predecessors), 起始节点 ES=0
   * EF = ES + duration
   *
   * @private
   * @param {string[]} sortedNames - 拓扑排序后的名称
   * @param {Map<string, Object>} roles
   */
  _forwardPass(sortedNames, roles) {
    for (const name of sortedNames) {
      const role = roles.get(name);

      // ES = 所有前驱 EF 的最大值 / ES = max EF of all predecessors
      let es = 0;
      for (const dep of role.dependencies) {
        const depRole = roles.get(dep);
        if (depRole && depRole.EF > es) {
          es = depRole.EF;
        }
      }

      role.ES = es;
      role.EF = es + role.duration;
    }

    // 总工期 = 所有 EF 的最大值 / Total duration = max EF
    this._totalDuration = 0;
    for (const role of roles.values()) {
      if (role.EF > this._totalDuration) {
        this._totalDuration = role.EF;
      }
    }
  }

  /**
   * 后向遍历: 计算 LS 和 LF
   * Backward pass: compute Latest Start and Latest Finish
   *
   * LF = min(LS of all successors), 终端节点 LF=总工期
   * LS = LF - duration
   *
   * @private
   * @param {string[]} sortedNames - 拓扑排序后的名称
   * @param {Map<string, Object>} roles
   */
  _backwardPass(sortedNames, roles) {
    // 构建后继表 / Build successor map
    const successors = new Map();
    for (const name of sortedNames) {
      successors.set(name, []);
    }
    for (const [name, role] of roles) {
      for (const dep of role.dependencies) {
        successors.get(dep).push(name);
      }
    }

    // 初始化: 所有终端节点 LF = 总工期 / Init: all terminal nodes LF = totalDuration
    for (const name of sortedNames) {
      const succs = successors.get(name);
      if (!succs || succs.length === 0) {
        roles.get(name).LF = this._totalDuration;
      }
    }

    // 反向遍历 / Reverse traversal
    for (let i = sortedNames.length - 1; i >= 0; i--) {
      const name = sortedNames[i];
      const role = roles.get(name);
      const succs = successors.get(name) || [];

      if (succs.length > 0) {
        // LF = min(LS of all successors) / LF = 所有后继 LS 的最小值
        let lf = Infinity;
        for (const succName of succs) {
          const succRole = roles.get(succName);
          if (succRole.LS < lf) {
            lf = succRole.LS;
          }
        }
        role.LF = lf;
      }

      role.LS = role.LF - role.duration;
    }
  }

  /**
   * 计算松弛时间, 标记关键路径节点
   * Compute slack time and mark critical path nodes
   *
   * Slack = LS - ES (或 LF - EF, 二者相等)
   * Slack = 0 的节点在关键路径上
   *
   * @private
   * @param {Map<string, Object>} roles
   */
  _computeSlack(roles) {
    for (const [name, role] of roles) {
      role.slack = role.LS - role.ES;
      role.isCritical = Math.abs(role.slack) < 0.001; // 浮点容差 / Float tolerance

      // 存入分析结果 / Store in analysis cache
      this._roleAnalysis.set(name, {
        name: role.name,
        duration: role.duration,
        dependencies: [...role.dependencies],
        ES: role.ES,
        EF: role.EF,
        LS: role.LS,
        LF: role.LF,
        slack: role.slack,
        isCritical: role.isCritical,
      });
    }
  }

  /**
   * 提取关键路径序列 (按拓扑顺序)
   * Extract critical path sequence (in topological order)
   *
   * @private
   * @param {string[]} sortedNames
   * @param {Map<string, Object>} roles
   */
  _extractCriticalPath(sortedNames, roles) {
    this._criticalPath = sortedNames.filter((name) => {
      const role = roles.get(name);
      return role && role.isCritical;
    });
  }
}
