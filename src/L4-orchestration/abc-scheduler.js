/**
 * ABCScheduler -- 人工蜂群调度器 / Artificial Bee Colony Scheduler
 *
 * V5.0 新增模块: 基于 Karaboga 人工蜂群 (ABC) 优化算法的任务调度器。
 * 将 Agent 群体划分为三种角色, 通过信息共享和随机探索实现全局最优调度。
 *
 * V5.0 new module: task scheduler based on Karaboga's Artificial Bee Colony
 * (ABC) optimization algorithm. Divides agent population into three roles,
 * achieving global optimal scheduling through information sharing and
 * random exploration.
 *
 * ABC Roles / ABC 角色:
 *   employed (50%): 引领蜂 — 开发已知食物源 (执行已分配任务)
 *     Employed bees — exploit known food sources (execute assigned tasks)
 *   onlooker (45%): 跟随蜂 — P(select_i) = quality_i / sum(quality_j) 轮盘赌选择
 *     Onlooker bees — roulette wheel selection based on solution quality
 *   scout (5%): 侦察蜂 — 放弃低质量方案, 随机探索新方案
 *     Scout bees — abandon low quality solutions, random exploration
 *
 * @module L4-orchestration/abc-scheduler
 * @author DEEP-IOS
 */

import { nanoid } from 'nanoid';
import { ABCRole } from '../L1-infrastructure/types.js';

// ============================================================================
// 常量 / Constants
// ============================================================================

/** 默认角色比例 / Default role proportions */
const DEFAULT_RATIOS = {
  employed: 0.50,
  onlooker: 0.45,
  scout: 0.05,
};

/** 默认放弃阈值: 连续未改善次数 / Default abandon threshold: consecutive non-improvement count */
const DEFAULT_ABANDON_THRESHOLD = 5;

/** 默认最大迭代数 / Default max iterations */
const DEFAULT_MAX_ITERATIONS = 100;

/** 最小适应度值 (防除零) / Min fitness value (prevent division by zero) */
const MIN_FITNESS = 0.001;

// ============================================================================
// ABCScheduler 类 / ABCScheduler Class
// ============================================================================

/**
 * 人工蜂群调度器: 基于 ABC 算法的任务分配与调度。
 * ABC scheduler: task assignment and scheduling based on ABC algorithm.
 *
 * @example
 * ```js
 * const scheduler = new ABCScheduler({ messageBus, config, logger });
 *
 * // 1. 分类 Agent / Classify agents
 * const { employed, onlookers, scouts } = scheduler.classifyAgents(agents);
 *
 * // 2. 分配任务 / Assign tasks
 * const assignments = scheduler.assignTasks(agents, tasks);
 *
 * // 3. 轮盘赌选择 / Roulette wheel selection
 * const selected = scheduler.selectByQuality(solutions);
 *
 * // 4. 检查是否应变为侦察蜂 / Check if agent should become scout
 * const shouldScout = scheduler.shouldScout('agent-123');
 *
 * // 5. 随机探索 / Random exploration
 * const newSolution = scheduler.explore();
 * ```
 */
