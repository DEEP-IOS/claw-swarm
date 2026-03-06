/**
 * SwarmOrchestrator — 蜂群编排器 / Swarm Orchestrator
 *
 * 核心协调层：管理任务生命周期、角色执行、工作并发、
 * 熔断器保护和治理感知分配。继承 EventEmitter 以发布细粒度生命周期事件。
 *
 * Core coordination layer that manages task lifecycle, role execution,
 * worker concurrency, circuit breaker protection, and governance-aware
 * allocation. Extends EventEmitter so callers can subscribe to
 * fine-grained lifecycle events.
 *
 * [WHY] v4.0 从 v3.0 移植，将熔断器逻辑提取到独立 CircuitBreaker 模块，
 * 降低 orchestrator 复杂度，并更新导入路径以适应分层架构。
 * Ported from v3.0 — circuit breaker logic extracted to standalone
 * CircuitBreaker module, reducing orchestrator complexity, with
 * import paths updated for the layered architecture.
 *
 * @module orchestration/orchestrator
 * @author DEEP-IOS
 */

import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { TaskStatus, RoleStatus } from '../../layer1-core/types.js';
import {
  SwarmError,
  SwarmValidationError,
  CircuitOpenError,
  SwarmDBError,
} from '../../layer1-core/errors.js';
import * as db from '../../layer1-core/db.js';
import { CircuitBreaker } from '../../layer1-core/circuit-breaker.js';

// ---------------------------------------------------------------------------
// 常量 / Constants
// ---------------------------------------------------------------------------

/** 关闭时等待活跃工作者的最大时间（毫秒）
 *  Maximum time (ms) to wait for active workers during shutdown. */
const SHUTDOWN_TIMEOUT_MS = 10_000;

/** 等待工作者槽位时的轮询间隔（毫秒）
 *  Polling interval (ms) while waiting for a worker slot. */
const WORKER_POLL_MS = 100;

// ---------------------------------------------------------------------------
// SwarmOrchestrator 类 / SwarmOrchestrator Class
// ---------------------------------------------------------------------------

/**
 * 编排蜂群任务的完整生命周期：创建、角色分配、并行执行（带并发限制）、
 * 结果聚合和熔断器保护。
 *
 * Orchestrates the full lifecycle of a swarm task: creation, role assignment,
 * parallel execution with concurrency limits, result aggregation, and circuit
 * breaker protection.
 *
 * 发出的事件 / Events emitted:
 *  - `task:created`   — { taskId, roles }
 *  - `task:started`   — { taskId }
 *  - `task:completed` — { taskId, results }
 *  - `task:failed`    — { taskId, error }
 *  - `task:cancelled` — { taskId }
 *  - `role:started`   — { taskId, role }
 *  - `role:completed` — { taskId, role, result }
 *  - `role:failed`    — { taskId, role, error }
 *  - `governance:allocation-failed`     — { error, taskDescription }
 *  - `governance:tier-change-recommended` — { taskId, agentId, currentTier, recommendedTier }
 */
export class SwarmOrchestrator extends EventEmitter {
  /**
   * 创建新的编排器实例 / Create a new orchestrator.
   *
   * @param {import('../../layer1-core/types.js').SwarmConfig & {
   *   roleManager:      import('./role-manager.js').RoleManager,
   *   taskDistributor:  import('./task-distributor.js').TaskDistributor,
   *   monitor?:         Object,
   * }} config
   */
  constructor(config) {
    super();

    /** @type {Object} */
    this.config = config;

    /** @type {import('./role-manager.js').RoleManager} */
    this.roleManager = config.roleManager;

    /** @type {import('./task-distributor.js').TaskDistributor} */
    this.taskDistributor = config.taskDistributor;

    /** @type {Object|undefined} */
    this.monitor = config.monitor;

    /** 当前正在执行角色的工作者数量 / Number of workers currently executing roles. */
    this.activeWorkers = 0;

    /** 并发工作者上限 / Upper bound on concurrent workers. */
    this.maxWorkers = config.maxWorkers || 16;

    /** 为 true 时不接受新任务 / When true, no new tasks will be accepted. */
    this.paused = false;

    // --- 熔断器 — 委托给独立 CircuitBreaker 模块 ---
    // --- Circuit breaker — delegated to standalone CircuitBreaker module ---
    /** @type {CircuitBreaker} */
    this.circuitBreaker = new CircuitBreaker(db, {
      failureThreshold: config.circuitThreshold || 5,
      cooldownMs: config.circuitTimeout || 60_000,
    });

    // --- 治理集成（v3.0，可选）/ Governance integration (v3.0, opt-in) ---
    /** @type {import('./governance/capability-engine.js').CapabilityEngine|null} */
    this.governance = config.governance || null;

    /** 治理感知分配和评估是否激活 / Whether governance-aware allocation and evaluation is active. */
    this.governanceEnabled = !!(config.governanceEnabled && this.governance);
  }

