/**
 * BudgetForecaster — 预算预测 / Budget Forecasting
 *
 * V6.0 新增模块: 基于线性回归预测剩余预算消耗。
 * V6.0 new module: Predicts remaining budget consumption via linear regression.
 *
 * 公式 / Formula:
 * token_cost ~ task_complexity × agent_count × avg_turn_cost
 *
 * 基于部分执行进度预测剩余成本, 耗尽风险预警。
 * Predicts remaining cost based on partial execution progress, with exhaustion risk warning.
 *
 * @module L4-orchestration/budget-forecaster
 * @author DEEP-IOS
 */

import { EventTopics, wrapEvent } from '../event-catalog.js';

// ============================================================================
// BudgetForecaster
// ============================================================================

export class BudgetForecaster {
  /**
   * @param {Object} deps
   * @param {Object} [deps.messageBus]
   * @param {Object} [deps.logger]
   * @param {Object} [deps.config]
   */
  constructor({ messageBus, logger, config = {} } = {}) {
    this._messageBus = messageBus || null;
    this._logger = logger || console;

    this._exhaustionWarningMultiplier = config.exhaustionWarningMultiplier || 1.2;

    /** @type {Array<{turn: number, cost: number, timestamp: number}>} 消耗历史 / Cost history */
    this._costHistory = [];

    /** @type {number} 累计消耗 / Total consumed */
    this._totalConsumed = 0;
  }

  // ━━━ 核心 API / Core API ━━━

  /**
   * 记录一个 turn 的消耗 / Record cost for one turn
   *
   * @param {number} cost - Token 消耗
   * @param {number} [turn] - Turn 序号
   */
  recordCost(cost, turn) {
    const entry = {
      turn: turn || this._costHistory.length + 1,
      cost,
      timestamp: Date.now(),
    };
    this._costHistory.push(entry);
    this._totalConsumed += cost;

    // 限制历史长度 / Limit history
    if (this._costHistory.length > 500) {
      this._costHistory = this._costHistory.slice(-300);
    }
  }

  /**
   * 预测剩余预算消耗 / Forecast remaining budget consumption
   *
   * @param {Object} params
   * @param {number} params.totalBudget - 总预算 / Total budget
   * @param {number} [params.completionRatio] - 当前完成比例 (0-1) / Current completion ratio
   * @param {number} [params.remainingTasks] - 剩余任务数 / Remaining tasks
   * @returns {{ estimatedRemaining: number, confidence: number, exhaustionRisk: string, turnsLeft: number }}
   */
  forecast({ totalBudget, completionRatio, remainingTasks } = {}) {
    const remaining = totalBudget - this._totalConsumed;

    if (this._costHistory.length < 3) {
      return {
        estimatedRemaining: remaining,
        confidence: 0.2,
        exhaustionRisk: 'unknown',
        turnsLeft: remaining > 0 ? Infinity : 0,
      };
    }

    // 线性回归: y = mx + b (x=turn, y=cumulative cost)
    const { slope, intercept } = this._linearRegression();

    // 预测剩余消耗 / Predict remaining cost
    let estimatedTotal;
    if (completionRatio && completionRatio > 0.05) {
      // 基于完成比例推断 / Extrapolate from completion ratio
      estimatedTotal = this._totalConsumed / completionRatio;
    } else if (remainingTasks && slope > 0) {
      // 基于平均 turn 成本推断 / Extrapolate from avg turn cost
      const avgCostPerTurn = this._totalConsumed / this._costHistory.length;
      const estimatedTurnsNeeded = remainingTasks * 2; // 假设每个任务 ~2 turn
      estimatedTotal = this._totalConsumed + avgCostPerTurn * estimatedTurnsNeeded;
    } else {
      // 纯线性外推 / Pure linear extrapolation
      const currentTurn = this._costHistory.length;
      const projectedTurns = currentTurn * 2; // 假设还需要同样多 turn
      estimatedTotal = slope * projectedTurns + intercept;
    }

    const estimatedRemaining = Math.max(0, estimatedTotal - this._totalConsumed);
    const turnsLeft = slope > 0 ? Math.floor(remaining / slope) : Infinity;

    // 置信度 / Confidence
    const confidence = Math.min(0.9, this._costHistory.length / 50);

    // 耗尽风险 / Exhaustion risk
    let exhaustionRisk = 'low';
    if (estimatedRemaining * this._exhaustionWarningMultiplier > remaining) {
      exhaustionRisk = 'high';
      this._messageBus?.publish?.(
        EventTopics.BUDGET_EXHAUSTION_WARNING,
        wrapEvent(EventTopics.BUDGET_EXHAUSTION_WARNING, {
          remaining,
          estimatedRemaining,
          totalConsumed: this._totalConsumed,
          totalBudget,
          turnsLeft,
        }),
      );
    } else if (estimatedRemaining > remaining * 0.7) {
      exhaustionRisk = 'medium';
    }

    return {
      estimatedRemaining: Math.round(estimatedRemaining),
      confidence: Math.round(confidence * 100) / 100,
      exhaustionRisk,
      turnsLeft,
    };
  }

