/**
 * SwarmPlanTool -- 执行计划工具 / Swarm Plan Tool
 *
 * V5.0 L5 应用层工具: 基于 MoE 的自组织任务规划。
 * V5.0 L5 Application Layer tool: MoE-based self-organizing task planning.
 *
 * 核心能力 / Core capabilities:
 * - MoE Top-K 角色推荐 → 计划生成 → 计划验证
 *   MoE Top-K role recommendation -> plan generation -> plan validation
 * - 计划持久化 (PlanRepository)
 *   Plan persistence (PlanRepository)
 * - 计划生命周期管理 (draft → validated → executing → completed)
 *   Plan lifecycle management
 *
 * 动作 / Actions:
 * - design:   设计执行计划 / Design an execution plan
 * - validate: 验证计划质量 / Validate a plan's quality
 * - list:     列出计划 / List execution plans
 * - detail:   获取计划详情 / Get plan details
 *
 * @module L5-application/tools/swarm-plan-tool
 * @author DEEP-IOS
 */

// ============================================================================
// 常量 / Constants
// ============================================================================

const TOOL_NAME = 'swarm_plan';
const TOOL_DESCRIPTION = '将复杂任务拆分为多阶段执行计划，自动分配给专业子代理(侦察/开发/审查)并行协作完成。适用于: 多步骤调研、对比分析、技术方案设计等需要多角色协作的任务。';

/** 默认最大角色数 / Default maximum roles */
const DEFAULT_MAX_ROLES = 5;

/** 默认计划列表上限 / Default plan list limit */
const DEFAULT_LIST_LIMIT = 20;

// ============================================================================
// JSON Schema 定义 / JSON Schema Definition
// ============================================================================

const inputSchema = {
  type: 'object',
  properties: {
    action: {
      type: 'string',
      enum: ['design', 'validate', 'list', 'detail'],
      description: '操作类型 / Action type: design, validate, list, or detail',
    },
    // design 参数 / design params
    taskDescription: {
      type: 'string',
      description: '任务描述 (design 必需) / Task description (required for design)',
    },
    constraints: {
      type: 'object',
      additionalProperties: true,
      description: '约束条件 / Constraints (optional)',
    },
    maxRoles: {
      type: 'number',
      description: '最大角色数 / Maximum roles (optional, default 5)',
    },
    // validate, detail 参数 / validate, detail params
    planId: {
      type: 'string',
      description: '计划 ID (validate/detail 必需) / Plan ID (required for validate/detail)',
    },
    // list 参数 / list params
    status: {
      type: 'string',
      description: '按状态过滤 / Filter by status (optional)',
    },
    limit: {
      type: 'number',
      description: '列表数量上限 / List limit (optional)',
    },
  },
  required: ['action'],
};

// ============================================================================
// 工厂函数 / Factory Function
// ============================================================================

/**
 * 创建执行计划工具
 * Create the execution plan tool
 *
 * @param {Object} deps
 * @param {Object} deps.engines - 引擎实例集合 / Engine instances
 * @param {Object} deps.logger - 日志器 / Logger
 * @returns {{ name: string, description: string, inputSchema: Object, handler: Function }}
 */
