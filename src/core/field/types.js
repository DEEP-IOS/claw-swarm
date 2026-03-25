/**
 * V9 信号场类型定义与 12 维度常量
 * Signal field type definitions and 12 dimension constants
 *
 * 信号场是 V9 蜂群通信的核心抽象，每个信号携带一个维度标签和强度值，
 * 所有信号在统一的 12 维空间中进行叠加、衰减和读取。
 * The signal field is the core abstraction for V9 swarm communication.
 * Each signal carries a dimension label and strength value; all signals
 * are superposed, decayed, and read in a unified 12-dimensional space.
 *
 * @module core/field/types
 * @version 9.0.0
 */

// ============================================================================
// 12 维度常量 / 12 Dimension Constants
// ============================================================================

/** 路径信息素 / Trail pheromone — agent 移动和任务路径 */
export const DIM_TRAIL       = 'trail'
/** 警报信号 / Alarm signal — 异常、错误、紧急事件 */
export const DIM_ALARM       = 'alarm'
/** 声誉信号 / Reputation signal — agent 可信度和表现评分 */
export const DIM_REPUTATION  = 'reputation'
/** 任务信号 / Task signal — 任务发布、进度、完成 */
export const DIM_TASK        = 'task'
/** 知识信号 / Knowledge signal — 知识发现、共享、蒸馏 */
export const DIM_KNOWLEDGE   = 'knowledge'
/** 协调信号 / Coordination signal — 多代理协作、同步 */
export const DIM_COORDINATION = 'coordination'
/** 情绪信号 / Emotion signal — agent 情绪状态、压力指示 */
export const DIM_EMOTION     = 'emotion'
/** 信任信号 / Trust signal — 代理间信任关系 */
export const DIM_TRUST       = 'trust'
/** 社交网络分析信号 / SNA signal — 网络拓扑、中心度 */
export const DIM_SNA         = 'sna'
/** 学习信号 / Learning signal — 经验习得、技能提升 */
export const DIM_LEARNING    = 'learning'
/** 校准信号 / Calibration signal — 系统参数校准、调优 */
export const DIM_CALIBRATION = 'calibration'
/** 种群信号 / Species signal — 种群进化、变异、淘汰 */
export const DIM_SPECIES     = 'species'

/**
 * 全部 12 维度的有序冻结数组
 * Frozen ordered array of all 12 dimensions
 * @type {readonly string[]}
 */
export const ALL_DIMENSIONS = Object.freeze([
  DIM_TRAIL, DIM_ALARM, DIM_REPUTATION, DIM_TASK,
  DIM_KNOWLEDGE, DIM_COORDINATION, DIM_EMOTION, DIM_TRUST,
  DIM_SNA, DIM_LEARNING, DIM_CALIBRATION, DIM_SPECIES,
])

export const FIELD_DIMENSION_DESCRIPTORS = Object.freeze([
  { id: DIM_TRAIL, label: 'Trail', description: 'Execution traces and path-following cues across the swarm.' },
  { id: DIM_ALARM, label: 'Alarm', description: 'Anomaly, failure, and urgency signals requiring attention.' },
  { id: DIM_REPUTATION, label: 'Reputation', description: 'Credibility and performance trust accumulated over time.' },
  { id: DIM_TASK, label: 'Task', description: 'Task creation, progress, and completion pressure in the system.' },
  { id: DIM_KNOWLEDGE, label: 'Knowledge', description: 'Discovered facts, memory recall, and shared learnings.' },
  { id: DIM_COORDINATION, label: 'Coordination', description: 'Multi-agent synchronization, routing, and delegation activity.' },
  { id: DIM_EMOTION, label: 'Emotion', description: 'Affective state and stress-related context from agents.' },
  { id: DIM_TRUST, label: 'Trust', description: 'Inter-agent trust and confidence in outputs or collaborators.' },
  { id: DIM_SNA, label: 'SNA', description: 'Social-network structure and collaboration topology indicators.' },
  { id: DIM_LEARNING, label: 'Learning', description: 'Capability improvement and adaptation gained from outcomes.' },
  { id: DIM_CALIBRATION, label: 'Calibration', description: 'System-tuning and confidence-adjustment signals.' },
  { id: DIM_SPECIES, label: 'Species', description: 'Role evolution and population-level specialization dynamics.' },
])

