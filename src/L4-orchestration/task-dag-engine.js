/**
 * TaskDAGEngine -- DAG 任务编排引擎 / DAG Task Orchestration Engine
 *
 * V5.1 L4 编排层: 有向无环图 (DAG) 编排, 替代 V5.0 线性 D1→D3→D2 流水线。
 * V5.1 L4 Orchestration Layer: Directed Acyclic Graph (DAG) orchestration,
 * replacing V5.0 linear D1→D3→D2 pipeline.
 *
 * 核心能力 / Core capabilities:
 * - DAG 构建与拓扑排序 / DAG construction and topological sort
 * - 任务生命周期状态机 / Task lifecycle state machine
 * - 关键路径分析 (CPM) / Critical Path Method analysis
 * - 任务集市拍卖分配 / Auction-based task allocation
 * - Work-Stealing 负载均衡 / Work-stealing load balancing
 * - 管道并行 (部分结果前递) / Pipeline parallelism (partial result forwarding)
 * - 死信队列 (DLQ) / Dead Letter Queue
 * - Stigmergic 任务板 / Stigmergic task board
 *
 * 任务状态机 / Task State Machine:
 *   pending → auctioning → assigned → executing → completed/failed → [dead_letter]
 *
 * @module L4-orchestration/task-dag-engine
 * @version 5.1.0
 * @author DEEP-IOS
 */

import { EventTopics, wrapEvent } from '../event-catalog.js';

// ============================================================================
// 常量 / Constants
// ============================================================================

/** 任务状态枚举 / Task state enum */
export const TaskState = Object.freeze({
  PENDING: 'pending',
  AUCTIONING: 'auctioning',
  ASSIGNED: 'assigned',
  EXECUTING: 'executing',
  COMPLETED: 'completed',
  FAILED: 'failed',
  DEAD_LETTER: 'dead_letter',
  TAINTED: 'tainted',
});

/** 合法状态转换 / Valid state transitions */
const VALID_TRANSITIONS = {
  [TaskState.PENDING]: [TaskState.AUCTIONING, TaskState.ASSIGNED],
  [TaskState.AUCTIONING]: [TaskState.ASSIGNED, TaskState.PENDING],
  [TaskState.ASSIGNED]: [TaskState.EXECUTING, TaskState.PENDING], // work-steal 可从 assigned 偷回 pending
  [TaskState.EXECUTING]: [TaskState.COMPLETED, TaskState.FAILED, TaskState.TAINTED],
  [TaskState.FAILED]: [TaskState.DEAD_LETTER, TaskState.PENDING], // 可重试回 pending
  [TaskState.TAINTED]: [TaskState.PENDING, TaskState.DEAD_LETTER],
};

/** 默认拍卖超时 (ms) / Default auction timeout */
const DEFAULT_AUCTION_TIMEOUT_MS = 500;

/** Work-Stealing 冷却期 (ms) / Work-stealing cooldown */
const WORK_STEAL_COOLDOWN_MS = 5000;

/** Work-Stealing 能力匹配阈值 / Work-stealing capability match threshold */
const WORK_STEAL_CAPABILITY_THRESHOLD = 0.5;

/** 最大重试次数 / Max retry count before DLQ */
const MAX_RETRIES = 3;

/** DLQ 最大容量 / DLQ max capacity */
const MAX_DLQ_SIZE = 100;

// ============================================================================
// TaskDAGEngine 类 / TaskDAGEngine Class
// ============================================================================

export class TaskDAGEngine {
  /**
   * @param {Object} deps
   * @param {Object} deps.messageBus - MessageBus 实例
   * @param {Object} deps.pheromoneEngine - PheromoneEngine 实例
   * @param {Object} deps.agentRepo - AgentRepository 实例
   * @param {Object} deps.taskRepo - TaskRepository 实例
   * @param {Object} [deps.capabilityEngine] - CapabilityEngine 实例
   * @param {Object} deps.logger - 日志器
   * @param {Object} [deps.config] - 配置项
   */
  constructor({ messageBus, pheromoneEngine, agentRepo, taskRepo, capabilityEngine, logger, config = {}, db }) {
    this._messageBus = messageBus;
    this._pheromoneEngine = pheromoneEngine;
    this._agentRepo = agentRepo;
    this._taskRepo = taskRepo;
    this._capabilityEngine = capabilityEngine;
    this._logger = logger || console;
    this._config = config;
    /** @type {Object|null} V5.5: DatabaseManager for DLQ persistence */
    this._db = db || null;

    this._auctionTimeoutMs = config.auctionTimeoutMs || DEFAULT_AUCTION_TIMEOUT_MS;

    /**
     * 活跃 DAG 存储: dagId → DAG
     * Active DAG storage
     * @type {Map<string, Object>}
     */
    this._activeDags = new Map();

    /**
     * 任务节点全局索引: taskNodeId → { dagId, node }
     * Global task node index
     * @type {Map<string, Object>}
     */
    this._taskIndex = new Map();

    /**
     * Agent 就绪队列: agentId → Array<taskNodeId>
     * Agent ready queues (for work-stealing)
     * @type {Map<string, Array<string>>}
     */
    this._agentQueues = new Map();

    /**
     * 最近偷取时间: agentId → timestamp
     * Last steal time per agent (cooldown tracking)
     * @type {Map<string, number>}
     */
    this._lastStealTime = new Map();

    /**
     * 完成集合: taskNodeId → { completed, result }
     * Completion set (for speculative execution dedup)
     * @type {Map<string, Object>}
     */
    this._completionSet = new Map();

    /**
     * 死信队列 / Dead Letter Queue
     * @type {Array<Object>}
     */
    this._deadLetterQueue = [];

    /**
     * 拍卖中的任务: Set<taskNodeId>
     * Tasks currently being auctioned
     * @type {Set<string>}
     */
    this._pendingAuction = new Set();
  }

