/**
 * @fileoverview Claw-Swarm v4.0 - Layer 1 Core Types
 * @module layer1-core/types
 * @author DEEP-IOS
 *
 * 功能概述 / Function Overview:
 * ─────────────────────────────
 * 本模块定义 Claw-Swarm v4.0 核心层（Layer 1）的所有类型常量与 JSDoc 类型定义。
 * This module defines all type constants and JSDoc typedefs for the Claw-Swarm v4.0 core layer (Layer 1).
 *
 * 包含内容 / Contents:
 *   - 从 Swarm Lite v3.0 继承的 14 个枚举 (TaskStatus, RoleStatus, StrategyType, 等)
 *     14 enums inherited from Swarm Lite v3.0 (TaskStatus, RoleStatus, StrategyType, etc.)
 *   - v4.0 新增的 5 个枚举 (PheromoneType, PersonaRole, CollaborationStrategy, 等)
 *     5 new enums added in v4.0 (PheromoneType, PersonaRole, CollaborationStrategy, etc.)
 *   - 从 v3.0 继承的 17 个 JSDoc 类型定义
 *     17 JSDoc typedefs inherited from v3.0
 *   - v4.0 新增的 4 个 JSDoc 类型定义 (PheromoneSignal, PersonaTemplate, PeerEntry, StruggleResult)
 *     4 new JSDoc typedefs added in v4.0
 *
 * 所有枚举使用 Object.freeze() 确保不可变性。
 * All enums use Object.freeze() to guarantee immutability.
 */

// ============================================================================
// 枚举定义 - 从 Swarm Lite v3.0 继承
// Enum Definitions - Inherited from Swarm Lite v3.0
// ============================================================================

/**
 * 任务状态枚举 / Task status enumeration
 * 表示任务在其生命周期中的当前状态。
 * Represents the current state of a task in its lifecycle.
 */
export const TaskStatus = Object.freeze({
  PENDING: 'pending',
  INITIALIZING: 'initializing', // 编排器任务初始化阶段 / Orchestrator task init phase
  RUNNING: 'running',
  EXECUTING: 'executing',       // 编排器任务执行阶段 / Orchestrator task execution phase
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
  RETRYING: 'retrying',
  BLOCKED: 'blocked',
});

/**
 * 角色状态枚举 / Role status enumeration
 * 表示角色执行过程中的状态。
 * Represents the status of a role during execution.
 */
export const RoleStatus = Object.freeze({
  IDLE: 'idle',
  ACTIVE: 'active',
  COMPLETED: 'completed',
  FAILED: 'failed',
});

/**
 * 策略类型枚举 / Strategy type enumeration
 * 定义可用的执行策略类型。
 * Defines available execution strategy types.
 */
export const StrategyType = Object.freeze({
  SEQUENTIAL: 'sequential',
  PARALLEL: 'parallel',
  CONDITIONAL: 'conditional',
  ITERATIVE: 'iterative',
  PIPELINE: 'pipeline',
});

/**
 * 编排执行策略枚举 / Orchestration execution strategy enumeration
 * 定义蜂群编排器使用的执行策略。
 * Defines execution strategies used by the swarm orchestrator.
 *
 * - SIMULATED: 模拟执行，不调用真实 AI 模型。/ Simulated execution, no real AI model calls.
 * - LIVE:      实际执行，调用真实 AI 模型。/ Live execution, real AI model calls.
 */
export const ExecutionStrategy = Object.freeze({
  SIMULATED: 'simulated',
  LIVE: 'live',
});

/**
 * 执行模式枚举 / Execution mode enumeration
 * 定义任务的执行模式。
 * Defines execution modes for tasks.
 */
export const ExecutionMode = Object.freeze({
  AUTO: 'auto',
  MANUAL: 'manual',
  SEMI_AUTO: 'semi-auto',
  DEPENDENCY: 'dependency',
});

/**
 * 监控模式枚举 / Monitor mode enumeration
 * 定义系统的监控级别。
 * Defines monitoring levels for the system.
 */
export const MonitorMode = Object.freeze({
  NONE: 'none',
  BASIC: 'basic',
  DEFAULT: 'default',
  DETAILED: 'detailed',
  VERBOSE: 'verbose',
});

/**
 * 日志级别枚举 / Log level enumeration
 * 定义日志输出的严重程度级别。
 * Defines severity levels for log output.
 */
