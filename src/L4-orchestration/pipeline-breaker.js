/**
 * PipelineBreaker -- 9 态 FSM + 死信队列 / 9-State FSM + Dead Letter Queue
 *
 * v4.x 迁移增强: 从简单的 trip/reset 二态模型升级为完整的 9 态有限状态机,
 * 覆盖任务从创建到完成/死亡的完整生命周期。新增级联中止、重试退避、
 * 废弃率追踪以及状态转换历史记录。
 *
 * Migrated from v4.x and enhanced: upgraded from simple trip/reset binary model
 * to a full 9-state finite state machine covering the complete task lifecycle
 * from creation through completion or death. Added cascade abort, retry backoff,
 * waste tracking, and state transition history.
 *
 * [RESEARCH R2] Dead Letter Queue: 永久失败的任务不丢弃, 进入 "dead" 状态,
 * 保留完整上下文供诊断和手动重试。
 * Dead Letter Queue: permanently failed tasks are not discarded; they enter
 * "dead" state with full context preserved for diagnosis and manual retry.
 *
 * 9 种流水线状态 (PipelineState):
 *   pending -> scheduled -> running -> success
 *                                  \-> failed -> retrying -> running
 *                                  \-> paused -> running
 *                           failed -> dead (max retries exceeded)
 *                           retrying -> dead
 *
 * @module L4-orchestration/pipeline-breaker
 * @author DEEP-IOS
 */

import { PipelineState } from '../L1-infrastructure/types.js';

// ============================================================================
// 常量 / Constants
// ============================================================================

/**
 * 合法状态转换表 / Valid state transitions
 * 键为来源状态, 值为允许的目标状态集合。
 * Key = source state, value = set of allowed target states.
 * @type {Record<string, Set<string>>}
 */
const VALID_TRANSITIONS = Object.freeze({
  [PipelineState.pending]:   new Set([PipelineState.scheduled]),
  [PipelineState.scheduled]: new Set([PipelineState.running]),
  [PipelineState.running]:   new Set([PipelineState.success, PipelineState.failed, PipelineState.paused]),
  [PipelineState.paused]:    new Set([PipelineState.running, PipelineState.failed]),
  [PipelineState.success]:   new Set([PipelineState.completed]),
  [PipelineState.failed]:    new Set([PipelineState.retrying, PipelineState.dead]),
  [PipelineState.retrying]:  new Set([PipelineState.running, PipelineState.dead]),
  [PipelineState.completed]: new Set(),    // 终态, 不可转出 / Terminal, no outbound transitions
  [PipelineState.dead]:      new Set(),    // 终态, 不可转出 / Terminal, no outbound transitions
});

/**
 * 终态集合: 到达后不可再转换 / Terminal states: no further transitions allowed
 * @type {Set<string>}
 */
const TERMINAL_STATES = new Set([PipelineState.completed, PipelineState.dead]);

/** 死信队列最大容量 / Maximum DLQ capacity */
const DEFAULT_MAX_DLQ = 200;

/** 默认最大重试次数 / Default maximum retry count */
const DEFAULT_MAX_RETRIES = 3;

/** 转换历史最大保留条数 / Max transition history entries per task */
const MAX_HISTORY_PER_TASK = 50;

/** 默认关键任务类型 / Default critical task types */
const DEFAULT_CRITICAL_TYPES = new Set(['architect', 'infrastructure', 'core']);

// ============================================================================
// PipelineBreaker 类 / PipelineBreaker Class
// ============================================================================

/**
 * 9 态有限状态机流水线断路器。
 * 管理任务在流水线中的状态转换、失败重试、级联中止和死信队列。
 *
 * 9-state FSM pipeline breaker.
 * Manages task state transitions in the pipeline, failure retries,
 * cascade abort, and dead letter queue.
 *
 * @example
 * ```js
 * const breaker = new PipelineBreaker({ taskRepo, messageBus, config, logger });
 * breaker.transition('task-1', PipelineState.pending, PipelineState.scheduled);
 * breaker.transition('task-1', PipelineState.scheduled, PipelineState.running);
 * ```
 */
