/**
 * BroadcastChannelTransport — 跨 Worker 传输 / Cross-Worker Transport
 *
 * 基于 Node.js 22+ BroadcastChannel API 的传输层实现,
 * 支持主线程与 worker_threads 之间的消息传递。
 *
 * Based on Node.js 22+ BroadcastChannel API,
 * enables message passing between main thread and worker_threads.
 *
 * 限制 / Limitations:
 *   - BroadcastChannel 使用 structured clone 序列化 (不支持 Function/Symbol)
 *   - 所有同名频道的线程都会收到消息 (包括发送者自身)
 *   - 需要 self-dedup 过滤自身发出的消息
 *
 * @module L2-communication/transports/broadcast-channel-transport
 * @author DEEP-IOS
 */

import { Transport } from './transport-interface.js';
import { randomUUID } from 'node:crypto';

/** 默认频道名 / Default channel name */
const DEFAULT_CHANNEL = 'claw-swarm-bus';

export class BroadcastChannelTransport extends Transport {
  /**
   * @param {Object} [options]
   * @param {string} [options.channelName] - BroadcastChannel 名称
   */
  constructor(options = {}) {
    super();

    /** @type {string} 本实例唯一 ID (用于 self-dedup) / Unique ID for self-dedup */
    this._instanceId = randomUUID().slice(0, 8);

    /** @type {string} */
    this._channelName = options.channelName || DEFAULT_CHANNEL;

    /** @type {BroadcastChannel} */
    this._channel = new BroadcastChannel(this._channelName);

    /**
     * topic → Set<Function> 本地订阅者映射
     * @type {Map<string, Set<Function>>}
     */
    this._subscribers = new Map();

    // 监听 BroadcastChannel 消息 / Listen to BroadcastChannel messages
    this._channel.onmessage = (event) => {
      const msg = event.data;
      if (!msg || typeof msg !== 'object') return;

      // Self-dedup: 跳过自己发的消息 / Skip messages from self
      if (msg._senderId === this._instanceId) return;

      const { topic, data } = msg;
      if (!topic) return;

      // 分发到本地订阅者 / Dispatch to local subscribers
      const handlers = this._subscribers.get(topic);
      if (handlers) {
        for (const handler of handlers) {
          try {
            handler(data);
          } catch { /* subscriber error, non-fatal */ }
        }
      }
    };
  }

  /** @override */
  emit(topic, data) {
    // 1. 先分发给本地订阅者 (进程内) / Dispatch to local subscribers first
    const handlers = this._subscribers.get(topic);
    if (handlers) {
      for (const handler of handlers) {
        try {
          handler(data);
        } catch { /* subscriber error */ }
      }
    }

    // 2. 广播到其他线程 / Broadcast to other threads
    try {
      this._channel.postMessage({
        topic,
        data,
        _senderId: this._instanceId,
      });
    } catch { /* structured clone may fail for non-serializable data */ }
  }

  /** @override */
  on(topic, handler) {
    if (!this._subscribers.has(topic)) {
      this._subscribers.set(topic, new Set());
    }
    this._subscribers.get(topic).add(handler);
  }

  /** @override */
  off(topic, handler) {
    const handlers = this._subscribers.get(topic);
    if (handlers) {
      handlers.delete(handler);
      if (handlers.size === 0) this._subscribers.delete(topic);
    }
  }

  /** @override */
  once(topic, handler) {
    const wrapper = (data) => {
      this.off(topic, wrapper);
      handler(data);
    };
    this.on(topic, wrapper);
  }

  /** @override */
  listenerCount(topic) {
    return this._subscribers.get(topic)?.size || 0;
  }

  /** @override */
  eventNames() {
    return [...this._subscribers.keys()];
  }

  /** @override */
  removeAllListeners() {
    this._subscribers.clear();
  }

  /** @override */
  destroy() {
    this.removeAllListeners();
    try {
      this._channel.close();
    } catch { /* best-effort */ }
    this._channel = null;
  }
}
