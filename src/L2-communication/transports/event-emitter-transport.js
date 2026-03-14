/**
 * EventEmitterTransport — 进程内传输 (默认) / In-process Transport (Default)
 *
 * 基于 eventemitter3 的传输层实现, 行为与 V5.x MessageBus 100% 相同。
 * eventemitter3-based transport, 100% compatible with V5.x MessageBus behavior.
 *
 * 适用场景 / Use cases:
 *   - 单进程模式 (architecture.mode = 'legacy')
 *   - SwarmCore 子进程内部通信
 *
 * @module L2-communication/transports/event-emitter-transport
 * @author DEEP-IOS
 */

import EventEmitter from 'eventemitter3';
import { Transport } from './transport-interface.js';

export class EventEmitterTransport extends Transport {
  constructor() {
    super();
    /** @type {EventEmitter} */
    this._emitter = new EventEmitter();
  }

  /** @override */
  emit(topic, data) {
    this._emitter.emit(topic, data);
  }

  /** @override */
  on(topic, handler) {
    this._emitter.on(topic, handler);
  }

  /** @override */
  off(topic, handler) {
    this._emitter.off(topic, handler);
  }

  /** @override */
  once(topic, handler) {
    this._emitter.once(topic, handler);
  }

  /** @override */
  listenerCount(topic) {
    return this._emitter.listenerCount(topic);
  }

  /** @override */
  eventNames() {
    return this._emitter ? this._emitter.eventNames() : [];
  }

  /** @override */
  removeAllListeners() {
    this._emitter.removeAllListeners();
  }

  /** @override */
  destroy() {
    this.removeAllListeners();
    this._emitter = null;
  }
}