export class PipelineBreaker {
  /**
   * @param {Object} deps - 依赖注入 / Dependency injection
   * @param {Object} deps.taskRepo - 任务仓库 / Task repository
   * @param {import('../L2-communication/message-bus.js').MessageBus} deps.messageBus - 消息总线
   * @param {Object} [deps.config] - 配置 / Configuration
   * @param {number} [deps.config.maxRetries=3] - 最大重试次数 / Max retry attempts
   * @param {number} [deps.config.maxDLQ=200] - DLQ 最大容量 / Max DLQ size
   * @param {string[]} [deps.config.criticalTypes] - 关键任务类型 / Critical task types
   * @param {number} [deps.config.wasteThreshold=0.05] - 废弃率告警阈值 / Waste alert threshold
   * @param {Object} [deps.logger] - 日志器 / Logger
   */
  constructor({ taskRepo, messageBus, config = {}, logger } = {}) {
    /** @private */
    this._taskRepo = taskRepo;

    /** @private */
    this._messageBus = messageBus;

    /** @private */
    this._logger = logger || console;

    // ---- 配置 / Configuration ----
    /** @private @type {number} */
    this._maxRetries = config.maxRetries ?? DEFAULT_MAX_RETRIES;

    /** @private @type {number} */
    this._maxDLQ = config.maxDLQ ?? DEFAULT_MAX_DLQ;

    /** @private @type {Set<string>} */
    this._criticalTypes = new Set(config.criticalTypes || DEFAULT_CRITICAL_TYPES);

    /** @private @type {number} */
    this._wasteThreshold = config.wasteThreshold ?? 0.05;

    // ---- 内部状态 / Internal state ----

    /**
     * 任务当前状态映射: taskId -> PipelineState
     * Current state map: taskId -> PipelineState
     * @private @type {Map<string, string>}
     */
    this._states = new Map();

    /**
     * 任务失败计数: taskId -> retryCount
     * Failure count: taskId -> retryCount
     * @private @type {Map<string, number>}
     */
    this._retryCounts = new Map();

    /**
     * 任务失败错误记录: taskId -> lastError
     * Failure error record: taskId -> lastError
     * @private @type {Map<string, Object>}
     */
    this._lastErrors = new Map();

    /**
     * 死信队列: 永久失败的任务 / DLQ: permanently failed tasks
     * @private @type {Array<Object>}
     */
    this._deadLetterQueue = [];

    /**
     * 状态转换历史: taskId -> Array<{from, to, timestamp, reason}>
     * Transition history: taskId -> Array<{from, to, timestamp, reason}>
     * @private @type {Map<string, Array<Object>>}
     */
    this._transitionHistory = new Map();

    /**
     * 级联中止记录: taskId -> Set<abortedTaskId>
     * Cascade abort records: taskId -> Set<abortedTaskId>
     * @private @type {Map<string, Set<string>>}
     */
    this._cascadeAborts = new Map();

    /**
     * 任务依赖映射: taskId -> Set<dependentTaskId>
     * Task dependency map: taskId -> Set<dependentTaskId>
     * @private @type {Map<string, Set<string>>}
     */
    this._dependents = new Map();

    /**
     * 任务元数据: taskId -> { type, isCritical, createdAt }
     * Task metadata: taskId -> { type, isCritical, createdAt }
     * @private @type {Map<string, Object>}
     */
    this._taskMeta = new Map();

    // ---- 全局计数 / Global counters ----
    /** @private @type {number} */
    this._totalTasks = 0;
    /** @private @type {number} */
    this._abortedTasks = 0;
  }

  // =========================================================================
  // 公共 API / Public API
  // =========================================================================

