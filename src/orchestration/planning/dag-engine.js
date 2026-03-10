/**
 * DAGEngine -- DAG (Directed Acyclic Graph) 执行引擎
 * DAG execution engine for task dependency management
 *
 * 管理任务节点的依赖关系、状态流转、重试策略和死信队列。
 * 使用 Kahn 算法进行拓扑排序和循环检测，确保 DAG 无环。
 * Manages task node dependencies, state transitions, retry policies,
 * and dead-letter queues. Uses Kahn's algorithm for topological sort
 * and cycle detection to ensure acyclic graphs.
 *
 * @module orchestration/planning/dag-engine
 * @version 9.0.0
 */

import { ModuleBase } from '../../core/module-base.js';
import { DIM_TASK, DIM_COORDINATION, DIM_ALARM } from '../../core/field/types.js';

// ============================================================================
// 默认配置 / Default Configuration
// ============================================================================

const DEFAULT_CONFIG = {
  /** 单节点最大重试次数 / Max retries per node */
  maxRetries: 3,
  /** 死信队列最大容量 / Max dead-letter queue size */
  maxDLQSize: 100,
  /** 工作窃取冷却时间 (ms) / Work-steal cooldown in ms */
  workStealCooldownMs: 5000,
  /** 节点执行超时 (ms) / Node execution timeout in ms */
  nodeTimeoutMs: 300000,
};

// ============================================================================
// 节点状态常量 / Node State Constants
// ============================================================================

/** @enum {string} */
const NODE_STATE = Object.freeze({
  PENDING:     'PENDING',
  SPAWNING:    'SPAWNING',
  ASSIGNED:    'ASSIGNED',
  EXECUTING:   'EXECUTING',
  COMPLETED:   'COMPLETED',
  FAILED:      'FAILED',
  DEAD_LETTER: 'DEAD_LETTER',
});

// ============================================================================
// JSDoc 类型定义 / JSDoc Type Definitions
// ============================================================================

/**
 * DAG 节点 -- DAG 中的单个任务单元
 * A single task unit within the DAG
 *
 * @typedef {Object} DAGNode
 * @property {string}   id          - 节点唯一标识 / Unique node identifier
 * @property {string}   taskId      - 任务描述 / Task description
 * @property {string}   role        - 执行角色 / Execution role
 * @property {string[]} dependsOn   - 依赖的节点 ID 列表 / Dependency node IDs
 * @property {string}   state       - 当前状态 / Current state (NODE_STATE)
 * @property {number}   retries     - 已重试次数 / Retry count
 * @property {string}   [assignedTo]  - 分配给的 agent ID / Assigned agent ID
 * @property {object}   [result]      - 执行结果 / Execution result
 * @property {number}   [startedAt]   - 开始执行时间戳 / Execution start timestamp
 * @property {number}   [completedAt] - 完成时间戳 / Completion timestamp
 * @property {string}   [branchId]    - 分支标识 / Branch identifier
 */

/**
 * DAG 结构 -- 完整的有向无环图
 * Complete directed acyclic graph structure
 *
 * @typedef {Object} DAG
 * @property {string}               id        - DAG 唯一标识 / Unique DAG identifier
 * @property {Map<string, DAGNode>} nodes     - 节点映射 / Node map
 * @property {number}               createdAt - 创建时间戳 / Creation timestamp
 * @property {string}               status    - DAG 状态 / DAG status ('active'|'completed'|'cancelled')
 */

/**
 * 死信队列条目 / Dead-letter queue entry
 *
 * @typedef {Object} DLQEntry
 * @property {string} dagId     - 所属 DAG ID / Parent DAG ID
 * @property {string} nodeId    - 节点 ID / Node ID
 * @property {string} taskId    - 任务描述 / Task description
 * @property {string} role      - 角色 / Role
 * @property {number} retries   - 已重试次数 / Retry count
 * @property {string} lastError - 最后一次错误 / Last error message
 * @property {number} addedAt   - 加入 DLQ 的时间 / Timestamp added to DLQ
 */

// ============================================================================
// DAGEngine 类 / DAGEngine Class
// ============================================================================