  // -----------------------------------------------------------------------
  // 公共 API — 任务生命周期 / Public API — Task Lifecycle
  // -----------------------------------------------------------------------

  /**
   * 创建新的蜂群任务 / Create a new swarm task.
   *
   * 1. 检查熔断器 / Check circuit breaker
   * 2. 验证输入 / Validate input
   * 3. 通过幂等键去重 / Deduplicate via idempotency key
   * 4. 生成并持久化角色 / Generate and persist roles
   * 5. 即发即忘执行 / Fire-and-forget execution
   *
   * @param {import('../../layer1-core/types.js').TaskConfig} taskConfig
   * @returns {Promise<{ taskId: string, roles: Array<{name: string, description: string}>, status: string }>}
   * @throws {CircuitOpenError}      熔断器打开时 / If the circuit breaker is open.
   * @throws {SwarmValidationError}  taskConfig 无效时 / If taskConfig is invalid.
   */
  async createTask(taskConfig) {
    // 1. 熔断器守卫 / Circuit breaker guard
    if (!this.circuitBreaker.canExecute()) {
      throw new CircuitOpenError(
        'Circuit breaker is open. Retry later.',
        { retryAfterMs: this.circuitBreaker.getState().cooldownMs },
      );
    }

    // 2. 验证 / Validate
    if (!taskConfig || !taskConfig.description) {
      throw new SwarmValidationError('Task config must include a description', {
        context: { taskConfig },
      });
    }

    const maxLen = this.config.safety?.maxDescriptionLength ?? 10_000;
    if (taskConfig.description.length > maxLen) {
      throw new SwarmValidationError(
        `Task description exceeds maximum length of ${maxLen} characters`,
        { context: { length: taskConfig.description.length, maxLen } },
      );
    }

    // 3. 幂等性检查 / Idempotency check
    if (taskConfig.idempotencyKey) {
      try {
        const existing = db.getDb().prepare(
          'SELECT id FROM swarm_tasks WHERE idempotency_key = ?',
        ).get(taskConfig.idempotencyKey);

        if (existing) {
          const task = db.getSwarmTask(existing.id);
          const roles = db.getSwarmRolesByTask(existing.id);
          return {
            taskId: existing.id,
            roles: roles.map((r) => ({ name: r.name, description: r.description })),
            status: task?.status || TaskStatus.PENDING,
          };
        }
      } catch (err) {
        throw new SwarmDBError(`Idempotency check failed: ${err.message}`, {
          cause: err,
          operation: 'createTask:idempotencyCheck',
        });
      }
    }

    // 4. 生成角色 / Generate roles
    const roles = this.roleManager.generateRoles(taskConfig);

    // 4b. 治理感知分配（非致命）/ Governance-aware allocation (non-fatal)
    let allocatedAgentId = null;
    if (this.governanceEnabled) {
      try {
        const availableAgents = this.governance.getAvailableAgents
          ? this.governance.getAvailableAgents()
          : [];
        if (availableAgents.length > 0) {
          const allocation = this.governance.allocateTask(taskConfig, availableAgents);
          if (allocation) {
            allocatedAgentId = allocation.agentId;
          }
        }
      } catch (err) {
        // 治理分配失败不影响核心流程 / Governance allocation failures are non-fatal
        this.emit('governance:allocation-failed', {
          error: err.message,
          taskDescription: taskConfig.description?.substring(0, 100),
        });
      }
    }

    // 5. 构建任务 ID 并持久化 / Build task ID and persist
    const taskId = `swarm-${Date.now()}-${randomUUID().substring(0, 8)}`;
    const strategyName = this.taskDistributor.getStrategyName();

    try {
      db.createSwarmTask(
        taskId,
        taskConfig,
        TaskStatus.INITIALIZING,
        strategyName,
        taskConfig.idempotencyKey || null,
      );

      for (const role of roles) {
        const roleId = `${taskId}-${role.name}-${randomUUID().substring(0, 6)}`;
        db.createSwarmRole(
          roleId,
          taskId,
          role.name,
          role.description,
          role.capabilities,
          role.priority,
          role.dependencies,
        );
      }
    } catch (err) {
      throw new SwarmDBError(`Failed to persist task: ${err.message}`, {
        cause: err,
        operation: 'createTask:persist',
      });
    }

    // 6. 发出创建事件 / Emit creation event
    this.emit('task:created', {
      taskId,
      roles: roles.map((r) => ({ name: r.name, description: r.description })),
    });

    // 7. 即发即忘执行 / Fire-and-forget execution
    this.executeTask(taskId, taskConfig, roles).catch((err) => {
      this.emit('task:failed', { taskId, error: err.message });
    });

    const result = {
      taskId,
      roles: roles.map((r) => ({ name: r.name, description: r.description })),
      status: TaskStatus.INITIALIZING,
    };

    if (allocatedAgentId) {
      result.allocatedAgentId = allocatedAgentId;
    }

    return result;
  }

