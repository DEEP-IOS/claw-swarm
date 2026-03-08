/**
 * @file message-schemas.js
 * @description Claw-Swarm V5.0 L1 Infrastructure - Message Validation Schemas
 *              Claw-Swarm V5.0 L1 基础设施层 - 消息验证模式
 *
 * Defines zod schemas for all message types used on the MessageBus.
 * Each message has a standard header plus type-specific payload fields.
 * 定义 MessageBus 上所有消息类型的 zod 模式。
 * 每条消息都有标准头部加上类型特定的负载字段。
 */

import { z } from 'zod';

// ─── Message Categories | 消息类别 ───────────────────────────────────────────

/**
 * Enumeration of message categories used in the system.
 * 系统中使用的消息类别枚举。
 */
export const MessageCategory = z.enum([
  'pheromone',     // Pheromone signaling | 信息素信号
  'task',          // Task lifecycle | 任务生命周期
  'negotiation',   // Contract net negotiation | 合同网协商
  'broadcast',     // Pub/sub broadcast | 发布/订阅广播
  'system',        // System commands | 系统命令
  'gate',          // Quality gate results | 质量门结果
  'transition',    // State transitions | 状态转换
]);

// ─── Message Header Schema | 消息头部模式 ────────────────────────────────────

/**
 * Standard header present on every message in the system.
 * 系统中每条消息都包含的标准头部。
 *
 * @property {string} messageId     - Unique identifier for this message | 此消息的唯一标识符
 * @property {string} correlationId - ID linking related messages together | 关联相关消息的 ID
 * @property {string} senderId      - ID of the sending agent/component | 发送方代理/组件的 ID
 * @property {string} receiverId    - ID of the target agent/component (* = broadcast) | 目标代理/组件的 ID（* = 广播）
 * @property {number} timestamp     - Unix timestamp in milliseconds | Unix 时间戳（毫秒）
 * @property {string} type          - Message type identifier | 消息类型标识符
 * @property {string} category      - Message category | 消息类别
 */
export const MessageHeaderSchema = z.object({
  /** Unique message identifier (UUID) | 唯一消息标识符（UUID） */
  messageId: z.string().min(1),
  /** Correlation ID for linking request/response chains | 用于链接请求/响应链的关联 ID */
  correlationId: z.string().min(1),
  /** Sender agent or component ID | 发送方代理或组件 ID */
  senderId: z.string().min(1),
  /** Receiver agent or component ID (* for broadcast) | 接收方代理或组件 ID（* 表示广播） */
  receiverId: z.string().min(1),
  /** Timestamp in milliseconds since epoch | 自纪元以来的毫秒时间戳 */
  timestamp: z.number().int().positive(),
  /** Message type identifier | 消息类型标识符 */
  type: z.string().min(1),
  /** Message category for routing | 用于路由的消息类别 */
  category: MessageCategory,
});

// ─── Pheromone Message Schema | 信息素消息模式 ───────────────────────────────

/**
 * Pheromone signal message for stigmergic coordination.
 * Used to deposit, reinforce, or query pheromone trails.
 * 用于共享环境协调的信息素信号消息。用于沉积、增强或查询信息素踪迹。
 */
export const PheromoneMessageSchema = z.object({
  /** Standard message header | 标准消息头部 */
  header: MessageHeaderSchema,
  /** Type of pheromone (e.g., trail, alarm, recruit, queen, dance) | 信息素类型 */
  pheromoneType: z.string().min(1),
  /** Scope of the pheromone target (file path, zone, task ID, etc.) | 信息素目标范围 */
  targetScope: z.string().min(1),
  /** Pheromone intensity value | 信息素强度值 */
  intensity: z.number().min(0),
  /** Arbitrary payload data associated with the pheromone | 与信息素关联的任意负载数据 */
  payload: z.any().default(null),
  /** Decay rate override for this specific deposit (0-1) | 此次沉积的衰减率覆盖值（0-1） */
  decayRate: z.number().min(0).max(1).optional(),
});