  /**
   * 注册任务到断路器 (初始状态: pending)
   * Register a task with the breaker (initial state: pending)
   *
   * @param {string} taskId - 任务 ID
   * @param {Object} [meta] - 任务元数据
   * @param {string} [meta.type] - 任务类型 (用于判断是否关键)
   * @param {string[]} [meta.dependsOn] - 此任务依赖的任务 ID 列表
   * @returns {void}
   */
  register(taskId, meta = {}) {
    if (this._states.has(taskId)) {
      this._logger.warn?.(`[PipelineBreaker] 任务已注册 / Task already registered: ${taskId}`);
      return;
    }

    this._states.set(taskId, PipelineState.pending);
    this._retryCounts.set(taskId, 0);
    this._transitionHistory.set(taskId, []);
    this._totalTasks++;

    // 元数据 / Metadata
    const isCritical = this._criticalTypes.has(meta.type || '');
    this._taskMeta.set(taskId, {
      type: meta.type || 'unknown',
      isCritical,
      createdAt: Date.now(),
    });

    // 构建依赖图 / Build dependency graph
    if (meta.dependsOn && Array.isArray(meta.dependsOn)) {
      for (const depId of meta.dependsOn) {
        if (!this._dependents.has(depId)) {
          this._dependents.set(depId, new Set());
        }
        this._dependents.get(depId).add(taskId);
      }
    }

    this._logger.debug?.(`[PipelineBreaker] 注册任务 / Registered task: ${taskId} (type=${meta.type}, critical=${isCritical})`);
  }

  /**
   * 执行状态转换 / Perform state transition
   *
   * 验证来源状态和目标状态的合法性, 如果转换合法则更新状态并记录历史。
   * Validates source and target states; if the transition is valid,
   * updates the state and records the transition history.
   *
   * @param {string} taskId - 任务 ID
   * @param {string} fromState - 期望的当前状态 / Expected current state
   * @param {string} toState - 目标状态 / Target state
   * @param {string} [reason] - 转换原因 / Reason for transition
   * @returns {boolean} 转换是否成功 / Whether transition succeeded
   */
  transition(taskId, fromState, toState, reason) {
    // 获取当前状态 / Get current state
    const currentState = this._states.get(taskId);

    if (currentState === undefined) {
      this._logger.warn?.(`[PipelineBreaker] 未知任务 / Unknown task: ${taskId}`);
      return false;
    }

    // 校验来源状态 / Validate source state
    if (currentState !== fromState) {
      this._logger.warn?.(
        `[PipelineBreaker] 状态不匹配 / State mismatch: task=${taskId}, ` +
        `expected=${fromState}, actual=${currentState}`
      );
      return false;
    }

    // 校验转换合法性 / Validate transition legality
    const allowed = VALID_TRANSITIONS[fromState];
    if (!allowed || !allowed.has(toState)) {
      this._logger.warn?.(
        `[PipelineBreaker] 非法转换 / Invalid transition: ${fromState} -> ${toState} (task=${taskId})`
      );
      return false;
    }

    // 执行转换 / Execute transition
    this._states.set(taskId, toState);

    // 记录历史 / Record history
    const historyEntry = {
      from: fromState,
      to: toState,
      timestamp: Date.now(),
      reason: reason || null,
    };

    const history = this._transitionHistory.get(taskId) || [];
    history.push(historyEntry);
    if (history.length > MAX_HISTORY_PER_TASK) {
      history.shift();
    }
    this._transitionHistory.set(taskId, history);

    // 发布事件 / Publish event
    if (this._messageBus) {
      this._messageBus.publish('pipeline.transition', {
        taskId,
        from: fromState,
        to: toState,
        reason,
      });
    }

    // 处理特殊转换 / Handle special transitions
    this._handleSpecialTransition(taskId, fromState, toState, reason);

    this._logger.debug?.(
      `[PipelineBreaker] 状态转换 / Transition: task=${taskId}, ${fromState} -> ${toState}`
    );

    return true;
  }

  /**
   * 获取任务当前状态 / Get current state of a task
   *
   * @param {string} taskId
   * @returns {string|null} 当前 PipelineState 或 null / Current PipelineState or null
   */
  getState(taskId) {
    return this._states.get(taskId) || null;
  }

  /**
   * 判断关键任务失败是否应触发级联中止
   * Determine if a critical task failure should trigger cascade abort
   *
   * 条件: 任务被标记为 critical 且当前状态为 failed 或 dead。
   * Condition: task is marked critical and its current state is failed or dead.
   *
   * @param {string} taskId
   * @returns {boolean}
   */
  shouldAbortCascade(taskId) {
    const meta = this._taskMeta.get(taskId);
    if (!meta || !meta.isCritical) return false;

    const state = this._states.get(taskId);
    return state === PipelineState.failed || state === PipelineState.dead;
  }

