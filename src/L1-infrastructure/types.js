/**
 * @fileoverview Claw-Swarm V5.0 - Core Type Definitions
 * 核心类型定义 - 所有枚举与 JSDoc 类型定义
 *
 * L1 Infrastructure Layer - Foundation types used across the entire swarm system.
 * L1 基础设施层 - 整个蜂群系统中使用的基础类型。
 *
 * Includes all migrated v4.x enums plus new V5.0 additions.
 * 包含所有从 v4.x 迁移的枚举以及 V5.0 新增的枚举。
 */

// ============================================================================
// MIGRATED FROM v4.x - 从 v4.x 迁移的枚举
// ============================================================================

/**
 * Task lifecycle status / 任务生命周期状态
 * Tracks a task from creation through completion or failure.
 * 跟踪任务从创建到完成或失败的整个过程。
 */
export const TaskStatus = Object.freeze({
  pending: 'pending',           // 等待中 - Waiting to be picked up
  initializing: 'initializing', // 初始化中 - Setting up resources
  running: 'running',           // 运行中 - Actively being processed
  executing: 'executing',       // 执行中 - Performing the core action
  completed: 'completed',       // 已完成 - Successfully finished
  failed: 'failed',             // 已失败 - Terminated with error
  cancelled: 'cancelled',       // 已取消 - Cancelled by user or system
  retrying: 'retrying',         // 重试中 - Retrying after a failure
  blocked: 'blocked',           // 已阻塞 - Waiting on dependency
});

/**
 * Role execution status / 角色执行状态
 * Indicates the current state of an agent's assigned role.
 * 表示代理分配角色的当前状态。
 */
export const RoleStatus = Object.freeze({
  idle: 'idle',           // 空闲 - Not currently assigned
  active: 'active',       // 活跃 - Currently performing role
  completed: 'completed', // 已完成 - Role work finished
  failed: 'failed',       // 已失败 - Role execution failed
});

/**
 * Strategy type for task orchestration / 任务编排策略类型
 * Defines how subtasks are organized and executed.
 * 定义子任务的组织和执行方式。
 */
export const StrategyType = Object.freeze({
  sequential: 'sequential',   // 顺序执行 - Tasks run one after another
  parallel: 'parallel',       // 并行执行 - Tasks run simultaneously
  conditional: 'conditional', // 条件执行 - Tasks run based on conditions
  iterative: 'iterative',     // 迭代执行 - Tasks repeat until condition met
  pipeline: 'pipeline',       // 流水线执行 - Tasks flow through stages
});

/**
 * Execution strategy / 执行策略
 * Controls whether operations are simulated or performed live.
 * 控制操作是模拟执行还是实际执行。
 */
export const ExecutionStrategy = Object.freeze({
  simulated: 'simulated', // 模拟执行 - Dry run without side effects
  live: 'live',           // 实际执行 - Real execution with side effects
});

/**
 * Execution mode / 执行模式
 * Determines the level of automation for task execution.
 * 确定任务执行的自动化级别。
 */
export const ExecutionMode = Object.freeze({
  auto: 'auto',           // 全自动 - Fully automated execution
  manual: 'manual',       // 手动 - Requires human intervention
  'semi-auto': 'semi-auto', // 半自动 - Automated with human checkpoints
  dependency: 'dependency',  // 依赖驱动 - Triggered by dependency resolution
});

/**
 * Monitor verbosity mode / 监控详细程度模式
 * Controls the granularity of monitoring output.
 * 控制监控输出的粒度。
 */
export const MonitorMode = Object.freeze({
  none: 'none',         // 无监控 - No monitoring output
  basic: 'basic',       // 基础监控 - Minimal status updates
  default: 'default',   // 默认监控 - Standard monitoring
  detailed: 'detailed', // 详细监控 - Extended information
  verbose: 'verbose',   // 详尽监控 - Maximum verbosity
});

/**
 * Log severity level / 日志严重级别
 * Standard logging levels from debug to fatal.
 * 从调试到致命的标准日志级别。
 */
