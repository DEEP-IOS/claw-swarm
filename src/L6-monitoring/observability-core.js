/**
 * ObservabilityCore — 统一观测核心 / Unified Observability Core
 *
 * V5.4: 蜂群协作全链路观测最小集, 收集四类可观测数据:
 * - 决策 (decision):  仲裁模式选择、路由判定、信号聚合
 * - 执行 (execution): 任务生命周期、工具调用、结果质量
 * - 修复 (repair):    故障检测、免疫命中、断路器状态变化
 * - 策略 (strategy):  PI 调参、阈值变更、建议强度、协作税
 *
 * 将 SwarmAdvisor、EvidenceGate、BudgetTracker、ProtocolSemantics 等
 * 模块的观测数据统一归集, 提供结构化查询接口。
 *
 * V5.4: Swarm collaboration full-path observability minimum set,
 * collects 4 categories of observable data: decision, execution, repair, strategy.
 *
 * @module L6-monitoring/observability-core
 * @version 5.4.0
 * @author DEEP-IOS
 */

import { EventTopics, wrapEvent } from '../event-catalog.js';

const SOURCE = 'observability-core';

// ============================================================================
// 常量 / Constants
// ============================================================================

/** 观测类别 / Observation categories */
export const OBS_CATEGORIES = {
  DECISION:  'decision',
  EXECUTION: 'execution',
  REPAIR:    'repair',
  STRATEGY:  'strategy',
};

/** 事件环形缓冲区大小 / Ring buffer size */
const MAX_EVENTS = 500;

// ============================================================================
// ObservabilityCore 类 / ObservabilityCore Class
// ============================================================================

