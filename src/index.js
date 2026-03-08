/**
 * Claw-Swarm V5.0 — OpenClaw 插件入口 / OpenClaw Plugin Entry Point
 *
 * 使用 OpenClaw Plugin SDK 的 register(api) 模式注册钩子和工具。
 * Uses OpenClaw Plugin SDK register(api) pattern to register hooks and tools.
 *
 * OpenClaw 事件 → V5.0 内部映射:
 * OpenClaw Event → V5.0 Internal Mapping:
 *
 *   before_agent_start  → onAgentStart + onPrependContext (上下文注入)
 *   agent_end           → onAgentEnd (记忆固化, Gossip 更新)
 *   after_tool_call     → onToolCall + onToolResult (工具监控)
 *   subagent_spawning   → onSubAgentSpawn (SOUL 注入, 治理门控)
 *   subagent_ended      → onSubAgentComplete / onSubAgentAbort (质量门控, 信息素)
 *   before_reset        → onMemoryConsolidate (记忆固化)
 *   gateway_stop        → close() (引擎关闭)
 *   message_sending     → onSubAgentMessage (消息路由)
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

// ============================================================================
// 辅助函数 / Helpers
// ============================================================================

/**
 * 解析数据库路径 / Resolve database path
 *
 * 优先使用用户配置的 dbPath, 否则使用 dataDir 下的默认文件名。
 * Prefers user-configured dbPath, else uses default filename under dataDir.
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
  if (dataDir) return join(dataDir, DB_FILENAME);
  return null; // 使用内存模式 / Use in-memory mode
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
   * @param {string} [api.dataDir] - 数据目录 / Data directory path
   * @param {Function} api.on - 钩子注册 / Hook registration
   * @param {Function} api.registerTool - 工具注册 / Tool registration
   */
  register(api) {
    const config = api.pluginConfig || {};
    const logger = api.logger || console;
    const dataDir = api.dataDir || '';

    // ── 1. 解析数据库路径 / Resolve DB path ─────────────────────────────
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

    // ── 3. 注册 OpenClaw 钩子 / Register OpenClaw Hooks ─────────────────

    // ━━━ before_agent_start ━━━
    // V5.0: onAgentStart (Agent 注册, Gossip 状态) + onPrependContext (上下文注入)
    // V5.0: onAgentStart (agent registration, gossip state) + onPrependContext (context injection)
    api.on('before_agent_start', async (event, ctx) => {
      const agentId = resolveAgentId(event, ctx);

      // 调用 onAgentStart: 注册到 Gossip + AgentRepo
      // Call onAgentStart: register in Gossip + AgentRepo
      try {
        await hooks.onAgentStart({
          agentId,
          taskDescription: event.prompt || event.taskDescription || null,
          tier: event.tier || 'trainee',
        });
      } catch (err) {
        logger.warn?.(`[Claw-Swarm] onAgentStart failed: ${err.message}`);
      }

      // 调用 onPrependContext: 构建上下文 (记忆 + 知识图谱 + 信息素)
      // Call onPrependContext: build context (memory + knowledge graph + pheromone)
      try {
        const result = await hooks.onPrependContext({
          agentId,
          taskDescription: event.prompt || event.taskDescription || null,
        });
        if (result?.prependText) {
          return { prependContext: result.prependText };
        }
      } catch (err) {
        logger.warn?.(`[Claw-Swarm] onPrependContext failed: ${err.message}`);
      }

      return undefined;
    }, { priority: 60 });

    // ━━━ agent_end ━━━
    // V5.0: onAgentEnd (记忆固化, Gossip 更新, 缓存清理)
    // V5.0: onAgentEnd (memory consolidation, gossip update, cache invalidation)
    api.on('agent_end', async (event, ctx) => {
      const agentId = resolveAgentId(event, ctx);

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

    // ━━━ subagent_spawning ━━━
    // V5.0: onSubAgentSpawn (SOUL 注入 + 治理门控)
    // V5.0: onSubAgentSpawn (SOUL injection + governance gate)
    api.on('subagent_spawning', async (event, ctx) => {
      const parentId = resolveAgentId(event, ctx);
      const subAgentId = event.subagentId || event.agentId || `sub-${Date.now()}`;

      try {
        const result = await hooks.onSubAgentSpawn({
          subAgentId,
          parentAgentId: parentId,
          subAgentName: event.name || event.label || subAgentId,
          tier: event.tier || 'trainee',
          persona: event.persona || 'worker-bee',
          behavior: event.behavior || 'adaptive',
          capabilities: event.capabilities || null,
          taskDescription: event.taskDescription || event.prompt || null,
          role: event.role || null,
          roleTemplate: event.roleTemplate || null,
          zoneId: event.zoneId || null,
          zoneName: event.zoneName || null,
        });

        // SOUL 片段注入: 通过 customPrompt 返回给 OpenClaw
        // SOUL snippet injection: return via customPrompt to OpenClaw
        if (result?.soulSnippet) {
          return { customPrompt: result.soulSnippet };
        }
      } catch (err) {
        logger.warn?.(`[Claw-Swarm] onSubAgentSpawn failed: ${err.message}`);
      }

      return undefined;
    });

    // ━━━ subagent_ended ━━━
    // V5.0: onSubAgentComplete (成功: 质量门控 + TRAIL 信息素 + 声誉)
    //        onSubAgentAbort (失败: PipelineBreaker + ALARM 信息素)
    // V5.0: onSubAgentComplete (success: quality gate + TRAIL pheromone + reputation)
    //        onSubAgentAbort (failure: pipeline breaker + ALARM pheromone)
    api.on('subagent_ended', async (event, ctx) => {
      const subAgentId = event.subagentId || event.agentId || 'unknown';
      const outcome = event.outcome || 'ok';
      const isSuccess = outcome === 'ok' || outcome === 'success';

      try {
        if (isSuccess) {
          await hooks.onSubAgentComplete({
            subAgentId,
            taskId: event.taskId || `task-${subAgentId}`,
            result: event.result || null,
            taskScope: event.taskScope || `/task/${event.taskId || subAgentId}`,
          });
        } else {
          await hooks.onSubAgentAbort({
            subAgentId,
            taskId: event.taskId || `task-${subAgentId}`,
            reason: event.reason || outcome,
            taskScope: event.taskScope || `/task/${event.taskId || subAgentId}`,
          });
        }
      } catch (err) {
        logger.warn?.(`[Claw-Swarm] subagent_ended handling failed: ${err.message}`);
      }
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

    logger.info?.(`[Claw-Swarm] V${VERSION} plugin registered — 8 hooks + ${tools.length} tools`);
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