export const LogLevel = Object.freeze({
  debug: 'debug', // 调试 - Development diagnostics
  info: 'info',   // 信息 - General operational messages
  warn: 'warn',   // 警告 - Potential issues
  error: 'error', // 错误 - Recoverable errors
  fatal: 'fatal', // 致命 - Unrecoverable errors
});

/**
 * Agent experience tier / 代理经验等级
 * Hierarchical ranking of agent capability and trust.
 * 代理能力和信任度的层级排名。
 */
export const AgentTier = Object.freeze({
  trainee: 'trainee', // 实习生 - Learning, limited permissions
  junior: 'junior',   // 初级 - Basic tasks, supervised
  mid: 'mid',         // 中级 - Independent work capability
  senior: 'senior',   // 高级 - Complex tasks, mentoring others
  lead: 'lead',       // 领导 - Strategic decisions, full authority
});

/**
 * Agent availability status / 代理可用状态
 * Current operational state of an agent.
 * 代理的当前操作状态。
 */
export const AgentStatus = Object.freeze({
  online: 'online',   // 在线 - Available for work
  offline: 'offline', // 离线 - Not available
  busy: 'busy',       // 忙碌 - Currently occupied
  error: 'error',     // 错误 - In error state
});

/**
 * Capability dimension / 能力维度
 * Axes along which agent capability is measured.
 * 衡量代理能力的各个维度。
 *
 * Includes original v4.x 5D (speed, quality, reliability, creativity, cost)
 * plus new V5.0 8D expansion (coding, architecture, testing, documentation,
 * security, performance, communication, domain).
 * 包含原始 v4.x 5D（速度、质量、可靠性、创造力、成本）
 * 以及 V5.0 新增的 8D 扩展（编码、架构、测试、文档、安全、性能、沟通、领域）。
 */
export const CapabilityDimension = Object.freeze({
  // v4.x original 5D / v4.x 原始 5 维
  speed: 'speed',             // 速度 - Execution speed
  quality: 'quality',         // 质量 - Output quality
  reliability: 'reliability', // 可靠性 - Consistency and uptime
  creativity: 'creativity',   // 创造力 - Novel solutions
  cost: 'cost',               // 成本 - Resource consumption

  // V5.0 new 8D expansion / V5.0 新增 8 维扩展
  coding: 'coding',               // 编码 - Code writing proficiency
  architecture: 'architecture',   // 架构 - System design capability
  testing: 'testing',             // 测试 - Test coverage and quality
  documentation: 'documentation', // 文档 - Documentation quality
  security: 'security',           // 安全 - Security awareness
  performance: 'performance',     // 性能 - Performance optimization
  communication: 'communication', // 沟通 - Inter-agent communication
  domain: 'domain',               // 领域 - Domain-specific expertise
});

/**
 * Governance vote type / 治理投票类型
 * Types of votes that can be cast in the governance system.
 * 治理系统中可以发起的投票类型。
 */
export const VoteType = Object.freeze({
  promotion: 'promotion',   // 晋升 - Promote an agent's tier
  demotion: 'demotion',     // 降级 - Demote an agent's tier
  allocation: 'allocation', // 分配 - Resource allocation decision
  policy: 'policy',         // 策略 - Policy change proposal
});

/**
 * Individual vote choice / 个人投票选择
 * Possible choices when casting a vote.
 * 投票时的可选选项。
 */
export const VoteChoice = Object.freeze({
  approve: 'approve', // 赞成 - In favor
  reject: 'reject',   // 反对 - Against
  abstain: 'abstain', // 弃权 - Neither for nor against
});

/**
 * Vote resolution status / 投票决议状态
 * Lifecycle state of a governance vote.
 * 治理投票的生命周期状态。
 */
export const VoteStatus = Object.freeze({
  open: 'open',         // 进行中 - Accepting votes
  closed: 'closed',     // 已关闭 - No longer accepting votes
  passed: 'passed',     // 已通过 - Vote passed
  rejected: 'rejected', // 已否决 - Vote rejected
});

/**
 * Agent behavioral tag / 代理行为标签
 * Describes the behavioral tendency of an agent.
 * 描述代理的行为倾向。
 */
