/**
 * V9 事件总线 — 支持通配符的发布/订阅，基于 Map/Set 实现
 * Event bus with wildcard publish/subscribe support, built on plain Map/Set
 * @module core/bus/event-bus
 */

const BUS_ERROR_TOPIC = 'bus.error';

export class EventBus {
  constructor() {
    /** @type {Map<string, Set<Function>>} 精确匹配处理器 / Exact topic handlers */
    this._exactHandlers = new Map();

    /** @type {Array<{ pattern: string, regex: RegExp, handlers: Set<Function> }>} 通配符处理器 / Wildcard handlers */
    this._wildcardHandlers = [];

    /** 每个主题/模式的最大监听器数 / Max listeners per topic/pattern */
    this._maxListeners = 100;
  }

  /**
   * 发布事件到总线 / Publish an event to the bus
   * @param {string} topic - 事件主题 / Event topic
   * @param {*} data - 事件数据 / Event payload
   * @param {string} [source='unknown'] - 来源标识 / Source identifier
   */
  publish(topic, data, source = 'unknown') {
    const envelope = { topic, ts: Date.now(), source, data };

    // 1. 精确匹配 / Exact match handlers
    const exactSet = this._exactHandlers.get(topic);
    if (exactSet) {
      for (const handler of exactSet) {
        this._safeCall(handler, envelope, topic);
      }
    }

    // 2. 通配符匹配 / Wildcard match handlers
    for (const entry of this._wildcardHandlers) {
      if (entry.regex.test(topic)) {
        for (const handler of entry.handlers) {
          this._safeCall(handler, envelope, topic);
        }
      }
    }
  }

  /**
   * 安全调用处理器，错误不阻塞其他处理器
   * Safely invoke handler — errors don't block other handlers
   * @private
   */
  _safeCall(handler, envelope, originTopic) {
    try {
      handler(envelope);
    } catch (err) {
      // 避免 bus.error 自身无限递归 / Avoid infinite recursion on bus.error
      if (originTopic !== BUS_ERROR_TOPIC) {
        try {
          this.publish(BUS_ERROR_TOPIC, {
            originalTopic: originTopic,
            error: err.message || String(err),
            stack: err.stack,
          }, 'event-bus');
        } catch (_) {
          // bus.error 处理器本身出错，静默丢弃防止无限递归
          // bus.error handler itself failed — silently swallow to prevent infinite loop
        }
      }
    }
  }

  /**
   * 订阅事件主题（支持通配符 *） / Subscribe to a topic (wildcard * supported)
   * @param {string} topic - 主题或通配符模式 / Topic or wildcard pattern
   * @param {Function} handler - 处理函数 / Handler function
   */
  subscribe(topic, handler) {
    if (typeof handler !== 'function') {
      throw new TypeError('handler must be a function');
    }

    if (topic.includes('*')) {
      // 通配符订阅 / Wildcard subscription
      let entry = this._wildcardHandlers.find(e => e.pattern === topic);
      if (!entry) {
        // 转换通配符为正则：'agent.*' → /^agent\..+$/
        // Convert wildcard to regex: 'agent.*' → /^agent\..+$/
        const escaped = topic.replace(/[.+?^${}()|[\]\\*]/g, '\\$&').replace(/\\\*/g, '.+');
        entry = { pattern: topic, regex: new RegExp(`^${escaped}$`), handlers: new Set() };
        this._wildcardHandlers.push(entry);
      }
      entry.handlers.add(handler);
      this._warnIfExceeded(topic, entry.handlers.size);
    } else {
      // 精确订阅 / Exact subscription
      if (!this._exactHandlers.has(topic)) {
        this._exactHandlers.set(topic, new Set());
      }
      const set = this._exactHandlers.get(topic);
      set.add(handler);
      this._warnIfExceeded(topic, set.size);
    }
  }

  /**
   * 取消订阅 / Unsubscribe a handler from a topic
   * @param {string} topic - 主题或通配符模式 / Topic or wildcard pattern
   * @param {Function} handler - 处理函数 / Handler function
   */
  unsubscribe(topic, handler) {
    if (topic.includes('*')) {
      const entry = this._wildcardHandlers.find(e => e.pattern === topic);
      if (entry) {
        entry.handlers.delete(handler);
        // 清理空条目 / Clean up empty entries
        if (entry.handlers.size === 0) {
          const idx = this._wildcardHandlers.indexOf(entry);
          if (idx !== -1) this._wildcardHandlers.splice(idx, 1);
        }
      }
    } else {
      const set = this._exactHandlers.get(topic);
      if (set) {
        set.delete(handler);
        // 清理空 Set / Clean up empty Set
        if (set.size === 0) this._exactHandlers.delete(topic);
      }
    }
  }

  /**
   * 一次性订阅 — 触发后自动取消 / Subscribe once — auto-unsubscribe after first invocation
   * @param {string} topic - 主题或通配符模式 / Topic or wildcard pattern
   * @param {Function} handler - 处理函数 / Handler function
   */
  once(topic, handler) {
    const wrapper = (envelope) => {
      this.unsubscribe(topic, wrapper);
      handler(envelope);
    };
    // 保留原始引用以便外部也可手动 unsubscribe
    // Preserve original ref so caller can manually unsubscribe the wrapper too
    wrapper._originalHandler = handler;
    this.subscribe(topic, wrapper);
  }

  /**
   * 列出所有订阅（调试用） / List all subscriptions (for debugging)
   * @returns {Object<string, number>} { topicOrPattern: handlerCount }
   */
  listSubscriptions() {
    const result = {};
    for (const [topic, set] of this._exactHandlers) {
      result[topic] = set.size;
    }
    for (const entry of this._wildcardHandlers) {
      result[entry.pattern] = entry.handlers.size;
    }
    return result;
  }

  /**
   * 超出最大监听器数时发出警告 / Warn when handler count exceeds _maxListeners
   * @private
   */
  _warnIfExceeded(topic, count) {
    if (count > this._maxListeners) {
      console.warn(
        `[EventBus] 主题 "${topic}" 的监听器数量 (${count}) 超过上限 (${this._maxListeners})。` +
        ` / Listener count (${count}) for "${topic}" exceeds limit (${this._maxListeners}).`
      );
    }
  }
}
