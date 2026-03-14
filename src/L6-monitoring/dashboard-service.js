/**
 * DashboardService -- 仪表板服务 / Dashboard Service
 *
 * V5.0 L6 监控层: 提供 HTTP REST API + SSE 流式推送的仪表板服务。
 * V5.0 L6 Monitoring Layer: provides HTTP REST API + SSE streaming dashboard.
 *
 * 路由 / Routes:
 * - GET /                       → V1 静态 HTML 仪表板 / V1 Static HTML dashboard
 * - GET /v2                     → V2 蜂巢可视化仪表板 / V2 Hive visualization dashboard
 * - GET /api/metrics            → 当前指标快照 / Current metrics snapshot
 * - GET /api/stats              → 系统统计 / System stats
 * - GET /events                 → SSE 事件流 / SSE event stream
 * - GET /api/v1/traces/:traceId → 追踪查询 (V5.1) / Trace query
 * - GET /api/v1/topology        → 力导向拓扑数据 (V5.1) / Topology data
 * - GET /api/v1/affinity        → 任务亲和度矩阵 (V5.1) / Task affinity matrix
 * - GET /api/v1/dead-letters    → 死信队列 (V5.1) / Dead letter queue
 * - GET /api/v1/context-debug   → 上下文调试 (V5.2) / Context debug info
 * - GET /api/v1/breaker-status  → 断路器状态 (V5.2) / Circuit breaker status
 * - GET /api/v1/trace-spans     → 追踪 spans (V5.2) / Trace spans
 * - GET /api/v1/startup-summary → 启动摘要 (V5.2) / Startup summary
 * - GET /api/v1/governance       → 治理三联指标 (V5.5) / Governance triple metrics
 * - GET /api/v1/convergence      → 状态收敛统计 (V5.5) / State convergence stats
 * - GET /api/v1/modulator        → 全局调节器状态 (V5.5) / Global modulator state
 * - GET /api/v1/diagnostics      → 启动诊断报告 (V5.5) / Startup diagnostics report
 * - GET /api/v1/workers           → Worker 线程池状态 (V6.0)
 * - GET /api/v1/vectors           → 向量索引统计 (V6.0)
 * - GET /api/v1/sna               → SNA 网络指标 (V6.0)
 * - GET /api/v1/shapley           → Shapley 信用分配 (V6.0)
 * - GET /api/v1/dual-process      → 双过程路由统计 (V6.0)
 * - GET /api/v1/failure-modes     → 失败模式统计 (V6.0)
 * - GET /api/v1/budget-forecast   → 预算预测 (V6.0)
 * - GET /api/v1/quality-audit     → 质量审计链 (V6.0)
 * - GET /api/v1/agent-states      → Agent 状态机 (V6.0)
 * - GET /api/v1/ipc-stats         → IPC 延迟统计 (V6.0)
 * - GET /api/v1/trace-analysis    → Trace 延迟分析 (V6.0)
 * - GET /api/v1/active-sessions   → 实时活跃会话 (V7.0)
 * - GET /api/v1/session/:key/status → 单个会话状态 (V7.0)
 * - GET /api/v1/negative-selection → 负选择检测器 (V7.0)
 * - GET /api/v1/signal-weights    → 信号权重 (V7.0 Console)
 * - GET /api/v1/pi-controller     → PI 控制器状态 (V7.0 Console)
 * - GET /api/v1/abc-roles         → ABC 角色分布 (V7.0 Console)
 * - GET /api/v1/species-config    → 种群配置 (V7.0 Console)
 * - GET /api/v1/cold-start        → 冷启动进度 (V7.0 Console)
 * - GET /api/v1/bid-history       → 竞标统计 (V7.0 Console)
 * - GET /api/v1/speculations      → 推测执行统计 (V7.0 Console)
 * - GET /api/v1/distillation      → 知识蒸馏记录 (V7.0 Console)
 * - GET /api/v1/board             → Stigmergic 公告板 (V7.0 Console)
 * - GET /api/v1/budget-degradation → 预算降级建议 (V7.0 Console)
 * - GET /v6/*                     → V6 组件化仪表板静态文件 (V6.0)
 * - GET /v6/console               → V7.0 蜂群控制台 SPA / V7.0 Swarm Console SPA
 * - GET /v6/console/*             → V7.0 蜂群控制台静态文件 / V7.0 Console static files
 *
 * 注意: Fastify 为可选依赖, 不可用时服务优雅降级。
 * Note: Fastify is optional; service degrades gracefully if unavailable.
 *
 * @module L6-monitoring/dashboard-service
 * @author DEEP-IOS
 */

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

// ============================================================================
// 常量 / Constants
// ============================================================================

/** 默认端口 / Default port */
const DEFAULT_PORT = 19100;

// ============================================================================
// DashboardService 类 / DashboardService Class
// ============================================================================

