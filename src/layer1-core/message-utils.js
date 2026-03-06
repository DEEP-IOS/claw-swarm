/**
 * 消息处理工具 / Message Processing Utilities
 *
 * 提供消息文本提取、截断、工具调用解析、时间格式化等通用函数。
 * Provides message text extraction, truncation, tool call parsing,
 * and duration formatting utilities.
 *
 * [WHY] LLM 消息格式多变（string / {content: string} / {content: Array}），
 * 本模块统一处理这些格式差异，为 checkpoint 和 context 服务提供干净的文本提取。
 * LLM message formats vary (string / {content: string} / {content: Array}).
 * This module normalizes these differences, providing clean text extraction
 * for checkpoint and context services.
 *
 * Ported from OME v1.1.0 src/utils/message-utils.js
 *
 * @module message-utils
 * @author DEEP-IOS
 */

/**
 * 截断文本到指定长度，添加省略号
 * Truncate text to maxLen, appending ellipsis if trimmed
 *
 * @param {string} text - 原始文本 / Original text
 * @param {number} maxLen - 最大长度 / Maximum length
 * @returns {string}
 */
export function truncate(text, maxLen) {
  if (!text) return '';
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 3) + '...';
}

/**
 * 从消息对象提取文本内容
 * Extract text content from a message object
 *
 * 处理多种格式 / Handles multiple formats:
 * - string → return as-is
 * - { content: string } → return content
 * - { content: Array<{type, text}> } → find text block
 * - Array<{type, text}> → find text block
 *
 * @param {unknown} msg - 消息对象 / Message object
 * @returns {string}
 */
export function extractMessageText(msg) {
  if (!msg) return '';
  if (typeof msg === 'string') return msg;
  if (typeof msg.content === 'string') return msg.content;
  if (Array.isArray(msg.content)) {
    const textBlock = msg.content.find((c) => c?.type === 'text');
    return textBlock?.text || '';
  }
  if (Array.isArray(msg)) {
    const textBlock = msg.find((c) => c?.type === 'text');
    return textBlock?.text || '';
  }
  return String(msg);
}

/**
 * 从 assistant 消息中提取工具调用信息
 * Extract tool call info from an assistant message
 *
 * 支持 Anthropic (tool_use) 和 OpenAI (tool_call) 格式
 * Supports both Anthropic (tool_use) and OpenAI (tool_call) formats
 *
 * @param {object} msg - assistant 消息 / assistant message
 * @returns {Array<{name: string, params: string}>}
 */
export function extractToolCalls(msg) {
  if (!msg || msg.role !== 'assistant') return [];
  if (!Array.isArray(msg.content)) return [];

  const tools = [];
  for (const block of msg.content) {
    if (block?.type === 'tool_use' || block?.type === 'tool_call') {
      const name = block.name || block.function?.name || 'unknown';
      const params = JSON.stringify(block.input || block.function?.arguments || {});
      tools.push({ name, params });
    }
  }
  return tools;
}

/**
 * 从工具结果消息提取内容
 * Extract content from a tool result message
 *
 * @param {object} msg - tool 消息 / tool message
 * @returns {string}
 */
export function extractToolResult(msg) {
  if (!msg || msg.role !== 'tool') return '';
  return extractMessageText(msg);
}

/**
 * 格式化时间差为可读字符串
 * Format a duration in milliseconds to a human-readable string
 *
 * @param {number} ms - 毫秒数 / Milliseconds
 * @returns {string}
 */
export function formatDuration(ms) {
  if (ms < 60000) return '刚刚 (just now)';
  if (ms < 3600000) return `${Math.round(ms / 60000)} 分钟前 (min ago)`;
  if (ms < 86400000) return `${Math.round(ms / 3600000)} 小时前 (hr ago)`;
  return `${Math.round(ms / 86400000)} 天前 (days ago)`;
}

/**
 * 获取今天的日期字符串
 * Get today's date as YYYY-MM-DD string
 *
 * @returns {string}
 */
export function todayStr() {
  return new Date().toISOString().split('T')[0];
}