export const BehaviorTag = Object.freeze({
  cooperative: 'cooperative', // 合作型 - Prefers collaboration
  independent: 'independent', // 独立型 - Prefers solo work
  aggressive: 'aggressive',   // 激进型 - Pursues goals aggressively
  cautious: 'cautious',       // 谨慎型 - Risk-averse approach
  adaptive: 'adaptive',       // 适应型 - Adjusts to context
});

/**
 * Skill proficiency level / 技能熟练度等级
 * Granular measure of expertise in a specific skill.
 * 特定技能专业程度的细粒度衡量。
 */
export const SkillLevel = Object.freeze({
  novice: 'novice',             // 新手 - Basic understanding
  intermediate: 'intermediate', // 中级 - Competent usage
  advanced: 'advanced',         // 高级 - Deep expertise
  expert: 'expert',             // 专家 - Mastery level
});

/**
 * Pheromone signal type / 信息素信号类型
 * Types of pheromone signals in the stigmergy communication system.
 * 群体间接通信系统中的信息素信号类型。
 */
export const PheromoneType = Object.freeze({
  trail: 'trail',     // 路径信息素 - Marks successful paths
  alarm: 'alarm',     // 警报信息素 - Signals danger or issues
  recruit: 'recruit', // 招募信息素 - Attracts agents to tasks
  queen: 'queen',     // 蜂王信息素 - Central coordination signal
  dance: 'dance',     // 舞蹈信息素 - Communicates resource location
});

/**
 * Agent persona role / 代理角色人格
 * Bio-inspired role personas for agent specialization.
 * 受生物启发的代理专业化角色人格。
 */
export const PersonaRole = Object.freeze({
  'scout-bee': 'scout-bee',           // 侦察蜂 - Explores and discovers
  'worker-bee': 'worker-bee',         // 工蜂 - Executes core tasks
  'guard-bee': 'guard-bee',           // 守卫蜂 - Monitors and protects
  'queen-messenger': 'queen-messenger', // 蜂王信使 - Coordinates and relays
});

/**
 * Collaboration strategy / 协作策略
 * Patterns for multi-agent collaboration.
 * 多代理协作的模式。
 */
export const CollaborationStrategy = Object.freeze({
  parallel: 'parallel',     // 并行协作 - Agents work simultaneously
  pipeline: 'pipeline',     // 流水线协作 - Sequential handoffs
  debate: 'debate',         // 辩论协作 - Adversarial discussion
  stigmergy: 'stigmergy',  // 群体智慧协作 - Indirect coordination via environment
});

/**
 * Collaboration communication channel / 协作通信通道
 * Medium through which agents communicate.
 * 代理之间通信的媒介。
 */
export const CollaborationChannel = Object.freeze({
  pheromone: 'pheromone', // 信息素通道 - Indirect environmental signals
  memory: 'memory',       // 记忆通道 - Shared memory space
  direct: 'direct',       // 直接通道 - Point-to-point messaging
});

/**
 * Subsystem name / 子系统名称
 * Named subsystems within the swarm architecture.
 * 蜂群架构中的命名子系统。
 */
export const SubsystemName = Object.freeze({
  memory: 'memory',             // 记忆子系统 - Memory management
  pheromone: 'pheromone',       // 信息素子系统 - Pheromone signaling
  governance: 'governance',     // 治理子系统 - Governance and voting
  soul: 'soul',                 // 灵魂子系统 - Agent identity and persona
  collaboration: 'collaboration', // 协作子系统 - Multi-agent collaboration
  orchestration: 'orchestration', // 编排子系统 - Task orchestration
});


// ============================================================================
// NEW V5.0 ENUMS - V5.0 新增枚举
// ============================================================================

/**
 * Zone membership role / 区域成员角色
 * Role of an agent within a collaboration zone.
 * 代理在协作区域中的角色。
 */
export const ZoneRole = Object.freeze({
  leader: 'leader',     // 领导者 - Zone coordinator
  member: 'member',     // 成员 - Active participant
  observer: 'observer', // 观察者 - Read-only access
});

/**
 * Execution plan lifecycle status / 执行计划生命周期状态
 * Tracks the state of a compiled execution plan.
 * 跟踪已编译执行计划的状态。
 */
