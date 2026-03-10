/**
 * StartupDiagnostics — 启动诊断模块 / Startup Diagnostics Module
 *
 * V5.5 核心可观测性模块，将启动诊断从 index.js 内联代码抽取为独立模块。
 * V5.5 core observability module — extracts startup diagnostics from inline code.
 *
 * 诊断项 / Diagnostic items:
 * 1. DB 连通性与 schema 版本 / DB connectivity & schema version
 * 2. 空表检测 / Empty table detection
 * 3. 模块就绪状态 / Module readiness status
 * 4. Feature flags 汇总 / Feature flags summary
 * 5. 数据管道健康度 / Data pipeline health
 *
 * @module L6-monitoring/startup-diagnostics
 * @version 5.5.0
 * @author DEEP-IOS
 */

// ============================================================================
// 需要检测的核心表 / Core tables to check
// ============================================================================

const CRITICAL_TABLES = [
  'repair_memory',
  'dead_letter_tasks',
  'task_affinity',
  'trace_spans',
  'breaker_state',
];

const DATA_PIPELINE_TABLES = [
  { table: 'repair_memory', pipeline: 'strategy-feedback', description: '策略记忆回流 / Strategy memory feedback' },
  { table: 'dead_letter_tasks', pipeline: 'repair-sedimentation', description: '修复对象沉淀 / Repair object sedimentation' },
  { table: 'task_affinity', pipeline: 'environment-signal', description: '局部环境信号 / Local environment signal' },
  { table: 'trace_spans', pipeline: 'instant-observation', description: '即时观测层 / Instant observation layer' },
];

// ============================================================================
// StartupDiagnostics 类 / StartupDiagnostics Class
// ============================================================================

export class StartupDiagnostics {
  /**
   * @param {Object} deps
   * @param {Object} [deps.db] - DatabaseManager 实例
   * @param {Object} [deps.messageBus] - MessageBus 实例
   * @param {Object} [deps.logger] - Logger 实例
   */
  constructor({ db, messageBus, logger } = {}) {
    this._db = db;
    this._messageBus = messageBus;
    this._logger = logger || console;
  }

  // ============================================================================
  // DB 诊断 / DB Diagnostics
  // ============================================================================

  /**
   * 检查 DB 连通性 / Check DB connectivity
   *
   * @returns {{ connected: boolean, schemaVersion: number|null, error: string|null }}
   */
  checkDbConnectivity() {
    if (!this._db) {
      return { connected: false, schemaVersion: null, error: 'No database instance' };
    }

    try {
      const row = this._db.get('SELECT value FROM claw_meta WHERE key = ?', 'schema_version');
      const version = row ? parseInt(row.value, 10) : null;
      return { connected: true, schemaVersion: version, error: null };
    } catch (err) {
      return { connected: false, schemaVersion: null, error: err.message };
    }
  }

  /**
   * 检测空表（数据管道断裂指示器）
   * Detect empty tables (data pipeline break indicator)
   *
   * @returns {Array<{ table: string, empty: boolean, count: number }>}
   */
  detectEmptyTables() {
    if (!this._db) return [];

    const results = [];
    for (const tableName of CRITICAL_TABLES) {
      try {
        const row = this._db.get(`SELECT COUNT(*) as cnt FROM ${tableName}`);
        const count = row?.cnt ?? 0;
        results.push({ table: tableName, empty: count === 0, count });
      } catch {
        // 表不存在或查询失败
        results.push({ table: tableName, empty: true, count: 0 });
      }
    }
    return results;
  }

  // ============================================================================
  // 数据管道健康度 / Data Pipeline Health
  // ============================================================================

  /**
   * 检查数据管道活性
   * Check data pipeline liveness
   *
   * @returns {Array<{ pipeline: string, table: string, description: string, status: string, rowCount: number }>}
   */
  checkDataPipelines() {
    if (!this._db) {
      return DATA_PIPELINE_TABLES.map(p => ({
        pipeline: p.pipeline,
        table: p.table,
        description: p.description,
        status: 'no_db',
        rowCount: 0,
      }));
    }

    return DATA_PIPELINE_TABLES.map(p => {
      try {
        const row = this._db.get(`SELECT COUNT(*) as cnt FROM ${p.table}`);
        const count = row?.cnt ?? 0;
        return {
          pipeline: p.pipeline,
          table: p.table,
          description: p.description,
          status: count > 0 ? 'active' : 'empty',
          rowCount: count,
        };
      } catch {
        return {
          pipeline: p.pipeline,
          table: p.table,
          description: p.description,
          status: 'error',
          rowCount: 0,
        };
      }
    });
  }

  // ============================================================================
  // 模块就绪状态 / Module Readiness
  // ============================================================================

