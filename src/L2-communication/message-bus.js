/**
 * MessageBus — 统一消息总线 / Unified Message Bus
 *
 * V5.0 高性能消息总线, 提供:
 * - Topic 订阅/发布
 * - 消息 zod 校验 (可选)
 * - 死信队列 (DLQ)
 * - 通配符订阅 (topic.*)
 * - 消息历史回放 (最近 N 条)
 *
 * V6.0 新增:
 * - 可插拔传输层 (Transport 注入, 默认 EventEmitterTransport)
 * - 对所有调用者完全透明: API 不变, 只是内部传输可切换
 *
 * V5.0 high-performance message bus:
 * - Topic pub/sub
 * - Optional zod message validation
 * - Dead letter queue (DLQ)
 * - Wildcard subscriptions (topic.*)
 * - Recent message replay (last N)
 *
 * V6.0 additions:
 * - Pluggable transport layer (injected Transport, defaults to EventEmitterTransport)
 * - Fully transparent to all callers: API unchanged, only internal transport is swappable
 *
 * @module L2-communication/message-bus
 * @author DEEP-IOS
 */

import { nanoid } from 'nanoid';
import { EventEmitterTransport } from './transports/event-emitter-transport.js';

const MAX_DLQ_SIZE = 100;
const MAX_HISTORY_SIZE = 200;

export class MessageBus {
  /**
   * @param {Object} [options]
   * @param {Object} [options.logger]
   * @param {boolean} [options.enableHistory=false] - 启用消息历史 / Enable message history
   * @param {boolean} [options.enableDLQ=true] - 启用死信队列 / Enable dead letter queue
   * @param {import('./transports/transport-interface.js').Transport} [options.transport] - V6.0: 可插拔传输层 / Pluggable transport
   */
  constructor(options = {}) {
    /**
     * V6.0: 可插拔传输层 (默认 EventEmitterTransport, 行为与 V5.x 100% 相同)
     * V6.0: Pluggable transport (defaults to EventEmitterTransport, 100% V5.x compatible)
     * @type {import('./transports/transport-interface.js').Transport}
     */
    this._transport = options.transport || new EventEmitterTransport();

    /** @type {Object} */
    this._logger = options.logger || console;

    /** @type {boolean} */
    this._enableHistory = options.enableHistory || false;

    /** @type {boolean} */
    this._enableDLQ = options.enableDLQ !== false;

    /** @type {Array<Object>} 消息历史 / Message history */
    this._history = [];

    /** @type {Array<Object>} 死信队列 / Dead letter queue */
    this._dlq = [];

    /** @type {Map<string, Set<Function>>} 通配符订阅 / Wildcard subscriptions */
    this._wildcardSubscribers = new Map();

    /** @type {Object} 消息统计 / Message statistics */
    this._stats = {
      published: 0,
      delivered: 0,
      errors: 0,
      dlqSize: 0,
    };
  }

  // ━━━ 发布 / Publish ━━━

  /**
   * 发布消息到指定 topic
   * Publish message to a topic
   *
   * @param {string} topic - 消息主题 / Message topic (e.g., 'task.created', 'pheromone.emit')
   * @param {Object} data - 消息数据 / Message data
   * @param {Object} [options]
   * @param {string} [options.senderId] - 发送者 ID
   * @param {string} [options.correlationId] - 关联 ID
   * @param {string} [options.traceId] - 分布式追踪 ID / Distributed trace ID
   * @param {string} [options.parentSpanId] - 父 Span ID
   * @returns {string} messageId
   */
  publish(topic, data, options = {}) {
    const message = {
      id: nanoid(),
      topic,
      data,
      senderId: options.senderId || null,
      correlationId: options.correlationId || null,
      traceId: options.traceId || null,
      parentSpanId: options.parentSpanId || null,
      timestamp: Date.now(),
    };

    this._stats.published++;

    // 记录历史 / Record history
    if (this._enableHistory) {
      this._history.push(message);
      if (this._history.length > MAX_HISTORY_SIZE) {
        this._history.shift();
      }
    }

    // 精确匹配订阅 / Exact match subscribers
    try {
      const listenerCount = this._transport.listenerCount(topic);
      if (listenerCount > 0) {
        this._transport.emit(topic, message);
        this._stats.delivered += listenerCount;
      }
    } catch (err) {
      this._handleError(topic, message, err);
    }

    // 通配符匹配 / Wildcard match
    this._deliverToWildcards(topic, message);

    return message.id;
  }