export class DAGEngine extends ModuleBase {
  /**
   * @param {Object} deps
   * @param {Object} deps.field           - 信号场实例 / Signal field instance
   * @param {Object} deps.bus             - 事件总线实例 / Event bus instance
   * @param {Object} [deps.store]         - 持久化存储 / Persistence store
   * @param {Object} [deps.config]        - 配置覆盖 / Configuration overrides
   */
  constructor({ field, bus, store, config } = {}) {
    super();
    /** @type {Object} */
    this._field = field;
    /** @type {Object} */
    this._bus = bus;
    /** @type {Object|null} */
    this._store = store ?? null;
    /** @type {Object} */
    this._config = { ...DEFAULT_CONFIG, ...config };

    /** @type {Map<string, DAG>} 活跃 DAG 映射 / Active DAGs */
    this._dags = new Map();
    /** @type {DLQEntry[]} 死信队列 / Dead-letter queue */
    this._deadLetterQueue = [];
    /** @type {Map<string, number>} nodeId -> 上次窃取时间 / Last steal timestamp */
    this._cooldowns = new Map();
  }

  // --------------------------------------------------------------------------
  // 静态声明 / Static Declarations
  // --------------------------------------------------------------------------

  /** @returns {string[]} 产生的信号维度 / Signal dimensions produced */
  static produces() { return [DIM_TASK, DIM_COORDINATION]; }

  /** @returns {string[]} 消费的信号维度 / Signal dimensions consumed */
  static consumes() { return [DIM_ALARM]; }

  /** @returns {string[]} 发布的事件主题 / Event topics published */
  static publishes() {
    return [
      'dag.created',
      'dag.phase.ready',
      'dag.phase.completed',
      'dag.phase.failed',
      'dag.completed',
      'dag.dlq.added',
    ];
  }

  /** @returns {string[]} 订阅的事件主题 / Event topics subscribed */
  static subscribes() {
    return ['agent.completed', 'agent.failed'];
  }

  // --------------------------------------------------------------------------
  // 核心方法 / Core Methods
  // --------------------------------------------------------------------------

  /**
   * 创建 DAG -- Kahn 算法验证无环后存储并发布事件
   * Create a DAG. Validates acyclicity via Kahn's algorithm, stores it,
   * and publishes creation events.
   *
   * @param {string}    dagId    - DAG 唯一标识 / Unique DAG identifier
   * @param {DAGNode[]} nodes    - 节点数组 / Array of node definitions
   * @returns {DAG} 创建的 DAG 对象 / The created DAG object
   * @throws {Error} 如果检测到循环依赖 / If cyclic dependency is detected
   * @throws {Error} 如果 dagId 已存在 / If dagId already exists
   */
  createDAG(dagId, nodes) {
    if (this._dags.has(dagId)) {
      throw new Error(`DAG "${dagId}" already exists`);
    }
    if (!nodes || nodes.length === 0) {
      throw new Error('Cannot create DAG with empty nodes');
    }

    // 构建 DAGNode 对象, 设置默认值 / Build DAGNode objects with defaults
    const nodeMap = new Map();
    for (const node of nodes) {
      nodeMap.set(node.id, {
        id:          node.id,
        taskId:      node.taskId,
        role:        node.role,
        dependsOn:   node.dependsOn ?? [],
        state:       NODE_STATE.PENDING,
        retries:     0,
        assignedTo:  null,
        result:      null,
        startedAt:   null,
        completedAt: null,
        branchId:    node.branchId ?? null,
      });
    }

    // Kahn 算法验证无环 / Validate acyclicity via Kahn's algorithm
    this._topologicalSort(nodeMap);

    /** @type {DAG} */
    const dag = {
      id: dagId,
      nodes: nodeMap,
      createdAt: Date.now(),
      status: 'active',
    };
    this._dags.set(dagId, dag);

    // 发射 DIM_TASK 信号 / Emit DIM_TASK signal
    this._field?.emit?.({
      dimension: DIM_TASK,
      scope:     dagId,
      strength:  0.8,
      metadata:  { type: 'dag.created', nodeCount: nodes.length },
    });

    // 发布 dag.created 事件 / Publish dag.created event
    this._bus?.emit?.('dag.created', { dagId, nodeCount: nodes.length });

    // 检查并发布初始就绪节点 / Check and publish initially ready nodes
    const readyNodes = this.getReady(dagId);
    if (readyNodes.length > 0) {
      this._bus?.emit?.('dag.phase.ready', {
        dagId,
        nodeIds: readyNodes.map(n => n.id),
      });
    }

    return dag;
  }

