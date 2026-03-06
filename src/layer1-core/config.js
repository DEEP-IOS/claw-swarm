/**
 * @file config.js
 * @module layer1-core/config
 * @version 4.0.0
 * @author DEEP-IOS
 *
 * 统一配置系统 — Claw-Swarm v4.0
 * Unified Configuration System — Claw-Swarm v4.0
 *
 * 本模块将 Swarm Lite v3.0 的编排/治理配置与 OME 的记忆配置合并为
 * 一个单一的、深度冻结的配置对象，包含 6 个可独立切换的子系统:
 *
 * This module merges Swarm Lite v3.0's orchestration/governance config and
 * OME's memory config into a single, deeply-frozen configuration object
 * with 6 independently toggleable subsystems:
 *
 *   1. orchestration  — 编排子系统 (源自 Swarm Lite v3.0)
 *   2. memory         — 记忆子系统 (源自 OME)
 *   3. pheromone      — 信息素子系统 (v4.0 新增)
 *   4. governance     — 治理子系统 (源自 Swarm Lite v3.0)
 *   5. soul           — 灵魂/人格子系统 (v4.0 新增)
 *   6. collaboration  — 协作子系统 (v4.0 新增)
 *
 * 每个子系统都有 `enabled` 开关，关闭时该子系统的验证将被跳过。
 * Each subsystem has an `enabled` toggle; validation is skipped when disabled.
 */

import path from 'node:path';
import os from 'node:os';

import {
  LogLevel,
  ExecutionStrategy,
  ExecutionMode,
  MonitorMode,
} from './types.js';

import { SwarmValidationError } from './errors.js';

// ---------------------------------------------------------------------------
// 已知顶层键 — 用于过滤用户配置中的未知字段
// Known top-level keys — used to filter unknown fields from user config
// ---------------------------------------------------------------------------
const KNOWN_TOP_KEYS = new Set([
  'logLevel',
  'dbPath',
  'orchestration',
  'memory',
  'pheromone',
  'governance',
  'soul',
  'collaboration',
]);