export class ABCScheduler {
  /**
   * @param {Object} [deps] - 依赖注入 / Dependency injection
   * @param {import('../L2-communication/message-bus.js').MessageBus} [deps.messageBus] - 消息总线
   * @param {Object} [deps.config] - 配置 / Configuration
   * @param {Object} [deps.config.ratios] - 角色比例 / Role ratios { employed, onlooker, scout }
   * @param {number} [deps.config.abandonThreshold=5] - 放弃阈值 / Abandon threshold
   * @param {number} [deps.config.maxIterations=100] - 最大迭代数 / Max iterations
   * @param {Object} [deps.logger] - 日志器 / Logger
   */
  constructor({ messageBus, config = {}, logger } = {}) {
    /** @private */
    this._messageBus = messageBus || null;

    /** @private */
    this._logger = logger || console;

    /** @private @type {{ employed: number, onlooker: number, scout: number }} */
    this._ratios = {
      employed: config.ratios?.employed ?? DEFAULT_RATIOS.employed,
      onlooker: config.ratios?.onlooker ?? DEFAULT_RATIOS.onlooker,
      scout: config.ratios?.scout ?? DEFAULT_RATIOS.scout,
    };

    /** @private @type {number} */
    this._abandonThreshold = config.abandonThreshold ?? DEFAULT_ABANDON_THRESHOLD;

    /** @private @type {number} */
    this._maxIterations = config.maxIterations ?? DEFAULT_MAX_ITERATIONS;

    /**
     * Agent 状态追踪: agentId -> { role, trialCount, fitness, taskId, lastImprovedAt }
     * Agent state tracking
     * @private @type {Map<string, Object>}
     */
    this._agentStates = new Map();

    /**
     * 食物源 (解决方案): solutionId -> { id, taskId, agentId, quality, fitness, trialCount }
     * Food sources (solutions)
     * @private @type {Map<string, Object>}
     */
    this._foodSources = new Map();

    /** @private @type {{ iterations: number, employed: number, onlooker: number, scout: number, explorations: number, abandonments: number }} */
    this._stats = {
      iterations: 0,
      employed: 0,
      onlooker: 0,
      scout: 0,
      explorations: 0,
      abandonments: 0,
    };
  }

  // =========================================================================
  // Agent 分类 / Agent Classification
  // =========================================================================

  /**
   * 将 Agent 列表分类为 employed / onlooker / scout 三组
   * Classify agent list into employed / onlooker / scout groups
   *
   * 分类依据 / Classification criteria:
   *   - 有活跃任务且质量达标 → employed (引领蜂)
   *   - 空闲或待分配 → onlooker (跟随蜂)
   *   - 连续未改善超阈值 → scout (侦察蜂)
   *
   * 若按自然分类后比例偏离目标比例过大, 则强制调整:
   * If natural classification deviates too much from target ratios,
   * forced adjustment is applied.
   *
   * @param {Array<Object>} agents - Agent 列表, 每个需 { id, status, taskId?, performance? }
   * @returns {{
   *   employed: Array<Object>,
   *   onlookers: Array<Object>,
   *   scouts: Array<Object>
   * }}
   */
  classifyAgents(agents) {
    if (!agents || agents.length === 0) {
      return { employed: [], onlookers: [], scouts: [] };
    }

    const total = agents.length;
    const targetEmployed = Math.round(total * this._ratios.employed);
    const targetScout = Math.max(1, Math.round(total * this._ratios.scout));
    // onlooker 取剩余 / Onlooker gets the rest
    const targetOnlooker = Math.max(0, total - targetEmployed - targetScout);

    // 1. 自然分类 / Natural classification
    const naturalEmployed = [];
    const naturalOnlooker = [];
    const naturalScout = [];

    for (const agent of agents) {
      const state = this._agentStates.get(agent.id);

      // 侦察蜂判定: 连续未改善超阈值 / Scout: consecutive non-improvement exceeds threshold
      if (state && state.trialCount >= this._abandonThreshold) {
        naturalScout.push(agent);
        continue;
      }

      // 引领蜂判定: 有活跃任务 / Employed: has active task
      if (agent.taskId || (agent.status === 'busy')) {
        naturalEmployed.push(agent);
        continue;
      }

      // 跟随蜂: 空闲或待分配 / Onlooker: idle or awaiting assignment
      naturalOnlooker.push(agent);
    }

    // 2. 平衡调整: 确保比例大致正确 / Balance: ensure roughly correct ratios
    const employed = [];
    const onlookers = [];
    const scouts = [];

    // 先填充侦察蜂 (优先使用自然侦察蜂) / Fill scouts first
    for (const agent of naturalScout) {
      if (scouts.length < targetScout) {
        scouts.push(agent);
        this._setAgentRole(agent.id, ABCRole.scout);
      } else {
        // 超出的侦察蜂降级为跟随蜂 / Excess scouts become onlookers
        naturalOnlooker.push(agent);
      }
    }

    // 填充引领蜂 / Fill employed
    for (const agent of naturalEmployed) {
      if (employed.length < targetEmployed) {
        employed.push(agent);
        this._setAgentRole(agent.id, ABCRole.employed);
      } else {
        naturalOnlooker.push(agent);
      }
    }

    // 剩余全部为跟随蜂 / Remaining become onlookers
    for (const agent of naturalOnlooker) {
      onlookers.push(agent);
      this._setAgentRole(agent.id, ABCRole.onlooker);
    }

    // 如果侦察蜂不足, 从跟随蜂中补充 / If scouts insufficient, supplement from onlookers
    while (scouts.length < targetScout && onlookers.length > 0) {
      const agent = onlookers.pop();
      scouts.push(agent);
      this._setAgentRole(agent.id, ABCRole.scout);
    }

    // 更新统计 / Update stats
    this._stats.employed = employed.length;
    this._stats.onlooker = onlookers.length;
    this._stats.scout = scouts.length;

    this._emit('abc.classified', {
      total,
      employed: employed.length,
      onlookers: onlookers.length,
      scouts: scouts.length,
    });

    return { employed, onlookers, scouts };
  }

