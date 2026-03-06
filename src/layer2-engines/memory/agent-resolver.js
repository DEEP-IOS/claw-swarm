/**
 * AgentResolver — Agent ID 解析工具 / Agent ID Resolution Utility
 *
 * 解决 after_tool_call ctx 可能没有 agentId 的问题。
 * Resolves the problem where after_tool_call ctx may lack agentId.
 *
 * [WHY] 不同的 hook 上下文提供的信息不一致：有些有 agentId，有些只有 sessionKey。
 * 本模块提供多策略级联解析，确保任何 hook 下都能拿到有效的 agent ID。
 * Different hook contexts provide inconsistent info: some have agentId, some only sessionKey.
 * This module provides multi-strategy cascading resolution to ensure a valid agent ID in any hook.
 *
 * 本模块基于配置解析，无 DB 依赖。
 * This module is config-based resolution with no DB dependency.
 *
 * @module agent-resolver
 * @author DEEP-IOS
 */

import { DEFAULT_CONFIG } from "../../layer1-core/config.js";

/**
 * 从各种上下文来源解析 agent ID / Resolve agent ID from various context sources
 *
 * @param {object} ctx       - hook context
 * @param {object} [event]   - hook event（可选，用于额外线索）/ hook event (optional, for extra clues)
 * @param {object} [config]  - 配置 / config
 * @returns {string}
 */
export function resolveAgentId(ctx, event, config = DEFAULT_CONFIG) {
  // 策略 1：直接使用 ctx.agentId（如果存在且不为空）
  // Strategy 1: Use ctx.agentId directly (if present and non-empty)
  if (config.agentResolution.preferCtxAgentId && ctx?.agentId) {
    return ctx.agentId;
  }

  // 策略 2：从 sessionKey 提取
  // Strategy 2: Extract from sessionKey
  // sessionKey 格式通常为 "agent:main:main" 或 "main:channel:id"
  // sessionKey format is typically "agent:main:main" or "main:channel:id"
  if (config.agentResolution.fallbackToSessionKey && ctx?.sessionKey) {
    const parts = ctx.sessionKey.split(":");
    // 尝试识别 agent ID / Attempt to identify agent ID
    for (const part of parts) {
      // 常见的 agent ID 模式 / Common agent ID patterns
      if (/^(main|agent-\w+|creative|default)$/i.test(part)) {
        return part.toLowerCase();
      }
    }
    // 如果没匹配到特定模式，使用第一部分
    // If no specific pattern matched, use the first part
    if (parts[0] && parts[0].trim()) {
      return parts[0].trim().toLowerCase();
    }
  }

  // 策略 3：从 event 中推断（如果有 agentId 字段）
  // Strategy 3: Infer from event (if it has an agentId field)
  if (event?.agentId) {
    return event.agentId;
  }

  // 策略 4：默认 fallback / Strategy 4: Default fallback
  return config.agentResolution.defaultAgentId;
}

/**
 * 检测 session 是否为"新 session" / Detect whether session is a "new session"
 *
 * 基于 state.sessionId 和 ctx.sessionId 比较
 * Based on comparison of state.sessionId and ctx.sessionId
 *
 * @param {object} state - 当前 agent 的内存状态 / current agent's in-memory state
 * @param {object} ctx   - hook context
 * @returns {boolean}
 */
export function isNewSession(state, ctx) {
  if (!ctx?.sessionId) return false;
  if (!state?.sessionId) return true; // 首次见到这个 agent / First time seeing this agent
  return state.sessionId !== ctx.sessionId;
}

/**
 * 检查 session 是否有实质的用户对话历史 / Check if session has substantial user conversation history
 *
 * 避免被 system prompt 干扰
 * Avoids being misled by system prompts
 *
 * @param {Array}  messages - session messages
 * @param {object} config   - 全局配置 / global config
 * @returns {boolean}
 */
export function hasUserMessageHistory(messages, config) {
  if (!Array.isArray(messages) || messages.length === 0) {
    return false;
  }

  const userMsgCount = messages.filter(
    (m) =>
      m?.role === "user" &&
      typeof extractMessageText(m) === "string" &&
      extractMessageText(m).length > 0
  ).length;

  return userMsgCount >= config.injection.minUserMessages;
}

/**
 * 从消息对象提取文本内容 / Extract text content from message object
 * @param {unknown} msg
 * @returns {string}
 */
function extractMessageText(msg) {
  if (!msg) return "";
  if (typeof msg === "string") return msg;
  if (typeof msg.content === "string") return msg.content;
  if (Array.isArray(msg.content)) {
    const textBlock = msg.content.find((c) => c?.type === "text");
    return textBlock?.text || "";
  }
  if (Array.isArray(msg)) {
    const textBlock = msg.find((c) => c?.type === "text");
    return textBlock?.text || "";
  }
  return String(msg);
}