  /**
   * 检查模块就绪状态
   * Check module readiness status
   *
   * @param {Object} engines - 引擎实例字典
   * @returns {Array<{ module: string, ready: boolean, details: string }>}
   */
  checkModuleReadiness(engines = {}) {
    const modules = [
      { key: 'messageBus', name: 'MessageBus', required: true },
      { key: 'pheromoneEngine', name: 'PheromoneEngine', required: true },
      { key: 'capabilityEngine', name: 'CapabilityEngine', required: true },
      { key: 'gossipProtocol', name: 'GossipProtocol', required: true },
      { key: 'dbManager', name: 'DatabaseManager', required: true },
      { key: 'dagEngine', name: 'TaskDAGEngine', required: false },
      { key: 'hierarchicalCoordinator', name: 'HierarchicalCoordinator', required: false },
      { key: 'speciesEvolver', name: 'SpeciesEvolver', required: false },
      { key: 'traceCollector', name: 'TraceCollector', required: false },
    ];

    return modules.map(m => {
      const instance = engines[m.key];
      const ready = !!instance;
      const details = ready
        ? 'initialized'
        : (m.required ? 'MISSING (required)' : 'not enabled');
      return { module: m.name, ready, details };
    });
  }

  // ============================================================================
  // 汇总报告 / Summary Report
  // ============================================================================

  /**
   * 生成完整启动诊断报告
   * Generate full startup diagnostics report
   *
   * @param {Object} options
   * @param {string} options.version - 版本号
   * @param {Object} options.featureFlags - Feature flags 字典
   * @param {Object} [options.engines] - 引擎实例字典
   * @returns {Object} 诊断报告
   */
  generateReport({ version, featureFlags, engines } = {}) {
    const dbCheck = this.checkDbConnectivity();
    const emptyTables = this.detectEmptyTables();
    const pipelines = this.checkDataPipelines();
    const moduleReadiness = this.checkModuleReadiness(engines);

    const emptyCount = emptyTables.filter(t => t.empty).length;
    const activePipelines = pipelines.filter(p => p.status === 'active').length;
    const readyModules = moduleReadiness.filter(m => m.ready).length;
    const totalModules = moduleReadiness.length;

    const report = {
      version: version || 'unknown',
      pid: process.pid,
      timestamp: Date.now(),
      db: dbCheck,
      emptyTables: {
        total: emptyTables.length,
        emptyCount,
        details: emptyTables,
      },
      dataPipelines: {
        total: pipelines.length,
        active: activePipelines,
        details: pipelines,
      },
      moduleReadiness: {
        ready: readyModules,
        total: totalModules,
        details: moduleReadiness,
      },
      featureFlags: featureFlags || {},
      health: this._computeOverallHealth(dbCheck, emptyCount, activePipelines, readyModules, totalModules),

      // V5.6: 结构化编排状态 / Structured orchestration status
      structuredOrchestration: {
        dagEngine: !!engines?.dagEngine,
        speculativeExecutor: !!engines?.speculativeExecutor,
        criticalPathAnalyzer: !!engines?.criticalPathAnalyzer,
        workStealing: !!engines?.dagEngine?._config?.workStealing?.enabled,
      },
    };

    return report;
  }

  /**
   * 计算整体健康度 / Compute overall health
   *
   * @param {Object} dbCheck
   * @param {number} emptyCount
   * @param {number} activePipelines
   * @param {number} readyModules
   * @param {number} totalModules
   * @returns {{ score: number, status: string }}
   * @private
   */
  _computeOverallHealth(dbCheck, emptyCount, activePipelines, readyModules, totalModules) {
    let score = 1.0;

    // DB 不可用扣 0.3 / DB unavailable: -0.3
    if (!dbCheck.connected) score -= 0.3;

    // 每个空表扣 0.05 / Each empty table: -0.05
    score -= emptyCount * 0.05;

    // 数据管道活性加分 / Pipeline activity bonus
    score += activePipelines * 0.05;

    // 模块就绪率 / Module readiness ratio
    const readinessRatio = totalModules > 0 ? readyModules / totalModules : 1;
    if (readinessRatio < 0.5) score -= 0.2;

    score = Math.max(0, Math.min(1, score));

    let status = 'healthy';
    if (score < 0.5) status = 'degraded';
    else if (score < 0.8) status = 'warning';

    return {
      score: parseFloat(score.toFixed(2)),
      status,
    };
  }

  /**
   * 生成并发布诊断报告
   * Generate and publish diagnostics report
   *
   * @param {Object} options - 同 generateReport
   */
  publishReport(options) {
    const report = this.generateReport(options);

    // 发布到 MessageBus / Publish to MessageBus
    if (this._messageBus) {
      try {
        this._messageBus.publish?.('startup.diagnostics', {
          type: 'startup.diagnostics',
          payload: report,
          source: 'startup-diagnostics',
          timestamp: Date.now(),
        });
      } catch { /* non-critical */ }
    }

    // 日志输出 / Log output
    const health = report.health;
    const dbStatus = report.db.connected ? `v${report.db.schemaVersion}` : 'DISCONNECTED';
    this._logger.info?.(
      `[StartupDiagnostics] health=${health.status}(${health.score}) ` +
      `db=${dbStatus} ` +
      `pipelines=${report.dataPipelines.active}/${report.dataPipelines.total} ` +
      `modules=${report.moduleReadiness.ready}/${report.moduleReadiness.total} ` +
      `emptyTables=${report.emptyTables.emptyCount}`
    );

    return report;
  }
}