  // =========================================================================
  // 任务分配 / Task Assignment
  // =========================================================================

  /**
   * 根据 ABC 算法分配任务给 Agent
   * Assign tasks to agents using ABC algorithm
   *
   * 分配策略 / Assignment strategy:
   *   1. employed → 保持当前任务 / Keep current task
   *   2. onlooker → 按质量轮盘赌选择任务 / Roulette wheel select by quality
   *   3. scout → 随机分配未处理任务 / Random assign unprocessed tasks
   *
   * @param {Array<Object>} agents - Agent 列表 / Agent list
   * @param {Array<Object>} tasks - 待分配任务 / Tasks to assign
   * @returns {Map<string, string>} agentId -> taskId 映射 / Assignment map
   */
  assignTasks(agents, tasks) {
    if (!agents || agents.length === 0 || !tasks || tasks.length === 0) {
      return new Map();
    }

    this._stats.iterations++;

    // 分类 / Classify
    const { employed, onlookers, scouts } = this.classifyAgents(agents);

    /** @type {Map<string, string>} agentId -> taskId */
    const assignments = new Map();

    // 已分配的任务集 / Set of assigned task IDs
    const assignedTaskIds = new Set();

    // 1. employed 保持当前任务 / Employed keep current tasks
    for (const agent of employed) {
      if (agent.taskId) {
        assignments.set(agent.id, agent.taskId);
        assignedTaskIds.add(agent.taskId);
      }
    }

    // 未分配的任务 / Unassigned tasks
    const unassignedTasks = tasks.filter(t =>
      !assignedTaskIds.has(t.id) && t.status !== 'completed' && t.status !== 'cancelled'
    );

    // 2. onlooker 轮盘赌选择 / Onlookers: roulette wheel selection
    if (onlookers.length > 0 && unassignedTasks.length > 0) {
      // 构建食物源 (以任务为食物源) / Build food sources from tasks
      const sources = unassignedTasks.map(t => ({
        id: t.id,
        quality: t.priority !== undefined ? t.priority / 10 : 0.5,
      }));

      for (const agent of onlookers) {
        if (sources.length === 0) break;

        const selected = this.selectByQuality(sources);
        if (selected) {
          assignments.set(agent.id, selected.id);
          assignedTaskIds.add(selected.id);

          // 从候选中移除已选的 / Remove selected from candidates
          const idx = sources.findIndex(s => s.id === selected.id);
          if (idx >= 0) sources.splice(idx, 1);

          this._initAgentState(agent.id, selected.id, selected.quality);
        }
      }
    }

    // 3. scout 随机探索: 分配剩余任务 / Scouts: random assign remaining
    const remainingTasks = unassignedTasks.filter(t => !assignedTaskIds.has(t.id));
    for (const agent of scouts) {
      if (remainingTasks.length === 0) break;

      const randomIdx = Math.floor(Math.random() * remainingTasks.length);
      const task = remainingTasks.splice(randomIdx, 1)[0];

      assignments.set(agent.id, task.id);
      assignedTaskIds.add(task.id);

      // 重置 Agent 状态 / Reset agent state
      this._resetAgentState(agent.id, task.id);
      this._stats.explorations++;
    }

    this._emit('abc.assigned', {
      iteration: this._stats.iterations,
      totalAgents: agents.length,
      totalTasks: tasks.length,
      assigned: assignments.size,
    });

    this._logger.debug?.(
      `[ABCScheduler] 任务分配完成 / Tasks assigned: ${assignments.size} / ` +
      `(iteration ${this._stats.iterations})`
    );

    return assignments;
  }

