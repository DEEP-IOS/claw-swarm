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
 *
 * 注意: Fastify 为可选依赖, 不可用时服务优雅降级。
 * Note: Fastify is optional; service degrades gracefully if unavailable.
 *
 * @module L6-monitoring/dashboard-service
 * @author DEEP-IOS
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
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
  constructor({ stateBroadcaster, metricsCollector, messageBus, logger, port, db, toolResilience, startupSummary }) {
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
      reply.send(this._metrics.getSnapshot());
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

    // GET /api/v1/context-debug → 上下文调试（脱敏）/ Context debug (sanitized)
    server.get('/api/v1/context-debug', (req, reply) => {
      const snapshot = this._metrics.getSnapshot();
      // 仅返回结构信息，不泄露实际文本 / Return structure only, no actual text
      reply.send({
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
      });
    });

    // GET /api/v1/breaker-status → 断路器状态 / Circuit breaker status
    server.get('/api/v1/breaker-status', (req, reply) => {
      if (!this._toolResilience) {
        return reply.send({ breakers: {}, note: 'ToolResilience not available' });
      }
      try {
        const states = this._toolResilience.getCircuitBreakerStates();
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
  }
}
