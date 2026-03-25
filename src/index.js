/**
 * Claw-Swarm V9.0 — OpenClaw Plugin Entry
 *
 * V9 直接入口，无条件启用全部功能。
 * 不再有 Feature Flag、不再有 V8 子进程 IPC 代理、不再有条件分支。
 * 全部域（core/communication/intelligence/orchestration/quality/observe/bridge）
 * 在 gateway_start 时统一激活。
 *
 * @module openclaw-swarm
 * @version 9.0.0
 * @author DEEP-IOS
 */

import { activate as activateV9, deactivate as deactivateV9 } from './index-v9.js';
import { createSwarmContextEngine } from './bridge/context/swarm-context-engine.js';

const VERSION = '9.2.0';
const NAME = 'openclaw-swarm';
const DASHBOARD_PORT = 19100;

// ─── Adapter: V8 Plugin API → V9 App Interface ────────────────────────────

/**
 * 将 OpenClaw plugin API 适配为 V9 的 app 接口。
 *
 * V9.2 "God Runtime": 完整暴露 plugin SDK 全部能力，包括:
 *   - api.runtime (事件、session、subagent 管理)
 *   - api.registerGatewayMethod (自定义 WS RPC)
 *   - api.registerContextEngine (替换 Context Engine)
 *   - api.config (完整 OpenClaw 配置)
 *   - api.registerHook (标准 hook 注册)
 *
 * @param {Object} api - OpenClaw plugin API
 * @returns {Object} app - V9 compatible app object
 */
function createAppAdapter(api) {
  return {
    // ── Config & Bus ────────────────────────────────────────────
    getConfig: () => api.pluginConfig || {},
    getFullConfig: () => api.config || api.pluginConfig || {},
    getMessageBus: () => null, // V9 creates its own EventBus internally

    // ── Hook registration ───────────────────────────────────────
    addHook: (name, handler) => {
      // 优先使用 registerHook (3.7+), 降级到 on()
      if (typeof api.registerHook === 'function') {
        api.registerHook(name, handler);
      } else if (typeof api.on === 'function') {
        api.on(name, handler);
      }
    },

    // ── Tool registration ───────────────────────────────────────
    registerTool: (tool) => {
      if (typeof api.registerTool === 'function') {
        api.registerTool(tool);
      }
    },

    // ── God Runtime: 完整 runtime 对象透传 ────────────────────
    runtime: api.runtime || null,

    // ── Gateway WS RPC 注册 ──────────────────────────────────
    registerGatewayMethod: (method, handler) => {
      if (typeof api.registerGatewayMethod === 'function') {
        api.registerGatewayMethod(method, handler);
      }
    },

    // ── Context Engine 注册 ──────────────────────────────────
    registerContextEngine: (id, factory) => {
      if (typeof api.registerContextEngine === 'function') {
        api.registerContextEngine(id, factory);
      }
    },

    // ── HTTP 路由注册 ────────────────────────────────────────
    registerHttpRoute: (route) => {
      if (typeof api.registerHttpRoute === 'function') {
        api.registerHttpRoute(route);
      }
    },

    // ── 命令注册 ─────────────────────────────────────────────
    registerCommand: (cmd) => {
      if (typeof api.registerCommand === 'function') {
        api.registerCommand(cmd);
      }
    },

    // ── 服务注册 ─────────────────────────────────────────────
    registerService: (svc) => {
      if (typeof api.registerService === 'function') {
        api.registerService(svc);
      }
    },

    // ── CLI 子命令注册 ─────────────────────────────────────────
    registerCli: (cli) => {
      if (typeof api.registerCli === 'function') {
        api.registerCli(cli);
      }
    },

    // ── Provider 注册 (蜂群作为模型路由器) ─────────────────────
    registerProvider: (provider) => {
      if (typeof api.registerProvider === 'function') {
        api.registerProvider(provider);
      }
    },

    // ── 交互式处理器注册 (Telegram/Discord) ──────────────────
    registerInteractiveHandler: (handler) => {
      if (typeof api.registerInteractiveHandler === 'function') {
        api.registerInteractiveHandler(handler);
      }
    },

    // ── 原始 API 引用 (用于高级场景) ─────────────────────────
    _rawApi: api,
  };
}