  /**
   * 执行任务的所有角色（并行，遵守并发限制）
   * Execute all roles for a task in parallel, respecting concurrency limits.
   *
   * @param {string} taskId
   * @param {import('../../layer1-core/types.js').TaskConfig} taskConfig
   * @param {import('../../layer1-core/types.js').Role[]} roles
   * @returns {Promise<import('../../layer1-core/types.js').TaskResults>}
   */
  async executeTask(taskId, taskConfig, roles) {
    try {
      // 转为执行中状态 / Transition to executing
      db.updateSwarmTaskStatus(taskId, TaskStatus.EXECUTING);
      this.emit('task:started', { taskId });

      // 冻结依赖图 — 深拷贝防止外部修改 / Freeze the dependency graph — deep-copy
      const frozenRoles = JSON.parse(JSON.stringify(roles));
      Object.freeze(frozenRoles);

      // 并行执行所有角色（遵守工作者限制）/ Execute all roles in parallel
      const settled = await Promise.allSettled(
        frozenRoles.map((role) => this._executeRole(taskId, taskConfig, role)),
      );

      // 聚合结果 / Aggregate results
      const results = this._aggregateResults(settled);

      // 判断整体结果 / Determine overall outcome
      if (results.failed.length > 0 && results.completed.length === 0) {
        // 所有角色失败 / All roles failed
        const errorMsg = results.failed
          .map((f) => `${f.role}: ${f.error}`)
          .join('; ');

        db.updateSwarmTaskStatus(taskId, TaskStatus.FAILED, errorMsg);
        this.emit('task:failed', { taskId, error: errorMsg });
        this.circuitBreaker.recordFailure();
      } else {
        // 至少部分角色成功 / At least some roles succeeded
        db.updateSwarmTaskStatus(taskId, TaskStatus.COMPLETED);
        this.emit('task:completed', { taskId, results });
        this.circuitBreaker.recordSuccess();
      }

      // 任务后治理评估（非致命）/ Post-task governance evaluation (non-fatal)
      if (this.governanceEnabled) {
        this._evaluateGovernance(taskId, taskConfig, results).catch(() => {
          // 治理评估失败不影响核心流程 / Governance evaluation failures are non-fatal
        });
      }

      // 记录到监控器（如果可用）/ Record in monitor if available
      if (this.monitor && typeof this.monitor.record === 'function') {
        try {
          this.monitor.record(taskId, results);
        } catch {
          // 监控失败不影响核心流程 / Monitor failures are non-fatal
        }
      }

      return results;
    } catch (err) {
      db.updateSwarmTaskStatus(taskId, TaskStatus.FAILED, err.message);
      this.emit('task:failed', { taskId, error: err.message });
      this.circuitBreaker.recordFailure();
      throw err;
    }
  }