export const ExecutionPlanStatus = Object.freeze({
  draft: 'draft',         // 草稿 - Being composed
  validated: 'validated', // 已验证 - Passed validation checks
  executing: 'executing', // 执行中 - Currently running
  completed: 'completed', // 已完成 - All steps finished
  failed: 'failed',       // 已失败 - Execution encountered fatal error
});

/**
 * Episodic memory event type / 情景记忆事件类型
 * Types of events recorded in episodic memory.
 * 情景记忆中记录的事件类型。
 */
export const EpisodicEventType = Object.freeze({
  action: 'action',           // 行动 - An action was taken
  observation: 'observation', // 观察 - Something was observed
  decision: 'decision',       // 决策 - A decision was made
  error: 'error',             // 错误 - An error occurred
  success: 'success',         // 成功 - A goal was achieved
});

/**
 * Knowledge graph node type / 知识图谱节点类型
 * Types of nodes in the semantic knowledge graph.
 * 语义知识图谱中的节点类型。
 */
export const KnowledgeNodeType = Object.freeze({
  concept: 'concept', // 概念 - Abstract concept
  entity: 'entity',   // 实体 - Concrete entity
  skill: 'skill',     // 技能 - Learnable skill
  pattern: 'pattern', // 模式 - Recurring pattern
  tool: 'tool',       // 工具 - Usable tool or API
});

/**
 * Knowledge graph edge type / 知识图谱边类型
 * Types of relationships between knowledge graph nodes.
 * 知识图谱节点之间的关系类型。
 */
export const KnowledgeEdgeType = Object.freeze({
  uses: 'uses',                 // 使用 - Node A uses Node B
  depends_on: 'depends_on',    // 依赖 - Node A depends on Node B
  related_to: 'related_to',    // 关联 - Node A is related to Node B
  part_of: 'part_of',          // 属于 - Node A is part of Node B
  causes: 'causes',            // 导致 - Node A causes Node B
  evolved_from: 'evolved_from', // 演化自 - Node A evolved from Node B
});

/**
 * Artificial Bee Colony role / 人工蜂群算法角色
 * Roles in the ABC (Artificial Bee Colony) optimization algorithm.
 * 人工蜂群 (ABC) 优化算法中的角色。
 */
export const ABCRole = Object.freeze({
  employed: 'employed', // 引领蜂 - Exploits known food sources
  onlooker: 'onlooker', // 跟随蜂 - Selects sources based on info sharing
  scout: 'scout',       // 侦察蜂 - Explores new food sources randomly
});

/**
 * Contract Net Protocol phase / 合同网协议阶段
 * Phases in the Contract Net interaction protocol.
 * 合同网交互协议中的各个阶段。
 */
export const ContractNetPhase = Object.freeze({
  cfp: 'cfp',         // 招标 - Call For Proposals
  bid: 'bid',         // 投标 - Agent submits a bid
  award: 'award',     // 中标 - Contract awarded to bidder
  reject: 'reject',   // 拒绝 - Bid rejected
  execute: 'execute', // 执行 - Awarded contract being executed
});

/**
 * Pipeline execution state / 流水线执行状态
 * Fine-grained states for pipeline stage execution.
 * 流水线阶段执行的细粒度状态。
 */
export const PipelineState = Object.freeze({
  pending: 'pending',     // 等待中 - Not yet started
  scheduled: 'scheduled', // 已调度 - Scheduled for execution
  running: 'running',     // 运行中 - Currently executing
  paused: 'paused',       // 已暂停 - Temporarily halted
  success: 'success',     // 成功 - Completed successfully
  failed: 'failed',       // 失败 - Terminated with error
  retrying: 'retrying',   // 重试中 - Re-attempting after failure
  completed: 'completed', // 已完成 - Finalized (success or handled failure)
  dead: 'dead',           // 已终止 - Permanently failed, no more retries
});

/**
 * Retry backoff strategy / 重试退避策略
 * Algorithm used to calculate delay between retry attempts.
 * 用于计算重试间隔的算法。
 */
