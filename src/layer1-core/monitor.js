/**
 * @fileoverview Claw-Swarm v4.0 - Layer 1 Core Monitor
 * @module layer1-core/monitor
 * @author DEEP-IOS
 *
 * 功能概述 / Function Overview:
 * ─────────────────────────────
 * 本模块提供 Claw-Swarm v4.0 核心层（Layer 1）的运行时监控与事件记录功能。
 * This module provides runtime monitoring and event recording for the Claw-Swarm v4.0 core layer (Layer 1).
 *
 * 包含内容 / Contents:
 *   - 环形缓冲区事件记录（可配置大小：minimal=100, default=1000, verbose=10000）
 *     Ring buffer event recording (configurable size: minimal=100, default=1000, verbose=10000)
 *   - 关键事件即时写入 + 普通事件批量写入（5 秒间隔）
 *     Critical event immediate writes + normal event batch writes (5s interval)
 *   - 治理事件 1/10 采样（高频事件降噪）
 *     Governance event 1/10 sampling (noise reduction for high-frequency events)
 *   - 任务状态查询（数据库优先，缓冲区回退）
 *     Task status queries (DB-first, buffer fallback)
 *   - 任务报告生成（含角色摘要与建议）
 *     Task report generation (with role summaries and recommendations)
 *   - 任务列表与最近事件查询
 *     Task listing and recent event queries
 *
 * 从 Swarm Lite v3.0 移植 / Ported from Swarm Lite v3.0:
 *   - 核心 Monitor 类结构与环形缓冲区逻辑
 *     Core Monitor class structure and ring buffer logic
 *   - CRITICAL_EVENT_TYPES 集合（含治理事件扩展）
 *     CRITICAL_EVENT_TYPES set (with governance event extensions)
 *
 * v4.0 变更 / Changes in v4.0:
 *   - 数据库函数名更新：saveSwarmCheckpoint, getSwarmTask 等
 *     DB function names updated: saveSwarmCheckpoint, getSwarmTask, etc.
 *   - 构造函数接受 database 实例参数（不再模块级导入 db）
 *     Constructor accepts database instance parameter (no module-level db import)
 *   - 双语注释 / Bilingual comments throughout
 */

// ============================================================================
// 辅助函数 / Helper Functions
// ============================================================================

/**
 * 生成检查点唯一 ID / Generate a unique checkpoint ID.
 *
 * 格式: cp-<时间戳>-<随机串>
 * Format: cp-<timestamp>-<random>
 *
 * @returns {string} 唯一 ID / unique ID
 */
