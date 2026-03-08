/**
 * Orchestrator -- 核心任务编排器 / Core Task Orchestrator
 *
 * V5.0 L4 编排层核心, 从 v4.x orchestrator.js 迁移并升级:
 * V5.0 L4 orchestration layer core, migrated and upgraded from v4.x orchestrator.js:
 *
 * - 任务分解为子任务 DAG / Task decomposition into subtask DAG
 * - 拓扑排序 -> 分层执行 / Topological sort -> layer-by-layer execution
 * - 依赖解析 (等待前置完成) / Dependency resolution (wait for predecessors)
 * - Agent 分配 (预留 MoE/ABC 集成) / Agent assignment (placeholder for MoE/ABC)
 * - 层内并行+顺序执行 / Parallel and sequential execution within layers
 * - 每任务状态追踪 / Per-task status tracking
 *
 * 迁移原则 / Migration principles:
 * - 构造函数接收 { taskRepo, agentRepo, messageBus, config, logger }
 * - 事件通过 messageBus.publish() 发布
 * - 数据通过 Repository 模式访问
 *
 * @module L4-orchestration/orchestrator
 * @author DEEP-IOS
 */

import { nanoid } from 'nanoid';
import { TaskStatus, RoleStatus } from '../L1-infrastructure/types.js';

// ============================================================================
// 常量 / Constants
// ============================================================================

/** 默认任务超时 (ms) / Default task timeout */
const DEFAULT_TASK_TIMEOUT_MS = 5 * 60 * 1000;

/** 最大并行任务数 / Maximum parallel tasks */
const DEFAULT_MAX_PARALLEL = 5;

/** 最大重试次数 / Maximum retry count */
const DEFAULT_MAX_RETRIES = 2;

/** 分解策略默认值 / Decomposition defaults */
const DECOMPOSITION_DEFAULTS = {
  maxDepth: 3,
  maxSubtasks: 20,
};

// ============================================================================
// 内部类型 / Internal Types
// ============================================================================

/**
 * @typedef {Object} SubtaskNode
 * 子任务节点 / Subtask node in the DAG
 * @property {string} id - 子任务 ID
 * @property {string} name - 子任务名称
 * @property {string} description - 描述
 * @property {string[]} dependencies - 依赖的子任务 ID 列表
 * @property {string|null} assignedAgent - 分配的 Agent ID
 * @property {string} status - 当前状态
 * @property {Object|null} result - 执行结果
 * @property {number} priority - 优先级 (0-10)
 * @property {number} estimatedDuration - 预估时长 (ms)
 * @property {number} retryCount - 已重试次数
 * @property {number|null} startedAt - 开始时间戳
 * @property {number|null} completedAt - 完成时间戳
 */

/**
 * @typedef {Object} TaskExecution
 * 任务执行上下文 / Task execution context
 * @property {string} taskId - 根任务 ID
 * @property {Map<string, SubtaskNode>} subtasks - 子任务 DAG
 * @property {Array<string[]>} layers - 拓扑排序后的分层
 * @property {string} status - 整体状态
 * @property {number} startedAt - 开始时间戳
 * @property {number|null} completedAt - 完成时间戳
 * @property {AbortController} abortController - 取消控制器
 * @property {Object|null} finalResult - 最终合成结果
 */

// ============================================================================
// Orchestrator 主类 / Main Class
// ============================================================================

