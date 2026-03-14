/**
 * DualProcessRouter — System 1/2 双过程路由 / System 1/2 Dual-Process Router
 *
 * V6.0 新增模块: 基于认知心理学双过程理论自动选择决策路径。
 * V6.0 new module: Automatically selects decision path based on dual-process theory.
 *
 * System 1 (快速直觉 / Fast intuition):
 *   - 有疫苗匹配 | 断路器 CLOSED+成功率>90% | top-3 亲和度 | EXPLOIT 模式
 *   → DIRECT 模式: 跳过详细规划
 *
 * System 2 (慢速分析 / Slow analysis):
 *   - 新任务类型 | 断路器 HALF_OPEN | alarm 密度≥3 | EXPLORE 模式 | 质量 FAIL≥2
 *   → PREPLAN 模式: 启用证据门控, 增加质量层级
 *
 * @module L4-orchestration/dual-process-router
 * @author DEEP-IOS
 */

import { EventTopics, wrapEvent } from '../event-catalog.js';

// ============================================================================
// 常量 / Constants
// ============================================================================

/** System 1 触发条件权重 / System 1 trigger condition weights */
const S1_WEIGHTS = {
  hasVaccine: 0.30,         // 有匹配疫苗
  breakerClosed: 0.25,      // 断路器 CLOSED + 高成功率
  highAffinity: 0.20,       // 高亲和度
  exploitMode: 0.15,        // EXPLOIT 模式
  recentSuccess: 0.10,      // 最近成功
};

/** System 2 触发条件权重 / System 2 trigger condition weights */
const S2_WEIGHTS = {
  newTaskType: 0.25,        // 未见过的任务类型
  breakerHalfOpen: 0.20,    // 断路器半开
  highAlarmDensity: 0.20,   // alarm 信息素密度高
  exploreMode: 0.15,        // EXPLORE 模式
  qualityFailures: 0.20,    // 质量失败次数多
};

/** 路由阈值 / Routing thresholds */
const S1_THRESHOLD = 0.55;  // S1 分数 > 此值 → System 1
const S2_THRESHOLD = 0.50;  // S2 分数 > 此值 → System 2

// ============================================================================
// DualProcessRouter
// ============================================================================

export class DualProcessRouter {
  /**
   * @param {Object} deps
   * @param {Object} [deps.messageBus]
   * @param {Object} [deps.logger]
   * @param {Object} [deps.config]
   */
  constructor({ messageBus, logger, config = {} } = {}) {
    this._messageBus = messageBus || null;
    this._logger = logger || console;

    /** @type {Set<string>} 已见过的任务类型 / Seen task types */
    this._seenTaskTypes = new Set();

    /** @type {number} 路由决策计数 / Routing decision count */
    this._routeCount = 0;

    /** @type {{ system1: number, system2: number }} 统计 / Stats */
    this._stats = { system1: 0, system2: 0 };
  }

  // ━━━ 核心 API / Core API ━━━

  /**
   * 路由决策 / Route decision
   *
   * @param {Object} context - 路由上下文
   * @param {string} context.taskType - 任务类型
   * @param {boolean} [context.hasVaccine=false] - 是否有匹配疫苗
   * @param {string} [context.breakerState='CLOSED'] - 断路器状态
   * @param {number} [context.successRate=0.5] - 成功率 (0-1)
   * @param {number} [context.affinityRank=999] - 亲和度排名 (1=最高)
   * @param {string} [context.modulatorMode='RELIABLE'] - GlobalModulator 模式
   * @param {number} [context.alarmDensity=0] - alarm 信息素密度
   * @param {number} [context.qualityFailCount=0] - 质量失败次数
   * @param {boolean} [context.recentSuccess=false] - 最近任务是否成功
   * @returns {{ system: 1|2, mode: 'DIRECT'|'PREPLAN', s1Score: number, s2Score: number, triggers: string[] }}
   */
  route(context = {}) {
    this._routeCount++;

    const s1Score = this._computeS1Score(context);
    const s2Score = this._computeS2Score(context);

    let system, mode;
    const triggers = [];

    if (s2Score > S2_THRESHOLD && s2Score > s1Score) {
      system = 2;
      mode = 'PREPLAN';
      if (!this._seenTaskTypes.has(context.taskType)) triggers.push('new_task_type');
      if (context.breakerState === 'HALF_OPEN') triggers.push('breaker_half_open');
      if (context.alarmDensity >= 3) triggers.push('high_alarm_density');
      if (context.modulatorMode === 'EXPLORE') triggers.push('explore_mode');
      if (context.qualityFailCount >= 2) triggers.push('quality_failures');
      this._stats.system2++;
    } else {
      system = 1;
      mode = 'DIRECT';
      if (context.hasVaccine) triggers.push('has_vaccine');
      if (context.breakerState === 'CLOSED' && context.successRate > 0.9) triggers.push('breaker_healthy');
      if (context.affinityRank <= 3) triggers.push('high_affinity');
      if (context.modulatorMode === 'EXPLOIT') triggers.push('exploit_mode');
      this._stats.system1++;
    }

    // 标记任务类型为已见 / Mark task type as seen
    this._seenTaskTypes.add(context.taskType);

    const result = { system, mode, s1Score, s2Score, triggers };

    // 发布事件 / Publish event
    this._messageBus?.publish?.(EventTopics.DUAL_PROCESS_ROUTED, {
      ...result,
      taskType: context.taskType,
      routeCount: this._routeCount,
    });

    return result;
  }

  /**
   * 获取统计 / Get stats
   */
  getStats() {
    return {
      ...this._stats,
      total: this._routeCount,
      seenTaskTypes: this._seenTaskTypes.size,
      s1Ratio: this._routeCount > 0
        ? Math.round((this._stats.system1 / this._routeCount) * 100) / 100
        : 0,
    };
  }

  // ━━━ 内部方法 / Internal ━━━

  /**
   * 计算 System 1 分数 / Compute System 1 score
   * @private
   */
  _computeS1Score(ctx) {
    let score = 0;

    if (ctx.hasVaccine) score += S1_WEIGHTS.hasVaccine;
    if (ctx.breakerState === 'CLOSED' && (ctx.successRate || 0) > 0.9) {
      score += S1_WEIGHTS.breakerClosed;
    }
    if ((ctx.affinityRank || 999) <= 3) score += S1_WEIGHTS.highAffinity;
    if (ctx.modulatorMode === 'EXPLOIT') score += S1_WEIGHTS.exploitMode;
    if (ctx.recentSuccess) score += S1_WEIGHTS.recentSuccess;

    return Math.round(score * 1000) / 1000;
  }

  /**
   * 计算 System 2 分数 / Compute System 2 score
   * @private
   */
  _computeS2Score(ctx) {
    let score = 0;

    if (!this._seenTaskTypes.has(ctx.taskType)) score += S2_WEIGHTS.newTaskType;
    if (ctx.breakerState === 'HALF_OPEN') score += S2_WEIGHTS.breakerHalfOpen;
    if ((ctx.alarmDensity || 0) >= 3) score += S2_WEIGHTS.highAlarmDensity;
    if (ctx.modulatorMode === 'EXPLORE') score += S2_WEIGHTS.exploreMode;
    if ((ctx.qualityFailCount || 0) >= 2) score += S2_WEIGHTS.qualityFailures;

    return Math.round(score * 1000) / 1000;
  }
}
