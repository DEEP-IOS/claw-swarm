/**
 * @file config-schemas.js
 * @description Claw-Swarm V5.0 L1 Infrastructure - Configuration Validation Schemas
 *              Claw-Swarm V5.0 L1 基础设施层 - 配置验证模式
 *
 * Defines zod schemas for the entire Claw-Swarm V5.0 configuration,
 * merging v4.x options with V5.0 new features (MoE routing, ABC scheduler,
 * contract net, three-layer memory, governance, etc.).
 * 定义 Claw-Swarm V5.0 整体配置的 zod 模式，
 * 合并 v4.x 选项与 V5.0 新特性（MoE 路由、ABC 调度器、合同网、三层记忆、治理等）。
 */

import { z } from 'zod';

// ─── Orchestration Sub-Schemas | 编排子模式 ─────────────────────────────────

/** MoE (Mixture-of-Experts) routing configuration | MoE 路由配置 */
const MoeRoutingSchema = z.object({
  /** Whether MoE routing is enabled | 是否启用 MoE 路由 */
  enabled: z.boolean().default(true),
  /** Number of top experts to select | 选取的前 K 个专家数 */
  topK: z.number().int().min(1).max(10).default(3),
  /** Fall back to regex matching if MoE confidence is low | MoE 置信度低时回退到正则匹配 */
  fallbackRegex: z.boolean().default(true),
  /** Minimum confidence threshold for expert selection | 专家选择的最小置信度阈值 */
  minConfidence: z.number().min(0).max(1).default(0.3),
}).default({});

/** ABC (Artificial Bee Colony) scheduler configuration | ABC 人工蜂群调度器配置 */
const AbcSchedulerSchema = z.object({
  /** Whether ABC scheduler is enabled | 是否启用 ABC 调度器 */
  enabled: z.boolean().default(false),
  /** Ratio of employed bees | 雇佣蜂比例 */
  employedRatio: z.number().min(0).max(1).default(0.5),
  /** Ratio of onlooker bees | 旁观蜂比例 */
  onlookerRatio: z.number().min(0).max(1).default(0.45),
  /** Ratio of scout bees | 侦察蜂比例 */
  scoutRatio: z.number().min(0).max(1).default(0.05),
}).default({});

/** Contract net protocol configuration | 合同网协议配置 */
const ContractNetSchema = z.object({
  /** Whether contract net is enabled | 是否启用合同网 */
  enabled: z.boolean().default(false),
  /** Timeout for bid collection in milliseconds | 投标收集超时时间（毫秒） */
  bidTimeoutMs: z.number().int().min(1000).default(5000),
}).default({});

/** Dynamic priority adjustment configuration | 动态优先级调整配置 */
const DynamicPrioritySchema = z.object({
  /** Whether dynamic priority is enabled | 是否启用动态优先级 */
  enabled: z.boolean().default(true),
}).default({});

/** Orchestration configuration | 编排配置 */
const OrchestrationSchema = z.object({
  /** Whether orchestration is enabled | 是否启用编排 */
  enabled: z.boolean().default(true),
  /** Maximum number of concurrent workers | 最大并发工作者数 */
  maxWorkers: z.number().int().min(1).max(64).default(16),
  /** Default execution strategy | 默认执行策略 */
  defaultStrategy: z.enum(['simulated', 'live']).default('simulated'),
  /** Execution mode: auto/manual/semi-auto/dependency | 执行模式 */
  executionMode: z.enum(['auto', 'manual', 'semi-auto', 'dependency']).default('dependency'),
  /** Role execution timeout in milliseconds | 角色执行超时时间（毫秒） */
  roleTimeout: z.number().int().min(10000).max(3600000).default(300000),
  /** Monitor verbosity level | 监控详细程度 */
  monitorMode: z.enum(['none', 'basic', 'default', 'detailed', 'verbose']).default('default'),
  /** Maximum description length for tasks | 任务描述最大长度 */
  maxDescriptionLength: z.number().int().default(10000),
  /** Maximum number of roles allowed | 最大角色数 */
  maxRoles: z.number().int().min(1).max(50).default(8),
  /** Rate limit: maximum tasks dispatched per minute | 速率限制：每分钟最大任务数 */
  maxTasksPerMinute: z.number().int().min(1).default(60),
  // V5.0 new features | V5.0 新特性
  /** MoE routing configuration (V5.0) | MoE 路由配置（V5.0） */
  moeRouting: MoeRoutingSchema,
  /** ABC scheduler configuration (V5.0) | ABC 调度器配置（V5.0） */
  abcScheduler: AbcSchedulerSchema,
  /** Cooldown between re-planning attempts in ms (V5.0) | 重新规划尝试间隔毫秒数（V5.0） */
  replanCooldownMs: z.number().int().min(1000).default(30000),
  /** Contract net protocol configuration (V5.0) | 合同网协议配置（V5.0） */
  contractNet: ContractNetSchema,
  /** Dynamic priority configuration (V5.0) | 动态优先级配置（V5.0） */
  dynamicPriority: DynamicPrioritySchema,
}).default({});

