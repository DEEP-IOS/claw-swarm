/**
 * NATSTransport — V7.0 接口预留桩 / V7.0 Interface Stub
 *
 * 预留 NATS 分布式消息传输的接口, V7.0 时实现。
 * Reserved interface stub for NATS distributed messaging, to be implemented in V7.0.
 *
 * 当前行为:
 *   - 所有方法抛出 'NATSTransport not yet implemented' 错误
 *   - 仅用于类型检查和接口预留
 *
 * @module L2-communication/transports/nats-transport
 * @author DEEP-IOS
 */

import { Transport } from './transport-interface.js';

export class NATSTransport extends Transport {
  /**
   * @param {Object} [options]
   * @param {string} [options.url] - NATS 服务器 URL (e.g., 'nats://localhost:4222')
   * @param {string} [options.subjectPrefix] - Subject 前缀 (e.g., 'claw-swarm')
   */
  constructor(options = {}) {
    super();
    this._url = options.url || 'nats://localhost:4222';
    this._subjectPrefix = options.subjectPrefix || 'claw-swarm';
    this._connected = false;
  }

  /** @override */
  emit(topic, data) {
    throw new Error('NATSTransport not yet implemented (planned for V7.0)');
  }

  /** @override */
  on(topic, handler) {
    throw new Error('NATSTransport not yet implemented (planned for V7.0)');
  }

  /** @override */
  off(topic, handler) {
    throw new Error('NATSTransport not yet implemented (planned for V7.0)');
  }

  /** @override */
  once(topic, handler) {
    throw new Error('NATSTransport not yet implemented (planned for V7.0)');
  }

  /** @override */
  listenerCount(_topic) {
    return 0;
  }

  /** @override */
  eventNames() {
    return [];
  }

  /** @override */
  removeAllListeners() {
    // no-op
  }

  /** @override */
  destroy() {
    this._connected = false;
  }
}