  /**
   * 取消正在运行或待处理的任务 / Cancel a running or pending task.
   *
   * @param {string} taskId
   * @returns {Promise<void>}
   */
  async cancelTask(taskId) {
    try {
      db.updateSwarmTaskStatus(taskId, TaskStatus.CANCELLED);
      this.emit('task:cancelled', { taskId });
    } catch (err) {
      throw new SwarmDBError(`Failed to cancel task: ${err.message}`, {
        cause: err,
        operation: 'cancelTask',
      });
    }
  }

  /**
   * 优雅关闭编排器 / Gracefully shut down the orchestrator.
   *
   * 设置暂停标志，等待活跃工作者排空（最多 10 秒），然后取消剩余执行中的任务。
   * Sets the paused flag, waits for active workers to drain (up to 10 s),
   * then cancels any remaining executing tasks.
   *
   * @returns {Promise<void>}
   */
  async shutdown() {
    this.paused = true;

    // 等待活跃工作者完成（最多 SHUTDOWN_TIMEOUT_MS）
    // Wait for active workers to finish (up to SHUTDOWN_TIMEOUT_MS)
    const deadline = Date.now() + SHUTDOWN_TIMEOUT_MS;
    while (this.activeWorkers > 0 && Date.now() < deadline) {
      await this._sleep(WORKER_POLL_MS);
    }

    // 取消剩余执行中的任务 / Cancel any remaining executing tasks
    try {
      const executing = db.listSwarmTasks(TaskStatus.EXECUTING);
      for (const task of executing) {
        await this.cancelTask(task.id);
      }
    } catch {
      // 关闭期间尽力而为 / Best-effort during shutdown
    }
  }

  // -----------------------------------------------------------------------
  // 内部方法 — 角色执行 / Internal — Role Execution
  // -----------------------------------------------------------------------

  /**
   * 在任务上下文中执行单个角色。等待空闲工作者槽位，递增活跃计数，
   * 委托给任务分发器，完成后保存检查点。
   *
   * Execute a single role within the context of a task. Waits for a free
   * worker slot, increments the active count, delegates to the task
   * distributor, and saves a checkpoint on completion.
   *
   * @param {string} taskId
   * @param {import('../../layer1-core/types.js').TaskConfig} taskConfig
   * @param {import('../../layer1-core/types.js').Role} role
   * @returns {Promise<{ role: string, status: string, result?: any, error?: string }>}
   * @private
   */
  async _executeRole(taskId, taskConfig, role) {
    // 等待工作者槽位 / Wait for a worker slot
    while (this.activeWorkers >= this.maxWorkers) {
      await this._sleep(WORKER_POLL_MS);
    }

    this.activeWorkers++;

    try {
      // 构建执行上下文 / Build execution context
      const context = {
        taskId,
        role,
        sharedMemory: {},
        timeout: this.config.roleTimeout || 30_000,
        taskConfig,
      };

      this.emit('role:started', { taskId, role: role.name });

      // 委托给策略（通过分发器）/ Delegate to the strategy via the distributor
      const result = await this.taskDistributor.distribute(role, context);

      // 保存检查点 / Save a checkpoint
      try {
        const cpId = `cp-${taskId}-${role.name}-${randomUUID().substring(0, 6)}`;
        db.saveSwarmCheckpoint(cpId, taskId, role.name, 'role_completed', {
          status: RoleStatus.COMPLETED,
          result,
          timestamp: Date.now(),
        });
      } catch {
        // 检查点失败不影响核心流程 / Checkpoint failures are non-fatal
      }

      this.emit('role:completed', { taskId, role: role.name, result });

      return { role: role.name, status: RoleStatus.COMPLETED, result };
    } catch (err) {
      const errorMsg = err.message || String(err);

      this.emit('role:failed', { taskId, role: role.name, error: errorMsg });

      return { role: role.name, status: RoleStatus.FAILED, error: errorMsg };
    } finally {
      this.activeWorkers--;
    }
  }

