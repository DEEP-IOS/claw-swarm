/**
 * IPCBridge — RPC-over-IPC 双端通信库 / RPC-over-IPC bidirectional communication library
 *
 * 父进程和子进程共用同一个类，通过 node:child_process IPC 通道实现:
 * - request/response: 带超时的请求-响应模式
 * - notify: 单向通知 (fire-and-forget)
 * - handle: 注册方法处理器
 *
 * Both parent and child processes share the same class, communicating via
 * node:child_process IPC channel:
 * - request/response: request-response with timeout
 * - notify: one-way notification (fire-and-forget)
 * - handle: register method handlers
 *
 * 协议格式 / Protocol format:
 *   { type: 'request',  id, method, args }
 *   { type: 'response', id, result, error }
 *   { type: 'notify',   method, args }
 *
 * @module L1-infrastructure/ipc-bridge
 * @author DEEP-IOS
 */

import { nanoid } from 'nanoid';

/** 默认超时 / Default timeout */
const DEFAULT_TIMEOUT_MS = 5000;

/** 最大 pending 请求数量防护 / Max pending requests safety guard */
const MAX_PENDING = 10000;

/**
 * 检测循环引用 / Detect circular references
 * @param {*} obj
 * @returns {boolean}
 */
function hasCircularReference(obj) {
  const seen = new WeakSet();
  const check = (val) => {
    if (val === null || typeof val !== 'object') return false;
    if (seen.has(val)) return true;
    seen.add(val);
    for (const key of Object.keys(val)) {
      if (check(val[key])) return true;
    }
    return false;
  };
  return check(obj);
}

export class IPCBridge {
  /**
   * @param {import('node:child_process').ChildProcess | NodeJS.Process} proc
   *   父进程端传入 fork() 返回的 ChildProcess;
   *   子进程端传入 process 全局对象。
   *   Parent side: ChildProcess from fork();
   *   Child side: global process object.
   * @param {Object} [options]
   * @param {Object} [options.logger] - 日志器 / Logger
   * @param {number} [options.defaultTimeoutMs] - 默认超时 / Default timeout
   */
  constructor(proc, options = {}) {
    /** @type {import('node:child_process').ChildProcess | NodeJS.Process} */
    this._proc = proc;

    /** @type {Object} */
    this._logger = options.logger || console;

    /** @type {number} */
    this._defaultTimeoutMs = options.defaultTimeoutMs || DEFAULT_TIMEOUT_MS;

    /**
     * 请求 ID → { resolve, reject, timer }
     * @type {Map<string, { resolve: Function, reject: Function, timer: ReturnType<typeof setTimeout> }>}
     */
    this._pending = new Map();

    /**
     * 方法名 → handler
     * @type {Map<string, Function>}
     */
    this._handlers = new Map();

    /** @type {boolean} */
    this._destroyed = false;

    /** IPC 调用统计 / IPC call stats */
    this._stats = {
      requestsSent: 0,
      responsesReceived: 0,
      notifiesSent: 0,
      notifiesReceived: 0,
      timeouts: 0,
      errors: 0,
    };

    // 绑定消息处理器 / Bind message handler
    this._onMessage = this._handleMessage.bind(this);
    this._proc.on('message', this._onMessage);
  }