export const LogLevel = Object.freeze({
  DEBUG: 'debug',
  INFO: 'info',
  WARN: 'warn',
  ERROR: 'error',
  FATAL: 'fatal',
});

/**
 * 代理层级枚举 / Agent tier enumeration
 * 定义代理在治理层级中的等级。
 * Defines agent tiers within the governance hierarchy.
 */
export const AgentTier = Object.freeze({
  JUNIOR: 'junior',
  MID: 'mid',
  SENIOR: 'senior',
  LEAD: 'lead',
});

/**
 * 代理状态枚举 / Agent status enumeration
 * 表示代理的当前运行状态。
 * Represents the current operational status of an agent.
 */
export const AgentStatus = Object.freeze({
  ONLINE: 'online',
  OFFLINE: 'offline',
  BUSY: 'busy',
  ERROR: 'error',
});

/**
 * 能力维度枚举 / Capability dimension enumeration
 * 定义代理能力评估的维度。
 * Defines dimensions for agent capability assessment.
 */
export const CapabilityDimension = Object.freeze({
  SPEED: 'speed',
  QUALITY: 'quality',
  RELIABILITY: 'reliability',
  CREATIVITY: 'creativity',
  COST: 'cost',
});

/**
 * 投票类型枚举 / Vote type enumeration
 * 定义治理系统中的投票类型。
 * Defines vote types in the governance system.
 */
export const VoteType = Object.freeze({
  PROMOTION: 'promotion',
  DEMOTION: 'demotion',
  ALLOCATION: 'allocation',
  POLICY: 'policy',
});

/**
 * 投票选择枚举 / Vote choice enumeration
 * 定义投票中的可选选项。
 * Defines selectable choices in a vote.
 */
export const VoteChoice = Object.freeze({
  APPROVE: 'approve',
  REJECT: 'reject',
  ABSTAIN: 'abstain',
});

/**
 * 投票状态枚举 / Vote status enumeration
 * 表示投票的当前状态。
 * Represents the current state of a vote.
 */
export const VoteStatus = Object.freeze({
  OPEN: 'open',
  CLOSED: 'closed',
  PASSED: 'passed',
  REJECTED: 'rejected',
});

/**
 * 行为标签枚举 / Behavior tag enumeration
 * 用于标记代理行为模式的标签。
 * Tags for marking agent behavior patterns.
 */
export const BehaviorTag = Object.freeze({
  COOPERATIVE: 'cooperative',
  INDEPENDENT: 'independent',
  AGGRESSIVE: 'aggressive',
  CAUTIOUS: 'cautious',
  ADAPTIVE: 'adaptive',
});

/**
 * 技能水平枚举 / Skill level enumeration
 * 表示代理在特定技能上的熟练度。
 * Represents an agent's proficiency in a specific skill.
 */
export const SkillLevel = Object.freeze({
  NOVICE: 'novice',
  INTERMEDIATE: 'intermediate',
  ADVANCED: 'advanced',
  EXPERT: 'expert',
});

// ============================================================================
// 枚举定义 - v4.0 新增
// Enum Definitions - New in v4.0
// ============================================================================

/**
 * 信息素类型枚举 / Pheromone type enumeration
 * 定义蜂群协作中使用的信息素信号类型。
 * Defines pheromone signal types used in swarm collaboration.
 *
 * - TRAIL:   路径信息素，用于引导其他代理跟随成功路线。
 *            Trail pheromone, guides other agents along successful routes.
 * - ALARM:   警报信息素，通知其他代理存在问题或危险。
 *            Alarm pheromone, notifies others of problems or dangers.
 * - RECRUIT: 招募信息素，请求其他代理协助当前任务。
 *            Recruit pheromone, requests other agents to assist with a task.
 * - QUEEN:   女王信息素，来自编排器的高优先级指令。
 *            Queen pheromone, high-priority directives from the orchestrator.
 * - DANCE:   舞蹈信息素，传达复杂的空间或上下文信息。
 *            Dance pheromone, conveys complex spatial or contextual information.
 */
export const PheromoneType = Object.freeze({
  TRAIL: 'trail',
  ALARM: 'alarm',
  RECRUIT: 'recruit',
  QUEEN: 'queen',
  DANCE: 'dance',
});

