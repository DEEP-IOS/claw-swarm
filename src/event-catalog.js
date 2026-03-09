/**
 * Claw-Swarm V5.1 — 统一事件目录 / Unified Event Catalog
 *
 * 所有 MessageBus 事件主题和 payload 类型的权威定义。
 * Authoritative definitions for all MessageBus event topics and payload types.
 *
 * 设计原则 / Design principles:
 *   - 每个事件必须包含 eventId, topic, timestamp, source, payload, _meta
 *   - 所有模块必须通过 wrapEvent() 发布事件，确保格式一致
 *   - Schema 校验仅做 typeof 检查（不用 AJV），保持零开销
 *
 * @module event-catalog
 * @version 5.1.0
 */

import { randomUUID } from 'node:crypto';

// ============================================================================
// 事件主题枚举 / Event Topic Enum
// ============================================================================

/** @enum {string} */
export const EventTopics = {
  // ── Agent 生命周期 / Agent lifecycle ──
  AGENT_REGISTERED: 'agent.registered',
  AGENT_ONLINE: 'agent.online',
  AGENT_OFFLINE: 'agent.offline',
  AGENT_END: 'agent.end',

  // ── 任务生命周期 / Task lifecycle ──
  TASK_CREATED: 'task.created',
  TASK_AVAILABLE: 'task.available',
  TASK_ASSIGNED: 'task.assigned',
  TASK_COMPLETED: 'task.completed',
  TASK_FAILED: 'task.failed',
  TASK_PARTIAL_RESULT: 'task.partial_result',
  TASK_UPSTREAM_FAILED: 'task.upstream_failed',
  TASK_DEAD_LETTER: 'task.dead_letter',

  // ── 工具调用 / Tool calls ──
  TOOL_FAILURE: 'tool.failure',
  TOOL_COERCION_EXCESSIVE: 'tool.coercion.excessive',

  // ── 信息素 / Pheromone ──
  PHEROMONE_DEPOSITED: 'pheromone.deposited',
  PHEROMONE_DECAYED: 'pheromone.decayed',

  // ── 系统 / System ──
  SYSTEM_HEALTH: 'system.health',
  SYSTEM_ERROR: 'system.error',
  SYSTEM_DANGER: 'system.danger',

  // ── 能力 + 进化 / Capability + Evolution ──
  CAPABILITY_UPDATED: 'capability.updated',
  PERSONA_EVOLVED: 'persona.evolved',
  SPECIES_PROPOSED: 'species.proposed',
  SPECIES_RETIRED: 'species.retired',

  // ── 编排 / Orchestration ──
  DAG_CREATED: 'dag.created',
  DAG_COMPLETED: 'dag.completed',

  // ── Skill / Skills ──
  SKILL_USED: 'skill.used',
  SKILL_RECOMMENDED: 'skill.recommended',

  // ── 追踪 / Tracing ──
  TRACE_SPAN: 'trace.span',

  // ── V5.2: 信息素增强 / Pheromone enhancements ──
  PHEROMONE_ESCALATED: 'pheromone.escalated',
  PHEROMONE_RESPONSE_TRIGGERED: 'pheromone.response.triggered',

  // ── V5.2: 系统启动 / System startup ──
  SYSTEM_STARTUP: 'system.startup',

  // ── V5.2: 断路器 / Circuit breaker ──
  CIRCUIT_BREAKER_TRANSITION: 'circuit_breaker.transition',

  // ── V5.2: 公告板 / Stigmergic board ──
  STIGMERGIC_POST_CREATED: 'stigmergic.post.created',
  STIGMERGIC_POST_EXPIRED: 'stigmergic.post.expired',

  // ── V5.2: 免疫记忆 / Failure vaccination ──
  FAILURE_VACCINE_CREATED: 'failure.vaccine.created',
  FAILURE_VACCINE_APPLIED: 'failure.vaccine.applied',

  // ── V5.2: 响应阈值 / Response threshold ──
  THRESHOLD_ADJUSTED: 'threshold.adjusted',
  THRESHOLD_TRIGGERED: 'threshold.triggered',
};

// ============================================================================
// 事件包装器 / Event Wrapper
// ============================================================================

/**
 * 将裸 payload 包装为统一事件格式
 * Wrap raw payload into unified event format
 *
 * @param {string} topic - 事件主题 / Event topic
 * @param {Object} payload - 业务数据 / Business data
 * @param {string} source - 发布者标识 / Publisher identifier
 * @param {Object} [options] - 可选配置 / Optional config
 * @param {string} [options.traceId] - 分布式追踪 ID
 * @param {number} [options.priority] - 事件优先级（SSE 排序用）
 * @returns {Object} 标准化事件 / Standardized event
 */
export function wrapEvent(topic, payload, source, options = {}) {
  return {
    eventId: randomUUID(),
    topic,
    timestamp: Date.now(),
    source,
    traceId: options.traceId || undefined,
    payload: payload || {},
    _meta: {
      version: '5.1',
      priority: options.priority ?? 0,
    },
  };
}

/**
 * 轻量校验事件格式 (仅 typeof 检查)
 * Lightweight event format validation (typeof checks only)
 *
 * @param {Object} event - 待校验事件 / Event to validate
 * @returns {{ valid: boolean, reason?: string }}
 */
export function validateEvent(event) {
  if (!event || typeof event !== 'object') {
    return { valid: false, reason: 'event is not an object' };
  }
  if (typeof event.topic !== 'string' || event.topic.length === 0) {
    return { valid: false, reason: 'topic must be a non-empty string' };
  }
  if (typeof event.timestamp !== 'number') {
    return { valid: false, reason: 'timestamp must be a number' };
  }
  if (typeof event.source !== 'string') {
    return { valid: false, reason: 'source must be a string' };
  }
  return { valid: true };
}

/**
 * 将 V5.0 裸 payload 事件自动包装为 V5.1 格式（向后兼容）
 * Auto-wrap V5.0 bare payload events into V5.1 format (backward compatibility)
 *
 * @param {string} topic - 事件主题
 * @param {Object} data - 可能是 V5.0 裸 payload 或 V5.1 标准格式
 * @param {string} [defaultSource='legacy'] - 默认来源
 * @returns {Object} V5.1 标准格式事件
 */
export function ensureV51Format(topic, data, defaultSource = 'legacy') {
  // 已经是 V5.1 格式
  if (data?._meta?.version === '5.1') {
    return data;
  }
  // V5.0 裸 payload → 包装
  return wrapEvent(topic, data, defaultSource);
}
