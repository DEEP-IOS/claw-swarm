/**
 * WorkingMemory -- 三层工作记忆缓存 / 3-Layer Working Memory Cache
 *
 * 模拟人类工作记忆的注意力层级:
 * - Focus Buffer:   最多 5 项, priority >= 8, 最高激活度
 * - Context Buffer: 最多 15 项, priority >= 5, 中等激活度
 * - Scratch Pad:    最多 30 项, 临时计算空间
 *
 * Simulates human working memory attention hierarchy:
 * - Focus Buffer:   max 5 items, priority >= 8, highest activation
 * - Context Buffer: max 15 items, priority >= 5, medium activation
 * - Scratch Pad:    max 30 items, temporary computation space
 *
 * 激活度公式 / Activation formula:
 *   activation = baseScore * recencyWeight
 *   recencyWeight = 1 / (1 + ageMs / 60000)
 *
 * 驱逐策略: 满时驱逐最低激活度项, 级联降层
 * Eviction: when full, evict lowest-activation item, cascade down layers
 *   focus -> context -> scratch -> discard
 *
 * @module L3-agent/memory/working-memory
 * @author DEEP-IOS
 */

import { WorkingMemoryLayer } from '../../L1-infrastructure/types.js';

/**
 * @typedef {Object} MemoryEntry
 * 记忆条目 / A single working memory entry
 * @property {string} key - 唯一标识 / Unique key
 * @property {*} value - 存储值 / Stored value
 * @property {number} priority - 优先级 (0-10) / Priority (0-10)
 * @property {number} importance - 重要性 (0-1) / Importance (0-1)
 * @property {number} confidence - 置信度 (0-1) / Confidence (0-1)
 * @property {string} layer - 所在层 / Current layer
 * @property {number} createdAt - 创建时间戳 / Creation timestamp
 * @property {number} lastAccessedAt - 最后访问时间戳 / Last access timestamp
 * @property {number} accessCount - 访问次数 / Access count
 */

export class WorkingMemory {
  /**
   * @param {Object} [options]
   * @param {number} [options.maxFocus=5] - Focus Buffer 最大容量
   * @param {number} [options.maxContext=15] - Context Buffer 最大容量
   * @param {number} [options.maxScratch=30] - Scratch Pad 最大容量
   * @param {Object} [options.logger]
   */
  constructor({ maxFocus = 5, maxContext = 15, maxScratch = 30, logger } = {}) {
    /** @type {number} */
    this._maxFocus = maxFocus;
    /** @type {number} */
    this._maxContext = maxContext;
    /** @type {number} */
    this._maxScratch = maxScratch;
    /** @type {Object} */
    this._logger = logger || console;

    /**
     * 按 key 索引的扁平存储 / Flat storage indexed by key
     * @type {Map<string, MemoryEntry>}
     */
    this._entries = new Map();

    /** @type {{ evictions: number }} 统计 / Statistics */
    this._stats = { evictions: 0 };
  }

  // ━━━ 写入 / Write ━━━

  /**
   * 写入记忆条目 (自动分层 + LRU 驱逐)
   * Put a memory entry (auto-layer assignment + LRU eviction)
   *
   * @param {string} key - 唯一键 / Unique key
   * @param {*} value - 任意值 / Any value
   * @param {Object} [options]
   * @param {number} [options.priority=5] - 优先级 (0-10)
   * @param {number} [options.importance=0.5] - 重要性 (0-1)
   * @param {number} [options.confidence=1.0] - 置信度 (0-1)
   * @param {string} [options.layer='auto'] - 指定层或 'auto'
   * @returns {MemoryEntry} 写入的条目
   */
  put(key, value, { priority = 5, importance = 0.5, confidence = 1.0, layer = 'auto' } = {}) {
    const now = Date.now();

    // 如果 key 已存在, 更新 / If key exists, update in place
    const existing = this._entries.get(key);
    if (existing) {
      existing.value = value;
      existing.priority = priority;
      existing.importance = importance;
      existing.confidence = confidence;
      existing.lastAccessedAt = now;
      existing.accessCount++;

      // 重新分层 / Re-assign layer
      const targetLayer = layer === 'auto' ? this._resolveLayer(priority) : layer;
      if (existing.layer !== targetLayer) {
        existing.layer = targetLayer;
      }
      this._enforceCapacity(existing.layer);
      return existing;
    }

    // 新建条目 / Create new entry
    const targetLayer = layer === 'auto' ? this._resolveLayer(priority) : layer;
    /** @type {MemoryEntry} */
    const entry = {
      key,
      value,
      priority,
      importance,
      confidence,
      layer: targetLayer,
      createdAt: now,
      lastAccessedAt: now,
      accessCount: 1,
    };

    this._entries.set(key, entry);
    this._enforceCapacity(targetLayer);
    return entry;
  }