  /**
   * 获取所有就绪节点 -- 依赖全部 COMPLETED 且自身 PENDING
   * Get all ready nodes: dependencies all COMPLETED and self is PENDING
   *
   * @param {string} dagId - DAG 标识 / DAG identifier
   * @returns {DAGNode[]} 就绪节点列表 / List of ready nodes
   * @throws {Error} 如果 DAG 不存在 / If DAG not found
   */
  getReady(dagId) {
    const dag = this._getDAG(dagId);
    const ready = [];

    for (const node of dag.nodes.values()) {
      if (node.state !== NODE_STATE.PENDING) continue;
      const allDepsCompleted = node.dependsOn.every(depId => {
        const dep = dag.nodes.get(depId);
        return dep && dep.state === NODE_STATE.COMPLETED;
      });
      if (allDepsCompleted) {
        ready.push(node);
      }
    }

    return ready;
  }

  /**
   * 分配节点给 agent -- PENDING -> ASSIGNED
   * Assign a node to an agent: PENDING -> ASSIGNED
   *
   * @param {string} dagId   - DAG 标识 / DAG identifier
   * @param {string} nodeId  - 节点标识 / Node identifier
   * @param {string} agentId - Agent 标识 / Agent identifier
   * @throws {Error} 如果节点状态不是 PENDING / If node is not PENDING
   */
  assignNode(dagId, nodeId, agentId) {
    const node = this._getNode(dagId, nodeId);
    if (node.state !== NODE_STATE.PENDING) {
      throw new Error(
        `Cannot assign node "${nodeId}": expected PENDING, got ${node.state}`
      );
    }
    node.state = NODE_STATE.ASSIGNED;
    node.assignedTo = agentId;
    node.startedAt = Date.now();
  }

  /**
   * 标记节点开始执行 -- ASSIGNED -> EXECUTING
   * Mark node as executing: ASSIGNED -> EXECUTING
   *
   * @param {string} dagId  - DAG 标识 / DAG identifier
   * @param {string} nodeId - 节点标识 / Node identifier
   * @throws {Error} 如果节点状态不是 ASSIGNED / If node is not ASSIGNED
   */
  startNode(dagId, nodeId) {
    const node = this._getNode(dagId, nodeId);
    if (node.state !== NODE_STATE.ASSIGNED) {
      throw new Error(
        `Cannot start node "${nodeId}": expected ASSIGNED, got ${node.state}`
      );
    }
    node.state = NODE_STATE.EXECUTING;
  }