  /**
   * 执行级联中止: 将所有依赖该任务的下游任务标记为 dead
   * Execute cascade abort: mark all downstream dependents as dead
   *
   * @param {string} failedTaskId - 失败的关键任务 ID / Failed critical task ID
   * @returns {{ abortedCount: number, abortedTasks: string[] }}
   */
  executeCascadeAbort(failedTaskId) {
    const abortedTasks = [];
    const visited = new Set();

    // BFS 遍历依赖树 / BFS traverse dependency tree
    const queue = [failedTaskId];
    visited.add(failedTaskId);

    while (queue.length > 0) {
      const current = queue.shift();
      const deps = this._dependents.get(current);

      if (!deps) continue;

      for (const depTaskId of deps) {
        if (visited.has(depTaskId)) continue;
        visited.add(depTaskId);

        const depState = this._states.get(depTaskId);

        // 只中止未完成的任务 / Only abort non-terminal tasks
        if (depState && !TERMINAL_STATES.has(depState)) {
          // 直接设为 dead (级联中止绕过正常 FSM)
          // Set directly to dead (cascade abort bypasses normal FSM)
          const oldState = depState;
          this._states.set(depTaskId, PipelineState.dead);

          const reason = `Cascade abort: critical task ${failedTaskId} failed`;

          // 记录历史 / Record history
          const history = this._transitionHistory.get(depTaskId) || [];
          history.push({
            from: oldState,
            to: PipelineState.dead,
            timestamp: Date.now(),
            reason,
          });
          this._transitionHistory.set(depTaskId, history);

          // 加入 DLQ / Add to DLQ
          this._addToDLQ(depTaskId, new Error(reason));

          abortedTasks.push(depTaskId);
          this._abortedTasks++;

          // 继续向下游传播 / Propagate downstream
          queue.push(depTaskId);
        }
      }
    }

    // 记录级联关系 / Record cascade relationship
    this._cascadeAborts.set(failedTaskId, new Set(abortedTasks));

    // 发布级联事件 / Publish cascade event
    if (this._messageBus) {
      this._messageBus.publish('pipeline.cascade_abort', {
        failedTaskId,
        abortedCount: abortedTasks.length,
        abortedTasks,
        wastePercent: this.getCascadeWaste().wastePercent,
      });
    }

    this._logger.info?.(
      `[PipelineBreaker] 级联中止 / Cascade abort: ${failedTaskId} -> ` +
      `${abortedTasks.length} tasks aborted`
    );

    return { abortedCount: abortedTasks.length, abortedTasks };
  }

  /**
   * 记录任务失败并判断是否应重试
   * Record task failure and determine if retry should occur
   *
   * @param {string} taskId
   * @param {Error|string} error - 失败错误 / Failure error
   * @returns {{ shouldRetry: boolean, retryCount: number }}
   */
  recordFailure(taskId, error) {
    const err = error instanceof Error ? error : new Error(String(error));
    const retryCount = (this._retryCounts.get(taskId) || 0) + 1;
    this._retryCounts.set(taskId, retryCount);
    this._lastErrors.set(taskId, {
      message: err.message,
      stack: err.stack,
      timestamp: Date.now(),
    });

    const shouldRetry = retryCount <= this._maxRetries;

    this._logger.info?.(
      `[PipelineBreaker] 失败记录 / Failure recorded: task=${taskId}, ` +
      `retry=${retryCount}/${this._maxRetries}, shouldRetry=${shouldRetry}`
    );

    // 如果不再重试, 加入 DLQ / If no more retries, add to DLQ
    if (!shouldRetry) {
      this._addToDLQ(taskId, err);
    }

    return { shouldRetry, retryCount };
  }

  /**
   * 获取死信队列中的所有任务
   * Get all tasks in the dead letter queue
   *
   * @returns {Array<{ taskId: string, error: string, state: string, retryCount: number, addedAt: number, meta: Object }>}
   */
  getDLQ() {
    return [...this._deadLetterQueue];
  }