// ---------------------------------------------------------------------------
// 默认配置 — 深度冻结，运行时不可变
// Default configuration — deeply frozen, immutable at runtime
// ---------------------------------------------------------------------------
export const DEFAULT_CONFIG = Object.freeze({
  // === 全局 / Global ===
  logLevel: 'info',         // 日志级别 / log level
  dbPath: null,             // 数据库路径，运行时解析 / resolved at runtime

  // === 编排子系统 (源自 Swarm Lite v3.0) ===
  // === Orchestration subsystem (from Swarm Lite v3.0) ===
  orchestration: Object.freeze({
    enabled: true,
    maxWorkers: 16,                     // 最大并发工作者 / max concurrent workers
    defaultStrategy: 'simulated',       // 默认策略 / default strategy
    executionMode: 'dependency',        // 执行模式 / execution mode
    roleTimeout: 300000,                // 角色超时 (ms) / role timeout (ms)
    monitorMode: 'default',             // 监控模式 / monitor mode
    safety: Object.freeze({
      maxDescriptionLength: 10000,      // 描述最大长度 / max description length
      maxRoles: 8,                      // 最大角色数 / max roles
      maxTasksPerMinute: 60,            // 每分钟最大任务数 / max tasks per minute
    }),
  }),

  // === 记忆子系统 (源自 OME) ===
  // === Memory subsystem (from OME) ===
  memory: Object.freeze({
    enabled: true,
    maxPrependChars: 4000,              // 前置注入最大字符数 / max prepend chars
    maxMsgChars: 500,                   // 单条消息最大字符数 / max chars per message
    maxRecentMsgs: 3,                   // 最近消息保留数 / recent messages to keep
    maxRecentTools: 5,                  // 最近工具调用保留数 / recent tool calls to keep
    maxModifiedFiles: 20,               // 最大修改文件数 / max modified files tracked
    fileModifyTools: Object.freeze([
      'write', 'edit', 'create',
      'write_file', 'edit_file', 'create_file',
      'str_replace_editor', 'file_editor',
    ]),
    injection: Object.freeze({
      onNewSession: true,               // 新会话时注入 / inject on new session
      onGatewayRestart: true,           // 网关重启时注入 / inject on gateway restart
      minUserMessages: 1,               // 最少用户消息数 / min user messages before inject
    }),
    agentResolution: Object.freeze({
      preferCtxAgentId: true,           // 优先使用上下文 agentId / prefer context agentId
      fallbackToSessionKey: true,       // 回退到 sessionKey / fallback to sessionKey
      defaultAgentId: 'main',           // 默认 agentId / default agentId
    }),
    importOmePath: null,                // 现有 OME 数据库路径 (迁移用) / existing OME DB path for migration
  }),

  // === 信息素子系统 (v4.0 新增) ===
  // === Pheromone subsystem (NEW in v4.0) ===
  pheromone: Object.freeze({
    enabled: true,
    decayIntervalMs: 60000,             // 衰减检查间隔 (ms) / decay check interval (ms)
    maxPheromones: 1000,                // 最大信息素条目 / max pheromone entries
    defaults: Object.freeze({
      trail:   Object.freeze({ decayRate: 0.05, maxTTLMinutes: 120 }),  // 路径信息素 / trail pheromone
      alarm:   Object.freeze({ decayRate: 0.15, maxTTLMinutes: 30 }),   // 警报信息素 / alarm pheromone
      recruit: Object.freeze({ decayRate: 0.10, maxTTLMinutes: 60 }),   // 招募信息素 / recruit pheromone
      queen:   Object.freeze({ decayRate: 0.02, maxTTLMinutes: 480 }),  // 女王信息素 / queen pheromone
      dance:   Object.freeze({ decayRate: 0.08, maxTTLMinutes: 90 }),   // 舞蹈信息素 / dance pheromone
    }),
  }),

  // === 治理子系统 (源自 Swarm Lite v3.0) ===
  // === Governance subsystem (from Swarm Lite v3.0) ===
  governance: Object.freeze({
    enabled: false,                     // 默认关闭，需手动开启 / opt-in, disabled by default

    // 能力评估 / capability assessment
    capability: Object.freeze({
      dimensions: Object.freeze({
        technical:     Object.freeze({ weight: 0.4 }),
        delivery:      Object.freeze({ weight: 0.3 }),
        collaboration: Object.freeze({ weight: 0.2 }),
        innovation:    Object.freeze({ weight: 0.1 }),
      }),
      decayFactor: 0.9,                // 衰减因子 / decay factor
      maxHistoricalBonus: 10,           // 最大历史奖励 / max historical bonus
      initialScore: 50,                 // 初始分数 / initial score
    }),

    // 等级体系 / tier system
    tiers: Object.freeze({
      trainee: Object.freeze({ minScore: 0,  taskLimit: 3 }),
      junior:  Object.freeze({ minScore: 60, taskLimit: 5 }),
      mid:     Object.freeze({ minScore: 75, taskLimit: 10 }),
      senior:  Object.freeze({ minScore: 85, taskLimit: 15 }),
      lead:    Object.freeze({ minScore: 92, taskLimit: 20 }),
    }),

    // 投票机制 / voting mechanism
    voting: Object.freeze({
      promotionThreshold: 0.6,          // 晋升阈值 / promotion threshold
      admissionThreshold: 0.5,          // 准入阈值 / admission threshold
      voteExpiryHours: 24,              // 投票过期时间 (小时) / vote expiry (hours)
      maxVotesPerAgentPerDay: 20,       // 每日每代理最大投票数 / max votes per agent per day
    }),

    // 任务分配权重 / task allocation weights
    allocation: Object.freeze({
      skillWeight: 0.4,
      historyWeight: 0.3,
      loadWeight: 0.2,
      collaborationWeight: 0.1,
    }),

    // 贡献计算 / contribution calculation
    contribution: Object.freeze({
      baseMultiplier: 10,
      timeBonus: 1.2,
      innovationBonus: 1.3,
      collaborationBonus: 1.1,
    }),

    // 性能优化 / performance optimization
    performance: Object.freeze({
      cache: Object.freeze({ enabled: true, ttl: 300000 }),
      asyncQueue: Object.freeze({ enabled: true, batchSize: 10, flushInterval: 5000 }),
      precompute: Object.freeze({ enabled: true, updateInterval: 3600000 }),
    }),

    // 自动评估 / auto evaluation
    autoEvaluation: Object.freeze({
      enabled: false,
      interval: 86400000,               // 评估间隔 (ms) / evaluation interval (ms)
    }),
  }),

  // === 灵魂/人格子系统 (v4.0 新增) ===
  // === Soul subsystem (NEW in v4.0) ===
  soul: Object.freeze({
    enabled: true,
    personas: Object.freeze({}),        // 用户自定义人格覆盖 / user custom personas overlay
  }),

  // === 协作子系统 (v4.0 新增) ===
  // === Collaboration subsystem (NEW in v4.0) ===
  collaboration: Object.freeze({
    enabled: true,
    mentionFixer: true,                 // 自动修复 @mention / auto-fix @mentions
    struggleWindowSize: 5,              // 挣扎检测窗口 / struggle detection window
    struggleFailureThreshold: 3,        // 挣扎失败阈值 / struggle failure threshold
  }),
});

