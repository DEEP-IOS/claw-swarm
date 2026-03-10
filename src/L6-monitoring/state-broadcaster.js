/**
 * StateBroadcaster -- 状态广播器 / State Broadcaster
 *
 * V5.1 L6 监控层: 订阅 MessageBus 事件, 通过 SSE 广播给已注册客户端。
 * V5.1 L6 Monitoring Layer: subscribes to MessageBus events and broadcasts
 * state updates to registered SSE clients.
 *
 * V5.1 增强 / V5.1 Enhancements:
 * - 扩展主题订阅 (tool.*, capability.*, persona.*, dag.*, skill.*)
 * - SSE 心跳 (30s)
 * - 事件批处理 (100ms 窗口)
 * - SSE 敏感字段过滤
 *
 * @module L6-monitoring/state-broadcaster
 * @author DEEP-IOS
 */

import { ensureV51Format } from '../event-catalog.js';

// ============================================================================
// 常量 / Constants
// ============================================================================

/** SSE 心跳间隔 (ms) / SSE heartbeat interval */
const HEARTBEAT_INTERVAL_MS = 30000;

/** 事件批处理窗口 (ms) / Event batch window */
const BATCH_WINDOW_MS = 100;

/** SSE 转发白名单字段 / SSE forwarding whitelist fields */
const ALLOWED_FIELDS = new Set([
  'agentId', 'status', 'topic', 'timestamp', 'role', 'tier',
  'taskId', 'verdict', 'score', 'type', 'traceId', 'eventId',
  'source', '_meta', 'reason', 'dimension', 'pheromoneType',
  'operationName', 'startTime', 'duration', 'spanId', 'parentSpanId',
  // V5.2 新增 / V5.2 additions
  'breakerState', 'toolName', 'escalated', 'pressure', 'threshold',
  'postId', 'scope', 'priority', 'vaccineId', 'pattern', 'effectiveness',
  'featureFlags', 'engineStatus', 'configSummary',
]);

// ============================================================================
// StateBroadcaster 类 / StateBroadcaster Class
// ============================================================================

export class StateBroadcaster {
  /**
   * @param {Object} deps
   * @param {import('../L2-communication/message-bus.js').MessageBus} deps.messageBus
   * @param {Object} [deps.logger]
   */
  constructor({ messageBus, logger }) {
    /** @type {import('../L2-communication/message-bus.js').MessageBus} */
    this._messageBus = messageBus;

    /** @type {Object} */
    this._logger = logger || console;

    /** @type {Set<{ send: Function }>} 已连接的 SSE 客户端 / Connected SSE clients */
    this._clients = new Set();

    /** @type {boolean} 是否正在广播 / Broadcasting flag */
    this._broadcasting = false;

    /** @type {Function[] | null} 取消订阅句柄列表 / Unsubscribe handles */
    this._unsubscribes = null;

    /** @type {number} 总广播次数 / Total broadcasts */
    this._totalBroadcasts = 0;

    /** @type {Map<string, number>} 按主题统计 / Per-topic counts */
    this._eventsByTopic = new Map();

    // V5.1: 批处理缓冲区 / Batch processing buffer
    /** @type {Array<Object>} */
    this._batchBuffer = [];
    /** @type {NodeJS.Timeout|null} */
    this._batchTimer = null;
    /** @type {NodeJS.Timeout|null} */
    this._heartbeatTimer = null;
  }

  // ━━━ 生命周期 / Lifecycle ━━━

  /**
   * 开始广播 (订阅 MessageBus)
   * Start broadcasting (subscribe to MessageBus)
   */
  start() {
    if (this._broadcasting) return;

    // V5.1: 扩展订阅主题 / Extended topic subscriptions
    const topics = [
      'task.*', 'agent.*', 'pheromone.*', 'quality.*', 'memory.*',
      'zone.*', 'system.*',
      // V5.1 新增 / V5.1 additions
      'tool.*', 'capability.*', 'persona.*', 'species.*',
      'dag.*', 'skill.*', 'trace.*',
      // V5.2 新增 / V5.2 additions
      'circuit_breaker.*', 'stigmergic.*', 'failure.*', 'threshold.*',
      // V5.5 新增 / V5.5 additions
      'repair.*', 'convergence.*', 'modulator.*', 'governance.*', 'arbiter.*', 'baseline.*',
      // V5.6 新增 / V5.6 additions
      'speculative.*', 'work.*', 'pipeline.*',
    ];
    this._unsubscribes = topics.map((topic) =>
      this._messageBus.subscribe(topic, (message) => {
        this._onEvent(message);
      }),
    );

    // V5.1: 启动 SSE 心跳 / Start SSE heartbeat
    this._heartbeatTimer = setInterval(() => {
      this._sendHeartbeat();
    }, HEARTBEAT_INTERVAL_MS);
    if (this._heartbeatTimer.unref) this._heartbeatTimer.unref();

    this._broadcasting = true;
    this._logger.info?.('[StateBroadcaster] 广播已启动 / Broadcasting started');
  }

