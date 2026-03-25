/**
 * EventBus with wildcard subscriptions and compatibility aliases.
 *
 * The V9 codebase still contains a mix of canonical topics and historical
 * topic names. This bus keeps runtime delivery compatible while preserving
 * the original published topic inside the envelope.
 *
 * @module core/bus/event-bus
 */

const BUS_ERROR_TOPIC = 'bus.error';

const EVENT_ALIAS_GROUPS = Object.freeze([
  ['agent.lifecycle.spawned', 'agent.spawned'],
  ['agent.lifecycle.ready', 'agent.ready'],
  ['agent.lifecycle.active', 'agent.active'],
  ['agent.lifecycle.completed', 'agent.completed'],
  ['agent.lifecycle.failed', 'agent.failed'],
  ['agent.lifecycle.ended', 'agent.end'],
  ['memory.episode.recorded', 'memory.episodic.recorded'],
  ['quality.audit.completed', 'auto.quality.gate'],
  ['shapley.computed', 'auto.shapley.credit'],
  ['pheromone.deposited', 'pheromone.emitted'],
  ['pheromone.evaporated', 'pheromone.decayed'],
  ['channel.message', 'channel.message.posted'],
  ['dag.created', 'task.created', 'orchestration.dag.created'],
  ['dag.completed', 'orchestration.dag.completed'],
  ['dag.phase.started', 'orchestration.task.started'],
  ['dag.phase.completed', 'task.completed', 'orchestration.task.completed'],
  ['dag.phase.failed', 'orchestration.task.failed'],
  ['spawn.advised', 'orchestration.spawn.advised'],
  ['replan.triggered', 'orchestration.replan.triggered'],
  ['deadline.warning', 'orchestration.deadline.warning'],
  ['deadline.exceeded', 'orchestration.deadline.exceeded'],
  ['quality.breaker.tripped', 'quality.breaker.opened'],
]);

function buildAliasMap(groups) {
  const map = new Map();

  for (const group of groups) {
    for (const topic of group) {
      if (!map.has(topic)) {
        map.set(topic, new Set());
      }
      const aliases = map.get(topic);
      for (const alias of group) {
        if (alias !== topic) aliases.add(alias);
      }
    }
  }

  return map;
}

const EVENT_ALIAS_MAP = buildAliasMap(EVENT_ALIAS_GROUPS);

function getAliasedTopics(topic) {
  return [topic, ...(EVENT_ALIAS_MAP.get(topic) ?? [])];
}

export class EventBus {
  constructor() {
    /** @type {Map<string, Set<Function>>} */
    this._exactHandlers = new Map();

    /** @type {Array<{ pattern: string, regex: RegExp, handlers: Set<Function> }>} */
    this._wildcardHandlers = [];

    /** @type {number} */
    this._maxListeners = 100;
  }

  /**
   * Publish an event.
   * Exact subscribers receive both the original topic and compatibility aliases.
   * Wildcard subscribers only evaluate the original topic so they do not
   * receive duplicate deliveries.
   *
   * @param {string} topic
   * @param {*} data
   * @param {string} [source='unknown']
   */
  publish(topic, data, source = 'unknown') {
    const envelope = { topic, ts: Date.now(), source, data };

    const deliveredExact = new Set();
    for (const exactTopic of getAliasedTopics(topic)) {
      const exactHandlers = this._exactHandlers.get(exactTopic);
      if (!exactHandlers) continue;

      for (const handler of exactHandlers) {
        if (deliveredExact.has(handler)) continue;
        deliveredExact.add(handler);
        this._safeCall(handler, envelope, topic);
      }
    }

    for (const entry of this._wildcardHandlers) {
      if (!entry.regex.test(topic)) continue;
      for (const handler of entry.handlers) {
        this._safeCall(handler, envelope, topic);
      }
    }
  }

  emit(topic, data, source = 'unknown') {
    this.publish(topic, data, source);
  }

  /**
   * @private
   * @param {Function} handler
   * @param {{ topic: string, ts: number, source: string, data: * }} envelope
   * @param {string} originTopic
   */
  _safeCall(handler, envelope, originTopic) {
    try {
      handler(envelope);
    } catch (err) {
      if (originTopic === BUS_ERROR_TOPIC) return;

      try {
        this.publish(BUS_ERROR_TOPIC, {
          originalTopic: originTopic,
          error: err?.message || String(err),
          stack: err?.stack,
        }, 'event-bus');
      } catch {
        // Avoid infinite recursion if the error channel itself is broken.
      }
    }
  }

