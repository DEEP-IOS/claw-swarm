/**
 * ContextService — 上下文构建服务 / Context Building Service
 *
 * 为指定 agent 构建 prependContext 字符串，用于恢复记忆上下文。
 * Builds prependContext string for a given agent to restore memory context.
 *
 * [WHY] 当 agent 恢复会话时，需要一段精简的"记忆摘要"注入到 system prompt 前面，
 * 让 LLM 快速回忆之前的工作进度。本服务按优先级组装 summary / mechanical / D1 记忆。
 * When an agent resumes a session, a concise "memory summary" needs to be injected
 * before the system prompt so the LLM can quickly recall previous work progress.
 * This service assembles summary / mechanical / D1 memories by priority.
 *
 * @module context-service
 * @author DEEP-IOS
 */

import { getLatestCheckpoint, readMemories } from "../../layer1-core/db.js";
import { truncate, formatDuration } from "../../layer1-core/message-utils.js";

/**
 * 为指定 agent 构建 prependContext
 * Build prependContext for a given agent
 *
 * 优先使用 summary，降级使用 mechanical
 * Prefers summary, falls back to mechanical
 *
 * @param {string} agentId - agent 标识 / agent identifier
 * @param {object} config  - 全局配置 / global config
 * @returns {string | null}
 */
export function buildPrependContext(agentId, config) {
  const checkpoint = getLatestCheckpoint(agentId);
  if (!checkpoint) return null;

  const parts = [];
  const age = Date.now() - checkpoint.created_at;

  parts.push(`[OME 记忆恢复 — 上次活动: ${formatDuration(age)}]`);

  // Summary 部分（Phase 2 会填充）/ Summary section (Phase 2 will populate)
  if (checkpoint.summary) {
    appendSummaryParts(parts, checkpoint.summary);
  }

  // Mechanical 部分（保底）/ Mechanical section (fallback)
  if (checkpoint.mechanical) {
    appendMechanicalParts(parts, checkpoint.mechanical, config);
  }

  // 最近的 D1 记忆 / Recent D1 memories
  appendRecentMemories(parts, agentId, config);

  const result = parts.join("\n");

  // 预算控制 / Budget control
  if (result.length > config.maxPrependChars) {
    return result.slice(0, config.maxPrependChars - 3) + "...";
  }

  return result;
}

/**
 * 添加 Summary 部分 / Append summary parts
 */
function appendSummaryParts(parts, summary) {
  if (summary.current_goal) {
    parts.push(`目标: ${summary.current_goal}`);
  }
  if (summary.progress_summary) {
    parts.push(`进度: ${summary.progress_summary}`);
  }
  if (summary.immediate_next) {
    parts.push(`下一步: ${summary.immediate_next}`);
  }
  if (summary.key_findings) {
    const findings = Array.isArray(summary.key_findings)
      ? summary.key_findings.join("; ")
      : summary.key_findings;
    parts.push(`关键发现: ${findings}`);
  }
}

/**
 * 添加 Mechanical 部分 / Append mechanical parts
 */
function appendMechanicalParts(parts, m, config) {
  if (m.last_user_message) {
    parts.push(`用户最后说: "${truncate(m.last_user_message, 200)}"`);
  }

  if (m.recent_messages?.length > 0) {
    parts.push("最近对话:");
    for (const msg of m.recent_messages.slice(-4)) {
      const roleLabel = msg.role === "user" ? "用户" : "助手";
      parts.push(`  ${roleLabel}: ${truncate(msg.content, 150)}`);
    }
  }

  if (m.recent_tool_calls?.length > 0) {
    parts.push("最近工具调用:");
    for (const tc of m.recent_tool_calls.slice(-3)) {
      const resultStr = tc.result ? ` → ${truncate(tc.result, 80)}` : "";
      parts.push(`  - ${tc.name}(${truncate(tc.params, 100)})${resultStr}`);
    }
  }

  if (m.modified_files?.length > 0) {
    parts.push(`已修改文件: ${m.modified_files.slice(-5).join(", ")}`);
  }
}

/**
 * 添加最近的 D1 记忆 / Append recent D1 memories
 */
function appendRecentMemories(parts, agentId, config) {
  try {
    const memories = readMemories({
      scope: `/agent/${agentId}`,
      layer: "D1",
      limit: 3,
    });

    if (memories.length > 0) {
      parts.push("最近记忆:");
      for (const mem of memories) {
        parts.push(`  - ${truncate(mem.content, 150)}`);
      }
    }
  } catch (err) {
    // 记忆读取失败不阻断主流程 / Memory read failure should not block main flow
    parts.push("  [记忆读取失败]");
  }
}
