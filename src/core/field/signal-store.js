/**
 * SignalStore — 信号场顶层模块，组合 field/* + event-bus + module-base
 * SignalStore — apex module composing field/*, event-bus, and module-base
 *
 * SignalStore 是信号场的唯一写入/查询入口：
 *   - emit()     写入新信号（Forward-Decay 编码后存储）
 *   - query()    查询信号（直接计算 actualStrength，避免 exp 溢出）
 *   - superpose() 按作用域计算 12 维场向量
 *   - gc()       手动触发垃圾回收
 *
 * SignalStore is the sole write/query entry point for the signal field:
 *   - emit()     write new signal (stored with Forward-Decay encoding)
 *   - query()    query signals (direct actualStrength calculation, avoids exp overflow)
 *   - superpose() compute 12-dim field vector by scope
 *   - gc()       manually trigger garbage collection
 *
 * @module core/field/signal-store
 * @version 9.0.0
 */

import { nanoid } from 'nanoid'
import { ModuleBase } from '../module-base.js'
import {
  ALL_DIMENSIONS,
  DEFAULT_LAMBDA,
  SIGNAL_STRENGTH_MIN,
  SIGNAL_STRENGTH_MAX,
  DEFAULT_EXPIRED_THRESHOLD,
} from './types.js'
import { encode, actualStrength } from './forward-decay.js'
import { superpose as computeSuperpose } from './field-vector.js'
import { GCScheduler } from './gc-scheduler.js'
import { MemoryBackend } from './backends/memory.js'

// ============================================================================
// 事件主题常量 / Event Topic Constants
// ============================================================================

/** 信号发射事件 / Signal emitted event */
export const FIELD_SIGNAL_EMITTED = 'field.signal.emitted'
/** GC 完成事件 / GC completed event */
export const FIELD_GC_COMPLETED = 'field.gc.completed'
/** 紧急 GC 事件 / Emergency GC event */
export const FIELD_EMERGENCY_GC = 'field.emergency_gc'

// ============================================================================
// SignalStore 类 / SignalStore Class
// ============================================================================

export class SignalStore extends ModuleBase {
  /**
   * 该模块向信号场发射的维度 — 作为信号容器，产出全部维度
   * Dimensions emitted — as the signal container, produces ALL dimensions
   * @returns {string[]}
   */
  static produces() { return [...ALL_DIMENSIONS] }

  /**
   * 该模块从信号场读取的维度 — 自身不消费
   * Dimensions consumed — none (it IS the field)
   * @returns {string[]}
   */
  static consumes() { return [] }

  /**
   * 发布的事件主题
   * Published event topics
   * @returns {string[]}
   */
  static publishes() {
    return [FIELD_SIGNAL_EMITTED, FIELD_GC_COMPLETED, FIELD_EMERGENCY_GC]
  }

  /**
   * 订阅的事件主题 — 无
   * Subscribed event topics — none
   * @returns {string[]}
   */
  static subscribes() { return [] }

  /**
   * @param {Object} opts
   * @param {Object}  [opts.backend]       - 信号后端实例，默认 MemoryBackend / Signal backend, defaults to MemoryBackend
   * @param {Object}  [opts.eventBus]      - 事件总线（需有 publish 方法） / EventBus with publish()
   * @param {number}  [opts.gcIntervalMs]  - GC 间隔毫秒 / GC interval in ms
   * @param {number}  [opts.maxSignals=100000] - 信号数量上限 / Maximum signal count
   * @param {number}  [opts.gcThreshold]   - GC 过期阈值 / GC expiry threshold
   */
  constructor({
    backend,
    eventBus,
    gcIntervalMs = 60000,
    maxSignals = 100000,
    gcThreshold = DEFAULT_EXPIRED_THRESHOLD,
  } = {}) {
    super()

    /** @private */
    this._backend = backend || new MemoryBackend()
    /** @private */
    this._eventBus = eventBus || null
    /** @private */
    this._maxSignals = maxSignals

    /** @private */
    this._gcScheduler = new GCScheduler({
      backend: this._backend,
      intervalMs: gcIntervalMs,
      threshold: gcThreshold,
      maxSignals,
    })

    // 统计数据 / Statistics
    /** @private */
    this._totalEmitted = 0
    /** @private */
    this._totalQueried = 0
  }