  // ━━━ 读取 / Read ━━━

  /**
   * 读取记忆条目 (同时更新最近访问时间)
   * Get a memory entry (also bumps recency)
   *
   * @param {string} key
   * @returns {*|null} 值或 null / Value or null
   */
  get(key) {
    const entry = this._entries.get(key);
    if (!entry) return null;

    // 更新访问信息 / Bump recency
    entry.lastAccessedAt = Date.now();
    entry.accessCount++;
    return entry.value;
  }

  /**
   * 删除记忆条目
   * Remove a memory entry
   *
   * @param {string} key
   * @returns {boolean} 是否删除成功
   */
  remove(key) {
    return this._entries.delete(key);
  }

  // ━━━ 层级查询 / Layer Query ━━━

  /**
   * 获取指定层的所有条目 (按激活度降序)
   * Get all entries in a layer (sorted by activation descending)
   *
   * @param {string} layerName - 'focus' | 'context' | 'scratchpad'
   * @returns {Array<MemoryEntry>}
   */
  getLayer(layerName) {
    const now = Date.now();
    const items = [];
    for (const entry of this._entries.values()) {
      if (entry.layer === layerName) {
        items.push(entry);
      }
    }
    items.sort((a, b) => this._activation(b, now) - this._activation(a, now));
    return items;
  }

  /**
   * 获取所有三层的快照
   * Get a snapshot of all three layers
   *
   * @returns {{ focus: MemoryEntry[], context: MemoryEntry[], scratchpad: MemoryEntry[], totalItems: number }}
   */
  snapshot() {
    return {
      focus: this.getLayer(WorkingMemoryLayer.focus),
      context: this.getLayer(WorkingMemoryLayer.context),
      scratchpad: this.getLayer(WorkingMemoryLayer.scratchpad),
      totalItems: this._entries.size,
    };
  }

  // ━━━ 压缩 / Compression ━━━

  /**
   * 压缩: 按 importance*confidence 排序, 保留 targetCount 项, 驱逐其余
   * Compress: sort by importance*confidence, keep targetCount items, evict rest
   *
   * @param {number} targetCount - 保留的目标数量 / Target number of items to keep
   * @returns {number} 被驱逐的数量 / Number of items evicted
   */
  compress(targetCount) {
    if (this._entries.size <= targetCount) return 0;

    // 按 importance*confidence 降序排列所有条目
    // Sort all entries by importance*confidence descending
    const allEntries = [...this._entries.values()];
    allEntries.sort((a, b) => (b.importance * b.confidence) - (a.importance * a.confidence));

    // 保留 top-N, 驱逐其余 / Keep top-N, evict rest
    const toEvict = allEntries.slice(targetCount);
    for (const entry of toEvict) {
      this._entries.delete(entry.key);
      this._stats.evictions++;
    }

    return toEvict.length;
  }

  // ━━━ 清除 / Clear ━━━

  /**
   * 清空所有层
   * Clear all layers
   */
  clear() {
    this._entries.clear();
  }

  // ━━━ 统计 / Statistics ━━━