  // ━━━ DAG 构建 / DAG Construction ━━━

  /**
   * 从 JSON 定义创建 DAG
   * Create DAG from JSON definition
   *
   * 格式 / Format:
   * {
   *   nodes: [{ id: string, agent?: string, deps: string[], estimatedDuration?: number }],
   *   metadata?: { description: string }
   * }
   *
   * @param {string} dagId - DAG 唯一标识
   * @param {Object} definition - DAG 定义
   * @returns {{ success: boolean, dagId: string, error?: string }}
   */
  createDAG(dagId, definition) {
    if (this._activeDags.has(dagId)) {
      return { success: false, dagId, error: `DAG ${dagId} already exists` };
    }

    const { nodes } = definition;
    if (!nodes || !Array.isArray(nodes) || nodes.length === 0) {
      return { success: false, dagId, error: 'nodes must be a non-empty array' };
    }

    // 1. 校验无环 / Validate acyclicity
    const cycleCheck = this._detectCycle(nodes);
    if (cycleCheck) {
      return { success: false, dagId, error: `Cycle detected: ${cycleCheck}` };
    }

    // 2. 构建 DAG 数据结构 / Build DAG data structure
    const dag = {
      id: dagId,
      nodes: new Map(),
      createdAt: Date.now(),
      status: 'active',
      metadata: definition.metadata || {},
    };

    for (const nodeDef of nodes) {
      const node = {
        id: nodeDef.id,
        agent: nodeDef.agent || null,
        deps: nodeDef.deps || [],
        estimatedDuration: nodeDef.estimatedDuration || 60000,
        state: TaskState.PENDING,
        assignedAgent: null,
        retryCount: 0,
        result: null,
        error: null,
        startedAt: null,
        completedAt: null,
        // CPM 字段 / CPM fields
        earliestStart: 0,
        latestStart: Infinity,
        slack: Infinity,
        isCritical: false,
      };

      dag.nodes.set(nodeDef.id, node);
      this._taskIndex.set(`${dagId}:${nodeDef.id}`, { dagId, node });
    }

    // 3. 计算关键路径 / Calculate critical path
    this._computeCPM(dag);

    this._activeDags.set(dagId, dag);

    // 4. 发布 DAG 创建事件 / Publish DAG created event
    this._messageBus?.publish?.(
      EventTopics.DAG_CREATED,
      wrapEvent(EventTopics.DAG_CREATED, {
        dagId,
        nodeCount: nodes.length,
        criticalPath: this._getCriticalPathNodes(dag),
      }, 'task-dag-engine')
    );

    this._logger.info?.(
      `[TaskDAGEngine] DAG created: ${dagId}, ${nodes.length} nodes`
    );

    // 5. 启动就绪任务 / Start ready tasks
    this._scheduleReadyTasks(dagId);

    return { success: true, dagId };
  }

  // ━━━ 任务状态机 / Task State Machine ━━━

