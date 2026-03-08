/**
 * SwarmQueryTool -- 蜂群查询工具 / Swarm Query Tool
 *
 * V5.0 L5 应用层工具: 查询蜂群状态、代理信息和任务进度。
 * V5.0 L5 Application Layer tool: Query swarm state, agent info,
 * and task progress.
 *
 * 动作 / Actions:
 * - status: 获取总体蜂群状态 / Get overall swarm status
 * - agent:  获取单个代理信息 / Get specific agent info
 * - task:   获取任务详情 / Get task details
 * - agents: 列出所有代理 (带可选过滤) / List all agents with optional filter
 *
 * @module L5-application/tools/swarm-query-tool
 * @author DEEP-IOS
 */

// ============================================================================
// 常量 / Constants
// ============================================================================

/** 工具名称 / Tool name */
const TOOL_NAME = 'swarm_query';

/** 工具描述 / Tool description */
const TOOL_DESCRIPTION = 'Query swarm state, agent info, and task progress';

// ============================================================================
// JSON Schema 定义 / JSON Schema Definition
// ============================================================================

const inputSchema = {
  type: 'object',
  properties: {
    action: {
      type: 'string',
      enum: ['status', 'agent', 'task', 'agents'],
      description: '查询类型 / Query type: status, agent, task, or agents',
    },
    agentId: {
      type: 'string',
      description: 'Agent ID (agent 动作必需) / Agent ID (required for agent action)',
    },
    taskId: {
      type: 'string',
      description: '任务 ID (task 动作必需) / Task ID (required for task action)',
    },
    filter: {
      type: 'object',
      properties: {
        tier: { type: 'string', description: '按经验等级过滤 / Filter by tier' },
        status: { type: 'string', description: '按状态过滤 / Filter by status' },
      },
      description: 'agents 动作的过滤条件 / Filter for agents action',
    },
  },
  required: ['action'],
};

// ============================================================================
// 工厂函数 / Factory Function
// ============================================================================

/**
 * 创建蜂群查询工具
 * Create the swarm query tool
 *
 * @param {Object} deps - 依赖注入 / Dependency injection
 * @param {Object} deps.engines - 引擎实例集合 / Engine instances
 * @param {Object} deps.logger - 日志器 / Logger
 * @returns {{ name: string, description: string, inputSchema: Object, handler: Function }}
 */
