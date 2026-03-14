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
 * @version 5.5.0
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

  // ── V5.3: 蜂群决策赋能 / Swarm decision empowerment ──
  SWARM_ADVISORY_INJECTED: 'swarm.advisory.injected',

  // ── V5.4: 证据纪律 / Evidence discipline ──
  EVIDENCE_CLAIM_REGISTERED: 'evidence.claim.registered',
  EVIDENCE_CLAIM_EVALUATED: 'evidence.claim.evaluated',

  // ── V5.4: 协议语义 / Protocol semantics ──
  PROTOCOL_MESSAGE_SENT: 'protocol.message.sent',

  // ── V5.4: 预算追踪 / Budget tracking ──
  BUDGET_TURN_COMPLETED: 'budget.turn.completed',

  // ── V5.5: 修复回流 / Repair feedback loop ──
  REPAIR_STRATEGY_FOUND: 'repair.strategy.found',
  REPAIR_STRATEGY_OUTCOME: 'repair.strategy.outcome',

  // ── V5.5: 任务亲和度 / Task affinity ──
  TASK_AFFINITY_UPDATED: 'task.affinity.updated',

  // ── V5.5: 仲裁降级 / Arbiter degradation ──
  ARBITER_MODE_DEGRADED: 'arbiter.mode.degraded',

  // ── V5.5: 基准自调整 / Baseline adjustment ──
  BASELINE_ADJUSTED: 'baseline.adjusted',

  // ── V5.5: 状态收敛 / State convergence ──
  CONVERGENCE_DRIFT: 'convergence.drift',
  AGENT_SUSPECT: 'agent.suspect',
  AGENT_CONFIRMED_DEAD: 'agent.confirmed.dead',

  // ── V5.5: 全局调节器 / Global modulator ──
  MODE_SWITCHED: 'modulator.mode.switched',

  // ── V5.5: 治理报告 / Governance report ──
  GOVERNANCE_REPORT: 'governance.report',

  // ── V5.6: 结构化编排 / Structured orchestration ──
  SPECULATIVE_TASK_STARTED: 'speculative.task.started',
  SPECULATIVE_TASK_RESOLVED: 'speculative.task.resolved',
  SPECULATIVE_TASK_CANCELLED: 'speculative.task.cancelled',
  WORK_STEAL_COMPLETED: 'work.steal.completed',
  PIPELINE_PARTIAL_RESULT: 'pipeline.partial_result',
  DAG_BRIDGE_ACTIVATED: 'dag.bridge.activated',

  // ── V5.7: 共生技能调度 / Skill symbiosis scheduling ──
  SYMBIOSIS_COLLABORATION_RECORDED: 'symbiosis.collaboration.recorded',
  SYMBIOSIS_PARTNER_RECOMMENDED: 'symbiosis.partner.recommended',

  // ── V5.7: 多类型信息素 / Multi-type pheromones ──
  PHEROMONE_TYPE_REGISTERED: 'pheromone.type.registered',
  PHEROMONE_FOOD_ATTRACTION: 'pheromone.food.attraction',

  // ── V6.0: 休眠模块激活 / Dormant module activation ──
  SKILL_RECOMMENDATION_INJECTED: 'skill.recommendation.injected',
  EVOLUTION_CLUSTER_FORMED: 'evolution.cluster.formed',
  DEAD_LETTER_RETRIED: 'task.dead_letter.retried',
  DEAD_LETTER_EXHAUSTED: 'task.dead_letter.exhausted',
  CIRCUIT_BREAKER_RESTORED: 'circuit_breaker.restored',
  TRACE_BOTTLENECK_DETECTED: 'trace.bottleneck.detected',

  // ── V6.0: 自适应闭环 / Adaptive closed-loop ──
  SIGNAL_WEIGHTS_CALIBRATED: 'signal.weights.calibrated',
  SIGNAL_CALIBRATOR_PHASE_CHANGED: 'signal.calibrator.phase_changed',
  FAILURE_MODE_CLASSIFIED: 'failure.mode.classified',
  FAILURE_TREND_ALERT: 'failure.trend.alert',
  BUDGET_EXHAUSTION_WARNING: 'budget.exhaustion.warning',
  METRICS_ALERT_TRIGGERED: 'metrics.alert.triggered',
  AGENT_STATE_CHANGED: 'agent.state.changed',
  REPUTATION_DECAYED: 'reputation.decayed',

  // ── V6.0: 向量检索 + swarm base / Vector retrieval + swarm base ──
  VECTOR_INDEX_UPDATED: 'vector.index.updated',
  HYBRID_RETRIEVAL_EXECUTED: 'hybrid.retrieval.executed',
  EMBEDDING_MODEL_LOADED: 'embedding.model.loaded',
  SHAPLEY_CREDIT_COMPUTED: 'shapley.credit.computed',
  SNA_METRICS_UPDATED: 'sna.metrics.updated',
  DUAL_PROCESS_ROUTED: 'dual_process.routed',

  // ── V6.0: Worker 池 / Worker pool ──
  WORKER_TASK_COMPLETED: 'worker.task.completed',
  WORKER_POOL_RESIZED: 'worker.pool.resized',

  // ── V6.2: 冲突解决 + 共识投票 / Conflict resolution + consensus voting ──
  CONFLICT_DETECTED: 'conflict.detected',
  CONFLICT_RESOLVED: 'conflict.resolved',
  CONFLICT_ESCALATED: 'conflict.escalated',
  CONSENSUS_VOTE_STARTED: 'consensus.vote.started',
  CONSENSUS_VOTE_COMPLETED: 'consensus.vote.completed',

  // ── V6.2: Agent 生命周期 / Agent lifecycle ──
  AGENT_LIFECYCLE_TRANSITION: 'agent.lifecycle.transition',

  // ── V6.2: 记忆巩固 / Memory consolidation ──
  MEMORY_PATTERN_EXTRACTED: 'memory.pattern.extracted',

  // ── V6.2: 异常检测 / Anomaly detection ──
  ANOMALY_DETECTED: 'anomaly.detected',
  ANOMALY_BASELINE_UPDATED: 'anomaly.baseline.updated',

  // ── V6.2: Gossip 同步 / Gossip sync ──
  GOSSIP_SYNC_MERGED: 'gossip.sync.merged',

  // ── V6.2: 寄生检测 / Parasite detection ──
  PARASITE_DETECTED: 'parasite.detected',

  // ── V6.2: Zone 选举 / Zone election ──
  ZONE_LEADER_ELECTED: 'zone.leader.elected',
  ZONE_LEADER_DEMOTED: 'zone.leader.demoted',

  // ── V6.3: 工具精简 + Relay + 级联 / Tool consolidation + Relay + Cascade ──
  RELAY_SPAWN_REQUESTED: 'relay.spawn.requested',
  RELAY_SPAWN_COMPLETED: 'relay.spawn.completed',
  RELAY_SPAWN_FAILED: 'relay.spawn.failed',
  AUTO_QUALITY_GATE: 'auto.quality.gate',
  AUTO_SHAPLEY_CREDIT: 'auto.shapley.credit',
  AUTO_MEMORY_WRITE: 'auto.memory.write',
  AUTO_PHEROMONE_FEEDBACK: 'auto.pheromone.feedback',
  CONTEXT_INJECTION_GATED: 'context.injection.gated',
  MODEL_BID_AWARDED: 'model.bid.awarded',
  COLD_START_PHASE_COMPLETED: 'coldstart.phase.completed',
  DAG_PHASE_CASCADE: 'dag.phase.cascade',
  PROGRESS_UPDATE_PUSHED: 'progress.update.pushed',

  // ── V7.0: 闭环执行 / Closed-loop actuation ──
  SESSION_PATCHED: 'session.patched',
  PI_CONTROLLER_ACTUATED: 'pi.controller.actuated',
  CROSS_AGENT_KNOWLEDGE_TRANSFERRED: 'cross_agent.knowledge.transferred',
  COMMUNICATION_SENSED: 'communication.sensed',
  SPECIES_CONFIG_APPLIED: 'species.config.applied',
  LIVE_CFP_COMPLETED: 'live.cfp.completed',
  SPECULATION_REAL_SPAWNED: 'speculation.real.spawned',
  NEGATIVE_SELECTION_TRIGGERED: 'negative_selection.triggered',
  BUDGET_DEGRADATION_APPLIED: 'budget.degradation.applied',
  DREAM_CONSOLIDATION_COMPLETED: 'dream.consolidation.completed',
  EVIDENCE_GATE_REJECTED: 'evidence.gate.rejected',
  PERSONA_EVOLUTION_PROMOTED: 'persona.evolution.promoted',
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
