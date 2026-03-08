/**
 * StateBroadcaster -- 状态广播器 / State Broadcaster
 *
 * V5.0 L6 监控层: 订阅 MessageBus 事件, 通过 SSE 广播给已注册客户端。
 * V5.0 L6 Monitoring Layer: subscribes to MessageBus events and broadcasts
 * state updates to registered SSE clients.
 *
 * @module L6-monitoring/state-broadcaster
 * @author DEEP-IOS
 */

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
  }

  // ━━━ 生命周期 / Lifecycle ━━━

  /**
   * 开始广播 (订阅 MessageBus)
   * Start broadcasting (subscribe to MessageBus)
   */
  start() {
    if (this._broadcasting) return;

    // 订阅所有主要主题通配符 / Subscribe to all major topic wildcards
    const topics = ['task.*', 'agent.*', 'pheromone.*', 'quality.*', 'memory.*', 'zone.*', 'system.*'];
    this._unsubscribes = topics.map((topic) =>
      this._messageBus.subscribe(topic, (message) => {
        this._onEvent(message);
      }),
    );

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
   * 处理并广播事件
   * Handle and broadcast event
   *
   * @param {Object} message - MessageBus 消息 / MessageBus message
   * @private
   */
  _onEvent(message) {
    if (this._clients.size === 0) return;

    const event = {
      event: message.topic || 'unknown',
      data: message.data || message,
      timestamp: message.timestamp || Date.now(),
    };

    // 更新统计 / Update stats
    this._totalBroadcasts++;
    const topic = event.event;
    this._eventsByTopic.set(topic, (this._eventsByTopic.get(topic) || 0) + 1);

    // 广播给所有客户端 / Broadcast to all clients
    const deadClients = [];
    for (const client of this._clients) {
      try {
        client.send(event);
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
}
