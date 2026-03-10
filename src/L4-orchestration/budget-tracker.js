/**
 * BudgetTracker — 五预算面 + 协作税追踪 / 5-Budget + Collaboration Tax Tracker
 *
 * V5.4: 追踪蜂群协作过程中的五维成本, 并计算协作税。
 * 每个 turn/task 记录五维预算消耗, 用于后续 ROI 决策。
 *
 * V5.4: Tracks 5-dimensional costs during swarm collaboration,
 * and computes collaboration tax per turn/task for ROI analysis.
 *
 * 五预算面 / 5 budget dimensions:
 *   latency       — 延迟 (ms): 蜂群协作增加的总延迟
 *   token         — Token 消耗: 协作引导/上下文注入消耗的 token 数
 *   coordination  — 协调开销: 消息数、路由判定次数
 *   observability — 观测开销: 事件发布、信号聚合次数
 *   repair        — 修复开销: 重试次数、修复尝试
 *
 * 协作税 / Collaboration Tax:
 *   collabTax = (协作模式总成本 - 直通模式基准成本) / 直通模式基准成本
 *   > 0 表示协作有额外成本 (税)
 *   < 0 表示协作节省了成本 (收益)
 *
 * @module L4-orchestration/budget-tracker
 * @version 5.4.0
 * @author DEEP-IOS
 */

import { EventTopics, wrapEvent } from '../event-catalog.js';

const SOURCE = 'budget-tracker';

// ============================================================================
// 常量 / Constants
// ============================================================================

/** 五预算维度 / 5 budget dimensions */
export const BUDGET_DIMENSIONS = {
  LATENCY:       'latency',
  TOKEN:         'token',
  COORDINATION:  'coordination',
  OBSERVABILITY: 'observability',
  REPAIR:        'repair',
};

/** Turn 记录最大容量 / Max turn records */
const MAX_RECORDS = 200;

/** 直通模式基准 (不触发蜂群时的基础开销估算) / Direct mode baseline estimates */
const DIRECT_BASELINES = {
  latency:       50,   // ms: 基础 hook 开销
  token:         30,   // tokens: 简短蜂群待命提示
  coordination:  1,    // 1 次路由判定
  observability: 1,    // 1 次信号聚合
  repair:        0,    // 无修复
};

// ============================================================================
// BudgetTracker 类 / BudgetTracker Class
// ============================================================================

