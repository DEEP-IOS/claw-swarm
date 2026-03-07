/**
 * PheromoneEngine - 信息素引擎，基于 ACO 蚁群优化的信号场操作封装
 * Pheromone engine — ACO-based wrapper over the signal field
 *
 * 提供信息素沉积（deposit）、读取（read）、ACO 轮盘赌选择（acoSelect）
 * 以及手动蒸发（evaporate）等核心操作，使用 TypeRegistry 管理信息素类型
 * 并通过 MMAS（Min-Max Ant System）上下界约束信号强度。
 *
 * @module communication/pheromone/pheromone-engine
 * @version 9.0.0
 */

import { ModuleBase } from '../../core/module-base.js'
import {
  DIM_TRAIL,
  DIM_ALARM,
  DIM_KNOWLEDGE,
  DIM_COORDINATION,
} from '../../core/field/types.js'
import { TypeRegistry } from './type-registry.js'

// ============================================================================
// PheromoneEngine
// ============================================================================

export class PheromoneEngine extends ModuleBase {
  // --------------------------------------------------------------------------
  // 静态声明 / Static declarations
  // --------------------------------------------------------------------------

  /** 向信号场发射的维度 / Dimensions emitted into the signal field */
  static produces() {
    return [DIM_TRAIL, DIM_ALARM, DIM_KNOWLEDGE, DIM_COORDINATION]
  }

  /** 从信号场读取的维度 / Dimensions consumed from the signal field */
  static consumes() {
    return [DIM_TRAIL, DIM_ALARM]
  }

  /** 在 EventBus 上发布的事件主题 / Event topics published on EventBus */
  static publishes() {
    return ['pheromone.deposited', 'pheromone.evaporated']
  }

  /** 在 EventBus 上订阅的事件主题 / Event topics subscribed on EventBus */
  static subscribes() {
    return ['agent.lifecycle.completed', 'quality.anomaly.detected']
  }

  // --------------------------------------------------------------------------
  // 构造函数 / Constructor
  // --------------------------------------------------------------------------

  /**
   * @param {Object} opts
   * @param {import('../../core/field/signal-store.js').SignalStore} opts.field - 信号场实例 / SignalStore instance
   * @param {import('../../core/bus/event-bus.js').EventBus} opts.eventBus - 事件总线 / EventBus instance
   * @param {TypeRegistry} [opts.typeRegistry] - 信息素类型注册表（可选，内部创建默认） / TypeRegistry (optional)
   * @param {Object}  [opts.config={}]
   * @param {number}  [opts.config.alpha=1] - ACO alpha 参数（信息素权重）
   * @param {number}  [opts.config.beta=2]  - ACO beta 参数（启发式权重）
   */
  constructor({ field, eventBus, typeRegistry, config = {} }) {
    super()

    /** @private */ this._field = field
    /** @private */ this._eventBus = eventBus
    /** @private */ this._typeRegistry = typeRegistry || new TypeRegistry()
    /** @private */ this._alpha = config.alpha ?? 1
    /** @private */ this._beta = config.beta ?? 2

    // 统计计数器 / Statistics counters
    /** @private */ this._depositCount = 0
    /** @private */ this._readCount = 0
    /** @private */ this._selectCount = 0

    // 订阅事件 / Subscribe to events
    this._onAgentCompleted = this._onAgentCompleted.bind(this)
    this._onAnomalyDetected = this._onAnomalyDetected.bind(this)
    this._eventBus.subscribe('agent.lifecycle.completed', this._onAgentCompleted)
    this._eventBus.subscribe('quality.anomaly.detected', this._onAnomalyDetected)
  }

  // --------------------------------------------------------------------------
  // 生命周期 / Lifecycle
  // --------------------------------------------------------------------------

  async stop() {
    this._eventBus.unsubscribe('agent.lifecycle.completed', this._onAgentCompleted)
    this._eventBus.unsubscribe('quality.anomaly.detected', this._onAnomalyDetected)
  }

  // --------------------------------------------------------------------------
  // 核心方法 / Core Methods
  // --------------------------------------------------------------------------

  /**
   * 沉积信息素 / Deposit pheromone
   *
   * @param {string} type     - 信息素类型名 / Pheromone type name (e.g. 'trail')
   * @param {string} scope    - 作用域 / Scope (e.g. 'task:abc123')
   * @param {number} strength - 信号强度 [0, 1] / Signal strength
   * @param {Object} [payload={}] - 附加元数据 / Extra metadata
   * @param {string} [emitterId='system'] - 发射者标识 / Emitter ID
   * @returns {import('../../core/field/types.js').Signal} 发射的信号 / Emitted signal
   * @throws {Error} 类型不存在 / Type not found in registry
   */
  deposit(type, scope, strength, payload = {}, emitterId = 'system') {
    const typeConfig = this._typeRegistry.get(type)
    if (!typeConfig) {
      throw new Error(`PheromoneEngine.deposit: unknown type "${type}"`)
    }

    // MMAS 上下界约束 / MMAS bound clamping
    strength = Math.min(strength, typeConfig.maxBound)
    strength = Math.max(strength, typeConfig.minBound)

    const signal = this._field.emit({
      dimension: typeConfig.fieldDim,
      scope,
      strength,
      lambda: typeConfig.lambda,
      emitterId,
      metadata: { pheromoneType: type, ...payload },
    })

    this._eventBus.publish('pheromone.deposited', {
      type,
      scope,
      strength,
      emitterId,
    }, 'PheromoneEngine')

    this._depositCount++
    return signal
  }