  /**
   * 完成节点 -- EXECUTING -> COMPLETED, 检查新就绪节点和整体完成
   * Complete a node: EXECUTING -> COMPLETED.
   * Checks for newly ready nodes and overall DAG completion.
   *
   * @param {string} dagId  - DAG 标识 / DAG identifier
   * @param {string} nodeId - 节点标识 / Node identifier
   * @param {object} result - 执行结果 / Execution result
   */
  completeNode(dagId, nodeId, result) {
    const node = this._getNode(dagId, nodeId);
    if (node.state !== NODE_STATE.EXECUTING) {
      throw new Error(
        `Cannot complete node "${nodeId}": expected EXECUTING, got ${node.state}`
      );
    }
    node.state = NODE_STATE.COMPLETED;
    node.result = result;
    node.completedAt = Date.now();

    // 发布节点完成事件 / Publish node completion event
    this._bus?.emit?.('dag.phase.completed', { dagId, nodeId, result });

    // 发射 DIM_COORDINATION 信号 / Emit coordination signal
    this._field?.emit?.({
      dimension: DIM_COORDINATION,
      scope:     dagId,
      strength:  0.6,
      metadata:  { type: 'node.completed', nodeId },
    });

    // 检查新就绪节点 / Check for newly ready nodes
    const newReady = this.getReady(dagId);
    if (newReady.length > 0) {
      this._bus?.emit?.('dag.phase.ready', {
        dagId,
        nodeIds: newReady.map(n => n.id),
      });
    }

    // 检查 DAG 是否全部完成 / Check if DAG is fully completed
    const dag = this._getDAG(dagId);
    const allCompleted = [...dag.nodes.values()].every(
      n => n.state === NODE_STATE.COMPLETED || n.state === NODE_STATE.DEAD_LETTER
    );
    if (allCompleted) {
      dag.status = 'completed';
      this._bus?.emit?.('dag.completed', { dagId });
      this._field?.emit?.({
        dimension: DIM_TASK,
        scope:     dagId,
        strength:  1.0,
        metadata:  { type: 'dag.completed' },
      });
    }
  }

  /**
   * 标记节点失败 -- 重试或进入死信队列
   * Mark a node as failed. Retries if under limit, otherwise sends to DLQ.
   *
   * @param {string} dagId  - DAG 标识 / DAG identifier
   * @param {string} nodeId - 节点标识 / Node identifier
   * @param {string|Error} error - 错误信息 / Error information
   */
  failNode(dagId, nodeId, error) {
    const node = this._getNode(dagId, nodeId);
    const errorMsg = error instanceof Error ? error.message : String(error);

    node.retries += 1;

    // 发布失败事件 / Publish failure event
    this._bus?.emit?.('dag.phase.failed', {
      dagId,
      nodeId,
      error: errorMsg,
      retries: node.retries,
    });

    if (node.retries < this._config.maxRetries) {
      // 重试: 重置为 PENDING / Retry: reset to PENDING
      node.state = NODE_STATE.PENDING;
      node.assignedTo = null;
      node.startedAt = null;
    } else {
      // 超过重试限制: 进入死信队列 / Exceeded retry limit: move to DLQ
      node.state = NODE_STATE.DEAD_LETTER;
      this._addToDLQ(dagId, node, errorMsg);

      // 发射 DIM_ALARM 信号 / Emit alarm signal
      this._field?.emit?.({
        dimension: DIM_ALARM,
        scope:     dagId,
        strength:  0.9,
        metadata:  { type: 'node.dead_letter', nodeId, error: errorMsg },
      });
    }
  }

  /**
   * 工作窃取 -- 空闲 agent 窃取等待最久的 PENDING 节点
   * Work stealing: an idle agent steals the longest-waiting PENDING node
   * that has passed its cooldown period.
   *
   * @param {string} dagId       - DAG 标识 / DAG identifier
   * @param {string} idleAgentId - 空闲 agent 的标识 / Idle agent identifier
   * @returns {DAGNode|null} 被窃取的节点或 null / Stolen node or null
   */
  stealWork(dagId, idleAgentId) {
    const readyNodes = this.getReady(dagId);
    if (readyNodes.length === 0) return null;

    const now = Date.now();
    const cooldownMs = this._config.workStealCooldownMs;

    // 过滤冷却期已过的节点, 按等待时间排序 / Filter by cooldown, sort by wait time
    const eligible = readyNodes
      .filter(node => {
        const lastSteal = this._cooldowns.get(node.id) ?? 0;
        return (now - lastSteal) >= cooldownMs;
      })
      .sort((a, b) => {
        // 没有 startedAt 的都是从未被处理的, 视为最早 / Never processed = earliest
        const aTime = a.startedAt ?? 0;
        const bTime = b.startedAt ?? 0;
        return aTime - bTime;
      });

    if (eligible.length === 0) return null;

    const stolen = eligible[0];
    this._cooldowns.set(stolen.id, now);
    this.assignNode(dagId, stolen.id, idleAgentId);
    return stolen;
  }