// ─── Task Message Schema | 任务消息模式 ──────────────────────────────────────

/**
 * Task lifecycle message for creating, updating, or cancelling tasks.
 * 用于创建、更新或取消任务的任务生命周期消息。
 */
export const TaskMessageSchema = z.object({
  /** Standard message header | 标准消息头部 */
  header: MessageHeaderSchema,
  /** Unique task identifier | 唯一任务标识符 */
  taskId: z.string().min(1),
  /** Action to perform on the task | 对任务执行的操作 */
  action: z.enum(['create', 'update', 'cancel']),
  /** Task configuration (required for create, optional for update) | 任务配置（创建时必需，更新时可选） */
  config: z.object({
    /** Human-readable task title | 人类可读的任务标题 */
    title: z.string().optional(),
    /** Task description | 任务描述 */
    description: z.string().optional(),
    /** Task priority (higher = more urgent) | 任务优先级（越高越紧急） */
    priority: z.number().int().min(0).max(100).optional(),
    /** Required skills/tags for task assignment | 任务分配所需的技能/标签 */
    requiredSkills: z.array(z.string()).optional(),
    /** Task dependencies (IDs of tasks that must complete first) | 任务依赖（必须先完成的任务 ID） */
    dependencies: z.array(z.string()).optional(),
    /** Deadline timestamp in milliseconds | 截止时间戳（毫秒） */
    deadline: z.number().int().positive().optional(),
    /** Maximum retry attempts | 最大重试次数 */
    maxRetries: z.number().int().min(0).optional(),
    /** Arbitrary metadata for the task | 任务的任意元数据 */
    metadata: z.record(z.any()).optional(),
  }).optional(),
  /** Current task status (used in update messages) | 当前任务状态（用于更新消息） */
  status: z.enum([
    'pending',       // 等待中
    'assigned',      // 已分配
    'in_progress',   // 进行中
    'blocked',       // 阻塞
    'completed',     // 已完成
    'failed',        // 失败
    'cancelled',     // 已取消
  ]).optional(),
});

// ─── Negotiation Message Schema | 协商消息模式 ───────────────────────────────

/**
 * Contract net protocol negotiation message.
 * Supports the four phases: CFP, Bid, Award, Reject.
 * 合同网协议协商消息。支持四个阶段：CFP、投标、授予、拒绝。
 */
export const NegotiationMessageSchema = z.object({
  /** Standard message header | 标准消息头部 */
  header: MessageHeaderSchema,
  /** Current negotiation phase | 当前协商阶段 */
  phase: z.enum([
    'cfp',    // Call For Proposals - manager broadcasts task | 征求建议书 - 管理者广播任务
    'bid',    // Bid - contractor submits a proposal | 投标 - 承包者提交方案
    'award',  // Award - manager selects a contractor | 授予 - 管理者选择承包者
    'reject', // Reject - manager rejects a bid | 拒绝 - 管理者拒绝投标
  ]),
  /** Call For Proposals identifier (links bids to the original CFP) | 征求建议书标识符（将投标链接到原始 CFP） */
  cfpId: z.string().min(1),
  /** Phase-specific content | 阶段特定内容 */
  content: z.object({
    /** Task description (for CFP phase) | 任务描述（用于 CFP 阶段） */
    taskDescription: z.string().optional(),
    /** Required capabilities (for CFP phase) | 所需能力（用于 CFP 阶段） */
    requiredCapabilities: z.array(z.string()).optional(),
    /** Bid value / confidence score (for bid phase, 0-1) | 投标值/置信度分数（用于投标阶段，0-1） */
    bidScore: z.number().min(0).max(1).optional(),
    /** Estimated completion time in ms (for bid phase) | 预计完成时间毫秒数（用于投标阶段） */
    estimatedTimeMs: z.number().int().positive().optional(),
    /** Reason for award or rejection | 授予或拒绝的原因 */
    reason: z.string().optional(),
    /** Additional arbitrary data | 额外的任意数据 */
    metadata: z.record(z.any()).optional(),
  }),
});