  // ==========================================================================
  // 信号发射 / Signal Emission
  // ==========================================================================

  /**
   * 向信号场发射一个新信号
   * Emit a new signal into the signal field
   *
   * @param {Object} partial - 信号部分字段 / Partial signal fields
   * @param {string} partial.dimension  - 维度（必须是 ALL_DIMENSIONS 之一） / Dimension
   * @param {string} partial.scope      - 作用域 / Scope
   * @param {number} partial.strength   - 信号强度 [0,1] / Signal strength
   * @param {string} [partial.emitterId='system'] - 发射者 / Emitter ID
   * @param {number} [partial.lambda]   - 衰减率，默认按维度查表 / Decay rate
   * @param {number} [partial.emitTime] - 发射时间，默认 Date.now() / Emission time
   * @param {Object} [partial.metadata] - 附加数据 / Metadata
   * @returns {import('./types.js').Signal} 完整的信号对象 / Complete signal object
   * @throws {Error} 维度无效或强度越界 / Invalid dimension or strength out of range
   */
  emit(partial) {
    // ── 参数验证 / Parameter validation ──
    if (!partial || typeof partial !== 'object') {
      throw new Error('emit() requires a signal object')
    }

    const { dimension, scope, emitterId = 'system', metadata } = partial

    // 维度验证 / Dimension validation
    if (!dimension || !ALL_DIMENSIONS.includes(dimension)) {
      throw new Error(
        `Invalid dimension "${dimension}". Must be one of: ${ALL_DIMENSIONS.join(', ')}`
      )
    }

    // 作用域验证 / Scope validation
    if (!scope || typeof scope !== 'string') {
      throw new Error('Signal must have a non-empty string scope')
    }

    // 强度验证 / Strength validation
    let strength = partial.strength
    if (typeof strength !== 'number' || isNaN(strength)) {
      throw new Error('Signal strength must be a valid number')
    }
    // clamp 到 [0, 1] / Clamp to [0, 1]
    strength = Math.min(Math.max(strength, SIGNAL_STRENGTH_MIN), SIGNAL_STRENGTH_MAX)

    // 衰减率（默认按维度查表） / Lambda (default from dimension lookup table)
    const lambda = (typeof partial.lambda === 'number' && !isNaN(partial.lambda))
      ? partial.lambda
      : (DEFAULT_LAMBDA[dimension] || 0.01)

    // 发射时间 / Emission time
    const emitTime = (typeof partial.emitTime === 'number' && partial.emitTime > 0)
      ? partial.emitTime
      : Date.now()

    // ── 生成完整信号 / Build complete signal ──
    const id = nanoid(12)
    const encodedScore = encode(strength, lambda, emitTime)

    /** @type {import('./types.js').Signal} */
    const signal = {
      id,
      dimension,
      scope,
      strength,
      lambda,
      emitTime,
      encodedScore,
      emitterId,
    }
    if (metadata !== undefined && metadata !== null) {
      signal.metadata = metadata
    }

    // ── 写入后端 / Write to backend ──
    this._backend.put(signal)
    this._totalEmitted++

    // ── 超限检测 → 紧急 GC / Over-limit check → emergency GC ──
    if (this._backend.count() > this._maxSignals) {
      const gcResult = this._gcScheduler.runEmergencyGC(Date.now())
      this._publish(FIELD_EMERGENCY_GC, {
        triggerSignalId: id,
        ...gcResult,
      })
    }

    // ── 发布事件 / Publish event ──
    this._publish(FIELD_SIGNAL_EMITTED, {
      signalId: id,
      dimension,
      scope,
      strength,
      emitterId,
      emitTime,
    })

    return signal
  }

  // ==========================================================================
  // 信号查询 / Signal Query
  // ==========================================================================