  // -----------------------------------------------------------------------
  // 内部方法 — 结果聚合 / Internal — Result Aggregation
  // -----------------------------------------------------------------------

  /**
   * 将 settled promise 结果聚合为结构化的 TaskResults 对象。
   * Aggregate settled promise results into a structured TaskResults object.
   *
   * @param {PromiseSettledResult<{role: string, status: string, result?: any, error?: string}>[]} settledResults
   * @returns {import('../../layer1-core/types.js').TaskResults}
   * @private
   */
  _aggregateResults(settledResults) {
    /** @type {import('../../layer1-core/types.js').TaskResults} */
    const results = {
      completed: [],
      failed: [],
      artifacts: {},
    };

    for (const settled of settledResults) {
      if (settled.status === 'fulfilled') {
        const value = settled.value;

        if (value.status === RoleStatus.COMPLETED) {
          results.completed.push(value);
          results.artifacts[value.role] = value.result;
        } else {
          results.failed.push(value);
        }
      } else {
        // Promise 本身被拒绝（意外）/ Promise itself rejected (unexpected)
        results.failed.push({
          role: 'unknown',
          status: RoleStatus.FAILED,
          error: settled.reason?.message || String(settled.reason),
        });
      }
    }

    return results;
  }

  // -----------------------------------------------------------------------
  // 内部方法 — 治理评估 / Internal — Governance Evaluation
  // -----------------------------------------------------------------------

  /**
   * 任务后治理评估：排队能力评估、检查层级变更、为分配的代理记录贡献。
   *
   * Post-task governance evaluation: enqueue capability evaluation,
   * check tier changes, and record contributions for allocated agents.
   *
   * @param {string} taskId
   * @param {import('../../layer1-core/types.js').TaskConfig} taskConfig
   * @param {import('../../layer1-core/types.js').TaskResults} results
   * @returns {Promise<void>}
   * @private
   */
  async _evaluateGovernance(taskId, taskConfig, results) {
    if (!this.governance) return;

    try {
      // 评估任务完成情况用于治理评分 / Evaluate task completion for governance scoring
      if (typeof this.governance.evaluateTaskCompletion === 'function') {
        const outcome = {
          taskId,
          completedRoles: results.completed?.length || 0,
          failedRoles: results.failed?.length || 0,
          totalRoles: (results.completed?.length || 0) + (results.failed?.length || 0),
          qualityScore: results.failed?.length === 0 ? 1.0 :
            (results.completed?.length || 0) / ((results.completed?.length || 0) + (results.failed?.length || 0)),
        };

        // 查找与此任务关联的代理 / Find agents associated with this task
        const task = db.getSwarmTask(taskId);
        const metadata = task?.config ? JSON.parse(task.config) : {};
        const agentId = metadata.allocatedAgentId;

        if (agentId) {
          await this.governance.evaluateTaskCompletion(agentId, taskConfig, outcome);

          // 检查层级变更建议 / Check for tier change recommendation
          if (typeof this.governance.evaluateTierChange === 'function') {
            const tierResult = this.governance.evaluateTierChange(agentId);
            if (tierResult && tierResult.recommended) {
              this.emit('governance:tier-change-recommended', {
                taskId,
                agentId,
                currentTier: tierResult.currentTier,
                recommendedTier: tierResult.recommendedTier,
              });
            }
          }
        }
      }
    } catch {
      // 所有治理评估错误都是非致命的 / All governance evaluation errors are non-fatal
    }
  }

  // -----------------------------------------------------------------------
  // 内部方法 — 工具函数 / Internal — Utilities
  // -----------------------------------------------------------------------

  /**
   * 基于 Promise 的 sleep 助手 / Promise-based sleep helper.
   *
   * @param {number} ms - 毫秒数 / Milliseconds to sleep.
   * @returns {Promise<void>}
   * @private
   */
  _sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