// ─── Broadcast Message Schema | 广播消息模式 ─────────────────────────────────

/**
 * Pub/sub broadcast message for topic-based communication.
 * 用于基于主题通信的发布/订阅广播消息。
 */
export const BroadcastMessageSchema = z.object({
  /** Standard message header | 标准消息头部 */
  header: MessageHeaderSchema,
  /** Broadcast topic (subscribers filter by topic) | 广播主题（订阅者按主题过滤） */
  topic: z.string().min(1),
  /** Broadcast payload data | 广播负载数据 */
  data: z.any(),
  /** Optional time-to-live in milliseconds (message expires after TTL) | 可选的生存时间毫秒数（消息在 TTL 后过期） */
  ttl: z.number().int().positive().optional(),
});

// ─── System Message Schema | 系统消息模式 ────────────────────────────────────

/**
 * System-level command message for infrastructure operations.
 * 用于基础设施操作的系统级命令消息。
 */
export const SystemMessageSchema = z.object({
  /** Standard message header | 标准消息头部 */
  header: MessageHeaderSchema,
  /** System command to execute | 要执行的系统命令 */
  command: z.enum([
    'shutdown',         // Graceful shutdown | 优雅关闭
    'restart',          // Restart component | 重启组件
    'pause',            // Pause processing | 暂停处理
    'resume',           // Resume processing | 恢复处理
    'health_check',     // Health check request | 健康检查请求
    'config_reload',    // Reload configuration | 重新加载配置
    'metrics_request',  // Request metrics snapshot | 请求指标快照
    'log_level_change', // Change log level | 更改日志级别
    'drain',            // Drain in-flight work | 排空进行中的工作
    'ping',             // Ping / keep-alive | Ping / 保活
  ]),
  /** Optional arguments for the command | 命令的可选参数 */
  args: z.record(z.any()).optional(),
});

// ─── Gate Result Message Schema | 质量门结果消息模式 ─────────────────────────

/**
 * Quality gate evaluation result message.
 * Reports the outcome of a role's work being checked by a gate.
 * 质量门评估结果消息。报告角色工作经质量门检查后的结果。
 */
export const GateResultMessageSchema = z.object({
  /** Standard message header | 标准消息头部 */
  header: MessageHeaderSchema,
  /** ID of the task being evaluated | 被评估的任务 ID */
  taskId: z.string().min(1),
  /** Name of the role whose output was evaluated | 其输出被评估的角色名称 */
  roleName: z.string().min(1),
  /** Gate decision | 质量门决策 */
  decision: z.enum([
    'pass',  // Output meets quality standards | 输出符合质量标准
    'retry', // Output needs revision, retry the role | 输出需要修订，重试该角色
    'abort', // Output is unrecoverable, abort the task | 输出不可恢复，中止任务
  ]),
  /** Quality score (0-100) | 质量分数（0-100） */
  score: z.number().min(0).max(100),
  /** Optional detailed evaluation information | 可选的详细评估信息 */
  details: z.object({
    /** List of issues found | 发现的问题列表 */
    issues: z.array(z.string()).optional(),
    /** Suggestions for improvement | 改进建议 */
    suggestions: z.array(z.string()).optional(),
    /** Evaluator comments | 评估者评论 */
    comments: z.string().optional(),
    /** Number of retry attempts so far | 到目前为止的重试次数 */
    retryCount: z.number().int().min(0).optional(),
    /** Maximum allowed retries | 最大允许重试次数 */
    maxRetries: z.number().int().min(0).optional(),
    /** Arbitrary evaluation metadata | 任意评估元数据 */
    metadata: z.record(z.any()).optional(),
  }).optional(),
});

// ─── State Transition Message Schema | 状态转换消息模式 ──────────────────────

/**
 * State transition notification for tasks or roles.
 * Emitted whenever an entity moves from one state to another.
 * 任务或角色的状态转换通知。每当实体从一个状态移动到另一个状态时发出。
 */