// ─── Singleton ──────────────────────────────────────────────────────────────

let _v9Instance = null;

// ─── Plugin Definition ──────────────────────────────────────────────────────

export default {
  id: NAME,
  name: 'Claw-Swarm V9',
  version: VERSION,

  /**
   * 注册插件到 OpenClaw API。
   *
   * 在 gateway_start 时激活 V9 全部域，
   * 在 gateway_stop 时优雅关闭。
   *
   * @param {Object} api - OpenClaw Plugin API
   */
  register(api) {
    const logger = api.logger || console;
    const app = createAppAdapter(api);

    // ━━━ 启动 / Startup ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    let _starting = false;

    async function startup() {
      if (_v9Instance || _starting) return;
      _starting = true;
      try {
        _v9Instance = await activateV9(app);
        logger.info?.(`[Claw-Swarm] V${VERSION} activated — all domains running, 0 feature flags`);
      } catch (err) {
        logger.error?.(`[Claw-Swarm] V9 activation failed: ${err.message}`);
      } finally {
        _starting = false;
      }
    }

    // ━━━ 关闭 / Shutdown ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    async function shutdown() {
      if (!_v9Instance) return;
      try {
        await deactivateV9(app);
        logger.info?.(`[Claw-Swarm] V${VERSION} shutdown complete`);
      } catch (err) {
        logger.error?.(`[Claw-Swarm] V9 shutdown error: ${err.message}`);
      }
      _v9Instance = null;
    }

    // ━━━ Lifecycle hooks ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    // gateway_start → activate V9
    app.addHook('gateway_start', async () => {
      await startup();
    });

    // gateway_stop → deactivate V9
    app.addHook('gateway_stop', async () => {
      await shutdown();
    });

    // registerService (Clawdbot startup path)
    app.registerService({
      id: 'claw-swarm-v9',
      async start() {
        logger.info?.('[Claw-Swarm] Service start triggered');
        await startup();
      },
      async stop() {
        logger.info?.('[Claw-Swarm] Service stop triggered');
        await shutdown();
      },
    });

    // ━━━ ContextEngine: Symbol hook + fallback registration ━━━━━━━━━━━━━━
    // OpenClaw's resolveContextEngine() checks Symbol.for('claw-swarm.contextEngineHook')
    // and wraps the resolved engine. This is the primary integration path.

    try {
      // Lazy core proxy — resolves to the actual core once V9 is activated
      const coreProxy = new Proxy({}, {
        get(_, prop) { return _v9Instance?.core?.[prop]; },
      });

      const HOOK_KEY = Symbol.for('claw-swarm.contextEngineHook');
      globalThis[HOOK_KEY] = (baseEngine) => {
        const swarmEngine = createSwarmContextEngine(coreProxy);
        return {
          async ingest(params) {
            try { await swarmEngine.ingest?.(params); } catch {}
            return baseEngine?.ingest?.(params);
          },
          async assemble(params) {
            let swarmResult;
            try { swarmResult = await swarmEngine.assemble?.(params); } catch {}
            let baseResult;
            try { baseResult = await baseEngine?.assemble?.(params); } catch {}
            if (swarmResult?.systemPromptAddition) {
              const merged = { ...(baseResult || swarmResult) };
              merged.systemPromptAddition = swarmResult.systemPromptAddition +
                (baseResult?.systemPromptAddition ? '\n\n' + baseResult.systemPromptAddition : '');
              return merged;
            }
            return baseResult || swarmResult;
          },
          async compact(params) { return baseEngine?.compact?.(params); },
          async bootstrap(params) {
            try { await swarmEngine.bootstrap?.(params); } catch {}
            return baseEngine?.bootstrap?.(params);
          },
        };
      };

      // Fallback: register via normal API in case Symbol hook is not checked
      app.registerContextEngine('claw-swarm', () => createSwarmContextEngine(coreProxy));

      logger.info?.('[Claw-Swarm] ContextEngine hook installed');
    } catch (err) {
      logger.debug?.(`[Claw-Swarm] ContextEngine registration failed: ${err.message}`);
    }

    // ━━━ Gateway WS RPC 方法 (God Runtime) ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    // Gateway method handlers — defined once, registered via Plugin API AND
    // exposed on globalThis so OpenClaw's patched code can call them directly.
    // This is the "Swarm = OS" pattern: we OWN these methods, Plugin API is
    // just one delivery mechanism.

    const gatewayMethods = {
      'swarm.status': async () => {
        if (!_v9Instance) return { ready: false };
        return _v9Instance.bridgeFacade?.getStatus?.() ?? { ready: false };
      },
      'swarm.field': async (params) => {
        if (!_v9Instance) return { error: 'not_ready' };
        const scope = params?.scope ?? 'global';
        return _v9Instance.core?.field?.superpose?.(scope) ?? {};
      },
      'swarm.metrics': async () => {
        if (!_v9Instance) return { error: 'not_ready' };
        return _v9Instance.core?.observe?.getMetrics?.() ?? {};
      },
      'swarm.run': async (params) => {
        if (!_v9Instance) return { error: 'not_ready' };
        const goal = params?.goal;
        if (!goal) return { error: 'missing_goal' };
        // Use routeTask + createPlan (the actual orchestration facade API)
        const intent = _v9Instance.core?.intelligence?.classifyIntent?.(goal) ?? { primary: 'task', confidence: 0.7, description: goal };
        const route = _v9Instance.core?.orchestration?.routeTask?.(intent, params);
        if (!route) return { error: 'no_orchestration' };
        const plan = _v9Instance.core?.orchestration?.createPlan?.(intent, { ...params, routeDecision: route });
        return plan ?? { error: 'plan_creation_failed' };
      },
    };

    // Register via Plugin API (narrative wrapper — still needed for loading)
    for (const [method, handler] of Object.entries(gatewayMethods)) {
      app.registerGatewayMethod(method, handler);
    }

    // T0 direct path: store on globalThis so patched OpenClaw code can bypass Plugin API
    const GW_KEY = Symbol.for('claw-swarm.gatewayMethods');
    globalThis[GW_KEY] = gatewayMethods;

    // ━━━ T0 Interactive Handler: Symbol hook for direct message interception ━━━
    // Instead of depending solely on registerInteractiveHandler callback,
    // we install a Symbol-keyed hook that OpenClaw's message router can
    // check directly. This ensures Swarm intercepts messages even if the
    // Plugin API's registerInteractiveHandler path is broken.
    const IH_KEY = Symbol.for('claw-swarm.interactiveHandler');
    globalThis[IH_KEY] = (message) => {
      if (!_v9Instance) return false;
      if (message?.text) {
        _v9Instance.chatBridge?.interject(message.dagId || 'global', message.text);
        return true;
      }
      return false;
    };

    // ━━━ Gateway Dashboard proxy ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    try {
      const proxyToDashboard = async (req) => {
        try {
          const url = `http://127.0.0.1:${DASHBOARD_PORT}${req.url.replace(/^\/swarm/, '')}`;
          const resp = await fetch(url, {
            method: req.method,
            headers: { 'Accept': 'application/json' },
          });
          const contentType = resp.headers.get('content-type') || 'application/json';
          const body = await resp.text();
          return { status: resp.status, headers: { 'content-type': contentType }, body };
        } catch (err) {
          return {
            status: 502,
            body: JSON.stringify({ error: 'Dashboard unavailable', message: err.message }),
          };
        }
      };

      app.registerHttpRoute({ method: 'GET', path: '/swarm/api/v1/*', handler: proxyToDashboard });
      app.registerHttpRoute({ method: 'GET', path: '/swarm/api/v9/*', handler: proxyToDashboard });
      app.registerHttpRoute({ method: 'GET', path: '/swarm/v6/*', handler: proxyToDashboard });
    } catch (err) {
      logger.debug?.(`[Claw-Swarm] Dashboard proxy 注册失败 (非致命): ${err.message}`);
    }

    // ━━━ /swarm command system ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    try {
      /** 当前 verbosity 模式 */
      let _verbosity = 'normal';

      const subcommands = {
        status() {
          if (!_v9Instance) return { text: '蜂群未启动' };
          const status = _v9Instance.bridgeFacade?.getStatus?.() ?? {};
          const lines = [
            `**蜂群状态** (${status.ready ? '✅ 运行中' : '❌ 未就绪'})`,
            `- 已注册工具: ${status.tools?.length || 0}`,
            `- 活跃 session: ${status.sessionBridge?.activeSessions || 0}`,
            `- 活跃 agent: ${status.nativeSpawnManager?.activeAgents || 0}`,
            `- 当前模式: ${_verbosity}`,
          ];
          if (status.interaction?.progress) {
            lines.push(`- 跟踪中 DAG: ${status.interaction.progress.trackedDags || 0}`);
          }
          return { text: lines.join('\n') };
        },

        progress(args) {
          if (!_v9Instance) return { text: '蜂群未启动' };
          const dagId = args || 'latest';
          const progress = _v9Instance.bridgeFacade?.getProgress?.(dagId);
          if (!progress?.found) {
            return { text: `未找到任务进度 [${dagId}]` };
          }
          const lines = [
            `**任务进度** [${dagId}]`,
            `- 已完成步骤: ${progress.stepCount}`,
            progress.progressSummary || '暂无摘要',
          ];
          if (progress.estimate) {
            lines.push(`- 平均步骤耗时: ${Math.round(progress.estimate.avgStepDurationMs / 1000)}s`);
          }
          return { text: lines.join('\n') };
        },

        budget() {
          if (!_v9Instance) return { text: '蜂群未启动' };
          const metrics = _v9Instance.core?.observe?.getMetrics?.() ?? {};
          const budget = _v9Instance.core?.orchestration?.getBudget?.() ?? {};
          const lines = [
            '**预算状况**',
            `- 已用 token: ${budget.usedTokens?.toLocaleString() || '未跟踪'}`,
            `- 预算上限: ${budget.limit?.toLocaleString() || '无限制'}`,
            `- 使用率: ${budget.usagePercent ? `${Math.round(budget.usagePercent * 100)}%` : 'N/A'}`,
          ];
          return { text: lines.join('\n') };
        },

        agents() {
          if (!_v9Instance) return { text: '蜂群未启动' };
          const spawnStats = _v9Instance.nativeSpawnManager?.getStats?.() ?? {};
          const lines = [
            '**活跃 Agent 列表**',
            `- 总计: ${spawnStats.activeAgents || 0}`,
            `- 已完成: ${spawnStats.completed || 0}`,
            `- 失败: ${spawnStats.failed || 0}`,
          ];
          // 如果有活跃 agent 列表
          const activeList = spawnStats.activeList || [];
          for (const a of activeList.slice(0, 10)) {
            lines.push(`  - [${a.id}] ${a.role || ''} ${a.status || ''}`);
          }
          if (activeList.length > 10) {
            lines.push(`  ... 还有 ${activeList.length - 10} 个`);
          }
          return { text: lines.join('\n') };
        },

        pause() {
          if (!_v9Instance) return { text: '蜂群未启动' };
          _v9Instance.core?.bus?.publish?.('swarm.pause', {}, 'user-command');
          return { text: '⏸️ 蜂群已暂停 — 使用 `/swarm resume` 恢复' };
        },

        resume() {
          if (!_v9Instance) return { text: '蜂群未启动' };
          _v9Instance.core?.bus?.publish?.('swarm.resume', {}, 'user-command');
          return { text: '▶️ 蜂群已恢复' };
        },

        verbose() {
          _verbosity = 'verbose';
          _v9Instance?.core?.bus?.publish?.('swarm.verbosity', { level: 'verbose' }, 'user-command');
          return { text: '📢 已切换到详细模式 — 所有 agent 对话将可见' };
        },

        normal() {
          _verbosity = 'normal';
          _v9Instance?.core?.bus?.publish?.('swarm.verbosity', { level: 'normal' }, 'user-command');
          return { text: '📋 已切换到普通模式 — 显示关键节点' };
        },

        quiet() {
          _verbosity = 'quiet';
          _v9Instance?.core?.bus?.publish?.('swarm.verbosity', { level: 'quiet' }, 'user-command');
          return { text: '🤫 已切换到安静模式 — 仅显示错误和最终结果' };
        },

        inject(args) {
          if (!_v9Instance || !args) return { text: '用法: `/swarm inject <消息>` — 向运行中的 agent 注入消息' };
          _v9Instance.core?.bus?.publish?.('user.interjection', {
            dagId: 'global',
            message: args,
            ts: Date.now(),
          }, 'user-command');
          return { text: `📨 已注入消息到蜂群` };
        },

        help() {
          return {
            text: [
              '**🐝 /swarm 命令系统**',
              '',
              '`/swarm <任务>` — 提交蜂群任务',
              '`/swarm status` — 查看蜂群状态',
              '`/swarm progress [dagId]` — 查看任务进度',
              '`/swarm budget` — 查看预算使用',
              '`/swarm agents` — 查看活跃 agent',
              '`/swarm pause` — 暂停蜂群',
              '`/swarm resume` — 恢复蜂群',
              '`/swarm verbose` — 详细模式 (显示全部 agent 对话)',
              '`/swarm normal` — 普通模式',
              '`/swarm quiet` — 安静模式',
              '`/swarm inject <msg>` — 向运行中的 agent 注入消息',
              '`/swarm help` — 显示此帮助',
            ].join('\n'),
          };
        },
      };

      app.registerCommand({
        name: 'swarm',
        description: '蜂群命令系统 — /swarm help 查看全部子命令',
        acceptsArgs: true,
        requireAuth: true,
        handler: async (ctx) => {
          const rawArgs = (ctx.args || '').trim();
          if (!rawArgs) return subcommands.help();

          // 解析子命令
          const firstSpace = rawArgs.indexOf(' ');
          const cmd = firstSpace === -1 ? rawArgs.toLowerCase() : rawArgs.substring(0, firstSpace).toLowerCase();
          const rest = firstSpace === -1 ? '' : rawArgs.substring(firstSpace + 1).trim();

          if (subcommands[cmd]) {
            return subcommands[cmd](rest);
          }

          // 默认: 当作任务提交
          if (!_v9Instance) {
            return { text: '蜂群系统未启动 — 请稍后重试或重启 Gateway' };
          }
          const runTool = _v9Instance.registeredTools?.find(n => n === 'swarm_run');
          if (!runTool) {
            return { text: '蜂群已启动但 swarm_run 工具未注册' };
          }
          return { text: `蜂群已接收任务: "${rawArgs.substring(0, 80)}"。请调用 swarm_run 工具执行。` };
        },
      });
    } catch (err) {
      logger.debug?.(`[Claw-Swarm] /swarm 命令注册失败 (非致命): ${err.message}`);
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    logger.info?.(`[Claw-Swarm] V${VERSION} registered — V9 direct entry, all features unconditionally enabled`);
  },
};