  /**
   * 从死信队列中重试指定任务
   * Retry a specific task from the dead letter queue
   *
   * 将任务从 DLQ 中移除, 重置重试计数, 设为 pending 状态重新开始。
   * Removes the task from DLQ, resets retry count, sets to pending to restart.
   *
   * @param {string} taskId
   * @returns {{ success: boolean, message: string }}
   */
  retryFromDLQ(taskId) {
    const dlqIndex = this._deadLetterQueue.findIndex((item) => item.taskId === taskId);

    if (dlqIndex === -1) {
      return { success: false, message: `Task ${taskId} not found in DLQ` };
    }

    // 从 DLQ 移除 / Remove from DLQ
    this._deadLetterQueue.splice(dlqIndex, 1);

    // 重置状态 / Reset state
    this._states.set(taskId, PipelineState.pending);
    this._retryCounts.set(taskId, 0);
    this._lastErrors.delete(taskId);

    // 如果是被级联中止的, 减少中止计数 / Adjust abort count if cascade-aborted
    if (this._abortedTasks > 0) {
      this._abortedTasks--;
    }

    // 记录历史 / Record history
    const history = this._transitionHistory.get(taskId) || [];
    history.push({
      from: PipelineState.dead,
      to: PipelineState.pending,
      timestamp: Date.now(),
      reason: 'Retried from DLQ',
    });
    this._transitionHistory.set(taskId, history);

    // 发布事件 / Publish event
    if (this._messageBus) {
      this._messageBus.publish('pipeline.dlq_retry', { taskId });
    }

    this._logger.info?.(`[PipelineBreaker] DLQ 重试 / DLQ retry: task=${taskId}`);

    return { success: true, message: `Task ${taskId} moved from DLQ to pending` };
  }

  /**
   * 获取级联废弃率统计
   * Get cascade waste statistics
   *
   * 废弃率 = abortedTasks / totalTasks
   * Waste rate = abortedTasks / totalTasks
   *
   * @returns {{ wastePercent: number, abortedCount: number, totalCount: number }}
   */
  getCascadeWaste() {
    const total = this._totalTasks;
    const aborted = this._abortedTasks;
    const wastePercent = total > 0 ? Math.round((aborted / total) * 10000) / 100 : 0;

    return {
      wastePercent,
      abortedCount: aborted,
      totalCount: total,
    };
  }

  /**
   * 获取指定任务的状态转换历史
   * Get transition history for a specific task
   *
   * @param {string} taskId
   * @returns {Array<{ from: string, to: string, timestamp: number, reason: string|null }>}
   */
  getTransitionHistory(taskId) {
    return [...(this._transitionHistory.get(taskId) || [])];
  }

  /**
   * 获取任务的失败信息
   * Get failure information for a task
   *
   * @param {string} taskId
   * @returns {{ retryCount: number, lastError: Object|null, maxRetries: number }|null}
   */
  getFailureInfo(taskId) {
    if (!this._states.has(taskId)) return null;

    return {
      retryCount: this._retryCounts.get(taskId) || 0,
      lastError: this._lastErrors.get(taskId) || null,
      maxRetries: this._maxRetries,
    };
  }

  /**
   * 获取所有处于指定状态的任务
   * Get all tasks in a given state
   *
   * @param {string} state - PipelineState 值 / PipelineState value
   * @returns {string[]} 任务 ID 列表 / List of task IDs
   */
  getTasksByState(state) {
    const result = [];
    for (const [taskId, currentState] of this._states) {
      if (currentState === state) {
        result.push(taskId);
      }
    }
    return result;
  }

  /**
   * 获取断路器概览统计
   * Get breaker overview statistics
   *
   * @returns {Object} 统计概览
   */
  getStats() {
    const stateDistribution = {};
    for (const state of Object.values(PipelineState)) {
      stateDistribution[state] = 0;
    }
    for (const state of this._states.values()) {
      stateDistribution[state] = (stateDistribution[state] || 0) + 1;
    }

    return {
      totalTasks: this._totalTasks,
      activeTasks: this._states.size,
      stateDistribution,
      dlqSize: this._deadLetterQueue.length,
      cascadeWaste: this.getCascadeWaste(),
      maxRetries: this._maxRetries,
    };
  }

