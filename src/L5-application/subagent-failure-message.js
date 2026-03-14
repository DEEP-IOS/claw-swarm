'use strict';

/**
 * Extract a user-readable failure reason from subagent ended event.
 * 从子代理结束事件中提取用户可读的失败原因。
 * Priority / 优先级:
 * 1) event.error (string or error.message / 字符串或 error.message)
 * 2) event.result.error / event.result.message (结果中的错误)
 * 3) event.reason (原因字段)
 * 4) event.result (string, for failed outcome / 字符串型失败结果)
 * 5) fallback (兜底值)
 */
export function extractSubagentFailureReason(event, fallback = '子代理执行未完成') {
  const eventError = typeof event?.error === 'string'
    ? event.error
    : (event?.error?.message || null);

  if (eventError && eventError.trim()) {
    return eventError.trim();
  }

  const resultError = (event?.result && typeof event.result === 'object')
    ? (event.result.error || event.result.message)
    : null;
  if (typeof resultError === 'string' && resultError.trim()) {
    return resultError.trim();
  }

  if (typeof event?.reason === 'string' && event.reason.trim()) {
    return event.reason.trim();
  }

  if (typeof event?.result === 'string' && event.result.trim()) {
    return event.result.substring(0, 500).trim();
  }

  return fallback;
}

function classifyFailure(reason) {
  const r = String(reason || '').toLowerCase();
  if (/timeout|timed out|deadline|超时/.test(r)) return 'timeout';
  if (/network|socket|ws closed|connect|econn|enotfound|断连|连接/.test(r)) return 'network';
  if (/permission|forbidden|denied|unauthorized|权限/.test(r)) return 'permission';
  if (/not found|missing|不存在|未找到/.test(r)) return 'not_found';
  return 'general';
}

function buildSuggestion(kind) {
  switch (kind) {
    case 'timeout':
      return '建议: 任务可能过大，可拆分后重试，或降低一次性输出规模。';
    case 'network':
      return '建议: 检查 Gateway/网络连接后重试。';
    case 'permission':
      return '建议: 检查当前会话权限或代理工具白名单配置。';
    case 'not_found':
      return '建议: 检查引用的资源/路径是否存在。';
    default:
      return '建议: 可以尝试简化任务描述或拆分为更小的子任务。';
  }
}

export function summarizeFailureContext(event) {
  const parts = [];
  if (event?.agentId) parts.push(`agent=${event.agentId}`);
  if (event?.childSessionKey) parts.push(`session=${event.childSessionKey}`);
  if (event?.outcome) parts.push(`outcome=${event.outcome}`);
  if (event?.stopReason) parts.push(`stopReason=${event.stopReason}`);
  return parts.length > 0 ? parts.join(' | ') : 'context=unavailable';
}

export function buildSubagentFailureMessage({ taskId, roleName, event }) {
  const reason = extractSubagentFailureReason(event);
  const suggestion = buildSuggestion(classifyFailure(reason));
  const context = summarizeFailureContext(event);
  return `[蜂群任务失败 | taskId: ${taskId || 'unknown'} | 角色: ${roleName || 'worker'}]\n\n原因: ${reason}\n上下文: ${context}\n\n${suggestion}`;
}