// ─── Memory Sub-Schemas | 记忆子模式 ────────────────────────────────────────

/** Episodic memory configuration (V5.0 three-layer memory) | 情景记忆配置（V5.0 三层记忆） */
const EpisodicMemorySchema = z.object({
  /** Maximum number of episodic events to retain | 保留的最大情景事件数 */
  maxEvents: z.number().int().default(1000),
  /** Minimum importance score to persist an event | 持久化事件的最小重要性分数 */
  importanceThreshold: z.number().min(0).max(1).default(0.3),
  /** Exponential decay lambda in days | 指数衰减 lambda（天） */
  decayLambdaDays: z.number().min(1).default(30),
}).default({});

/** Working memory configuration (V5.0 three-layer memory) | 工作记忆配置（V5.0 三层记忆） */
const WorkingMemorySchema = z.object({
  /** Number of high-priority focus slots | 高优先级焦点槽位数 */
  focusSlots: z.number().int().min(1).max(10).default(5),
  /** Number of contextual background slots | 上下文背景槽位数 */
  contextSlots: z.number().int().min(5).max(30).default(15),
  /** Maximum characters in the scratchpad area | 草稿区最大字符数 */
  scratchpadMaxChars: z.number().int().default(2000),
}).default({});

/** Knowledge graph configuration (V5.0 three-layer memory) | 知识图谱配置（V5.0 三层记忆） */
const KnowledgeGraphSchema = z.object({
  /** Maximum depth for graph traversal queries | 图遍历查询的最大深度 */
  maxTraversalDepth: z.number().int().min(1).max(10).default(3),
  /** Minimum importance for nodes to be included in results | 节点被包含在结果中的最小重要性 */
  minImportance: z.number().min(0).max(1).default(0.3),
}).default({});

/** Memory subsystem configuration | 记忆子系统配置 */
const MemorySchema = z.object({
  /** Whether memory is enabled | 是否启用记忆 */
  enabled: z.boolean().default(true),
  /** Maximum characters to prepend from memory context | 从记忆上下文中预置的最大字符数 */
  maxPrependChars: z.number().int().default(4000),
  /** Maximum characters per individual message | 单条消息的最大字符数 */
  maxMsgChars: z.number().int().default(500),
  /** Number of recent messages to include | 包含的最近消息数 */
  maxRecentMsgs: z.number().int().default(3),
  /** Number of recent tool calls to include | 包含的最近工具调用数 */
  maxRecentTools: z.number().int().default(5),
  /** Maximum number of modified files to track | 追踪的最大修改文件数 */
  maxModifiedFiles: z.number().int().default(20),
  /** Tool names that count as file-modifying operations | 计为文件修改操作的工具名称 */
  fileModifyTools: z.array(z.string()).default(['write', 'edit', 'create', 'write_file']),
  /** Path to import external OME data | 导入外部 OME 数据的路径 */
  importOmePath: z.string().nullable().default(null),
  // V5.0 new: three-layer memory | V5.0 新增：三层记忆
  /** Episodic memory layer (V5.0) | 情景记忆层（V5.0） */
  episodic: EpisodicMemorySchema,
  /** Working memory layer (V5.0) | 工作记忆层（V5.0） */
  workingMemory: WorkingMemorySchema,
  /** Knowledge graph layer (V5.0) | 知识图谱层（V5.0） */
  knowledgeGraph: KnowledgeGraphSchema,
}).default({});

