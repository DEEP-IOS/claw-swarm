/**
 * CronTool — 让蜂群 agent 能够创建/管理定时任务
 *
 * 通过 OpenClaw 的 cron API 注册和管理定时任务。
 * 支持一次性延时任务和周期性 cron 表达式。
 *
 * 场景:
 *   - 每天早上自动生成日报
 *   - 定时检查 PR 状态
 *   - 周期性市场数据采集
 *   - 定时发布内容到多平台
 *
 * @module bridge/tools/cron-tool
 * @version 9.2.0
 */

function toolResponse(data) {
  return { content: [{ type: 'text', text: JSON.stringify(data) }] };
}

function errorResponse(error) {
  return toolResponse({ status: 'error', error: String(error) });
}

/**
 * 创建 swarm_cron tool
 * @param {Object} deps
 * @param {Object} deps.core - SwarmCoreV9
 * @returns {Object} tool definition
 */
export function createCronTool(deps) {
  const { core } = deps;

  /** @type {Map<string, Object>} cronId → job info */
  const jobs = new Map();

  return {
    name: 'swarm_cron',
    description: [
      '管理蜂群定时任务。支持创建、列出、删除定时任务。',
      '',
      '操作:',
      '  create — 创建定时任务 (需要 schedule + goal)',
      '  list   — 列出所有定时任务',
      '  delete — 删除定时任务 (需要 cronId)',
      '',
      'schedule 格式:',
      '  cron 表达式: "0 9 * * *" (每天 9 点)',
      '  延时: "in 30m" / "in 2h" / "in 1d"',
      '',
      '示例:',
      '  { "action": "create", "schedule": "0 9 * * *", "goal": "生成今日工作日报" }',
      '  { "action": "create", "schedule": "in 2h", "goal": "检查 PR #42 状态" }',
    ].join('\n'),
    input_schema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['create', 'list', 'delete'],
          description: '操作类型',
        },
        schedule: {
          type: 'string',
          description: 'cron 表达式或延时 ("0 9 * * *" 或 "in 30m")',
        },
        goal: {
          type: 'string',
          description: '任务目标描述',
        },
        cronId: {
          type: 'string',
          description: '定时任务 ID (删除时需要)',
        },
      },
      required: ['action'],
    },
    async execute(toolCallId, input) {
      try {
        const { action } = input;

        switch (action) {
          case 'create': {
            if (!input.schedule || !input.goal) {
              return errorResponse('创建定时任务需要 schedule 和 goal 参数');
            }

            const cronId = `cron_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

            // 解析延时格式
            let scheduleConfig;
            const delayMatch = input.schedule.match(/^in\s+(\d+)(m|h|d)$/i);
            if (delayMatch) {
              const amount = parseInt(delayMatch[1], 10);
              const unit = delayMatch[2].toLowerCase();
              const multipliers = { m: 60000, h: 3600000, d: 86400000 };
              const delayMs = amount * (multipliers[unit] || 60000);
              scheduleConfig = {
                type: 'once',
                runAt: Date.now() + delayMs,
                delayMs,
              };
            } else {
              scheduleConfig = {
                type: 'cron',
                expression: input.schedule,
              };
            }

            const job = {
              id: cronId,
              schedule: scheduleConfig,
              goal: input.goal,
              createdAt: Date.now(),
              status: 'active',
              lastRunAt: null,
              runCount: 0,
            };

            jobs.set(cronId, job);

            // 发布事件让外部系统知道
            core?.bus?.publish?.('cron.created', {
              cronId,
              schedule: input.schedule,
              goal: input.goal,
            }, 'swarm_cron');

            // 如果是一次性任务，设置定时器
            if (scheduleConfig.type === 'once') {
              setTimeout(() => {
                job.lastRunAt = Date.now();
                job.runCount++;
                job.status = 'completed';
                core?.bus?.publish?.('cron.fired', {
                  cronId,
                  goal: input.goal,
                }, 'swarm_cron');
              }, scheduleConfig.delayMs).unref?.();
            }

            return toolResponse({
              status: 'created',
              cronId,
              message: scheduleConfig.type === 'once'
                ? `定时任务已创建 — 将在 ${input.schedule.replace('in ', '')} 后执行`
                : `定时任务已创建 — 按 "${input.schedule}" 周期执行`,
              job,
            });
          }

          case 'list': {
            const list = [];
            for (const [id, job] of jobs) {
              list.push({
                id,
                goal: job.goal,
                schedule: job.schedule,
                status: job.status,
                runCount: job.runCount,
                lastRunAt: job.lastRunAt,
                createdAt: job.createdAt,
              });
            }
            return toolResponse({ status: 'ok', jobs: list, count: list.length });
          }

          case 'delete': {
            if (!input.cronId) {
              return errorResponse('删除定时任务需要 cronId 参数');
            }
            const job = jobs.get(input.cronId);
            if (!job) {
              return errorResponse(`未找到定时任务: ${input.cronId}`);
            }
            job.status = 'cancelled';
            jobs.delete(input.cronId);

            core?.bus?.publish?.('cron.deleted', {
              cronId: input.cronId,
            }, 'swarm_cron');

            return toolResponse({ status: 'deleted', message: `定时任务 ${input.cronId} 已删除` });
          }

          default:
            return errorResponse(`未知操作: ${action}`);
        }
      } catch (err) {
        return errorResponse(`swarm_cron execution failed: ${err.message}`);
      }
    },
  };
}
