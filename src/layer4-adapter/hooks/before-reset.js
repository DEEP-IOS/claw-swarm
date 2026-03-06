/**
 * before_reset Hook — 会话重置前钩子 / Before Reset Hook
 *
 * 会话重置前清理指定 Agent 的内存状态，
 * 防止陈旧数据污染新会话。
 *
 * Clears in-memory agent state for the specified agent before session reset,
 * preventing stale data from contaminating the new session.
 *
 * [WHY] 会话重置意味着用户希望从干净状态重新开始。
 * 如果不在此钩子中清除旧的 Agent 状态，新会话可能会继承
 * 过期的工具调用历史或错误的进度信息，导致不可预期的行为。
 * A session reset signals the user wants a fresh start.
 * Without clearing old agent state in this hook, the new session could
 * inherit stale tool-call history or incorrect progress information,
 * leading to unpredictable behavior.
 *
 * @module hooks/before-reset
 * @author DEEP-IOS
 */
export function handleBeforeReset(event, ctx, engines, config, logger) {
  const agentId = ctx?.agentId || event?.agentId || 'main';

  // Clear in-memory agent state for this agent
  // agent-state-service exports deleteAgentState as a function
  if (config.memory?.enabled && engines.agentState) {
    try {
      engines.agentState.deleteAgentState(agentId);
      logger.debug(`Agent state cleared for ${agentId}`);
    } catch (err) {
      logger.warn('State clear on reset failed:', err.message);
    }
  }
}
