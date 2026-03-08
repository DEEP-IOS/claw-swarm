/**
 * ReplanEngine -- 信息素驱动重规划引擎 / Pheromone-driven Replanning Engine
 *
 * V5.0 新增模块, 基于信息素 ALARM 密度触发重规划:
 * V5.0 new module, triggers replanning based on pheromone ALARM density:
 *
 * - 当 ALARM 信息素密度 >= 阈值时触发重规划
 *   When ALARM pheromone density >= threshold, trigger replan
 * - 指数退避: delay = baseDelay x 2^(replanCount), 防止频繁重规划抖动
 *   Exponential backoff: delay = baseDelay x 2^(replanCount), prevents thrashing
 * - 冷却期: 每次重规划后进入冷却, 期间不再触发
 *   Cooldown: after each replan, enter cooldown period, no triggers during it
 * - 基于重规划结果动态调整 MMAS 边界
 *   Dynamically adjust MMAS bounds based on replan outcomes
 * - 集成 PheromoneEngine 做 ALARM 密度检测
 *   Integrates with PheromoneEngine for ALARM density detection
 *
 * 设计来源 / Design source:
 * - design_communication_protocol.md: ALARM 密度 >= 3 → 触发重规划
 * - design_governance.md: 指数退避 + 冷却期 防抖动
 *
 * @module L4-orchestration/replan-engine
 * @author DEEP-IOS
 */

import { nanoid } from 'nanoid';
import { PheromoneType } from '../L1-infrastructure/types.js';

// ============================================================================
// 常量 / Constants
// ============================================================================

/** 默认 ALARM 密度阈值 / Default ALARM density threshold */
const DEFAULT_ALARM_THRESHOLD = 3;

/** 默认退避基础延迟 (ms) / Default backoff base delay */
const DEFAULT_BASE_DELAY_MS = 5000;

/** 最大退避延迟 (ms) / Maximum backoff delay */
const DEFAULT_MAX_DELAY_MS = 5 * 60 * 1000;

/** 默认冷却期 (ms) / Default cooldown period */
const DEFAULT_COOLDOWN_MS = 30_000;

/** 最大连续重规划次数 / Maximum consecutive replans before forced pause */
const DEFAULT_MAX_REPLANS = 10;

/** MMAS 边界调整幅度 / MMAS bounds adjustment magnitude */
const MMAS_ADJUST_STEP = 0.05;

/** MMAS 边界最小值下限 / MMAS minimum bound floor */
const MMAS_MIN_FLOOR = 0.01;

/** MMAS 边界最大值上限 / MMAS maximum bound ceiling */
const MMAS_MAX_CEILING = 1.00;

// ============================================================================
// 内部类型 / Internal Types
// ============================================================================

/**
 * @typedef {Object} ReplanState
 * 单任务的重规划状态 / Replan state for a single task
 * @property {number} replanCount - 已重规划次数 / Replan count
 * @property {number} lastReplanAt - 上次重规划时间戳 / Last replan timestamp
 * @property {number} cooldownUntil - 冷却截止时间戳 / Cooldown expiry timestamp
 * @property {number} currentDelayMs - 当前退避延迟 / Current backoff delay
 * @property {number} successCount - 成功重规划次数 / Successful replans
 * @property {number} failedCount - 失败重规划次数 / Failed replans
 */

/**
 * @typedef {Object} ReplanResult
 * 重规划结果 / Replan result
 * @property {boolean} replanned - 是否执行了重规划 / Whether replan was executed
 * @property {string} reason - 原因描述 / Reason description
 * @property {number} cooldownMs - 冷却时间 / Cooldown time in ms
 */

/**
 * @typedef {Object} ReplanCheckResult
 * 是否需要重规划的检查结果 / Check result for whether replan is needed
 * @property {boolean} should - 是否应该重规划 / Whether replan should happen
 * @property {number} alarmCount - ALARM 数量 / ALARM count
 * @property {number} density - ALARM 总强度 / ALARM total intensity
 */

// ============================================================================
// ReplanEngine 主类 / Main Class
// ============================================================================