  /**
   * 竞标分配 -- 接收多个 bid, 选最优者分配节点
   * Auction a node: receive bids, select the best, and assign.
   *
   * @param {string} dagId  - DAG 标识 / DAG identifier
   * @param {string} nodeId - 节点标识 / Node identifier
   * @param {Array<{agentId: string, score: number, reason?: string}>} bids - 竞标列表 / List of bids
   * @returns {{agentId: string, score: number}|null} 获胜 bid 或 null / Winning bid or null
   */
  auctionNode(dagId, nodeId, bids) {
    if (!bids || bids.length === 0) return null;

    // 验证节点状态 / Validate node state
    const node = this._getNode(dagId, nodeId);
    if (node.state !== NODE_STATE.PENDING) {
      throw new Error(
        `Cannot auction node "${nodeId}": expected PENDING, got ${node.state}`
      );
    }

    // 选最高分 bid / Select highest-score bid
    const winner = bids.reduce((best, bid) =>
      bid.score > best.score ? bid : best
    );

    this.assignNode(dagId, winner.agentId, winner.agentId);
    return { agentId: winner.agentId, score: winner.score };
  }

  /**
   * 获取 DAG 状态概要
   * Get DAG status summary
   *
   * @param {string} dagId - DAG 标识 / DAG identifier
   * @returns {{total: number, pending: number, executing: number, completed: number, failed: number, deadLetter: number}}
   */
  getDAGStatus(dagId) {
    const dag = this._getDAG(dagId);
    const counts = {
      total:      0,
      pending:    0,
      spawning:   0,
      assigned:   0,
      executing:  0,
      completed:  0,
      failed:     0,
      deadLetter: 0,
    };

    for (const node of dag.nodes.values()) {
      counts.total += 1;
      switch (node.state) {
        case NODE_STATE.PENDING:     counts.pending    += 1; break;
        case NODE_STATE.SPAWNING:    counts.spawning   += 1; break;
        case NODE_STATE.ASSIGNED:    counts.assigned   += 1; break;
        case NODE_STATE.EXECUTING:   counts.executing  += 1; break;
        case NODE_STATE.COMPLETED:   counts.completed  += 1; break;
        case NODE_STATE.FAILED:      counts.failed     += 1; break;
        case NODE_STATE.DEAD_LETTER: counts.deadLetter += 1; break;
      }
    }

    return counts;
  }

  /**
   * 获取单个节点状态
   * Get single node status
   *
   * @param {string} dagId  - DAG 标识 / DAG identifier
   * @param {string} nodeId - 节点标识 / Node identifier
   * @returns {DAGNode} 节点对象的浅拷贝 / Shallow copy of the node
   */
  getNodeStatus(dagId, nodeId) {
    const node = this._getNode(dagId, nodeId);
    return { ...node };
  }

  /**
   * 获取死信队列条目
   * Get dead-letter queue entries
   *
   * @param {number} [limit] - 返回数量上限 / Max entries to return
   * @returns {DLQEntry[]} DLQ 条目 / DLQ entries (newest first)
   */
  getDeadLetterQueue(limit) {
    const entries = [...this._deadLetterQueue].reverse();
    return limit != null ? entries.slice(0, limit) : entries;
  }

  /**
   * 取消 DAG -- 将所有未完成节点标记为 DEAD_LETTER
   * Cancel a DAG: mark all incomplete nodes as DEAD_LETTER
   *
   * @param {string} dagId - DAG 标识 / DAG identifier
   */
  cancelDAG(dagId) {
    const dag = this._getDAG(dagId);
    const terminalStates = new Set([
      NODE_STATE.COMPLETED,
      NODE_STATE.DEAD_LETTER,
    ]);

    for (const node of dag.nodes.values()) {
      if (!terminalStates.has(node.state)) {
        node.state = NODE_STATE.DEAD_LETTER;
        node.completedAt = Date.now();
      }
    }

    dag.status = 'cancelled';
  }

  // --------------------------------------------------------------------------
  // 内部方法 / Internal Methods
  // --------------------------------------------------------------------------