  /**
   * 清理已完成/已终止的任务记录 (释放内存)
   * Cleanup records for completed/dead tasks (free memory)
   *
   * @param {number} [maxAgeMs=3600000] - 最大保留时间 (默认 1 小时) / Max age in ms
   * @returns {number} 清理的任务数量 / Number of tasks cleaned
   */
  cleanup(maxAgeMs = 3_600_000) {
    const now = Date.now();
    let cleaned = 0;

    for (const [taskId, state] of this._states) {
      if (!TERMINAL_STATES.has(state)) continue;

      const meta = this._taskMeta.get(taskId);
      const lastTransition = this._getLastTransitionTime(taskId);
      const age = now - (lastTransition || meta?.createdAt || now);

      if (age > maxAgeMs) {
        this._states.delete(taskId);
        this._retryCounts.delete(taskId);
        this._lastErrors.delete(taskId);
        this._transitionHistory.delete(taskId);
        this._taskMeta.delete(taskId);
        this._dependents.delete(taskId);
        this._cascadeAborts.delete(taskId);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      this._logger.debug?.(`[PipelineBreaker] 清理 / Cleanup: ${cleaned} tasks removed`);
    }

    return cleaned;
  }

  // =========================================================================
  // 内部方法 / Internal Methods
  // =========================================================================

  /**
   * 处理特殊状态转换的副作用
   * Handle side-effects of special state transitions
   *
   * @private
   * @param {string} taskId
   * @param {string} fromState
   * @param {string} toState
   * @param {string} [reason]
   */
  _handleSpecialTransition(taskId, fromState, toState, reason) {
    // 进入 dead 状态 / Entering dead state
    if (toState === PipelineState.dead) {
      if (this._messageBus) {
        this._messageBus.publish('pipeline.task_dead', {
          taskId,
          reason,
          retryCount: this._retryCounts.get(taskId) || 0,
        });
      }
    }

    // 进入 failed 状态: 检查是否需要级联中止
    // Entering failed state: check if cascade abort needed
    if (toState === PipelineState.failed) {
      if (this.shouldAbortCascade(taskId)) {
        this._logger.info?.(
          `[PipelineBreaker] 关键任务失败, 触发级联中止 / ` +
          `Critical task failed, triggering cascade: ${taskId}`
        );
        this.executeCascadeAbort(taskId);
      }
    }

    // 进入 success 状态 / Entering success state
    if (toState === PipelineState.success) {
      if (this._messageBus) {
        this._messageBus.publish('pipeline.task_success', { taskId });
      }
    }

    // 进入 retrying 状态 / Entering retrying state
    if (toState === PipelineState.retrying) {
      if (this._messageBus) {
        this._messageBus.publish('pipeline.task_retrying', {
          taskId,
          retryCount: this._retryCounts.get(taskId) || 0,
        });
      }
    }
  }

  /**
   * 将任务加入死信队列
   * Add task to the dead letter queue
   *
   * @private
   * @param {string} taskId
   * @param {Error} error
   */
  _addToDLQ(taskId, error) {
    // 去重: 如果已在 DLQ 中则不重复添加
    // Deduplicate: skip if already in DLQ
    if (this._deadLetterQueue.some((item) => item.taskId === taskId)) {
      return;
    }

    const entry = {
      taskId,
      error: error.message,
      state: this._states.get(taskId) || PipelineState.dead,
      retryCount: this._retryCounts.get(taskId) || 0,
      addedAt: Date.now(),
      meta: this._taskMeta.get(taskId) || {},
    };

    this._deadLetterQueue.push(entry);

    // 维持最大容量 / Maintain max capacity
    while (this._deadLetterQueue.length > this._maxDLQ) {
      this._deadLetterQueue.shift();
    }

    this._logger.debug?.(
      `[PipelineBreaker] 加入 DLQ / Added to DLQ: task=${taskId}, ` +
      `dlqSize=${this._deadLetterQueue.length}`
    );
  }

  /**
   * 获取任务最后一次转换的时间戳
   * Get the timestamp of the last transition for a task
   *
   * @private
   * @param {string} taskId
   * @returns {number|null}
   */
  _getLastTransitionTime(taskId) {
    const history = this._transitionHistory.get(taskId);
    if (!history || history.length === 0) return null;
    return history[history.length - 1].timestamp;
  }
}