  /**
   * 转换任务状态 (强制状态机校验)
   * Transition task state (enforces state machine validation)
   *
   * @param {string} dagId
   * @param {string} nodeId
   * @param {string} newState - 目标状态
   * @param {Object} [data] - 附加数据
   * @returns {boolean} 转换是否成功
   */
  transitionState(dagId, nodeId, newState, data = {}) {
    const key = `${dagId}:${nodeId}`;
    const entry = this._taskIndex.get(key);
    if (!entry) {
      this._logger.warn?.(`[TaskDAGEngine] Task not found: ${key}`);
      return false;
    }

    const node = entry.node;
    const validTransitions = VALID_TRANSITIONS[node.state];

    if (!validTransitions || !validTransitions.includes(newState)) {
      this._logger.warn?.(
        `[TaskDAGEngine] Invalid transition: ${node.state} → ${newState} for ${key}`
      );
      return false;
    }

    const oldState = node.state;
    node.state = newState;

    // 更新附加数据 / Update additional data
    if (newState === TaskState.ASSIGNED) {
      node.assignedAgent = data.agentId || null;
    } else if (newState === TaskState.EXECUTING) {
      node.startedAt = Date.now();
    } else if (newState === TaskState.COMPLETED) {
      node.completedAt = Date.now();
      node.result = data.result || null;

      // Stigmergic: 沉积 trail 信息素 / Deposit trail pheromone
      this._depositStigmergy(dagId, nodeId, 'trail', 0.8);

      // 检查 DAG 是否全部完成 / Check if DAG is fully completed
      this._checkDAGCompletion(dagId);
    } else if (newState === TaskState.FAILED) {
      node.error = data.error || data.reason || 'unknown';
      node.retryCount++;

      // Stigmergic: 沉积 alarm 信息素 / Deposit alarm pheromone
      this._depositStigmergy(dagId, nodeId, 'alarm', 0.6);

      // 检查是否进入 DLQ / Check if should enter DLQ
      if (node.retryCount >= MAX_RETRIES) {
        this.transitionState(dagId, nodeId, TaskState.DEAD_LETTER, data);
        return true;
      }
    } else if (newState === TaskState.DEAD_LETTER) {
      this._addToDeadLetterQueue(dagId, nodeId, node, data);
    }

    this._logger.debug?.(
      `[TaskDAGEngine] ${key}: ${oldState} → ${newState}`
    );

    // 如果任务完成, 调度下游就绪任务 / If task completed, schedule downstream ready tasks
    if (newState === TaskState.COMPLETED) {
      this._scheduleReadyTasks(dagId);
    }

    return true;
  }

  // ━━━ 任务集市拍卖 / Task Auction ━━━

  /**
   * 对就绪任务发起拍卖
   * Initiate auction for ready tasks
   *
   * @param {string} dagId
   * @param {string} nodeId
   * @returns {{ agentId: string|null, score: number }}
   */
  auctionTask(dagId, nodeId) {
    const key = `${dagId}:${nodeId}`;
    const entry = this._taskIndex.get(key);
    if (!entry) return { agentId: null, score: 0 };

    const node = entry.node;

    // 防止拍卖期间被偷取 / Prevent steal during auction
    this._pendingAuction.add(key);

    try {
      // 获取可用 agent / Get available agents
      const agents = this._agentRepo?.listAgents?.('active') || [];
      if (agents.length === 0) {
        return { agentId: null, score: 0 };
      }

      // 计算投标分数 / Calculate bid scores
      let bestAgent = null;
      let bestScore = -Infinity;

      for (const agent of agents) {
        const bid = this._computeBidScore(agent, node, dagId);
        if (bid > bestScore) {
          bestScore = bid;
          bestAgent = agent;
        }
      }

      if (bestAgent) {
        // 分配任务 / Assign task
        this.transitionState(dagId, nodeId, TaskState.ASSIGNED, { agentId: bestAgent.id });

        // 发布 task.assigned 事件 / Publish task.assigned event
        this._messageBus?.publish?.(
          EventTopics.TASK_ASSIGNED,
          wrapEvent(EventTopics.TASK_ASSIGNED, {
            dagId, nodeId,
            agentId: bestAgent.id,
            score: bestScore,
          }, 'task-dag-engine')
        );

        return { agentId: bestAgent.id, score: bestScore };
      }

      return { agentId: null, score: 0 };
    } finally {
      this._pendingAuction.delete(key);
    }
  }

  // ━━━ Work-Stealing 负载均衡 ━━━