/**
 * 人格角色枚举 / Persona role enumeration
 * 定义代理可以扮演的蜂群人格角色。
 * Defines swarm persona roles that agents can assume.
 *
 * - SCOUT_BEE:       侦察蜂，负责探索和发现新信息。
 *                    Scout bee, responsible for exploration and discovery.
 * - WORKER_BEE:      工蜂，负责执行核心任务。
 *                    Worker bee, responsible for executing core tasks.
 * - GUARD_BEE:       守卫蜂，负责验证和质量控制。
 *                    Guard bee, responsible for validation and quality control.
 * - QUEEN_MESSENGER: 女王信使，负责在编排器和代理之间传递指令。
 *                    Queen messenger, relays directives between orchestrator and agents.
 */
export const PersonaRole = Object.freeze({
  SCOUT_BEE: 'scout-bee',
  WORKER_BEE: 'worker-bee',
  GUARD_BEE: 'guard-bee',
  QUEEN_MESSENGER: 'queen-messenger',
});

/**
 * 协作策略枚举 / Collaboration strategy enumeration
 * 定义多代理协作时使用的策略模式。
 * Defines strategy patterns used during multi-agent collaboration.
 *
 * - PARALLEL:   并行策略，多个代理同时独立工作。
 *               Parallel strategy, multiple agents work simultaneously and independently.
 * - PIPELINE:   流水线策略，代理按顺序链式处理。
 *               Pipeline strategy, agents process sequentially in a chain.
 * - DEBATE:     辩论策略，代理提出不同观点并汇聚共识。
 *               Debate strategy, agents propose differing viewpoints and converge on consensus.
 * - STIGMERGY:  间接协作策略，代理通过环境信号（信息素）间接协调。
 *               Stigmergy strategy, agents coordinate indirectly through environmental signals (pheromones).
 */
export const CollaborationStrategy = Object.freeze({
  PARALLEL: 'parallel',
  PIPELINE: 'pipeline',
  DEBATE: 'debate',
  STIGMERGY: 'stigmergy',
});

/**
 * 协作通道枚举 / Collaboration channel enumeration
 * 定义代理之间通信所使用的通道类型。
 * Defines channel types used for communication between agents.
 *
 * - PHEROMONE: 信息素通道，通过信息素系统间接通信。
 *              Pheromone channel, indirect communication via the pheromone system.
 * - MEMORY:    记忆通道，通过共享记忆空间交换信息。
 *              Memory channel, information exchange through shared memory space.
 * - DIRECT:    直接通道，代理之间的点对点通信。
 *              Direct channel, point-to-point communication between agents.
 */
export const CollaborationChannel = Object.freeze({
  PHEROMONE: 'pheromone',
  MEMORY: 'memory',
  DIRECT: 'direct',
});

/**
 * 子系统名称枚举 / Subsystem name enumeration
 * 标识 Claw-Swarm v4.0 架构中的各个子系统。
 * Identifies each subsystem within the Claw-Swarm v4.0 architecture.
 */
export const SubsystemName = Object.freeze({
  MEMORY: 'memory',
  PHEROMONE: 'pheromone',
  GOVERNANCE: 'governance',
  SOUL: 'soul',
  COLLABORATION: 'collaboration',
  ORCHESTRATION: 'orchestration',
});

// ============================================================================
// JSDoc 类型定义 - 从 Swarm Lite v3.0 继承
// JSDoc Type Definitions - Inherited from Swarm Lite v3.0
// ============================================================================

/**
 * 任务配置 / Task configuration
 * 创建新任务时使用的配置对象。
 * Configuration object used when creating a new task.
 *
 * @typedef {Object} TaskConfig
 * @property {string} goal - 任务目标描述 / Task goal description
 * @property {string} [strategy] - 执行策略 / Execution strategy
 * @property {string} [executionMode] - 执行模式 / Execution mode
 * @property {number} [maxRetries] - 最大重试次数 / Maximum retry count
 * @property {number} [timeoutMs] - 超时时间（毫秒）/ Timeout in milliseconds
 * @property {Object} [metadata] - 附加元数据 / Additional metadata
 */