  // =========================================================================
  // 轮盘赌选择 / Roulette Wheel Selection
  // =========================================================================

  /**
   * 按质量/适应度轮盘赌选择
   * Roulette wheel selection based on quality/fitness
   *
   * P(select_i) = quality_i / sum(quality_j)
   *
   * 概率与质量成正比, 高质量方案被选中的概率更大。
   * Probability proportional to quality, higher quality solutions
   * are more likely to be selected.
   *
   * @param {Array<{ id: string, quality: number }>} solutions - 候选方案 / Candidate solutions
   * @returns {Object|null} 选中的方案 / Selected solution
   */
  selectByQuality(solutions) {
    if (!solutions || solutions.length === 0) return null;
    if (solutions.length === 1) return solutions[0];

    // 确保所有 quality >= MIN_FITNESS / Ensure all quality >= MIN_FITNESS
    const adjusted = solutions.map(s => ({
      ...s,
      quality: Math.max(s.quality || 0, MIN_FITNESS),
    }));

    // 计算总质量 / Compute total quality
    const totalQuality = adjusted.reduce((sum, s) => sum + s.quality, 0);

    if (totalQuality <= 0) {
      // 均匀随机 / Uniform random
      return solutions[Math.floor(Math.random() * solutions.length)];
    }

    // 轮盘赌 / Roulette wheel
    const rand = Math.random() * totalQuality;
    let cumulative = 0;

    for (const solution of adjusted) {
      cumulative += solution.quality;
      if (rand <= cumulative) {
        return solutions.find(s => s.id === solution.id) || solution;
      }
    }

    // 兜底 / Fallback
    return solutions[solutions.length - 1];
  }

  // =========================================================================
  // 侦察蜂判定 / Scout Determination
  // =========================================================================

  /**
   * 判断 Agent 是否应变为侦察蜂 (放弃当前任务)
   * Determine if agent should become a scout (abandon current task)
   *
   * 条件: 连续未改善次数 >= abandonThreshold
   * Condition: consecutive non-improvement count >= abandonThreshold
   *
   * @param {string} agentId - Agent ID
   * @returns {boolean}
   */
  shouldScout(agentId) {
    const state = this._agentStates.get(agentId);
    if (!state) return false;

    return state.trialCount >= this._abandonThreshold;
  }

