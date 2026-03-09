/**
 * Claw-Swarm V5.1 — OpenClaw 插件入口 / OpenClaw Plugin Entry Point
 *
 * 使用 OpenClaw Plugin SDK 的 register(api) 模式注册钩子和工具。
 * Uses OpenClaw Plugin SDK register(api) pattern to register hooks and tools.
 *
 * OpenClaw 事件 → 内部映射:
 * OpenClaw Event → Internal Mapping:
 *
 *   gateway_start       → PID 文件 + 引擎自检 + 配置校验 [V5.1]
 *   before_model_resolve→ 模型能力自动检测 [V5.1]
 *   before_tool_call    → ToolResilience 参数预校验 + 断路器拦截 [V5.1]
 *   before_prompt_build → 工具失败提示注入 + 蜂群上下文 [V5.1]
 *   before_agent_start  → onAgentStart + onSubAgentSpawn (SOUL) + onPrependContext
 *   agent_end           → onSubAgentComplete/Abort (质量门控) + onAgentEnd (记忆固化)
 *   after_tool_call     → ToolResilience (失败检测) + HealthChecker (延迟) + onToolCall + onToolResult [V5.1]
 *   before_reset        → onMemoryConsolidate (记忆固化)
 *   gateway_stop        → HealthChecker.stop() + close() + PID 清理 [V5.1]
 *   message_sending     → onSubAgentMessage (消息路由)
 *   subagent_spawning   → HierarchicalCoordinator (深度+并发检查) [V5.1]
 *   subagent_spawned    → HierarchicalCoordinator (层级关系记录) [V5.1]
 *   subagent_ended      → HierarchicalCoordinator (结果收集+信息素) [V5.1]
 *   llm_output          → SOUL.md 双阶段迁移 (文本→tool_call 转换) [V5.1]
 *
 * V5.1 新增:
 * - ToolResilience: AJV 参数预校验 + per-tool 断路器 + 失败提示注入
 * - HealthChecker: 事件驱动 + 自适应轮询的多维健康检查
 * - 特性标志依赖验证 + PID 文件管理 + 模型能力检测
 * - HierarchicalCoordinator: 层级蜂群 (深度限制 + 并发控制)
 * - TaskDAGEngine: DAG 编排 + 拍卖分配 + Work-Stealing + DLQ
 * - Subagent 生命周期 hooks (spawning/spawned/ended)
 * - llm_output hook (SOUL.md 双阶段迁移)
 * - CapabilityEngine: recordObservation() + 4D 主动评分 + emit→publish 修复
 * - PersonaEvolution: 加法变异 + emit→publish 修复
 * - SpeciesEvolver: 种群提议 + 试用期 + 淘汰 + GEP 锦标赛选择
 * - ReputationLedger: emit→publish 修复
 * - SkillGovernor: Skill 清单 + 使用追踪 + 推荐引擎 + 能力缺口建议
 *
 * @module claw-swarm
 * @version 5.1.0
 * @author DEEP-IOS
 */

