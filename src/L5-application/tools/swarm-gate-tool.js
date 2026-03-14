/**
 * @deprecated V6.3 — 功能已吸收到 auto-hooks + swarm_query / Absorbed into auto-hooks + swarm_query
 * SwarmGateTool -- 质量门控工具 / Swarm Quality Gate Tool
 *
 * V5.0 L5 应用层工具: 任务输出的质量门控评审。
 * V5.0 L5 Application Layer tool: Quality gate controls for
 * task output review.
 *
 * 质量门控基于 3 层评审模型 / Quality gate based on 3-tier review model:
 * - self-review:  自评 (阈值 0.6) / Self-review (threshold 0.6)
 * - peer-review:  同级评审 (阈值 0.7) / Peer review (threshold 0.7)
 * - lead-review:  领导评审 (阈值 0.85) / Lead review (threshold 0.85)
 *
 * 动作 / Actions:
 * - evaluate: 提交任务输出进行质量评估 / Submit task output for quality evaluation
 * - appeal:   对质量拒绝提出申诉 / Appeal a quality rejection
 * - stats:    获取质量统计 / Get quality statistics
 *
 * @module L5-application/tools/swarm-gate-tool
 * @author DEEP-IOS
 */

// ============================================================================
// 常量 / Constants
// ============================================================================

const TOOL_NAME = 'swarm_gate';
const TOOL_DESCRIPTION = 'Quality gate controls for task output review';

// ============================================================================
// JSON Schema 定义 / JSON Schema Definition
// ============================================================================

const inputSchema = {
  type: 'object',
  properties: {
    action: {
      type: 'string',
      enum: ['evaluate', 'appeal', 'stats'],
      description: '操作类型 / Action type: evaluate, appeal, or stats',
    },
    // evaluate 参数 / evaluate params
    taskId: {
      type: 'string',
      description: '任务 ID / Task ID (required for evaluate)',
    },
    output: {
      type: 'object',
      additionalProperties: true,
      description: '任务输出结果 / Task output result (required for evaluate)',
    },
    agentId: {
      type: 'string',
      description: '执行代理 ID / Executing agent ID (required for evaluate, optional for stats)',
    },
    // appeal 参数 / appeal params
    evaluationId: {
      type: 'string',
      description: '评估记录 ID / Evaluation record ID (required for appeal)',
    },
    reason: {
      type: 'string',
      description: '申诉理由 / Appeal reason (required for appeal)',
    },
  },
  required: ['action'],
};

// ============================================================================
// 工厂函数 / Factory Function
// ============================================================================

/**
 * 创建质量门控工具
 * Create the quality gate tool
 *
 * @param {Object} deps
 * @param {Object} deps.engines - 引擎实例集合 / Engine instances
 * @param {Object} deps.logger - 日志器 / Logger
 * @returns {{ name: string, description: string, inputSchema: Object, handler: Function }}
 */