  /**
   * 查询信号，附加实际强度并过滤/排序
   * Query signals with actual strength calculation, filtering, and sorting
   *
   * 使用直接 actualStrength() 计算（避免 encode/decode 中间溢出）
   * Uses direct actualStrength() calculation (avoids encode/decode overflow)
   *
   * @param {import('./types.js').SignalFilter} filter - 查询过滤器 / Query filter
   * @returns {Array<import('./types.js').Signal & { _actualStrength: number }>} 带实际强度的信号数组
   */
  query(filter = {}) {
    this._totalQueried++
    const now = Date.now()
    const { minStrength, sortBy, limit, ...backendFilter } = filter

    // 第一步：后端扫描（利用索引加速）
    // Step 1: backend scan (leverages indexes)
    let results = this._backend.scan(backendFilter)

    // 第二步：附加 _actualStrength（直接计算，避免溢出）
    // Step 2: attach _actualStrength (direct calculation, avoids overflow)
    results = results.map(sig => {
      const actual = actualStrength(sig.strength, sig.lambda, sig.emitTime, now)
      return { ...sig, _actualStrength: actual }
    })

    // 第三步：按最小强度过滤
    // Step 3: filter by minimum strength
    if (typeof minStrength === 'number' && minStrength > 0) {
      results = results.filter(s => s._actualStrength >= minStrength)
    }

    // 第四步：排序
    // Step 4: sort
    if (sortBy === 'strength') {
      results.sort((a, b) => b._actualStrength - a._actualStrength)
    } else if (sortBy === 'emitTime') {
      results.sort((a, b) => b.emitTime - a.emitTime)
    }

    // 第五步：数量限制
    // Step 5: limit
    if (typeof limit === 'number' && limit > 0 && results.length > limit) {
      results = results.slice(0, limit)
    }

    return results
  }

  // ==========================================================================
  // 场向量叠加 / Field Vector Superposition
  // ==========================================================================

  /**
   * 按作用域计算 12 维场向量
   * Compute 12-dimensional field vector for a given scope
   *
   * @param {string} scope - 作用域 / Scope
   * @param {string[]} [dimensions=ALL_DIMENSIONS] - 参与叠加的维度 / Dimensions to include
   * @returns {import('./types.js').FieldVector} 叠加后的场向量 / Superposed field vector
   */
  superpose(scope, dimensions = ALL_DIMENSIONS) {
    const signals = this._backend.scan({ scope })
    return computeSuperpose(signals, dimensions, Date.now())
  }

  // ==========================================================================
  // 垃圾回收 / Garbage Collection
  // ==========================================================================

  /**
   * 手动触发一次 GC
   * Manually trigger a GC cycle
   *
   * @returns {{ removed: number, remaining: number, durationMs: number }}
   */
  gc() {
    const now = Date.now()
    const result = this._gcScheduler.runGC(now)
    this._publish(FIELD_GC_COMPLETED, result)
    return result
  }

  // ==========================================================================
  // 生命周期 / Lifecycle
  // ==========================================================================

  /**
   * 启动 SignalStore（开始定时 GC）
   * Start SignalStore (begin periodic GC)
   * @returns {Promise<void>}
   */
  async start() {
    this._gcScheduler.start()
  }

  /**
   * 停止 SignalStore（停止定时 GC）
   * Stop SignalStore (halt periodic GC)
   * @returns {Promise<void>}
   */
  async stop() {
    this._gcScheduler.stop()
  }

  // ==========================================================================
  // 统计 / Statistics
  // ==========================================================================

  /**
   * 获取综合统计数据（后端 + GC + 操作计数）
   * Get combined statistics (backend + GC + operation counts)
   *
   * @returns {Object} 合并的统计对象 / Merged statistics object
   */
  stats() {
    const backendStats = this._backend.stats()
    const gcStats = this._gcScheduler.getStats()
    return {
      ...backendStats,
      ...gcStats,
      totalEmitted: this._totalEmitted,
      totalQueried: this._totalQueried,
      maxSignals: this._maxSignals,
    }
  }

  // ==========================================================================
  // 内部方法 / Internal Methods
  // ==========================================================================

  /**
   * 安全发布事件（eventBus 可选）
   * Safely publish event (eventBus is optional)
   *
   * @private
   * @param {string} topic - 事件主题 / Event topic
   * @param {Object} payload - 事件负载 / Event payload
   */
  _publish(topic, payload) {
    if (!this._eventBus) return
    try {
      this._eventBus.publish(topic, {
        topic,
        timestamp: Date.now(),
        source: 'SignalStore',
        payload,
      })
    } catch (err) {
      // 事件发布失败不应影响主逻辑
      // Event publish failure should not affect main logic
      if (typeof console !== 'undefined') {
        console.error(`[SignalStore] Failed to publish ${topic}:`, err.message)
      }
    }
  }
}