  /**
   * 发送请求并等待响应 / Send request and await response
   *
   * @param {string} method - 方法名 / Method name
   * @param {*} [args] - 参数 / Arguments
   * @param {number} [timeoutMs] - 超时毫秒 / Timeout in ms
   * @returns {Promise<*>} 响应结果 / Response result
   * @throws {Error} 超时或远端错误 / Timeout or remote error
   */
  call(method, args, timeoutMs) {
    if (this._destroyed) {
      return Promise.reject(new Error('IPCBridge destroyed'));
    }

    if (this._pending.size >= MAX_PENDING) {
      return Promise.reject(new Error(`IPCBridge: too many pending requests (${MAX_PENDING})`));
    }

    // 循环引用检测 / Circular reference detection
    if (args !== undefined && typeof args === 'object' && args !== null) {
      if (hasCircularReference(args)) {
        return Promise.reject(new Error('IPCBridge: cannot serialize circular reference'));
      }
    }

    const id = nanoid(8);
    const timeout = timeoutMs ?? this._defaultTimeoutMs;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const entry = this._pending.get(id);
        if (entry) {
          this._pending.delete(id);
          this._stats.timeouts++;
          reject(new Error(`IPCBridge: call '${method}' timed out after ${timeout}ms`));
        }
      }, timeout);

      this._pending.set(id, { resolve, reject, timer });

      try {
        this._send({ type: 'request', id, method, args });
        this._stats.requestsSent++;
      } catch (err) {
        clearTimeout(timer);
        this._pending.delete(id);
        this._stats.errors++;
        reject(new Error(`IPCBridge: send failed for '${method}': ${err.message}`));
      }
    });
  }

  /**
   * 发送单向通知 (fire-and-forget) / Send one-way notification
   *
   * @param {string} method - 方法名 / Method name
   * @param {*} [args] - 参数 / Arguments
   */
  notify(method, args) {
    if (this._destroyed) return;

    try {
      this._send({ type: 'notify', method, args });
      this._stats.notifiesSent++;
    } catch (err) {
      this._stats.errors++;
      this._logger.warn?.(`[IPCBridge] notify '${method}' failed: ${err.message}`);
    }
  }

  /**
   * 注册方法处理器 / Register method handler
   *
   * 支持通配符: 'hook:*' 匹配所有 'hook:' 前缀的方法
   * Supports wildcard: 'hook:*' matches all 'hook:' prefixed methods
   *
   * @param {string} method - 方法名或通配符 / Method name or wildcard
   * @param {Function} handler - 处理函数 (可以是 async) / Handler (can be async)
   */
  handle(method, handler) {
    if (typeof handler !== 'function') {
      throw new TypeError(`IPCBridge: handler for '${method}' must be a function`);
    }
    this._handlers.set(method, handler);
  }

  /**
   * 获取统计信息 / Get statistics
   * @returns {Object}
   */
  getStats() {
    return {
      ...this._stats,
      pendingRequests: this._pending.size,
      registeredHandlers: this._handlers.size,
    };
  }

  /**
   * 销毁桥接器 / Destroy bridge
   * 清除所有 pending 请求和事件监听器
   * Clears all pending requests and event listeners
   */
  destroy() {
    if (this._destroyed) return;
    this._destroyed = true;

    // 清除所有 pending 请求 / Clear all pending requests
    for (const [id, entry] of this._pending) {
      clearTimeout(entry.timer);
      entry.reject(new Error('IPCBridge destroyed'));
    }
    this._pending.clear();
    this._handlers.clear();

    // 移除消息监听器 / Remove message listener
    try {
      this._proc.removeListener('message', this._onMessage);
    } catch { /* best-effort */ }
  }

  // ========================================================================
  // 内部方法 / Internal methods
  // ========================================================================

  /**
   * 发送 IPC 消息 / Send IPC message
   * @param {Object} msg
   * @private
   */
  _send(msg) {
    if (!this._proc.send) {
      throw new Error('IPCBridge: process has no IPC channel (not a child_process.fork)');
    }
    // node IPC 使用 structured clone 序列化 (支持 Date, Map, Set, BigInt 等)
    // node IPC uses structured clone serialization (supports Date, Map, Set, BigInt, etc.)
    this._proc.send(msg);
  }

  /**
   * 处理收到的 IPC 消息 / Handle received IPC message
   * @param {Object} msg
   * @private
   */
  _handleMessage(msg) {
    if (!msg || typeof msg !== 'object' || !msg.type) return;

    switch (msg.type) {
      case 'request':
        this._handleRequest(msg);
        break;
      case 'response':
        this._handleResponse(msg);
        break;
      case 'notify':
        this._handleNotify(msg);
        break;
      default:
        // 忽略非 IPC Bridge 协议的消息 / Ignore non-IPC Bridge protocol messages
        break;
    }
  }

  /**
   * 处理请求消息 / Handle request message
   * @param {{ id: string, method: string, args: * }} msg
   * @private
   */
  async _handleRequest(msg) {
    const { id, method, args } = msg;

    // 查找处理器: 精确匹配 → 通配符匹配 / Find handler: exact → wildcard
    let handler = this._handlers.get(method);
    if (!handler) {
      // 通配符匹配: 'hook:*' 匹配 'hook:before_agent_start'
      // Wildcard match: 'hook:*' matches 'hook:before_agent_start'
      for (const [pattern, h] of this._handlers) {
        if (pattern.endsWith(':*') && method.startsWith(pattern.slice(0, -1))) {
          handler = h;
          break;
        }
      }
    }

    if (!handler) {
      this._sendResponse(id, undefined, `IPCBridge: no handler for method '${method}'`);
      return;
    }

    try {
      // 通配符处理器接收 method 作为第一个参数 / Wildcard handler receives method as first arg
      const result = await handler(method, args);
      this._sendResponse(id, result, undefined);
    } catch (err) {
      this._sendResponse(id, undefined, err.message || String(err));
    }
  }

  /**
   * 处理响应消息 / Handle response message
   * @param {{ id: string, result: *, error?: string }} msg
   * @private
   */
  _handleResponse(msg) {
    const entry = this._pending.get(msg.id);
    if (!entry) return; // 可能已超时 / May have already timed out

    clearTimeout(entry.timer);
    this._pending.delete(msg.id);
    this._stats.responsesReceived++;

    if (msg.error) {
      entry.reject(new Error(`IPCBridge remote error: ${msg.error}`));
    } else {
      entry.resolve(msg.result);
    }
  }

  /**
   * 处理通知消息 / Handle notify message
   * @param {{ method: string, args: * }} msg
   * @private
   */
  _handleNotify(msg) {
    this._stats.notifiesReceived++;

    let handler = this._handlers.get(msg.method);
    if (!handler) {
      for (const [pattern, h] of this._handlers) {
        if (pattern.endsWith(':*') && msg.method.startsWith(pattern.slice(0, -1))) {
          handler = h;
          break;
        }
      }
    }

    if (!handler) return; // 通知无需回复 / Notify doesn't require response

    try {
      // 异步执行，不等待结果 / Execute async, don't await result
      const result = handler(msg.method, msg.args);
      if (result && typeof result.catch === 'function') {
        result.catch(err => {
          this._logger.warn?.(`[IPCBridge] notify handler '${msg.method}' error: ${err.message}`);
        });
      }
    } catch (err) {
      this._logger.warn?.(`[IPCBridge] notify handler '${msg.method}' error: ${err.message}`);
    }
  }

  /**
   * 发送响应 / Send response
   * @param {string} id
   * @param {*} result
   * @param {string} [error]
   * @private
   */
  _sendResponse(id, result, error) {
    try {
      this._send({ type: 'response', id, result, error });
    } catch (err) {
      this._logger.warn?.(`[IPCBridge] failed to send response for ${id}: ${err.message}`);
    }
  }
}
