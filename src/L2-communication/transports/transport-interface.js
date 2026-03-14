/**
 * Transport — 传输层接口定义 / Transport Layer Interface
 *
 * MessageBus 的可插拔传输抽象。所有传输实现必须继承此基类。
 * Pluggable transport abstraction for MessageBus. All transport implementations must extend this base class.
 *
 * V6.0 传输层:
 *   - EventEmitterTransport: 进程内 (默认, 行为与 V5.x 100% 相同)
 *   - BroadcastChannelTransport: 跨 Worker (Node.js 22+)
 *   - NATSTransport: V7.0 接口预留
 *
 * @module L2-communication/transports/transport-interface
 * @author DEEP-IOS
 */

/**
 * @abstract
 */
export class Transport {
  /**
   * 发射事件到指定 topic / Emit event to a topic
   * @param {string} topic
   * @param {*} data
   */
  emit(topic, data) {
    throw new Error('Transport.emit() must be implemented');
  }

  /**
   * 订阅 topic / Subscribe to a topic
   * @param {string} topic
   * @param {Function} handler
   */
  on(topic, handler) {
    throw new Error('Transport.on() must be implemented');
  }

  /**
   * 取消订阅 / Unsubscribe from a topic
   * @param {string} topic
   * @param {Function} handler
   */
  off(topic, handler) {
    throw new Error('Transport.off() must be implemented');
  }

  /**
   * 一次性订阅 / Subscribe once
   * @param {string} topic
   * @param {Function} handler
   */
  once(topic, handler) {
    throw new Error('Transport.once() must be implemented');
  }

  /**
   * 获取指定 topic 的监听器数量 / Get listener count for a topic
   * @param {string} topic
   * @returns {number}
   */
  listenerCount(topic) {
    throw new Error('Transport.listenerCount() must be implemented');
  }

  /**
   * 获取所有活跃 topic / Get all active topics
   * @returns {Array<string>}
   */
  eventNames() {
    throw new Error('Transport.eventNames() must be implemented');
  }

  /**
   * 移除所有监听器 / Remove all listeners
   */
  removeAllListeners() {
    throw new Error('Transport.removeAllListeners() must be implemented');
  }

  /**
   * 销毁传输层 / Destroy transport
   */
  destroy() {
    this.removeAllListeners();
  }
}