  /**
   * 获取消耗统计 / Get consumption stats
   */
  getStats() {
    const avgCost = this._costHistory.length > 0
      ? this._totalConsumed / this._costHistory.length
      : 0;

    return {
      totalConsumed: this._totalConsumed,
      turnCount: this._costHistory.length,
      avgCostPerTurn: Math.round(avgCost),
    };
  }

  // ━━━ 内部 / Internal ━━━

  /**
   * 简单线性回归 / Simple linear regression
   * @private
   * @returns {{ slope: number, intercept: number }}
   */
  _linearRegression() {
    const n = this._costHistory.length;
    if (n < 2) return { slope: 0, intercept: 0 };

    let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
    let cumulative = 0;

    for (let i = 0; i < n; i++) {
      cumulative += this._costHistory[i].cost;
      const x = i + 1;
      const y = cumulative;
      sumX += x;
      sumY += y;
      sumXY += x * y;
      sumXX += x * x;
    }

    const denom = n * sumXX - sumX * sumX;
    if (Math.abs(denom) < 1e-10) return { slope: 0, intercept: sumY / n };

    const slope = (n * sumXY - sumX * sumY) / denom;
    const intercept = (sumY - slope * sumX) / n;

    return { slope, intercept };
  }

  // ━━━ V7.0 §33: Budget 弹性调度 / Budget Elastic Scheduling ━━━

  /**
   * V7.0 §33: 推荐降级策略 — 预算紧张时自动降级模型或合并 phase
   * Recommend degradation strategy when budget is tight
   *
   * @param {number} remainingBudget - 剩余预算 / Remaining budget
   * @param {number} remainingPhases - 剩余 phase 数 / Remaining phases
   * @returns {{ action: string, targetModel?: string, reason: string } | null}
   */
  recommendDegradation(remainingBudget, remainingPhases) {
    if (remainingPhases <= 0 || remainingBudget <= 0) {
      return { action: 'halt', reason: 'no_budget_or_phases' };
    }

    const avgCostPerTurn = this._costHistory.length > 0
      ? this._totalConsumed / this._costHistory.length
      : 0;

    // 估算每个 phase 需要 ~3 turn / Estimate ~3 turns per phase
    const estimatedRemainingCost = avgCostPerTurn * remainingPhases * 3;

    if (estimatedRemainingCost <= 0) return null;

    const ratio = remainingBudget / estimatedRemainingCost;

    if (ratio < 0.3) {
      // 严重预算不足 → 合并 phase + 降级模型
      return {
        action: 'merge_phases',
        targetModel: 'haiku',
        reason: `budget_ratio=${ratio.toFixed(2)}, severe shortage`,
      };
    } else if (ratio < 0.7) {
      // 中度紧张 → 降级到便宜模型
      return {
        action: 'downgrade',
        targetModel: 'haiku',
        reason: `budget_ratio=${ratio.toFixed(2)}, moderate shortage`,
      };
    }

    return null; // 预算充足 / Budget sufficient
  }

  // ━━━ V7.0 §32: 任务市场定价 / Task Market Pricing ━━━

  /**
   * V7.0 §32: 基于历史数据估价任务 token 消耗
   * Price a task based on historical cost data
   *
   * @param {string} taskType - 任务类型 / Task type
   * @param {number} [complexity=0.5] - 任务复杂度 (0-1) / Complexity (0-1)
   * @returns {{ estimatedTokens: number, confidence: number, costFactor: number }}
   */
  priceTask(taskType, complexity = 0.5) {
    const avgCost = this._costHistory.length > 0
      ? this._totalConsumed / this._costHistory.length
      : 1000; // 默认 1000 tokens

    // 复杂度乘数: 0→0.5x, 0.5→1x, 1→2x
    const complexityMultiplier = 0.5 + complexity * 1.5;

    // 任务类型乘数 / Task type multiplier
    const typeMultipliers = {
      review: 0.8,
      test: 1.0,
      code: 1.5,
      architect: 2.0,
      debug: 1.3,
    };
    const typeMultiplier = typeMultipliers[taskType] || 1.0;

    const estimatedTokens = Math.round(avgCost * complexityMultiplier * typeMultiplier);
    const confidence = Math.min(0.9, this._costHistory.length / 30);

    return {
      estimatedTokens,
      confidence: Math.round(confidence * 100) / 100,
      costFactor: Math.round(complexityMultiplier * typeMultiplier * 100) / 100,
    };
  }
}