  /**
   * 读取指定类型的信息素信号 / Read pheromone signals of a specific type
   *
   * @param {string} type  - 信息素类型名 / Pheromone type name
   * @param {string} scope - 作用域 / Scope
   * @returns {Array<import('../../core/field/types.js').Signal>} 过滤后的信号数组 / Filtered signals
   * @throws {Error} 类型不存在 / Type not found in registry
   */
  read(type, scope) {
    const typeConfig = this._typeRegistry.get(type)
    if (!typeConfig) {
      throw new Error(`PheromoneEngine.read: unknown type "${type}"`)
    }

    const signals = this._field.query({
      dimension: typeConfig.fieldDim,
      scope,
      sortBy: 'strength',
    })

    this._readCount++
    return signals.filter(s => s.metadata?.pheromoneType === type)
  }

  /**
   * 读取指定 scope 下所有 6 种信息素的浓度汇总
   * Read concentration summary of all 6 pheromone types for a given scope
   *
   * @param {string} scope - 作用域 / Scope
   * @returns {Record<string, number>} 类型 → 浓度 / type → concentration
   */
  readAll(scope) {
    const result = {}
    const types = this._typeRegistry.list()

    for (const type of types) {
      const signals = this.read(type, scope)
      result[type] = (signals.length > 0 && typeof signals[0]._actualStrength === 'number')
        ? signals[0]._actualStrength
        : 0
    }

    return result
  }

  /**
   * ACO 蚁群优化轮盘赌选择 / ACO roulette-wheel selection
   *
   * @param {Array<{ id: string, eta: number }>} candidates - 候选项 + 启发式值 / Candidates with heuristic value
   * @param {string} scope - 作用域前缀 / Scope prefix
   * @param {Object} [options={}]
   * @param {number} [options.alpha] - 信息素权重覆盖 / Override alpha
   * @param {number} [options.beta]  - 启发式权重覆盖 / Override beta
   * @returns {{ id: string, eta: number }} 选中的候选 / Selected candidate
   */
  acoSelect(candidates, scope, options = {}) {
    if (!candidates || candidates.length === 0) {
      throw new Error('PheromoneEngine.acoSelect: candidates array must not be empty')
    }

    const alpha = options.alpha ?? this._alpha
    const beta = options.beta ?? this._beta

    // 计算每个候选的 score / Compute score for each candidate
    const scores = candidates.map(candidate => {
      const signals = this.read('trail', `${scope}:${candidate.id}`)
      let tau = 0
      for (const sig of signals) {
        tau += (typeof sig._actualStrength === 'number') ? sig._actualStrength : 0
      }
      // 避免零概率：使用小正数 / Avoid zero probability with small positive value
      if (tau === 0) tau = 0.01

      const score = Math.pow(tau, alpha) * Math.pow(candidate.eta, beta)
      return { candidate, score }
    })

    // 总分 / Total score
    const totalScore = scores.reduce((sum, s) => sum + s.score, 0)

    // 轮盘赌选择 / Roulette wheel selection
    const rand = Math.random() * totalScore
    let cumulative = 0
    for (const entry of scores) {
      cumulative += entry.score
      if (rand < cumulative) {
        this._selectCount++
        return entry.candidate
      }
    }

    // 浮点精度兜底：返回最后一个 / Fallback for floating-point precision
    this._selectCount++
    return scores[scores.length - 1].candidate
  }

  /**
   * 手动强制蒸发：清除低于下界的信号 / Manual forced evaporation
   *
   * @param {string} scope - 作用域 / Scope
   * @param {string} type  - 信息素类型名 / Pheromone type name
   * @throws {Error} 类型不存在 / Type not found in registry
   */
  evaporate(scope, type) {
    const typeConfig = this._typeRegistry.get(type)
    if (!typeConfig) {
      throw new Error(`PheromoneEngine.evaporate: unknown type "${type}"`)
    }

    const signals = this.read(type, scope)
    const weakSignals = signals.filter(
      s => (typeof s._actualStrength === 'number') && s._actualStrength < typeConfig.minBound
    )

    // 弱信号自然会在下次 GC 中被清除，这里主动触发一次 GC
    // Weak signals will be cleaned up by the next GC; trigger one proactively
    if (weakSignals.length > 0) {
      this._field.gc()
    }

    this._eventBus.publish('pheromone.evaporated', {
      type,
      scope,
      count: weakSignals.length,
    }, 'PheromoneEngine')
  }

  /**
   * 统计数据 / Statistics
   * @returns {{ depositCount: number, readCount: number, selectCount: number }}
   */
  stats() {
    return {
      depositCount: this._depositCount,
      readCount: this._readCount,
      selectCount: this._selectCount,
    }
  }

  // --------------------------------------------------------------------------
  // 内部事件处理器 / Internal Event Handlers
  // --------------------------------------------------------------------------

  /**
   * agent.lifecycle.completed → 自动沉积 trail 信息素
   * @private
   */
  _onAgentCompleted(envelope) {
    const data = envelope?.data ?? envelope
    const scope = data?.scope || data?.agentId || 'global'
    const emitterId = data?.agentId || 'system'
    try {
      this.deposit('trail', scope, 0.5, { trigger: 'agent.lifecycle.completed' }, emitterId)
    } catch (_) {
      // 防御性：deposit 失败不应影响事件流
    }
  }

  /**
   * quality.anomaly.detected → 自动沉积 alarm 信息素
   * @private
   */
  _onAnomalyDetected(envelope) {
    const data = envelope?.data ?? envelope
    const scope = data?.scope || data?.taskId || 'global'
    const emitterId = data?.detectorId || 'system'
    try {
      this.deposit('alarm', scope, 0.8, { trigger: 'quality.anomaly.detected' }, emitterId)
    } catch (_) {
      // 防御性：deposit 失败不应影响事件流
    }
  }
}