export const RetryStrategy = Object.freeze({
  fixed: 'fixed',                         // 固定间隔 - Constant delay between retries
  linear: 'linear',                       // 线性递增 - Linearly increasing delay
  exponential: 'exponential',             // 指数递增 - Exponentially increasing delay
  decorrelated_jitter: 'decorrelated_jitter', // 去相关抖动 - Jittered exponential backoff
});

/**
 * Inter-agent message category / 代理间消息类别
 * Classification of messages exchanged between agents.
 * 代理之间交换消息的分类。
 */
export const MessageCategory = Object.freeze({
  system: 'system',           // 系统消息 - Infrastructure-level messages
  application: 'application', // 应用消息 - Task-related messages
  negotiation: 'negotiation', // 协商消息 - Contract/bid negotiation
  pheromone: 'pheromone',     // 信息素消息 - Stigmergy signals
  broadcast: 'broadcast',     // 广播消息 - Broadcast to all agents
});

/**
 * Working memory layer / 工作记忆层
 * Layers within an agent's working memory hierarchy.
 * 代理工作记忆层次结构中的各层。
 */
export const WorkingMemoryLayer = Object.freeze({
  focus: 'focus',         // 焦点层 - Immediate attention, highest priority
  context: 'context',     // 上下文层 - Current task context
  scratchpad: 'scratchpad', // 草稿层 - Temporary computation space
});

/**
 * Memory management event type / 记忆管理事件类型
 * Types of events in the memory lifecycle management system.
 * 记忆生命周期管理系统中的事件类型。
 */
export const MemoryEventType = Object.freeze({
  consolidate: 'consolidate', // 巩固 - Move from short-term to long-term
  evict: 'evict',             // 驱逐 - Remove from memory due to capacity
  compress: 'compress',       // 压缩 - Reduce memory footprint
  restore: 'restore',         // 恢复 - Restore from archive
});


// ============================================================================
// JSDoc TYPE DEFINITIONS - JSDoc 类型定义
// ============================================================================

/**
 * @typedef {Object} AgentProfile
 * 代理配置文件 / Agent profile describing identity and capabilities
 * @property {string} id - Unique agent identifier / 唯一代理标识符
 * @property {string} name - Human-readable agent name / 人类可读的代理名称
 * @property {keyof typeof AgentTier} tier - Experience tier / 经验等级
 * @property {keyof typeof AgentStatus} status - Current status / 当前状态
 * @property {keyof typeof PersonaRole} persona - Bio-inspired role / 生物启发角色
 * @property {keyof typeof BehaviorTag} behavior - Behavioral tendency / 行为倾向
 * @property {Record<keyof typeof CapabilityDimension, number>} capabilities - Capability scores (0-1) / 能力分数 (0-1)
 * @property {Array<{skill: string, level: keyof typeof SkillLevel}>} skills - Skill inventory / 技能清单
 * @property {string} [zoneId] - Assigned collaboration zone / 分配的协作区域
 * @property {keyof typeof ZoneRole} [zoneRole] - Role within zone / 区域内角色
 */

/**
 * @typedef {Object} TaskDefinition
 * 任务定义 / Complete task specification
 * @property {string} id - Unique task identifier / 唯一任务标识符
 * @property {string} description - Task description / 任务描述
 * @property {keyof typeof TaskStatus} status - Current lifecycle status / 当前生命周期状态
 * @property {keyof typeof StrategyType} strategy - Orchestration strategy / 编排策略
 * @property {keyof typeof ExecutionStrategy} executionStrategy - Simulated vs live / 模拟或实际
 * @property {keyof typeof ExecutionMode} executionMode - Automation level / 自动化级别
 * @property {string} [assignedAgent] - Assigned agent ID / 分配的代理 ID
 * @property {string[]} [dependencies] - Dependent task IDs / 依赖的任务 ID
 * @property {number} [priority] - Priority (0-10) / 优先级 (0-10)
 * @property {Object} [metadata] - Arbitrary metadata / 任意元数据
 */

/**
 * @typedef {Object} ExecutionPlan
 * 执行计划 / A validated plan for task execution
 * @property {string} id - Plan identifier / 计划标识符
 * @property {keyof typeof ExecutionPlanStatus} status - Plan lifecycle status / 计划生命周期状态
 * @property {TaskDefinition[]} tasks - Ordered list of tasks / 有序任务列表
 * @property {string} createdAt - ISO timestamp of creation / 创建的 ISO 时间戳
 * @property {string} [startedAt] - ISO timestamp of execution start / 执行开始的 ISO 时间戳
 * @property {string} [completedAt] - ISO timestamp of completion / 完成的 ISO 时间戳
 */