export function createQueryTool({ engines, logger }) {
  const {
    taskRepo,
    agentRepo,
    pheromoneEngine,
    orchestrator,
  } = engines;

  /**
   * 获取总体蜂群状态 / Get overall swarm status
   *
   * 聚合: Agent 计数、任务计数、信息素统计、编排器状态。
   * Aggregates: agent count, task counts, pheromone stats, orchestrator state.
   *
   * @returns {Object}
   */
  async function handleStatus() {
    const data = {};

    // Agent 统计 / Agent statistics
    if (agentRepo) {
      try {
        const allAgents = agentRepo.listAgents();
        const activeAgents = allAgents.filter(a => a.status === 'active' || a.status === 'online');
        const busyAgents = allAgents.filter(a => a.status === 'busy');

        data.agents = {
          total: allAgents.length,
          active: activeAgents.length,
          busy: busyAgents.length,
          offline: allAgents.length - activeAgents.length - busyAgents.length,
        };
      } catch (err) {
        data.agents = { error: err.message };
      }
    }

    // 任务统计 / Task statistics
    if (taskRepo) {
      try {
        const allTasks = taskRepo.listTasks();
        const byStatus = {};
        for (const task of allTasks) {
          byStatus[task.status] = (byStatus[task.status] || 0) + 1;
        }

        data.tasks = {
          total: allTasks.length,
          byStatus,
        };
      } catch (err) {
        data.tasks = { error: err.message };
      }
    }

    // 信息素统计 / Pheromone statistics
    if (pheromoneEngine) {
      try {
        data.pheromones = pheromoneEngine.getStats();
      } catch (err) {
        data.pheromones = { error: err.message };
      }
    }

    // 编排器状态 / Orchestrator state
    if (orchestrator && typeof orchestrator.getStats === 'function') {
      try {
        data.orchestrator = orchestrator.getStats();
      } catch (err) {
        data.orchestrator = { error: err.message };
      }
    }

    data.timestamp = Date.now();

    return { success: true, data };
  }

  /**
   * 获取单个代理详情 / Get specific agent info
   *
   * 包括: 基本信息、能力维度、技能列表。
   * Includes: basic info, capability dimensions, skill list.
   *
   * @param {Object} input
   * @returns {Object}
   */
  async function handleAgent(input) {
    const { agentId } = input;

    if (!agentId) {
      return { success: false, error: 'agentId 不能为空 / agentId is required' };
    }

    if (!agentRepo) {
      return { success: false, error: 'agentRepo 不可用 / agentRepo not available' };
    }

    try {
      const agent = agentRepo.getAgent(agentId);
      if (!agent) {
        return { success: false, error: `Agent 不存在 / Agent not found: ${agentId}` };
      }

      // 获取能力维度 / Get capabilities
      let capabilities = [];
      try {
        capabilities = agentRepo.getCapabilities(agentId);
      } catch {
        // 能力数据可能不存在 / Capabilities may not exist
      }

      // 获取技能 / Get skills
      let skills = [];
      try {
        skills = agentRepo.getSkills(agentId);
      } catch {
        // 技能数据可能不存在 / Skills may not exist
      }

      return {
        success: true,
        data: {
          ...agent,
          capabilities: capabilities.map(c => ({
            dimension: c.dimension,
            score: c.score,
          })),
          skills: skills.map(s => ({
            name: s.skill_name,
            level: s.level,
          })),
        },
      };
    } catch (err) {
      return { success: false, error: `查询失败 / Query failed: ${err.message}` };
    }
  }

  /**
   * 获取任务详情 / Get task details
   *
   * @param {Object} input
   * @returns {Object}
   */
  async function handleTask(input) {
    const { taskId } = input;

    if (!taskId) {
      return { success: false, error: 'taskId 不能为空 / taskId is required' };
    }

    if (!taskRepo) {
      return { success: false, error: 'taskRepo 不可用 / taskRepo not available' };
    }

    try {
      const task = taskRepo.getTask(taskId);
      if (!task) {
        return { success: false, error: `任务不存在 / Task not found: ${taskId}` };
      }

      return { success: true, data: task };
    } catch (err) {
      return { success: false, error: `查询失败 / Query failed: ${err.message}` };
    }
  }

  /**
   * 列出所有代理 (带可选过滤) / List all agents with optional filter
   *
   * @param {Object} input
   * @returns {Object}
   */
  async function handleAgents(input) {
    const { filter } = input;

    if (!agentRepo) {
      return { success: false, error: 'agentRepo 不可用 / agentRepo not available' };
    }

    try {
      // 获取 Agent 列表, 按状态预过滤 / Get agent list, pre-filter by status
      let agents = agentRepo.listAgents(filter?.status || null);

      // 按 tier 过滤 / Filter by tier
      if (filter?.tier) {
        agents = agents.filter(a => a.tier === filter.tier);
      }

      return {
        success: true,
        data: agents.map(a => ({
          id: a.id,
          name: a.name,
          role: a.role,
          tier: a.tier,
          status: a.status,
          totalScore: a.total_score,
          successCount: a.success_count,
          failureCount: a.failure_count,
        })),
        count: agents.length,
      };
    } catch (err) {
      return { success: false, error: `查询失败 / Query failed: ${err.message}` };
    }
  }

  // ━━━ 主处理函数 / Main Handler ━━━

  async function handler(input) {
    try {
      const { action } = input;

      switch (action) {
        case 'status':
          return await handleStatus();
        case 'agent':
          return await handleAgent(input);
        case 'task':
          return await handleTask(input);
        case 'agents':
          return await handleAgents(input);
        default:
          return {
            success: false,
            error: `未知操作 / Unknown action: ${action}. 支持 / Supported: status, agent, task, agents`,
          };
      }
    } catch (err) {
      logger.error?.(`[SwarmQueryTool] 未捕获错误 / Uncaught error: ${err.message}`);
      return { success: false, error: err.message };
    }
  }

  return {
    name: TOOL_NAME,
    description: TOOL_DESCRIPTION,
    inputSchema,
    handler,
  };
}