  /**
   * 记录 Agent 的执行结果 (用于判断改善/未改善)
   * Record agent execution result (for improvement/non-improvement tracking)
   *
   * 如果新适应度 > 当前适应度, 重置 trialCount; 否则 trialCount++。
   * If new fitness > current fitness, reset trialCount; otherwise trialCount++.
   *
   * @param {string} agentId
   * @param {number} newFitness - 新的适应度值 / New fitness value (0-1)
   */
  recordResult(agentId, newFitness) {
    let state = this._agentStates.get(agentId);

    if (!state) {
      state = {
        role: ABCRole.onlooker,
        trialCount: 0,
        fitness: 0,
        taskId: null,
        lastImprovedAt: Date.now(),
      };
      this._agentStates.set(agentId, state);
    }

    if (newFitness > state.fitness) {
      // 有改善: 更新适应度, 重置试验计数 / Improved: update fitness, reset trial count
      state.fitness = newFitness;
      state.trialCount = 0;
      state.lastImprovedAt = Date.now();

      this._emit('abc.improved', {
        agentId,
        fitness: newFitness,
        taskId: state.taskId,
      });
    } else {
      // 未改善: 试验计数 +1 / Not improved: increment trial count
      state.trialCount++;

      if (state.trialCount >= this._abandonThreshold) {
        this._stats.abandonments++;

        this._emit('abc.abandoned', {
          agentId,
          trialCount: state.trialCount,
          fitness: state.fitness,
          taskId: state.taskId,
        });

        this._logger.debug?.(
          `[ABCScheduler] Agent 放弃 / Agent abandoned: ${agentId} ` +
          `(trials=${state.trialCount}, fitness=${state.fitness})`
        );
      }
    }
  }

  // =========================================================================
  // 随机探索 / Random Exploration
  // =========================================================================

  /**
   * 生成随机探索方案 (侦察蜂行为)
   * Generate random exploration solution (scout bee behavior)
   *
   * 创建一个新的随机食物源, 代表对搜索空间的随机探索。
   * Creates a new random food source, representing random exploration
   * of the search space.
   *
   * @returns {{ id: string, quality: number, exploredAt: number }}
   */
  explore() {
    this._stats.explorations++;

    const solution = {
      id: nanoid(),
      quality: Math.random(), // 随机初始质量 / Random initial quality
      exploredAt: Date.now(),
    };

    this._foodSources.set(solution.id, {
      ...solution,
      trialCount: 0,
      agentId: null,
    });

    this._emit('abc.explored', {
      solutionId: solution.id,
      quality: solution.quality,
    });

    this._logger.debug?.(
      `[ABCScheduler] 随机探索 / Random exploration: ${solution.id} ` +
      `(quality=${Math.round(solution.quality * 100) / 100})`
    );

    return solution;
  }

  // =========================================================================
  // 食物源管理 / Food Source Management
  // =========================================================================

  /**
   * 注册食物源 (已知解决方案)
   * Register a food source (known solution)
   *
   * @param {string} taskId - 关联任务 / Associated task
   * @param {number} quality - 质量/适应度 / Quality/fitness (0-1)
   * @param {string} [agentId] - 负责 Agent / Assigned agent
   * @returns {string} solutionId
   */
  registerFoodSource(taskId, quality, agentId) {
    const id = nanoid();

    this._foodSources.set(id, {
      id,
      taskId,
      quality: Math.max(quality || 0, MIN_FITNESS),
      agentId: agentId || null,
      trialCount: 0,
      createdAt: Date.now(),
    });

    return id;
  }

  /**
   * 更新食物源质量
   * Update food source quality
   *
   * @param {string} solutionId
   * @param {number} newQuality
   * @returns {boolean} 是否有改善 / Whether improved
   */
  updateFoodSource(solutionId, newQuality) {
    const source = this._foodSources.get(solutionId);
    if (!source) return false;

    if (newQuality > source.quality) {
      source.quality = newQuality;
      source.trialCount = 0;
      return true;
    }

    source.trialCount++;
    return false;
  }

  /**
   * 获取所有食物源 (按质量降序)
   * Get all food sources (sorted by quality descending)
   *
   * @returns {Array<Object>}
   */
  getFoodSources() {
    const sources = [...this._foodSources.values()];
    sources.sort((a, b) => b.quality - a.quality);
    return sources;
  }

  // =========================================================================
  // 统计 / Statistics
  // =========================================================================

  // =========================================================================
  // V7.0 §6: 角色查询 / Role Query
  // =========================================================================