  /**
   * 停止广播 (取消订阅)
   * Stop broadcasting (unsubscribe)
   */
  stop() {
    if (!this._broadcasting) return;

    if (this._unsubscribes) {
      for (const unsub of this._unsubscribes) {
        try { unsub(); } catch { /* 忽略 / ignore */ }
      }
      this._unsubscribes = null;
    }

    // V5.1: 清理定时器 / Clean up timers
    if (this._heartbeatTimer) {
      clearInterval(this._heartbeatTimer);
      this._heartbeatTimer = null;
    }
    if (this._batchTimer) {
      clearTimeout(this._batchTimer);
      this._flushBatch(); // 刷新残留事件 / Flush remaining events
      this._batchTimer = null;
    }

    this._broadcasting = false;
    this._logger.info?.('[StateBroadcaster] 广播已停止 / Broadcasting stopped');
  }

  /**
   * 销毁: 停止 + 清空客户端
   * Destroy: stop + clear clients
   */
  destroy() {
    this.stop();
    this._clients.clear();
    this._logger.info?.('[StateBroadcaster] 已销毁 / Destroyed');
  }

  // ━━━ 客户端管理 / Client Management ━━━

  /**
   * 注册 SSE 客户端
   * Register an SSE client
   *
   * @param {{ send: Function }} client - 具有 send(data) 方法的客户端 / Client with send(data) method
   * @returns {Function} 移除函数 / Removal function
   */
  addClient(client) {
    this._clients.add(client);
    this._logger.debug?.(`[StateBroadcaster] 客户端已注册 / Client registered (total: ${this._clients.size})`);
    return () => this.removeClient(client);
  }

  /**
   * 移除 SSE 客户端
   * Remove an SSE client
   *
   * @param {{ send: Function }} client
   */
  removeClient(client) {
    this._clients.delete(client);
    this._logger.debug?.(`[StateBroadcaster] 客户端已移除 / Client removed (total: ${this._clients.size})`);
  }

  /**
   * 获取已连接客户端数量
   * Get connected client count
   *
   * @returns {number}
   */
  getClientCount() {
    return this._clients.size;
  }

  // ━━━ 统计 / Stats ━━━

  /**
   * 获取广播统计
   * Get broadcast statistics
   *
   * @returns {{ broadcasting: boolean, clientCount: number, totalBroadcasts: number, eventsByTopic: Object }}
   */
  getStats() {
    return {
      broadcasting: this._broadcasting,
      clientCount: this._clients.size,
      totalBroadcasts: this._totalBroadcasts,
      eventsByTopic: Object.fromEntries(this._eventsByTopic),
    };
  }

  // ━━━ 内部 / Internal ━━━

  /**
   * 处理事件 — 加入批处理缓冲区
   * Handle event — add to batch buffer
   *
   * @param {Object} message - MessageBus 消息 / MessageBus message
   * @private
   */
  _onEvent(message) {
    if (this._clients.size === 0) return;

    // V5.1: 确保事件格式统一 / Ensure unified event format
    const topic = message.topic || message.event || 'unknown';
    const wrapped = ensureV51Format(topic, message.data || message, 'legacy');

    // V5.1: 过滤敏感字段 / Filter sensitive fields
    const safePayload = this._filterPayload(wrapped.payload || {});

    const event = {
      event: topic,
      data: safePayload,
      timestamp: wrapped.timestamp || Date.now(),
      source: wrapped.source,
    };

    // 更新统计 / Update stats
    this._totalBroadcasts++;
    this._eventsByTopic.set(topic, (this._eventsByTopic.get(topic) || 0) + 1);

    // V5.1: 批处理 — 100ms 窗口聚合 / Batch processing — 100ms window aggregation
    this._batchBuffer.push(event);
    if (!this._batchTimer) {
      this._batchTimer = setTimeout(() => {
        this._flushBatch();
        this._batchTimer = null;
      }, BATCH_WINDOW_MS);
    }
  }

  /**
   * V5.1: 刷新批处理缓冲区
   * Flush batch buffer to all clients
   * @private
   */
  _flushBatch() {
    if (this._batchBuffer.length === 0) return;

    const batch = this._batchBuffer.splice(0);
    const deadClients = [];

    for (const client of this._clients) {
      try {
        // 批量发送：单次 SSE 帧包含所有事件
        // Batch send: single SSE frame with all events
        client.send({ event: 'batch', data: batch, timestamp: Date.now() });
      } catch (err) {
        this._logger.warn?.(`[StateBroadcaster] 客户端发送失败, 移除 / Client send failed, removing: ${err.message}`);
        deadClients.push(client);
      }
    }

    // 清理死亡客户端 / Clean up dead clients
    for (const dead of deadClients) {
      this._clients.delete(dead);
    }
  }

  /**
   * V5.1: 过滤 payload 中的敏感字段
   * Filter sensitive fields from payload
   *
   * @param {Object} payload
   * @returns {Object} 安全的 payload / Safe payload
   * @private
   */
  _filterPayload(payload) {
    if (!payload || typeof payload !== 'object') return payload;
    const safe = {};
    for (const [key, value] of Object.entries(payload)) {
      if (ALLOWED_FIELDS.has(key)) {
        safe[key] = value;
      }
    }
    return safe;
  }

  /**
   * V5.1: 发送 SSE 心跳
   * Send SSE heartbeat to detect dead clients
   * @private
   */
  _sendHeartbeat() {
    if (this._clients.size === 0) return;

    const deadClients = [];
    for (const client of this._clients) {
      try {
        client.send({ event: 'heartbeat', data: { timestamp: Date.now() } });
      } catch {
        deadClients.push(client);
      }
    }
    for (const dead of deadClients) {
      this._clients.delete(dead);
    }
  }
}
