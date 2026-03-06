/**
 * AgentStateService — Agent 状态管理服务 / Agent State Management Service
 *
 * 管理内存中的 agent 状态（跨 hook 保持）。
 * Manages in-memory agent state (persisted across hooks).
 *
 * [WHY] 每个 agent 在一次会话中会经历多个 hook 调用（before_tool, after_tool 等），
 * 需要一个轻量的内存 Map 来跨 hook 保持状态，直到 checkpoint 被持久化到 DB。
 * Each agent goes through multiple hook calls (before_tool, after_tool, etc.) within a session;
 * a lightweight in-memory Map is needed to persist state across hooks until checkpoint is saved to DB.
 *
 * 本模块无 DB 依赖，纯内存操作。
 * This module has no DB dependency — pure in-memory operations.
 *
 * @module agent-state-service
 * @author DEEP-IOS
 */

/**
 * @typedef {{
 *   recentMessages: Array<{role: string, content: string, ts: number}>,
 *   recentToolCalls: Array<{name: string, params: string, result?: string, ts: number}>,
 *   modifiedFiles: Set<string>,
 *   turnCount: number,
 *   lastUserMessage: string,
 *   sessionId: string | null,
 * }} AgentState
 */

/** @type {Map<string, AgentState>} */
const agentStates = new Map();

/**
 * 获取或创建 agent 状态 / Get or create agent state
 * @param {string} agentId - agent 标识 / agent identifier
 * @returns {AgentState}
 */
export function getAgentState(agentId) {
  if (!agentStates.has(agentId)) {
    agentStates.set(agentId, createEmptyState());
  }
  return agentStates.get(agentId);
}

/**
 * 重置 agent 状态 / Reset agent state
 * @param {string} agentId - agent 标识 / agent identifier
 */
export function resetAgentState(agentId) {
  agentStates.set(agentId, createEmptyState());
}

/**
 * 删除 agent 状态 / Delete agent state
 * @param {string} agentId - agent 标识 / agent identifier
 */
export function deleteAgentState(agentId) {
  agentStates.delete(agentId);
}

/**
 * 获取所有有活动的 agent ID / Get all active agent IDs
 * @returns {Array<string>}
 */
export function getActiveAgentIds() {
  return Array.from(agentStates.keys()).filter((id) => {
    const state = agentStates.get(id);
    return state && state.turnCount > 0;
  });
}

/**
 * 遍历所有 agent 状态 / Iterate over all agent states
 * @param {function} callback - (agentId, state) => void
 */
export function forEachAgentState(callback) {
  for (const [agentId, state] of agentStates) {
    callback(agentId, state);
  }
}

/**
 * 追踪用户消息 / Track user message
 * @param {string} agentId - agent 标识 / agent identifier
 * @param {string} content - 消息内容 / message content
 * @param {object} config  - 全局配置 / global config
 */
export function trackUserMessage(agentId, content, config) {
  const state = getAgentState(agentId);
  state.lastUserMessage = content;
  state.recentMessages.push({
    role: "user",
    content: content.slice(0, config.maxMsgChars),
    ts: Date.now(),
  });

  // 保持窗口大小 / Maintain sliding window size
  if (state.recentMessages.length > config.maxRecentMsgs * 4) {
    state.recentMessages = state.recentMessages.slice(-config.maxRecentMsgs * 2);
  }
}

/**
 * 追踪助手消息 / Track assistant message
 * @param {string} agentId - agent 标识 / agent identifier
 * @param {string} content - 消息内容 / message content
 * @param {object} config  - 全局配置 / global config
 */
export function trackAssistantMessage(agentId, content, config) {
  const state = getAgentState(agentId);
  state.recentMessages.push({
    role: "assistant",
    content: content.slice(0, config.maxMsgChars),
    ts: Date.now(),
  });

  if (state.recentMessages.length > config.maxRecentMsgs * 4) {
    state.recentMessages = state.recentMessages.slice(-config.maxRecentMsgs * 2);
  }
}

/**
 * 追踪工具调用 / Track tool call
 * @param {string}        agentId  - agent 标识 / agent identifier
 * @param {string}        toolName - 工具名 / tool name
 * @param {object}        params   - 工具参数 / tool parameters
 * @param {string|object} result   - 工具结果 / tool result
 * @param {string}        [error]  - 错误信息 / error message
 * @param {object}        config   - 全局配置 / global config
 */
export function trackToolCall(agentId, toolName, params, result, error, config) {
  const state = getAgentState(agentId);

  const resultStr = error
    ? `Error: ${error}`
    : typeof result === "string"
      ? result
      : JSON.stringify(result || "");

  state.recentToolCalls.push({
    name: toolName || "unknown",
    params: JSON.stringify(params || {}).slice(0, 200),
    result: resultStr.slice(0, 300),
    ts: Date.now(),
  });

  if (state.recentToolCalls.length > config.maxRecentTools * 2) {
    state.recentToolCalls = state.recentToolCalls.slice(-config.maxRecentTools);
  }

  // 追踪修改的文件 / Track modified files
  const filePath = params?.filePath || params?.path || params?.file || params?.target;
  if (filePath && typeof filePath === "string") {
    state.modifiedFiles.add(filePath);
  }
}

/**
 * 增加轮次计数 / Increment turn count
 * @param {string} agentId - agent 标识 / agent identifier
 * @returns {number} 新的计数 / new count
 */
export function incrementTurnCount(agentId) {
  const state = getAgentState(agentId);
  state.turnCount += 1;
  return state.turnCount;
}

/**
 * 更新 session ID / Update session ID
 * @param {string} agentId   - agent 标识 / agent identifier
 * @param {string} sessionId - 会话 ID / session ID
 */
export function updateSessionId(agentId, sessionId) {
  const state = getAgentState(agentId);
  state.sessionId = sessionId;
}

/**
 * 创建空状态 / Create empty state
 * @returns {AgentState}
 */
function createEmptyState() {
  return {
    recentMessages: [],
    recentToolCalls: [],
    modifiedFiles: new Set(),
    turnCount: 0,
    lastUserMessage: "",
    sessionId: null,
  };
}