  /**
   * 获取工作记忆统计信息
   * Get working memory statistics
   *
   * @returns {{ focusCount: number, contextCount: number, scratchCount: number, totalItems: number, evictions: number }}
   */
  getStats() {
    let focusCount = 0;
    let contextCount = 0;
    let scratchCount = 0;

    for (const entry of this._entries.values()) {
      if (entry.layer === WorkingMemoryLayer.focus) focusCount++;
      else if (entry.layer === WorkingMemoryLayer.context) contextCount++;
      else scratchCount++;
    }

    return {
      focusCount,
      contextCount,
      scratchCount,
      totalItems: this._entries.size,
      evictions: this._stats.evictions,
    };
  }

  // ━━━ 内部方法 / Internal Methods ━━━

  /**
   * 根据优先级自动决定目标层
   * Resolve target layer based on priority
   *
   * @private
   * @param {number} priority
   * @returns {string}
   */
  _resolveLayer(priority) {
    if (priority >= 8) return WorkingMemoryLayer.focus;
    if (priority >= 5) return WorkingMemoryLayer.context;
    return WorkingMemoryLayer.scratchpad;
  }

  /**
   * 获取指定层的容量上限
   * Get capacity limit for a layer
   *
   * @private
   * @param {string} layer
   * @returns {number}
   */
  _maxForLayer(layer) {
    if (layer === WorkingMemoryLayer.focus) return this._maxFocus;
    if (layer === WorkingMemoryLayer.context) return this._maxContext;
    return this._maxScratch;
  }

  /**
   * 计算条目激活度
   * Compute activation score for an entry
   *
   * activation = baseScore * recencyWeight
   * baseScore = priority / 10
   * recencyWeight = 1 / (1 + ageMs / 60000)
   *
   * @private
   * @param {MemoryEntry} entry
   * @param {number} now - 当前时间戳
   * @returns {number}
   */
  _activation(entry, now) {
    const baseScore = entry.priority / 10;
    const ageMs = now - entry.lastAccessedAt;
    const recencyWeight = 1 / (1 + ageMs / 60000);
    return baseScore * recencyWeight;
  }

  /**
   * 强制执行容量限制: 满时驱逐最低激活度项并级联降层
   * Enforce capacity: when full, evict lowest-activation item and cascade down
   *
   * 级联路径: focus -> context -> scratch -> discard
   * Cascade path: focus -> context -> scratch -> discard
   *
   * @private
   * @param {string} layer
   */
  _enforceCapacity(layer) {
    const now = Date.now();
    const max = this._maxForLayer(layer);
    const layerItems = [];

    for (const entry of this._entries.values()) {
      if (entry.layer === layer) layerItems.push(entry);
    }

    while (layerItems.length > max) {
      // 找到最低激活度的条目 / Find lowest activation entry
      let lowestIdx = 0;
      let lowestAct = this._activation(layerItems[0], now);

      for (let i = 1; i < layerItems.length; i++) {
        const act = this._activation(layerItems[i], now);
        if (act < lowestAct) {
          lowestAct = act;
          lowestIdx = i;
        }
      }

      const evicted = layerItems.splice(lowestIdx, 1)[0];
      this._stats.evictions++;

      // 级联降层 / Cascade to next lower layer
      const nextLayer = this._nextLowerLayer(layer);
      if (nextLayer) {
        evicted.layer = nextLayer;
        this._enforceCapacity(nextLayer); // 递归检查下层容量
      } else {
        // 已无更低层, 彻底丢弃 / No lower layer, discard entirely
        this._entries.delete(evicted.key);
        this._logger.debug?.(`[WorkingMemory] Discarded entry: ${evicted.key}`);
      }
    }
  }

  /**
   * 获取下一层 (级联降层路径)
   * Get next lower layer for cascade eviction
   *
   * @private
   * @param {string} layer
   * @returns {string|null}
   */
  _nextLowerLayer(layer) {
    if (layer === WorkingMemoryLayer.focus) return WorkingMemoryLayer.context;
    if (layer === WorkingMemoryLayer.context) return WorkingMemoryLayer.scratchpad;
    return null; // scratchpad 已是最底层
  }
}
