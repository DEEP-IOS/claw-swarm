/**
 * SwarmRunTool -- 蜂群一键执行工具 / Swarm One-Click Execution Tool
 *
 * V5.3 L5 应用层工具: 高层入口, 将 swarm_plan + swarm_spawn 合并为单一操作。
 * V5.3 L5 Application Layer tool: high-level entry that merges swarm_plan + swarm_spawn
 * into a single operation.
 *
 * 解决的核心问题 / Core problem solved:
 * LLM 面对 7 个 swarm 工具时决策成本过高, 经常跳过不用。
 * swarm_run 将最常用工作流 (plan → spawn) 封装为单一工具,
 * LLM 只需提供 {goal}, 插件自动完成: 任务分解 → 角色推荐 → 子代理派遣。
 *
 * LLMs face high decision costs with 7 swarm tools and often skip them.
 * swarm_run wraps the most common workflow (plan → spawn) into one tool.
 * LLM only needs to provide {goal}, and the plugin automatically handles:
 * task decomposition → role recommendation → sub-agent dispatch.
 *
 * 模式 / Modes:
 * - auto:      设计计划 + 立即派遣所有阶段 (默认) / Design plan + immediately dispatch all phases
 * - plan_only: 仅设计计划, 不派遣 / Design plan only, no dispatch
 * - execute:   对已有计划执行派遣 / Execute dispatch for an existing plan
 *
 * @module L5-application/tools/swarm-run-tool
 * @version 5.3.0
 * @author DEEP-IOS
 */

// ============================================================================
// 常量 / Constants
// ============================================================================

const TOOL_NAME = 'swarm_run';
const TOOL_DESCRIPTION =
  '一键启动蜂群协作: 自动将目标分解为子任务, 选择最佳角色(侦察/开发/审查), 派遣子代理并行执行。' +
  '适用于: 任何需要多步骤、多角色协作完成的复杂任务。只需描述目标即可。';

/** 信息素招募范围前缀 / Pheromone recruit scope prefix */
const RECRUIT_SCOPE_PREFIX = '/task/';

/** 默认最大角色数 / Default maximum roles */
const DEFAULT_MAX_ROLES = 5;

// ============================================================================
// JSON Schema 定义 / JSON Schema Definition
// ============================================================================

const inputSchema = {
  type: 'object',
  properties: {
    goal: {
      type: 'string',
      description: '目标描述 — 你希望蜂群完成什么任务 / Goal — what you want the swarm to accomplish',
    },
    mode: {
      type: 'string',
      enum: ['auto', 'plan_only', 'execute'],
      description: '模式: auto(设计+派遣,默认), plan_only(仅设计), execute(执行已有计划) / Mode: auto (default), plan_only, or execute',
    },
    planId: {
      type: 'string',
      description: '计划 ID (execute 模式必需) / Plan ID (required for execute mode)',
    },
    maxRoles: {
      type: 'number',
      description: '最大角色数 (默认 5) / Maximum roles (default 5)',
    },
  },
  required: ['goal'],
};

// ============================================================================
// 工厂函数 / Factory Function
// ============================================================================

/**
 * 创建蜂群一键执行工具
 * Create the swarm one-click execution tool
 *
 * @param {Object} deps
 * @param {Object} deps.engines - 引擎实例集合 / Engine instances
 * @param {Object} deps.logger - 日志器 / Logger
 * @returns {{ name: string, description: string, parameters: Object, execute: Function }}
 */
