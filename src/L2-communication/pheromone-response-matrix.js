/**
 * PheromoneResponseMatrix — 信息素响应矩阵 / Pheromone Response Matrix
 *
 * V5.2: 实现信息素压力梯度和自动升压机制。
 * pending 任务滞留越久，信息素浓度自动升压，强制吸引空闲 agent。
 *
 * V5.2: Implements pheromone pressure gradient and auto-escalation.
 * The longer a pending task stalls, the higher the pheromone intensity,
 * automatically attracting idle agents.
 *
 * 核心公式 / Core formula:
 *   intensity = base_intensity * (1 + k * log(1 + age_minutes))
 *   当 intensity > escalation_threshold 时自动 emit recruit 信息素
 *
 * @module L2-communication/pheromone-response-matrix
 * @version 5.2.0
 * @author DEEP-IOS
 */

import { EventTopics, wrapEvent } from '../event-catalog.js';

// ============================================================================
// 常量 / Constants
// ============================================================================

/** 默认压力梯度系数 / Default pressure gradient coefficient */
const DEFAULT_K = 0.3;

/** 默认升压阈值 / Default escalation threshold */
const DEFAULT_ESCALATION_THRESHOLD = 0.9;

/** 最小扫描间隔 (ms) / Minimum scan interval */
const MIN_SCAN_INTERVAL_MS = 10000;

/** 默认扫描间隔 (ms) / Default scan interval */
const DEFAULT_SCAN_INTERVAL_MS = 30000;

const SOURCE = 'pheromone-response-matrix';

// ============================================================================
// PheromoneResponseMatrix
// ============================================================================

export class PheromoneResponseMatrix {
  /**
   * @param {Object} deps
   * @param {Object} deps.pheromoneEngine - PheromoneEngine 实例
   * @param {Object} deps.messageBus - MessageBus 实例
   * @param {Object} [deps.logger]
   * @param {Object} [deps.config] - 配置覆盖
   */
  constructor({ pheromoneEngine, messageBus, logger, config = {} }) {
    this._pheromoneEngine = pheromoneEngine;
    this._messageBus = messageBus;
    this._logger = logger || console;
    this._config = config;

    /** @type {Map<string, {createdAt: number, baseIntensity: number, scope: string}>} */
    this._pendingTasks = new Map();

    /** @type {number} 压力梯度系数 k */
    this._k = config.k ?? DEFAULT_K;

    /** @type {number} 升压阈值 */
    this._escalationThreshold = config.escalationThreshold ?? DEFAULT_ESCALATION_THRESHOLD;

    /** @type {number} 扫描间隔 */
    this._scanIntervalMs = Math.max(
      config.scanIntervalMs ?? DEFAULT_SCAN_INTERVAL_MS,
      MIN_SCAN_INTERVAL_MS
    );

    /** @type {NodeJS.Timeout | null} */
    this._scanTimer = null;

    /** @type {Object} 统计 */
    this._stats = {
      scans: 0,
      escalations: 0,
      recruitsEmitted: 0,
    };
  }

  // ━━━ 生命周期 / Lifecycle ━━━

  /**
   * 启动自动扫描
   * Start auto-escalation scanning
   */
  start() {
    if (this._scanTimer) return;
    this._subscribeToEvents();
    this._scanTimer = setInterval(() => this.autoEscalate(), this._scanIntervalMs);
    this._logger.info?.(`[${SOURCE}] started (k=${this._k}, threshold=${this._escalationThreshold}, interval=${this._scanIntervalMs}ms)`);
  }

  /**
   * 停止扫描
   * Stop scanning
   */
  stop() {
    if (this._scanTimer) {
      clearInterval(this._scanTimer);
      this._scanTimer = null;
    }
  }

  // ━━━ 任务注册 / Task Registration ━━━

  /**
   * 注册 pending 任务
   * Register a pending task for pressure tracking
   *
   * @param {string} taskId
   * @param {string} scope
   * @param {number} [baseIntensity=0.3]
   */
  registerPendingTask(taskId, scope, baseIntensity = 0.3) {
    if (!this._pendingTasks.has(taskId)) {
      this._pendingTasks.set(taskId, {
        createdAt: Date.now(),
        baseIntensity,
        scope,
      });
    }
  }

  /**
   * 移除已完成/已分配的任务
   * Remove completed/assigned task from tracking
   *
   * @param {string} taskId
   */
  removeTask(taskId) {
    this._pendingTasks.delete(taskId);
  }

  // ━━━ 自动升压 / Auto Escalation ━━━

