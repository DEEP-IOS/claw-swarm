/**
 * Claw-Swarm V5.0 — OpenClaw 插件入口 / OpenClaw Plugin Entry Point
 *
 * 使用 OpenClaw Plugin SDK 的 register(api) 模式注册钩子和工具。
 * Uses OpenClaw Plugin SDK register(api) pattern to register hooks and tools.
 *
 * OpenClaw 事件 → V5.0 内部映射:
 * OpenClaw Event → V5.0 Internal Mapping:
 *
 *   before_agent_start  → onAgentStart + onSubAgentSpawn (SOUL) + onPrependContext
 *   agent_end           → onSubAgentComplete/Abort (质量门控) + onAgentEnd (记忆固化)
 *   after_tool_call     → onToolCall + onToolResult (工具监控, 能力更新)
 *   before_reset        → onMemoryConsolidate (记忆固化)
 *   gateway_stop        → close() (引擎关闭)
 *   message_sending     → onSubAgentMessage (消息路由)
 *
 * 子 Agent 生命周期通过工具驱动模式实现:
 * Sub-agent lifecycle is implemented via tool-driven mode:
 *   - SOUL 注入: swarm_spawn 工具返回 SOUL 片段 + before_agent_start 注入上下文
 *   - 质量门控: agent_end 时检测已注册 Agent, 触发 onSubAgentComplete/Abort
 *   - 信息素:   质量门控结果驱动 TRAIL/ALARM 信息素发射
 *
 * V5.0 内部钩子 (无直接 OpenClaw 事件, 通过 MessageBus 内部触发):
 * V5.0 Internal-only hooks (triggered via MessageBus, no direct OpenClaw event):
 *   onTaskDecompose, onReplanTrigger, onZoneEvent, onPheromoneThreshold
 *
 * @module claw-swarm
 * @version 5.0.0
 * @author DEEP-IOS
 */

import { join } from 'node:path';
import { homedir } from 'node:os';
import { PluginAdapter } from './L5-application/plugin-adapter.js';

// ============================================================================
// 常量 / Constants
// ============================================================================

const VERSION = '5.0.0';
const NAME = 'claw-swarm';
const DB_FILENAME = 'claw-swarm.db';

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

export default {
  id: NAME,
  name: 'Claw-Swarm V5.0',
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

    // 获取内部钩子处理器和工具定义 / Get internal hook handlers and tool definitions
    const hooks = adapter.getHooks();
    const tools = adapter.getTools();

    // ── 3. 注册 OpenClaw 钩子 (6 个) / Register OpenClaw Hooks (6) ──────

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
    // V5.0: onToolCall (working memory recording) + onToolResult (capability dimension update)
    api.on('after_tool_call', async (event, ctx) => {
      const agentId = resolveAgentId(event, ctx);
      const toolName = event.toolName || event.name || 'unknown';

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
    });

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
    // V5.0: close() (定时器停止, 引擎销毁, 数据库关闭)
    // V5.0: close() (stop timers, destroy engines, close database)
    api.on('gateway_stop', async () => {
      try {
        adapter.close();
        logger.info?.('[Claw-Swarm] V5.0 shutdown complete');
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

    // ── 4. 注册 OpenClaw 工具 / Register OpenClaw Tools ─────────────────
    for (const tool of tools) {
      api.registerTool(tool);
    }

    // ── 5. 启动 L6 仪表盘 (可选) / Start L6 Dashboard (optional) ────────
    if (config.dashboard?.enabled) {
      _startDashboard(adapter, config, logger).catch(err => {
        logger.warn?.(`[Claw-Swarm] Dashboard start failed: ${err.message}`);
      });
    }

    logger.info?.(`[Claw-Swarm] V${VERSION} plugin registered — 6 hooks + ${tools.length} tools`);
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
  if (name.includes('test')) return 'testing';
  if (name.includes('doc') || name.includes('readme')) return 'documentation';
  if (name.includes('security') || name.includes('auth')) return 'security';
  if (name.includes('perf') || name.includes('bench')) return 'performance';
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