  /**
   * V6.1: 请求-回复模式 / Request-reply pattern
   *
   * 发送带 correlationId 的请求, 等待匹配的回复。
   * Sends request with correlationId, waits for matching reply.
   *
   * @param {string} topic - 请求主题 / Request topic
   * @param {Object} payload - 请求数据 / Request data
   * @param {Object} [options]
   * @param {number} [options.timeoutMs=5000] - 超时 (ms)
   * @param {string} [options.senderId='request-reply']
   * @returns {Promise<Object>} 回复数据 / Reply data
   */
  requestReply(topic, payload, { timeoutMs = 5000, senderId = 'request-reply' } = {}) {
    const correlationId = `rr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const replyTopic = `${topic}.reply`;

    return new Promise((resolve, reject) => {
      let timer;
      let unsubscribe;

      const cleanup = () => {
        if (timer) clearTimeout(timer);
        if (unsubscribe) unsubscribe();
      };

      // 订阅回复 / Subscribe to reply
      unsubscribe = this.subscribe(replyTopic, (reply) => {
        if (reply?.correlationId === correlationId || reply?.payload?.correlationId === correlationId) {
          cleanup();
          resolve(reply);
        }
      });

      // 超时 / Timeout
      timer = setTimeout(() => {
        cleanup();
        reject(new Error(`requestReply timeout on ${topic} after ${timeoutMs}ms`));
      }, timeoutMs);

      // 发送请求 / Send request
      this.publish(topic, payload, { senderId, correlationId });
    });
  }

  // ━━━ 订阅 / Subscribe ━━━

  /**
   * 订阅指定 topic
   * Subscribe to a topic
   *
   * @param {string} topic - 消息主题 (支持通配符 'task.*')
   * @param {(message: Object) => void} handler - 处理函数
   * @returns {() => void} unsubscribe function
   */
  subscribe(topic, handler) {
    // 通配符订阅 / Wildcard subscription
    if (topic.endsWith('.*')) {
      const prefix = topic.slice(0, -2);
      if (!this._wildcardSubscribers.has(prefix)) {
        this._wildcardSubscribers.set(prefix, new Set());
      }
      this._wildcardSubscribers.get(prefix).add(handler);

      return () => {
        const subs = this._wildcardSubscribers.get(prefix);
        if (subs) {
          subs.delete(handler);
          if (subs.size === 0) this._wildcardSubscribers.delete(prefix);
        }
      };
    }

    // 精确订阅 / Exact subscription
    this._transport.on(topic, handler);
    return () => this._transport.off(topic, handler);
  }

  /**
   * 一次性订阅
   * Subscribe once (auto-unsubscribe after first message)
   *
   * @param {string} topic
   * @param {(message: Object) => void} handler
   * @returns {() => void} unsubscribe function
   */
  once(topic, handler) {
    this._transport.once(topic, handler);
    return () => this._transport.off(topic, handler);
  }

  // ━━━ 死信队列 / Dead Letter Queue ━━━

  /**
   * 获取死信队列
   * Get dead letter queue
   */
  getDLQ() {
    return [...this._dlq];
  }

  /**
   * 清空死信队列
   * Clear dead letter queue
   */
  clearDLQ() {
    this._dlq = [];
    this._stats.dlqSize = 0;
  }

  /**
   * 重放死信
   * Retry dead letters
   *
   * @returns {number} 重放数量
   */
  retryDLQ() {
    const items = this._dlq.splice(0);
    let retried = 0;
    for (const item of items) {
      this.publish(item.topic, item.data, {
        senderId: item.senderId,
        correlationId: item.correlationId,
      });
      retried++;
    }
    this._stats.dlqSize = this._dlq.length;
    return retried;
  }

  // ━━━ 历史查询 / History Query ━━━

  /**
   * 获取消息历史
   * Get message history
   *
   * @param {Object} [filter]
   * @param {string} [filter.topic]
   * @param {number} [filter.limit=20]
   * @param {number} [filter.since] - timestamp
   * @returns {Array<Object>}
   */
  getHistory({ topic, limit = 20, since } = {}) {
    let results = [...this._history];

    if (topic) {
      results = results.filter((m) => m.topic === topic || m.topic.startsWith(topic + '.'));
    }
    if (since) {
      results = results.filter((m) => m.timestamp >= since);
    }

    return results.slice(-limit);
  }

  // ━━━ 统计与工具 / Stats & Utilities ━━━

  /**
   * 获取消息统计
   * Get message statistics
   */
  getStats() {
    return { ...this._stats };
  }

  /**
   * 获取活跃 topic 列表
   * Get list of active topics
   */
  getActiveTopics() {
    return this._transport.eventNames();
  }

  /**
   * 移除所有订阅
   * Remove all subscriptions
   */
  removeAllSubscriptions() {
    this._transport.removeAllListeners();
    this._wildcardSubscribers.clear();
  }

  /**
   * 销毁消息总线
   * Destroy message bus
   */
  destroy() {
    this.removeAllSubscriptions();
    this._history = [];
    this._dlq = [];
    this._transport.destroy?.();
  }

  // ━━━ 内部方法 / Internal ━━━

  /**
   * 通配符分发
   * Deliver to wildcard subscribers
   *
   * @private
   */
  _deliverToWildcards(topic, message) {
    for (const [prefix, handlers] of this._wildcardSubscribers) {
      if (topic.startsWith(prefix + '.') || topic === prefix) {
        for (const handler of handlers) {
          try {
            handler(message);
            this._stats.delivered++;
          } catch (err) {
            this._handleError(topic, message, err);
          }
        }
      }
    }
  }

  /**
   * 错误处理 + DLQ
   * Error handling + DLQ
   *
   * @private
   */
  _handleError(topic, message, error) {
    this._stats.errors++;
    this._logger.warn?.(`[MessageBus] Error on topic '${topic}': ${error.message}`);

    if (this._enableDLQ) {
      this._dlq.push({
        ...message,
        error: error.message,
        failedAt: Date.now(),
      });
      if (this._dlq.length > MAX_DLQ_SIZE) {
        const discarded = this._dlq.shift();
        this._logger.warn?.(
          `[MessageBus] DLQ full (${MAX_DLQ_SIZE}), discarded oldest: topic='${discarded.topic}', id='${discarded.id}'`
        );
      }
      this._stats.dlqSize = this._dlq.length;
    }
  }
}