export class DashboardService {
  /**
   * @param {Object} deps
   * @param {import('./state-broadcaster.js').StateBroadcaster} deps.stateBroadcaster
   * @param {import('./metrics-collector.js').MetricsCollector} deps.metricsCollector
   * @param {import('../L2-communication/message-bus.js').MessageBus} [deps.messageBus]
   * @param {Object} [deps.logger]
   * @param {number} [deps.port=19100]
   * @param {Object} [deps.db] - better-sqlite3 database instance for V5.1 queries
   */
  constructor({ stateBroadcaster, metricsCollector, messageBus, logger, port, db, toolResilience, startupSummary, governanceMetrics, stateConvergence, globalModulator, swarmAdvisor, startupDiagnosticsReport,
    // V6.0 dependencies
    swarmCore, workerPool, snaAnalyzer, shapleyCredit, dualProcessRouter, failureModeAnalyzer, budgetForecaster, qualityController, vectorIndex, embeddingEngine, ipcBridge,
    // V7.0: 全引擎引用 — 用于 V5.6/V7.0 端点访问 dagEngine/relayClient 等模块
    // V7.0: Full engines reference — used by V5.6/V7.0 endpoints to access dagEngine/relayClient etc.
    engines,
  } = {}) {
    this._broadcaster = stateBroadcaster;
    this._metrics = metricsCollector;
    this._messageBus = messageBus || null;
    this._logger = logger || console;
    this._port = port || DEFAULT_PORT;
    /** @type {Object | null} SQLite DB for V5.1 API queries */
    this._db = db || null;
    /** @type {Object | null} V5.2: ToolResilience for breaker status */
    this._toolResilience = toolResilience || null;
    /** @type {Object | null} V5.2: Startup summary cache */
    this._startupSummary = startupSummary || null;
    /** @type {Object | null} V5.5: GovernanceMetrics instance */
    this._governanceMetrics = governanceMetrics || null;
    /** @type {Object | null} V5.5: StateConvergence instance */
    this._stateConvergence = stateConvergence || null;
    /** @type {Object | null} V5.5: GlobalModulator instance */
    this._globalModulator = globalModulator || null;
    /** @type {Object | null} V5.5: SwarmAdvisor instance */
    this._swarmAdvisor = swarmAdvisor || null;
    /** @type {Object | null} V5.5: Startup diagnostics report */
    this._diagnosticsReport = startupDiagnosticsReport || null;

    // V6.0 dependencies
    /** @type {Object | null} */
    this._swarmCore = swarmCore || null;
    /** @type {Object | null} */
    this._workerPool = workerPool || null;
    /** @type {Object | null} */
    this._snaAnalyzer = snaAnalyzer || null;
    /** @type {Object | null} */
    this._shapleyCredit = shapleyCredit || null;
    /** @type {Object | null} */
    this._dualProcessRouter = dualProcessRouter || null;
    /** @type {Object | null} */
    this._failureModeAnalyzer = failureModeAnalyzer || null;
    /** @type {Object | null} */
    this._budgetForecaster = budgetForecaster || null;
    /** @type {Object | null} */
    this._qualityController = qualityController || null;
    /** @type {Object | null} */
    this._vectorIndex = vectorIndex || null;
    /** @type {Object | null} */
    this._embeddingEngine = embeddingEngine || null;
    /** @type {Object | null} */
    this._ipcBridge = ipcBridge || null;

    // V7.0: 全引擎引用 — V5.6/V7.0 端点需要访问 dagEngine, relayClient, speculativeExecutor 等
    // V7.0: Full engines reference — V5.6/V7.0 endpoints need dagEngine, relayClient, speculativeExecutor etc.
    /** @type {Object | null} */
    this._engines = engines || null;

    /** @type {Object | null} Fastify 实例 / Fastify instance */
    this._server = null;

    /** @type {boolean} */
    this._running = false;
  }

  // ━━━ 生命周期 / Lifecycle ━━━

  /**
   * 启动 HTTP 服务器
   * Start HTTP server
   *
   * 如果 Fastify 不可用, 优雅地跳过。
   * If Fastify is unavailable, gracefully skip.
   */
  async start() {
    if (this._running) return;

    // 动态导入 Fastify / Dynamic import Fastify
    let Fastify;
    try {
      const mod = await import('fastify');
      Fastify = mod.default || mod.fastify || mod;
    } catch {
      this._logger.warn?.('[DashboardService] Fastify 不可用, 仪表板已禁用 / Fastify unavailable, dashboard disabled');
      return;
    }

    try {
      this._server = Fastify({ logger: false });
      this._registerRoutes();
      await this._server.listen({ port: this._port, host: '0.0.0.0' });
      this._running = true;
      this._logger.info?.(`[DashboardService] 仪表板已启动 / Dashboard started on port ${this._port}`);
    } catch (err) {
      this._logger.error?.(`[DashboardService] 启动失败 / Start failed: ${err.message}`);
      this._server = null;
    }
  }

  /**
   * 停止 HTTP 服务器
   * Stop HTTP server
   */
  async stop() {
    if (!this._running || !this._server) return;

    // V7.2 S5.1: 销毁 StateBroadcaster 清理 SSE 连接 / Destroy broadcaster to clean SSE connections
    try {
      this._broadcaster?.destroy?.();
    } catch { /* non-fatal */ }

    try {
      await this._server.close();
    } catch (err) {
      this._logger.warn?.(`[DashboardService] 关闭错误 / Close error: ${err.message}`);
    }

    this._server = null;
    this._running = false;
    this._logger.info?.('[DashboardService] 仪表板已停止 / Dashboard stopped');
  }

  /**
   * 获取端口号
   * Get port number
   *
   * @returns {number}
   */
  getPort() {
    return this._port;
  }

  /**
   * 检查是否运行中
   * Check if running
   *
   * @returns {boolean}
   */
  isRunning() {
    return this._running;
  }

  // ━━━ 内部路由注册 / Internal Route Registration ━━━