// ─── Pheromone Sub-Schemas | 信息素子模式 ────────────────────────────────────

/** MMAS (Max-Min Ant System) bounds configuration | MMAS 最大最小蚂蚁系统边界配置 */
const MmasBoundsSchema = z.object({
  /** Minimum pheromone intensity (prevents starvation) | 最小信息素强度（防止饥饿） */
  min: z.number().min(0).default(0.05),
  /** Maximum pheromone intensity (prevents dominance) | 最大信息素强度（防止支配） */
  max: z.number().min(0.1).default(5.0),
}).default({});

/** Per-pheromone-type default settings | 每种信息素类型的默认设置 */
const PheromoneTypeDefaultSchema = z.object({
  /** Decay rate per interval (0-1) | 每个区间的衰减率（0-1） */
  decayRate: z.number().min(0).max(1).default(0.01),
  /** Maximum time-to-live in minutes | 最大存活时间（分钟） */
  maxTTLMinutes: z.number().int().min(1).default(120),
});

/** Pheromone subsystem configuration | 信息素子系统配置 */
const PheromoneSchema = z.object({
  /** Whether pheromone system is enabled | 是否启用信息素系统 */
  enabled: z.boolean().default(true),
  /** Interval between decay cycles in milliseconds | 衰减周期间隔（毫秒） */
  decayIntervalMs: z.number().int().min(10000).default(60000),
  /** Maximum number of active pheromones | 最大活跃信息素数 */
  maxPheromones: z.number().int().min(100).default(1000),
  /** MMAS bounds for pheromone intensities | 信息素强度的 MMAS 边界 */
  mmasBounds: MmasBoundsSchema,
  /** Whether custom pheromone types are allowed | 是否允许自定义信息素类型 */
  customTypes: z.object({
    enabled: z.boolean().default(true),
  }).default({}),
  /** Default settings per built-in pheromone type | 每种内置信息素类型的默认设置 */
  defaults: z.record(PheromoneTypeDefaultSchema).default({
    trail: { decayRate: 0.01, maxTTLMinutes: 120 },
    alarm: { decayRate: 0.05, maxTTLMinutes: 30 },
    recruit: { decayRate: 0.02, maxTTLMinutes: 60 },
    queen: { decayRate: 0.005, maxTTLMinutes: 240 },
    dance: { decayRate: 0.03, maxTTLMinutes: 45 },
  }),
}).default({});

// ─── Governance Sub-Schemas | 治理子模式 ──────────────────────────────────────

/** Capability scoring dimensions and parameters | 能力评分维度与参数 */
const CapabilitySchema = z.object({
  /** Weight per scoring dimension (should sum to 1.0) | 各评分维度的权重（应总和为 1.0） */
  dimensions: z.record(z.number()).default({
    technical: 0.4, delivery: 0.3, collaboration: 0.2, innovation: 0.1,
  }),
  /** Score decay factor applied over time | 随时间应用的分数衰减因子 */
  decayFactor: z.number().min(0).max(1).default(0.9),
  /** Starting score for new agents | 新代理的初始分数 */
  initialScore: z.number().min(0).max(100).default(50),
  /** Maximum bonus from historical performance | 历史表现的最大奖励 */
  maxHistoricalBonus: z.number().default(10),
}).default({});

/** Tier definition for governance tiers | 治理层级定义 */
const TierEntrySchema = z.object({
  /** Minimum capability score to qualify | 达到该层级的最低能力分数 */
  minScore: z.number(),
  /** Maximum concurrent tasks allowed (optional) | 允许的最大并发任务数（可选） */
  taskLimit: z.number().int().optional(),
});

