/**
 * CollaborateTool — 协作工具 / Collaborate Tool
 *
 * 抽象化 @mention 机制和通信路由，让 Agent 无需了解底层通信细节。
 * Abstracts @mention mechanics and channel routing so agents don't need
 * to know the underlying communication details.
 *
 * [WHY] OpenClaw 中的 @mention 格式因平台而异（Discord、Slack 等），
 * Agent 经常忘记正确格式。这个工具提供统一的接口。
 * @mention formats vary by platform in OpenClaw (Discord, Slack, etc.),
 * and agents often forget correct formatting. This tool provides a uniform interface.
 *
 * @module tools/collaborate-tool
 * @author DEEP-IOS
 */

import { writeMemory } from '../../layer1-core/db.js';

export const collaborateToolDefinition = {
  name: 'collaborate',
  description: 'Send a message to a peer agent or broadcast to the swarm. Use this instead of @mentions.',
  parameters: {
    type: 'object',
    properties: {
      target: { type: 'string', description: 'Peer agent ID, or "broadcast" for all peers' },
      message: { type: 'string', description: 'Message to send to the target' },
      channel: {
        type: 'string', enum: ['pheromone', 'memory', 'direct'], default: 'pheromone',
        description: 'Routing channel. pheromone=async signal, memory=shared scope, direct=@mention',
      },
      urgency: { type: 'string', enum: ['low', 'medium', 'high', 'critical'], default: 'medium' },
    },
    required: ['target', 'message'],
  },
};

/**
 * 创建协作工具处理函数 / Create the collaborate tool handler
 *
 * @param {Object} engines - 引擎实例集合 / Engine instances
 * @param {Object} config  - 插件配置 / Plugin configuration
 * @param {Object} logger  - 日志器 / Logger instance
 * @returns {Function} 工具处理函数 / Tool handler function
 */
export function createCollaborateHandler(engines, config, logger) {
  /** @type {Record<string, string>} urgency → pheromone type 映射 */
  const urgencyToType = { low: 'trail', medium: 'dance', high: 'recruit', critical: 'alarm' };

  return function handleCollaborate(params, ctx) {
    const { target, message, channel = 'pheromone', urgency = 'medium' } = params;
    const sourceId = ctx?.agentId || 'unknown';

    // ── Channel: pheromone (async signal) ──────────────────────────
    if (channel === 'pheromone') {
      if (!engines.pheromone) {
        return { success: false, error: 'Pheromone engine not enabled' };
      }
      const type = urgencyToType[urgency] || 'dance';
      const scope = target === 'broadcast' ? '/global' : `/agent/${target}`;
      engines.pheromone.emitPheromone({
        type,
        sourceId,
        targetScope: scope,
        intensity: urgency === 'critical' ? 1.0 : 0.8,
        payload: { message, from: sourceId, urgency },
      });
      return { success: true, channel: 'pheromone', target, type };
    }

    // ── Channel: memory (shared scope) ─────────────────────────────
    if (channel === 'memory') {
      try {
        writeMemory({
          scope: target === 'broadcast' ? '/global' : `/agent/${target}`,
          layer: 'D6',
          agentId: sourceId,
          content: `[Message from ${sourceId}]: ${message}`,
          importance: urgency === 'critical' ? 1.0 : 0.5,
          tags: ['collaboration', urgency],
        });
        return { success: true, channel: 'memory', target };
      } catch (err) {
        return { success: false, error: err.message };
      }
    }

    // ── Channel: direct (@mention) ─────────────────────────────────
    if (channel === 'direct') {
      return {
        success: true,
        channel: 'direct',
        target,
        instruction: `Please use @${target} in your next message to communicate directly.`,
      };
    }

    return { success: false, error: `Unknown channel: ${channel}` };
  };
}