function generateId() {
  return `cp-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

// ============================================================================
// 常量定义 / Constants
// ============================================================================

/**
 * 关键事件类型集合 / Critical event types set
 *
 * 这些事件类型会被立即写入数据库（而非批量写入），确保不会因
 * 进程崩溃或延迟而丢失关键状态变更。
 *
 * These event types are written to the database immediately (not batched),
 * ensuring critical state changes are not lost due to process crashes or delays.
 */
const CRITICAL_EVENT_TYPES = new Set([
  'task:completed',               // 任务完成 / task completed
  'task:failed',                  // 任务失败 / task failed
  'role:failed',                  // 角色失败 / role failed
  'governance:tier-changed',      // 治理层级变更 / governance tier changed
  'governance:agent-suspended',   // 代理被暂停 / agent suspended
  'governance:vote-closed',       // 投票关闭 / vote closed
]);

/**
 * 缓冲区大小映射表 / Buffer size map
 *
 * 根据监控模式（monitorMode）决定环形缓冲区的容量。
 * Determines the ring buffer capacity based on the monitor mode.
 *
 *   minimal  → 100   条目（低内存环境）/ entries (low-memory environments)
 *   default  → 1000  条目（常规运行）/ entries (normal operation)
 *   verbose  → 10000 条目（调试模式）/ entries (debug mode)
 */
const BUFFER_SIZE_MAP = {
  minimal: 100,
  verbose: 10000,
};
const DEFAULT_BUFFER_SIZE = 1000;

// ============================================================================
// Monitor 类 / Monitor Class
// ============================================================================

export class Monitor {
  /**
   * 创建监控器实例 / Create a Monitor instance.
   *
   * @param {Object|null} database
   *   数据库模块实例，需提供 saveSwarmCheckpoint / getSwarmTask / getSwarmRolesByTask /
   *   listSwarmTasks / getSwarmArtifactsByTask 方法。传入 null 时跳过数据库写入（测试用）。
   *
   *   DB module instance exposing saveSwarmCheckpoint / getSwarmTask / getSwarmRolesByTask /
   *   listSwarmTasks / getSwarmArtifactsByTask. Pass null to skip DB writes (for testing).
   *
   * @param {Object} config
   *   配置对象，至少应包含 monitorMode 字段。
   *   Configuration object; should contain at least the monitorMode field.
   * @param {string} [config.monitorMode='default']
   *   监控模式，决定缓冲区大小：'minimal' | 'default' | 'verbose'
   *   Monitor mode determining buffer size: 'minimal' | 'default' | 'verbose'
   */
  constructor(database, config) {
    /** @private 数据库实例 / database instance */
    this.db = database;

    /** @private 配置对象 / configuration object */
    this.config = config;

    // --- 环形缓冲区初始化 / Ring buffer initialization ---

    const mode = config.monitorMode || 'default';

    /** @private 缓冲区最大容量 / buffer maximum capacity */
    this.bufferSize = BUFFER_SIZE_MAP[mode] || DEFAULT_BUFFER_SIZE;

    /** @private 事件缓冲区 / event buffer */
    this.buffer = [];

    /** @private 缓冲区写入指针 / buffer write index */
    this.bufferIndex = 0;

    // --- 批量写入队列 / Batch write queue ---

    /** @private 待批量写入的事件队列 / pending batch write queue */
    this.batchQueue = [];

    /**
     * @private 批量写入定时器 / batch write interval timer
     *
     * 每 5 秒刷新一次批量队列到数据库。
     * Flushes the batch queue to the database every 5 seconds.
     */
    this.batchInterval = setInterval(() => this._flushBatch(), 5000);

    // 确保定时器不阻止进程退出 / Ensure the timer does not prevent process exit
    if (
      this.batchInterval &&
      typeof this.batchInterval === 'object' &&
      typeof this.batchInterval.unref === 'function'
    ) {
      this.batchInterval.unref();
    }

    // --- 治理事件采样 / Governance event sampling ---

    /** @private 治理事件采样计数器 / governance event sample counter */
    this._govSampleCounter = 0;

    /**
     * @private 治理事件采样率 / governance event sample rate
     *
     * 每 10 个非关键治理事件只记录 1 个，降低高频事件噪声。
     * Records 1 out of every 10 non-critical governance events to reduce noise.
     */
    this._govSampleRate = 10;
  }

  // --------------------------------------------------------------------------
  // 事件记录 / Event Recording
  // --------------------------------------------------------------------------

  /**
   * 记录一个事件 / Record an event.
   *
   * 将事件写入环形缓冲区，并根据事件类型决定写入策略：
   *   - 关键事件 → 立即写入数据库
   *   - 普通事件 → 加入批量队列
   *
   * Writes the event to the ring buffer and routes it based on type:
   *   - Critical events → immediate DB write
   *   - Normal events   → added to batch queue
   *
   * @param {Object} event - 事件对象 / event object
   * @param {string} event.type - 事件类型 / event type
   * @param {string} [event.taskId] - 关联任务 ID / associated task ID
   * @param {string} [event.role] - 关联角色名称 / associated role name
   */
  recordEvent(event) {
    // 添加时间戳 / Add timestamp
    const stamped = { ...event, timestamp: Date.now() };

    // 写入环形缓冲区 / Write to ring buffer
    if (this.buffer.length < this.bufferSize) {
      this.buffer.push(stamped);
    } else {
      this.buffer[this.bufferIndex] = stamped;
    }
    this.bufferIndex = (this.bufferIndex + 1) % this.bufferSize;

    // 路由：关键事件即时写入，其他进入批量队列
    // Route: critical events write immediately, others enter batch queue
    if (CRITICAL_EVENT_TYPES.has(stamped.type)) {
      this._writeEventImmediate(stamped);
    } else {
      this.batchQueue.push(stamped);
    }
  }

  /**
   * 记录治理事件（含采样逻辑）/ Record a governance event (with sampling).
   *
   * 关键治理事件会被完整记录；非关键治理事件以 1/10 的采样率记录，
   * 避免高频治理操作淹没事件缓冲区。
   *
   * Critical governance events are always recorded in full; non-critical
   * governance events are sampled at a 1/10 rate to prevent high-frequency
   * governance operations from flooding the event buffer.
   *
   * @param {Object} event - 治理事件对象 / governance event object
   * @param {string} event.type - 事件类型 / event type
   */
  recordGovernanceEvent(event) {
    // 关键治理事件直接完整记录 / Critical governance events recorded in full
    if (CRITICAL_EVENT_TYPES.has(event.type)) {
      this.recordEvent(event);
      return;
    }

    // 非关键治理事件：1/10 采样 / Non-critical: 1/10 sampling
    this._govSampleCounter++;
    if (this._govSampleCounter % this._govSampleRate === 0) {
      this.recordEvent({ ...event, sampled: true });
    }
  }

  // --------------------------------------------------------------------------
  // 数据库写入 / Database Writes
  // --------------------------------------------------------------------------

  /**
   * 立即将关键事件写入数据库 / Immediately write a critical event to the database.
   *
   * 使用 db.saveSwarmCheckpoint() 持久化（v4.0 命名，区别于 OME 的 saveCheckpoint）。
   * 数据库不可用时静默跳过。
   *
   * Uses db.saveSwarmCheckpoint() for persistence (v4.0 naming, distinct from OME's saveCheckpoint).
   * Silently skips when the database is unavailable.
   *
   * @private
   * @param {Object} event - 已添加时间戳的事件 / timestamped event
   */
  _writeEventImmediate(event) {
    if (!this.db) return;

    try {
      this.db.saveSwarmCheckpoint(
        generateId(),
        event.taskId || 'unknown',
        event.role || 'system',
        event.type,
        event,
      );
    } catch {
      // 写入失败不影响核心逻辑 / Write failure is non-fatal
    }
  }

  /**
   * 批量刷新事件队列到数据库 / Flush the batch event queue to the database.
   *
   * 定时器每 5 秒调用一次。将队列中的所有事件逐条写入数据库，
   * 写入后清空队列。队列为空或数据库不可用时直接返回。
   *
   * Called by the timer every 5 seconds. Writes all queued events to
   * the database one by one, then clears the queue. Returns immediately
   * if the queue is empty or the database is unavailable.
   *
   * @private
   */
  _flushBatch() {
    if (this.batchQueue.length === 0 || !this.db) return;

    // splice(0) 取出并清空队列 / splice(0) extracts and clears the queue
    const events = this.batchQueue.splice(0);

    for (const event of events) {
      try {
        this.db.saveSwarmCheckpoint(
          generateId(),
          event.taskId || 'unknown',
          event.role || 'system',
          event.type,
          event,
        );
      } catch {
        // 单条写入失败不影响其余事件 / Single write failure does not affect remaining events
      }
    }
  }

  // --------------------------------------------------------------------------
  // 查询方法 / Query Methods
  // --------------------------------------------------------------------------

  /**
   * 获取指定任务的状态 / Get the status of a specific task.
   *
   * 优先从数据库查询完整任务信息（含角色列表）；如果数据库不可用
   * 或查询失败，则回退到环形缓冲区中的事件推断状态。
   *
   * Queries the database first for complete task info (including roles);
   * falls back to inferring status from events in the ring buffer if the
   * database is unavailable or the query fails.
   *
   * @param {string} taskId - 任务 ID / task ID
   * @returns {{
   *   taskId: string,
   *   status: string,
   *   roles: Array,
   *   startTime: number|null,
   *   duration: number|null,
   * }} 任务状态对象 / task status object
   */
  getTaskStatus(taskId) {
    // 优先从数据库查询 / Prefer database query
    if (this.db) {
      try {
        const task = this.db.getSwarmTask(taskId);
        if (task) {
          const roles = this.db.getSwarmRolesByTask(taskId);
          const startTime = task.created_at
            ? new Date(task.created_at).getTime()
            : null;
          const duration = startTime ? Date.now() - startTime : null;

          return {
            taskId: task.id,
            status: task.status,
            roles,
            startTime,
            duration,
          };
        }
      } catch {
        // 数据库查询失败，回退到缓冲区 / DB query failed, fall back to buffer
      }
    }

    // 回退：从环形缓冲区推断 / Fallback: infer from ring buffer
    const taskEvents = this.buffer.filter((e) => e && e.taskId === taskId);
    const latestStatus =
      taskEvents.length > 0
        ? taskEvents[taskEvents.length - 1].type
        : 'unknown';
    const firstEvent = taskEvents.length > 0 ? taskEvents[0] : null;
    const startTime = firstEvent ? firstEvent.timestamp : null;
    const duration = startTime ? Date.now() - startTime : null;

    return { taskId, status: latestStatus, roles: [], startTime, duration };
  }

  /**
   * 生成指定任务的详细报告 / Generate a detailed report for a specific task.
   *
   * 报告包含任务基本信息、各角色执行摘要、产出物清单以及建议。
   * 优先从数据库获取数据；数据库不可用时从缓冲区构建简化报告。
   *
   * The report includes basic task info, role execution summaries, artifact
   * listings, and recommendations. Prefers database data; builds a simplified
   * report from the buffer when the database is unavailable.
   *
   * @param {string} taskId - 任务 ID / task ID
   * @returns {{
   *   taskId: string,
   *   status: string,
   *   startTime: number|null,
   *   duration: number|null,
   *   roles: Array<{name: string, status: string}>,
   *   artifacts: Array,
   *   recommendations: Array<string>,
   * }} 任务报告 / task report
   */
  getReport(taskId) {
    // 尝试从数据库获取完整报告数据 / Try to get full report data from database
    if (this.db) {
      try {
        const task = this.db.getSwarmTask(taskId);
        if (task) {
          const roles = this.db.getSwarmRolesByTask(taskId);
          const artifacts = this.db.getSwarmArtifactsByTask(taskId);
          const startTime = task.created_at
            ? new Date(task.created_at).getTime()
            : null;
          const duration = startTime ? Date.now() - startTime : null;

          // 生成建议 / Generate recommendations
          const recommendations = [];
          const failedRoles = (roles || []).filter(
            (r) => r.status === 'failed',
          );
          const completedRoles = (roles || []).filter(
            (r) => r.status === 'completed',
          );

          if (failedRoles.length > 0) {
            // 有角色失败时建议调查 / Recommend investigation when roles have failed
            recommendations.push(
              `${failedRoles.length} 个角色失败，建议检查错误日志 / ` +
                `${failedRoles.length} role(s) failed — review error logs`,
            );
          }

          if (task.status === 'failed') {
            // 任务整体失败时建议重试 / Recommend retry when the task itself failed
            recommendations.push(
              '任务失败，建议检查依赖和参数后重试 / ' +
                'Task failed — check dependencies and parameters before retrying',
            );
          }

          if (
            duration &&
            duration > 300000 &&
            completedRoles.length === (roles || []).length
          ) {
            // 超过 5 分钟的成功任务建议优化 / Suggest optimization for successful tasks over 5 minutes
            recommendations.push(
              '任务耗时超过 5 分钟，建议考虑并行化优化 / ' +
                'Task took over 5 minutes — consider parallelization for optimization',
            );
          }

          if (recommendations.length === 0) {
            recommendations.push(
              '一切正常 / Everything looks good',
            );
          }

          return {
            taskId: task.id,
            status: task.status,
            startTime,
            duration,
            roles: (roles || []).map((r) => ({
              name: r.name || r.role_name || r.id,
              status: r.status,
            })),
            artifacts: artifacts || [],
            recommendations,
          };
        }
      } catch {
        // 数据库查询失败，回退到缓冲区 / DB query failed, fall back to buffer
      }
    }

    // 回退：从缓冲区构建简化报告 / Fallback: build simplified report from buffer
    const taskEvents = this.buffer.filter((e) => e && e.taskId === taskId);
    const latestStatus =
      taskEvents.length > 0
        ? taskEvents[taskEvents.length - 1].type
        : 'unknown';
    const firstEvent = taskEvents.length > 0 ? taskEvents[0] : null;
    const startTime = firstEvent ? firstEvent.timestamp : null;
    const duration = startTime ? Date.now() - startTime : null;

    // 从事件中提取角色摘要 / Extract role summaries from events
    const roleMap = new Map();
    for (const event of taskEvents) {
      if (event.role && event.role !== 'system') {
        roleMap.set(event.role, { name: event.role, status: event.type });
      }
    }

    const recommendations = [];
    const failedEvents = taskEvents.filter(
      (e) => e.type === 'task:failed' || e.type === 'role:failed',
    );
    if (failedEvents.length > 0) {
      recommendations.push(
        `检测到 ${failedEvents.length} 个失败事件 / ` +
          `Detected ${failedEvents.length} failure event(s)`,
      );
    }
    if (recommendations.length === 0) {
      recommendations.push(
        '数据有限，建议启用数据库以获取更完整的报告 / ' +
          'Limited data — enable the database for more complete reports',
      );
    }

    return {
      taskId,
      status: latestStatus,
      startTime,
      duration,
      roles: Array.from(roleMap.values()),
      artifacts: [],
      recommendations,
    };
  }

  /**
   * 列出所有任务 / List all tasks.
   *
   * 支持可选的状态过滤器。优先从数据库查询；数据库不可用时
   * 从缓冲区中推断已知任务。
   *
   * Supports an optional status filter. Queries the database first;
   * infers known tasks from the buffer when the database is unavailable.
   *
   * @param {string|null} [filter=null]
   *   按状态过滤（如 'running', 'completed'）。null 表示不过滤。
   *   Filter by status (e.g., 'running', 'completed'). null means no filter.
   * @returns {Array<{id: string, status: string}>} 任务列表 / task list
   */
  listTasks(filter = null) {
    // 优先从数据库查询 / Prefer database query
    if (this.db) {
      try {
        const tasks = this.db.listSwarmTasks();
        if (tasks) {
          const list = tasks.map((t) => ({
            id: t.id,
            status: t.status,
          }));

          if (filter) {
            return list.filter((t) => t.status === filter);
          }
          return list;
        }
      } catch {
        // 数据库查询失败，回退到缓冲区 / DB query failed, fall back to buffer
      }
    }

    // 回退：从缓冲区推断 / Fallback: infer from buffer
    const taskMap = new Map();
    for (const event of this.buffer) {
      if (event && event.taskId) {
        // 每个任务保留最新事件的类型作为状态
        // Keep the latest event type as the task's status
        taskMap.set(event.taskId, event.type);
      }
    }

    let list = Array.from(taskMap.entries()).map(([id, status]) => ({
      id,
      status,
    }));

    if (filter) {
      list = list.filter((t) => t.status === filter);
    }

    return list;
  }

  /**
   * 获取最近的事件 / Get recent events from the ring buffer.
   *
   * 从环形缓冲区中按时间倒序返回最近的 N 个事件。
   * Returns the most recent N events from the ring buffer in reverse chronological order.
   *
   * @param {number} [count=20] - 返回的事件数量 / number of events to return
   * @returns {Array<Object>} 最近的事件列表 / list of recent events
   */
  getRecentEvents(count = 20) {
    // 过滤掉 null 槽位（缓冲区未满时可能存在）
    // Filter out null slots (may exist when the buffer is not yet full)
    const validEvents = this.buffer.filter((e) => e !== null && e !== undefined);

    // 按时间戳降序排列，取最近 count 条
    // Sort by timestamp descending, take the most recent `count` entries
    return validEvents
      .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
      .slice(0, count);
  }

  // --------------------------------------------------------------------------
  // 生命周期 / Lifecycle
  // --------------------------------------------------------------------------

  /**
   * 关闭监控器，释放资源 / Shut down the monitor and release resources.
   *
   * 清除批量写入定时器，并将剩余的批量队列刷新到数据库。
   * 此方法应在系统关闭时调用，以确保不丢失待写入的事件。
   *
   * Clears the batch write timer and flushes any remaining events in the
   * batch queue to the database. Should be called during system shutdown
   * to ensure no pending events are lost.
   */
  shutdown() {
    // 清除定时器 / Clear the interval timer
    if (this.batchInterval) {
      clearInterval(this.batchInterval);
      this.batchInterval = null;
    }

    // 刷新剩余批量事件 / Flush remaining batched events
    this._flushBatch();
  }
}