  /**
   * Subscribe to a topic or wildcard pattern.
   *
   * @param {string} topic
   * @param {Function} handler
   * @returns {Function} unsubscribe function
   */
  subscribe(topic, handler) {
    if (typeof handler !== 'function') {
      throw new TypeError('handler must be a function');
    }

    if (topic.includes('*')) {
      let entry = this._wildcardHandlers.find((candidate) => candidate.pattern === topic);
      if (!entry) {
        const escaped = topic
          .replace(/[.+?^${}()|[\]\\*]/g, '\\$&')
          .replace(/\\\*/g, '.+');
        entry = {
          pattern: topic,
          regex: new RegExp(`^${escaped}$`),
          handlers: new Set(),
        };
        this._wildcardHandlers.push(entry);
      }
      entry.handlers.add(handler);
      this._warnIfExceeded(topic, entry.handlers.size);
      return () => this.unsubscribe(topic, handler);
    }

    if (!this._exactHandlers.has(topic)) {
      this._exactHandlers.set(topic, new Set());
    }
    const handlers = this._exactHandlers.get(topic);
    handlers.add(handler);
    this._warnIfExceeded(topic, handlers.size);
    return () => this.unsubscribe(topic, handler);
  }

  /**
   * Unsubscribe a handler from a topic or wildcard.
   *
   * @param {string} topic
   * @param {Function} handler
   */
  unsubscribe(topic, handler) {
    if (topic.includes('*')) {
      const entry = this._wildcardHandlers.find((candidate) => candidate.pattern === topic);
      if (!entry) return;

      for (const existing of [...entry.handlers]) {
        if (existing === handler || existing?._originalHandler === handler) {
          entry.handlers.delete(existing);
        }
      }

      if (entry.handlers.size === 0) {
        const index = this._wildcardHandlers.indexOf(entry);
        if (index !== -1) this._wildcardHandlers.splice(index, 1);
      }
      return;
    }

    const handlers = this._exactHandlers.get(topic);
    if (!handlers) return;

    for (const existing of [...handlers]) {
      if (existing === handler || existing?._originalHandler === handler) {
        handlers.delete(existing);
      }
    }

    if (handlers.size === 0) {
      this._exactHandlers.delete(topic);
    }
  }

  /**
   * Node/EventEmitter-style convenience helper.
   * The callback receives payload data instead of the full envelope.
   *
   * @param {string} topic
   * @param {Function} handler
   * @returns {Function}
   */
  on(topic, handler) {
    const wrapped = (envelope) => handler(envelope?.data ?? envelope);
    wrapped._originalHandler = handler;
    return this.subscribe(topic, wrapped);
  }

  /**
   * Node/EventEmitter-style convenience helper.
   *
   * @param {string} topic
   * @param {Function} handler
   */
  off(topic, handler) {
    this.unsubscribe(topic, handler);
  }

  /**
   * Subscribe once.
   *
   * @param {string} topic
   * @param {Function} handler
   */
  once(topic, handler) {
    const wrapper = (envelope) => {
      this.unsubscribe(topic, wrapper);
      handler(envelope);
    };
    wrapper._originalHandler = handler;
    this.subscribe(topic, wrapper);
  }

  /**
   * List active subscriptions.
   *
   * @returns {Object<string, number>}
   */
  listSubscriptions() {
    const result = {};

    for (const [topic, handlers] of this._exactHandlers) {
      result[topic] = handlers.size;
    }
    for (const entry of this._wildcardHandlers) {
      result[entry.pattern] = entry.handlers.size;
    }

    return result;
  }

  stats() {
    let totalHandlers = 0;
    for (const handlers of this._exactHandlers.values()) {
      totalHandlers += handlers.size;
    }
    for (const entry of this._wildcardHandlers) {
      totalHandlers += entry.handlers.size;
    }

    return {
      exactTopics: this._exactHandlers.size,
      wildcardTopics: this._wildcardHandlers.length,
      totalHandlers,
      maxListeners: this._maxListeners,
    };
  }

  /**
   * @private
   * @param {string} topic
   * @param {number} count
   */
  _warnIfExceeded(topic, count) {
    if (count <= this._maxListeners) return;

    console.warn(
      `[EventBus] Listener count (${count}) for "${topic}" exceeds limit (${this._maxListeners}).`,
    );
  }
}

export default EventBus;