import { join } from 'node:path';
import { homedir } from 'node:os';
import { writeFileSync, readFileSync, unlinkSync, existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { PluginAdapter } from './L5-application/plugin-adapter.js';
import { ToolResilience } from './L5-application/tool-resilience.js';
import { HealthChecker } from './L6-monitoring/health-checker.js';
import { buildSwarmContextFallback } from './L3-agent/swarm-context-engine.js';
import { HierarchicalCoordinator } from './L4-orchestration/hierarchical-coordinator.js';

// ============================================================================
// 常量 / Constants
// ============================================================================

const VERSION = '5.1.0';
const NAME = 'claw-swarm';
const DB_FILENAME = 'claw-swarm.db';

/** PID 文件路径 / PID file path (E: 盘数据目录) */
const PID_FILE = 'E:/OpenClaw/data/swarm/.gateway.pid';

/** 默认数据目录 (api.dataDir 不存在时的回退) / Default data dir fallback */
const DEFAULT_DATA_DIR = join(homedir(), '.openclaw', 'claw-swarm');

// ============================================================================
// 辅助函数 / Helpers
// ============================================================================

/**
 * 解析数据库路径 / Resolve database path
 *
 * 优先级: 用户配置 dbPath > api.dataDir > 默认 ~/.openclaw/claw-swarm/
 * Priority: user-configured dbPath > api.dataDir > default ~/.openclaw/claw-swarm/
 *
 * @param {string} [configDbPath] - 用户配置 / User-configured path
 * @param {string} [dataDir] - OpenClaw 提供的数据目录 / OpenClaw data directory
 * @returns {string | null}
 */
function resolveDbPath(configDbPath, dataDir) {
  if (configDbPath) {
    // 展开 ~ 为用户主目录 / Expand ~ to user home directory
    if (configDbPath.startsWith('~/') || configDbPath.startsWith('~\\')) {
      return join(homedir(), configDbPath.slice(2));
    }
    return configDbPath;
  }
  // 使用 api.dataDir 或默认路径 / Use api.dataDir or default path
  const dir = dataDir || DEFAULT_DATA_DIR;
  return join(dir, DB_FILENAME);
}

/**
 * 从上下文中解析 agentId / Resolve agentId from context
 *
 * @param {Object} event - 事件对象 / Event object
 * @param {Object} ctx - 上下文对象 / Context object
 * @returns {string}
 */
function resolveAgentId(event, ctx) {
  return ctx?.agentId || event?.agentId || 'main';
}

// ============================================================================
// 插件定义 / Plugin Definition
// ============================================================================

// ============================================================================
// V5.1 特性标志依赖树 / V5.1 Feature Flag Dependency Tree
// ============================================================================

/**
 * 特性标志依赖关系 / Feature flag dependency relationships
 * key requires value to be enabled
 */
const FLAG_DEPENDENCIES = {
  'dagEngine': 'hierarchical',
  'speculativeExecution': 'dagEngine',
  'workStealing': 'dagEngine',
  'evolution.clustering': 'evolution.scoring',
  'evolution.gep': 'evolution.scoring',
  'evolution.abc': 'evolution.scoring',
};

/**
 * 读取嵌套 config 值 / Read nested config value
 * @param {Object} config
 * @param {string} path - 点分隔路径 / Dot-separated path
 * @returns {*}
 */
function getConfigFlag(config, path) {
  const parts = path.split('.');
  let obj = config;
  for (const p of parts) {
    if (obj == null || typeof obj !== 'object') return undefined;
    obj = obj[p];
  }
  // 对象本身有 enabled 属性时读 enabled / Read .enabled when obj is a config block
  if (typeof obj === 'object' && obj !== null && 'enabled' in obj) return obj.enabled;
  return obj;
}

/**
 * 设置嵌套 config 值为 false / Set nested config value to false
 * @param {Object} config
 * @param {string} path
 */
function disableConfigFlag(config, path) {
  const parts = path.split('.');
  let obj = config;
  for (let i = 0; i < parts.length - 1; i++) {
    if (obj[parts[i]] == null) obj[parts[i]] = {};
    obj = obj[parts[i]];
  }
  const lastKey = parts[parts.length - 1];
  if (typeof obj[lastKey] === 'object' && obj[lastKey] !== null) {
    obj[lastKey].enabled = false;
  } else {
    obj[lastKey] = false;
  }
}

/**
 * 验证特性标志依赖 / Validate feature flag dependencies
 * 自动禁用依赖不满足的下游标志
 *
 * @param {Object} config - 插件配置 / Plugin config
 * @param {Object} logger
 */
function validateFeatureFlags(config, logger) {
  for (const [downstream, upstream] of Object.entries(FLAG_DEPENDENCIES)) {
    const downEnabled = getConfigFlag(config, downstream);
    const upEnabled = getConfigFlag(config, upstream);
    if (downEnabled && !upEnabled) {
      logger.warn?.(
        `[Config] ${downstream} requires ${upstream}, force-disabling ${downstream}`
      );
      disableConfigFlag(config, downstream);
    }
  }
}

/**
 * 校验关键配置 / Validate critical configuration
 * 打印警告但不阻塞启动
 *
 * @param {Object} config
 * @param {Object} logger
 */
function validateConfig(config, logger) {
  // 检查数据库路径 / Check database path
  if (!config.dbPath) {
    logger.warn?.('[Config] No dbPath configured, using default');
  }

  // 检查 Dashboard 配置 / Check dashboard config
  if (config.dashboard?.enabled && !config.dashboard?.port) {
    logger.warn?.('[Config] Dashboard enabled but no port specified, using default 19100');
  }
}

// ============================================================================
// 模型能力查表 / Model Capability Lookup
// ============================================================================

/** 已知模型的 tool_call 支持度 / Known model tool_call support levels */
const MODEL_CAPABILITIES = {
  'kimi-coding': { toolCall: true, failureRate: 0.12, name: 'Kimi K2.5' },
  'k2p5': { toolCall: true, failureRate: 0.12, name: 'Kimi K2.5' },
  'kimi-k2.5': { toolCall: true, failureRate: 0.12, name: 'Kimi K2.5' },
  'qwen3.5-plus': { toolCall: true, failureRate: 0.05, name: 'Qwen 3.5 Plus' },
  'qwen3.5-max': { toolCall: true, failureRate: 0.03, name: 'Qwen 3.5 Max' },
  'glm-5': { toolCall: true, failureRate: 0.08, name: 'GLM-5' },
  'minimax-m2.5': { toolCall: true, failureRate: 0.06, name: 'MiniMax M2.5' },
  'deepseek-chat': { toolCall: true, failureRate: 0.04, name: 'DeepSeek Chat' },
  'deepseek-reasoner': { toolCall: true, failureRate: 0.10, name: 'DeepSeek Reasoner' },
};

/** 已检测过的模型缓存 / Cached model detection results */
const _modelCapabilityCache = new Map();

export default {
  id: NAME,
  name: 'Claw-Swarm V5.1',
  version: VERSION,

  /**
   * 注册插件到 OpenClaw API
   * Register plugin with OpenClaw API
   *
   * @param {Object} api - OpenClaw Plugin API
   * @param {Object} [api.pluginConfig] - 用户配置 / User configuration
   * @param {Object} [api.logger] - 日志器 / Logger instance
   * @param {Function} [api.resolvePath] - 路径解析 / Path resolver
   * @param {Function} api.on - 钩子注册 / Hook registration
   * @param {Function} api.registerTool - 工具注册 / Tool registration
   */
  register(api) {
    const config = api.pluginConfig || {};
    const logger = api.logger || console;

    // ── 1. 解析数据库路径 / Resolve DB path ─────────────────────────────
    // api.dataDir 不在 Plugin SDK 类型定义中, 使用防御性回退
    // api.dataDir is not in Plugin SDK type definitions, use defensive fallback
    const dataDir = api.dataDir || '';
    const dbPath = resolveDbPath(config.dbPath, dataDir);

    // ── 2. 创建并初始化适配器 (L1→L5 引擎组装) ──────────────────────────
    //    Create and initialize adapter (L1→L5 engine wiring)
    const adapter = new PluginAdapter({
      config: { ...config, dbPath },
      logger,
    });

    adapter.init();

    // V5.1: 特性标志依赖验证 / Feature flag dependency validation
    validateFeatureFlags(config, logger);
    validateConfig(config, logger);

    // ── 2b. V5.1: 韧性层 + 健康检查器 ──────────────────────────────────
    //    V5.1: Resilience layer + Health checker
    let toolResilience = null;
    if (config.toolResilience?.enabled !== false) {
      try {
        toolResilience = new ToolResilience({
          logger,
          config: config.toolResilience || {},
          messageBus: adapter._engines?.messageBus,
        });
        logger.info?.('[Claw-Swarm] ToolResilience layer initialized');
      } catch (err) {
        logger.warn?.(`[Claw-Swarm] ToolResilience init failed: ${err.message}`);
      }
    }

    let healthChecker = null;
    if (config.healthChecker?.enabled !== false) {
      try {
        healthChecker = new HealthChecker({
          messageBus: adapter._engines?.messageBus,
          logger,
          pluginAdapter: adapter,
        });
        healthChecker.start();
        logger.info?.('[Claw-Swarm] HealthChecker started');
      } catch (err) {
        logger.warn?.(`[Claw-Swarm] HealthChecker init failed: ${err.message}`);
      }
    }

    // 获取内部钩子处理器和工具定义 / Get internal hook handlers and tool definitions
    const hooks = adapter.getHooks();
    const tools = adapter.getTools();

    // ── 3. 注册 OpenClaw 钩子 / Register OpenClaw Hooks ─────────────────

    // ━━━ gateway_start [V5.1 新增] ━━━
    // PID 文件 + 引擎自检 + 配置校验
    // PID file + engine health check + config validation
    api.on('gateway_start', async (event) => {
      // 1. PID 文件管理（排他创建，防止 TOCTOU）
      //    PID file management (exclusive create, prevent TOCTOU race)
      try {
        const pidContent = JSON.stringify({
          pid: process.pid,
          nonce: randomUUID(),
          startTime: Date.now(),
          version: VERSION,
        });

        try {
          writeFileSync(PID_FILE, pidContent, { flag: 'wx' });
        } catch (pidErr) {
          if (pidErr.code === 'EEXIST') {
            // 读取旧 PID 检查是否存活 / Read old PID and check if alive
            try {
              const oldPidData = JSON.parse(readFileSync(PID_FILE, 'utf-8'));
              try {
                process.kill(oldPidData.pid, 0); // 仅检查存活性 / Check liveness only
                logger.warn?.(
                  `[Claw-Swarm] Old process PID=${oldPidData.pid} is still alive! ` +
                  `Started at ${new Date(oldPidData.startTime).toISOString()}`
                );
              } catch {
                // 旧进程已死，删除旧文件重写 / Old process is dead, delete and rewrite
                unlinkSync(PID_FILE);
                writeFileSync(PID_FILE, pidContent, { flag: 'wx' });
              }
            } catch {
              // PID 文件损坏，强制覆盖 / PID file corrupted, force overwrite
              unlinkSync(PID_FILE);
              writeFileSync(PID_FILE, pidContent, { flag: 'wx' });
            }
          } else {
            logger.warn?.(`[Claw-Swarm] PID file write failed: ${pidErr.message}`);
          }
        }
      } catch (err) {
        logger.warn?.(`[Claw-Swarm] PID management error: ${err.message}`);
      }

      // 2. 引擎自检 / Engine health check
      const status = adapter.healthCheck();

      // 3. V5.1 Phase 5: Skill 扫描（gateway_start 时一次性扫描）
      //    V5.1 Phase 5: Skill scanning (one-time scan at gateway_start)
      const skillGovernor = adapter._engines?.skillGovernor;
      if (skillGovernor) {
        try {
          // 默认扫描 workspace 和 user skills 目录
          // Default scan workspace and user skills directories
          const skillDirs = [
            join(process.cwd(), 'skills'),                                    // workspace/skills
            join(homedir(), '.openclaw', 'skills'),                           // ~/.openclaw/skills
          ];
          // 添加配置的额外目录 / Add configured extra directories
          const extraDirs = config.skillGovernor?.skillDirs || [];
          const count = skillGovernor.scanSkills([...skillDirs, ...extraDirs]);
          logger.info?.(`[Claw-Swarm] Skill scan: ${count} skills found`);
        } catch (err) {
          logger.warn?.(`[Claw-Swarm] Skill scan failed: ${err.message}`);
        }
      }

      // 4. 启动日志 / Startup log
      logger.info?.(
        `[Claw-Swarm] V${VERSION} started — PID=${process.pid} ` +
        `port=${event?.port ?? '?'} status=${JSON.stringify(status)}`
      );
    }, { priority: 10 });

    // ━━━ before_model_resolve [V5.1 新增] ━━━
    // 模型能力自动检测 / Model capability auto-detection
    api.on('before_model_resolve', async (event) => {
      const modelId = event?.modelId || event?.model || '';
      if (!modelId || _modelCapabilityCache.has(modelId)) return;

      // 从已知模型查表检测 / Lookup from known model table
      const modelKey = Object.keys(MODEL_CAPABILITIES).find(k =>
        modelId.toLowerCase().includes(k)
      );

      if (modelKey) {
        const cap = MODEL_CAPABILITIES[modelKey];
        _modelCapabilityCache.set(modelId, cap);
        logger.info?.(
          `[ModelDetect] ${cap.name}: toolCall=${cap.toolCall}, ` +
          `estimatedFailureRate=${(cap.failureRate * 100).toFixed(0)}%`
        );
      } else {
        // 未知模型，记录但不阻塞 / Unknown model, log but don't block
        _modelCapabilityCache.set(modelId, {
          toolCall: true, // 默认假设支持 / Default assume supported
          failureRate: 0.10,
          name: modelId,
        });
        logger.info?.(`[ModelDetect] Unknown model: ${modelId}, using default capabilities`);
      }
    }, { priority: 20 });

    // ━━━ before_tool_call [V5.1 新增] ━━━
    // 工具韧性：参数预校验 + 断路器拦截
    // Tool resilience: parameter pre-validation + circuit breaker interception
    api.on('before_tool_call', async (event) => {
      if (!toolResilience) return;

      try {
        const result = toolResilience.handleBeforeToolCall({
          toolName: event.toolName || event.name,
          params: event.params || event.input,
          toolCallId: event.toolCallId,
          inputSchema: event.inputSchema,
        });
        return result; // { block, blockReason } or { params } or undefined
      } catch (err) {
        logger.warn?.(`[Claw-Swarm] before_tool_call resilience error: ${err.message}`);
      }
    }, { priority: 10 });

    // ━━━ before_prompt_build [V5.1 新增] ━━━
    // Phase 1: 工具失败提示注入 (priority: 5, prependContext)
    // Phase 3: 蜂群上下文注入 (priority: 10, prependSystemContext — 当 ContextEngine 未启用时)
    // Tool failure prompt injection + swarm context fallback
    api.on('before_prompt_build', async (event) => {
      const result = {};

      // Phase 1: 工具失败重试提示 / Tool failure retry prompts
      if (toolResilience) {
        try {
          const failureCtx = toolResilience.getFailureContext();
          if (failureCtx) {
            result.prependContext = failureCtx;
          }
        } catch (err) {
          logger.warn?.(`[Claw-Swarm] before_prompt_build resilience error: ${err.message}`);
        }
      }

      // Phase 3: 蜂群上下文（仅当 ContextEngine 未启用时）
      // Phase 3: Swarm context (only when ContextEngine is NOT enabled)
      if (!config.contextEngine?.enabled) {
        try {
          const swarmCtx = buildSwarmContextFallback({
            gossipProtocol: adapter._engines?.gossipProtocol,
            pheromoneEngine: adapter._engines?.pheromoneEngine,
            capabilityEngine: adapter._engines?.capabilityEngine,
          });
          if (swarmCtx) {
            result.prependSystemContext = swarmCtx;
          }
        } catch (err) {
          logger.warn?.(`[Claw-Swarm] before_prompt_build swarm context error: ${err.message}`);
        }
      }

      if (Object.keys(result).length > 0) {
        return result;
      }
    }, { priority: 5 });

    // ━━━ before_agent_start ━━━
    // V5.0: onAgentStart (注册) + onSubAgentSpawn (SOUL) + onPrependContext (上下文)
    // V5.0: onAgentStart (register) + onSubAgentSpawn (SOUL) + onPrependContext (context)
    //
    // 工具驱动 SOUL 注入: 检查 Agent 是否有 swarm_spawn 创建的记录,
    // 如果有则生成 SOUL 片段并注入上下文。
    // Tool-driven SOUL injection: check if agent has a swarm_spawn record,
    // if so generate SOUL snippet and inject into context.
    api.on('before_agent_start', async (event, ctx) => {
      const agentId = resolveAgentId(event, ctx);
      const taskDesc = event.prompt || event.taskDescription || null;

      // 1. 注册 Agent / Register agent
      try {
        await hooks.onAgentStart({
          agentId,
          taskDescription: taskDesc,
          tier: event.tier || 'trainee',
        });
      } catch (err) {
        logger.warn?.(`[Claw-Swarm] onAgentStart failed: ${err.message}`);
      }

      // 2. SOUL 注入: 检查是否有已注册的 Agent 记录 (由 swarm_spawn 创建)
      //    SOUL injection: check for registered agent record (created by swarm_spawn)
      let soulSnippet = '';
      try {
        const agentRecord = adapter.findAgentRecord(agentId);
        if (agentRecord?.role) {
          const spawnResult = await hooks.onSubAgentSpawn({
            subAgentId: agentId,
            parentAgentId: agentRecord.parentId || 'main',
            subAgentName: agentRecord.name || agentId,
            tier: agentRecord.tier || 'trainee',
            persona: agentRecord.persona || 'worker-bee',
            behavior: agentRecord.behavior || 'adaptive',
            capabilities: null,
            taskDescription: taskDesc,
            role: agentRecord.role,
            roleTemplate: null,
            zoneId: null,
            zoneName: null,
          });
          soulSnippet = spawnResult?.soulSnippet || '';
        }
      } catch {
        // SOUL 注入为可选, 静默失败 / SOUL injection is optional, silent failure
      }

      // 3. 构建上下文 (记忆 + 知识图谱 + 信息素)
      //    Build context (memory + knowledge graph + pheromone)
      try {
        const result = await hooks.onPrependContext({ agentId, taskDescription: taskDesc });
        const parts = [soulSnippet, result?.prependText].filter(Boolean);
        if (parts.length > 0) {
          return { prependContext: parts.join('\n\n') };
        }
      } catch (err) {
        logger.warn?.(`[Claw-Swarm] onPrependContext failed: ${err.message}`);
        // 如果上下文构建失败, 仍尝试注入 SOUL / If context fails, still try SOUL
        if (soulSnippet) {
          return { prependContext: soulSnippet };
        }
      }

      return undefined;
    }, { priority: 60 });

    // ━━━ agent_end ━━━
    // V5.0: 子 Agent 生命周期完成 + onAgentEnd (记忆固化, Gossip 更新)
    // V5.0: Sub-agent lifecycle completion + onAgentEnd (memory, gossip, cleanup)
    //
    // 工具驱动质量门控: 检查 Agent 是否有关联任务记录,
    // 如果有则触发 onSubAgentComplete 或 onSubAgentAbort。
    // Tool-driven quality gate: check if agent has associated task records,
    // if so trigger onSubAgentComplete or onSubAgentAbort.
    api.on('agent_end', async (event, ctx) => {
      const agentId = resolveAgentId(event, ctx);
      const isSuccess = !event.error;

      // 1. 子 Agent 生命周期: 检查关联任务并触发质量门控
      //    Sub-agent lifecycle: check associated tasks and trigger quality gate
      try {
        const taskInfo = adapter.findTaskForAgent(agentId);
        if (taskInfo) {
          if (isSuccess) {
            await hooks.onSubAgentComplete({
              subAgentId: agentId,
              taskId: taskInfo.id,
              result: event.result || null,
              taskScope: `/task/${taskInfo.id}`,
            });
          } else {
            await hooks.onSubAgentAbort({
              subAgentId: agentId,
              taskId: taskInfo.id,
              reason: event.error?.message || event.error || 'Agent ended with error',
              taskScope: `/task/${taskInfo.id}`,
            });
          }
        }
      } catch (err) {
        logger.warn?.(`[Claw-Swarm] Sub-agent lifecycle handling failed: ${err.message}`);
      }

      // 2. 标准 Agent 结束处理 / Standard agent end handling
      try {
        await hooks.onAgentEnd({ agentId, ...event });
      } catch (err) {
        logger.warn?.(`[Claw-Swarm] onAgentEnd failed: ${err.message}`);
      }
    });

    // ━━━ after_tool_call ━━━
    // V5.0: onToolCall (工作记忆记录) + onToolResult (能力维度更新)
    // V5.1: + ToolResilience (失败检测) + HealthChecker (延迟记录)
    // V5.0: onToolCall (working memory recording) + onToolResult (capability dimension update)
    // V5.1: + ToolResilience (failure detection) + HealthChecker (latency recording)
    api.on('after_tool_call', async (event, ctx) => {
      const agentId = resolveAgentId(event, ctx);
      const toolName = event.toolName || event.name || 'unknown';

      // V5.1: 工具韧性层 — 失败检测 + 断路器更新
      // V5.1: Tool resilience — failure detection + circuit breaker update
      if (toolResilience) {
        try {
          toolResilience.handleAfterToolCall({
            toolName,
            params: event.params || event.input,
            success: !event.error,
            error: typeof event.error === 'string' ? event.error : event.error?.message,
            toolCallId: event.toolCallId,
            durationMs: event.durationMs,
          });
        } catch { /* 韧性层错误不影响主流程 / Resilience error doesn't affect main flow */ }
      }

      // V5.1: 健康检查器延迟记录 / Health checker latency recording
      if (healthChecker && event.durationMs) {
        healthChecker.recordLatency(event.durationMs);
      }

      try {
        await hooks.onToolCall({
          agentId,
          toolName,
          args: event.params || event.input || {},
        });
      } catch { /* 静默 / silent */ }

      try {
        await hooks.onToolResult({
          agentId,
          toolName,
          success: !event.error,
          dimension: _inferDimension(toolName),
        });
      } catch { /* 静默 / silent */ }

      // V5.1 Phase 5: Skill 使用追踪 / Skill usage tracking
      const skillGovernor = adapter._engines?.skillGovernor;
      if (skillGovernor && config.skillGovernor?.enabled) {
        try {
          const skillSlug = skillGovernor.inferSkillFromTool(toolName);
          if (skillSlug) {
            skillGovernor.recordUsage({
              skillSlug,
              agentId,
              success: !event.error,
              durationMs: event.durationMs,
            });
          }
        } catch { /* Skill 追踪不影响主流程 / Skill tracking doesn't affect main flow */ }
      }
    });

    // ━━━ before_prompt_build (Phase 5: Skill 推荐, priority: 20) ━━━
    // Skill 推荐注入到 appendSystemContext（与 Phase 3 的 prependSystemContext 不冲突）
    // Skill recommendations injected via appendSystemContext (no conflict with Phase 3's prependSystemContext)
    api.on('before_prompt_build', async (event) => {
      if (!config.skillGovernor?.enabled) return;

      const skillGovernor = adapter._engines?.skillGovernor;
      if (!skillGovernor) return;

      try {
        const recommendation = skillGovernor.getRecommendations({
          agentRole: event.agentRole || event.role,
          taskType: event.taskType,
          agentId: event.agentId || event.sessionId,
        });

        if (recommendation) {
          return { appendSystemContext: recommendation };
        }
      } catch (err) {
        logger.debug?.(`[Claw-Swarm] Skill recommendation error: ${err.message}`);
      }
    }, { priority: 20 });

    // ━━━ before_reset ━━━
    // V5.0: onMemoryConsolidate (工作记忆 → 情景记忆)
    // V5.0: onMemoryConsolidate (working memory → episodic memory)
    api.on('before_reset', async (event, ctx) => {
      const agentId = resolveAgentId(event, ctx);

      try {
        await hooks.onMemoryConsolidate({ agentId });
      } catch (err) {
        logger.warn?.(`[Claw-Swarm] before_reset consolidation failed: ${err.message}`);
      }
    });

    // ━━━ gateway_stop ━━━
    // V5.1: HealthChecker 停止 + close() + PID 文件清理
    // V5.1: HealthChecker stop + close() + PID file cleanup
    api.on('gateway_stop', async () => {
      try {
        // V5.1: 停止健康检查器 / Stop health checker
        if (healthChecker) {
          try { healthChecker.stop(); } catch { /* non-fatal */ }
        }

        adapter.close();

        // V5.1: 清理 PID 文件 / Clean up PID file
        try {
          if (existsSync(PID_FILE)) {
            unlinkSync(PID_FILE);
          }
        } catch { /* PID 清理失败不致命 / PID cleanup failure is non-fatal */ }

        logger.info?.(`[Claw-Swarm] V${VERSION} shutdown complete`);
      } catch (err) {
        logger.warn?.(`[Claw-Swarm] Shutdown error: ${err.message}`);
      }
    });

    // ━━━ message_sending ━━━
    // V5.0: onSubAgentMessage (Agent 间消息路由)
    // V5.0: onSubAgentMessage (agent-to-agent message routing)
    api.on('message_sending', async (event, ctx) => {
      const senderId = resolveAgentId(event, ctx);

      // 只在有接收者时路由消息 / Only route when receiver is specified
      if (event.receiverId || event.targetAgentId) {
        try {
          await hooks.onSubAgentMessage({
            senderId,
            receiverId: event.receiverId || event.targetAgentId,
            content: event.content || event.message || '',
            messageType: event.messageType || 'direct',
            broadcast: event.broadcast || false,
          });
        } catch (err) {
          logger.warn?.(`[Claw-Swarm] onSubAgentMessage failed: ${err.message}`);
        }
      }
    });

    // ── 3b. V5.1 Subagent 生命周期 + llm_output hooks ──────────────────
    //    V5.1: Subagent lifecycle + llm_output hooks
    //    依赖 hierarchicalCoordinator (在 plugin-adapter init 中创建)
    //    Depends on hierarchicalCoordinator (created in plugin-adapter init)

    // ━━━ subagent_spawning [V5.1 新增] ━━━
    // 验证 + 元数据注入 (深度检查 + 并发上限)
    // Validation + metadata injection (depth check + concurrency limit)
    api.on('subagent_spawning', async (event, ctx) => {
      const coordinator = adapter._engines?.hierarchicalCoordinator;
      if (!coordinator || config.hierarchical?.enabled === false) return;

      try {
        const result = coordinator.handleSubagentSpawning(event, ctx);
        if (result.status === 'error') {
          logger.warn?.(`[Claw-Swarm] subagent_spawning rejected: ${result.errorMessage}`);
          return { status: 'error', errorMessage: result.errorMessage };
        }
        return { status: 'ok' };
      } catch (err) {
        logger.warn?.(`[Claw-Swarm] subagent_spawning error: ${err.message}`);
        // 不阻塞 spawn / Don't block spawn on error
      }
    }, { priority: 10 });

    // ━━━ subagent_spawned [V5.1 新增] ━━━
    // 层级关系记录
    // Record hierarchy relationship
    api.on('subagent_spawned', async (event, ctx) => {
      const coordinator = adapter._engines?.hierarchicalCoordinator;
      if (!coordinator || config.hierarchical?.enabled === false) return;

      try {
        coordinator.handleSubagentSpawned(event, ctx);
      } catch (err) {
        logger.warn?.(`[Claw-Swarm] subagent_spawned error: ${err.message}`);
      }
    }, { priority: 10 });

    // ━━━ subagent_ended [V5.1 新增] ━━━
    // 结果收集 + 信息素更新
    // Result collection + pheromone update
    api.on('subagent_ended', async (event, ctx) => {
      const coordinator = adapter._engines?.hierarchicalCoordinator;
      if (!coordinator || config.hierarchical?.enabled === false) return;

      try {
        coordinator.handleSubagentEnded(event, ctx);
      } catch (err) {
        logger.warn?.(`[Claw-Swarm] subagent_ended error: ${err.message}`);
      }

      // DAG 引擎: 更新 DAG 任务状态 / DAG engine: update DAG task state
      const dagEngine = adapter._engines?.dagEngine;
      if (dagEngine && config.dagEngine?.enabled !== false) {
        try {
          const childKey = event.targetSessionKey || ctx?.childSessionKey;
          const outcome = event.outcome || 'unknown';
          // 查找关联的 DAG 任务并更新状态
          // Find associated DAG task and update state
          // (由调用方显式调用 dagEngine.transitionState，此处仅记录)
          logger.debug?.(
            `[Claw-Swarm] subagent_ended for DAG: child=${childKey}, outcome=${outcome}`
          );
        } catch (err) {
          logger.warn?.(`[Claw-Swarm] subagent_ended DAG update error: ${err.message}`);
        }
      }
    }, { priority: 10 });

    // ━━━ subagent_ended [V5.1 Phase 4: 能力评分回收] ━━━
    // 子 Agent 完成后，记录任务级能力观测
    // After subagent completes, record task-level capability observation
    api.on('subagent_ended', async (event, ctx) => {
      if (config.evolution?.scoring !== true) return;

      const capabilityEngine = adapter._engines?.capabilityEngine;
      if (!capabilityEngine) return;

      try {
        const childKey = event.targetSessionKey || ctx?.childSessionKey;
        const outcome = event.outcome || 'unknown';
        const success = outcome === 'success';

        // 从层级协调器获取 agent 元数据 / Get agent metadata from coordinator
        const coordinator = adapter._engines?.hierarchicalCoordinator;
        const meta = coordinator?.getMetadata?.(childKey);
        const agentId = meta?.agentId || childKey;

        if (agentId) {
          // 记录综合观测（较高权重，任务级）/ Record composite observation (higher weight, task-level)
          capabilityEngine.recordObservation({
            agentId,
            dimension: 'coding', // 任务级默认 coding / Default to coding for task-level
            success,
            weight: 0.2, // 任务级权重高于单次 tool_call (0.1) / Higher weight than per-tool-call
          });

          // 种群进化器记录分配结果 / Species evolver records assignment outcome
          const speciesEvolver = adapter._engines?.speciesEvolver;
          const role = meta?.role;
          if (speciesEvolver && role) {
            speciesEvolver.recordAssignment(role, success);
          }
        }
      } catch (err) {
        logger.debug?.(`[Claw-Swarm] Phase 4 subagent_ended scoring error: ${err.message}`);
      }
    }, { priority: 20 });

    // ━━━ llm_output [V5.1 新增] ━━━
    // SOUL.md 双阶段迁移 — "派遣"文本解析 → swarm_spawn tool_call 转换
    // Dual-phase migration — text "dispatch" parsing → swarm_spawn tool_call conversion
    api.on('llm_output', async (event, ctx) => {
      if (config.hierarchical?.enabled === false) return;

      const coordinator = adapter._engines?.hierarchicalCoordinator;
      const content = event.content || event.text || '';
      if (!content || content.length < 5) return;

      // 快速门控: 只处理包含"派遣"关键词的输出
      // Quick gate: only process output containing dispatch keywords
      if (!/(?:派遣?\s*(?:MPU-)?D[123])/i.test(content)) return;

      // 去抖: 如果同一 turn 已检测到 tool_call, 抑制文本解析
      // Dedup: if tool_call already detected in this turn, suppress text parsing
      const turnId = event.turnId || ctx?.turnId;
      if (coordinator && coordinator.shouldSuppressTextParsing(turnId)) {
        logger.debug?.('[Claw-Swarm] llm_output: text parsing suppressed (tool_call detected)');
        return;
      }

      // 检测是否有 swarm_spawn tool_call 在本轮输出中
      // Detect if swarm_spawn tool_call exists in this turn's output
      const toolCalls = event.toolCalls || event.tool_calls || [];
      const hasSpawnToolCall = toolCalls.some(tc =>
        (tc.name || tc.function?.name) === 'swarm_spawn'
      );

      if (hasSpawnToolCall && coordinator) {
        // 记录 tool_call 已检测, 后续文本解析将被抑制
        // Record tool_call detected, subsequent text parsing will be suppressed
        coordinator.recordToolCallDetected(turnId);
        return;
      }

      // 阶段 A: 文本"派遣"指令 → 记录为 info (实际转换由现有 message_sending 拦截器处理)
      // Phase A: text dispatch → log as info (actual conversion handled by existing message_sending interceptor)
      logger.info?.('[Claw-Swarm] llm_output: detected text dispatch pattern (Phase A compatibility)');
    }, { priority: 10 });

    // ── 4. 注册 OpenClaw 工具 / Register OpenClaw Tools ─────────────────
    for (const tool of tools) {
      api.registerTool(tool);
    }

    // ── 4b. 注册 swarm_dispatch 拦截器 ──────────────────────────────────
    //    Register swarm_dispatch interceptor
    //
    //    关键修复: api.runtime 在 register() 时不可用, 只在事件触发时可用
    //    Key fix: api.runtime is NOT available during register(), only during event handling
    //    所以: 从 api.config 读取 token/channel, hook 内部延迟获取 sendMessageDiscord
    //    So: read tokens/channels from api.config, lazily resolve sendMessageDiscord in hook
    {
      // 从 Discord 账户配置中提取 bot ID 映射 (使用 api.config, 不依赖 api.runtime)
      // Extract bot ID mapping from Discord account config (uses api.config, not api.runtime)
      const discordConfig = api.config?.channels?.discord || {};
      const discordAccounts = discordConfig.accounts || {};
      const agentMap = {};

      // 从 bot token 解析 bot user ID (token 格式: base64(bot_id).timestamp.hmac)
      // Parse bot user ID from token (token format: base64(bot_id).timestamp.hmac)
      for (const agentName of ['mpu-d1', 'mpu-d2', 'mpu-d3']) {
        const accountCfg = discordAccounts[agentName];
        if (accountCfg?.token) {
          try {
            const botId = Buffer.from(accountCfg.token.split('.')[0], 'base64').toString();
            if (botId && /^\d+$/.test(botId)) {
              agentMap[agentName] = botId;
            }
          } catch {
            // 解析失败, 跳过 / Parse failed, skip
          }
        }
      }

      // 解析 MPU-T 自身的 bot ID (从默认账户 token 或全局 token)
      // Parse MPU-T's own bot ID from default account token or global token
      let selfBotId = '';
      const defaultToken = discordAccounts.default?.token || discordConfig.token;
      if (defaultToken) {
        try {
          selfBotId = Buffer.from(defaultToken.split('.')[0], 'base64').toString();
        } catch { /* ignore */ }
      }

      // 解析协作频道 ID
      // Resolve collaboration channel ID
      let collaborationChannelId = config.dispatch?.channelId || '';
      if (!collaborationChannelId) {
        // 使用 accounts.default 的 guilds (有 requireMention 配置)
        // Use accounts.default guilds (has requireMention config)
        const guildConfig = discordAccounts.default?.guilds || discordConfig.guilds || {};
        for (const [, guild] of Object.entries(guildConfig)) {
          for (const [chId, chCfg] of Object.entries(guild.channels || {})) {
            if (chCfg.allow && guild.requireMention && chCfg.requireMention !== false) {
              collaborationChannelId = chId;
              break;
            }
          }
          if (collaborationChannelId) break;
        }
      }

      if (Object.keys(agentMap).length > 0 && collaborationChannelId && selfBotId) {
        // ━━━ 广谱派遣拦截器 (Broad-spectrum dispatch interceptor) ━━━
        //
        // 问题: Kimi K2.5 输出格式不可预测 —— 有时写 swarm_dispatch({...}),
        //       有时写中文 "派遣 D1 去调研..."。只匹配一种格式不够。
        // 方案: 同时匹配两种格式, 自然语言优先 (因为模型更倾向于写中文)。
        //
        // Problem: Kimi K2.5 output format is unpredictable.
        // Solution: Match both explicit JSON and natural language Chinese patterns.

        /**
         * 从模型输出文本中解析派遣意图
         * Parse dispatch intents from model output text
         *
         * @param {string} text - 模型输出文本
         * @returns {Array<{agentId: string, task: string, fullMatch: string}>}
         */
        function parseDispatchIntents(text) {
          const results = [];
          const seen = new Set();

          // ── Format 1: 显式 swarm_dispatch({...}) ──
          const explicitRegex = /swarm_dispatch\s*\(\s*\{([^}]+)\}\s*\)/g;
          for (const match of text.matchAll(explicitRegex)) {
            try {
              let jsonStr = `{${match[1]}}`;
              jsonStr = jsonStr.replace(/\n/g, '\\n');
              const params = JSON.parse(jsonStr);
              if (params.agentId && params.task && agentMap[params.agentId] && !seen.has(params.agentId)) {
                seen.add(params.agentId);
                results.push({ agentId: params.agentId, task: params.task, fullMatch: match[0] });
              }
            } catch { /* JSON 解析失败, 继续尝试自然语言 */ }
          }
          if (results.length > 0) return results; // 显式格式优先

          // ── Format 2: 中文自然语言 (两轮扫描) ──
          // 覆盖模型的所有已知输出模式:
          //   "派遣 MPU-D1 调研 Tushare daily 接口"
          //   "**第一步：派遣 MPU-D1 调研 Tushare daily 接口**"
          //   "首先派 D1 去调研 Tushare daily 接口文档："
          //   "D1 侦察 → 调研 Tushare daily 接口文档"
          //
          // 两轮扫描策略 (Two-pass scan):
          //   Pass 1: Pattern A — 只匹配含 "派遣/派" 关键词的行 (最可靠)
          //   Pass 2: Pattern B — 仅当 Pass 1 无结果时, 匹配 "D1 动作 任务" 格式
          //   这样避免摘要行 "D1 调研 → D3 实现" 抢占 seen 导致后续真正派遣被跳过

          const lines = text.split('\n').map(l => ({
            raw: l.trim(),
            clean: l.replace(/\*\*/g, '').replace(/[`_~]+/g, '').trim()
          })).filter(l => l.clean.length > 0);

          // ── Pass 1: Pattern A — "派遣/派 + D1/D2/D3 + 任务" ──
          for (const { raw, clean } of lines) {
            const mA = clean.match(/(?:派遣|派)\s*(?:MPU-)?D([123])\s*(?:去|来)?\s*(.+)/i);
            if (mA) {
              const agentId = `mpu-d${mA[1]}`;
              const task = mA[2].replace(/[*`_~：:→]+$/g, '').trim();
              if (task.length > 2 && agentMap[agentId] && !seen.has(agentId)) {
                seen.add(agentId);
                results.push({ agentId, task, fullMatch: raw });
              }
            }
          }
          if (results.length > 0) return results; // Pattern A 命中, 直接返回

          // ── Pass 2: Pattern B — "D1 侦察/调研/审查/编码/实现 + 任务" (fallback) ──
          // 仅当 Pattern A 未找到任何派遣时才执行
          // 额外过滤: 跳过含多个 Agent 引用的摘要行 (如 "D1 调研 → D3 实现 → D2 审查")
          for (const { raw, clean } of lines) {
            // 如果一行中出现多个 D[123] 引用, 跳过 (这是摘要行)
            const agentRefs = clean.match(/D[123]/gi);
            if (agentRefs && agentRefs.length > 1) continue;

            const mB = clean.match(/(?:MPU-)?D([123])\s*(?:侦察|调研|审查|编码|实现|执行|验证|分析|搜索|负责)\s*(.+)/i);
            if (mB) {
              const agentId = `mpu-d${mB[1]}`;
              const actionAndTask = mB[0].replace(/[*`_~：:→]+$/g, '').trim();
              if (actionAndTask.length > 4 && agentMap[agentId] && !seen.has(agentId)) {
                seen.add(agentId);
                results.push({ agentId, task: actionAndTask, fullMatch: raw });
              }
            }
          }

          return results;
        }

        // ── 注册 message_sending 拦截器 ──
        api.on('message_sending', async (event, ctx) => {
          const content = event.content || '';

          // ── 诊断日志 (每次 hook 触发都输出) ──
          logger.info?.(`[SwarmDispatch:ENTRY] hook fired! contentLen=${content.length} to=${event.to ?? '?'} channel=${ctx?.channelId ?? event.metadata?.channel ?? '?'} contentPreview=${JSON.stringify(content.substring(0, 100))}`);

          // 快速门控: 跳过不包含派遣关键词的消息
          // Quick gate: skip messages without dispatch keywords
          if (!/(?:swarm_dispatch|派遣?\s*(?:MPU-)?D[123]|D[123]\s*(?:侦察|调研|审查|编码|实现))/i.test(content)) {
            return;
          }

          // 延迟获取 sendMessageDiscord
          const sendDiscord = api.runtime?.discord?.sendMessageDiscord;
          if (!sendDiscord) {
            logger.error?.('[SwarmDispatch] api.runtime.discord.sendMessageDiscord not available');
            return;
          }

          const intents = parseDispatchIntents(content);
          if (intents.length === 0) return;

          logger.info?.(`[SwarmDispatch] Detected ${intents.length} dispatch intent(s) in outbound message`);

          let modifiedContent = content;

          for (const intent of intents) {
            try {
              const botUserId = agentMap[intent.agentId];
              const mentionText = `<@${botUserId}> ${intent.task}\n\n完成后请 @mention 我 <@${selfBotId}>。`;

              logger.info?.(`[SwarmDispatch] → ${intent.agentId}: ${intent.task.substring(0, 80)}`);

              await sendDiscord(collaborationChannelId, mentionText, { cfg: api.config });

              logger.info?.(`[SwarmDispatch] ✓ ${intent.agentId} dispatched`);

              // 替换匹配行为简洁状态
              const replacement = `✅ 已派遣 ${intent.agentId} → ${intent.task.substring(0, 50)}${intent.task.length > 50 ? '...' : ''}`;
              modifiedContent = modifiedContent.replace(intent.fullMatch, replacement);
            } catch (err) {
              logger.error?.(`[SwarmDispatch] ✗ ${intent.agentId} failed: ${err.message}`);
              modifiedContent = modifiedContent.replace(intent.fullMatch, `❌ 派遣 ${intent.agentId} 失败`);
            }
          }

          if (modifiedContent !== content) {
            return { content: modifiedContent };
          }
        }, { priority: 90 });

        logger.info?.(
          `[Claw-Swarm] swarm_dispatch hook registered: agents=${JSON.stringify(agentMap)}, ` +
          `channel=${collaborationChannelId}, self=${selfBotId}`
        );
      } else {
        logger.warn?.(
          `[Claw-Swarm] swarm_dispatch skipped: ` +
          `agents=${Object.keys(agentMap).length}, channel=${collaborationChannelId || '(none)'}, self=${selfBotId || '(none)'}`
        );
      }
    }

    // ── 5. 启动 L6 仪表盘 (可选) / Start L6 Dashboard (optional) ────────
    if (config.dashboard?.enabled) {
      _startDashboard(adapter, config, logger).catch(err => {
        logger.warn?.(`[Claw-Swarm] Dashboard start failed: ${err.message}`);
      });
    }

    // V5.1: process exit 兜底 PID 清理 / Fallback PID cleanup on process exit
    process.on('exit', () => {
      try {
        if (existsSync(PID_FILE)) unlinkSync(PID_FILE);
      } catch { /* best-effort */ }
    });

    const hookCount = 14; // V5.0(6) + V5.1(gateway_start, before_model_resolve, before_tool_call, before_prompt_build, subagent_spawning, subagent_spawned, subagent_ended, llm_output)
    logger.info?.(`[Claw-Swarm] V${VERSION} plugin registered — ${hookCount} hooks + ${tools.length} tools`);
  },
};

// ============================================================================
// 内部辅助 / Internal Helpers
// ============================================================================

/**
 * 从工具名推断能力维度 / Infer capability dimension from tool name
 *
 * @param {string} toolName
 * @returns {string}
 * @private
 */
function _inferDimension(toolName) {
  const name = (toolName || '').toLowerCase();
  if (name.includes('search') || name.includes('web') || name.includes('fetch')) return 'domain';
  if (name.includes('test')) return 'testing';
  if (name.includes('doc') || name.includes('readme')) return 'documentation';
  if (name.includes('security') || name.includes('auth')) return 'security';
  if (name.includes('perf') || name.includes('bench')) return 'performance';
  if (name.includes('chat') || name.includes('message') || name.includes('discord')) return 'communication';
  return 'coding';
}

/**
 * 启动 L6 仪表盘服务 (异步, 不阻塞插件注册)
 * Start L6 dashboard service (async, does not block plugin registration)
 *
 * @param {PluginAdapter} adapter
 * @param {Object} config
 * @param {Object} logger
 * @private
 */
async function _startDashboard(adapter, config, logger) {
  try {
    // 动态导入 L6 监控模块 / Dynamic import L6 monitoring modules
    const { StateBroadcaster } = await import('./L6-monitoring/state-broadcaster.js');
    const { MetricsCollector } = await import('./L6-monitoring/metrics-collector.js');
    const { DashboardService } = await import('./L6-monitoring/dashboard-service.js');

    const engines = adapter._engines;
    if (!engines.messageBus) return;

    const broadcaster = new StateBroadcaster({ messageBus: engines.messageBus, logger });
    const metricsCollector = new MetricsCollector({ messageBus: engines.messageBus, logger });
    const dashboard = new DashboardService({
      stateBroadcaster: broadcaster,
      metricsCollector,
      logger,
      port: config.dashboard?.port || 19100,
    });

    broadcaster.start();
    metricsCollector.start();
    await dashboard.start();

    logger.info?.(`[Claw-Swarm] Dashboard started on port ${dashboard.getPort()}`);
  } catch (err) {
    logger.warn?.(`[Claw-Swarm] Dashboard unavailable: ${err.message}`);
  }
}

// ── 命名导出 (供高级用途直接导入) / Named exports for advanced direct imports ──
export { PluginAdapter } from './L5-application/plugin-adapter.js';
export { ContextService } from './L5-application/context-service.js';
export { CircuitBreaker } from './L5-application/circuit-breaker.js';
export { VERSION, NAME };
