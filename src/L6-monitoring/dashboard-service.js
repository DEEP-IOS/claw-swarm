/**
 * DashboardService -- 仪表板服务 / Dashboard Service
 *
 * V5.0 L6 监控层: 提供 HTTP REST API + SSE 流式推送的仪表板服务。
 * V5.0 L6 Monitoring Layer: provides HTTP REST API + SSE streaming dashboard.
 *
 * 路由 / Routes:
 * - GET /          → 静态 HTML 仪表板 / Static HTML dashboard
 * - GET /api/metrics → 当前指标快照 / Current metrics snapshot
 * - GET /api/stats   → 系统统计 / System stats
 * - GET /events      → SSE 事件流 / SSE event stream
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
   */
  constructor({ stateBroadcaster, metricsCollector, messageBus, logger, port }) {
    this._broadcaster = stateBroadcaster;
    this._metrics = metricsCollector;
    this._messageBus = messageBus || null;
    this._logger = logger || console;
    this._port = port || DEFAULT_PORT;

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
  }
}
