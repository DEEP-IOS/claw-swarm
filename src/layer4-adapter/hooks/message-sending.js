/**
 * message_sending Hook — 消息发送钩子 / Message Sending Hook
 *
 * 自动修复 Agent 消息中的 @mention 格式，
 * 将不正确的 @提及 替换为 collaborate 工具使用提示。
 *
 * Auto-fixes @mention formatting in agent messages,
 * replacing incorrect @mentions with collaborate tool usage hints.
 *
 * [WHY] Agent 经常忘记正确的 @mention 格式，
 * 或者在子代理上下文中 @mention 根本不工作。
 * 这个钩子检测并修复这些情况。
 *
 * Agents often forget correct @mention formatting,
 * or @mentions don't work at all in subagent contexts.
 * This hook detects and fixes these cases.
 *
 * @module hooks/message-sending
 * @author DEEP-IOS
 */

/**
 * 处理 message_sending 事件 / Handle the message_sending event
 *
 * 扫描消息内容中的 @mention 模式，如果匹配已知同伴 Agent，
 * 则替换为 collaborate 工具使用提示。
 *
 * Scans message content for @mention patterns, and if they match
 * known peer agents, replaces them with collaborate tool usage hints.
 *
 * @param {Object} event   - 事件对象，包含 content 字段 / Event with content field
 * @param {Object} ctx     - 上下文对象 / Context object
 * @param {Object} engines - 引擎实例集合 / Engine instances
 * @param {Object} config  - 插件配置 / Plugin configuration
 * @param {Object} logger  - 日志器 / Logger instance
 * @returns {{ content: string }|undefined} 修改后的内容或 undefined（不修改）
 */
export function handleMessageSending(event, ctx, engines, config, logger) {
  const content = event?.content;
  if (!content || !config.collaboration?.mentionFixer) return;

  const mentionPattern = /@([\w-]+)/g;
  const mentions = content.match(mentionPattern);
  if (!mentions) return;

  // 获取已知同伴列表 / Get known peer list
  const peers = engines.peerDirectory?.getDirectory?.() || [];

  // 只重写匹配已知同伴的 @mention / Only rewrite mentions that match known peers
  let fixed = content;
  let changed = false;

  for (const mention of mentions) {
    const agentId = mention.slice(1); // 去掉 @ 前缀 / Remove @ prefix
    const isPeer = peers.some(
      p => p.id === agentId || p.label === agentId || p.name === agentId,
    );

    if (isPeer) {
      fixed = fixed.replace(mention, `[To communicate with ${agentId}, use the collaborate tool]`);
      changed = true;
    }
  }

  if (changed) {
    return { content: fixed };
  }
}