  /**
   * 尝试为空闲 Agent 偷取任务
   * Attempt to steal a task for an idle agent
   *
   * @param {string} agentId - 空闲 Agent ID
   * @returns {{ stolen: boolean, taskNodeId?: string, fromAgent?: string }}
   */
  tryStealTask(agentId) {
    if (!this._config.workStealing?.enabled) {
      return { stolen: false };
    }

    // 冷却期检查（V5.6: 调节器感知）/ Cooldown check (V5.6: modulator-aware)
    const lastSteal = this._lastStealTime.get(agentId) || 0;
    if (Date.now() - lastSteal < this._getEffectiveCooldown()) {
      return { stolen: false };
    }

    // 查找最长队列 / Find longest queue
    let longestQueue = null;
    let longestLength = 1; // 至少要有 2 个任务才能偷

    for (const [queueAgentId, queue] of this._agentQueues) {
      if (queueAgentId === agentId) continue;
      if (queue.length > longestLength) {
        longestLength = queue.length;
        longestQueue = { agentId: queueAgentId, queue };
      }
    }

    if (!longestQueue) {
      return { stolen: false };
    }

    // 从队列尾部查找可偷取的任务（匹配能力阈值）
    // Look for stealable task from queue tail (capability match)
    for (let i = longestQueue.queue.length - 1; i >= 0; i--) {
      const taskNodeId = longestQueue.queue[i];
      const entry = this._taskIndex.get(taskNodeId);
      if (!entry) continue;

      const node = entry.node;

      // 只能偷 assigned 状态的任务 / Can only steal assigned tasks
      if (node.state !== TaskState.ASSIGNED) continue;

      // 防止拍卖中被偷 / Prevent steal during auction
      if (this._pendingAuction.has(taskNodeId)) continue;

      // 能力匹配检查 / Capability match check
      const matchScore = this._getCapabilityMatch(agentId, node);
      if (matchScore < WORK_STEAL_CAPABILITY_THRESHOLD) continue;

      // 执行偷取 / Execute steal
      longestQueue.queue.splice(i, 1);

      // 重新分配 / Reassign
      node.assignedAgent = agentId;
      this._lastStealTime.set(agentId, Date.now());

      // 添加到偷取者队列 / Add to stealer's queue
      if (!this._agentQueues.has(agentId)) {
        this._agentQueues.set(agentId, []);
      }
      this._agentQueues.get(agentId).push(taskNodeId);

      // 沉积 trail 信息素记录跨 agent 路径 / Deposit trail pheromone for cross-agent path
      this._depositStigmergy(entry.dagId, node.id, 'trail', 0.3);

      this._logger.info?.(
        `[WorkStealing] ${agentId} stole task ${taskNodeId} from ${longestQueue.agentId}`
      );

      // V5.6: 发布窃取完成事件 / Publish work steal completed event
      this._messageBus?.publish?.(
        EventTopics.WORK_STEAL_COMPLETED || 'work.steal.completed',
        wrapEvent(EventTopics.WORK_STEAL_COMPLETED || 'work.steal.completed', {
          agentId,
          taskNodeId,
          fromAgent: longestQueue.agentId,
          dagId: entry.dagId,
        }, 'task-dag-engine')
      );

      return {
        stolen: true,
        taskNodeId,
        fromAgent: longestQueue.agentId,
      };
    }

    return { stolen: false };
  }

  /**
   * V5.6: 获取调节器感知的有效冷却期
   * V5.6: Get modulator-aware effective cooldown
   *
   * @private
   * @returns {number} 毫秒 / milliseconds
   */
  _getEffectiveCooldown() {
    if (!this._globalModulator) return WORK_STEAL_COOLDOWN_MS;
    const mode = this._globalModulator.getCurrentMode?.();
    const multipliers = { EXPLORE: 0.4, EXPLOIT: 0.6, RELIABLE: 1.0, URGENT: 0.2 };
    const mult = multipliers[mode] ?? 1.0;
    return Math.round(WORK_STEAL_COOLDOWN_MS * mult);
  }

  // ━━━ 管道并行 / Pipeline Parallelism ━━━

  /**
   * 发布部分结果, 通知下游任务可以提前开始
   * Publish partial result, notifying downstream tasks to start early
   *
   * @param {string} dagId
   * @param {string} nodeId
   * @param {Object} partialResult - 部分结果
   */
  publishPartialResult(dagId, nodeId, partialResult) {
    this._messageBus?.publish?.(
      EventTopics.TASK_PARTIAL_RESULT,
      wrapEvent(EventTopics.TASK_PARTIAL_RESULT, {
        dagId, nodeId, partialResult,
      }, 'task-dag-engine')
    );
  }

  /**
   * V5.6: 检查并发布部分结果（仅对有下游依赖的 EXECUTING 节点）
   * V5.6: Check and publish partial result (only for EXECUTING nodes with downstream deps)
   *
   * @param {string} dagId
   * @param {string} nodeId
   * @param {Object} intermediateOutput - 中间结果
   * @returns {boolean} 是否发布了部分结果
   */
  checkAndPublishPartial(dagId, nodeId, intermediateOutput) {
    const dag = this._activeDags.get(dagId);
    if (!dag) return false;

    const node = dag.nodes.get(nodeId);
    if (!node || node.state !== 'executing') return false;

    // 检查是否有下游节点 / Check for downstream dependents
    let hasDownstream = false;
    for (const [, n] of dag.nodes) {
      if (n.deps?.includes(nodeId)) {
        hasDownstream = true;
        break;
      }
    }

    if (!hasDownstream) return false;

    this.publishPartialResult(dagId, nodeId, intermediateOutput);
    return true;
  }