export const StateTransitionMessageSchema = z.object({
  /** Standard message header | 标准消息头部 */
  header: MessageHeaderSchema,
  /** ID of the task undergoing the transition | 正在转换的任务 ID */
  taskId: z.string().min(1),
  /** Name of the role involved (optional, for role-level transitions) | 涉及的角色名称（可选，用于角色级转换） */
  roleName: z.string().min(1).optional(),
  /** State before the transition | 转换前的状态 */
  fromState: z.string().min(1),
  /** State after the transition | 转换后的状态 */
  toState: z.string().min(1),
  /** Optional reason for the transition | 转换的可选原因 */
  reason: z.string().optional(),
});

// ─── Schema Registry | 模式注册表 ────────────────────────────────────────────

/**
 * Registry mapping message category to its corresponding schema.
 * Useful for dynamic validation based on message category.
 * 将消息类别映射到其对应模式的注册表。用于基于消息类别的动态验证。
 */
export const MessageSchemaRegistry = {
  pheromone: PheromoneMessageSchema,
  task: TaskMessageSchema,
  negotiation: NegotiationMessageSchema,
  broadcast: BroadcastMessageSchema,
  system: SystemMessageSchema,
  gate: GateResultMessageSchema,
  transition: StateTransitionMessageSchema,
};

// ─── Validation Helpers | 验证辅助函数 ───────────────────────────────────────

/**
 * Validate a message against a given zod schema.
 * Returns the parsed (and potentially defaulted) message on success.
 * Throws ZodError on validation failure.
 * 根据给定的 zod 模式验证消息。
 * 成功时返回解析后（可能已填充默认值）的消息。
 * 验证失败时抛出 ZodError。
 *
 * @param {z.ZodSchema} schema - The zod schema to validate against | 要验证的 zod 模式
 * @param {object} data        - The message data to validate | 要验证的消息数据
 * @returns {object} The validated and parsed message | 验证并解析后的消息
 * @throws {z.ZodError} When validation fails | 验证失败时
 *
 * @example
 * // Validate a pheromone message | 验证信息素消息
 * const msg = validateMessage(PheromoneMessageSchema, rawData);
 */
export function validateMessage(schema, data) {
  return schema.parse(data);
}

/**
 * Safely validate a message without throwing.
 * Returns a zod SafeParseResult with { success, data?, error? }.
 * 安全地验证消息而不抛出异常。
 * 返回包含 { success, data?, error? } 的 zod SafeParseResult。
 *
 * @param {z.ZodSchema} schema - The zod schema to validate against | 要验证的 zod 模式
 * @param {object} data        - The message data to validate | 要验证的消息数据
 * @returns {z.SafeParseReturnType} Parse result with success flag | 包含成功标志的解析结果
 *
 * @example
 * // Safe validation | 安全验证
 * const result = safeValidateMessage(TaskMessageSchema, rawData);
 * if (result.success) {
 *   handleTask(result.data);
 * } else {
 *   console.error(result.error.issues);
 * }
 */
export function safeValidateMessage(schema, data) {
  return schema.safeParse(data);
}

/**
 * Validate a message by automatically detecting its category from the header.
 * Looks up the correct schema from the MessageSchemaRegistry.
 * 通过自动检测头部中的类别来验证消息。
 * 从 MessageSchemaRegistry 中查找正确的模式。
 *
 * @param {object} data - The raw message data (must have header.category) | 原始消息数据（必须有 header.category）
 * @returns {object} The validated message | 验证后的消息
 * @throws {Error} When the category is unknown or validation fails | 当类别未知或验证失败时
 *
 * @example
 * // Auto-detect and validate | 自动检测并验证
 * const validated = validateMessageAuto({ header: { category: 'task', ... }, ... });
 */
export function validateMessageAuto(data) {
  const category = data?.header?.category;
  if (!category) {
    throw new Error('Message must have header.category for auto-validation | 消息必须有 header.category 才能自动验证');
  }
  const schema = MessageSchemaRegistry[category];
  if (!schema) {
    throw new Error(`Unknown message category: "${category}" | 未知的消息类别: "${category}"`);
  }
  return schema.parse(data);
}