/**
 * 任务 / Task
 * 表示系统中的一个可执行任务。
 * Represents an executable task in the system.
 *
 * @typedef {Object} Task
 * @property {string} id - 任务唯一标识 / Unique task identifier
 * @property {string} goal - 任务目标 / Task goal
 * @property {string} status - 任务状态 / Task status (see TaskStatus)
 * @property {string} [strategy] - 执行策略 / Execution strategy
 * @property {string} [executionMode] - 执行模式 / Execution mode
 * @property {number} [maxRetries] - 最大重试次数 / Maximum retry count
 * @property {number} retryCount - 当前重试次数 / Current retry count
 * @property {number} [timeoutMs] - 超时时间 / Timeout in milliseconds
 * @property {Object} [metadata] - 附加元数据 / Additional metadata
 * @property {string} createdAt - 创建时间 / Creation timestamp
 * @property {string} updatedAt - 更新时间 / Last updated timestamp
 * @property {string} [completedAt] - 完成时间 / Completion timestamp
 * @property {Array<Role>} [roles] - 关联角色 / Associated roles
 * @property {Object} [result] - 执行结果 / Execution result
 * @property {string} [error] - 错误信息 / Error message
 */

/**
 * 角色 / Role
 * 任务执行中的一个角色定义。
 * A role definition within task execution.
 *
 * @typedef {Object} Role
 * @property {string} id - 角色唯一标识 / Unique role identifier
 * @property {string} name - 角色名称 / Role name
 * @property {string} description - 角色描述 / Role description
 * @property {string} status - 角色状态 / Role status (see RoleStatus)
 * @property {string} [agentId] - 分配的代理 ID / Assigned agent ID
 * @property {Object} [output] - 角色输出 / Role output
 * @property {string} [error] - 错误信息 / Error message
 */

/**
 * 角色执行结果 / Role execution result
 * 角色完成执行后的结果对象。
 * Result object after a role completes execution.
 *
 * @typedef {Object} RoleResult
 * @property {string} roleId - 角色 ID / Role ID
 * @property {string} status - 执行状态 / Execution status
 * @property {Object} [output] - 输出数据 / Output data
 * @property {string} [error] - 错误信息 / Error message
 * @property {number} durationMs - 执行耗时（毫秒）/ Execution duration in milliseconds
 */

/**
 * 检查点 / Checkpoint
 * 任务执行中的快照，用于恢复和回滚。
 * A snapshot during task execution, used for recovery and rollback.
 *
 * @typedef {Object} Checkpoint
 * @property {string} id - 检查点标识 / Checkpoint identifier
 * @property {string} taskId - 关联任务 ID / Associated task ID
 * @property {Object} state - 状态快照 / State snapshot
 * @property {string} createdAt - 创建时间 / Creation timestamp
 */

/**
 * 执行上下文 / Execution context
 * 任务执行过程中的上下文环境。
 * The contextual environment during task execution.
 *
 * @typedef {Object} ExecutionContext
 * @property {string} taskId - 当前任务 ID / Current task ID
 * @property {string} [parentTaskId] - 父任务 ID / Parent task ID
 * @property {Object} variables - 上下文变量 / Context variables
 * @property {Array<string>} completedRoles - 已完成的角色 / Completed roles
 * @property {Object} [sharedState] - 共享状态 / Shared state
 */

/**
 * Swarm 配置 / Swarm configuration
 * 系统的全局配置。
 * Global configuration for the system.
 *
 * @typedef {Object} SwarmConfig
 * @property {string} [executionMode] - 默认执行模式 / Default execution mode
 * @property {string} [monitorMode] - 监控模式 / Monitor mode
 * @property {string} [logLevel] - 日志级别 / Log level
 * @property {number} [defaultTimeoutMs] - 默认超时时间 / Default timeout in milliseconds
 * @property {number} [maxConcurrency] - 最大并发数 / Maximum concurrency
 * @property {Object} [db] - 数据库配置 / Database configuration
 * @property {Object} [plugins] - 插件配置 / Plugin configuration
 */

/**
 * 任务报告 / Task report
 * 任务执行完成后的汇总报告。
 * Summary report after task execution completes.
 *
 * @typedef {Object} TaskReport
 * @property {string} taskId - 任务 ID / Task ID
 * @property {string} status - 最终状态 / Final status
 * @property {number} totalDurationMs - 总耗时 / Total duration in milliseconds
 * @property {Array<RoleResult>} roleResults - 各角色结果 / Results from each role
 * @property {Object} [summary] - 摘要信息 / Summary information
 */

