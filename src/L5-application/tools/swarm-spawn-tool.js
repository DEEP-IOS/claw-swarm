/**
 * SwarmSpawnTool -- 蜂群生成工具 / Swarm Spawn Tool
 *
 * V5.1 L5 应用层工具: 创建和管理子代理, 基于 MoE 角色选择。
 * V5.1 L5 Application Layer tool: Create and manage sub-agents
 * with MoE-based role selection.
 *
 * 动作 / Actions:
 * - spawn:  创建子代理 (MoE 角色推荐 + 任务创建 + 招募信息素)
 *           Create sub-agent (MoE role recommendation + task creation + recruit pheromone)
 * - list:   列出活跃子代理 / List active sub-agents
 * - cancel: 取消子代理 / Cancel a sub-agent
 *
 * V5.1 增强 / V5.1 Enhancements:
 * - 子 Agent 可再 spawn（层级蜂群支持）/ Child agents can re-spawn (hierarchical swarm)
 * - 全局并发上限检查 / Global concurrency limit check
 * - DAG 任务关联 / DAG task association
 *
 * @module L5-application/tools/swarm-spawn-tool
 * @author DEEP-IOS
 */

// ============================================================================
// 常量 / Constants
// ============================================================================

/** 工具名称 / Tool name */
const TOOL_NAME = 'swarm_spawn';

/** 工具描述 / Tool description */
const TOOL_DESCRIPTION = 'Create and manage sub-agents with MoE-based role selection';

/** 默认 MoE Top-K / Default MoE Top-K */
const DEFAULT_TOP_K = 3;

/** 信息素招募范围前缀 / Pheromone recruit scope prefix */
const RECRUIT_SCOPE_PREFIX = '/task/';

// ============================================================================
// JSON Schema 定义 / JSON Schema Definition
// ============================================================================

/**
 * 输入 JSON Schema
 * Input JSON Schema
 */
const inputSchema = {
  type: 'object',
  properties: {
    action: {
      type: 'string',
      enum: ['spawn', 'list', 'cancel'],
      description: '操作类型 / Action type: spawn, list, or cancel',
    },
    // spawn 参数 / spawn params
    taskDescription: {
      type: 'string',
      description: '任务描述, spawn 时必需 / Task description, required for spawn',
    },
    parentTaskId: {
      type: 'string',
      description: '父任务 ID / Parent task ID (optional)',
    },
    roleHint: {
      type: 'string',
      description: '角色提示, 偏好角色名 / Role hint, preferred role name (optional)',
    },
    autoExecute: {
      type: 'boolean',
      description: '是否自动执行 / Whether to auto-execute (default true)',
    },
    // V5.1: DAG 关联 / DAG association
    dagId: {
      type: 'string',
      description: 'DAG 编排 ID (V5.1) / DAG orchestration ID (optional)',
    },
    dagNodeId: {
      type: 'string',
      description: 'DAG 任务节点 ID (V5.1) / DAG task node ID (optional)',
    },
    // list 参数 / list params (parentTaskId reused)
    // cancel 参数 / cancel params
    agentId: {
      type: 'string',
      description: '要取消的 Agent ID / Agent ID to cancel',
    },
  },
  required: ['action'],
};

// ============================================================================
// 工厂函数 / Factory Function
// ============================================================================

/**
 * 创建蜂群生成工具
 * Create the swarm spawn tool
 *
 * @param {Object} deps - 依赖注入 / Dependency injection
 * @param {Object} deps.engines - 引擎实例集合 / Engine instances
 * @param {Object} deps.logger - 日志器 / Logger
 * @returns {{ name: string, description: string, inputSchema: Object, handler: Function }}
 */
