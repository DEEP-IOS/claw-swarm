/**
 * V9 事件目录 — 27+ 事件主题常量，按领域组织
 * Event catalog — 27+ event topic constants organized by domain
 * @module core/bus/event-catalog
 */

// --- core/field 场核心 ---
export const FIELD_SIGNAL_EMITTED   = 'field.signal.emitted';
export const FIELD_GC_COMPLETED     = 'field.gc.completed';
export const FIELD_EMERGENCY_GC     = 'field.emergency_gc';

// --- core/store 状态存储 ---
export const STORE_SNAPSHOT_COMPLETED = 'store.snapshot.completed';
export const STORE_RESTORE_COMPLETED  = 'store.restore.completed';

// --- communication 通信层 (R1+) ---
export const CHANNEL_CREATED       = 'channel.created';
export const CHANNEL_CLOSED        = 'channel.closed';
export const CHANNEL_MESSAGE       = 'channel.message';
export const PHEROMONE_DEPOSITED   = 'pheromone.deposited';
export const PHEROMONE_EVAPORATED  = 'pheromone.evaporated';

// --- intelligence 智能层 (R2+) ---
export const AGENT_SPAWNED         = 'agent.lifecycle.spawned';
export const AGENT_READY           = 'agent.lifecycle.ready';
export const AGENT_COMPLETED       = 'agent.lifecycle.completed';
export const AGENT_FAILED          = 'agent.lifecycle.failed';
export const AGENT_ENDED           = 'agent.lifecycle.ended';
export const MEMORY_RECORDED       = 'memory.episode.recorded';
export const MEMORY_CONSOLIDATED   = 'memory.consolidated';

// --- orchestration 编排层 (R4+) ---
export const TASK_CREATED          = 'task.created';
export const TASK_COMPLETED        = 'task.completed';
export const DAG_STATE_CHANGED     = 'dag.state.changed';
export const SPAWN_ADVISED         = 'spawn.advised';
export const REPUTATION_UPDATED    = 'reputation.updated';

// --- quality 质量层 (R6+) ---
export const GATE_PASSED           = 'quality.gate.passed';
export const GATE_FAILED           = 'quality.gate.failed';
export const BREAKER_TRIPPED       = 'quality.breaker.tripped';
export const ANOMALY_DETECTED      = 'quality.anomaly.detected';
export const COMPLIANCE_VIOLATION  = 'quality.compliance.violation';

// --- observe 可观测层 (R7+) ---
export const METRICS_COLLECTED     = 'observe.metrics.collected';

/**
 * 完整事件目录，含描述与负载类型
 * Complete catalog with descriptions and payload types
 */
export const EVENT_CATALOG = Object.freeze({
  [FIELD_SIGNAL_EMITTED]:    { description: '信号已释放到场中 / Signal emitted to field', payload: 'Signal' },
  [FIELD_GC_COMPLETED]:      { description: '场垃圾回收完成 / Field garbage collection completed', payload: '{ collected: number, remaining: number }' },
  [FIELD_EMERGENCY_GC]:      { description: '场紧急垃圾回收 / Field emergency garbage collection triggered', payload: '{ reason: string, freed: number }' },

  [STORE_SNAPSHOT_COMPLETED]: { description: '状态快照已完成 / State snapshot completed', payload: '{ snapshotId: string, size: number }' },
  [STORE_RESTORE_COMPLETED]:  { description: '状态恢复已完成 / State restore completed', payload: '{ snapshotId: string, restoredKeys: number }' },

  [CHANNEL_CREATED]:         { description: '通信通道已创建 / Communication channel created', payload: '{ channelId: string, type: string }' },
  [CHANNEL_CLOSED]:          { description: '通信通道已关闭 / Communication channel closed', payload: '{ channelId: string, reason: string }' },
  [CHANNEL_MESSAGE]:         { description: '通道消息 / Channel message received', payload: '{ channelId: string, from: string, message: any }' },
  [PHEROMONE_DEPOSITED]:     { description: '信息素已沉积 / Pheromone deposited', payload: '{ trailId: string, type: string, intensity: number }' },
  [PHEROMONE_EVAPORATED]:    { description: '信息素已蒸发 / Pheromone evaporated', payload: '{ trailId: string, remaining: number }' },

  [AGENT_SPAWNED]:           { description: '代理已孵化 / Agent spawned', payload: '{ agentId: string, species: string }' },
  [AGENT_READY]:             { description: '代理就绪 / Agent ready', payload: '{ agentId: string }' },
  [AGENT_COMPLETED]:         { description: '代理任务完成 / Agent task completed', payload: '{ agentId: string, result: any }' },
  [AGENT_FAILED]:            { description: '代理失败 / Agent failed', payload: '{ agentId: string, error: string }' },
  [AGENT_ENDED]:             { description: '代理生命周期结束 / Agent lifecycle ended', payload: '{ agentId: string, reason: string }' },
  [MEMORY_RECORDED]:         { description: '情节记忆已记录 / Episode memory recorded', payload: '{ agentId: string, episodeId: string }' },
  [MEMORY_CONSOLIDATED]:     { description: '记忆已整合 / Memory consolidated', payload: '{ agentId: string, consolidated: number }' },

  [TASK_CREATED]:            { description: '任务已创建 / Task created', payload: '{ taskId: string, type: string }' },
  [TASK_COMPLETED]:          { description: '任务已完成 / Task completed', payload: '{ taskId: string, result: any }' },
  [DAG_STATE_CHANGED]:       { description: 'DAG 状态变更 / DAG state changed', payload: '{ dagId: string, state: string }' },
  [SPAWN_ADVISED]:           { description: '建议孵化新代理 / Spawn advised', payload: '{ species: string, reason: string }' },
  [REPUTATION_UPDATED]:      { description: '声誉已更新 / Reputation updated', payload: '{ agentId: string, score: number, delta: number }' },

  [GATE_PASSED]:             { description: '质量门通过 / Quality gate passed', payload: '{ gateId: string, score: number }' },
  [GATE_FAILED]:             { description: '质量门未通过 / Quality gate failed', payload: '{ gateId: string, score: number, threshold: number }' },
  [BREAKER_TRIPPED]:         { description: '熔断器触发 / Circuit breaker tripped', payload: '{ breakerId: string, failures: number }' },
  [ANOMALY_DETECTED]:        { description: '异常已检测 / Anomaly detected', payload: '{ type: string, severity: string, details: any }' },
  [COMPLIANCE_VIOLATION]:    { description: '合规违规 / Compliance violation detected', payload: '{ rule: string, agentId: string, details: string }' },

  [METRICS_COLLECTED]:       { description: '指标已收集 / Metrics collected', payload: '{ timestamp: number, metrics: object }' },
});