/** Voting configuration for governance decisions | 治理决策的投票配置 */
const VotingSchema = z.object({
  /** Vote ratio needed for promotion | 晋升所需的投票比例 */
  promotionThreshold: z.number().min(0).max(1).default(0.6),
  /** Vote ratio needed for admission | 准入所需的投票比例 */
  admissionThreshold: z.number().min(0).max(1).default(0.5),
  /** Hours before a vote expires | 投票过期前的小时数 */
  voteExpiryHours: z.number().int().default(24),
}).default({});

/** Task allocation weight configuration | 任务分配权重配置 */
const AllocationSchema = z.object({
  /** Weight for skill match scoring | 技能匹配评分权重 */
  skillWeight: z.number().default(0.4),
  /** Weight for historical performance | 历史表现权重 */
  historyWeight: z.number().default(0.3),
  /** Weight for current load balancing | 当前负载均衡权重 */
  loadWeight: z.number().default(0.2),
  /** Weight for collaboration affinity | 协作亲和度权重 */
  collaborationWeight: z.number().default(0.1),
}).default({});

/** Contribution scoring multipliers | 贡献评分乘数 */
const ContributionSchema = z.object({
  /** Base multiplier for contribution calculation | 贡献计算的基础乘数 */
  baseMultiplier: z.number().default(10),
  /** Bonus multiplier for timely delivery | 按时交付的奖励乘数 */
  timeBonus: z.number().default(1.2),
  /** Bonus multiplier for innovative solutions | 创新方案的奖励乘数 */
  innovationBonus: z.number().default(1.3),
  /** Bonus multiplier for collaboration quality | 协作质量的奖励乘数 */
  collaborationBonus: z.number().default(1.1),
}).default({});

/** Auto-evaluation configuration | 自动评估配置 */
const AutoEvaluationSchema = z.object({
  /** Whether automatic periodic evaluation is enabled | 是否启用自动定期评估 */
  enabled: z.boolean().default(false),
  /** Interval between evaluations in milliseconds | 评估间隔（毫秒） */
  intervalMs: z.number().int().default(86400000),
}).default({});

/** Governance subsystem configuration | 治理子系统配置 */
const GovernanceSchema = z.object({
  /** Whether governance is enabled | 是否启用治理 */
  enabled: z.boolean().default(false),
  /** Capability scoring configuration | 能力评分配置 */
  capability: CapabilitySchema,
  /** Tier definitions mapping tier name to requirements | 层级定义：层级名称到要求的映射 */
  tiers: z.record(TierEntrySchema).default({
    trainee: { minScore: 0, taskLimit: 2 },
    junior: { minScore: 60, taskLimit: 4 },
    mid: { minScore: 75, taskLimit: 8 },
    senior: { minScore: 85, taskLimit: 12 },
    lead: { minScore: 92, taskLimit: 16 },
  }),
  /** Voting configuration | 投票配置 */
  voting: VotingSchema,
  /** Task allocation weights | 任务分配权重 */
  allocation: AllocationSchema,
  /** Contribution scoring multipliers | 贡献评分乘数 */
  contribution: ContributionSchema,
  /** Auto-evaluation settings | 自动评估设置 */
  autoEvaluation: AutoEvaluationSchema,
}).default({});

// ─── Remaining Top-Level Sub-Schemas | 其余顶层子模式 ─────────────────────────

/** Soul / persona subsystem configuration | 灵魂/角色子系统配置 */
const SoulSchema = z.object({
  /** Whether soul/persona system is enabled | 是否启用灵魂/角色系统 */
  enabled: z.boolean().default(true),
  /** Persona definitions (free-form per persona) | 角色定义（每个角色自由格式） */
  personas: z.record(z.any()).default({}),
}).default({});