  /**
   * V7.0 §6: 获取 agent 的 ABC 角色
   * V7.0 §6: Get agent's current ABC role
   *
   * 用于 spawn 前注入角色差异化行为:
   * - employed: 精确执行已知策略
   * - onlooker: 根据质量选择最佳方案
   * - scout: 鼓励探索未知方案
   *
   * Used to inject role-differentiated behavior before spawn:
   * - employed: execute known strategies precisely
   * - onlooker: select best approach by quality
   * - scout: encourage exploring unknown approaches
   *
   * @param {string} agentId - Agent ID
   * @returns {string} 'employed' | 'onlooker' | 'scout' | 'unknown'
   */
  getAgentRole(agentId) {
    const state = this._agentStates.get(agentId);
    return state?.role || 'unknown';
  }

  // =========================================================================
  // 统计 / Statistics
  // =========================================================================

  /**
   * 获取调度器统计
   * Get scheduler statistics
   *
   * @returns {{
   *   employed: number,
   *   onlooker: number,
   *   scout: number,
   *   iterations: number,
   *   explorations: number,
   *   abandonments: number,
   *   foodSourceCount: number,
   *   agentCount: number
   * }}
   */
  getStats() {
    return {
      ...this._stats,
      foodSourceCount: this._foodSources.size,
      agentCount: this._agentStates.size,
    };
  }

  /**
   * 重置调度器状态
   * Reset scheduler state
   */
  reset() {
    this._agentStates.clear();
    this._foodSources.clear();
    this._stats = {
      iterations: 0,
      employed: 0,
      onlooker: 0,
      scout: 0,
      explorations: 0,
      abandonments: 0,
    };
  }

  // =========================================================================
  // 内部方法 / Internal Methods
  // =========================================================================

  /**
   * 设置 Agent 的 ABC 角色
   * Set agent's ABC role
   *
   * @private
   * @param {string} agentId
   * @param {keyof typeof ABCRole} role
   */
  _setAgentRole(agentId, role) {
    let state = this._agentStates.get(agentId);
    const oldRole = state?.role || null;
    if (!state) {
      state = {
        role,
        trialCount: 0,
        fitness: 0,
        taskId: null,
        lastImprovedAt: Date.now(),
      };
      this._agentStates.set(agentId, state);
    } else {
      state.role = role;
    }
    // 角色变更时通知前端 / Notify frontend on role change
    if (this._messageBus && role !== oldRole) {
      try {
        this._messageBus.publish('abc.role_changed', {
          agentId, oldRole, newRole: role, timestamp: Date.now(),
        });
      } catch { /* non-fatal */ }
    }
  }

  /**
   * 初始化 Agent 状态 (跟随蜂选中任务后)
   * Initialize agent state (after onlooker selects a task)
   *
   * @private
   * @param {string} agentId
   * @param {string} taskId
   * @param {number} quality
   */
  _initAgentState(agentId, taskId, quality) {
    this._agentStates.set(agentId, {
      role: ABCRole.onlooker,
      trialCount: 0,
      fitness: quality,
      taskId,
      lastImprovedAt: Date.now(),
    });
  }

  /**
   * 重置 Agent 状态 (侦察蜂探索新方案后)
   * Reset agent state (after scout explores new solution)
   *
   * @private
   * @param {string} agentId
   * @param {string} taskId
   */
  _resetAgentState(agentId, taskId) {
    this._agentStates.set(agentId, {
      role: ABCRole.scout,
      trialCount: 0,
      fitness: 0,
      taskId,
      lastImprovedAt: Date.now(),
    });
  }

  /**
   * 发布消息总线事件
   * Publish to message bus
   *
   * @private
   * @param {string} topic
   * @param {Object} data
   */
  _emit(topic, data) {
    if (this._messageBus) {
      try {
        this._messageBus.publish(topic, data, { senderId: 'abc-scheduler' });
      } catch {
        // 忽略消息总线错误 / Ignore message bus errors
      }
    }
  }
}