/**
 * @typedef {Object} PheromoneSignal
 * 信息素信号 / A pheromone signal in the stigmergy system
 * @property {string} id - Signal identifier / 信号标识符
 * @property {keyof typeof PheromoneType} type - Pheromone type / 信息素类型
 * @property {string} emitterId - Agent that emitted the signal / 发出信号的代理
 * @property {number} intensity - Signal strength (0-1) / 信号强度 (0-1)
 * @property {number} decay - Decay rate per tick / 每刻衰减率
 * @property {Object} payload - Signal data / 信号数据
 * @property {string} timestamp - ISO emission timestamp / ISO 发出时间戳
 */

/**
 * @typedef {Object} GovernanceVote
 * 治理投票 / A governance vote record
 * @property {string} id - Vote identifier / 投票标识符
 * @property {keyof typeof VoteType} type - Vote category / 投票类别
 * @property {keyof typeof VoteStatus} status - Current vote status / 当前投票状态
 * @property {string} proposer - Agent ID that proposed the vote / 提议投票的代理 ID
 * @property {string} subject - Subject of the vote / 投票主题
 * @property {Array<{agentId: string, choice: keyof typeof VoteChoice, timestamp: string}>} ballots - Cast ballots / 已投选票
 * @property {string} createdAt - ISO timestamp / ISO 时间戳
 * @property {string} [resolvedAt] - ISO resolution timestamp / ISO 决议时间戳
 */

/**
 * @typedef {Object} EpisodicMemoryEntry
 * 情景记忆条目 / A single entry in episodic memory
 * @property {string} id - Entry identifier / 条目标识符
 * @property {keyof typeof EpisodicEventType} eventType - Event classification / 事件分类
 * @property {string} agentId - Agent that experienced the event / 经历事件的代理
 * @property {string} description - Human-readable description / 人类可读的描述
 * @property {Object} context - Contextual data at time of event / 事件发生时的上下文数据
 * @property {number} importance - Importance score (0-1) / 重要性分数 (0-1)
 * @property {string} timestamp - ISO timestamp / ISO 时间戳
 */

/**
 * @typedef {Object} KnowledgeNode
 * 知识节点 / A node in the semantic knowledge graph
 * @property {string} id - Node identifier / 节点标识符
 * @property {keyof typeof KnowledgeNodeType} type - Node type / 节点类型
 * @property {string} label - Human-readable label / 人类可读标签
 * @property {Object} [properties] - Node attributes / 节点属性
 * @property {string} createdAt - ISO timestamp / ISO 时间戳
 */

/**
 * @typedef {Object} KnowledgeEdge
 * 知识边 / An edge connecting two knowledge nodes
 * @property {string} sourceId - Source node ID / 源节点 ID
 * @property {string} targetId - Target node ID / 目标节点 ID
 * @property {keyof typeof KnowledgeEdgeType} type - Relationship type / 关系类型
 * @property {number} [weight] - Edge weight (0-1) / 边权重 (0-1)
 * @property {Object} [metadata] - Additional metadata / 附加元数据
 */

/**
 * @typedef {Object} ContractNetMessage
 * 合同网消息 / A message in the Contract Net Protocol
 * @property {string} id - Message identifier / 消息标识符
 * @property {keyof typeof ContractNetPhase} phase - Protocol phase / 协议阶段
 * @property {string} senderId - Sender agent ID / 发送代理 ID
 * @property {string} receiverId - Receiver agent ID / 接收代理 ID
 * @property {keyof typeof MessageCategory} category - Message category / 消息类别
 * @property {Object} content - Message payload / 消息内容
 * @property {string} timestamp - ISO timestamp / ISO 时间戳
 */