  /**
   * 处理上游任务失败 — 传播 tainted 标记到下游
   * Handle upstream task failure — propagate tainted mark to downstream
   *
   * @param {string} dagId
   * @param {string} failedNodeId - 失败的上游节点 ID
   */
  propagateUpstreamFailure(dagId, failedNodeId) {
    const dag = this._activeDags.get(dagId);
    if (!dag) return;

    // 找到所有依赖 failedNodeId 的下游节点 / Find all downstream nodes
    const affected = [];
    for (const [nodeId, node] of dag.nodes) {
      if (node.deps.includes(failedNodeId)) {
        if (node.state === TaskState.EXECUTING) {
          // 标记为 tainted / Mark as tainted
          node.state = TaskState.TAINTED;
          affected.push(nodeId);
        } else if (node.state === TaskState.PENDING || node.state === TaskState.ASSIGNED) {
          // 尚未开始, 保持但标记 / Not started yet, keep but mark
          node.error = `upstream ${failedNodeId} failed`;
        }
      }
    }

    if (affected.length > 0) {
      this._messageBus?.publish?.(
        EventTopics.TASK_UPSTREAM_FAILED,
        wrapEvent(EventTopics.TASK_UPSTREAM_FAILED, {
          dagId, failedNodeId, affectedNodes: affected,
        }, 'task-dag-engine')
      );

      this._logger.warn?.(
        `[TaskDAGEngine] Upstream failure propagated: ${failedNodeId} → [${affected.join(', ')}]`
      );
    }
  }

  // ━━━ 查询 / Queries ━━━

  /**
   * 获取 DAG 快照 / Get DAG snapshot
   *
   * @param {string} dagId
   * @returns {Object|null}
   */
  getDAGSnapshot(dagId) {
    const dag = this._activeDags.get(dagId);
    if (!dag) return null;

    const nodes = [];
    for (const [id, node] of dag.nodes) {
      nodes.push({
        id,
        state: node.state,
        agent: node.agent,
        assignedAgent: node.assignedAgent,
        deps: node.deps,
        isCritical: node.isCritical,
        slack: node.slack,
        retryCount: node.retryCount,
        startedAt: node.startedAt,
        completedAt: node.completedAt,
        error: node.error,
      });
    }

    return {
      dagId,
      status: dag.status,
      createdAt: dag.createdAt,
      nodes,
      criticalPath: this._getCriticalPathNodes(dag),
      metadata: dag.metadata,
    };
  }

  /**
   * 获取所有活跃 DAG 的 ID 列表
   * Get all active DAG IDs
   *
   * @returns {string[]}
   */
  listActiveDags() {
    return [...this._activeDags.keys()];
  }

  /**
   * 获取死信队列 / Get dead letter queue
   *
   * @param {number} [limit=20] - 返回条数限制
   * @returns {Array<Object>}
   */
  getDeadLetterQueue(limit = 20) {
    return this._deadLetterQueue.slice(-limit);
  }

  /**
   * 获取引擎统计 / Get engine statistics
   *
   * @returns {Object}
   */
  getStats() {
    let totalNodes = 0;
    let pendingNodes = 0;
    let executingNodes = 0;
    let completedNodes = 0;
    let failedNodes = 0;

    for (const dag of this._activeDags.values()) {
      for (const node of dag.nodes.values()) {
        totalNodes++;
        if (node.state === TaskState.PENDING) pendingNodes++;
        else if (node.state === TaskState.EXECUTING) executingNodes++;
        else if (node.state === TaskState.COMPLETED) completedNodes++;
        else if (node.state === TaskState.FAILED || node.state === TaskState.DEAD_LETTER) failedNodes++;
      }
    }

    return {
      activeDags: this._activeDags.size,
      totalNodes,
      pendingNodes,
      executingNodes,
      completedNodes,
      failedNodes,
      deadLetterQueueSize: this._deadLetterQueue.length,
      agentQueues: this._agentQueues.size,
    };
  }

  // ━━━ 拓扑排序 / Topological Sort ━━━