  /**
   * Kahn 拓扑排序 -- 检测循环依赖
   * Kahn's topological sort for cycle detection
   *
   * @param {Map<string, DAGNode>} nodeMap - 节点映射 / Node map
   * @returns {string[]} 拓扑排序后的节点 ID / Topologically sorted node IDs
   * @throws {Error} 如果存在循环依赖 / If cyclic dependency exists
   * @private
   */
  _topologicalSort(nodeMap) {
    // 构建入度表 / Build in-degree table
    const inDegree = new Map();
    const adjacency = new Map();

    for (const node of nodeMap.values()) {
      if (!inDegree.has(node.id)) inDegree.set(node.id, 0);
      if (!adjacency.has(node.id)) adjacency.set(node.id, []);

      for (const depId of node.dependsOn) {
        if (!nodeMap.has(depId)) {
          throw new Error(
            `Node "${node.id}" depends on unknown node "${depId}"`
          );
        }
        if (!adjacency.has(depId)) adjacency.set(depId, []);
        adjacency.get(depId).push(node.id);
        inDegree.set(node.id, (inDegree.get(node.id) ?? 0) + 1);
      }
    }

    // Kahn BFS / Kahn's BFS
    const queue = [];
    for (const [id, deg] of inDegree) {
      if (deg === 0) queue.push(id);
    }

    const sorted = [];
    while (queue.length > 0) {
      const current = queue.shift();
      sorted.push(current);

      for (const neighbor of (adjacency.get(current) ?? [])) {
        const newDeg = inDegree.get(neighbor) - 1;
        inDegree.set(neighbor, newDeg);
        if (newDeg === 0) queue.push(neighbor);
      }
    }

    if (sorted.length < nodeMap.size) {
      const cycleNodes = [...nodeMap.keys()].filter(id => !sorted.includes(id));
      throw new Error(
        `Cyclic dependency detected among nodes: [${cycleNodes.join(', ')}]`
      );
    }

    return sorted;
  }

  /**
   * 添加到死信队列, 超容量删最旧
   * Add entry to dead-letter queue, evict oldest if over capacity
   *
   * @param {string}  dagId  - DAG 标识 / DAG identifier
   * @param {DAGNode} node   - 失败节点 / Failed node
   * @param {string}  error  - 错误信息 / Error message
   * @private
   */
  _addToDLQ(dagId, node, error) {
    /** @type {DLQEntry} */
    const entry = {
      dagId,
      nodeId:    node.id,
      taskId:    node.taskId,
      role:      node.role,
      retries:   node.retries,
      lastError: error,
      addedAt:   Date.now(),
    };

    this._deadLetterQueue.push(entry);

    // 超容量时删除最旧条目 / Evict oldest when over capacity
    while (this._deadLetterQueue.length > this._config.maxDLQSize) {
      this._deadLetterQueue.shift();
    }

    this._bus?.emit?.('dag.dlq.added', entry);
  }

  /**
   * 获取 DAG 实例, 不存在则抛出
   * Get DAG instance or throw if not found
   *
   * @param {string} dagId - DAG 标识 / DAG identifier
   * @returns {DAG}
   * @throws {Error} 如果 DAG 不存在 / If DAG not found
   * @private
   */
  _getDAG(dagId) {
    const dag = this._dags.get(dagId);
    if (!dag) throw new Error(`DAG "${dagId}" not found`);
    return dag;
  }

  /**
   * 获取 DAG 中的节点, 不存在则抛出
   * Get node from DAG or throw if not found
   *
   * @param {string} dagId  - DAG 标识 / DAG identifier
   * @param {string} nodeId - 节点标识 / Node identifier
   * @returns {DAGNode}
   * @throws {Error} 如果 DAG 或节点不存在 / If DAG or node not found
   * @private
   */
  _getNode(dagId, nodeId) {
    const dag = this._getDAG(dagId);
    const node = dag.nodes.get(nodeId);
    if (!node) throw new Error(`Node "${nodeId}" not found in DAG "${dagId}"`);
    return node;
  }
}

export { NODE_STATE, DEFAULT_CONFIG };
export default DAGEngine;
