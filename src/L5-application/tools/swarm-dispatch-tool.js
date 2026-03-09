/**
 * SwarmDispatchTool -- 蜂群派遣工具 / Swarm Dispatch Tool
 *
 * 解决核心问题：模型无法可靠调用 `message` 工具发送跨频道消息。
 * 本工具提供简单接口，模型只需指定 agentId 和 task，
 * 插件自动通过 Discord API 发送 @mention 到协作频道。
 *
 * Solves: model cannot reliably call `message` tool for cross-channel dispatch.
 * Provides simple interface: model specifies agentId + task,
 * plugin auto-sends @mention to collaboration channel via Discord API.
 *
 * @module L5-application/tools/swarm-dispatch-tool
 */

const TOOL_NAME = 'swarm_dispatch';

const TOOL_DESCRIPTION =
  'Dispatch a task to a sub-agent bot in the collaboration Discord channel. ' +
  'The bot will receive an @mention and respond visibly. ' +
  'Use this instead of message tool for dispatching tasks to MPU-D1/D2/D3.';

const inputSchema = {
  type: 'object',
  properties: {
    agentId: {
      type: 'string',
      enum: ['mpu-d1', 'mpu-d2', 'mpu-d3'],
      description:
        'Sub-agent to dispatch: mpu-d1 (scout/research), mpu-d2 (guard/review), mpu-d3 (worker/code)',
    },
    task: {
      type: 'string',
      description: 'Task description for the sub-agent',
    },
  },
  required: ['agentId', 'task'],
};

/**
 * Create the swarm dispatch tool.
 *
 * @param {Object} deps
 * @param {Function} deps.sendMessageDiscord - Discord message sender from api.runtime
 * @param {Object} deps.config - OpenClaw config (for token resolution)
 * @param {Object} deps.agentMap - Mapping of agentId → Discord bot user ID
 * @param {string} deps.collaborationChannelId - Discord channel ID for collaboration
 * @param {string} deps.selfMentionId - MPU-T's own Discord user ID (for callback mention)
 * @param {Object} deps.logger
 */
export function createDispatchTool({
  sendMessageDiscord,
  config,
  agentMap,
  collaborationChannelId,
  selfMentionId,
  logger,
}) {
  async function handler(input) {
    const { agentId, task } = input;

    if (!agentId || !task) {
      return { success: false, error: 'agentId and task are required' };
    }

    const botUserId = agentMap[agentId];
    if (!botUserId) {
      return {
        success: false,
        error: `Unknown agentId: ${agentId}. Valid: ${Object.keys(agentMap).join(', ')}`,
      };
    }

    // Build the message with @mention
    const mentionText = `<@${botUserId}> ${task}\n\n完成后请 @mention 我 <@${selfMentionId}>。`;

    logger.info?.(
      `[SwarmDispatch] Dispatching to ${agentId} (bot ${botUserId}) in channel ${collaborationChannelId}`
    );

    try {
      const result = await sendMessageDiscord(
        collaborationChannelId,
        mentionText,
        { cfg: config }
      );

      logger.info?.(
        `[SwarmDispatch] Message sent successfully to channel ${collaborationChannelId}`
      );

      return {
        success: true,
        agentId,
        channelId: collaborationChannelId,
        messageId: result?.id || null,
        message: `已派遣 ${agentId} 执行任务，消息已发送到协作频道。等待 ${agentId} 完成后 @mention 回复。`,
      };
    } catch (err) {
      logger.error?.(
        `[SwarmDispatch] Failed to send Discord message: ${err.message}`
      );
      return {
        success: false,
        error: `Discord 消息发送失败: ${err.message}`,
      };
    }
  }

  return {
    name: TOOL_NAME,
    description: TOOL_DESCRIPTION,
    parameters: inputSchema,
    execute: async (toolCallId, params) => {
      const result = await handler(params);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  };
}