  /**
   * 对 DAG 节点进行拓扑排序
   * Topological sort of DAG nodes
   *
   * @param {string} dagId
   * @returns {string[]} 排序后的节点 ID 列表
   */
  topologicalSort(dagId) {
    const dag = this._activeDags.get(dagId);
    if (!dag) return [];

    const inDegree = new Map();
    const adjacency = new Map();

    for (const [id, node] of dag.nodes) {
      inDegree.set(id, node.deps.length);
      for (const dep of node.deps) {
        if (!adjacency.has(dep)) adjacency.set(dep, []);
        adjacency.get(dep).push(id);
      }
    }

    const queue = [];
    for (const [id, degree] of inDegree) {
      if (degree === 0) queue.push(id);
    }

    const sorted = [];
    while (queue.length > 0) {
      const current = queue.shift();
      sorted.push(current);

      const neighbors = adjacency.get(current) || [];
      for (const neighbor of neighbors) {
        inDegree.set(neighbor, inDegree.get(neighbor) - 1);
        if (inDegree.get(neighbor) === 0) {
          queue.push(neighbor);
        }
      }
    }

    return sorted;
  }

  // ━━━ 生命周期 / Lifecycle ━━━

  /**
   * 移除已完成的 DAG
   * Remove a completed DAG
   *
   * @param {string} dagId
   */
  removeDAG(dagId) {
    const dag = this._activeDags.get(dagId);
    if (!dag) return;

    // 清理任务索引 / Clean up task index
    for (const nodeId of dag.nodes.keys()) {
      this._taskIndex.delete(`${dagId}:${nodeId}`);
    }

    this._activeDags.delete(dagId);
    this._logger.info?.(`[TaskDAGEngine] DAG removed: ${dagId}`);
  }

  /**
   * 销毁引擎 / Destroy engine
   */
  destroy() {
    this._activeDags.clear();
    this._taskIndex.clear();
    this._agentQueues.clear();
    this._lastStealTime.clear();
    this._completionSet.clear();
    this._pendingAuction.clear();
    this._deadLetterQueue = [];
    this._logger.info?.('[TaskDAGEngine] Destroyed');
  }

  // ━━━ 内部方法 / Internal Methods ━━━

  /**
   * 检测 DAG 环 / Detect cycle in DAG
   *
   * @param {Array<Object>} nodes
   * @returns {string|null} 环路径描述, null 表示无环
   * @private
   */
  _detectCycle(nodes) {
    const nodeMap = new Map(nodes.map(n => [n.id, n]));
    const visited = new Set();
    const inStack = new Set();

    const dfs = (nodeId) => {
      visited.add(nodeId);
      inStack.add(nodeId);

      const node = nodeMap.get(nodeId);
      if (node) {
        for (const dep of (node.deps || [])) {
          if (!nodeMap.has(dep)) continue; // 外部依赖忽略
          if (inStack.has(dep)) return `${dep} → ${nodeId}`;
          if (!visited.has(dep)) {
            const cycle = dfs(dep);
            if (cycle) return cycle;
          }
        }
      }

      inStack.delete(nodeId);
      return null;
    };

    for (const node of nodes) {
      if (!visited.has(node.id)) {
        const cycle = dfs(node.id);
        if (cycle) return cycle;
      }
    }

    return null;
  }

  /**
   * 计算关键路径 (CPM) / Compute Critical Path Method
   *
   * @param {Object} dag
   * @private
   */
  _computeCPM(dag) {
    const sorted = [];
    const inDegree = new Map();
    const adjacency = new Map();

    // 初始化 / Initialize
    for (const [id, node] of dag.nodes) {
      inDegree.set(id, node.deps.length);
      node.earliestStart = 0;
      node.latestStart = Infinity;

      for (const dep of node.deps) {
        if (!adjacency.has(dep)) adjacency.set(dep, []);
        adjacency.get(dep).push(id);
      }
    }

    // 拓扑排序 / Topological sort
    const queue = [];
    for (const [id, degree] of inDegree) {
      if (degree === 0) queue.push(id);
    }
    while (queue.length > 0) {
      const current = queue.shift();
      sorted.push(current);
      const neighbors = adjacency.get(current) || [];
      for (const n of neighbors) {
        inDegree.set(n, inDegree.get(n) - 1);
        if (inDegree.get(n) === 0) queue.push(n);
      }
    }

    // 前向传递: 计算 earliestStart / Forward pass: compute earliestStart
    for (const nodeId of sorted) {
      const node = dag.nodes.get(nodeId);
      for (const depId of node.deps) {
        const dep = dag.nodes.get(depId);
        if (dep) {
          const depFinish = dep.earliestStart + dep.estimatedDuration;
          if (depFinish > node.earliestStart) {
            node.earliestStart = depFinish;
          }
        }
      }
    }

    // 找最大完成时间 / Find max finish time
    let maxFinish = 0;
    for (const node of dag.nodes.values()) {
      const finish = node.earliestStart + node.estimatedDuration;
      if (finish > maxFinish) maxFinish = finish;
    }

    // 后向传递: 计算 latestStart / Backward pass: compute latestStart
    for (let i = sorted.length - 1; i >= 0; i--) {
      const nodeId = sorted[i];
      const node = dag.nodes.get(nodeId);
      const successors = adjacency.get(nodeId) || [];

      if (successors.length === 0) {
        // 终点节点 / Terminal node
        node.latestStart = maxFinish - node.estimatedDuration;
      } else {
        let minLatest = Infinity;
        for (const succId of successors) {
          const succ = dag.nodes.get(succId);
          if (succ && succ.latestStart < minLatest) {
            minLatest = succ.latestStart;
          }
        }
        node.latestStart = minLatest - node.estimatedDuration;
      }
    }

    // 计算松弛量和关键路径 / Compute slack and critical path
    for (const node of dag.nodes.values()) {
      node.slack = node.latestStart - node.earliestStart;
      node.isCritical = node.slack === 0;
    }
  }