/**
 * 任务结果 / Task results
 * 包含所有角色执行结果的聚合对象。
 * Aggregated object containing execution results from all roles.
 *
 * @typedef {Object} TaskResults
 * @property {boolean} success - 是否成功 / Whether execution succeeded
 * @property {Array<RoleResult>} results - 角色结果列表 / List of role results
 * @property {Object} [mergedOutput] - 合并输出 / Merged output
 * @property {Array<string>} [errors] - 错误列表 / List of errors
 */

/**
 * 分布式锁 / Distributed lock
 * 用于确保并发安全的分布式锁对象。
 * Distributed lock object for ensuring concurrency safety.
 *
 * @typedef {Object} Lock
 * @property {string} resource - 被锁定的资源标识 / Locked resource identifier
 * @property {string} owner - 锁持有者 / Lock owner
 * @property {string} acquiredAt - 获取时间 / Acquisition timestamp
 * @property {number} ttlMs - 生存时间（毫秒）/ Time-to-live in milliseconds
 * @property {string} [token] - 锁令牌 / Lock token
 */

/**
 * 代理 / Agent
 * 表示系统中的一个 AI 代理。
 * Represents an AI agent in the system.
 *
 * @typedef {Object} Agent
 * @property {string} id - 代理唯一标识 / Unique agent identifier
 * @property {string} name - 代理名称 / Agent name
 * @property {string} tier - 代理层级 / Agent tier (see AgentTier)
 * @property {string} status - 代理状态 / Agent status (see AgentStatus)
 * @property {Array<Capability>} capabilities - 能力列表 / List of capabilities
 * @property {Object} [metadata] - 附加元数据 / Additional metadata
 * @property {string} createdAt - 创建时间 / Creation timestamp
 */

/**
 * 能力 / Capability
 * 描述代理在某个维度上的能力。
 * Describes an agent's capability in a specific dimension.
 *
 * @typedef {Object} Capability
 * @property {string} dimension - 能力维度 / Capability dimension (see CapabilityDimension)
 * @property {number} score - 能力分数 (0-1) / Capability score (0-1)
 * @property {number} confidence - 置信度 (0-1) / Confidence level (0-1)
 * @property {number} sampleSize - 评估样本数 / Assessment sample size
 */

/**
 * 投票记录 / Vote record
 * 治理系统中的一条投票记录。
 * A vote record in the governance system.
 *
 * @typedef {Object} VoteRecord
 * @property {string} id - 投票记录 ID / Vote record ID
 * @property {string} voteId - 投票议题 ID / Vote topic ID
 * @property {string} voterId - 投票者 ID / Voter ID
 * @property {string} choice - 投票选择 / Vote choice (see VoteChoice)
 * @property {string} [reason] - 投票理由 / Vote reason
 * @property {string} timestamp - 投票时间 / Vote timestamp
 */

/**
 * 贡献 / Contribution
 * 代理在任务中的贡献记录。
 * A record of an agent's contribution to a task.
 *
 * @typedef {Object} Contribution
 * @property {string} agentId - 代理 ID / Agent ID
 * @property {string} taskId - 任务 ID / Task ID
 * @property {string} roleId - 角色 ID / Role ID
 * @property {number} score - 贡献分数 / Contribution score
 * @property {Object} [details] - 贡献详情 / Contribution details
 * @property {string} timestamp - 记录时间 / Record timestamp
 */

/**
 * 任务结局 / Task outcome
 * 任务最终结局的详细描述。
 * Detailed description of a task's final outcome.
 *
 * @typedef {Object} TaskOutcome
 * @property {string} taskId - 任务 ID / Task ID
 * @property {boolean} success - 是否成功 / Whether successful
 * @property {Object} [output] - 最终输出 / Final output
 * @property {string} [error] - 错误信息 / Error message
 * @property {number} durationMs - 总耗时 / Total duration in milliseconds
 * @property {Array<Contribution>} contributions - 贡献列表 / List of contributions
 */

/**
 * 层级变更结果 / Tier change result
 * 代理层级变更操作的结果。
 * Result of an agent tier change operation.
 *
 * @typedef {Object} TierChangeResult
 * @property {string} agentId - 代理 ID / Agent ID
 * @property {string} previousTier - 原层级 / Previous tier
 * @property {string} newTier - 新层级 / New tier
 * @property {string} reason - 变更原因 / Reason for change
 * @property {string} timestamp - 变更时间 / Change timestamp
 */