export class ReplanEngine {
  /**
   * @param {Object} deps - 依赖注入 / Dependency injection
   * @param {import('../L2-communication/pheromone-engine.js').PheromoneEngine} deps.pheromoneEngine
   *   信息素引擎, 用于 ALARM 密度检测 / Pheromone engine for ALARM density detection
   * @param {import('./orchestrator.js').Orchestrator} [deps.orchestrator]
   *   编排器, 用于执行重规划 / Orchestrator for executing replans
   * @param {import('../L2-communication/message-bus.js').MessageBus} [deps.messageBus]
   *   消息总线 / Message bus for event broadcasting
   * @param {Object} [deps.config] - 重规划配置 / Replan config
   * @param {number} [deps.config.alarmThreshold=3] - ALARM 触发阈值 / ALARM trigger threshold
   * @param {number} [deps.config.baseDelayMs=5000] - 退避基础延迟 / Backoff base delay
   * @param {number} [deps.config.maxDelayMs=300000] - 最大退避延迟 / Max backoff delay
   * @param {number} [deps.config.cooldownMs=30000] - 冷却期 / Cooldown period
   * @param {number} [deps.config.maxReplans=10] - 最大连续重规划 / Max consecutive replans
   * @param {Object} [deps.logger]
   */
  constructor({ pheromoneEngine, orchestrator, messageBus, config, logger } = {}) {
    /** @type {import('../L2-communication/pheromone-engine.js').PheromoneEngine} */
    this._pheromoneEngine = pheromoneEngine;

    /** @type {import('./orchestrator.js').Orchestrator | null} */
    this._orchestrator = orchestrator || null;

    /** @type {import('../L2-communication/message-bus.js').MessageBus | null} */
    this._messageBus = messageBus || null;

    /** @type {Object} */
    this._logger = logger || console;

    // 配置 / Configuration
    const cfg = config || {};

    /** @type {number} */
    this._alarmThreshold = cfg.alarmThreshold ?? DEFAULT_ALARM_THRESHOLD;

    /** @type {number} */
    this._baseDelayMs = cfg.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;

    /** @type {number} */
    this._maxDelayMs = cfg.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;

    /** @type {number} */
    this._cooldownMs = cfg.cooldownMs ?? DEFAULT_COOLDOWN_MS;

    /** @type {number} */
    this._maxReplans = cfg.maxReplans ?? DEFAULT_MAX_REPLANS;

    /**
     * 每任务的重规划状态 / Per-task replan state
     * @type {Map<string, ReplanState>}
     */
    this._states = new Map();

    /**
     * 全局统计 / Global statistics
     * @type {{ totalReplans: number, successfulReplans: number, failedReplans: number }}
     */
    this._globalStats = {
      totalReplans: 0,
      successfulReplans: 0,
      failedReplans: 0,
    };
  }

  // ━━━ 核心 API / Core API ━━━

  /**
   * 检查并触发重规划 (主入口)
   * Check and trigger replan (main entry point)
   *
   * 流程 / Flow:
   * 1. 检测目标范围内 ALARM 密度 / Detect ALARM density in scope
   * 2. 若密度 >= 阈值 且 不在冷却期 → 触发重规划 / If density >= threshold and not in cooldown → replan
   * 3. 指数退避: delay = baseDelay x 2^(replanCount) / Exponential backoff
   * 4. 更新冷却状态 / Update cooldown state
   *
   * @param {string} taskId - 任务 ID / Task ID
   * @param {string} targetScope - 信息素范围 / Pheromone scope (e.g., 'task/abc123')
   * @returns {ReplanResult}
   */
  checkAndReplan(taskId, targetScope) {
    const state = this._getOrCreateState(taskId);

    // 检查是否超过最大重规划次数 / Check max replan limit
    if (state.replanCount >= this._maxReplans) {
      this._logger.warn?.(`[ReplanEngine] 任务 ${taskId} 达到最大重规划次数 ${this._maxReplans}`);
      return {
        replanned: false,
        reason: `max_replans_reached (${this._maxReplans})`,
        cooldownMs: 0,
      };
    }

    // 检查冷却期 / Check cooldown
    const now = Date.now();
    if (state.cooldownUntil > now) {
      const remainingMs = state.cooldownUntil - now;
      return {
        replanned: false,
        reason: `in_cooldown (${remainingMs}ms remaining)`,
        cooldownMs: remainingMs,
      };
    }

    // 检测 ALARM 密度 / Detect ALARM density
    const checkResult = this.shouldReplan(targetScope);

    if (!checkResult.should) {
      return {
        replanned: false,
        reason: `alarm_below_threshold (count=${checkResult.alarmCount}, threshold=${this._alarmThreshold})`,
        cooldownMs: 0,
      };
    }

    // 执行重规划 / Execute replan
    let newPlan = null;
    let success = false;

    try {
      newPlan = this.executeReplan(taskId, {
        targetScope,
        alarmCount: checkResult.alarmCount,
        alarmDensity: checkResult.density,
      });
      success = true;
    } catch (err) {
      this._logger.error?.(`[ReplanEngine] 重规划失败 / Replan failed for ${taskId}: ${err.message}`);
      success = false;
    }

    // 更新状态 / Update state
    state.replanCount++;
    state.lastReplanAt = now;
    this._globalStats.totalReplans++;

    if (success) {
      state.successCount++;
      this._globalStats.successfulReplans++;
    } else {
      state.failedCount++;
      this._globalStats.failedReplans++;
    }

    // 计算指数退避冷却 / Calculate exponential backoff cooldown
    const backoffDelay = this._computeBackoff(state.replanCount);
    const cooldownMs = Math.max(this._cooldownMs, backoffDelay);
    state.cooldownUntil = now + cooldownMs;
    state.currentDelayMs = cooldownMs;

    // 根据结果调整 MMAS 边界 / Adjust MMAS bounds based on outcome
    this._adjustMMASBounds(targetScope, success);

    // 广播事件 / Broadcast event
    this._emit('replan.completed', {
      taskId,
      targetScope,
      success,
      replanCount: state.replanCount,
      cooldownMs,
      alarmCount: checkResult.alarmCount,
      alarmDensity: checkResult.density,
      newPlanId: newPlan?.id || null,
    });

    return {
      replanned: true,
      reason: success ? 'alarm_threshold_met' : 'alarm_threshold_met_but_failed',
      cooldownMs,
    };
  }

