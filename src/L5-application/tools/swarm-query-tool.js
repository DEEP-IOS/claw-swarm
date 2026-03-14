/**
 * SwarmQueryTool -- 蜂群查询工具 / Swarm Query Tool
 *
 * V6.3 L5 应用层工具: 统一蜂群只读查询入口, 10 个 scope 覆盖全蜂群状态。
 * V6.3 L5 Application Layer tool: Unified swarm read-only query entry, 10 scopes
 * covering full swarm state.
 *
 * V6.3 工具精简: 吸收 swarm_pheromone(query), swarm_memory(recall),
 *   swarm_gate(query), swarm_zone(query), swarm_plan(list/detail) 的只读操作。
 * V6.3 Tool consolidation: absorbs read operations from deprecated tools.
 *
 * Scope 列表 / Scope list:
 * - status:     获取总体蜂群状态 / Get overall swarm status
 * - agent:      获取单个代理信息 / Get specific agent info
 * - task:       获取任务详情 / Get task details
 * - agents:     列出所有代理 (带可选过滤) / List all agents with optional filter
 * - pheromones: 信息素状态查询 / Pheromone state query
 * - memory:     情景记忆检索 / Episodic memory recall
 * - quality:    质量门控审计 / Quality gate audit
 * - zones:      区域状态查询 / Zone status query
 * - plans:      执行计划查询 / Execution plan query
 * - board:      公告板读取 / Stigmergic board read
 *
 * @module L5-application/tools/swarm-query-tool
 * @version 6.3.0
 * @author DEEP-IOS
 */

// ============================================================================
// 常量 / Constants
// ============================================================================

/** 工具名称 / Tool name */
const TOOL_NAME = 'swarm_query';

/** 工具描述 / Tool description */
const TOOL_DESCRIPTION = 'Query swarm state: status, agents, tasks, pheromones, memory, quality, zones, plans, board';

// ============================================================================
// JSON Schema 定义 / JSON Schema Definition
// ============================================================================