// ---------------------------------------------------------------------------
// deepMerge — 递归深合并，仅合并普通对象，数组和原始值直接覆盖
// Deep merge helper — recursively merges plain objects; arrays and primitives
// are overwritten directly.
// ---------------------------------------------------------------------------
function deepMerge(target, source) {
  const result = { ...target };

  for (const key of Object.keys(source)) {
    const srcVal = source[key];
    const tgtVal = target[key];

    // 如果源值和目标值都是普通对象，则递归合并
    // If both source and target values are plain objects, merge recursively
    if (
      tgtVal !== null &&
      typeof tgtVal === 'object' &&
      !Array.isArray(tgtVal) &&
      srcVal !== null &&
      typeof srcVal === 'object' &&
      !Array.isArray(srcVal)
    ) {
      result[key] = deepMerge(tgtVal, srcVal);
    } else {
      result[key] = srcVal;
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// deepFreeze — 递归冻结对象树
// Recursively freeze the entire object tree
// ---------------------------------------------------------------------------
function deepFreeze(obj) {
  Object.freeze(obj);
  for (const val of Object.values(obj)) {
    if (val !== null && typeof val === 'object' && !Object.isFrozen(val)) {
      deepFreeze(val);
    }
  }
  return obj;
}

// ---------------------------------------------------------------------------
// mergeConfig — 将用户配置深合并到默认配置
// Merge user config into defaults, filtering unknown keys and deep-freezing
// the result.
// ---------------------------------------------------------------------------
/**
 * 将用户配置与默认配置深合并。只接受已知顶层键，忽略未知键。
 * Deep-merges user config into DEFAULT_CONFIG. Only KNOWN_TOP_KEYS are
 * accepted; unknown keys are silently ignored.
 *
 * @param {object} [userConfig={}] - 用户配置覆盖 / user config overrides
 * @returns {Readonly<object>} 冻结的最终配置 / frozen merged config
 */
export function mergeConfig(userConfig = {}) {
  // 过滤未知键 / filter unknown keys
  const filtered = {};
  for (const key of Object.keys(userConfig)) {
    if (KNOWN_TOP_KEYS.has(key)) {
      filtered[key] = userConfig[key];
    }
  }

  // 深合并并冻结 / deep merge then freeze
  const merged = deepMerge(DEFAULT_CONFIG, filtered);
  return deepFreeze(merged);
}

// ---------------------------------------------------------------------------
// validateConfig — 运行时配置校验
// Runtime configuration validation — throws SwarmValidationError on failure
// ---------------------------------------------------------------------------

/**
 * 辅助函数：断言条件为真，否则抛出 SwarmValidationError
 * Helper: assert a condition or throw SwarmValidationError
 */
function assert(condition, message) {
  if (!condition) {
    throw new SwarmValidationError(message);
  }
}

/**
 * 运行时验证配置对象。仅对已启用的子系统执行验证。
 * Validate a config object at runtime. Only enabled subsystems are validated.
 *
 * @param {object} config - 要验证的配置 / config to validate
 * @throws {SwarmValidationError} 验证失败时抛出 / thrown on validation failure
 */
export function validateConfig(config) {
  // --- 全局字段 / Global fields ---

  // 验证 logLevel / validate logLevel
  const validLogLevels = Object.values(LogLevel);
  assert(
    validLogLevels.includes(config.logLevel),
    `logLevel 必须是 ${validLogLevels.join('/')} 之一 / ` +
    `logLevel must be one of: ${validLogLevels.join(', ')} — got "${config.logLevel}"`,
  );

  // 验证 dbPath (禁止路径遍历) / validate dbPath (no path traversal)
  if (config.dbPath !== null && config.dbPath !== undefined) {
    assert(
      typeof config.dbPath === 'string',
      'dbPath 必须是字符串或 null / dbPath must be a string or null',
    );
    assert(
      !config.dbPath.includes('..'),
      'dbPath 不允许路径遍历 ("..") / dbPath must not contain path traversal (..)',
    );
  }

  // --- 编排子系统 / Orchestration subsystem ---
  if (config.orchestration?.enabled) {
    const orch = config.orchestration;

    assert(
      Number.isInteger(orch.maxWorkers) && orch.maxWorkers >= 1 && orch.maxWorkers <= 64,
      'orchestration.maxWorkers 必须是 1-64 的整数 / ' +
      'orchestration.maxWorkers must be an integer between 1 and 64',
    );

    assert(
      Number.isFinite(orch.roleTimeout) && orch.roleTimeout >= 1000 && orch.roleTimeout <= 3600000,
      'orchestration.roleTimeout 必须在 1000-3600000 (ms) 之间 / ' +
      'orchestration.roleTimeout must be between 1000 and 3600000 (ms)',
    );

    // 验证 defaultStrategy / validate defaultStrategy
    const validStrategies = Object.values(ExecutionStrategy);
    assert(
      validStrategies.includes(orch.defaultStrategy),
      `orchestration.defaultStrategy 必须是 ${validStrategies.join('/')} 之一 / ` +
      `orchestration.defaultStrategy must be one of: ${validStrategies.join(', ')}`,
    );

    // 验证 executionMode / validate executionMode
    const validModes = Object.values(ExecutionMode);
    assert(
      validModes.includes(orch.executionMode),
      `orchestration.executionMode 必须是 ${validModes.join('/')} 之一 / ` +
      `orchestration.executionMode must be one of: ${validModes.join(', ')}`,
    );

    // 验证 monitorMode / validate monitorMode
    const validMonitorModes = Object.values(MonitorMode);
    assert(
      validMonitorModes.includes(orch.monitorMode),
      `orchestration.monitorMode 必须是 ${validMonitorModes.join('/')} 之一 / ` +
      `orchestration.monitorMode must be one of: ${validMonitorModes.join(', ')}`,
    );

    // 验证 safety 子对象 / validate safety sub-object
    if (orch.safety) {
      assert(
        Number.isInteger(orch.safety.maxDescriptionLength) && orch.safety.maxDescriptionLength > 0,
        'orchestration.safety.maxDescriptionLength 必须是正整数 / must be a positive integer',
      );
      assert(
        Number.isInteger(orch.safety.maxRoles) && orch.safety.maxRoles > 0,
        'orchestration.safety.maxRoles 必须是正整数 / must be a positive integer',
      );
      assert(
        Number.isInteger(orch.safety.maxTasksPerMinute) && orch.safety.maxTasksPerMinute > 0,
        'orchestration.safety.maxTasksPerMinute 必须是正整数 / must be a positive integer',
      );
    }
  }

  // --- 治理子系统 / Governance subsystem ---
  if (config.governance?.enabled) {
    const gov = config.governance;

    // 验证能力维度权重之和 ~1.0 (±0.01)
    // Validate dimension weights sum to ~1.0 (±0.01)
    if (gov.capability?.dimensions) {
      const dimWeightSum = Object.values(gov.capability.dimensions)
        .reduce((sum, dim) => sum + (dim.weight || 0), 0);
      assert(
        Math.abs(dimWeightSum - 1.0) <= 0.01,
        `governance.capability.dimensions 权重之和必须约等于 1.0 (当前: ${dimWeightSum.toFixed(4)}) / ` +
        `governance.capability.dimensions weights must sum to ~1.0 (got: ${dimWeightSum.toFixed(4)})`,
      );
    }

    // 验证等级 minScore 递增 / Validate tier minScores are ascending
    if (gov.tiers) {
      const tierEntries = Object.entries(gov.tiers);
      const scores = tierEntries.map(([, t]) => t.minScore);
      for (let i = 1; i < scores.length; i++) {
        assert(
          scores[i] >= scores[i - 1],
          `governance.tiers minScore 必须递增 / ` +
          `governance.tiers minScores must be ascending — ` +
          `"${tierEntries[i][0]}" (${scores[i]}) < "${tierEntries[i - 1][0]}" (${scores[i - 1]})`,
        );
      }
    }

    // 验证投票阈值在 0-1 之间 / Validate voting thresholds are 0-1
    if (gov.voting) {
      for (const field of ['promotionThreshold', 'admissionThreshold']) {
        const val = gov.voting[field];
        assert(
          typeof val === 'number' && val >= 0 && val <= 1,
          `governance.voting.${field} 必须在 0-1 之间 / must be between 0 and 1`,
        );
      }
    }

    // 验证分配权重之和 ~1.0 (±0.01)
    // Validate allocation weights sum to ~1.0 (±0.01)
    if (gov.allocation) {
      const allocSum = gov.allocation.skillWeight
        + gov.allocation.historyWeight
        + gov.allocation.loadWeight
        + gov.allocation.collaborationWeight;
      assert(
        Math.abs(allocSum - 1.0) <= 0.01,
        `governance.allocation 权重之和必须约等于 1.0 (当前: ${allocSum.toFixed(4)}) / ` +
        `governance.allocation weights must sum to ~1.0 (got: ${allocSum.toFixed(4)})`,
      );
    }
  }

  // --- 信息素子系统 / Pheromone subsystem ---
  if (config.pheromone?.enabled) {
    const ph = config.pheromone;

    assert(
      typeof ph.decayIntervalMs === 'number' && ph.decayIntervalMs > 0,
      'pheromone.decayIntervalMs 必须是正数 / must be a positive number',
    );
    assert(
      typeof ph.maxPheromones === 'number' && ph.maxPheromones > 0,
      'pheromone.maxPheromones 必须是正数 / must be a positive number',
    );
  }

  // --- 协作子系统 / Collaboration subsystem ---
  if (config.collaboration?.enabled) {
    const collab = config.collaboration;

    assert(
      typeof collab.struggleWindowSize === 'number' && collab.struggleWindowSize > 0,
      'collaboration.struggleWindowSize 必须是正数 / must be a positive number',
    );
    assert(
      typeof collab.struggleFailureThreshold === 'number' && collab.struggleFailureThreshold > 0,
      'collaboration.struggleFailureThreshold 必须是正数 / must be a positive number',
    );
  }
}

// ---------------------------------------------------------------------------
// resolveDbPath — 解析数据库路径
// Resolve the database file path, falling back to OS temp directory
// ---------------------------------------------------------------------------
/**
 * 解析数据库路径。如果未提供 basePath，则使用系统临时目录。
 * Resolve the database path. Falls back to os.tmpdir() when basePath is not
 * provided.
 *
 * @param {string} [basePath] - 基础目录 / base directory
 * @returns {string} 解析后的完整数据库路径 / resolved full database path
 */
export function resolveDbPath(basePath) {
  return path.join(basePath || os.tmpdir(), 'swarm.db');
}

// ---------------------------------------------------------------------------
// isFileModifyingTool — 判断工具调用是否修改文件 (源自 OME config.js)
// Determine whether a tool invocation modifies files (ported from OME config.js)
// ---------------------------------------------------------------------------

/**
 * Bash / shell 命令中指示文件写入的模式列表
 * Patterns within bash/shell commands that indicate file writes
 */
const BASH_WRITE_PATTERNS = [
  /\b(cat|echo|printf)\b.*>/,          // 重定向输出 / redirect output
  /\btee\b/,                            // tee 命令 / tee command
  /\b(cp|mv|install)\b/,               // 复制/移动/安装 / copy/move/install
  /\b(mkdir|touch|chmod|chown)\b/,      // 文件系统操作 / fs operations
  /\b(sed|awk)\b.*-i/,                  // 原地编辑 / in-place edit
  /\b(rm|unlink)\b/,                    // 删除 / remove
  /\b(tar|unzip|gunzip)\b/,            // 解压 / extract
  /\b(git)\b.*(checkout|merge|rebase|reset|apply|cherry-pick)\b/, // git 写操作 / git write ops
  /\b(npm|yarn|pnpm)\b.*(install|add|remove|uninstall)\b/,       // 包管理器写操作 / pkg mgr writes
  /\bpatch\b/,                          // patch 命令 / patch command
];

/**
 * 参数对象中指示文件路径的字段名
 * Parameter field names that indicate a file path target
 */
const FILE_PATH_FIELDS = [
  'file_path', 'filePath', 'path', 'filename',
  'file_name', 'destination', 'target', 'output',
];

/**
 * 判断指定工具调用是否会修改文件。
 * Check whether the given tool invocation modifies files.
 *
 * 判断逻辑 / Decision logic:
 *   1. 工具名在 config.memory.fileModifyTools 列表中 → true
 *   2. 工具名是 bash/shell 类 → 检查命令内容中的写入模式
 *   3. 参数中包含文件路径相关字段 → true
 *
 *   1. Tool name is in config.memory.fileModifyTools → true
 *   2. Tool is bash/shell → check command text for write patterns
 *   3. Params contain file-path-like fields → true
 *
 * @param {string} toolName  - 工具名称 / tool name
 * @param {object} [params]  - 工具调用参数 / tool call parameters
 * @param {object} [config]  - 配置对象 (默认使用 DEFAULT_CONFIG) / config (defaults to DEFAULT_CONFIG)
 * @returns {boolean} 是否修改文件 / whether the tool modifies files
 */
export function isFileModifyingTool(toolName, params, config) {
  const cfg = config || DEFAULT_CONFIG;
  const fileTools = cfg.memory?.fileModifyTools ?? DEFAULT_CONFIG.memory.fileModifyTools;

  // 1. 直接匹配工具名 / Direct tool name match
  if (fileTools.includes(toolName)) {
    return true;
  }

  // 2. Bash / shell 特殊处理 / Bash/shell special case
  const bashNames = ['bash', 'shell', 'terminal', 'execute', 'run_command', 'execute_command'];
  if (bashNames.includes(toolName)) {
    // 从参数中提取命令文本 / extract command text from params
    const cmdText = params?.command || params?.cmd || params?.input || '';
    if (typeof cmdText === 'string' && cmdText.length > 0) {
      for (const pattern of BASH_WRITE_PATTERNS) {
        if (pattern.test(cmdText)) {
          return true;
        }
      }
    }
  }

  // 3. 参数包含文件路径字段 / Params contain file path fields
  if (params && typeof params === 'object') {
    for (const field of FILE_PATH_FIELDS) {
      if (field in params && params[field]) {
        return true;
      }
    }
  }

  return false;
}