/**
 * @typedef {Object} PipelineStage
 * 流水线阶段 / A single stage in an execution pipeline
 * @property {string} id - Stage identifier / 阶段标识符
 * @property {string} name - Stage name / 阶段名称
 * @property {keyof typeof PipelineState} state - Current state / 当前状态
 * @property {keyof typeof RetryStrategy} retryStrategy - Backoff strategy / 退避策略
 * @property {number} retryCount - Current retry attempt / 当前重试次数
 * @property {number} maxRetries - Maximum retry attempts / 最大重试次数
 * @property {string} [assignedAgent] - Agent executing this stage / 执行此阶段的代理
 * @property {Object} [input] - Stage input data / 阶段输入数据
 * @property {Object} [output] - Stage output data / 阶段输出数据
 */

/**
 * @typedef {Object} WorkingMemorySlot
 * 工作记忆槽位 / A slot in an agent's working memory
 * @property {string} key - Slot key / 槽位键
 * @property {keyof typeof WorkingMemoryLayer} layer - Memory layer / 记忆层
 * @property {*} value - Stored value / 存储的值
 * @property {number} priority - Access priority / 访问优先级
 * @property {string} updatedAt - ISO timestamp of last update / 最后更新的 ISO 时间戳
 * @property {number} accessCount - Number of reads / 读取次数
 */

/**
 * @typedef {Object} MemoryEvent
 * 记忆管理事件 / An event in the memory management system
 * @property {string} id - Event identifier / 事件标识符
 * @property {keyof typeof MemoryEventType} type - Event type / 事件类型
 * @property {string} agentId - Agent whose memory is affected / 受影响的代理
 * @property {string[]} affectedKeys - Memory keys affected / 受影响的记忆键
 * @property {string} reason - Reason for the event / 事件原因
 * @property {string} timestamp - ISO timestamp / ISO 时间戳
 */

/**
 * @typedef {Object} CollaborationZone
 * 协作区域 / A zone where agents collaborate on related tasks
 * @property {string} id - Zone identifier / 区域标识符
 * @property {string} name - Zone name / 区域名称
 * @property {keyof typeof CollaborationStrategy} strategy - Collaboration pattern / 协作模式
 * @property {keyof typeof CollaborationChannel} channel - Communication channel / 通信通道
 * @property {Array<{agentId: string, role: keyof typeof ZoneRole}>} members - Zone members / 区域成员
 * @property {string} createdAt - ISO timestamp / ISO 时间戳
 */

/**
 * @typedef {Object} ABCState
 * 人工蜂群状态 / State of an agent in the ABC algorithm
 * @property {string} agentId - Agent identifier / 代理标识符
 * @property {keyof typeof ABCRole} role - ABC role / ABC 角色
 * @property {Object} [foodSource] - Current food source (solution) / 当前食物源（解决方案）
 * @property {number} trialCount - Trials without improvement / 未改善的尝试次数
 * @property {number} fitness - Current fitness value / 当前适应度值
 */

/**
 * @typedef {Object} SubsystemHealth
 * 子系统健康状态 / Health report for a subsystem
 * @property {keyof typeof SubsystemName} subsystem - Subsystem name / 子系统名称
 * @property {boolean} healthy - Whether the subsystem is healthy / 子系统是否健康
 * @property {number} uptime - Uptime in seconds / 运行时间（秒）
 * @property {Object} [metrics] - Subsystem-specific metrics / 子系统特定指标
 * @property {string} checkedAt - ISO timestamp of last check / 最后检查的 ISO 时间戳
 */

/**
 * @typedef {Object} SwarmConfig
 * 蜂群配置 / Top-level configuration for the swarm system
 * @property {keyof typeof ExecutionStrategy} executionStrategy - Default execution strategy / 默认执行策略
 * @property {keyof typeof ExecutionMode} executionMode - Default execution mode / 默认执行模式
 * @property {keyof typeof MonitorMode} monitorMode - Monitoring verbosity / 监控详细程度
 * @property {keyof typeof LogLevel} logLevel - Logging level / 日志级别
 * @property {number} maxAgents - Maximum concurrent agents / 最大并发代理数
 * @property {number} pheromoneDecayRate - Global pheromone decay rate / 全局信息素衰减率
 * @property {Object} [extensions] - Extension configuration / 扩展配置
 */