/**
 * 分配结果 / Allocation result
 * 资源或任务分配操作的结果。
 * Result of a resource or task allocation operation.
 *
 * @typedef {Object} AllocationResult
 * @property {string} taskId - 任务 ID / Task ID
 * @property {string} agentId - 被分配的代理 ID / Allocated agent ID
 * @property {string} roleId - 分配的角色 ID / Allocated role ID
 * @property {number} matchScore - 匹配分数 / Match score
 * @property {string} [reason] - 分配理由 / Allocation reason
 */

// ============================================================================
// JSDoc 类型定义 - v4.0 新增
// JSDoc Type Definitions - New in v4.0
// ============================================================================

/**
 * 信息素信号 / Pheromone signal
 * 代理通过信息素系统发出的信号，用于间接协作（stigmergy）。
 * A signal emitted by agents through the pheromone system for indirect collaboration (stigmergy).
 *
 * @typedef {Object} PheromoneSignal
 * @property {string} id - 信号唯一标识 / Unique signal identifier
 * @property {string} type - 信息素类型 / Pheromone type (see PheromoneType)
 * @property {string} sourceId - 发出信号的代理 ID / ID of the agent that emitted the signal
 * @property {string} targetScope - 目标范围（如任务 ID、区域标识）/ Target scope (e.g., task ID, zone identifier)
 * @property {number} intensity - 信号强度 (0-1) / Signal intensity (0-1)
 * @property {Object} payload - 信号携带的数据负载 / Data payload carried by the signal
 * @property {number} decayRate - 衰减率（每秒衰减比例）/ Decay rate (proportion decayed per second)
 * @property {string} createdAt - 创建时间 / Creation timestamp
 * @property {string} updatedAt - 最后更新时间 / Last updated timestamp
 * @property {string} expiresAt - 过期时间 / Expiration timestamp
 */

/**
 * 人格模板 / Persona template
 * 定义代理的行为人格和灵魂片段，影响其决策和协作风格。
 * Defines an agent's behavioral persona and soul snippet, influencing its decision-making and collaboration style.
 *
 * @typedef {Object} PersonaTemplate
 * @property {string} id - 模板唯一标识 / Unique template identifier
 * @property {string} name - 模板名称 / Template name
 * @property {string} description - 模板描述 / Template description
 * @property {Object} personality - 人格特征参数 / Personality trait parameters
 * @property {number} personality.curiosity - 好奇心 (0-1) / Curiosity (0-1)
 * @property {number} personality.caution - 谨慎度 (0-1) / Caution (0-1)
 * @property {number} personality.independence - 独立性 (0-1) / Independence (0-1)
 * @property {number} personality.speed - 速度偏好 (0-1) / Speed preference (0-1)
 * @property {number} personality.thoroughness - 彻底性 (0-1) / Thoroughness (0-1)
 * @property {string} soulSnippet - 灵魂片段（系统提示词的核心部分）/ Soul snippet (core portion of the system prompt)
 * @property {Array<string>} bestFor - 最适合的任务类型 / Task types best suited for
 * @property {string} collaborationStyle - 协作风格 / Collaboration style
 */

/**
 * 对等节点条目 / Peer entry
 * 集群中已知对等代理的注册信息。
 * Registration information for a known peer agent in the cluster.
 *
 * @typedef {Object} PeerEntry
 * @property {string} id - 对等节点唯一标识 / Unique peer identifier
 * @property {string} label - 显示标签 / Display label
 * @property {string} name - 节点名称 / Node name
 * @property {string} model - 使用的模型标识 / Model identifier in use
 * @property {Array<string>} skills - 技能标签列表 / List of skill tags
 * @property {string} status - 节点状态 / Node status (see AgentStatus)
 */

/**
 * 挣扎结果 / Struggle result
 * 检测代理是否在当前任务上遇到困难的分析结果。
 * Analysis result for detecting whether an agent is struggling with the current task.
 *
 * @typedef {Object} StruggleResult
 * @property {boolean} struggling - 是否正在挣扎 / Whether the agent is struggling
 * @property {string} [suggestion] - 建议措施（如请求帮助、降级任务等）/ Suggested action (e.g., request help, downgrade task, etc.)
 * @property {number} failureCount - 窗口期内的失败次数 / Number of failures within the window
 * @property {number} windowSize - 检测窗口大小（任务数）/ Detection window size (number of tasks)
 */
