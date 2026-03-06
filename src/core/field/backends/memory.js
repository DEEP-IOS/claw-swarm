/**
 * 三索引内存信号后端
 * Triple-indexed in-memory signal backend
 *
 * 提供三种索引结构以支持高效的信号查询：
 *   - _allSignals:  Map<id, Signal>            主存储（按 ID 快速访问）
 *   - _scopeIndex:  Map<scope, Map<id, Signal>> 作用域索引（按 scope 快速过滤）
 *   - _dimIndex:    Map<dimension, Set<id>>      维度索引（按维度快速过滤）
 *
 * Provides three index structures for efficient signal queries:
 *   - _allSignals:  Map<id, Signal>            primary store (fast ID lookup)
 *   - _scopeIndex:  Map<scope, Map<id, Signal>> scope index (fast scope filter)
 *   - _dimIndex:    Map<dimension, Set<id>>      dimension index (fast dim filter)
 *
 * @module core/field/backends/memory
 * @version 9.0.0
 */

export class MemoryBackend {
  constructor() {
    /** @type {Map<string, import('../../field/types.js').Signal>} */
    this._allSignals = new Map()
    /** @type {Map<string, Map<string, import('../../field/types.js').Signal>>} */
    this._scopeIndex = new Map()
    /** @type {Map<string, Set<string>>} */
    this._dimIndex = new Map()
  }

  /**
   * 写入信号到三个索引
   * Write a signal into all three indexes
   *
   * @param {import('../../field/types.js').Signal} signal - 信号对象（必须有 id, scope, dimension）
   */
  put(signal) {
    const { id, scope, dimension } = signal

    // 主存储 / Primary store
    this._allSignals.set(id, signal)

    // 作用域索引 / Scope index
    let scopeMap = this._scopeIndex.get(scope)
    if (!scopeMap) {
      scopeMap = new Map()
      this._scopeIndex.set(scope, scopeMap)
    }
    scopeMap.set(id, signal)

    // 维度索引 / Dimension index
    let dimSet = this._dimIndex.get(dimension)
    if (!dimSet) {
      dimSet = new Set()
      this._dimIndex.set(dimension, dimSet)
    }
    dimSet.add(id)
  }

  /**
   * 扫描信号，使用索引加速过滤
   * Scan signals using indexes for fast filtering
   *
   * @param {import('../../field/types.js').SignalFilter} filter - 过滤条件
   * @returns {import('../../field/types.js').Signal[]} 匹配的信号数组
   */
  scan(filter) {
    const { scope, dimension, emitterId, maxAge, sortBy, limit } = filter || {}
    let candidates

    // 策略选择：优先使用最窄的索引
    // Strategy: prefer the narrowest index
    if (scope && dimension) {
      // 两者都有 → 从 scope 索引取交集
      // Both present → intersect from scope index
      const scopeMap = this._scopeIndex.get(scope)
      if (!scopeMap) return []
      const dimSet = this._dimIndex.get(dimension)
      if (!dimSet) return []
      candidates = []
      for (const [id, sig] of scopeMap) {
        if (dimSet.has(id)) candidates.push(sig)
      }
    } else if (scope) {
      // 仅 scope / Scope only
      const scopeMap = this._scopeIndex.get(scope)
      if (!scopeMap) return []
      candidates = Array.from(scopeMap.values())
    } else if (dimension) {
      // 仅 dimension / Dimension only
      const dimSet = this._dimIndex.get(dimension)
      if (!dimSet) return []
      candidates = []
      for (const id of dimSet) {
        const sig = this._allSignals.get(id)
        if (sig) candidates.push(sig)
      }
    } else {
      // 无索引过滤 → 全量扫描 / No index filter → full scan
      candidates = Array.from(this._allSignals.values())
    }

    // 二次过滤 / Secondary filters
    const now = Date.now()
    let results = candidates

    if (emitterId) {
      results = results.filter(s => s.emitterId === emitterId)
    }

    if (maxAge != null && maxAge > 0) {
      const cutoff = now - maxAge
      results = results.filter(s => s.emitTime >= cutoff)
    }

    // 排序 / Sorting
    if (sortBy === 'strength') {
      // 按原始强度降序（查询层会附加 _actualStrength 再排序）
      // Sort by raw strength descending (query layer may re-sort by actual)
      results.sort((a, b) => b.strength - a.strength)
    } else if (sortBy === 'emitTime') {
      // 按发射时间升序（最旧在前，用于 GC）
      // Sort by emit time ascending (oldest first, for GC)
      results.sort((a, b) => a.emitTime - b.emitTime)
    }

    // 数量限制 / Limit
    if (limit != null && limit > 0 && results.length > limit) {
      results = results.slice(0, limit)
    }

    return results
  }

  /**
   * 批量删除信号，从三个索引中移除
   * Batch remove signals from all three indexes
   *
   * @param {string[]} ids - 要删除的信号 ID 数组 / Array of signal IDs to remove
   * @returns {number} 实际删除的数量 / Number actually removed
   */
  remove(ids) {
    let removed = 0

    for (const id of ids) {
      const signal = this._allSignals.get(id)
      if (!signal) continue

      // 从主存储删除 / Remove from primary store
      this._allSignals.delete(id)

      // 从作用域索引删除 / Remove from scope index
      const scopeMap = this._scopeIndex.get(signal.scope)
      if (scopeMap) {
        scopeMap.delete(id)
        if (scopeMap.size === 0) {
          this._scopeIndex.delete(signal.scope)
        }
      }

      // 从维度索引删除 / Remove from dimension index
      const dimSet = this._dimIndex.get(signal.dimension)
      if (dimSet) {
        dimSet.delete(id)
        if (dimSet.size === 0) {
          this._dimIndex.delete(signal.dimension)
        }
      }

      removed++
    }

    return removed
  }

  /**
   * 返回信号总数
   * Return total signal count
   * @returns {number}
   */
  count() {
    return this._allSignals.size
  }

  /**
   * 清空全部索引
   * Clear all indexes
   */
  clear() {
    this._allSignals.clear()
    this._scopeIndex.clear()
    this._dimIndex.clear()
  }

  /**
   * 返回后端统计信息
   * Return backend statistics
   *
   * @returns {{ signalCount: number, scopeCount: number, dimensionCount: number, memoryEstimateBytes: number }}
   */
  stats() {
    // 粗略估算内存占用 / Rough memory usage estimate
    // 每个信号约 ~300 bytes（对象 + 索引引用）
    // Each signal ~300 bytes (object + index refs)
    const signalCount = this._allSignals.size
    const scopeCount = this._scopeIndex.size
    const dimensionCount = this._dimIndex.size
    const memoryEstimateBytes = signalCount * 300 + scopeCount * 64 + dimensionCount * 64

    return {
      signalCount,
      scopeCount,
      dimensionCount,
      memoryEstimateBytes,
    }
  }
}