export function createSpawnTool({ engines, logger }) {
  const {
    executionPlanner,
    taskRepo,
    agentRepo,
    pheromoneEngine,
    messageBus,
    soulDesigner,
    hierarchicalCoordinator,
    dagEngine,
  } = engines;

  /**
   * 生成子代理 / Spawn a sub-agent
   *
   * 流程 / Flow:
   * 1. 使用 ExecutionPlanner.planExecution() 做 MoE 角色推荐
   *    Use ExecutionPlanner.planExecution() for MoE role recommendation
   * 2. 创建任务记录到 DB
   *    Create task record in DB
   * 3. 发射招募信息素
   *    Emit recruit pheromone
   * 4. (可选) 通过 SoulDesigner 生成 SOUL 片段
   *    (Optional) Generate SOUL snippet via SoulDesigner
   *
   * @param {Object} input
   * @returns {Object}
   */
  async function handleSpawn(input) {
    const {
      taskDescription,
      parentTaskId,
      roleHint,
      autoExecute = true,
    } = input;

    // 验证必需参数 / Validate required params
    if (!taskDescription || typeof taskDescription !== 'string') {
      return { success: false, error: '任务描述不能为空 / taskDescription is required' };
    }

    logger.info?.(`[SwarmSpawnTool] 生成子代理请求 / Spawn request: "${taskDescription.substring(0, 80)}"`);

    // V5.1: 全局并发检查 / Global concurrency check
    if (hierarchicalCoordinator) {
      const stats = hierarchicalCoordinator.getStats();
      if (stats.currentActiveAgents >= stats.swarmMaxAgents) {
        return {
          success: false,
          error: `蜂群 Agent 数已达上限 (${stats.currentActiveAgents}/${stats.swarmMaxAgents}) / ` +
            `Swarm agent limit reached (${stats.currentActiveAgents}/${stats.swarmMaxAgents})`,
        };
      }
    }

    // Step 1: MoE 角色推荐 / MoE role recommendation
    let recommendedRoles = [];
    let roleScores = [];
    let fallbackUsed = false;

    if (executionPlanner) {
      const options = { topK: DEFAULT_TOP_K };

      // 如果有角色提示, 作为需求提供 / If roleHint, pass as requirements
      if (roleHint) {
        options.requirements = { [roleHint]: 0.8 };
      }

      const planResult = executionPlanner.planExecution(taskDescription, options);
      recommendedRoles = planResult.roles || [];
      roleScores = planResult.scores || [];
      fallbackUsed = planResult.fallback || false;
    }

    // 取最佳角色 / Pick best role
    const bestRole = recommendedRoles.length > 0
      ? recommendedRoles[0]
      : { name: roleHint || 'developer', description: 'Default role' };

    // Step 2: 创建 Agent 记录 / Create agent record
    let agentId = null;
    if (agentRepo) {
      try {
        agentId = agentRepo.createAgent({
          name: `sub-${bestRole.name}-${Date.now().toString(36)}`,
          role: bestRole.name,
          tier: 'trainee',
          status: 'active',
        });
      } catch (err) {
        logger.warn?.(`[SwarmSpawnTool] Agent 创建失败 / Agent creation failed: ${err.message}`);
        return { success: false, error: `Agent 创建失败 / Agent creation failed: ${err.message}` };
      }
    }

    // Step 3: 创建任务记录 / Create task record
    let taskId = null;
    if (taskRepo) {
      try {
        taskId = `task-${Date.now().toString(36)}`;
        const taskConfig = {
          description: taskDescription,
          parentTaskId: parentTaskId || null,
          assignedAgent: agentId,
          role: bestRole.name,
          autoExecute,
        };
        taskRepo.createTask(taskId, taskConfig, 'live');

        // 关联 Agent 到任务 / Associate agent with task
        if (agentId) {
          taskRepo.updateTaskStatus(taskId, 'running');
        }
      } catch (err) {
        logger.warn?.(`[SwarmSpawnTool] 任务创建失败 / Task creation failed: ${err.message}`);
        return { success: false, error: `任务创建失败 / Task creation failed: ${err.message}` };
      }
    }

    // Step 4: 发射招募信息素 / Emit recruit pheromone
    let pheromoneId = null;
    if (pheromoneEngine) {
      try {
        pheromoneId = pheromoneEngine.emitPheromone({
          type: 'recruit',
          sourceId: agentId || 'swarm-spawn-tool',
          targetScope: `${RECRUIT_SCOPE_PREFIX}${taskId || 'unknown'}`,
          intensity: 0.8,
          payload: {
            taskDescription: taskDescription.substring(0, 200),
            role: bestRole.name,
            parentTaskId,
          },
        });
      } catch (err) {
        logger.warn?.(`[SwarmSpawnTool] 信息素发射失败 / Pheromone emit failed: ${err.message}`);
        // 非致命, 继续 / Non-fatal, continue
      }
    }

    // Step 5: (可选) 生成 SOUL 片段 / (Optional) Generate SOUL snippet
    let soulSnippet = null;
    if (soulDesigner && agentId) {
      try {
        soulSnippet = soulDesigner.generateSoul({
          personaId: bestRole.name,
          taskDescription,
          swarmRole: `Sub-agent for: ${taskDescription.substring(0, 100)}`,
        });
      } catch (err) {
        logger.debug?.(`[SwarmSpawnTool] SOUL 生成跳过 / SOUL generation skipped: ${err.message}`);
      }
    }

    // 广播事件 / Broadcast event
    if (messageBus) {
      try {
        messageBus.publish('swarm.agent.spawned', {
          agentId,
          taskId,
          role: bestRole.name,
          parentTaskId,
          autoExecute,
        }, { senderId: 'swarm-spawn-tool' });
      } catch {
        // 忽略消息总线错误 / Ignore message bus errors
      }
    }

    logger.info?.(
      `[SwarmSpawnTool] 子代理已生成 / Sub-agent spawned: agentId=${agentId}, role=${bestRole.name}, taskId=${taskId}`
    );

    return {
      success: true,
      agentId,
      taskId,
      role: bestRole.name,
      roleScores: roleScores.slice(0, 3),
      fallbackUsed,
      pheromoneId,
      soulSnippet: soulSnippet || null,
      message: `子代理已创建: ${bestRole.name} / Sub-agent spawned: ${bestRole.name}`,
    };
  }

  /**
   * 列出活跃子代理 / List active sub-agents
   *
   * @param {Object} input
   * @returns {Object}
   */
  async function handleList(input) {
    const { parentTaskId } = input;

    if (!agentRepo) {
      return { success: false, error: 'agentRepo 不可用 / agentRepo not available' };
    }

    try {
      let agents = agentRepo.listAgents('active');

      // 如果指定 parentTaskId, 过滤关联任务 / If parentTaskId specified, filter by associated tasks
      if (parentTaskId && taskRepo) {
        const tasks = taskRepo.listTasks('running');
        const childTaskAgentIds = new Set();

        for (const task of tasks) {
          if (task.config?.parentTaskId === parentTaskId && task.config?.assignedAgent) {
            childTaskAgentIds.add(task.config.assignedAgent);
          }
        }

        agents = agents.filter(a => childTaskAgentIds.has(a.id));
      }

      return {
        success: true,
        agents: agents.map(a => ({
          id: a.id,
          name: a.name,
          role: a.role,
          tier: a.tier,
          status: a.status,
          totalScore: a.total_score,
        })),
        count: agents.length,
        message: `找到 ${agents.length} 个活跃子代理 / Found ${agents.length} active sub-agents`,
      };
    } catch (err) {
      return { success: false, error: `列出子代理失败 / List failed: ${err.message}` };
    }
  }

  /**
   * 取消子代理 / Cancel a sub-agent
   *
   * @param {Object} input
   * @returns {Object}
   */
  async function handleCancel(input) {
    const { agentId } = input;

    if (!agentId) {
      return { success: false, error: 'agentId 不能为空 / agentId is required' };
    }

    if (!agentRepo) {
      return { success: false, error: 'agentRepo 不可用 / agentRepo not available' };
    }

    try {
      // 检查 Agent 是否存在 / Check if agent exists
      const agent = agentRepo.getAgent(agentId);
      if (!agent) {
        return { success: false, error: `Agent 不存在 / Agent not found: ${agentId}` };
      }

      // 更新 Agent 状态为离线 / Update agent status to offline
      agentRepo.updateAgent(agentId, { status: 'offline' });

      // 取消关联任务 / Cancel associated tasks
      if (taskRepo) {
        const tasks = taskRepo.listTasks('running');
        for (const task of tasks) {
          if (task.config?.assignedAgent === agentId) {
            taskRepo.updateTaskStatus(task.id, 'cancelled', 'Agent cancelled by user');
          }
        }
      }

      // 广播取消事件 / Broadcast cancel event
      if (messageBus) {
        try {
          messageBus.publish('swarm.agent.cancelled', {
            agentId,
            agentName: agent.name,
          }, { senderId: 'swarm-spawn-tool' });
        } catch {
          // 忽略 / Ignore
        }
      }

      logger.info?.(`[SwarmSpawnTool] 子代理已取消 / Sub-agent cancelled: ${agentId}`);

      return {
        success: true,
        agentId,
        message: `子代理已取消 / Sub-agent cancelled: ${agentId}`,
      };
    } catch (err) {
      return { success: false, error: `取消失败 / Cancel failed: ${err.message}` };
    }
  }

  // ━━━ 主处理函数 / Main Handler ━━━

  /**
   * 工具主入口: 根据 action 分发
   * Tool main entry: dispatch by action
   *
   * @param {Object} input
   * @returns {Promise<Object>}
   */
  async function handler(input) {
    try {
      const { action } = input;

      switch (action) {
        case 'spawn':
          return await handleSpawn(input);
        case 'list':
          return await handleList(input);
        case 'cancel':
          return await handleCancel(input);
        default:
          return {
            success: false,
            error: `未知操作 / Unknown action: ${action}. 支持 / Supported: spawn, list, cancel`,
          };
      }
    } catch (err) {
      logger.error?.(`[SwarmSpawnTool] 未捕获错误 / Uncaught error: ${err.message}`);
      return { success: false, error: err.message };
    }
  }

  return {
    name: TOOL_NAME,
    description: TOOL_DESCRIPTION,
    parameters: inputSchema,
    handler,
    execute: async (toolCallId, params) => {
      const result = await handler(params);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  };
}