  /**
   * 检查是否需要重规划 (不执行, 仅检测)
   * Check whether replan is needed (detection only, no execution)
   *
   * @param {string} targetScope - 目标范围 / Target scope
   * @returns {ReplanCheckResult}
   */
  shouldReplan(targetScope) {
    const { count, totalIntensity, triggered } = this._pheromoneEngine.getAlarmDensity(
      targetScope,
      this._alarmThreshold,
    );

    return {
      should: triggered,
      alarmCount: count,
      density: totalIntensity,
    };
  }

  /**
   * 执行重规划 (生成新计划)
   * Execute replan (generate new plan)
   *
   * 若 orchestrator 可用, 委托其重新规划;
   * 否则生成一个标记性重规划记录。
   *
   * If orchestrator is available, delegate replanning to it;
   * otherwise generate a placeholder replan record.
   *
   * @param {string} taskId - 任务 ID / Task ID
   * @param {Object} [options]
   * @param {string} [options.targetScope] - 目标范围 / Target scope
   * @param {number} [options.alarmCount] - ALARM 数量 / ALARM count
   * @param {number} [options.alarmDensity] - ALARM 密度 / ALARM density
   * @returns {Object} newPlan - 新计划 / New plan { id, taskId, createdAt, ... }
   */
  executeReplan(taskId, options = {}) {
    const planId = nanoid();
    const now = Date.now();

    this._logger.info?.(`[ReplanEngine] 执行重规划 / Executing replan: task=${taskId}, plan=${planId}`);

    // 广播重规划开始事件 / Broadcast replan start
    this._emit('replan.started', {
      taskId,
      planId,
      targetScope: options.targetScope,
      alarmCount: options.alarmCount,
      alarmDensity: options.alarmDensity,
    });

    // 如果编排器可用, 委托重规划 / If orchestrator available, delegate
    if (this._orchestrator && typeof this._orchestrator.replan === 'function') {
      const orchestratorPlan = this._orchestrator.replan(taskId, {
        reason: 'alarm_threshold',
        alarmCount: options.alarmCount,
        alarmDensity: options.alarmDensity,
      });

      return {
        id: planId,
        taskId,
        createdAt: now,
        source: 'orchestrator',
        data: orchestratorPlan,
      };
    }

    // 默认: 生成占位符重规划 / Default: generate placeholder replan
    return {
      id: planId,
      taskId,
      createdAt: now,
      source: 'replan-engine',
      data: {
        strategy: 'replan_from_alarm',
        alarmCount: options.alarmCount || 0,
        alarmDensity: options.alarmDensity || 0,
        targetScope: options.targetScope,
      },
    };
  }

  // ━━━ 冷却状态查询 / Cooldown Status Query ━━━

  /**
   * 获取指定任务的冷却状态
   * Get cooldown status for a given task
   *
   * @param {string} taskId
   * @returns {{ inCooldown: boolean, remainingMs: number, replanCount: number }}
   */
  getCooldownStatus(taskId) {
    const state = this._states.get(taskId);
    if (!state) {
      return { inCooldown: false, remainingMs: 0, replanCount: 0 };
    }

    const now = Date.now();
    const inCooldown = state.cooldownUntil > now;
    const remainingMs = inCooldown ? state.cooldownUntil - now : 0;

    return {
      inCooldown,
      remainingMs,
      replanCount: state.replanCount,
    };
  }

  // ━━━ 统计 / Statistics ━━━

  /**
   * 获取全局重规划统计
   * Get global replan statistics
   *
   * @returns {{ totalReplans: number, successfulReplans: number, failedReplans: number }}
   */
  getStats() {
    return { ...this._globalStats };
  }