  /**
   * 扫描所有 pending 任务，计算压力梯度，必要时 emit recruit 信息素
   * Scan all pending tasks, compute pressure gradient, emit recruit if needed
   *
   * @returns {{ scanned: number, escalated: number }}
   */
  autoEscalate() {
    this._stats.scans++;
    const now = Date.now();
    let escalated = 0;

    for (const [taskId, task] of this._pendingTasks) {
      const ageMinutes = (now - task.createdAt) / 60000;
      const pressureIntensity = this._computePressure(task.baseIntensity, ageMinutes);

      if (pressureIntensity > this._escalationThreshold) {
        // 自动升压: emit recruit 信息素
        this._pheromoneEngine.emitPheromone({
          type: 'recruit',
          sourceId: SOURCE,
          targetScope: task.scope,
          intensity: pressureIntensity,
          payload: { taskId, ageMinutes: Math.round(ageMinutes * 100) / 100, autoEscalated: true },
        });

        this._stats.escalations++;
        this._stats.recruitsEmitted++;
        escalated++;

        // 广播升压事件
        this._publish(EventTopics.PHEROMONE_ESCALATED, {
          taskId,
          scope: task.scope,
          ageMinutes: Math.round(ageMinutes * 100) / 100,
          pressureIntensity: Math.round(pressureIntensity * 10000) / 10000,
          threshold: this._escalationThreshold,
        });
      }
    }

    return { scanned: this._pendingTasks.size, escalated };
  }

  // ━━━ 压力计算 / Pressure Computation ━━━

  /**
   * 计算信息素压力梯度
   * Compute pheromone pressure gradient
   *
   * intensity = base * (1 + k * log(1 + age_minutes))
   *
   * @param {number} baseIntensity
   * @param {number} ageMinutes
   * @returns {number}
   */
  _computePressure(baseIntensity, ageMinutes) {
    return baseIntensity * (1 + this._k * Math.log(1 + ageMinutes));
  }

  /**
   * 查询任务当前压力值
   * Query current pressure for a task
   *
   * @param {string} taskId
   * @returns {{ pressure: number, ageMinutes: number } | null}
   */
  getTaskPressure(taskId) {
    const task = this._pendingTasks.get(taskId);
    if (!task) return null;

    const ageMinutes = (Date.now() - task.createdAt) / 60000;
    const pressure = this._computePressure(task.baseIntensity, ageMinutes);

    return {
      pressure: Math.round(pressure * 10000) / 10000,
      ageMinutes: Math.round(ageMinutes * 100) / 100,
    };
  }

  // ━━━ V5.7: Danger 密度查询 / Danger Density Query ━━━

  /**
   * V5.7: 查询指定范围内的 danger 信息素密度
   * V5.7: Query danger pheromone density in scope
   *
   * @param {string} targetScope
   * @returns {{ count: number, totalIntensity: number }}
   */
  getDangerDensity(targetScope) {
    const dangers = this._pheromoneEngine.read(targetScope, { type: 'danger' });
    return {
      count: dangers.length,
      totalIntensity: dangers.reduce((sum, d) => sum + d.intensity, 0),
    };
  }

  // ━━━ 统计 / Statistics ━━━

  getStats() {
    return {
      ...this._stats,
      trackedTasks: this._pendingTasks.size,
      k: this._k,
      escalationThreshold: this._escalationThreshold,
    };
  }

  // ━━━ 内部方法 / Internal ━━━

  _subscribeToEvents() {
    if (!this._messageBus) return;

    // 监听任务创建 → 注册
    this._messageBus.subscribe('task.created', (event) => {
      const p = event?.payload || event;
      if (p.taskId && p.scope) {
        this.registerPendingTask(p.taskId, p.scope, p.baseIntensity);
      }
    });

    // 监听任务完成/分配 → 移除
    this._messageBus.subscribe('task.completed', (event) => {
      const p = event?.payload || event;
      if (p.taskId) this.removeTask(p.taskId);

      // V5.7: food 信息素吸引 — 高质量完成任务发射 food 信息素
      if (this._config.foodAttraction !== false && p.taskId && p.scope && (p.quality ?? 0) >= 0.7) {
        try {
          this._pheromoneEngine.emitPheromone({
            type: 'food',
            sourceId: SOURCE,
            targetScope: p.scope,
            intensity: Math.min(p.quality || 0.5, 0.8),
            payload: { taskId: p.taskId, quality: p.quality, foodAttraction: true },
          });
          this._publish(EventTopics.PHEROMONE_FOOD_ATTRACTION, {
            taskId: p.taskId, scope: p.scope, quality: p.quality,
          });
          this._stats.foodEmitted = (this._stats.foodEmitted || 0) + 1;
        } catch { /* non-fatal */ }
      }
    });

    this._messageBus.subscribe('task.assigned', (event) => {
      const p = event?.payload || event;
      if (p.taskId) this.removeTask(p.taskId);
    });

    // V5.7: danger 信息素回避 — 失败任务发射 danger 信息素警告
    this._messageBus.subscribe('task.failed', (event) => {
      if (this._config.dangerAvoidance === false) return;
      const p = event?.payload || event;
      if (p.taskId && p.scope) {
        try {
          this._pheromoneEngine.emitPheromone({
            type: 'danger',
            sourceId: SOURCE,
            targetScope: p.scope,
            intensity: 0.8,
            payload: { taskId: p.taskId, failureReason: p.error, dangerAvoidance: true },
          });
          this._stats.dangerEmitted = (this._stats.dangerEmitted || 0) + 1;
        } catch { /* non-fatal */ }
      }
    });
  }

  _publish(topic, payload) {
    if (this._messageBus) {
      try {
        this._messageBus.publish(topic, wrapEvent(topic, payload, SOURCE));
      } catch { /* ignore */ }
    }
  }
}