  /**
   * 获取关键路径节点 / Get critical path nodes
   *
   * @param {Object} dag
   * @returns {string[]}
   * @private
   */
  _getCriticalPathNodes(dag) {
    const criticalNodes = [];
    for (const [id, node] of dag.nodes) {
      if (node.isCritical) criticalNodes.push(id);
    }
    return criticalNodes;
  }

  /**
   * 调度 DAG 中的就绪任务 / Schedule ready tasks in DAG
   *
   * @param {string} dagId
   * @private
   */
  _scheduleReadyTasks(dagId) {
    const dag = this._activeDags.get(dagId);
    if (!dag) return;

    const readyNodes = [];
    for (const [nodeId, node] of dag.nodes) {
      if (node.state !== TaskState.PENDING) continue;

      // 检查所有前驱是否完成 / Check if all predecessors are completed
      const allDepsComplete = node.deps.every(depId => {
        const dep = dag.nodes.get(depId);
        return dep && dep.state === TaskState.COMPLETED;
      });

      if (allDepsComplete) {
        readyNodes.push({ nodeId, node });
      }
    }

    if (readyNodes.length === 0) return;

    // RCPSP 感知: 按 slack 升序 + 关键路径优先排序
    // RCPSP-aware: sort by slack ascending + critical path priority
    readyNodes.sort((a, b) => {
      if (a.node.isCritical && !b.node.isCritical) return -1;
      if (!a.node.isCritical && b.node.isCritical) return 1;
      return a.node.slack - b.node.slack;
    });

    // 获取可用 agent 数 / Get available agent count
    const agents = this._agentRepo?.listAgents?.('active') || [];
    const limit = Math.min(readyNodes.length, Math.max(agents.length, 1));

    // 拍卖 top N 个任务 / Auction top N tasks
    for (let i = 0; i < limit; i++) {
      const { nodeId, node } = readyNodes[i];

      // 发布 task.available 事件 / Publish task.available event
      this._messageBus?.publish?.(
        EventTopics.TASK_AVAILABLE,
        wrapEvent(EventTopics.TASK_AVAILABLE, {
          dagId, nodeId,
          isCritical: node.isCritical,
          slack: node.slack,
        }, 'task-dag-engine')
      );

      // 简化拍卖 (单进程即时完成) / Simplified auction (single process, immediate)
      if (node.agent) {
        // 角色指定 → 静态分配 / Role specified → static assignment
        this.transitionState(dagId, nodeId, TaskState.ASSIGNED, { agentId: node.agent });
      } else {
        // 拍卖分配 / Auction assignment
        const result = this.auctionTask(dagId, nodeId);
        if (!result.agentId) {
          this._logger.warn?.(
            `[TaskDAGEngine] No bidders for task ${nodeId}, keeping in pending`
          );
        }
      }
    }
  }

  /**
   * 计算 Agent 的投标分数
   * Compute agent bid score
   *
   * bid = capability_match * (1 - load_ratio) * (1 + slackBoost)
   *
   * @param {Object} agent
   * @param {Object} node
   * @param {string} dagId
   * @returns {number}
   * @private
   */
  _computeBidScore(agent, node, dagId) {
    // 能力匹配 / Capability match
    const capMatch = this._getCapabilityMatch(agent.id || agent, node);

    // 负载比 / Load ratio
    const queueLength = (this._agentQueues.get(agent.id) || []).length;
    const loadRatio = Math.min(queueLength / 5, 1); // 5 个任务视为满载

    // 松弛量加成 / Slack boost
    let slackBoost = 0;
    if (node.isCritical) {
      slackBoost = 0.5; // 关键路径任务加成
    } else if (node.slack > 0) {
      slackBoost = -0.2 * Math.min(node.slack / 60000, 1);
    }

    return capMatch * (1 - loadRatio) * (1 + slackBoost);
  }