const inputSchema = {
  type: 'object',
  properties: {
    scope: {
      type: 'string',
      enum: ['status', 'agent', 'task', 'agents', 'pheromones', 'memory', 'quality', 'zones', 'plans', 'board'],
      description: '查询范围 / Query scope',
    },
    agentId: {
      type: 'string',
      description: 'Agent ID (agent scope 必需) / Agent ID (required for agent scope)',
    },
    taskId: {
      type: 'string',
      description: '任务 ID (task/quality scope 可用) / Task ID (for task/quality scope)',
    },
    planId: {
      type: 'string',
      description: '计划 ID (plans scope 详情查询) / Plan ID (for plans scope detail)',
    },
    filter: {
      type: 'object',
      properties: {
        tier: { type: 'string', description: '按经验等级过滤 / Filter by tier' },
        status: { type: 'string', description: '按状态过滤 / Filter by status' },
      },
      description: 'agents scope 的过滤条件 / Filter for agents scope',
    },
    keyword: {
      type: 'string',
      description: '搜索关键词 (memory/pheromones scope) / Search keyword',
    },
    crossAgent: {
      type: 'boolean',
      description: 'memory scope: 跨 agent 全局检索 / Cross-agent global recall',
    },
    limit: {
      type: 'number',
      description: '返回数量上限 / Max results to return',
    },
    targetScope: {
      type: 'string',
      description: 'board/pheromones scope: 目标路径 / Target path for board/pheromones',
    },
    category: {
      type: 'string',
      description: 'board scope: 分类过滤 / Category filter for board',
    },
    eventType: {
      type: 'string',
      description: 'memory scope: 事件类型过滤 / Event type filter for memory',
    },
  },
  required: ['scope'],
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
 * @returns {{ name: string, description: string, parameters: Object, handler: Function, execute: Function }}
 */
export function createQueryTool({ engines, logger }) {
  const {
    taskRepo,
    agentRepo,
    pheromoneEngine,
    orchestrator,
    // V6.3: 新增引擎依赖 / New engine dependencies
    episodicMemory,
    qualityController,
    zoneRepo,
    planRepo,
    stigmergicBoard,
  } = engines;

  // ━━━ scope: status ━━━

  /**
   * 获取总体蜂群状态 / Get overall swarm status
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

  // ━━━ scope: agent ━━━

  /**
   * 获取单个代理详情 / Get specific agent info
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

  // ━━━ scope: task ━━━

  /**
   * 获取任务详情 / Get task details
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

  // ━━━ scope: agents ━━━

  /**
   * 列出所有代理 (带可选过滤) / List all agents with optional filter
   * @param {Object} input
   * @returns {Object}
   */
  async function handleAgents(input) {
    const { filter } = input;

    if (!agentRepo) {
      return { success: false, error: 'agentRepo 不可用 / agentRepo not available' };
    }

    try {
      let agents = agentRepo.listAgents(filter?.status || null);

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

  // ━━━ scope: pheromones (V6.3: 吸收自 swarm_pheromone query) ━━━

  /**
   * 信息素状态查询 / Query pheromone state
   *
   * 替代已废弃的 swarm_pheromone(query) 操作。
   * Replaces deprecated swarm_pheromone(query) action.
   *
   * @param {Object} input
   * @returns {Object}
   */
  async function handlePheromones(input) {
    if (!pheromoneEngine) {
      return { success: false, error: 'pheromoneEngine 不可用 / pheromoneEngine not available' };
    }

    try {
      const { targetScope, keyword, limit = 20 } = input;

      // 如果指定了 targetScope, 读取该路径下的信息素
      // If targetScope specified, read pheromones under that path
      if (targetScope) {
        const pheromones = pheromoneEngine.read(targetScope, {
          type: keyword || undefined,
          minIntensity: 0,
        });
        return {
          success: true,
          data: {
            scope: targetScope,
            pheromones: pheromones.slice(0, limit),
            count: pheromones.length,
          },
        };
      }

      // 默认: 返回快照 + 统计 / Default: return snapshot + stats
      const stats = pheromoneEngine.getStats();
      const snapshot = pheromoneEngine.buildSnapshot({ type: keyword || undefined });

      return {
        success: true,
        data: {
          stats,
          snapshot: {
            timestamp: snapshot.timestamp,
            count: snapshot.count,
            pheromones: (snapshot.pheromones || []).slice(0, limit),
          },
        },
      };
    } catch (err) {
      return { success: false, error: `信息素查询失败 / Pheromone query failed: ${err.message}` };
    }
  }

  // ━━━ scope: memory (V6.3: 吸收自 swarm_memory recall) ━━━

  /**
   * 情景记忆检索 / Episodic memory recall
   *
   * 替代已废弃的 swarm_memory(recall) 操作。
   * 支持 crossAgent=true 进行跨 agent 全局检索 (V6.3 recallAll)。
   * Replaces deprecated swarm_memory(recall) action.
   * Supports crossAgent=true for cross-agent global recall (V6.3 recallAll).
   *
   * @param {Object} input
   * @returns {Object}
   */
  async function handleMemory(input) {
    if (!episodicMemory) {
      return { success: false, error: 'episodicMemory 不可用 / episodicMemory not available' };
    }

    try {
      const { agentId, keyword, eventType, crossAgent = false, limit = 10 } = input;

      if (crossAgent) {
        // V6.3: 跨 agent 全局检索 / Cross-agent global recall
        const events = episodicMemory.recallAll({
          eventType,
          keyword,
          limit,
          minImportance: 0,
        });
        return {
          success: true,
          data: {
            crossAgent: true,
            events,
            count: events.length,
          },
        };
      }

      // 单 agent 检索 / Single agent recall
      if (!agentId) {
        return { success: false, error: 'agentId 必需 (或设 crossAgent=true) / agentId required (or set crossAgent=true)' };
      }

      const events = episodicMemory.recall(agentId, {
        eventType,
        keyword,
        limit,
        minImportance: 0,
      });
      return {
        success: true,
        data: {
          agentId,
          events,
          count: events.length,
        },
      };
    } catch (err) {
      return { success: false, error: `记忆检索失败 / Memory recall failed: ${err.message}` };
    }
  }

  // ━━━ scope: quality (V6.3: 吸收自 swarm_gate query) ━━━

  /**
   * 质量门控审计查询 / Quality gate audit query
   *
   * 替代已废弃的 swarm_gate(query) 操作。
   * Replaces deprecated swarm_gate(query) action.
   *
   * @param {Object} input
   * @returns {Object}
   */
  async function handleQuality(input) {
    if (!qualityController) {
      return { success: false, error: 'qualityController 不可用 / qualityController not available' };
    }

    try {
      const { taskId, limit = 20 } = input;

      if (taskId) {
        // 特定任务的质量报告 / Quality report for specific task
        const report = qualityController.getQualityReport(taskId);
        return {
          success: true,
          data: report || { taskId, message: '无评估记录 / No evaluation records' },
        };
      }

      // 全局审计汇总 / Global audit summary
      const stats = qualityController.getStats();
      const auditTrail = qualityController.getAuditTrail({ limit });

      return {
        success: true,
        data: {
          stats,
          auditTrail,
        },
      };
    } catch (err) {
      return { success: false, error: `质量查询失败 / Quality query failed: ${err.message}` };
    }
  }

  // ━━━ scope: zones (V6.3: 吸收自 swarm_zone query) ━━━

  /**
   * 区域状态查询 / Zone status query
   *
   * 替代已废弃的 swarm_zone(list/members) 操作。
   * Replaces deprecated swarm_zone(list/members) actions.
   *
   * @param {Object} input
   * @returns {Object}
   */
  async function handleZones(input) {
    if (!zoneRepo) {
      return { success: false, error: 'zoneRepo 不可用 / zoneRepo not available' };
    }

    try {
      const { agentId } = input;

      // 如果指定 agentId, 返回该 agent 所属区域
      // If agentId specified, return zones this agent belongs to
      if (agentId) {
        const zones = zoneRepo.getAgentZones(agentId);
        return {
          success: true,
          data: {
            agentId,
            zones,
            count: zones.length,
          },
        };
      }

      // 默认: 列出所有区域及成员数
      // Default: list all zones with member counts
      const zones = zoneRepo.listZones();
      const zonesWithMembers = zones.map(z => {
        let memberCount = 0;
        try {
          memberCount = zoneRepo.getMemberCount(z.id);
        } catch { /* silent */ }
        return { ...z, memberCount };
      });

      return {
        success: true,
        data: zonesWithMembers,
        count: zonesWithMembers.length,
      };
    } catch (err) {
      return { success: false, error: `区域查询失败 / Zone query failed: ${err.message}` };
    }
  }

  // ━━━ scope: plans (V6.3: 吸收自 swarm_plan list/detail) ━━━

  /**
   * 执行计划查询 / Execution plan query
   *
   * 替代已废弃的 swarm_plan(list/detail) 操作。
   * Replaces deprecated swarm_plan(list/detail) actions.
   *
   * @param {Object} input
   * @returns {Object}
   */
  async function handlePlans(input) {
    if (!planRepo) {
      return { success: false, error: 'planRepo 不可用 / planRepo not available' };
    }

    try {
      const { planId, taskId, limit = 20 } = input;

      // 按 planId 获取详情 / Get detail by planId
      if (planId) {
        const plan = planRepo.get(planId);
        if (!plan) {
          return { success: false, error: `计划不存在 / Plan not found: ${planId}` };
        }
        return { success: true, data: plan };
      }

      // 按 taskId 获取关联计划 / Get plans by taskId
      if (taskId) {
        const plans = planRepo.getByTask(taskId);
        return {
          success: true,
          data: plans,
          count: plans.length,
        };
      }

      // 默认: 列出所有计划 / Default: list all plans
      const plans = planRepo.list(null, limit);
      return {
        success: true,
        data: plans,
        count: plans.length,
      };
    } catch (err) {
      return { success: false, error: `计划查询失败 / Plan query failed: ${err.message}` };
    }
  }

  // ━━━ scope: board (V6.3: StigmergicBoard 读取) ━━━

  /**
   * 公告板读取 / Stigmergic board read
   *
   * @param {Object} input
   * @returns {Object}
   */
  async function handleBoard(input) {
    if (!stigmergicBoard) {
      return { success: false, error: 'stigmergicBoard 不可用 / stigmergicBoard not available' };
    }

    try {
      const { targetScope = '/swarm', category, limit = 10 } = input;

      const posts = stigmergicBoard.read(targetScope, {
        category: category || undefined,
        limit,
      });

      return {
        success: true,
        data: {
          scope: targetScope,
          posts,
          count: posts.length,
        },
      };
    } catch (err) {
      return { success: false, error: `公告板查询失败 / Board query failed: ${err.message}` };
    }
  }

  // ━━━ 主处理函数 / Main Handler ━━━

  async function handler(input) {
    try {
      const { scope } = input;

      switch (scope) {
        case 'status':
          return await handleStatus();
        case 'agent':
          return await handleAgent(input);
        case 'task':
          return await handleTask(input);
        case 'agents':
          return await handleAgents(input);
        case 'pheromones':
          return await handlePheromones(input);
        case 'memory':
          return await handleMemory(input);
        case 'quality':
          return await handleQuality(input);
        case 'zones':
          return await handleZones(input);
        case 'plans':
          return await handlePlans(input);
        case 'board':
          return await handleBoard(input);
        default:
          return {
            success: false,
            error: `未知 scope / Unknown scope: ${scope}. 支持 / Supported: status, agent, task, agents, pheromones, memory, quality, zones, plans, board`,
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
    parameters: inputSchema,
    handler,
    execute: async (toolCallId, params) => {
      const result = await handler(params);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  };
}
