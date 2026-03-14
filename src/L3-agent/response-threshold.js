/**
 * ResponseThreshold — 固定响应阈值模型 + PI 控制器 / Fixed Response Threshold Model + PI Controller
 *
 * V5.2: 每个 agent 有内在响应阈值，环境刺激超过阈值时触发行动。
 * PI 控制器动态调节阈值，维持目标活跃率。
 *
 * V5.2: Each agent has intrinsic response thresholds. When environmental
 * stimulus exceeds threshold, action is triggered. PI controller dynamically
 * adjusts thresholds to maintain target activity rate.
 *
 * PI 公式 / PI formula:
 *   error = target_activity_rate - actual_activity_rate
 *   threshold_new = threshold_old - Kp * error - Ki * integral(error)
 *
 * @module L3-agent/response-threshold
 * @version 5.2.0
 * @author DEEP-IOS
 */

import { EventTopics, wrapEvent } from '../event-catalog.js';

// ============================================================================
// 常量 / Constants
// ============================================================================

/** PI 控制器比例增益 / Proportional gain */
const DEFAULT_KP = 0.1;

/** PI 控制器积分增益 / Integral gain */
const DEFAULT_KI = 0.01;

/** 默认目标活跃率 / Default target activity rate */
const DEFAULT_TARGET_ACTIVITY = 0.6;

/** 阈值边界 / Threshold bounds */
const THRESHOLD_MIN = 0.05;
const THRESHOLD_MAX = 0.95;

/** 积分项抗饱和限制 / Anti-windup integral limit */
const INTEGRAL_MAX = 5.0;

const SOURCE = 'response-threshold';

// ============================================================================
// ResponseThreshold
// ============================================================================

export class ResponseThreshold {
  /**
   * @param {Object} deps
   * @param {Object} [deps.messageBus]
   * @param {Object} [deps.db] - Database for persistence
   * @param {Object} [deps.logger]
   * @param {Object} [deps.config]
   */
  constructor({ messageBus, db, logger, config = {} } = {}) {
    this._messageBus = messageBus || null;
    this._db = db || null;
    this._logger = logger || console;

    this._kp = config.kp ?? DEFAULT_KP;
    this._ki = config.ki ?? DEFAULT_KI;
    this._targetActivity = config.targetActivity ?? DEFAULT_TARGET_ACTIVITY;

    /** @type {Map<string, Map<string, {threshold: number, integral: number, activityRate: number}>>} agentId -> taskType -> state */
    this._thresholds = new Map();

    this._stats = { adjustments: 0, triggers: 0, checks: 0 };
  }

  // ━━━ 阈值查询 / Threshold Query ━━━

  /**
   * 获取 agent 对特定任务类型的响应阈值
   * Get agent's response threshold for a task type
   *
   * @param {string} agentId
   * @param {string} taskType
   * @returns {number} threshold value [0, 1]
   */
  getThreshold(agentId, taskType) {
    return this._getState(agentId, taskType).threshold;
  }

  /**
   * 检查刺激是否超过阈值（是否应该响应）
   * Check if stimulus exceeds threshold (should agent respond?)
   *
   * @param {string} agentId
   * @param {string} taskType
   * @param {number} stimulus - 环境刺激强度 [0, 1]
   * @returns {boolean}
   */
  shouldRespond(agentId, taskType, stimulus) {
    this._stats.checks++;
    const state = this._getState(agentId, taskType);
    const triggered = stimulus > state.threshold;

    if (triggered) {
      this._stats.triggers++;
      this._publish(EventTopics.THRESHOLD_TRIGGERED, {
        agentId, taskType, stimulus, threshold: state.threshold,
      });
    }

    return triggered;
  }

  // ━━━ PI 控制器 / PI Controller ━━━

  /**
   * 使用 PI 控制器调整阈值
   * Adjust threshold using PI controller
   *
   * 应在每轮 evolution 或定期调用。
   * Should be called on each evolution round or periodically.
   *
   * @param {string} agentId
   * @param {string} taskType
   * @param {number} actualActivityRate - 实际活跃率 [0, 1]
   * @returns {{ oldThreshold: number, newThreshold: number, error: number }}
   */
  adjust(agentId, taskType, actualActivityRate) {
    const state = this._getState(agentId, taskType);
    const oldThreshold = state.threshold;

    // PI 控制器
    const error = this._targetActivity - actualActivityRate;
    state.integral = Math.max(-INTEGRAL_MAX, Math.min(INTEGRAL_MAX, state.integral + error));
    state.activityRate = actualActivityRate;

    const adjustment = this._kp * error + this._ki * state.integral;
    state.threshold = Math.max(THRESHOLD_MIN, Math.min(THRESHOLD_MAX, oldThreshold - adjustment));

    this._stats.adjustments++;

    // 持久化
    this._persist(agentId, taskType, state);

    this._publish(EventTopics.THRESHOLD_ADJUSTED, {
      agentId, taskType,
      oldThreshold: Math.round(oldThreshold * 10000) / 10000,
      newThreshold: Math.round(state.threshold * 10000) / 10000,
      error: Math.round(error * 10000) / 10000,
      activityRate: actualActivityRate,
    });

    return {
      oldThreshold: Math.round(oldThreshold * 10000) / 10000,
      newThreshold: Math.round(state.threshold * 10000) / 10000,
      error: Math.round(error * 10000) / 10000,
    };
  }

  /**
   * 批量调整所有已知 agent 的阈值
   * Batch adjust all known agent thresholds
   *
   * @param {Function} getActivityRate - (agentId, taskType) => number
   * @returns {number} adjustments count
   */
  adjustAll(getActivityRate) {
    let count = 0;
    for (const [agentId, taskTypes] of this._thresholds) {
      for (const [taskType] of taskTypes) {
        const rate = getActivityRate(agentId, taskType);
        if (typeof rate === 'number') {
          this.adjust(agentId, taskType, rate);
          count++;
        }
      }
    }
    return count;
  }