  // ━━━ 重置 / Reset ━━━

  /**
   * 清除指定任务的重规划状态
   * Clear replan state for a specific task
   *
   * @param {string} taskId
   */
  reset(taskId) {
    this._states.delete(taskId);
    this._logger.info?.(`[ReplanEngine] 已重置任务 ${taskId} 的重规划状态 / Reset replan state for ${taskId}`);
  }

  /**
   * 重置所有状态和统计
   * Reset all state and statistics
   */
  resetAll() {
    this._states.clear();
    this._globalStats = {
      totalReplans: 0,
      successfulReplans: 0,
      failedReplans: 0,
    };
    this._logger.info?.('[ReplanEngine] 已重置所有重规划状态 / All replan states reset');
  }

  // ━━━ 内部方法 / Internal Methods ━━━

  /**
   * 获取或创建任务的重规划状态
   * Get or create replan state for a task
   *
   * @param {string} taskId
   * @returns {ReplanState}
   * @private
   */
  _getOrCreateState(taskId) {
    if (!this._states.has(taskId)) {
      this._states.set(taskId, {
        replanCount: 0,
        lastReplanAt: 0,
        cooldownUntil: 0,
        currentDelayMs: 0,
        successCount: 0,
        failedCount: 0,
      });
    }
    return this._states.get(taskId);
  }

  /**
   * 计算指数退避延迟
   * Compute exponential backoff delay
   *
   * delay = baseDelay x 2^(replanCount)
   * 上限为 maxDelayMs / Capped at maxDelayMs
   *
   * @param {number} replanCount - 已重规划次数 / Replan count
   * @returns {number} 延迟毫秒 / Delay in milliseconds
   * @private
   */
  _computeBackoff(replanCount) {
    const rawDelay = this._baseDelayMs * Math.pow(2, replanCount);
    return Math.min(rawDelay, this._maxDelayMs);
  }

  /**
   * 根据重规划结果调整 MMAS 边界
   * Adjust MMAS bounds based on replan outcome
   *
   * 成功: 收缩搜索空间 → 提高 τ_min (鼓励已知好路径)
   * Success: shrink search space → raise τ_min (encourage known good paths)
   *
   * 失败: 扩展搜索空间 → 降低 τ_min (鼓励探索)
   * Failure: expand search space → lower τ_min (encourage exploration)
   *
   * @param {string} targetScope - 信息素范围 / Pheromone scope
   * @param {boolean} success - 重规划是否成功 / Whether replan succeeded
   * @private
   */
  _adjustMMASBounds(targetScope, success) {
    if (!this._pheromoneEngine) return;

    try {
      const currentBounds = this._pheromoneEngine.getMMASBounds(PheromoneType.alarm);

      if (success) {
        // 成功: 提高 τ_min, 收缩空间 / Success: raise τ_min, shrink space
        const newMin = Math.min(
          currentBounds.mmasMin + MMAS_ADJUST_STEP,
          currentBounds.mmasMax - MMAS_ADJUST_STEP,
        );
        this._logger.info?.(
          `[ReplanEngine] MMAS τ_min 调整: ${currentBounds.mmasMin.toFixed(3)} → ${newMin.toFixed(3)} (成功/success)`,
        );

        this._emit('replan.mmasAdjusted', {
          targetScope,
          direction: 'shrink',
          oldMin: currentBounds.mmasMin,
          newMin,
        });
      } else {
        // 失败: 降低 τ_min, 扩展空间 / Failure: lower τ_min, expand space
        const newMin = Math.max(
          currentBounds.mmasMin - MMAS_ADJUST_STEP,
          MMAS_MIN_FLOOR,
        );
        this._logger.info?.(
          `[ReplanEngine] MMAS τ_min 调整: ${currentBounds.mmasMin.toFixed(3)} → ${newMin.toFixed(3)} (失败/failure)`,
        );

        this._emit('replan.mmasAdjusted', {
          targetScope,
          direction: 'expand',
          oldMin: currentBounds.mmasMin,
          newMin,
        });
      }
    } catch (err) {
      this._logger.warn?.(`[ReplanEngine] MMAS 边界调整失败 / MMAS bounds adjustment failed: ${err.message}`);
    }
  }

  /**
   * 发布消息总线事件
   * Publish to message bus
   *
   * @param {string} topic
   * @param {Object} data
   * @private
   */
  _emit(topic, data) {
    if (this._messageBus) {
      try {
        this._messageBus.publish(topic, data, { senderId: 'replan-engine' });
      } catch {
        // 忽略消息总线错误 / Ignore message bus errors
      }
    }
  }
}