export function createPlanTool({ engines, logger }) {
  const {
    executionPlanner,
    planRepo,
    messageBus,
    // V5.6: CPM 分析 / CPM analysis
    criticalPathAnalyzer,
  } = engines;

  /**
   * 设计执行计划 / Design an execution plan
   *
   * 流程 / Flow:
   * 1. 使用 ExecutionPlanner.planExecution() 做 MoE 角色推荐
   *    Use ExecutionPlanner.planExecution() for MoE role recommendation
   * 2. 使用 ExecutionPlanner.generatePlan() 生成执行计划
   *    Use ExecutionPlanner.generatePlan() to generate execution plan
   * 3. 持久化到 PlanRepository
   *    Persist to PlanRepository
   *
   * @param {Object} input
   * @returns {Object}
   */
  async function handleDesign(input) {
    const { taskDescription, constraints, maxRoles = DEFAULT_MAX_ROLES } = input;

    if (!taskDescription || typeof taskDescription !== 'string') {
      return { success: false, error: '任务描述不能为空 / taskDescription is required' };
    }

    if (!executionPlanner) {
      return { success: false, error: 'executionPlanner 不可用 / executionPlanner not available' };
    }

    try {
      logger.info?.(
        `[SwarmPlanTool] 开始计划设计 / Starting plan design: "${taskDescription.substring(0, 80)}"`
      );

      // Step 1: MoE 角色推荐 / MoE role recommendation
      const roleResult = executionPlanner.planExecution(taskDescription, {
        topK: maxRoles,
        requirements: constraints || {},
      });

      const roles = roleResult.roles || [];
      const scores = roleResult.scores || [];
      const fallback = roleResult.fallback || false;

      if (roles.length === 0) {
        return {
          success: false,
          error: '未找到匹配角色 / No matching roles found',
        };
      }

      // Step 2: 生成执行计划 / Generate execution plan
      const plan = executionPlanner.generatePlan(taskDescription, roles);

      // Step 3: 持久化计划 / Persist plan
      let persistedId = plan.id;
      if (planRepo) {
        try {
          persistedId = planRepo.create({
            id: plan.id,
            taskId: null,
            planData: plan,
            status: plan.status || 'draft',
            createdBy: 'swarm-plan-tool',
            maturityScore: plan.maturityScore,
          });
        } catch (err) {
          logger.warn?.(`[SwarmPlanTool] 计划持久化失败 / Plan persistence failed: ${err.message}`);
          // 非致命, 继续返回内存中的计划 / Non-fatal, continue with in-memory plan
        }
      }

      // 广播事件 / Broadcast event
      if (messageBus) {
        try {
          messageBus.publish('plan.designed', {
            planId: persistedId,
            taskDescription: taskDescription.substring(0, 100),
            roleCount: roles.length,
            fallback,
          }, { senderId: 'swarm-plan-tool' });
        } catch {
          // 忽略 / Ignore
        }
      }

      // V5.6: CPM 关键路径分析 / CPM critical path analysis
      let cpmAnalysis = undefined;
      if (criticalPathAnalyzer && plan.phases?.length > 0) {
        try {
          const cpmRoles = plan.phases.map((phase, idx) => ({
            name: phase.roleName || `phase-${phase.order || idx}`,
            duration: phase.estimatedDuration || 60000,
            dependencies: idx > 0
              ? [plan.phases[idx - 1].roleName || `phase-${plan.phases[idx - 1].order || (idx - 1)}`]
              : [],
          }));
          const cpmResult = criticalPathAnalyzer.analyze(cpmRoles);
          const bottlenecks = criticalPathAnalyzer.suggestBottleneckSplits();
          cpmAnalysis = {
            criticalPath: cpmResult.criticalPath,
            totalDuration: cpmResult.totalDuration,
            parallelismFactor: cpmResult.parallelismFactor,
            bottleneckSuggestions: bottlenecks.length > 0 ? bottlenecks : undefined,
          };
        } catch (cpmErr) {
          logger.warn?.(`[SwarmPlanTool] CPM analysis failed: ${cpmErr.message}`);
        }
      }

      logger.info?.(
        `[SwarmPlanTool] 计划设计完成 / Plan design complete: planId=${persistedId}, ` +
        `roles=${roles.length}, maturity=${plan.maturityScore}`
      );

      return {
        success: true,
        plan: {
          id: persistedId,
          taskDescription: plan.taskDescription,
          status: plan.status,
          roles: plan.roles,
          phases: plan.phases.map(p => ({
            id: p.id,
            order: p.order,
            roleName: p.roleName,
            description: p.description,
            status: p.status,
          })),
          constraints: plan.constraints,
          maturityScore: plan.maturityScore,
          metadata: plan.metadata,
        },
        roleScores: scores.slice(0, maxRoles),
        fallbackUsed: fallback,
        cpmAnalysis, // V5.6: 关键路径分析 / Critical path analysis
      };
    } catch (err) {
      return { success: false, error: `计划设计失败 / Plan design failed: ${err.message}` };
    }
  }

  /**
   * 验证计划质量 / Validate a plan's quality
   *
   * @param {Object} input
   * @returns {Object}
   */
  async function handleValidate(input) {
    const { planId } = input;

    if (!planId) {
      return { success: false, error: 'planId 不能为空 / planId is required' };
    }

    if (!executionPlanner) {
      return { success: false, error: 'executionPlanner 不可用 / executionPlanner not available' };
    }

    try {
      // 从 repo 加载计划 / Load plan from repo
      let plan = null;
      if (planRepo) {
        const stored = planRepo.get(planId);
        if (stored) {
          plan = stored.planData;
        }
      }

      if (!plan) {
        return { success: false, error: `计划不存在 / Plan not found: ${planId}` };
      }

      // 执行验证 / Perform validation
      const validation = executionPlanner.validatePlan(plan);

      // 如果验证通过, 更新状态 / If valid, update status
      if (validation.valid && planRepo) {
        try {
          planRepo.updateStatus(planId, 'validated');
        } catch (err) {
          logger.warn?.(`[SwarmPlanTool] 计划状态更新失败 / Plan status update failed: ${err.message}`);
        }
      }

      logger.info?.(
        `[SwarmPlanTool] 计划验证完成 / Plan validation complete: planId=${planId}, valid=${validation.valid}`
      );

      return {
        success: true,
        validation: {
          planId,
          valid: validation.valid,
          issues: validation.issues,
          issueCount: validation.issues.length,
        },
      };
    } catch (err) {
      return { success: false, error: `验证失败 / Validation failed: ${err.message}` };
    }
  }

  /**
   * 列出执行计划 / List execution plans
   *
   * @param {Object} input
   * @returns {Object}
   */
  async function handleList(input) {
    const { status, limit = DEFAULT_LIST_LIMIT } = input;

    if (!planRepo) {
      return { success: false, error: 'planRepo 不可用 / planRepo not available' };
    }

    try {
      const plans = planRepo.list(status || null, limit);

      return {
        success: true,
        plans: plans.map(p => ({
          id: p.id,
          taskId: p.taskId,
          status: p.status,
          createdBy: p.createdBy,
          maturityScore: p.maturityScore,
          createdAt: p.createdAt,
          updatedAt: p.updatedAt,
          // 简要信息 / Brief info from plan data
          taskDescription: p.planData?.taskDescription?.substring(0, 100),
          roleCount: p.planData?.roles?.length || 0,
        })),
        count: plans.length,
      };
    } catch (err) {
      return { success: false, error: `列出计划失败 / List failed: ${err.message}` };
    }
  }

  /**
   * 获取计划详情 / Get plan details
   *
   * @param {Object} input
   * @returns {Object}
   */
  async function handleDetail(input) {
    const { planId } = input;

    if (!planId) {
      return { success: false, error: 'planId 不能为空 / planId is required' };
    }

    if (!planRepo) {
      return { success: false, error: 'planRepo 不可用 / planRepo not available' };
    }

    try {
      const stored = planRepo.get(planId);
      if (!stored) {
        return { success: false, error: `计划不存在 / Plan not found: ${planId}` };
      }

      return {
        success: true,
        plan: {
          id: stored.id,
          taskId: stored.taskId,
          status: stored.status,
          createdBy: stored.createdBy,
          maturityScore: stored.maturityScore,
          createdAt: stored.createdAt,
          updatedAt: stored.updatedAt,
          planData: stored.planData,
        },
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
        case 'design':
          return await handleDesign(input);
        case 'validate':
          return await handleValidate(input);
        case 'list':
          return await handleList(input);
        case 'detail':
          return await handleDetail(input);
        default:
          return {
            success: false,
            error: `未知操作 / Unknown action: ${action}. 支持 / Supported: design, validate, list, detail`,
          };
      }
    } catch (err) {
      logger.error?.(`[SwarmPlanTool] 未捕获错误 / Uncaught error: ${err.message}`);
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