/**
 * 每个维度的默认衰减率（λ）— 值越大衰减越快
 * Default decay rate (lambda) per dimension — higher = faster decay
 * @type {Readonly<Record<string, number>>}
 */
export const DEFAULT_LAMBDA = Object.freeze({
  [DIM_TRAIL]:        0.008,
  [DIM_ALARM]:        0.15,
  [DIM_REPUTATION]:   0.005,
  [DIM_TASK]:         0.01,
  [DIM_KNOWLEDGE]:    0.003,
  [DIM_COORDINATION]: 0.02,
  [DIM_EMOTION]:      0.1,
  [DIM_TRUST]:        0.006,
  [DIM_SNA]:          0.004,
  [DIM_LEARNING]:     0.002,
  [DIM_CALIBRATION]:  0.01,
  [DIM_SPECIES]:      0.001,
})

/** 信号强度下界 / Signal strength lower bound */
export const SIGNAL_STRENGTH_MIN = 0.0
/** 信号强度上界 / Signal strength upper bound */
export const SIGNAL_STRENGTH_MAX = 1.0
/** 默认过期阈值 — 低于此值视为已过期 / Default expiry threshold */
export const DEFAULT_EXPIRED_THRESHOLD = 0.001

// ============================================================================
// JSDoc 类型定义 / JSDoc Type Definitions
// ============================================================================

/**
 * 信号对象 — 信号场中的基本数据单元
 * Signal object — the fundamental data unit in the signal field
 *
 * @typedef {Object} Signal
 * @property {string}  id           - 唯一标识符（nanoid 12位） / Unique ID (nanoid 12-char)
 * @property {string}  dimension    - 所属维度，必须是 ALL_DIMENSIONS 之一 / Dimension from ALL_DIMENSIONS
 * @property {string}  scope        - 信号作用域（如 agentId、taskId） / Signal scope (e.g. agentId, taskId)
 * @property {number}  strength     - 原始强度 [0, 1] / Original strength [0, 1]
 * @property {number}  lambda       - 衰减率 / Decay rate
 * @property {number}  emitTime     - 发射时间戳 (ms since epoch) / Emission timestamp
 * @property {number}  encodedScore - Forward-decay 编码分数 / Forward-decay encoded score
 * @property {string}  emitterId    - 发射者标识 / Emitter identifier
 * @property {Object}  [metadata]   - 可选附加数据 / Optional metadata
 */

/**
 * 信号过滤器 — 用于查询/扫描信号
 * Signal filter — used for querying/scanning signals
 *
 * @typedef {Object} SignalFilter
 * @property {string}  [scope]      - 按作用域过滤 / Filter by scope
 * @property {string}  [dimension]  - 按维度过滤 / Filter by dimension
 * @property {string}  [emitterId]  - 按发射者过滤 / Filter by emitter
 * @property {number}  [maxAge]     - 最大年龄（ms）/ Maximum age in ms
 * @property {number}  [minStrength] - 最小实际强度 / Minimum actual strength after decay
 * @property {string}  [sortBy]     - 排序字段（'strength' | 'emitTime'） / Sort field
 * @property {number}  [limit]      - 结果数量上限 / Result count limit
 */

/**
 * 场向量 — 12 维叠加结果
 * Field vector — 12-dimensional superposition result
 *
 * @typedef {Object} FieldVector
 * @property {number} trail         - 路径维度强度 / Trail dimension strength
 * @property {number} alarm         - 警报维度强度 / Alarm dimension strength
 * @property {number} reputation    - 声誉维度强度 / Reputation dimension strength
 * @property {number} task          - 任务维度强度 / Task dimension strength
 * @property {number} knowledge     - 知识维度强度 / Knowledge dimension strength
 * @property {number} coordination  - 协调维度强度 / Coordination dimension strength
 * @property {number} emotion       - 情绪维度强度 / Emotion dimension strength
 * @property {number} trust         - 信任维度强度 / Trust dimension strength
 * @property {number} sna           - SNA维度强度 / SNA dimension strength
 * @property {number} learning      - 学习维度强度 / Learning dimension strength
 * @property {number} calibration   - 校准维度强度 / Calibration dimension strength
 * @property {number} species       - 种群维度强度 / Species dimension strength
 */