export function createGateTool({ engines, logger }) {
  const {
    qualityController,
    reputationLedger,
    messageBus,
    taskRepo,
  } = engines;

  /**
   * 评估任务输出质量 / Evaluate task output quality
   *
   * 委托给 QualityController.evaluate() 执行多维度评分。
   * Delegates to QualityController.evaluate() for multi-dimensional scoring.
   *
   * @param {Object} input
   * @returns {Object}
   */
  async function handleEvaluate(input) {
    const { taskId, output, agentId } = input;

    // 验证必需参数 / Validate required params
    if (!taskId) {
      return { success: false, error: 'taskId 不能为空 / taskId is required' };
    }
    if (!output) {
      return { success: false, error: 'output 不能为空 / output is required' };
    }
    if (!agentId) {
      return { success: false, error: 'agentId 不能为空 / agentId is required' };
    }

    if (!qualityController) {
      return { success: false, error: 'qualityController 不可用 / qualityController not available' };
    }

    try {
      logger.info?.(
        `[SwarmGateTool] 开始质量评估 / Starting quality evaluation: taskId=${taskId}, agentId=${agentId}`
      );

      // 执行质量评估 / Perform quality evaluation
      const evaluation = await qualityController.evaluate(taskId, output, {
        reviewerId: agentId,
      });

      // 如果通过且有 ReputationLedger, 更新声誉 / If passed and ReputationLedger exists, update reputation
      if (evaluation.passed && reputationLedger) {
        try {
          reputationLedger.recordSuccess(agentId, {
            taskId,
            score: evaluation.score,
            tier: evaluation.tier,
          });
        } catch (err) {
          logger.debug?.(`[SwarmGateTool] 声誉更新跳过 / Reputation update skipped: ${err.message}`);
        }
      }

      // 如果失败且有 ReputationLedger, 记录失败 / If failed, record failure
      if (!evaluation.passed && reputationLedger) {
        try {
          reputationLedger.recordFailure(agentId, {
            taskId,
            score: evaluation.score,
            tier: evaluation.tier,
          });
        } catch (err) {
          logger.debug?.(`[SwarmGateTool] 声誉更新跳过 / Reputation update skipped: ${err.message}`);
        }
      }

      logger.info?.(
        `[SwarmGateTool] 质量评估完成 / Quality evaluation complete: ` +
        `score=${evaluation.score}, verdict=${evaluation.verdict}, passed=${evaluation.passed}`
      );

      return {
        success: true,
        evaluation: {
          evaluationId: evaluation.evaluationId,
          taskId,
          agentId,
          score: evaluation.score,
          verdict: evaluation.verdict,
          tier: evaluation.tier,
          passed: evaluation.passed,
          feedback: evaluation.feedback,
          dimensions: evaluation.dimensions,
        },
      };
    } catch (err) {
      return { success: false, error: `评估失败 / Evaluation failed: ${err.message}` };
    }
  }

  /**
   * 对质量拒绝提出申诉 / Appeal a quality rejection
   *
   * 用更高层级重新评估。
   * Re-evaluates with a higher review tier.
   *
   * @param {Object} input
   * @returns {Object}
   */
  async function handleAppeal(input) {
    const { evaluationId, reason } = input;

    if (!evaluationId) {
      return { success: false, error: 'evaluationId 不能为空 / evaluationId is required' };
    }
    if (!reason) {
      return { success: false, error: '申诉理由不能为空 / reason is required' };
    }

    if (!qualityController) {
      return { success: false, error: 'qualityController 不可用 / qualityController not available' };
    }

    try {
      logger.info?.(
        `[SwarmGateTool] 申诉请求 / Appeal request: evaluationId=${evaluationId}, reason="${reason.substring(0, 80)}"`
      );

      // 查找原始评估对应的任务 / Find the task for the original evaluation
      // 使用 qualityController 的质量报告查找 / Use quality controller's report to find
      // 由于 evaluationId 直接关联到 taskId, 尝试从评估历史查找
      // Since evaluationId is linked to taskId, try to find from evaluation history

      // 广播申诉事件 / Broadcast appeal event
      if (messageBus) {
        try {
          messageBus.publish('quality.appeal.submitted', {
            evaluationId,
            reason,
          }, { senderId: 'swarm-gate-tool' });
        } catch {
          // 忽略 / Ignore
        }
      }

      // 返回申诉已提交 / Return appeal submitted
      return {
        success: true,
        evaluation: {
          evaluationId,
          appealReason: reason,
          status: 'appeal_submitted',
        },
        message: `申诉已提交, 将由更高层级评审 / Appeal submitted, will be reviewed by higher tier`,
      };
    } catch (err) {
      return { success: false, error: `申诉失败 / Appeal failed: ${err.message}` };
    }
  }

  /**
   * 获取质量统计 / Get quality statistics
   *
   * @param {Object} input
   * @returns {Object}
   */
  async function handleStats(input) {
    const { agentId } = input;

    if (!qualityController) {
      return { success: false, error: 'qualityController 不可用 / qualityController not available' };
    }

    try {
      // 获取全局统计 / Get global stats
      const globalStats = qualityController.getStats();

      // 如果指定了 agentId, 获取该代理的质量报告 / If agentId specified, get agent quality report
      let agentReport = null;
      if (agentId) {
        // 查找与该代理关联的任务 / Find tasks associated with this agent
        if (taskRepo) {
          const tasks = taskRepo.listTasks();
          const agentTasks = tasks.filter(t => t.config?.assignedAgent === agentId);

          // 收集各任务的质量报告 / Collect quality reports for each task
          const reports = [];
          for (const task of agentTasks) {
            const report = qualityController.getQualityReport(task.id);
            if (report) {
              reports.push(report);
            }
          }

          agentReport = {
            agentId,
            taskCount: agentTasks.length,
            evaluatedTasks: reports.length,
            reports: reports.slice(0, 10), // 最多 10 条 / Max 10
          };
        }
      }

      return {
        success: true,
        stats: {
          global: globalStats,
          agent: agentReport,
        },
      };
    } catch (err) {
      return { success: false, error: `统计查询失败 / Stats query failed: ${err.message}` };
    }
  }

  // ━━━ 主处理函数 / Main Handler ━━━

  async function handler(input) {
    try {
      const { action } = input;

      switch (action) {
        case 'evaluate':
          return await handleEvaluate(input);
        case 'appeal':
          return await handleAppeal(input);
        case 'stats':
          return await handleStats(input);
        default:
          return {
            success: false,
            error: `未知操作 / Unknown action: ${action}. 支持 / Supported: evaluate, appeal, stats`,
          };
      }
    } catch (err) {
      logger.error?.(`[SwarmGateTool] 未捕获错误 / Uncaught error: ${err.message}`);
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