/** Collaboration subsystem configuration | 协作子系统配置 */
const CollaborationSchema = z.object({
  /** Whether collaboration features are enabled | 是否启用协作功能 */
  enabled: z.boolean().default(true),
  /** Whether the mention fixer is active | 是否启用提及修复器 */
  mentionFixer: z.boolean().default(true),
  /** Window size for struggle detection (number of recent attempts) | 挣扎检测的窗口大小（最近尝试次数） */
  struggleWindowSize: z.number().int().default(5),
  /** Failure count within window to trigger struggle alert | 窗口内触发挣扎警报的失败次数 */
  struggleFailureThreshold: z.number().int().default(3),
}).default({});

/** Zone partitioning configuration | 区域分区配置 */
const ZonesSchema = z.object({
  /** Whether zone partitioning is enabled | 是否启用区域分区 */
  enabled: z.boolean().default(false),
  /** Maximum agents allowed per zone | 每个区域允许的最大代理数 */
  maxAgentsPerZone: z.number().int().default(50),
  /** Ratio of supervisors to total agents in each zone | 每个区域中监督者与总代理的比例 */
  supervisorRatio: z.number().min(0).max(1).default(0.1),
}).default({});

/** Dashboard UI configuration | 仪表板 UI 配置 */
const DashboardSchema = z.object({
  /** Whether the dashboard server is enabled | 是否启用仪表板服务器 */
  enabled: z.boolean().default(false),
  /** Port for the dashboard HTTP server | 仪表板 HTTP 服务器端口 */
  port: z.number().int().min(1024).max(65535).default(19100),
  /** Host binding for the dashboard server | 仪表板服务器绑定的主机 */
  host: z.string().default('localhost'),
}).default({});

// ─── Root Config Schema | 根配置模式 ─────────────────────────────────────────

/**
 * Root configuration schema for the entire Claw-Swarm V5.0 system.
 * Uses strict mode to reject unknown properties.
 * Claw-Swarm V5.0 系统的根配置模式。使用严格模式拒绝未知属性。
 */
export const ConfigSchema = z.object({
  /** Log level for the system | 系统日志级别 */
  logLevel: z.enum(['debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  /** Path to the database file (null = in-memory) | 数据库文件路径（null = 内存模式） */
  dbPath: z.string().nullable().default(null),

  /** Orchestration configuration | 编排配置 */
  orchestration: OrchestrationSchema,
  /** Memory configuration | 记忆配置 */
  memory: MemorySchema,
  /** Pheromone configuration | 信息素配置 */
  pheromone: PheromoneSchema,
  /** Governance configuration | 治理配置 */
  governance: GovernanceSchema,
  /** Soul / persona configuration | 灵魂/角色配置 */
  soul: SoulSchema,
  /** Collaboration configuration | 协作配置 */
  collaboration: CollaborationSchema,
  /** Zone partitioning configuration | 区域分区配置 */
  zones: ZonesSchema,
  /** Dashboard configuration | 仪表板配置 */
  dashboard: DashboardSchema,
}).strict();

// ─── Exports | 导出 ──────────────────────────────────────────────────────────

/**
 * Default configuration derived by parsing an empty object through the schema.
 * All defaults are populated automatically by zod.
 * 通过模式解析空对象得到的默认配置。所有默认值由 zod 自动填充。
 */
export const DEFAULT_CONFIG = ConfigSchema.parse({});

/**
 * Merge user-provided config with schema defaults.
 * Missing fields are filled with defaults; invalid values throw ZodError.
 * 将用户提供的配置与模式默认值合并。
 * 缺失字段用默认值填充；无效值抛出 ZodError。
 *
 * @param {object} userConfig - Partial user configuration | 用户部分配置
 * @returns {object} Fully validated and merged configuration | 完全验证并合并的配置
 */
export function mergeConfig(userConfig = {}) {
  return ConfigSchema.parse(userConfig);
}

/**
 * Validate a configuration object against the schema.
 * Throws ZodError if validation fails.
 * 根据模式验证配置对象。验证失败时抛出 ZodError。
 *
 * @param {object} config - Configuration to validate | 要验证的配置
 * @returns {object} Validated configuration | 验证后的配置
 * @throws {z.ZodError} When validation fails | 验证失败时
 */
export function validateConfig(config) {
  return ConfigSchema.parse(config);
}