export class Orchestrator {
  /**
   * @param {Object} deps - 依赖注入 / Dependency injection
   * @param {import('../L1-infrastructure/database/repositories/task-repo.js').TaskRepository} deps.taskRepo
   * @param {import('../L1-infrastructure/database/repositories/agent-repo.js').AgentRepository} deps.agentRepo
   * @param {import('../L2-communication/message-bus.js').MessageBus} deps.messageBus
   * @param {Object} [deps.config] - 编排配置 / Orchestration config
   * @param {Object} [deps.logger] - 日志器 / Logger
   */
  constructor({ taskRepo, agentRepo, messageBus, config = {}, logger = console }) {
    /** @type {import('../L1-infrastructure/database/repositories/task-repo.js').TaskRepository} */
    this._taskRepo = taskRepo;

    /** @type {import('../L1-infrastructure/database/repositories/agent-repo.js').AgentRepository} */
    this._agentRepo = agentRepo;

    /** @type {import('../L2-communication/message-bus.js').MessageBus} */
    this._messageBus = messageBus;

    /** @type {Object} */
    this._config = {
      taskTimeoutMs: config.taskTimeoutMs || DEFAULT_TASK_TIMEOUT_MS,
      maxParallel: config.maxParallel || DEFAULT_MAX_PARALLEL,
      maxRetries: config.maxRetries || DEFAULT_MAX_RETRIES,
      maxSubtasks: config.maxSubtasks || DECOMPOSITION_DEFAULTS.maxSubtasks,
      maxDepth: config.maxDepth || DECOMPOSITION_DEFAULTS.maxDepth,
      ...config,
    };

    /** @type {Object} */
    this._logger = logger;

    /**
     * 活跃任务执行上下文 / Active task execution contexts
     * @type {Map<string, TaskExecution>}
     */
    this._executions = new Map();

    /**
     * 外部任务执行器 (可插拔) / External task executor (pluggable)
     * 由上层 (L5 PluginAdapter) 注入
     * @type {((subtask: SubtaskNode, context: Object) => Promise<Object>) | null}
     */
    this._executor = null;

    /**
     * 外部分解器 (可插拔) / External decomposer (pluggable)
     * @type {((rootTask: Object) => Promise<SubtaskNode[]>) | null}
     */
    this._decomposer = null;

    this._logger.info?.('[Orchestrator] 初始化完成 / Initialized');
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 配置 / Configuration
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  /**
   * 注册外部任务执行器
   * Register an external task executor
   *
   * 用于 L5 PluginAdapter 注入实际的 Agent spawning 逻辑。
   * Used by L5 PluginAdapter to inject actual Agent spawning logic.
   *
   * @param {(subtask: SubtaskNode, context: Object) => Promise<Object>} executor
   */
  setExecutor(executor) {
    this._executor = executor;
    this._logger.debug?.('[Orchestrator] 外部执行器已注册 / External executor registered');
  }

  /**
   * 注册外部任务分解器
   * Register an external task decomposer
   *
   * 用于 MoE/ExecutionPlanner 注入智能分解逻辑。
   * Used by MoE/ExecutionPlanner to inject intelligent decomposition logic.
   *
   * @param {(rootTask: Object) => Promise<SubtaskNode[]>} decomposer
   */
  setDecomposer(decomposer) {
    this._decomposer = decomposer;
    this._logger.debug?.('[Orchestrator] 外部分解器已注册 / External decomposer registered');
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 任务分解 / Task Decomposition
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  /**
   * 将根任务分解为子任务 DAG
   * Decompose a root task into a subtask DAG
   *
   * 如果注册了外部分解器则使用外部逻辑, 否则从数据库角色数据构建。
   * Uses external decomposer if registered, otherwise builds from DB role data.
   *
   * @param {Object} rootTask - 根任务配置 / Root task configuration
   * @param {string} rootTask.id - 任务 ID
   * @param {string} [rootTask.description] - 任务描述
   * @param {Array} [rootTask.roles] - 预定义角色列表
   * @returns {Promise<{ taskId: string, subtasks: Map<string, SubtaskNode> }>}
   */
  async decompose(rootTask) {
    const taskId = rootTask.id || nanoid();

    this._logger.info?.(`[Orchestrator] 开始分解任务 / Decomposing task: ${taskId}`);

    let subtaskNodes;

    // 优先使用外部分解器 / Prefer external decomposer
    if (this._decomposer) {
      const rawSubtasks = await this._decomposer(rootTask);
      subtaskNodes = this._normalizeSubtasks(rawSubtasks, taskId);
    } else if (rootTask.roles && rootTask.roles.length > 0) {
      // 从预定义角色构建 / Build from predefined roles
      subtaskNodes = this._buildFromRoles(rootTask.roles, taskId);
    } else {
      // 从数据库角色数据构建 / Build from DB role data
      subtaskNodes = await this._buildFromDatabase(taskId);
    }

    // 验证 DAG 无环 / Validate DAG is acyclic
    const subtaskMap = new Map(subtaskNodes.map((n) => [n.id, n]));
    this._validateDAG(subtaskMap);

    // 限制子任务数量 / Enforce subtask count limit
    if (subtaskMap.size > this._config.maxSubtasks) {
      throw new Error(
        `子任务数量超限 / Subtask count ${subtaskMap.size} exceeds limit ${this._config.maxSubtasks}`,
      );
    }

    // 持久化到数据库 / Persist to database
    for (const node of subtaskMap.values()) {
      this._taskRepo.createRole(
        node.id,
        taskId,
        node.name,
        node.description,
        JSON.stringify(node.capabilities || []),
        node.priority,
        JSON.stringify(node.dependencies),
      );
    }

    // 发布分解事件 / Publish decomposition event
    this._messageBus.publish('orchestrator.decomposed', {
      taskId,
      subtaskCount: subtaskMap.size,
      subtaskIds: [...subtaskMap.keys()],
    });

    this._logger.info?.(
      `[Orchestrator] 任务分解完成 / Task decomposed: ${taskId}, ${subtaskMap.size} subtasks`,
    );

    return { taskId, subtasks: subtaskMap };
  }

  /**
   * 从预定义角色构建子任务节点
   * Build subtask nodes from predefined roles
   *
   * @private
   * @param {Array<Object>} roles - 角色列表
   * @param {string} taskId - 父任务 ID
   * @returns {SubtaskNode[]}
   */
  _buildFromRoles(roles, taskId) {
    return roles.map((role, index) => ({
      id: role.id || `${taskId}_role_${nanoid(8)}`,
      name: role.name || `role_${index}`,
      description: role.description || '',
      dependencies: role.dependsOn || role.depends_on || [],
      assignedAgent: role.assignedAgent || null,
      status: TaskStatus.pending,
      result: null,
      priority: role.priority ?? 0,
      estimatedDuration: role.estimatedDuration || 60000,
      capabilities: role.capabilities || [],
      retryCount: 0,
      startedAt: null,
      completedAt: null,
    }));
  }

  /**
   * 从数据库已有角色构建
   * Build from existing database roles
   *
   * @private
   * @param {string} taskId
   * @returns {Promise<SubtaskNode[]>}
   */
  async _buildFromDatabase(taskId) {
    const dbRoles = this._taskRepo.getRolesByTask(taskId);
    if (!dbRoles || dbRoles.length === 0) {
      return [];
    }
    return dbRoles.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description || '',
      dependencies: r.depends_on || [],
      assignedAgent: null,
      status: r.status || TaskStatus.pending,
      result: r.result || null,
      priority: r.priority || 0,
      estimatedDuration: r.estimated_duration || 60000,
      capabilities: r.capabilities ? (typeof r.capabilities === 'string' ? JSON.parse(r.capabilities) : r.capabilities) : [],
      retryCount: 0,
      startedAt: null,
      completedAt: null,
    }));
  }

  /**
   * 标准化子任务节点
   * Normalize raw subtask data into SubtaskNode format
   *
   * @private
   * @param {Array<Object>} rawSubtasks
   * @param {string} taskId
   * @returns {SubtaskNode[]}
   */
  _normalizeSubtasks(rawSubtasks, taskId) {
    return rawSubtasks.map((raw) => ({
      id: raw.id || `${taskId}_sub_${nanoid(8)}`,
      name: raw.name || raw.roleName || 'unnamed',
      description: raw.description || '',
      dependencies: raw.dependencies || raw.dependsOn || [],
      assignedAgent: raw.assignedAgent || null,
      status: TaskStatus.pending,
      result: null,
      priority: raw.priority ?? 0,
      estimatedDuration: raw.estimatedDuration || 60000,
      capabilities: raw.capabilities || [],
      retryCount: 0,
      startedAt: null,
      completedAt: null,
    }));
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 拓扑排序 / Topological Sort
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  /**
   * Kahn 算法拓扑排序, 返回分层数组
   * Kahn's algorithm topological sort, returns layered arrays
   *
   * 每一层包含可以并行执行的任务 (所有依赖都在前面的层)。
   * Each layer contains tasks that can execute in parallel (all deps in earlier layers).
   *
   * @param {Map<string, SubtaskNode>|SubtaskNode[]} tasks - 子任务 Map 或数组
   * @returns {Array<string[]>} 分层的任务 ID 数组 / Layered arrays of task IDs
   * @throws {Error} 存在循环依赖 / If a cycle is detected
   */
  topologicalSort(tasks) {
    // 统一转换为 Map / Normalize to Map
    const taskMap = tasks instanceof Map
      ? tasks
      : new Map(tasks.map((t) => [t.id, t]));

    // 构建入度表和邻接表 / Build in-degree and adjacency
    /** @type {Map<string, number>} */
    const inDegree = new Map();
    /** @type {Map<string, string[]>} */
    const adjacency = new Map();

    for (const [id, node] of taskMap) {
      if (!inDegree.has(id)) inDegree.set(id, 0);
      if (!adjacency.has(id)) adjacency.set(id, []);

      for (const dep of (node.dependencies || [])) {
        // 只计算存在于当前任务集的依赖 / Only count deps within current task set
        if (taskMap.has(dep)) {
          inDegree.set(id, (inDegree.get(id) || 0) + 1);
          if (!adjacency.has(dep)) adjacency.set(dep, []);
          adjacency.get(dep).push(id);
        }
      }
    }

    // Kahn 分层 / Kahn's layered sort
    const layers = [];
    let currentLayer = [];

    for (const [id, deg] of inDegree) {
      if (deg === 0) currentLayer.push(id);
    }

    let processed = 0;

    while (currentLayer.length > 0) {
      // 按优先级排序当前层 / Sort current layer by priority (desc)
      currentLayer.sort((a, b) => {
        const pa = taskMap.get(a)?.priority || 0;
        const pb = taskMap.get(b)?.priority || 0;
        return pb - pa;
      });

      layers.push([...currentLayer]);
      processed += currentLayer.length;

      const nextLayer = [];
      for (const id of currentLayer) {
        for (const neighbor of (adjacency.get(id) || [])) {
          const newDeg = (inDegree.get(neighbor) || 1) - 1;
          inDegree.set(neighbor, newDeg);
          if (newDeg === 0) nextLayer.push(neighbor);
        }
      }
      currentLayer = nextLayer;
    }

    // 环检测 / Cycle detection
    if (processed < taskMap.size) {
      const cycleNodes = [...taskMap.keys()].filter(
        (id) => (inDegree.get(id) || 0) > 0,
      );
      throw new Error(
        `检测到循环依赖 / Cycle detected among nodes: [${cycleNodes.join(', ')}]`,
      );
    }

    return layers;
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 执行 / Execution
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  /**
   * 执行一个已分解的任务
   * Execute a decomposed task
   *
   * 按拓扑层逐层执行, 层内并行, 层间顺序。
   * Executes layer by layer (parallel within layer, sequential between layers).
   *
   * @param {string} taskId - 任务 ID (需先 decompose)
   * @param {Object} [options]
   * @param {Map<string, SubtaskNode>} [options.subtasks] - 可直接传入子任务 Map
   * @returns {Promise<Object>} 最终执行结果 / Final execution result
   */
  async execute(taskId, options = {}) {
    this._logger.info?.(`[Orchestrator] 开始执行任务 / Executing task: ${taskId}`);

    // 获取子任务 / Get subtasks
    let subtasks = options.subtasks;
    if (!subtasks) {
      const dbRoles = this._taskRepo.getRolesByTask(taskId);
      if (!dbRoles || dbRoles.length === 0) {
        throw new Error(`任务无子任务 / Task ${taskId} has no subtasks. Decompose first.`);
      }
      subtasks = new Map(
        dbRoles.map((r) => [
          r.id,
          {
            id: r.id,
            name: r.name,
            description: r.description || '',
            dependencies: r.depends_on || [],
            assignedAgent: null,
            status: r.status || TaskStatus.pending,
            result: r.result || null,
            priority: r.priority || 0,
            estimatedDuration: 60000,
            capabilities: r.capabilities || [],
            retryCount: 0,
            startedAt: null,
            completedAt: null,
          },
        ]),
      );
    }

    // 拓扑排序 / Topological sort
    const layers = this.topologicalSort(subtasks);

    // 创建执行上下文 / Create execution context
    const abortController = new AbortController();
    /** @type {TaskExecution} */
    const execution = {
      taskId,
      subtasks,
      layers,
      status: TaskStatus.running,
      startedAt: Date.now(),
      completedAt: null,
      abortController,
      finalResult: null,
    };
    this._executions.set(taskId, execution);

    // 更新数据库状态 / Update DB status
    this._taskRepo.updateTaskStatus(taskId, TaskStatus.running);

    // 发布执行开始事件 / Publish execution started event
    this._messageBus.publish('orchestrator.execution.started', {
      taskId,
      layerCount: layers.length,
      subtaskCount: subtasks.size,
    });

    try {
      // 逐层执行 / Execute layer by layer
      for (let layerIndex = 0; layerIndex < layers.length; layerIndex++) {
        // 检查是否被取消 / Check for abort
        if (abortController.signal.aborted) {
          throw new Error(`任务已取消 / Task ${taskId} was aborted`);
        }

        const layerIds = layers[layerIndex];

        this._logger.info?.(
          `[Orchestrator] 执行第 ${layerIndex + 1}/${layers.length} 层, ` +
          `${layerIds.length} 个任务 / Executing layer ${layerIndex + 1}/${layers.length}, ` +
          `${layerIds.length} tasks`,
        );

        this._messageBus.publish('orchestrator.layer.started', {
          taskId,
          layerIndex,
          totalLayers: layers.length,
          subtaskIds: layerIds,
        });

        // 层内并行执行 (受 maxParallel 限制) / Parallel within layer (capped)
        await this._executeLayer(execution, layerIds, layerIndex);

        this._messageBus.publish('orchestrator.layer.completed', {
          taskId,
          layerIndex,
          totalLayers: layers.length,
        });
      }

      // 全部完成 / All done
      execution.status = TaskStatus.completed;
      execution.completedAt = Date.now();

      // 合成结果 / Synthesize final result
      execution.finalResult = this._synthesizeResults(execution);

      // 更新数据库 / Update database
      this._taskRepo.updateTaskStatus(taskId, TaskStatus.completed);

      this._messageBus.publish('orchestrator.execution.completed', {
        taskId,
        duration: execution.completedAt - execution.startedAt,
        subtaskCount: subtasks.size,
      });

      this._logger.info?.(
        `[Orchestrator] 任务执行完成 / Task completed: ${taskId}, ` +
        `耗时 / duration: ${execution.completedAt - execution.startedAt}ms`,
      );

      return execution.finalResult;
    } catch (err) {
      execution.status = TaskStatus.failed;
      execution.completedAt = Date.now();

      this._taskRepo.updateTaskStatus(taskId, TaskStatus.failed, err.message);

      this._messageBus.publish('orchestrator.execution.failed', {
        taskId,
        error: err.message,
        duration: execution.completedAt - execution.startedAt,
      });

      this._logger.error?.(
        `[Orchestrator] 任务执行失败 / Task failed: ${taskId} - ${err.message}`,
      );

      throw err;
    }
  }

  /**
   * 执行一个拓扑层 (层内并行, 受 maxParallel 限制)
   * Execute a single topological layer (parallel, capped by maxParallel)
   *
   * @private
   * @param {TaskExecution} execution
   * @param {string[]} layerIds
   * @param {number} layerIndex
   */
  async _executeLayer(execution, layerIds, layerIndex) {
    const { subtasks, abortController, taskId } = execution;
    const maxParallel = this._config.maxParallel;

    // 分批并行 / Batch parallel execution
    for (let i = 0; i < layerIds.length; i += maxParallel) {
      if (abortController.signal.aborted) {
        throw new Error(`任务已取消 / Task ${taskId} was aborted`);
      }

      const batch = layerIds.slice(i, i + maxParallel);
      const promises = batch.map((subtaskId) => {
        const node = subtasks.get(subtaskId);
        if (!node) return Promise.resolve(null);
        return this._executeSubtask(execution, node);
      });

      const results = await Promise.allSettled(promises);

      // 处理结果 / Handle results
      for (let j = 0; j < results.length; j++) {
        const subtaskId = batch[j];
        const node = subtasks.get(subtaskId);
        if (!node) continue;

        const settled = results[j];

        if (settled.status === 'fulfilled') {
          node.status = TaskStatus.completed;
          node.result = settled.value;
          node.completedAt = Date.now();

          this._taskRepo.updateRoleStatus(subtaskId, RoleStatus.completed, node.result);

          this._messageBus.publish('orchestrator.subtask.completed', {
            taskId,
            subtaskId,
            subtaskName: node.name,
            layerIndex,
          });
        } else {
          // 失败 - 尝试重试 / Failed - attempt retry
          const canRetry = node.retryCount < this._config.maxRetries;

          if (canRetry) {
            node.retryCount++;
            this._logger.warn?.(
              `[Orchestrator] 子任务重试 / Subtask retry: ${subtaskId} ` +
              `(${node.retryCount}/${this._config.maxRetries})`,
            );

            this._messageBus.publish('orchestrator.subtask.retrying', {
              taskId,
              subtaskId,
              attempt: node.retryCount,
              error: settled.reason?.message,
            });

            // 重试一次 / Retry once
            try {
              node.result = await this._executeSubtask(execution, node);
              node.status = TaskStatus.completed;
              node.completedAt = Date.now();
              this._taskRepo.updateRoleStatus(subtaskId, RoleStatus.completed, node.result);
            } catch (retryErr) {
              node.status = TaskStatus.failed;
              node.completedAt = Date.now();
              this._taskRepo.updateRoleStatus(subtaskId, RoleStatus.failed, { error: retryErr.message });

              this._messageBus.publish('orchestrator.subtask.failed', {
                taskId,
                subtaskId,
                subtaskName: node.name,
                error: retryErr.message,
              });

              throw new Error(
                `子任务失败 / Subtask ${node.name} (${subtaskId}) failed after ${node.retryCount} retries: ${retryErr.message}`,
              );
            }
          } else {
            node.status = TaskStatus.failed;
            node.completedAt = Date.now();
            this._taskRepo.updateRoleStatus(subtaskId, RoleStatus.failed, { error: settled.reason?.message });

            this._messageBus.publish('orchestrator.subtask.failed', {
              taskId,
              subtaskId,
              subtaskName: node.name,
              error: settled.reason?.message,
            });

            throw new Error(
              `子任务失败 / Subtask ${node.name} (${subtaskId}) failed: ${settled.reason?.message}`,
            );
          }
        }
      }
    }
  }

  /**
   * 执行单个子任务
   * Execute a single subtask
   *
   * @private
   * @param {TaskExecution} execution
   * @param {SubtaskNode} node
   * @returns {Promise<Object>}
   */
  async _executeSubtask(execution, node) {
    const { taskId, abortController } = execution;

    // 验证依赖已完成 / Verify all dependencies are completed
    for (const depId of (node.dependencies || [])) {
      const depNode = execution.subtasks.get(depId);
      if (depNode && depNode.status !== TaskStatus.completed) {
        throw new Error(
          `依赖未完成 / Dependency ${depId} not completed for subtask ${node.id}`,
        );
      }
    }

    node.status = TaskStatus.executing;
    node.startedAt = Date.now();

    this._taskRepo.updateRoleStatus(node.id, RoleStatus.active);

    this._messageBus.publish('orchestrator.subtask.started', {
      taskId,
      subtaskId: node.id,
      subtaskName: node.name,
      assignedAgent: node.assignedAgent,
    });

    // Agent 分配 (占位符 - 后续由 MoE/ABC 接管)
    // Agent assignment (placeholder - to be replaced by MoE/ABC)
    if (!node.assignedAgent) {
      node.assignedAgent = await this._assignAgent(node);
    }

    // 执行超时控制 / Execution with timeout
    const timeoutMs = this._config.taskTimeoutMs;
    const executionPromise = this._invokeExecutor(node, {
      taskId,
      signal: abortController.signal,
      dependencies: this._collectDependencyResults(execution, node),
    });

    const timeoutPromise = new Promise((_, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`子任务超时 / Subtask ${node.name} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      // 允许 GC 清理 / Allow GC cleanup
      if (typeof timer === 'object' && timer.unref) timer.unref();
      abortController.signal.addEventListener('abort', () => clearTimeout(timer));
    });

    return Promise.race([executionPromise, timeoutPromise]);
  }

  /**
   * 调用执行器
   * Invoke the task executor
   *
   * @private
   * @param {SubtaskNode} node
   * @param {Object} context
   * @returns {Promise<Object>}
   */
  async _invokeExecutor(node, context) {
    if (this._executor) {
      return this._executor(node, context);
    }

    // 默认模拟执行 / Default simulated execution
    this._logger.debug?.(
      `[Orchestrator] 模拟执行子任务 / Simulated execution: ${node.name} (${node.id})`,
    );
    return {
      subtaskId: node.id,
      subtaskName: node.name,
      simulated: true,
      timestamp: Date.now(),
    };
  }

  /**
   * 分配 Agent (占位符实现)
   * Assign agent to subtask (placeholder implementation)
   *
   * 后续由 MoE/ABC/ContractNet 模块替换。
   * To be replaced by MoE/ABC/ContractNet modules later.
   *
   * @private
   * @param {SubtaskNode} node
   * @returns {Promise<string|null>}
   */
  async _assignAgent(node) {
    // 简单轮询可用 Agent / Simple round-robin of available agents
    const agents = this._agentRepo.listAgents('active');
    if (!agents || agents.length === 0) {
      this._logger.debug?.('[Orchestrator] 无可用 Agent / No available agents');
      return null;
    }

    // 基础能力匹配 (后续由 MoE 增强) / Basic capability match (to be enhanced by MoE)
    const capabilities = node.capabilities || [];
    if (capabilities.length > 0) {
      for (const agent of agents) {
        const agentCaps = this._agentRepo.getCapabilities(agent.id);
        const capNames = agentCaps.map((c) => c.dimension);
        const match = capabilities.some((c) => capNames.includes(c));
        if (match) {
          this._logger.debug?.(
            `[Orchestrator] Agent 能力匹配 / Capability match: ${agent.id} -> ${node.name}`,
          );
          return agent.id;
        }
      }
    }

    // 降级: 选第一个可用 Agent / Fallback: pick first available
    return agents[0].id;
  }

  /**
   * 收集依赖结果
   * Collect results from dependency subtasks
   *
   * @private
   * @param {TaskExecution} execution
   * @param {SubtaskNode} node
   * @returns {Object}
   */
  _collectDependencyResults(execution, node) {
    const depResults = {};
    for (const depId of (node.dependencies || [])) {
      const depNode = execution.subtasks.get(depId);
      if (depNode && depNode.result) {
        depResults[depId] = depNode.result;
      }
    }
    return depResults;
  }

  /**
   * 合成最终结果
   * Synthesize final result from all subtask results
   *
   * @private
   * @param {TaskExecution} execution
   * @returns {Object}
   */
  _synthesizeResults(execution) {
    const results = {};
    let successCount = 0;
    let failCount = 0;

    for (const [id, node] of execution.subtasks) {
      results[id] = {
        name: node.name,
        status: node.status,
        result: node.result,
        duration: node.completedAt && node.startedAt
          ? node.completedAt - node.startedAt
          : null,
        assignedAgent: node.assignedAgent,
      };

      if (node.status === TaskStatus.completed) successCount++;
      else if (node.status === TaskStatus.failed) failCount++;
    }

    return {
      taskId: execution.taskId,
      totalSubtasks: execution.subtasks.size,
      successCount,
      failCount,
      duration: execution.completedAt - execution.startedAt,
      subtaskResults: results,
    };
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 状态查询 / Status Queries
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  /**
   * 获取任务执行状态
   * Get task execution status
   *
   * @param {string} taskId
   * @returns {Object|null} 状态对象 / Status object
   */
  getStatus(taskId) {
    const execution = this._executions.get(taskId);
    if (!execution) {
      // 尝试从数据库获取 / Try from database
      const task = this._taskRepo.getTask(taskId);
      if (!task) return null;
      return {
        taskId,
        status: task.status,
        source: 'database',
      };
    }

    const subtaskStatuses = {};
    let completed = 0;
    let running = 0;
    let pending = 0;
    let failed = 0;

    for (const [id, node] of execution.subtasks) {
      subtaskStatuses[id] = {
        name: node.name,
        status: node.status,
        assignedAgent: node.assignedAgent,
        retryCount: node.retryCount,
      };

      switch (node.status) {
        case TaskStatus.completed: completed++; break;
        case TaskStatus.running:
        case TaskStatus.executing: running++; break;
        case TaskStatus.failed: failed++; break;
        default: pending++; break;
      }
    }

    const total = execution.subtasks.size;
    const progress = total > 0 ? completed / total : 0;

    return {
      taskId,
      status: execution.status,
      progress,
      startedAt: execution.startedAt,
      completedAt: execution.completedAt,
      duration: execution.completedAt
        ? execution.completedAt - execution.startedAt
        : Date.now() - execution.startedAt,
      layers: execution.layers.length,
      subtasks: {
        total,
        completed,
        running,
        pending,
        failed,
      },
      subtaskDetails: subtaskStatuses,
      source: 'memory',
    };
  }

  /**
   * 获取任务树 (根任务+所有子任务状态)
   * Get task tree (root task + all subtask statuses)
   *
   * @param {string} taskId
   * @returns {Object|null} 任务树 / Task tree
   */
  getTaskTree(taskId) {
    const task = this._taskRepo.getTask(taskId);
    if (!task) return null;

    const roles = this._taskRepo.getRolesByTask(taskId);
    const execution = this._executions.get(taskId);

    const children = roles.map((role) => {
      // 优先从内存获取实时状态 / Prefer real-time status from memory
      const memNode = execution?.subtasks?.get(role.id);

      return {
        id: role.id,
        name: role.name,
        status: memNode?.status || role.status,
        dependencies: role.depends_on || [],
        result: memNode?.result || role.result,
        assignedAgent: memNode?.assignedAgent || null,
        priority: role.priority,
        retryCount: memNode?.retryCount || 0,
      };
    });

    return {
      taskId,
      status: execution?.status || task.status,
      config: task.config,
      createdAt: task.created_at,
      children,
    };
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 取消 / Abort
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  /**
   * 取消正在运行的任务
   * Abort a running task
   *
   * @param {string} taskId
   * @returns {{ aborted: boolean, runningSubtasks: number }}
   */
  abort(taskId) {
    const execution = this._executions.get(taskId);
    if (!execution) {
      return { aborted: false, runningSubtasks: 0 };
    }

    if (execution.status !== TaskStatus.running) {
      return { aborted: false, runningSubtasks: 0 };
    }

    // 触发 AbortController / Trigger AbortController
    execution.abortController.abort();
    execution.status = TaskStatus.cancelled;
    execution.completedAt = Date.now();

    // 计算正在运行的子任务 / Count running subtasks
    let runningSubtasks = 0;
    for (const node of execution.subtasks.values()) {
      if (node.status === TaskStatus.running || node.status === TaskStatus.executing) {
        node.status = TaskStatus.cancelled;
        node.completedAt = Date.now();
        runningSubtasks++;
      }
    }

    // 更新数据库 / Update database
    this._taskRepo.updateTaskStatus(taskId, TaskStatus.cancelled, 'Aborted by orchestrator');

    this._messageBus.publish('orchestrator.execution.aborted', {
      taskId,
      runningSubtasks,
      duration: execution.completedAt - execution.startedAt,
    });

    this._logger.warn?.(
      `[Orchestrator] 任务已取消 / Task aborted: ${taskId}, ` +
      `${runningSubtasks} running subtasks cancelled`,
    );

    return { aborted: true, runningSubtasks };
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // DAG 验证 / DAG Validation
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  /**
   * 验证子任务 DAG 无环
   * Validate the subtask DAG is acyclic
   *
   * 使用 DFS 颜色标记法检测环。
   * Uses DFS coloring to detect cycles.
   *
   * @private
   * @param {Map<string, SubtaskNode>} subtaskMap
   * @throws {Error} 存在循环依赖
   */
  _validateDAG(subtaskMap) {
    const WHITE = 0; // 未访问 / Unvisited
    const GRAY = 1;  // 正在访问 / In-progress
    const BLACK = 2; // 已完成 / Completed

    const color = new Map();
    for (const id of subtaskMap.keys()) {
      color.set(id, WHITE);
    }

    /**
     * DFS 递归检测
     * @param {string} nodeId
     * @returns {boolean} true if cycle found
     */
    const hasCycle = (nodeId) => {
      color.set(nodeId, GRAY);

      const node = subtaskMap.get(nodeId);
      for (const dep of (node?.dependencies || [])) {
        if (!subtaskMap.has(dep)) continue; // 外部依赖跳过 / Skip external deps

        if (color.get(dep) === GRAY) {
          return true; // 回边 -> 环 / Back edge -> cycle
        }
        if (color.get(dep) === WHITE && hasCycle(dep)) {
          return true;
        }
      }

      color.set(nodeId, BLACK);
      return false;
    };

    for (const id of subtaskMap.keys()) {
      if (color.get(id) === WHITE && hasCycle(id)) {
        throw new Error(
          `DAG 验证失败: 检测到循环依赖 / DAG validation failed: cycle detected involving node ${id}`,
        );
      }
    }
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 工具方法 / Utility Methods
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  /**
   * 获取所有活跃执行
   * Get all active executions
   *
   * @returns {Array<{ taskId: string, status: string, subtaskCount: number }>}
   */
  getActiveExecutions() {
    const result = [];
    for (const [taskId, execution] of this._executions) {
      result.push({
        taskId,
        status: execution.status,
        subtaskCount: execution.subtasks.size,
        startedAt: execution.startedAt,
      });
    }
    return result;
  }

  /**
   * 清理已完成的执行上下文 (释放内存)
   * Clean up completed execution contexts (free memory)
   *
   * @param {number} [maxAgeMs=3600000] - 最大保留时间 (默认 1 小时)
   * @returns {number} 清理数量
   */
  cleanup(maxAgeMs = 3600000) {
    const now = Date.now();
    let cleaned = 0;

    for (const [taskId, execution] of this._executions) {
      const isTerminal = [TaskStatus.completed, TaskStatus.failed, TaskStatus.cancelled].includes(
        execution.status,
      );
      const age = now - (execution.completedAt || execution.startedAt);

      if (isTerminal && age > maxAgeMs) {
        this._executions.delete(taskId);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      this._logger.info?.(`[Orchestrator] 清理了 ${cleaned} 个过期执行上下文 / Cleaned ${cleaned} expired executions`);
    }

    return cleaned;
  }

  /**
   * 销毁编排器 (清理所有资源)
   * Destroy orchestrator (clean all resources)
   */
  destroy() {
    // 取消所有运行中的任务 / Abort all running tasks
    for (const [taskId, execution] of this._executions) {
      if (execution.status === TaskStatus.running) {
        execution.abortController.abort();
        execution.status = TaskStatus.cancelled;
      }
    }
    this._executions.clear();
    this._executor = null;
    this._decomposer = null;

    this._logger.info?.('[Orchestrator] 已销毁 / Destroyed');
  }
}
