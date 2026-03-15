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

const VERSION = '9.0.0';
const NAME = 'openclaw-swarm';
const DASHBOARD_PORT = 19100;

// ─── Adapter: V8 Plugin API → V9 App Interface ────────────────────────────

/**
 * 将 OpenClaw plugin API 的 V8 接口适配为 V9 的 app 接口。
 *
 * V8 API:  api.pluginConfig / api.on(name,handler) / api.registerTool(tool)
 * V9 App:  app.getConfig()  / app.addHook(name,handler) / app.registerTool(tool)
 *
 * @param {Object} api - OpenClaw plugin API (V8 style)
 * @returns {Object} app - V9 compatible app object
 */
function createAppAdapter(api) {
  return {
    // ── Config & Bus ────────────────────────────────────────────
    getConfig: () => api.pluginConfig || {},
    getMessageBus: () => null, // V9 creates its own EventBus internally

    // ── Hook registration ───────────────────────────────────────
    // V9 HookAdapter calls app.addHook(name, handler)
    // → mapped to V8's api.on(name, handler)
    addHook: (name, handler) => {
      if (typeof api.on === 'function') {
        api.on(name, handler);
      }
    },

    // ── Tool registration ───────────────────────────────────────
    registerTool: (tool) => {
      if (typeof api.registerTool === 'function') {
        api.registerTool(tool);
      }
    },
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
    api.on('gateway_start', async () => {
      await startup();
    }, { priority: 10 });

    // gateway_stop → deactivate V9
    api.on('gateway_stop', async () => {
      await shutdown();
    });

    // registerService (Clawdbot startup path)
    if (typeof api.registerService === 'function') {
      api.registerService({
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
    }

    // ━━━ Gateway Dashboard proxy ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    // V9 DashboardService runs in-process on port 19100.
    // Register Gateway proxy routes so Console is also reachable via Gateway (18789).
    if (typeof api.registerHttpRoute === 'function') {
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

        api.registerHttpRoute({ method: 'GET', path: '/swarm/api/v1/*', handler: proxyToDashboard });
        api.registerHttpRoute({ method: 'GET', path: '/swarm/api/v9/*', handler: proxyToDashboard });
        api.registerHttpRoute({ method: 'GET', path: '/swarm/v6/*', handler: proxyToDashboard });
      } catch (err) {
        logger.debug?.(`[Claw-Swarm] Dashboard Gateway proxy failed (non-fatal): ${err.message}`);
      }
    }

    // ━━━ /swarm command ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    if (typeof api.registerCommand === 'function') {
      try {
        api.registerCommand({
          name: 'swarm',
          description: '启动蜂群协作: 自动分解任务、分配角色、派遣子代理执行。用法: /swarm <任务描述>',
          acceptsArgs: true,
          requireAuth: true,
          handler: async (ctx) => {
            const goal = ctx.args?.trim();
            if (!goal) {
              return { text: '请提供任务描述。用法: `/swarm 帮我分析项目结构`' };
            }
            if (!_v9Instance) {
              return { text: '蜂群系统未启动 — 请稍后重试或重启 Gateway' };
            }
            // Delegate to the V9 swarm_run tool
            try {
              const runTool = _v9Instance.registeredTools?.find(n => n === 'swarm_run');
              if (!runTool) {
                return { text: '蜂群已启动但 swarm_run 工具未注册' };
              }
              return { text: `蜂群已接收任务: "${goal.substring(0, 60)}"。请调用 swarm_run 工具执行。` };
            } catch (err) {
              return { text: `蜂群执行出错: ${err.message}` };
            }
          },
        });
      } catch (err) {
        logger.debug?.(`[Claw-Swarm] /swarm command registration failed (non-fatal): ${err.message}`);
      }
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    logger.info?.(`[Claw-Swarm] V${VERSION} registered — V9 direct entry, all features unconditionally enabled`);
  },
};
