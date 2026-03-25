/**
 * WorkingMemory — 代理短期工作记忆（环形缓冲区）
 * Working memory for agents using per-agent ring buffers (FIFO eviction)
 *
 * 每个代理拥有独立的 RingBuffer，容纳最近 N 条对话条目。
 * 代理生命周期事件自动创建/销毁缓冲区。
 *
 * Each agent gets its own RingBuffer holding the most recent N conversation
 * entries. Buffers are auto-created/destroyed via agent lifecycle events.
 *
 * @module intelligence/memory/working-memory
 * @version 9.0.0
 */

import { ModuleBase } from '../../core/module-base.js';

// ─── 内部环形缓冲区 / Internal Ring Buffer ──────────────────────────
class RingBuffer {
  /**
   * @param {number} capacity 最大容量 / max capacity
   */
  constructor(capacity) {
    this._items = [];
    this._capacity = capacity;
  }

  /**
   * 压入条目，超容量 FIFO 丢弃最老项
   * Push item; oldest entry is evicted when capacity exceeded
   * @param {*} item
   */
  push(item) {
    this._items.push(item);
    if (this._items.length > this._capacity) {
      this._items.shift();
    }
  }

  /**
   * 获取最近 n 条 / Get most recent n items
   * @param {number} n
   * @returns {Array}
   */
  getRecent(n) {
    if (n <= 0) return [];
    return this._items.slice(-n);
  }

  /** 获取全部 / Get all items */
  getAll() {
    return this._items.slice();
  }

  /** 当前条数 / Current item count */
  size() {
    return this._items.length;
  }

  /** 清空 / Clear all items */
  clear() {
    this._items = [];
  }
}

// ─── WorkingMemory ──────────────────────────────────────────────────
export class WorkingMemory extends ModuleBase {
  static produces() { return []; }
  static consumes() { return []; }
  static publishes() { return []; }
  static subscribes() { return ['agent.lifecycle.spawned', 'agent.lifecycle.ended']; }

  /**
   * @param {object} opts
   * @param {import('../../core/bus/event-bus.js').EventBus} opts.eventBus
   * @param {number} [opts.defaultCapacity=15]
   */
  constructor({ eventBus, defaultCapacity = 15 } = {}) {
    super();
    /** @type {Map<string, RingBuffer>} agentId → RingBuffer */
    this._buffers = new Map();
    this._defaultCapacity = defaultCapacity;
    this._eventBus = eventBus;

    this._unsubscribers = [];
    if (this._eventBus) {
      this._unsubscribers.push(
        this._eventBus.on('agent.lifecycle.spawned', (data) => {
          if (data?.agentId) this.create(data.agentId);
        }),
        this._eventBus.on('agent.lifecycle.ended', (data) => {
          if (data?.agentId) this.destroy(data.agentId);
        }),
      );
    }
  }

  /**
   * 为代理创建缓冲区 / Create buffer for agent
   * @param {string} agentId
   * @param {number} [capacity]
   */
  create(agentId, capacity) {
    if (!this._buffers.has(agentId)) {
      this._buffers.set(agentId, new RingBuffer(capacity ?? this._defaultCapacity));
    }
  }

  /**
   * 压入条目 / Push entry into agent's buffer
   * @param {string} agentId
   * @param {{ type: string, content: *, ts?: number }} entry
   */
  push(agentId, entry) {
    const buf = this._buffers.get(agentId);
    if (!buf) return;
    buf.push({ ...entry, ts: entry.ts ?? Date.now() });
  }

  /**
   * 获取最近 n 条 / Get recent n entries
   * @param {string} agentId
   * @param {number} n
   * @returns {Array}
   */
  getRecent(agentId, n) {
    const buf = this._buffers.get(agentId);
    return buf ? buf.getRecent(n) : [];
  }

  /** 获取全部 / Get all entries */
  getAll(agentId) {
    const buf = this._buffers.get(agentId);
    return buf ? buf.getAll() : [];
  }

  /** 清空代理缓冲区 / Clear agent buffer */
  clear(agentId) {
    const buf = this._buffers.get(agentId);
    if (buf) buf.clear();
  }

  /** 销毁代理缓冲区 / Destroy agent buffer */
  destroy(agentId) {
    this._buffers.delete(agentId);
  }
}

export default WorkingMemory;
