/**
 * SwarmCheckpointTool — 人机协作检查点工具 / Human-in-the-loop Checkpoint Tool
 *
 * 子代理在执行过程中遇到需要用户批准的关键决策时调用此工具。
 * 调用后子代理必须立即停止执行，等待用户通过主 agent 的 swarm_run 响应。
 *
 * Sub-agents call this tool when they encounter critical decisions requiring user approval
 * during execution. After calling, the sub-agent MUST stop immediately.
 *
 * 工作流 / Workflow:
 *   1. 子代理调用 swarm_checkpoint({ question }) → 检查点写入 DB
 *   2. 子代理输出工具返回的 STOP 消息并结束执行
 *   3. subagent_ended 钩子将消息推送到 parent 会话
 *   4. 用户在聊天中回复
 *   5. 主 agent 调用 swarm_run → 检测到 pending 检查点 → 解析并重新派遣
 *
 * @module L5-application/tools/swarm-checkpoint-tool
 * @author DEEP-IOS
 */

import { randomUUID } from 'crypto';

const TOOL_NAME = 'swarm_checkpoint';
const TOOL_DESCRIPTION =
  '在关键决策点暂停执行并向用户请求确认。适用于不可逆操作（如删除文件、提交变更、执行破坏性操作）。' +
  '调用后必须立即停止所有执行，输出工具返回的消息，不得继续任何操作。';

const inputSchema = {
  type: 'object',
  properties: {
    question: {
      type: 'string',
      description: '向用户提出的确认问题，应清晰描述需要批准的操作及其影响 / Confirmation question for the user',
    },
    taskId: {
      type: 'string',
      description: '当前执行的任务 ID（如知道） / Current task ID if known',
    },
    phaseRole: {
      type: 'string',
      description: '当前执行角色（如 CODER、REVIEWER） / Current execution role',
    },
    phaseDesc: {
      type: 'string',
      description: '当前阶段任务描述，用于恢复执行时提供上下文 / Phase description for context when resuming',
    },
    originalGoal: {
      type: 'string',
      description: '原始用户目标，用于重新派遣时恢复任务 / Original goal for re-spawning',
    },
  },
  required: ['question'],
  additionalProperties: false,
};

/**
 * 创建 swarm_checkpoint 工具实例
 *
 * @param {Object} options
 * @param {Object} options.engines - 引擎集合 / Engine collection
 * @param {Object} options.logger  - 日志器 / Logger
 * @returns {Object} OpenClaw 工具定义 / OpenClaw tool definition
 */
export function createCheckpointTool({ engines, logger }) {
  const { userCheckpointRepo } = engines;

  async function handler(input) {
    const { question, taskId, phaseRole, phaseDesc, originalGoal } = input;

    if (!question || typeof question !== 'string' || question.trim().length === 0) {
      return { success: false, error: '问题内容不能为空 / question is required' };
    }

    if (!userCheckpointRepo) {
      // Fallback: 无 repo 时直接返回 stop 指令
      logger?.warn?.('[SwarmCheckpointTool] userCheckpointRepo 不可用，回退到直接暂停');
      return {
        status: 'checkpoint_registered',
        checkpointId: null,
        instruction: buildStopInstruction(question),
      };
    }

    const id = randomUUID();
    try {
      userCheckpointRepo.create({
        id,
        question: question.trim(),
        taskId: taskId || null,
        agentId: null, // 由调用上下文决定
        phaseRole: phaseRole || null,
        phaseDesc: phaseDesc || null,
        originalGoal: originalGoal || null,
      });
      logger?.info?.(`[SwarmCheckpointTool] 检查点已创建 / Checkpoint created: ${id}`);
    } catch (err) {
      logger?.warn?.(`[SwarmCheckpointTool] DB 写入失败 / DB write failed: ${err.message}`);
    }

    return {
      status: 'checkpoint_registered',
      checkpointId: id,
      instruction: buildStopInstruction(question),
    };
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

/**
 * 构建发送给子代理的强制停止指令
 * Build the mandatory stop instruction returned to the sub-agent
 *
 * @param {string} question
 * @returns {string}
 */
function buildStopInstruction(question) {
  return (
    'CHECKPOINT REGISTERED. MANDATORY STOP.\n' +
    'Do NOT call any more tools. Do NOT continue executing. Do NOT make assumptions.\n' +
    'End your response with ONLY the following message (nothing else):\n\n' +
    `⏸ 任务已暂停，等待您的确认\n\n` +
    `**问题**: ${question}\n\n` +
    `请在聊天中直接回复您的决定（例如："批准"、"继续"、"取消"、"否"），我将在收到确认后继续执行。`
  );
}