  // ━━━ V7.0 §7: 闭环执行 / Closed-Loop Actuation ━━━

  /**
   * V7.0 §7+§23: 将 PI 控制器输出执行为 session 参数修改
   * Actuate PI controller adjustments as real session parameter changes
   *
   * 策略: 阈值 → 模型选择映射
   * - 低阈值 (< 0.3) → 需要强模型 (列表尾部, 高成本) — 活跃度不足
   * - 中阈值 (0.3-0.7) → 中档模型
   * - 高阈值 (> 0.7) → 便宜模型 (列表头部) — 活跃度充足, 节省成本
   *
   * Strategy: threshold → model selection mapping
   * Low threshold → strong model (agent needs more capability)
   * High threshold → cheap model (agent is performing well, save cost)
   *
   * @param {string} agentId
   * @param {string} sessionKey - 活跃 session key
   * @param {Object} relayClient - SwarmRelayClient 实例 (需有 patchSession 方法)
   * @param {Array<{id: string, costPerKToken?: number}>} availableModels - 可用模型列表 (按成本升序)
   * @returns {Promise<{ action: string, model?: string, threshold?: number, error?: string }>}
   */
  async actuate(agentId, sessionKey, relayClient, availableModels = []) {
    if (!relayClient?.patchSession || !sessionKey || availableModels.length < 2) {
      return { action: 'no_op', reason: 'insufficient_resources' };
    }

    // 获取 agent 的平均阈值
    const agentMap = this._thresholds.get(agentId);
    if (!agentMap || agentMap.size === 0) {
      return { action: 'no_op', reason: 'no_threshold_data' };
    }

    let avgThreshold = 0;
    let count = 0;
    for (const [, state] of agentMap) {
      avgThreshold += state.threshold;
      count++;
    }
    avgThreshold /= count;

    // 阈值到模型索引映射 / Threshold to model index mapping
    // 低阈值 → 高索引 (强模型, 贵), 高阈值 → 低索引 (弱模型, 便宜)
    const modelIndex = Math.min(
      availableModels.length - 1,
      Math.floor((1 - avgThreshold) * availableModels.length),
    );
    const selectedModel = availableModels[modelIndex];

    try {
      const result = await relayClient.patchSession(sessionKey, {
        model: selectedModel.id,
      });

      this._publish(EventTopics.THRESHOLD_ADJUSTED, {
        agentId,
        sessionKey,
        actuatedModel: selectedModel.id,
        avgThreshold: Math.round(avgThreshold * 10000) / 10000,
        action: 'model_switch',
      });

      this._logger.debug?.(
        `[ResponseThreshold] Actuated: agent=${agentId}, threshold=${avgThreshold.toFixed(3)}, model=${selectedModel.id}`,
      );

      return {
        action: 'model_switch',
        model: selectedModel.id,
        threshold: Math.round(avgThreshold * 10000) / 10000,
        patchResult: result.status,
      };
    } catch (err) {
      return { action: 'actuate_failed', error: err.message };
    }
  }

  // ━━━ 全局查询 / Global Query ━━━

  /**
   * 获取所有 agent 的阈值摘要
   * Get threshold summary for all agents
   */
  getSummary() {
    const result = [];
    for (const [agentId, taskTypes] of this._thresholds) {
      for (const [taskType, state] of taskTypes) {
        result.push({
          agentId, taskType,
          threshold: Math.round(state.threshold * 10000) / 10000,
          activityRate: Math.round(state.activityRate * 10000) / 10000,
        });
      }
    }
    return result;
  }

  getStats() {
    return { ...this._stats, trackedPairs: this._countPairs() };
  }

  // ━━━ 内部方法 / Internal ━━━

  _getState(agentId, taskType) {
    if (!this._thresholds.has(agentId)) {
      this._thresholds.set(agentId, new Map());
    }
    const agentMap = this._thresholds.get(agentId);
    if (!agentMap.has(taskType)) {
      // 尝试从 DB 加载
      const persisted = this._loadFromDb(agentId, taskType);
      agentMap.set(taskType, persisted || { threshold: 0.5, integral: 0, activityRate: 0 });
    }
    return agentMap.get(taskType);
  }

  _persist(agentId, taskType, state) {
    if (!this._db) return;
    try {
      const stmt = this._db.prepare(`
        INSERT INTO agent_thresholds (agent_id, task_type, threshold, integral, activity_rate, adjustments, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(agent_id, task_type) DO UPDATE SET
          threshold = excluded.threshold,
          integral = excluded.integral,
          activity_rate = excluded.activity_rate,
          adjustments = adjustments + 1,
          updated_at = excluded.updated_at
      `);
      stmt.run(agentId, taskType, state.threshold, state.integral, state.activityRate, this._stats.adjustments, Date.now());
    } catch { /* ignore DB errors */ }
  }

  _loadFromDb(agentId, taskType) {
    if (!this._db) return null;
    try {
      const row = this._db.prepare(
        'SELECT threshold, integral, activity_rate FROM agent_thresholds WHERE agent_id = ? AND task_type = ?'
      ).get(agentId, taskType);
      if (row) {
        return { threshold: row.threshold, integral: row.integral, activityRate: row.activity_rate };
      }
    } catch { /* ignore */ }
    return null;
  }

  _countPairs() {
    let count = 0;
    for (const m of this._thresholds.values()) count += m.size;
    return count;
  }

  _publish(topic, payload) {
    if (this._messageBus) {
      try {
        this._messageBus.publish(topic, wrapEvent(topic, payload, SOURCE));
      } catch { /* ignore */ }
    }
  }
}