  /**
   * 获取 Agent 对任务的能力匹配度
   * Get capability match score for agent against task
   *
   * @param {string} agentId
   * @param {Object} node
   * @returns {number} 0-1
   * @private
   */
  _getCapabilityMatch(agentId, node) {
    try {
      if (this._capabilityEngine) {
        const scores = this._capabilityEngine.getScores?.(agentId);
        if (scores) {
          // 简化匹配: 使用 coding 维度作为默认 / Simplified: use coding dimension
          return scores.coding || 0.5;
        }
      }
    } catch { /* silent */ }
    return 0.5; // 默认中性匹配 / Default neutral match
  }

  /**
   * Stigmergic: 沉积信息素到任务路径
   * Deposit pheromone to task path (stigmergy)
   *
   * @param {string} dagId
   * @param {string} nodeId
   * @param {string} type - trail | alarm
   * @param {number} intensity
   * @private
   */
  _depositStigmergy(dagId, nodeId, type, intensity) {
    try {
      this._pheromoneEngine?.emitPheromone?.({
        type,
        sourceId: `dag-${dagId}`,
        targetScope: `/dag/${dagId}/task/${nodeId}`,
        intensity,
        payload: { dagId, nodeId },
      });
    } catch { /* silent */ }
  }

  /**
   * 检查 DAG 是否全部完成
   * Check if all DAG nodes are completed
   *
   * @param {string} dagId
   * @private
   */
  _checkDAGCompletion(dagId) {
    const dag = this._activeDags.get(dagId);
    if (!dag) return;

    let allDone = true;
    for (const node of dag.nodes.values()) {
      if (node.state !== TaskState.COMPLETED && node.state !== TaskState.DEAD_LETTER) {
        allDone = false;
        break;
      }
    }

    if (allDone) {
      dag.status = 'completed';

      this._messageBus?.publish?.(
        EventTopics.DAG_COMPLETED,
        wrapEvent(EventTopics.DAG_COMPLETED, {
          dagId,
          completedAt: Date.now(),
          duration: Date.now() - dag.createdAt,
        }, 'task-dag-engine')
      );

      this._logger.info?.(`[TaskDAGEngine] DAG completed: ${dagId}`);
    }
  }

  /**
   * 添加到死信队列 / Add to Dead Letter Queue
   *
   * @param {string} dagId
   * @param {string} nodeId
   * @param {Object} node
   * @param {Object} data
   * @private
   */
  _addToDeadLetterQueue(dagId, nodeId, node, data) {
    const entry = {
      id: `${dagId}:${nodeId}`,
      dagId,
      taskNodeId: nodeId,
      agentId: node.assignedAgent,
      originalAgent: node.agent,
      retryCount: node.retryCount,
      failureCategory: this._classifyFailure(data),
      error: node.error,
      createdAt: Date.now(),
      reprocessedAt: null,
      resolution: null,
    };

    this._deadLetterQueue.push(entry);

    // 容量控制 / Capacity control
    if (this._deadLetterQueue.length > MAX_DLQ_SIZE) {
      this._deadLetterQueue.shift();
    }

    // V5.5: 持久化到 SQLite / Persist to SQLite
    if (this._db) {
      try {
        this._db.run(
          `INSERT OR REPLACE INTO dead_letter_tasks
            (id, dag_id, task_node_id, agent_id, original_params, failure_category, error_summary, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          entry.id, dagId, nodeId, entry.agentId || null,
          JSON.stringify(node.params || node.input || {}),
          entry.failureCategory, (entry.error || '').substring(0, 500),
          entry.createdAt
        );
      } catch (err) {
        this._logger.debug?.(`[TaskDAGEngine] DLQ persistence error: ${err.message}`);
      }
    }

    // 发布 DLQ 事件 / Publish DLQ event
    this._messageBus?.publish?.(
      EventTopics.TASK_DEAD_LETTER,
      wrapEvent(EventTopics.TASK_DEAD_LETTER, entry, 'task-dag-engine')
    );

    // 传播失败到下游 / Propagate failure to downstream
    this.propagateUpstreamFailure(dagId, nodeId);

    this._logger.warn?.(
      `[TaskDAGEngine] Task entered DLQ: ${dagId}:${nodeId}, category=${entry.failureCategory}`
    );
  }

  /**
   * 分类失败原因 / Classify failure reason
   *
   * @param {Object} data
   * @returns {string}
   * @private
   */
  _classifyFailure(data) {
    const error = (data.error || data.reason || '').toLowerCase();
    if (error.includes('timeout')) return 'timeout';
    if (error.includes('tool') || error.includes('schema')) return 'tool_error';
    if (error.includes('invalid') || error.includes('format')) return 'invalid_output';
    return 'agent_crash';
  }
}