  /**
   * 注册所有路由
   * Register all routes
   *
   * @private
   */
  _registerRoutes() {
    const server = this._server;

    // GET / → 静态 HTML 仪表板 / Static HTML dashboard
    server.get('/', (req, reply) => {
      try {
        const __dirname = dirname(fileURLToPath(import.meta.url));
        const html = readFileSync(join(__dirname, 'dashboard.html'), 'utf-8');
        reply.type('text/html').send(html);
      } catch {
        reply.type('text/html').send('<h1>Claw-Swarm V5.0 Dashboard</h1><p>dashboard.html not found</p>');
      }
    });

    // GET /v2 → V2 蜂巢可视化仪表板 / V2 Hive visualization dashboard
    server.get('/v2', (req, reply) => {
      try {
        const __dirname = dirname(fileURLToPath(import.meta.url));
        const html = readFileSync(join(__dirname, 'dashboard-v2.html'), 'utf-8');
        reply.type('text/html').send(html);
      } catch {
        reply.type('text/html').send('<h1>Claw-Swarm V5.1 Dashboard V2</h1><p>dashboard-v2.html not found</p>');
      }
    });

    // GET /api/metrics → 指标快照 / Metrics snapshot
    server.get('/api/metrics', (req, reply) => {
      const snapshot = this._metrics.getSnapshot();
      // O1: 附加 hook 触发统计
      const hookStats = this._metrics.getHookStats?.() || null;
      reply.send(hookStats ? { ...snapshot, hookStats } : snapshot);
    });

    // GET /api/stats → 系统统计 / System stats
    server.get('/api/stats', (req, reply) => {
      reply.send({
        broadcaster: this._broadcaster.getStats(),
        metrics: this._metrics.getStats(),
      });
    });

    // GET /events → SSE 流 / SSE stream
    server.get('/events', (req, reply) => {
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      });

      // 注册 SSE 客户端 / Register SSE client
      // 使用无名事件 (data-only), topic 嵌入 JSON, 让前端 onmessage 统一路由
      // Use unnamed events (data-only), embed topic in JSON for frontend routing
      const client = {
        send(event) {
          const payload = JSON.stringify({
            topic: event.event,
            data: event.data,
            timestamp: event.timestamp,
          });
          reply.raw.write(`data: ${payload}\n\n`);
        },
      };

      const remove = this._broadcaster.addClient(client);

      // 客户端断开时移除 / Remove on disconnect
      req.raw.on('close', () => {
        remove();
      });
    });

    // ━━━ V5.1 REST API 端点 / V5.1 REST API Endpoints ━━━

    // GET /api/v1/traces/:traceId → 分布式追踪查询 / Distributed trace query
    server.get('/api/v1/traces/:traceId', (req, reply) => {
      const { traceId } = req.params;
      if (!traceId) {
        return reply.status(400).send({ error: 'traceId is required' });
      }
      // V5.2: 从 span 存储查询完整追踪树。当前返回空 span 列表（追踪收集在 V5.2 激活）
      // V5.2: Query full span tree from span storage. Currently returns empty (trace collection activates in V5.2)
      const snapshot = this._metrics.getSnapshot();
      reply.send({
        traceId,
        spans: [],
        summary: {
          totalSpans: 0,
          agents: snapshot.agents?.length || 0,
          note: 'Trace collection will be activated in V5.2',
        },
      });
    });

    // GET /api/v1/topology → 力导向拓扑数据 / Force-directed topology data
    server.get('/api/v1/topology', (req, reply) => {
      const snapshot = this._metrics.getSnapshot();
      const agents = snapshot.agents || [];
      const pheromones = snapshot.pheromones || [];

      // 构建节点+边 / Build nodes + edges
      const nodes = agents.map(a => ({
        id: a.agentId || a.id,
        role: a.role,
        status: a.status || 'unknown',
        score: a.score || 0,
      }));

      const edges = [];
      for (const p of pheromones) {
        if (p.intensity > 0.1 && p.sourceId && p.targetScope) {
          edges.push({
            source: p.sourceId,
            target: p.targetScope,
            type: p.type,
            intensity: p.intensity,
          });
        }
      }

      reply.send({ nodes, edges, timestamp: Date.now() });
    });

    // GET /api/v1/affinity → 任务亲和度矩阵 / Task affinity matrix
    server.get('/api/v1/affinity', (req, reply) => {
      if (!this._db) {
        return reply.send({ matrix: [], note: 'Database not available' });
      }
      try {
        const rows = this._db.prepare(
          'SELECT agent_id, task_type, affinity, total_tasks, successes FROM task_affinity ORDER BY agent_id, affinity DESC'
        ).all();
        reply.send({ matrix: rows, timestamp: Date.now() });
      } catch {
        reply.send({ matrix: [], note: 'task_affinity table not yet populated' });
      }
    });

    // GET /api/v1/dead-letters → 死信队列查询 / Dead letter queue query
    server.get('/api/v1/dead-letters', (req, reply) => {
      if (!this._db) {
        return reply.send({ entries: [], total: 0, note: 'Database not available' });
      }
      try {
        const limit = Math.min(parseInt(req.query.limit) || 50, 200);
        const rows = this._db.prepare(
          'SELECT * FROM dead_letter_tasks ORDER BY created_at DESC LIMIT ?'
        ).all(limit);
        const total = this._db.prepare('SELECT COUNT(*) as count FROM dead_letter_tasks').get();
        reply.send({ entries: rows, total: total?.count || 0, timestamp: Date.now() });
      } catch {
        reply.send({ entries: [], total: 0, note: 'dead_letter_tasks table not yet populated' });
      }
    });

    // ━━━ V5.2 REST API 端点 / V5.2 REST API Endpoints ━━━

    // GET /api/v1/context-debug → 上下文调试（脱敏）/ Context debug (sanitized, V5.5 enhanced)
    server.get('/api/v1/context-debug', (req, reply) => {
      const snapshot = this._metrics.getSnapshot();
      // 仅返回结构信息，不泄露实际文本 / Return structure only, no actual text
      const result = {
        agents: (snapshot.agents || []).map(a => ({
          id: a.agentId || a.id,
          role: a.role,
          status: a.status,
        })),
        pheromones: {
          count: (snapshot.pheromones || []).length,
          types: [...new Set((snapshot.pheromones || []).map(p => p.type))],
          avgIntensity: (snapshot.pheromones || []).length > 0
            ? (snapshot.pheromones || []).reduce((s, p) => s + (p.intensity || 0), 0) / snapshot.pheromones.length
            : 0,
        },
        memory: {
          note: 'Token counts and segment lengths — no actual content exposed',
        },
        timestamp: Date.now(),
      };

      // V5.5: 增强调试信息 / Enhanced debug info
      if (this._swarmAdvisor) {
        try {
          const turns = this._swarmAdvisor._turns;
          result.swarmAdvisor = {
            activeTurns: turns ? turns.size : 0,
            currentMode: this._swarmAdvisor.getCurrentMode?.() || 'unknown',
          };
        } catch { /* non-critical */ }
      }

      if (this._globalModulator) {
        try {
          result.globalModulator = {
            currentMode: this._globalModulator.getCurrentMode(),
            factors: this._globalModulator.getModulationFactors(),
          };
        } catch { /* non-critical */ }
      }

      reply.send(result);
    });

    // GET /api/v1/breaker-status → 断路器状态 / Circuit breaker status
    server.get('/api/v1/breaker-status', (req, reply) => {
      const toolResilience = this._engines?.toolResilience || this._toolResilience;
      if (!toolResilience) {
        return reply.send({ breakers: {}, note: 'ToolResilience not available' });
      }
      try {
        const states = toolResilience.getCircuitBreakerStates();
        reply.send({ breakers: states, timestamp: Date.now() });
      } catch {
        reply.send({ breakers: {}, note: 'Error reading breaker states' });
      }
    });

    // GET /api/v1/trace-spans → 追踪 spans 查询 / Trace spans query
    server.get('/api/v1/trace-spans', (req, reply) => {
      if (!this._db) {
        return reply.send({ spans: [], note: 'Database not available' });
      }
      try {
        const limit = Math.min(parseInt(req.query.limit) || 50, 200);
        const traceId = req.query.traceId;
        let rows;
        if (traceId) {
          rows = this._db.prepare(
            'SELECT * FROM trace_spans WHERE trace_id = ? ORDER BY start_time DESC LIMIT ?'
          ).all(traceId, limit);
        } else {
          rows = this._db.prepare(
            'SELECT * FROM trace_spans ORDER BY start_time DESC LIMIT ?'
          ).all(limit);
        }
        reply.send({ spans: rows, timestamp: Date.now() });
      } catch {
        reply.send({ spans: [], note: 'trace_spans table not yet populated' });
      }
    });

    // GET /api/v1/startup-summary → 启动摘要 / Startup summary
    server.get('/api/v1/startup-summary', (req, reply) => {
      reply.send({
        summary: this._startupSummary || { note: 'No startup summary available' },
        timestamp: Date.now(),
      });
    });

    // ━━━ V5.5 REST API 端点 / V5.5 REST API Endpoints ━━━

    // GET /api/v1/governance → 治理三联指标 / Governance triple metrics
    server.get('/api/v1/governance', (req, reply) => {
      // O3: 附加 LLM 合规率统计
      const core = this._engines?.swarmCore || this._swarmCore;
      const compliant = core?._compliantTurns || 0;
      const nonCompliant = core?._nonCompliantTurns || 0;
      const total = compliant + nonCompliant;
      const complianceStats = {
        compliantTurns: compliant,
        nonCompliantTurns: nonCompliant,
        complianceRate: total > 0 ? Math.round(compliant / total * 10000) / 10000 : null,
        escalationLevel: core?._complianceEscalation || 0,
      };

      if (!this._governanceMetrics) {
        return reply.send({ complianceStats, note: 'GovernanceMetrics not available', timestamp: Date.now() });
      }
      try {
        reply.send({
          governance: this._governanceMetrics.getGovernanceSummary(),
          complianceStats,
          timestamp: Date.now(),
        });
      } catch {
        reply.send({ complianceStats, note: 'Error reading governance metrics', timestamp: Date.now() });
      }
    });

    // O2: GET /api/v1/last-inject → 最后一次 prompt 注入内容调试快照
    server.get('/api/v1/last-inject', (req, reply) => {
      const core = this._engines?.swarmCore || this._swarmCore;
      reply.send(core?._lastInjectDebug || { note: 'No inject data yet', timestamp: Date.now() });
    });

    // O4+O5: GET /api/v1/subagent-stats → 子代理成功/失败率 + chat.inject 重试追踪
    server.get('/api/v1/subagent-stats', (req, reply) => {
      const core = this._engines?.swarmCore || this._swarmCore;
      const spawned = core?._subagentSpawned || 0;
      reply.send({
        spawned,
        succeeded: core?._subagentSucceeded || 0,
        failed: core?._subagentFailed || 0,
        crashed: core?._subagentCrashed || 0,
        successRate: spawned > 0 ? Math.round(core._subagentSucceeded / spawned * 10000) / 10000 : null,
        injectAttempts: core?._injectAttempts || 0,
        injectSuccesses: core?._injectSuccesses || 0,
        injectFailures: core?._injectFailures || 0,
        timestamp: Date.now(),
      });
    });

    // GET /api/v1/convergence → 状态收敛统计 / State convergence stats
    server.get('/api/v1/convergence', (req, reply) => {
      if (!this._stateConvergence) {
        return reply.send({ note: 'StateConvergence not available', timestamp: Date.now() });
      }
      try {
        reply.send({
          convergence: this._stateConvergence.getConvergenceStats(),
          suspects: this._stateConvergence.getSuspects(),
          deadAgents: this._stateConvergence.getDeadAgents(),
          timestamp: Date.now(),
        });
      } catch {
        reply.send({ note: 'Error reading convergence stats', timestamp: Date.now() });
      }
    });

    // GET /api/v1/modulator → 全局调节器状态 / Global modulator state
    server.get('/api/v1/modulator', (req, reply) => {
      const gm = this._engines?.globalModulator || this._globalModulator;
      if (!gm) {
        return reply.send({ note: 'GlobalModulator not available', timestamp: Date.now() });
      }
      try {
        reply.send({
          modulator: gm.getStats(),
          timestamp: Date.now(),
        });
      } catch {
        reply.send({ note: 'Error reading modulator state', timestamp: Date.now() });
      }
    });

    // GET /api/v1/diagnostics → 启动诊断报告 / Startup diagnostics report
    server.get('/api/v1/diagnostics', (req, reply) => {
      reply.send({
        diagnostics: this._diagnosticsReport || { note: 'No diagnostics report available' },
        timestamp: Date.now(),
      });
    });

    // V5.6: GET /api/v1/dag-status → DAG 执行快照 / DAG execution snapshot
    server.get('/api/v1/dag-status', (req, reply) => {
      const dagEngine = this._engines?.dagEngine;
      if (!dagEngine) {
        return reply.send({ note: 'DAGEngine not available', timestamp: Date.now() });
      }
      try {
        const dags = [];
        for (const [dagId, dag] of dagEngine._activeDags || []) {
          const nodes = [];
          for (const [nodeId, node] of dag.nodes || []) {
            nodes.push({
              id: nodeId,
              state: node.state,
              assignedAgent: node.assignedAgent,
              isCritical: node.isCritical,
              slack: node.slack,
            });
          }
          dags.push({ dagId, status: dag.status, nodeCount: nodes.length, nodes });
        }
        reply.send({ dags, dagCount: dags.length, timestamp: Date.now() });
      } catch {
        reply.send({ note: 'Error reading DAG status', timestamp: Date.now() });
      }
    });

    // V5.6: GET /api/v1/speculation → 推测执行统计 / Speculation statistics
    server.get('/api/v1/speculation', (req, reply) => {
      const specExec = this._engines?.speculativeExecutor;
      if (!specExec) {
        return reply.send({ note: 'SpeculativeExecutor not available', timestamp: Date.now() });
      }
      try {
        reply.send({ speculation: specExec.getStats(), timestamp: Date.now() });
      } catch {
        reply.send({ note: 'Error reading speculation stats', timestamp: Date.now() });
      }
    });

    // ━━━ V6.0 REST API 端点 / V6.0 REST API Endpoints ━━━

    // GET /api/v1/workers → Worker 线程池状态 / Worker thread pool status
    server.get('/api/v1/workers', (req, reply) => {
      // V7.2 B3.4: engines-first fallback
      const wp = this._engines?.workerPool || this._workerPool;
      if (!wp) {
        return reply.send({ note: 'WorkerPool not available', timestamp: Date.now() });
      }
      try {
        reply.send({ stats: wp.getStats(), timestamp: Date.now() });
      } catch {
        reply.send({ note: 'Error reading worker pool stats', timestamp: Date.now() });
      }
    });

    // GET /api/v1/vectors → 向量索引统计 / Vector index statistics
    server.get('/api/v1/vectors', (req, reply) => {
      const result = { timestamp: Date.now() };
      try {
        if (this._vectorIndex) {
          result.indexSize = this._vectorIndex.size?.() || 0;
          result.dimensions = this._vectorIndex.getDimensions?.() || 0;
          result.useHNSW = this._vectorIndex._useHNSW || false;
        }
        if (this._embeddingEngine) {
          result.mode = this._embeddingEngine._config?.mode || 'local';
          result.queryCount = this._embeddingEngine._queryCount || 0;
        }
      } catch { /* non-critical */ }
      reply.send(result);
    });

    // GET /api/v1/sna → SNA 网络指标 + 边列表 / SNA network metrics + edges
    // V7.2 P3.1: 5s 缓存避免频繁 compute() / 5s cache to avoid frequent compute()
    let _snaCache = null;
    let _snaCacheAt = 0;
    server.get('/api/v1/sna', (req, reply) => {
      const sna = this._engines?.snaAnalyzer || this._snaAnalyzer;
      if (!sna) {
        return reply.send({ note: 'SNAAnalyzer not available', edges: [], timestamp: Date.now() });
      }
      // 5s 内复用缓存 / Reuse cache within 5s
      if (_snaCache && (Date.now() - _snaCacheAt) < 5000) {
        return reply.send({ ..._snaCache, timestamp: Date.now() });
      }
      try {
        const stats = sna.getNetworkStats();
        const metrics = sna.compute();

        // 导出边列表供前端网络视图使用 / Export edges for frontend network view
        const edges = [];
        for (const [key, data] of sna._edges || []) {
          const parts = key.split(':');
          if (parts.length === 2) {
            edges.push({ source: parts[0], target: parts[1], weight: data?.weight || 1, type: data?.type || 'collaboration' });
          }
        }

        const result = {
          ...stats,
          metrics: metrics ? Object.fromEntries([...metrics].map(([k, v]) => [k, v])) : {},
          edges,
        };
        _snaCache = result;
        _snaCacheAt = Date.now();
        reply.send({ ...result, timestamp: Date.now() });
      } catch {
        reply.send({ note: 'Error computing SNA metrics', edges: [], timestamp: Date.now() });
      }
    });

    // GET /api/v1/shapley → Shapley 信用分配 / Shapley credit attribution
    server.get('/api/v1/shapley', (req, reply) => {
      const sc = this._engines?.shapleyCredit || this._shapleyCredit;
      if (!sc) {
        return reply.send({ note: 'ShapleyCredit not available', timestamp: Date.now() });
      }
      try {
        const history = sc.getHistory({ limit: 1 });
        if (history.length > 0) {
          const latest = history[0];
          const allForDag = sc.getHistory({ dagId: latest.dag_id });
          const credits = {};
          for (const row of allForDag) credits[row.agent_id] = row.credit;
          reply.send({ dagId: latest.dag_id, credits, timestamp: Date.now() });
        } else {
          reply.send({ credits: {}, note: 'No Shapley data yet', timestamp: Date.now() });
        }
      } catch {
        reply.send({ note: 'Error reading Shapley credits', timestamp: Date.now() });
      }
    });

    // GET /api/v1/dual-process → 双过程路由统计 / Dual-process routing stats
    server.get('/api/v1/dual-process', (req, reply) => {
      const dpr = this._engines?.dualProcessRouter || this._dualProcessRouter;
      if (!dpr) {
        return reply.send({ note: 'DualProcessRouter not available', timestamp: Date.now() });
      }
      try {
        reply.send({ stats: dpr.getStats(), timestamp: Date.now() });
      } catch {
        reply.send({ note: 'Error reading dual-process stats', timestamp: Date.now() });
      }
    });

    // GET /api/v1/failure-modes → 失败模式统计 / Failure mode statistics
    server.get('/api/v1/failure-modes', (req, reply) => {
      const fma = this._engines?.failureModeAnalyzer || this._failureModeAnalyzer;
      if (!fma) {
        return reply.send({ note: 'FailureModeAnalyzer not available', timestamp: Date.now() });
      }
      try {
        const stats = fma.getStats?.() || {};
        const categories = stats.categoryCounts || {};
        const trends = {};
        for (const cat of Object.keys(categories)) {
          try {
            const t = fma.analyzeTrend?.(cat, 50);
            if (t) trends[cat] = t.trend;
          } catch { /* skip */ }
        }
        reply.send({ categories, trends, total: stats.total || 0, timestamp: Date.now() });
      } catch {
        reply.send({ note: 'Error reading failure modes', timestamp: Date.now() });
      }
    });

    // GET /api/v1/budget-forecast → 预算预测 / Budget forecast
    server.get('/api/v1/budget-forecast', (req, reply) => {
      const bf = this._engines?.budgetForecaster || this._budgetForecaster;
      if (!bf) {
        return reply.send({ note: 'BudgetForecaster not available', timestamp: Date.now() });
      }
      try {
        const forecast = bf.forecast?.() || {};
        reply.send({ forecast, timestamp: Date.now() });
      } catch {
        reply.send({ note: 'Error computing budget forecast', timestamp: Date.now() });
      }
    });

    // GET /api/v1/quality-audit → 质量审计链 / Quality audit trail
    server.get('/api/v1/quality-audit', (req, reply) => {
      // V7.2 B3.1: engines-first fallback
      const qc = this._engines?.qualityController || this._qualityController;
      if (!qc) {
        return reply.send({ entries: [], note: 'QualityController not available', timestamp: Date.now() });
      }
      try {
        const limit = Math.min(parseInt(req.query.limit) || 50, 200);
        const entries = qc.getAuditTrail?.({ limit }) || [];
        const passCount = entries.filter(e => e.verdict === 'PASS').length;
        const passRate = entries.length > 0 ? passCount / entries.length : 0;
        reply.send({ entries, totalEvaluations: entries.length, passRate, timestamp: Date.now() });
      } catch {
        reply.send({ entries: [], note: 'Error reading quality audit', timestamp: Date.now() });
      }
    });

    // GET /api/v1/agent-states → Agent 状态机 (含 ABC/声誉/能力)
    // Agent state machine (enriched with ABC role, reputation, capabilities)
    server.get('/api/v1/agent-states', (req, reply) => {
      const swarmCore = this._engines?.swarmCore || this._swarmCore;
      if (!swarmCore) {
        return reply.send({ states: {}, note: 'SwarmCore not available', timestamp: Date.now() });
      }
      try {
        const states = swarmCore.getAllAgentStates?.() || {};

        // 注入 ABC 角色 / Inject ABC roles
        const abc = this._engines?.abcScheduler;
        if (abc?._agentStates) {
          for (const [agentId, st] of abc._agentStates) {
            if (states[agentId]) states[agentId].abc = st?.role || 'employed';
          }
        }

        // 注入声誉 (映射后端→前端字段名, 0-100→0-1) / Inject reputation (mapped, scaled)
        const repLedger = this._engines?.reputationLedger;
        if (repLedger) {
          for (const agentId of Object.keys(states)) {
            try {
              const rep = repLedger.getReputation?.(agentId);
              if (rep) {
                states[agentId].reputation = {
                  quality: (rep.competence || 0) / 100,
                  speed: (rep.centrality || 0) / 100,
                  reliability: (rep.reliability || 0) / 100,
                  creativity: (rep.innovation || 0) / 100,
                  cost: (rep.influence || 0) / 100,
                  collaboration: (rep.collaboration || 0) / 100,
                };
              }
            } catch { /* non-fatal */ }
          }
        }

        // 注入能力 (映射后端→前端字段名, 0-100→0-1) / Inject capabilities (mapped, scaled)
        const capEngine = this._engines?.capabilityEngine;
        if (capEngine) {
          for (const agentId of Object.keys(states)) {
            try {
              const caps = capEngine.getCapabilityProfile?.(agentId);
              if (caps) {
                states[agentId].capabilities = {
                  coding: (caps.coding || 0) / 100,
                  review: (caps.domain || 0) / 100,
                  design: (caps.architecture || 0) / 100,
                  planning: (caps.performance || 0) / 100,
                  testing: (caps.testing || 0) / 100,
                  debug: (caps.security || 0) / 100,
                  research: (caps.documentation || 0) / 100,
                  comms: (caps.communication || 0) / 100,
                };
              }
            } catch { /* non-fatal */ }
          }
        }

        reply.send({ states, timestamp: Date.now() });
      } catch {
        reply.send({ states: {}, note: 'Error reading agent states', timestamp: Date.now() });
      }
    });

    // GET /api/v1/ipc-stats → IPC 延迟统计 / IPC latency statistics
    server.get('/api/v1/ipc-stats', (req, reply) => {
      if (!this._ipcBridge) {
        return reply.send({ note: 'IPCBridge not available', timestamp: Date.now() });
      }
      try {
        const stats = this._ipcBridge.getStats?.() || {};
        reply.send({ ...stats, timestamp: Date.now() });
      } catch {
        reply.send({ note: 'Error reading IPC stats', timestamp: Date.now() });
      }
    });

    // GET /api/v1/trace-analysis → Trace 延迟分析 / Trace latency analysis
    server.get('/api/v1/trace-analysis', (req, reply) => {
      if (!this._db) {
        return reply.send({ note: 'Database not available', timestamp: Date.now() });
      }
      try {
        const rows = this._db.prepare(
          'SELECT operation_name, duration_ms FROM trace_spans WHERE start_time > ? ORDER BY start_time DESC LIMIT 200'
        ).all(Date.now() - 3600000);
        if (rows.length === 0) {
          return reply.send({ note: 'No recent trace spans', timestamp: Date.now() });
        }
        const durations = rows.map(r => r.duration_ms || 0).sort((a, b) => a - b);
        const p50 = durations[Math.floor(durations.length * 0.5)] || 0;
        const p95 = durations[Math.floor(durations.length * 0.95)] || 0;
        const p99 = durations[Math.floor(durations.length * 0.99)] || 0;
        reply.send({ percentiles: { p50, p95, p99 }, spanCount: rows.length, timestamp: Date.now() });
      } catch {
        reply.send({ note: 'Error analyzing traces', timestamp: Date.now() });
      }
    });

    // ━━━ V6.0 组件化仪表板静态文件 / V6.0 Componentized Dashboard Static Files ━━━

    // V7.0 §11: GET /api/v1/active-sessions → 实时会话流监控
    // V7.0 §11: Active sessions real-time monitoring
    server.get('/api/v1/active-sessions', async (req, reply) => {
      const relayClient = this._engines?.relayClient;
      if (!relayClient?.listActiveSessions) {
        return reply.send({ sessions: [], error: 'relayClient not available' });
      }
      try {
        const result = await relayClient.listActiveSessions();
        reply.send(result);
      } catch (err) {
        // V7.2 B3.10: 降级返回空列表而非 500 / Graceful degradation
        reply.send({ sessions: [], error: err.message });
      }
    });

    // V7.0 §11: GET /api/v1/session/:key/status → 单个会话状态查询
    // V7.0 §11: Single session status query
    server.get('/api/v1/session/:key/status', async (req, reply) => {
      const relayClient = this._engines?.relayClient;
      if (!relayClient?.checkSession) {
        return reply.send({ error: 'relayClient not available' });
      }
      try {
        const result = await relayClient.checkSession(req.params.key);
        reply.send(result);
      } catch (err) {
        reply.status(500).send({ error: err.message });
      }
    });

    // V7.0 §27: GET /api/v1/negative-selection → 负选择检测器统计
    // V7.0 §27: Negative selection detector statistics
    server.get('/api/v1/negative-selection', (req, reply) => {
      const ns = this._engines?.negativeSelection;
      if (!ns) return reply.send({ stats: null });
      try {
        reply.send({ stats: ns.getStats() });
      } catch (err) {
        reply.status(500).send({ error: err.message });
      }
    });

    // ━━━ V7.0 Console REST API 端点 / V7.0 Console REST API Endpoints ━━━

    // GET /api/v1/signal-weights → 信号权重 / Signal calibrator weights
    server.get('/api/v1/signal-weights', (req, reply) => {
      const sc = this._engines?.signalCalibrator;
      if (!sc) return reply.send({ available: false, timestamp: Date.now() });
      try {
        const weights = sc.getWeights?.() || {};
        const phase = sc.getPhaseInfo?.() || {};
        reply.send({ weights, phase, timestamp: Date.now() });
      } catch { reply.send({ available: false, timestamp: Date.now() }); }
    });

    // GET /api/v1/pi-controller → PI 控制器状态 / PI controller stats
    server.get('/api/v1/pi-controller', (req, reply) => {
      const rt = this._engines?.responseThreshold;
      if (!rt) return reply.send({ available: false, timestamp: Date.now() });
      try {
        const stats = rt.getStats?.() || {};
        const summary = rt.getSummary?.() || [];
        reply.send({ stats, summary, timestamp: Date.now() });
      } catch { reply.send({ available: false, timestamp: Date.now() }); }
    });

    // GET /api/v1/abc-roles → ABC 角色分布 / ABC role distribution
    server.get('/api/v1/abc-roles', (req, reply) => {
      const abc = this._engines?.abcScheduler;
      if (!abc) return reply.send({ available: false, timestamp: Date.now() });
      try {
        const stats = abc.getStats?.() || {};
        // 从 _agentStates Map 实时统计角色分布 / Live count from agent states
        const live = { employed: 0, onlooker: 0, scout: 0 };
        for (const [, st] of abc._agentStates || []) {
          if (live[st?.role] !== undefined) live[st.role]++;
        }
        reply.send({ ...stats, live, timestamp: Date.now() });
      } catch { reply.send({ available: false, timestamp: Date.now() }); }
    });

    // GET /api/v1/species-config → 种群配置 / Species configuration
    server.get('/api/v1/species-config', (req, reply) => {
      const se = this._engines?.speciesEvolver;
      if (!se) return reply.send({ available: false, timestamp: Date.now() });
      try {
        // speciesEvolver 方法根据实际可用性调用
        const config = se.getSpeciesConfig?.() || se.getStats?.() || {};
        reply.send({ config, timestamp: Date.now() });
      } catch { reply.send({ available: false, timestamp: Date.now() }); }
    });

    // GET /api/v1/cold-start → 冷启动进度 / Cold start progress
    server.get('/api/v1/cold-start', (req, reply) => {
      // V7.2 B3.2: engines-first fallback
      const gm = this._engines?.globalModulator || this._globalModulator;
      if (!gm) return reply.send({ available: false, timestamp: Date.now() });
      try {
        const stats = gm.getStats?.() || {};
        reply.send({ coldStart: stats.coldStart || {}, currentMode: stats.currentMode, timestamp: Date.now() });
      } catch { reply.send({ available: false, timestamp: Date.now() }); }
    });

    // GET /api/v1/bid-history → 竞标统计 / Bid/contract statistics
    server.get('/api/v1/bid-history', (req, reply) => {
      const cn = this._engines?.contractNet;
      if (!cn) return reply.send({ available: false, timestamp: Date.now() });
      try {
        const stats = cn.getStats?.() || {};
        reply.send({ ...stats, timestamp: Date.now() });
      } catch { reply.send({ available: false, timestamp: Date.now() }); }
    });

    // GET /api/v1/speculations → 推测执行统计 / Speculation execution stats
    server.get('/api/v1/speculations', (req, reply) => {
      const se = this._engines?.speculativeExecutor;
      if (!se) return reply.send({ available: false, timestamp: Date.now() });
      try {
        reply.send({ stats: se.getStats?.() || {}, timestamp: Date.now() });
      } catch { reply.send({ available: false, timestamp: Date.now() }); }
    });

    // GET /api/v1/distillation → 知识蒸馏记录 / Knowledge distillation records
    server.get('/api/v1/distillation', (req, reply) => {
      const sm = this._engines?.semanticMemory;
      if (!sm) return reply.send({ available: false, timestamp: Date.now() });
      try {
        const results = sm.query?.('distillation', { limit: 20 }) || [];
        reply.send({ records: results, timestamp: Date.now() });
      } catch { reply.send({ available: false, timestamp: Date.now() }); }
    });

    // GET /api/v1/board → Stigmergic 公告板 / Stigmergic board contents
    server.get('/api/v1/board', (req, reply) => {
      const sb = this._engines?.stigmergicBoard;
      if (!sb) return reply.send({ available: false, timestamp: Date.now() });
      try {
        const scope = req.query.scope || 'global';
        const limit = Math.min(parseInt(req.query.limit) || 20, 100);
        const posts = sb.read?.(scope, { limit }) || [];
        reply.send({ posts, timestamp: Date.now() });
      } catch { reply.send({ available: false, timestamp: Date.now() }); }
    });

    // GET /api/v1/budget-degradation → 预算降级建议 / Budget degradation recommendation
    server.get('/api/v1/budget-degradation', (req, reply) => {
      // V7.2 B3.3: engines-first fallback
      const bf = this._engines?.budgetForecaster || this._budgetForecaster;
      if (!bf) return reply.send({ available: false, timestamp: Date.now() });
      try {
        const remaining = parseFloat(req.query.remaining) || 10000;
        const phases = parseInt(req.query.phases) || 3;
        const recommendation = bf.recommendDegradation?.(remaining, phases) || null;
        const stats = bf.getStats?.() || {};
        reply.send({ recommendation, stats, timestamp: Date.now() });
      } catch { reply.send({ available: false, timestamp: Date.now() }); }
    });

    // ━━━ V6.0 组件化仪表板静态文件 / V6.0 Componentized Dashboard Static Files ━━━

    // GET /v6 → V6 组件化仪表板 / V6 modular dashboard
    server.get('/v6', (req, reply) => {
      this._serveDashboardFile('index.html', reply);
    });

    // GET /v6/console → V7.0 蜂群控制台 SPA / V7.0 Swarm Console SPA
    server.get('/v6/console', (req, reply) => {
      this._serveConsoleFile('', reply);
    });

    // GET /v6/console/* → V7.0 蜂群控制台静态文件 / V7.0 Console static files
    server.get('/v6/console/*', (req, reply) => {
      const subPath = req.params['*'] || '';
      // 静态资源 (.js/.css/.svg 等) 直接提供, 其他回退 SPA
      // Static assets served directly, others fall back to SPA
      this._serveConsoleFile(subPath, reply);
    });

    // GET /v6/* → V6 静态文件 / V6 static files
    server.get('/v6/*', (req, reply) => {
      const subPath = req.params['*'] || '';
      this._serveDashboardFile(subPath, reply);
    });
  }

  /**
   * V6.0: 从 dashboard/ 目录提供静态文件
   * Serve static files from dashboard/ directory
   *
   * @param {string} subPath
   * @param {Object} reply
   * @private
   */
  _serveDashboardFile(subPath, reply) {
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const dashDir = join(__dirname, 'dashboard');

    // 安全: 防止目录遍历 / Security: prevent directory traversal
    const safePath = subPath.replace(/\.\./g, '').replace(/^\/+/, '');
    const filePath = join(dashDir, safePath);

    if (!filePath.startsWith(dashDir)) {
      return reply.status(403).send({ error: 'Forbidden' });
    }

    try {
      if (!existsSync(filePath)) {
        return reply.status(404).send({ error: 'Not found' });
      }

      const content = readFileSync(filePath, 'utf-8');
      const ext = extname(filePath).toLowerCase();
      const MIME_TYPES = {
        '.html': 'text/html',
        '.css': 'text/css',
        '.js': 'application/javascript',
        '.json': 'application/json',
        '.svg': 'image/svg+xml',
      };

      reply.type(MIME_TYPES[ext] || 'text/plain').send(content);
    } catch {
      reply.status(500).send({ error: 'Internal server error' });
    }
  }

  /**
   * V7.0: 从 console/dist/ 目录提供蜂群控制台 SPA
   * Serve Swarm Console SPA from console/dist/ directory
   *
   * @param {string} subPath
   * @param {Object} reply
   * @private
   */
  _serveConsoleFile(subPath, reply) {
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const consoleDir = join(__dirname, 'console', 'dist');

    // 安全: 防止目录遍历 / Security: prevent directory traversal
    const safePath = (subPath || '').replace(/\.\./g, '').replace(/^\/+/, '');
    const filePath = safePath ? join(consoleDir, safePath) : join(consoleDir, 'index.html');

    if (!filePath.startsWith(consoleDir)) {
      return reply.status(403).send({ error: 'Forbidden' });
    }

    try {
      // SPA fallback: 非静态资源路径回退到 index.html
      // SPA fallback: non-asset paths fall back to index.html
      let targetPath = filePath;
      if (!existsSync(targetPath)) {
        const ext = extname(targetPath).toLowerCase();
        if (!ext || ext === '.html') {
          targetPath = join(consoleDir, 'index.html');
        }
      }

      if (!existsSync(targetPath)) {
        return reply.status(404).send({ error: 'Console not built. Run: cd src/L6-monitoring/console && npx vite build' });
      }

      const content = readFileSync(targetPath);
      const ext = extname(targetPath).toLowerCase();
      const MIME_TYPES = {
        '.html': 'text/html; charset=utf-8',
        '.css': 'text/css',
        '.js': 'application/javascript',
        '.json': 'application/json',
        '.svg': 'image/svg+xml',
        '.png': 'image/png',
        '.ico': 'image/x-icon',
        '.woff': 'font/woff',
        '.woff2': 'font/woff2',
      };

      reply.type(MIME_TYPES[ext] || 'application/octet-stream').send(content);
    } catch {
      reply.status(500).send({ error: 'Internal server error' });
    }
  }
}