export class ObservabilityCore {
  /**
   * @param {Object} deps
   * @param {Object} [deps.messageBus]
   * @param {Object} [deps.logger]
   */
  constructor({ messageBus, logger } = {}) {
    this._messageBus = messageBus || null;
    this._logger = logger || console;

    /** @type {Array<Object>} 环形缓冲区 */
    this._buffer = [];
    this._bufferIndex = 0;
    this._seq = 0; // 单调递增序列号, 确保排序确定性

    /** @type {Object} 分类计数 */
    this._counts = {
      [OBS_CATEGORIES.DECISION]:  0,
      [OBS_CATEGORIES.EXECUTION]: 0,
      [OBS_CATEGORIES.REPAIR]:    0,
      [OBS_CATEGORIES.STRATEGY]:  0,
    };

    /** @type {Object} 订阅状态 */
    this._subscribed = false;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 生命周期 / Lifecycle
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * 启动观测: 订阅 MessageBus 事件
   * Start observing: subscribe to MessageBus events
   */
  start() {
    if (this._subscribed || !this._messageBus) return;

    // ── 决策类事件 ──
    this._sub(EventTopics.SWARM_ADVISORY_INJECTED, OBS_CATEGORIES.DECISION);

    // ── 执行类事件 ──
    this._sub(EventTopics.TASK_CREATED, OBS_CATEGORIES.EXECUTION);
    this._sub(EventTopics.TASK_COMPLETED, OBS_CATEGORIES.EXECUTION);
    this._sub(EventTopics.TASK_FAILED, OBS_CATEGORIES.EXECUTION);
    this._sub(EventTopics.TASK_ASSIGNED, OBS_CATEGORIES.EXECUTION);

    // ── 修复类事件 ──
    this._sub(EventTopics.TOOL_FAILURE, OBS_CATEGORIES.REPAIR);
    this._sub(EventTopics.FAILURE_VACCINE_APPLIED, OBS_CATEGORIES.REPAIR);
    this._sub(EventTopics.CIRCUIT_BREAKER_TRANSITION, OBS_CATEGORIES.REPAIR);

    // ── 策略类事件 ──
    this._sub(EventTopics.THRESHOLD_ADJUSTED, OBS_CATEGORIES.STRATEGY);
    this._sub(EventTopics.PHEROMONE_ESCALATED, OBS_CATEGORIES.STRATEGY);

    // ── V5.4 新事件 ──
    this._sub(EventTopics.EVIDENCE_CLAIM_EVALUATED, OBS_CATEGORIES.DECISION);
    this._sub(EventTopics.PROTOCOL_MESSAGE_SENT, OBS_CATEGORIES.EXECUTION);
    this._sub(EventTopics.BUDGET_TURN_COMPLETED, OBS_CATEGORIES.STRATEGY);

    // ── V5.5 新事件 ──
    this._sub(EventTopics.REPAIR_STRATEGY_FOUND, OBS_CATEGORIES.REPAIR);
    this._sub(EventTopics.REPAIR_STRATEGY_OUTCOME, OBS_CATEGORIES.REPAIR);
    this._sub(EventTopics.TASK_AFFINITY_UPDATED, OBS_CATEGORIES.STRATEGY);
    this._sub(EventTopics.ARBITER_MODE_DEGRADED, OBS_CATEGORIES.DECISION);
    this._sub(EventTopics.BASELINE_ADJUSTED, OBS_CATEGORIES.STRATEGY);
    this._sub(EventTopics.CONVERGENCE_DRIFT, OBS_CATEGORIES.REPAIR);
    this._sub(EventTopics.AGENT_SUSPECT, OBS_CATEGORIES.REPAIR);
    this._sub(EventTopics.AGENT_CONFIRMED_DEAD, OBS_CATEGORIES.REPAIR);
    this._sub(EventTopics.MODE_SWITCHED, OBS_CATEGORIES.DECISION);
    this._sub(EventTopics.GOVERNANCE_REPORT, OBS_CATEGORIES.STRATEGY);

    // V5.6: 结构化编排事件 / Structured orchestration events
    this._sub(EventTopics.SPECULATIVE_TASK_STARTED, OBS_CATEGORIES.EXECUTION);
    this._sub(EventTopics.SPECULATIVE_TASK_RESOLVED, OBS_CATEGORIES.EXECUTION);
    this._sub(EventTopics.SPECULATIVE_TASK_CANCELLED, OBS_CATEGORIES.EXECUTION);
    this._sub(EventTopics.WORK_STEAL_COMPLETED, OBS_CATEGORIES.EXECUTION);
    this._sub(EventTopics.DAG_BRIDGE_ACTIVATED, OBS_CATEGORIES.DECISION);

    // V5.7: 共生调度 + 多类型信息素事件 / Skill symbiosis + multi-type pheromone events
    this._sub(EventTopics.SYMBIOSIS_COLLABORATION_RECORDED, OBS_CATEGORIES.STRATEGY);
    this._sub(EventTopics.SYMBIOSIS_PARTNER_RECOMMENDED, OBS_CATEGORIES.STRATEGY);
    this._sub(EventTopics.PHEROMONE_TYPE_REGISTERED, OBS_CATEGORIES.DECISION);
    this._sub(EventTopics.PHEROMONE_FOOD_ATTRACTION, OBS_CATEGORIES.DECISION);

    this._subscribed = true;
    this._logger.info?.(`[${SOURCE}] started — subscribing to observation events`);
  }

  /**
   * 停止观测
   */
  stop() {
    this._subscribed = false;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 手动记录 / Manual Recording
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * 手动记录观测事件 (用于没有 MessageBus 的场景)
   * Manually record an observation event
   *
   * @param {string} category - OBS_CATEGORIES.*
   * @param {string} eventType - 事件类型描述
   * @param {Object} [data] - 附加数据
   * @param {string} [turnId] - 关联 turn
   */
  observe(category, eventType, data, turnId) {
    if (!OBS_CATEGORIES[category?.toUpperCase?.()] && !Object.values(OBS_CATEGORIES).includes(category)) {
      return; // 无效类别
    }

    const normalizedCategory = OBS_CATEGORIES[category?.toUpperCase?.()] || category;

    const entry = {
      category: normalizedCategory,
      eventType,
      data: data || {},
      turnId: turnId || null,
      timestamp: Date.now(),
      _seq: this._seq++,
    };

    this._pushToBuffer(entry);
    this._counts[normalizedCategory] = (this._counts[normalizedCategory] || 0) + 1;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 查询 / Query
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * 获取最近的观测事件
   * Get recent observation events
   *
   * @param {Object} [options]
   * @param {string} [options.category] - 过滤类别
   * @param {number} [options.limit=50] - 最大返回数
   * @param {string} [options.turnId] - 过滤 turn
   * @returns {Array<Object>}
   */
  getRecent({ category, limit = 50, turnId } = {}) {
    let results = [...this._buffer];

    if (category) {
      results = results.filter(e => e.category === category);
    }
    if (turnId) {
      results = results.filter(e => e.turnId === turnId);
    }

    // 按时间倒序, 同时间用序列号 tiebreak
    results.sort((a, b) => b.timestamp - a.timestamp || b._seq - a._seq);

    return results.slice(0, limit);
  }

  /**
   * 获取指定 turn 的完整观测时间线
   * Get complete observation timeline for a turn
   *
   * @param {string} turnId
   * @returns {Array<Object>}
   */
  getTurnTimeline(turnId) {
    return this._buffer
      .filter(e => e.turnId === turnId)
      .sort((a, b) => a.timestamp - b.timestamp || a._seq - b._seq);
  }

  /**
   * 获取四类观测数据的摘要
   * Get summary of 4 observation categories
   *
   * @param {number} [windowMs=300000] - 时间窗口 (默认 5 分钟)
   * @returns {Object}
   */
  getSummary(windowMs = 300000) {
    const cutoff = Date.now() - windowMs;
    const recent = this._buffer.filter(e => e.timestamp > cutoff);

    const summary = {};
    for (const cat of Object.values(OBS_CATEGORIES)) {
      const catEvents = recent.filter(e => e.category === cat);
      summary[cat] = {
        count: catEvents.length,
        lastEvent: catEvents.length > 0
          ? catEvents.reduce((a, b) => a.timestamp > b.timestamp ? a : b).eventType
          : null,
        lastTimestamp: catEvents.length > 0
          ? Math.max(...catEvents.map(e => e.timestamp))
          : null,
      };
    }

    return summary;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 统计 / Statistics
  // ══════════════════════════════════════════════════════════════════════════

  getStats() {
    return {
      counts: { ...this._counts },
      totalEvents: Object.values(this._counts).reduce((a, b) => a + b, 0),
      bufferSize: this._buffer.length,
      bufferCapacity: MAX_EVENTS,
      subscribed: this._subscribed,
    };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 内部方法 / Internal
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * 订阅事件并自动归类
   * @private
   */
  _sub(topic, category) {
    if (!this._messageBus) return;
    try {
      this._messageBus.subscribe(topic, (event) => {
        const payload = event?.payload || event;
        this.observe(category, topic, {
          ...payload,
        }, payload?.turnId);
      });
    } catch { /* non-fatal */ }
  }

  /**
   * 推入环形缓冲区
   * @private
   */
  _pushToBuffer(entry) {
    if (this._buffer.length < MAX_EVENTS) {
      this._buffer.push(entry);
    } else {
      this._buffer[this._bufferIndex] = entry;
      this._bufferIndex = (this._bufferIndex + 1) % MAX_EVENTS;
    }
  }
}