export function createRunTool({ engines, logger }) {
  const {
    executionPlanner,
    taskRepo,
    agentRepo,
    pheromoneEngine,
    planRepo,
    messageBus,
    soulDesigner,
    hierarchicalCoordinator,
  } = engines;

  // ━━━ 内部: 设计计划 / Internal: Design Plan ━━━

  /**
   * 设计执行计划 (复用 swarm_plan 的核心逻辑)
   * Design execution plan (reuses swarm_plan core logic)
   *
   * @param {string} goal
   * @param {number} maxRoles
   * @returns {Object} { success, plan, roleScores, fallbackUsed }
   */
  function designPlan(goal, maxRoles) {
    if (!executionPlanner) {
      return { success: false, error: 'executionPlanner 不可用 / executionPlanner not available' };
    }

    // MoE 角色推荐 / MoE role recommendation
    const roleResult = executionPlanner.planExecution(goal, {
      topK: maxRoles,
      requirements: {},
    });

    const roles = roleResult.roles || [];
    const scores = roleResult.scores || [];
    const fallback = roleResult.fallback || false;

    if (roles.length === 0) {
      return { success: false, error: '未找到匹配角色 / No matching roles found' };
    }

    // 生成执行计划 / Generate execution plan
    const plan = executionPlanner.generatePlan(goal, roles);

    // 持久化 / Persist
    let persistedId = plan.id;
    if (planRepo) {
      try {
        persistedId = planRepo.create({
          id: plan.id,
          taskId: null,
          planData: plan,
          status: plan.status || 'draft',
          createdBy: 'swarm-run-tool',
          maturityScore: plan.maturityScore,
        });
      } catch (err) {
        logger.warn?.(`[SwarmRunTool] 计划持久化失败 / Plan persistence failed: ${err.message}`);
      }
    }

    // 广播 / Broadcast
    if (messageBus) {
      try {
        messageBus.publish('plan.designed', {
          planId: persistedId,
          taskDescription: goal.substring(0, 100),
          roleCount: roles.length,
          fallback,
          source: 'swarm-run',
        }, { senderId: 'swarm-run-tool' });
      } catch { /* non-fatal */ }
    }

    return {
      success: true,
      plan: {
        ...plan,
        id: persistedId,
      },
      roleScores: scores.slice(0, maxRoles),
      fallbackUsed: fallback,
    };
  }

  // ━━━ 内部: 派遣子代理 / Internal: Dispatch Sub-agents ━━━

  /**
   * 为计划的每个阶段派遣子代理
   * Dispatch sub-agents for each phase of the plan
   *
   * @param {Object} plan - 执行计划 / Execution plan
   * @param {string} goal - 原始目标 / Original goal
   * @returns {Object} { dispatched: Array, errors: Array }
   */
  function dispatchPhases(plan, goal) {
    const dispatched = [];
    const errors = [];
    const phases = plan.phases || [];

    if (phases.length === 0) {
      return { dispatched, errors: [{ phase: 'all', error: '计划没有执行阶段 / Plan has no phases' }] };
    }

    // 并发检查 / Concurrency check
    if (hierarchicalCoordinator) {
      const stats = hierarchicalCoordinator.getStats();
      if (stats.currentActiveAgents + phases.length > stats.swarmMaxAgents) {
        return {
          dispatched,
          errors: [{
            phase: 'pre-check',
            error: `蜂群容量不足: 需 ${phases.length} 个 agent, ` +
              `当前 ${stats.currentActiveAgents}/${stats.swarmMaxAgents} / ` +
              `Insufficient swarm capacity`,
          }],
        };
      }
    }

    for (const phase of phases) {
      try {
        const roleName = phase.roleName || phase.role || 'developer';
        const phaseDesc = phase.description || `Phase ${phase.order}: ${roleName}`;

        // 创建 Agent 记录 / Create agent record
        let agentId = null;
        if (agentRepo) {
          agentId = agentRepo.createAgent({
            name: `run-${roleName}-${Date.now().toString(36)}`,
            role: roleName,
            tier: 'trainee',
            status: 'active',
          });
        }

        // 创建任务记录 / Create task record
        let taskId = null;
        if (taskRepo) {
          taskId = `task-${Date.now().toString(36)}-${phase.order || 0}`;
          taskRepo.createTask(taskId, {
            description: phaseDesc,
            parentTaskId: plan.id,
            assignedAgent: agentId,
            role: roleName,
            autoExecute: true,
            sourceGoal: goal.substring(0, 200),
          }, 'live');

          if (agentId) {
            taskRepo.updateTaskStatus(taskId, 'running');
          }
        }

        // 发射招募信息素 / Emit recruit pheromone
        if (pheromoneEngine) {
          try {
            pheromoneEngine.emitPheromone({
              type: 'recruit',
              sourceId: agentId || 'swarm-run-tool',
              targetScope: `${RECRUIT_SCOPE_PREFIX}${taskId || 'unknown'}`,
              intensity: 0.8,
              payload: {
                taskDescription: phaseDesc.substring(0, 200),
                role: roleName,
                parentPlanId: plan.id,
                source: 'swarm-run',
              },
            });
          } catch { /* non-fatal */ }
        }

        dispatched.push({
          phaseOrder: phase.order,
          roleName,
          agentId,
          taskId,
          description: phaseDesc,
        });
      } catch (err) {
        errors.push({
          phase: phase.order,
          role: phase.roleName || phase.role,
          error: err.message,
        });
      }
    }

    return { dispatched, errors };
  }

  // ━━━ 模式处理器 / Mode Handlers ━━━

  /**
   * auto 模式: 设计计划 + 立即派遣
   * auto mode: design plan + immediately dispatch
   */
  async function handleAuto(input) {
    const { goal, maxRoles = DEFAULT_MAX_ROLES } = input;

    if (!goal || typeof goal !== 'string' || goal.trim().length === 0) {
      return { success: false, error: '目标描述不能为空 / goal is required' };
    }

    logger.info?.(`[SwarmRunTool] auto 模式启动 / auto mode: "${goal.substring(0, 80)}"`);

    // Step 1: 设计计划 / Design plan
    const planResult = designPlan(goal, maxRoles);
    if (!planResult.success) {
      return planResult;
    }

    // Step 2: 派遣子代理 / Dispatch sub-agents
    const { dispatched, errors } = dispatchPhases(planResult.plan, goal);

    // 更新计划状态 / Update plan status
    if (planRepo && planResult.plan.id && dispatched.length > 0) {
      try {
        planRepo.updateStatus(planResult.plan.id, 'executing');
      } catch { /* non-fatal */ }
    }

    logger.info?.(
      `[SwarmRunTool] auto 完成 / auto complete: planId=${planResult.plan.id}, ` +
      `dispatched=${dispatched.length}, errors=${errors.length}`
    );

    return {
      success: dispatched.length > 0,
      mode: 'auto',
      plan: {
        id: planResult.plan.id,
        taskDescription: planResult.plan.taskDescription,
        status: dispatched.length > 0 ? 'executing' : 'draft',
        phases: (planResult.plan.phases || []).map(p => ({
          id: p.id,
          order: p.order,
          roleName: p.roleName,
          description: p.description,
        })),
        maturityScore: planResult.plan.maturityScore,
      },
      dispatched,
      errors: errors.length > 0 ? errors : undefined,
      roleScores: planResult.roleScores,
      summary: dispatched.length > 0
        ? `已启动蜂群协作: ${dispatched.map(d => `${d.roleName}(${d.description.substring(0, 40)})`).join(', ')}`
        : `计划设计成功但派遣失败: ${errors.map(e => e.error).join('; ')}`,
    };
  }

  /**
   * plan_only 模式: 仅设计计划
   * plan_only mode: design only, no dispatch
   */
  async function handlePlanOnly(input) {
    const { goal, maxRoles = DEFAULT_MAX_ROLES } = input;

    if (!goal || typeof goal !== 'string' || goal.trim().length === 0) {
      return { success: false, error: '目标描述不能为空 / goal is required' };
    }

    logger.info?.(`[SwarmRunTool] plan_only 模式 / plan_only mode: "${goal.substring(0, 80)}"`);

    const planResult = designPlan(goal, maxRoles);
    if (!planResult.success) return planResult;

    return {
      success: true,
      mode: 'plan_only',
      plan: {
        id: planResult.plan.id,
        taskDescription: planResult.plan.taskDescription,
        status: 'draft',
        phases: (planResult.plan.phases || []).map(p => ({
          id: p.id,
          order: p.order,
          roleName: p.roleName,
          description: p.description,
        })),
        maturityScore: planResult.plan.maturityScore,
      },
      roleScores: planResult.roleScores,
      summary: `计划已就绪 (${(planResult.plan.phases || []).length} 阶段), 使用 swarm_run({ goal: "...", mode: "execute", planId: "${planResult.plan.id}" }) 执行。`,
    };
  }

  /**
   * execute 模式: 对已有计划执行派遣
   * execute mode: dispatch for an existing plan
   */
  async function handleExecute(input) {
    const { goal, planId } = input;

    if (!planId) {
      return { success: false, error: 'execute 模式需要 planId / planId required for execute mode' };
    }

    if (!planRepo) {
      return { success: false, error: 'planRepo 不可用 / planRepo not available' };
    }

    logger.info?.(`[SwarmRunTool] execute 模式 / execute mode: planId=${planId}`);

    // 加载计划 / Load plan
    const stored = planRepo.get(planId);
    if (!stored) {
      return { success: false, error: `计划不存在 / Plan not found: ${planId}` };
    }

    const plan = stored.planData;
    const { dispatched, errors } = dispatchPhases(plan, goal || plan.taskDescription);

    // 更新计划状态 / Update plan status
    if (dispatched.length > 0) {
      try {
        planRepo.updateStatus(planId, 'executing');
      } catch { /* non-fatal */ }
    }

    return {
      success: dispatched.length > 0,
      mode: 'execute',
      planId,
      dispatched,
      errors: errors.length > 0 ? errors : undefined,
      summary: dispatched.length > 0
        ? `已派遣 ${dispatched.length} 个子代理执行计划 ${planId}`
        : `派遣失败: ${errors.map(e => e.error).join('; ')}`,
    };
  }

  // ━━━ 主处理函数 / Main Handler ━━━

  async function handler(input) {
    try {
      const mode = input.mode || 'auto';

      switch (mode) {
        case 'auto':
          return await handleAuto(input);
        case 'plan_only':
          return await handlePlanOnly(input);
        case 'execute':
          return await handleExecute(input);
        default:
          return {
            success: false,
            error: `未知模式 / Unknown mode: ${mode}. 支持 / Supported: auto, plan_only, execute`,
          };
      }
    } catch (err) {
      logger.error?.(`[SwarmRunTool] 未捕获错误 / Uncaught error: ${err.message}`);
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