export class BudgetTracker {
  /**
   * @param {Object} deps
   * @param {Object} [deps.messageBus]
   * @param {Object} [deps.logger]
   * @param {Object} [deps.config]
   * @param {Object} [deps.config.baselines] - 自定义基准
   */
  constructor({ messageBus, logger, config = {} } = {}) {
    this._messageBus = messageBus || null;
    this._logger = logger || console;
    this._baselines = { ...DIRECT_BASELINES, ...config.baselines };

    /** @type {Map<string, Object>} turn/task 级预算记录 */
    this._records = new Map();

    /** @type {Object} 全局累计 */
    this._totals = {
      latency: 0,
      token: 0,
      coordination: 0,
      observability: 0,
      repair: 0,
      turns: 0,
    };

    /** @type {Object} 统计 */
    this._stats = {
      recordsCreated: 0,
      taxComputations: 0,
      positiveROI: 0,    // 协作节省成本的次数
      negativeROI: 0,    // 协作增加成本的次数
    };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 预算记录 / Budget Recording
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * 开始一个 turn/task 的预算追踪
   * Start budget tracking for a turn/task
   *
   * @param {string} turnId
   * @param {Object} [meta] - { arbiterMode, taskId }
   * @returns {string} turnId
   */
  startTracking(turnId, meta = {}) {
    if (this._records.has(turnId)) return turnId;

    this._records.set(turnId, {
      turnId,
      arbiterMode: meta.arbiterMode || 'UNKNOWN',
      taskId: meta.taskId || null,
      budget: {
        latency: 0,
        token: 0,
        coordination: 0,
        observability: 0,
        repair: 0,
      },
      startTime: Date.now(),
      endTime: null,
      collabTax: null,
    });

    this._stats.recordsCreated++;
    this._totals.turns++;
    this._cleanupOld();

    return turnId;
  }

  /**
   * 记录单维度预算消耗
   * Record a single dimension cost
   *
   * @param {string} turnId
   * @param {string} dimension - BUDGET_DIMENSIONS.*
   * @param {number} amount - 消耗量
   */
  record(turnId, dimension, amount) {
    const rec = this._records.get(turnId);
    if (!rec) return;
    if (rec.budget[dimension] === undefined) return;

    const value = Math.max(0, amount);
    rec.budget[dimension] += value;
    this._totals[dimension] = (this._totals[dimension] || 0) + value;
  }

  /**
   * 批量记录多维度预算消耗
   * Record multiple dimensions at once
   *
   * @param {string} turnId
   * @param {Object} costs - { latency?, token?, coordination?, observability?, repair? }
   */
  recordBatch(turnId, costs) {
    if (!costs) return;
    for (const [dim, amount] of Object.entries(costs)) {
      if (typeof amount === 'number') {
        this.record(turnId, dim, amount);
      }
    }
  }

  /**
   * 结束 turn 追踪并计算协作税
   * End turn tracking and compute collaboration tax
   *
   * @param {string} turnId
   * @returns {Object|null} { budget, collabTax, breakdown }
   */
  endTracking(turnId) {
    const rec = this._records.get(turnId);
    if (!rec) return null;

    rec.endTime = Date.now();

    // 自动记录实际延迟
    if (rec.budget.latency === 0) {
      rec.budget.latency = rec.endTime - rec.startTime;
      this._totals.latency += rec.budget.latency;
    }

    // 计算协作税
    const taxResult = this._computeCollabTax(rec.budget);
    rec.collabTax = taxResult.tax;

    this._stats.taxComputations++;
    if (taxResult.tax < 0) {
      this._stats.positiveROI++;
    } else if (taxResult.tax > 0) {
      this._stats.negativeROI++;
    }

    this._publish(EventTopics.BUDGET_TURN_COMPLETED, {
      turnId,
      arbiterMode: rec.arbiterMode,
      budget: { ...rec.budget },
      collabTax: taxResult.tax,
      breakdown: taxResult.breakdown,
    });

    return {
      budget: { ...rec.budget },
      collabTax: taxResult.tax,
      breakdown: taxResult.breakdown,
    };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 协作税计算 / Collaboration Tax Computation
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * 计算协作税 (各维度独立计算后加权)
   * Compute collaboration tax (per-dimension then weighted)
   *
   * 公式: tax_dim = (actual - baseline) / baseline
   * 总税: mean(tax_dims)
   *
   * @param {Object} budget
   * @returns {{ tax: number, breakdown: Object }}
   * @private
   */
  _computeCollabTax(budget) {
    const breakdown = {};
    let totalTax = 0;
    let dimCount = 0;

    for (const [dim, baseline] of Object.entries(this._baselines)) {
      const actual = budget[dim] || 0;
      if (baseline > 0) {
        const dimTax = (actual - baseline) / baseline;
        breakdown[dim] = Math.round(dimTax * 10000) / 10000;
        totalTax += dimTax;
        dimCount++;
      } else {
        breakdown[dim] = actual > 0 ? actual : 0;
        if (actual > 0) {
          totalTax += actual;
          dimCount++;
        }
      }
    }

    const tax = dimCount > 0 ? Math.round((totalTax / dimCount) * 10000) / 10000 : 0;

    return { tax, breakdown };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 查询 / Query
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * 获取单个 turn 的预算记录
   * @param {string} turnId
   * @returns {Object|null}
   */
  getRecord(turnId) {
    const rec = this._records.get(turnId);
    if (!rec) return null;
    return {
      ...rec,
      budget: { ...rec.budget },
    };
  }

  /**
   * 获取全局累计预算
   * @returns {Object}
   */
  getTotals() {
    return { ...this._totals };
  }

  /**
   * 获取按仲裁模式分组的平均预算
   * Get average budget grouped by arbiter mode
   *
   * @returns {Object} { DIRECT: { avgLatency, avgToken, ... }, PREPLAN: { ... }, ... }
   */
  getAveragesByMode() {
    const groups = {};

    for (const rec of this._records.values()) {
      if (!rec.endTime) continue;
      const mode = rec.arbiterMode;
      if (!groups[mode]) {
        groups[mode] = { count: 0, latency: 0, token: 0, coordination: 0, observability: 0, repair: 0, totalTax: 0 };
      }
      const g = groups[mode];
      g.count++;
      g.latency += rec.budget.latency;
      g.token += rec.budget.token;
      g.coordination += rec.budget.coordination;
      g.observability += rec.budget.observability;
      g.repair += rec.budget.repair;
      g.totalTax += (rec.collabTax || 0);
    }

    const result = {};
    for (const [mode, g] of Object.entries(groups)) {
      if (g.count === 0) continue;
      result[mode] = {
        count: g.count,
        avgLatency: Math.round(g.latency / g.count),
        avgToken: Math.round(g.token / g.count),
        avgCoordination: Math.round((g.coordination / g.count) * 100) / 100,
        avgObservability: Math.round((g.observability / g.count) * 100) / 100,
        avgRepair: Math.round((g.repair / g.count) * 100) / 100,
        avgCollabTax: Math.round((g.totalTax / g.count) * 10000) / 10000,
      };
    }

    return result;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 统计 / Statistics
  // ══════════════════════════════════════════════════════════════════════════

  getStats() {
    return {
      ...this._stats,
      totals: { ...this._totals },
      activeRecords: this._records.size,
      avgCollabTax: this._stats.taxComputations > 0
        ? (() => {
            let total = 0;
            let count = 0;
            for (const rec of this._records.values()) {
              if (rec.collabTax !== null) { total += rec.collabTax; count++; }
            }
            return count > 0 ? Math.round((total / count) * 10000) / 10000 : 0;
          })()
        : 0,
    };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 内部方法 / Internal
  // ══════════════════════════════════════════════════════════════════════════

  _cleanupOld() {
    if (this._records.size <= MAX_RECORDS) return;
    const entries = [...this._records.entries()]
      .sort((a, b) => (a[1].startTime || 0) - (b[1].startTime || 0));
    const toRemove = entries.length - MAX_RECORDS;
    for (let i = 0; i < toRemove; i++) {
      this._records.delete(entries[i][0]);
    }
  }

  _publish(topic, payload) {
    if (!this._messageBus) return;
    try {
      this._messageBus.publish(topic, wrapEvent(topic, payload, SOURCE));
    } catch { /* non-fatal */ }
  }
}
