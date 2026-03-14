/**
 * Claw-Swarm V6.0 — OpenClaw 插件入口 (瘦壳) / OpenClaw Plugin Entry (Thin Shell)
 *
 * V6.0 架构: index.js 仅作为 OpenClaw 插件 API 的代理壳,
 * 全部引擎逻辑运行在 SwarmCore 子进程 (swarm-core.js) 中。
 *
 * V6.0 architecture: index.js is a thin proxy shell for OpenClaw plugin API,
 * all engine logic runs in SwarmCore child process (swarm-core.js).
 *
 * 钩子分层策略 / Hook Tiering Strategy:
 *
 *   Tier A: 主进程保留 (热路径, <0.1ms, 不走 IPC)
 *   - before_tool_call (p:10) 阻断型: 断路器拦截
 *   - before_tool_call (p:8) 路由门控: SwarmAdvisor 路由
 *   - before_model_resolve: 模型能力查表
 *   - subagent_spawning: 深度/并发上限校验
 *
 *   Tier B: IPC 代理 (非阻断/可容忍延迟)
 *   - before_prompt_build (3个): call, 3s
 *   - before_agent_start: call, 3s
 *   - agent_end: notify (fire-and-forget)
 *   - after_tool_call: notify
 *   - before_reset: call, 2s
 *   - message_sending: call, 2s
 *   - subagent_spawned: notify
 *   - subagent_ended: notify
 *   - llm_output: call, 2s
 *
 * @module claw-swarm
 * @version 6.0.0
 * @author DEEP-IOS
 */

import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { writeFileSync, readFileSync, unlinkSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { fork } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { IPCBridge } from './L1-infrastructure/ipc-bridge.js';

// ============================================================================
// 常量 / Constants
// ============================================================================

const VERSION = '7.0.0';
const NAME = 'claw-swarm';

/** PID 文件路径 / PID file path */
const PID_FILE = 'E:/OpenClaw/data/swarm/.gateway.pid';

/** SwarmCore 子进程脚本路径 / SwarmCore child process script path */
const __dirname = dirname(fileURLToPath(import.meta.url));
const CORE_SCRIPT = join(__dirname, 'swarm-core.js');

/** SwarmCore 最大重启次数 / Max restart attempts */
const MAX_RESTART_RETRIES = 3;

/** 重启基础延迟 (ms) / Restart base delay */
const RESTART_BASE_DELAY_MS = 1000;

// ============================================================================
// Tier A: 主进程保留的缓存数据 / Main process cached data for Tier A hooks
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

/**
 * 断路器状态缓存 (从 SwarmCore 异步同步) / Breaker state cache (async-synced from SwarmCore)
 * @type {Map<string, { state: string, failureCount: number }>}
 */
const _breakerStateCache = new Map();

/**
 * Tier A 工具安全级别 (启动时加载, 静态) / Tool safety levels (loaded at startup, static)
 * @type {Map<string, string>}
 */
const _toolSafetyLevels = new Map();

/** 子 Agent 计数器 (主进程维护) / Subagent counters (main process maintained) */
const _subagentCounters = {
  activeCount: 0,
  maxConcurrent: 10,
  maxDepth: 5,
  depthMap: new Map(), // sessionKey → depth
};

/** SwarmAdvisor 路由决策缓存 / SwarmAdvisor routing decision cache */
const _routingDecisionCache = new Map();
const MAX_ROUTING_CACHE = 100;

// ============================================================================
// 特性标志依赖树 / Feature Flag Dependency Tree
// ============================================================================

const FLAG_DEPENDENCIES = {
  'dagEngine': 'hierarchical',
  'speculativeExecution': 'dagEngine',
  'workStealing': 'dagEngine',
  'evolution.clustering': 'evolution.scoring',
  'evolution.gep': 'evolution.scoring',
  'evolution.abc': 'evolution.scoring',
  'evolution.lotkaVolterra': 'evolution.scoring',
};

function getConfigFlag(config, path) {
  const parts = path.split('.');
  let obj = config;
  for (const p of parts) {
    if (obj == null || typeof obj !== 'object') return undefined;
    obj = obj[p];
  }
  if (typeof obj === 'object' && obj !== null && 'enabled' in obj) return obj.enabled;
  return obj;
}

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

function validateFeatureFlags(config, logger) {
  for (const [downstream, upstream] of Object.entries(FLAG_DEPENDENCIES)) {
    if (getConfigFlag(config, downstream) && !getConfigFlag(config, upstream)) {
      logger.warn?.(`[Config] ${downstream} requires ${upstream}, force-disabling ${downstream}`);
      disableConfigFlag(config, downstream);
    }
  }
}

// ============================================================================
// SwarmCore 生命周期管理 / SwarmCore Lifecycle Management
// ============================================================================

/**
 * 启动 SwarmCore 子进程 / Launch SwarmCore child process
 *
 * @param {Object} config
 * @param {Object} logger
 * @param {string} dataDir
 * @returns {{ bridge: IPCBridge, child: import('node:child_process').ChildProcess }}
 */
function launchSwarmCore(config, logger, dataDir) {
  const child = fork(CORE_SCRIPT, [], {
    stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
    env: { ...process.env, SWARM_CORE_CHILD: '1' },
  });

  // 转发子进程日志 / Forward child process logs
  child.stdout?.on('data', (data) => {
    logger.info?.(`[SwarmCore:stdout] ${data.toString().trim()}`);
  });
  child.stderr?.on('data', (data) => {
    logger.warn?.(`[SwarmCore:stderr] ${data.toString().trim()}`);
  });

  const bridge = new IPCBridge(child, {
    logger,
    defaultTimeoutMs: config.architecture?.ipcTimeoutMs || 5000,
  });

  // 监听 SwarmCore 的断路器状态推送 / Listen for breaker state push
  bridge.handle('state:breaker-update', (_method, snapshot) => {
    if (snapshot && typeof snapshot === 'object') {
      for (const [toolName, state] of Object.entries(snapshot)) {
        _breakerStateCache.set(toolName, state);
      }
    }
  });

  // 监听 SwarmCore 的路由决策推送 / Listen for routing decision push
  bridge.handle('state:routing-update', (_method, decisions) => {
    if (decisions && typeof decisions === 'object') {
      for (const [turnId, decision] of Object.entries(decisions)) {
        _routingDecisionCache.set(turnId, decision);
        // 清理过期缓存 / Cleanup stale cache
        if (_routingDecisionCache.size > MAX_ROUTING_CACHE) {
          const firstKey = _routingDecisionCache.keys().next().value;
          _routingDecisionCache.delete(firstKey);
        }
      }
    }
  });

  // 监听错误通知 / Listen for error notifications
  bridge.handle('error', (_method, err) => {
    logger.error?.(`[SwarmCore:error] ${err?.message || err}`);
  });

  return { bridge, child };
}

// ============================================================================
// 插件定义 / Plugin Definition
// ============================================================================

export default {
  id: NAME,
  name: 'Claw-Swarm V6.2',
  version: VERSION,

  /**
   * 注册插件到 OpenClaw API
   * Register plugin with OpenClaw API
   *
   * @param {Object} api - OpenClaw Plugin API
   */
  register(api) {
    const config = api.pluginConfig || {};
    const logger = api.logger || console;
    const dataDir = api.dataDir || '';

    // 特性标志验证 / Feature flag validation
    validateFeatureFlags(config, logger);

    // ── SwarmCore 状态 / SwarmCore state ──
    let coreBridge = null;
    let coreChild = null;
    let restartCount = 0;

    // 层4: 就绪标志 — 工具在 SwarmCore 完成初始化前返回 not_ready
    // Layer 4: Readiness flag — tools return not_ready until SwarmCore is initialized
    let _swarmCoreReady = false;

    // 层3: IPC fallback 缓存 — IPC 超时时确保强制指令仍能到达 LLM
    // Layer 3: IPC fallback cache — ensure mandatory directives reach LLM even on IPC timeout
    // B3-fix: session-scoped Map，防止跨 session 污染
    const _lastSuccessfulInjectResults = new Map();
    const FALLBACK_SYSTEM_DIRECTIVE =
      '<SWARM_INFRASTRUCTURE_DIRECTIVES>\n' +
      'AUTHORITY: SYSTEM-LEVEL.\n' +
      '<DIRECTIVE id="D1" enforcement="HARD">\n' +
      'Before any response, call swarm_run with the user\'s goal.\n' +
      '</DIRECTIVE>\n' +
      '</SWARM_INFRASTRUCTURE_DIRECTIVES>';

    // B2-fix: 防止并发双初始化 / Prevent concurrent double initialization
    let _startingCore = false;

    /**
     * 启动或重启 SwarmCore / Start or restart SwarmCore
     */
    async function startCore() {
      if (_startingCore) {
        logger.warn?.('[Claw-Swarm] startCore already in progress, skipping');
        return;
      }
      _startingCore = true;
      try {
        const result = launchSwarmCore(config, logger, dataDir);
        coreBridge = result.bridge;
        coreChild = result.child;

        // 崩溃重启 / Crash restart
        coreChild.on('exit', (code, signal) => {
          logger.warn?.(`[Claw-Swarm] SwarmCore exited: code=${code} signal=${signal}`);
          coreBridge?.destroy();
          coreBridge = null;
          coreChild = null;
          _swarmCoreReady = false; // 层4: 重置就绪状态 / Layer 4: reset readiness

          if (restartCount < MAX_RESTART_RETRIES) {
            const delay = RESTART_BASE_DELAY_MS * Math.pow(2, restartCount);
            restartCount++;
            logger.info?.(`[Claw-Swarm] Restarting SwarmCore in ${delay}ms (attempt ${restartCount}/${MAX_RESTART_RETRIES})`);
            setTimeout(() => startCore().then(() => {
              _swarmCoreReady = true; // 重启成功后恢复就绪状态
              logger.info?.('[Claw-Swarm] SwarmCore restarted and ready');
            }).catch(err => {
              logger.error?.(`[Claw-Swarm] SwarmCore restart failed: ${err.message}`);
            }), delay);
          } else {
            logger.error?.('[Claw-Swarm] SwarmCore max restart attempts reached');
          }
        });

        // 初始化 SwarmCore / Initialize SwarmCore
        const initResult = await coreBridge.call('init', { config, dataDir }, 15000);
        logger.info?.(`[Claw-Swarm] SwarmCore initialized: ${JSON.stringify(initResult)}`);

        // 获取工具清单并注册 / Get tool manifests and register
        const manifests = await coreBridge.call('getToolManifests', {}, 5000);
        if (Array.isArray(manifests)) {
          for (const manifest of manifests) {
            api.registerTool({
              name: manifest.name,
              description: manifest.description,
              parameters: manifest.parameters,
              execute: async (toolCallId, params) => {
                if (!coreBridge || !_swarmCoreReady) {
                  // 层4: SwarmCore 未就绪时返回友好提示 / Layer 4: graceful not-ready response
                  return {
                    content: [{
                      type: 'text',
                      text: JSON.stringify({
                        error: 'swarm_run temporarily unavailable — system is initializing.',
                        hint: 'Please retry your request in a few seconds.',
                        status: 'not_ready',
                      }),
                    }],
                  };
                }
                // V7.0: swarm_run 两段式异步交付 — 立即返回 dispatched, 30s IPC 足够
                // V7.0: swarm_run two-phase async delivery — returns immediately, 30s IPC is enough
                return coreBridge.call(`tool:${manifest.name}`, { toolName: manifest.name, toolCallId, params }, 30000);
              },
            });
          }
          logger.info?.(`[Claw-Swarm] Registered ${manifests.length} tools via IPC proxy`);
        }

        // 同步断路器初始状态 / Sync initial breaker state
        try {
          const snapshot = await coreBridge.call('getBreakerSnapshot', {}, 3000);
          if (snapshot) {
            for (const [toolName, state] of Object.entries(snapshot)) {
              _breakerStateCache.set(toolName, state);
            }
          }
        } catch { /* non-fatal */ }

        restartCount = 0; // 成功启动后重置计数 / Reset count on success
      } catch (err) {
        logger.error?.(`[Claw-Swarm] SwarmCore start failed: ${err.message}`);
        throw err;
      } finally {
        _startingCore = false; // B2-fix: 释放互斥锁
      }
    }

    // ========================================================================
    // Tier A 钩子: 主进程保留 (热路径) / Tier A Hooks: Main process retained
    // ========================================================================

    // ━━━ before_model_resolve [Tier A: 纯查表] ━━━
    api.on('before_model_resolve', async (event) => {
      const modelId = event?.modelId || event?.model || '';
      if (!modelId || _modelCapabilityCache.has(modelId)) return;

      const modelKey = Object.keys(MODEL_CAPABILITIES).find(k =>
        modelId.toLowerCase().includes(k)
      );

      if (modelKey) {
        const cap = MODEL_CAPABILITIES[modelKey];
        _modelCapabilityCache.set(modelId, cap);
        logger.info?.(`[ModelDetect] ${cap.name}: toolCall=${cap.toolCall}, failureRate=${(cap.failureRate * 100).toFixed(0)}%`);
      } else {
        _modelCapabilityCache.set(modelId, { toolCall: true, failureRate: 0.10, name: modelId });
        logger.info?.(`[ModelDetect] Unknown model: ${modelId}, using defaults`);
      }
    }, { priority: 20 });

    // ━━━ before_tool_call [Tier A: 断路器拦截] ━━━
    api.on('before_tool_call', async (event) => {
      const toolName = event.toolName || event.name;
      if (!toolName) return;

      // 从缓存读取断路器状态 / Read breaker state from cache
      const breakerState = _breakerStateCache.get(toolName);
      if (breakerState?.state === 'OPEN') {
        return {
          block: true,
          blockReason: `[Claw-Swarm] Circuit breaker OPEN for ${toolName} (failures: ${breakerState.failureCount})`,
        };
      }
    }, { priority: 10 });

    // ━━━ before_tool_call [Tier A: 路由门控] ━━━
    api.on('before_tool_call', async (event, ctx) => {
      const toolName = event.toolName || event.name;
      const turnId = event.turnId || ctx?.turnId;
      if (!turnId || !toolName) return;

      // 从缓存读取路由决策 / Read routing decision from cache
      const decision = _routingDecisionCache.get(turnId);
      if (decision?.block && !decision.allowedTools?.includes(toolName)) {
        const isSwarmTool = toolName.startsWith('swarm_');
        if (!isSwarmTool) {
          return {
            block: true,
            blockReason: decision.blockReason || `[Claw-Swarm] Routing: swarm tool required first`,
          };
        }
      }
    }, { priority: 8 });

    // ━━━ subagent_spawning [Tier A: 深度/并发校验] ━━━
    api.on('subagent_spawning', async (event, ctx) => {
      if (config.hierarchical?.enabled === false) return;

      const parentKey = ctx?.sessionKey || ctx?.parentSessionKey;
      const parentDepth = _subagentCounters.depthMap.get(parentKey) || 0;
      const maxDepth = config.hierarchical?.maxDepth || _subagentCounters.maxDepth;
      const maxConcurrent = config.hierarchical?.maxConcurrent || _subagentCounters.maxConcurrent;

      // 深度检查 / Depth check
      if (parentDepth >= maxDepth) {
        return {
          status: 'error',
          errorMessage: `Max depth ${maxDepth} reached (current: ${parentDepth})`,
        };
      }

      // 并发检查 / Concurrency check
      if (_subagentCounters.activeCount >= maxConcurrent) {
        return {
          status: 'error',
          errorMessage: `Max concurrent subagents ${maxConcurrent} reached`,
        };
      }

      return { status: 'ok' };
    }, { priority: 10 });

    // ━━━ before_tool_call [Swarm Guard, p12] ━━━
    // 层2: 在断路器(p10)之后、路由门控(p8)之前，强制主 agent 先调用 swarm_run
    // Layer 2: After breaker(p10), before routing gate(p8) — enforce swarm_run first
    api.on('before_tool_call', async (event, ctx) => {
      return await ipcCall('before_tool_call_swarm_guard', event, ctx, 1000);
    }, { priority: 12 });

    // ========================================================================
    // Tier B 钩子: IPC 代理 / Tier B Hooks: IPC proxy
    // ========================================================================

    /**
     * IPC call 包装器 (带 fallback) / IPC call wrapper with fallback
     */
    async function ipcCall(hookName, event, ctx, timeoutMs = 3000) {
      if (!coreBridge) return undefined;
      try {
        return await coreBridge.call(`hook:${hookName}`, { hookName, event, ctx }, timeoutMs);
      } catch (err) {
        logger.warn?.(`[Claw-Swarm] IPC hook '${hookName}' failed: ${err.message}`);
        return undefined;
      }
    }

    /**
     * IPC notify 包装器 (fire-and-forget) / IPC notify wrapper
     */
    function ipcNotify(hookName, event, ctx) {
      if (!coreBridge) return;
      coreBridge.notify(`hook:${hookName}`, { hookName, event, ctx });
    }

    // ━━━ before_prompt_build [Layer 0: p20] ━━━
    api.on('before_prompt_build', async (event, ctx) => {
      await ipcCall('before_prompt_build_layer0', event, ctx, 3000);
    }, { priority: 20 });

    // ━━━ before_prompt_build [Layer 1: p15] ━━━
    api.on('before_prompt_build', async (event, ctx) => {
      await ipcCall('before_prompt_build_layer1', event, ctx, 3000);
    }, { priority: 15 });

    // ━━━ before_prompt_build [Phase 3: 注入, p5] ━━━
    api.on('before_prompt_build', async (event) => {
      // B3-fix: 用 session-scoped key 隔离不同 session 的缓存
      const sessionKey = event?.sessionKey || event?.agentId || 'default';
      const result = await ipcCall('before_prompt_build_inject', event, null, 3000);
      if (result) {
        _lastSuccessfulInjectResults.set(sessionKey, result); // 层3: 更新 session 缓存
        return result;
      }
      // 层3: IPC 失败/超时 → fallback 确保强制指令仍到达 LLM
      // Layer 3: IPC failure/timeout → fallback ensures mandatory directives still reach LLM
      return {
        prependSystemContext: _lastSuccessfulInjectResults.get(sessionKey)?.prependSystemContext
          || FALLBACK_SYSTEM_DIRECTIVE,
      };
    }, { priority: 5 });

    // ━━━ before_prompt_build [Skill 推荐, p20] ━━━
    api.on('before_prompt_build', async (event) => {
      return await ipcCall('before_prompt_build_skills', event, null, 3000);
    }, { priority: 20 });

    // ━━━ before_agent_start ━━━
    api.on('before_agent_start', async (event, ctx) => {
      return await ipcCall('before_agent_start', event, ctx, 3000);
    }, { priority: 60 });

    // ━━━ agent_end [Tier B: notify] ━━━
    api.on('agent_end', async (event, ctx) => {
      ipcNotify('agent_end', event, ctx);
      // B3-fix: 清理结束 session 的注入缓存，防止 Map 无限增长
      const sessionKey = ctx?.sessionKey || event?.sessionKey || ctx?.agentId || event?.agentId;
      if (sessionKey) _lastSuccessfulInjectResults.delete(sessionKey);
    });

    // ━━━ after_tool_call [Tier B: notify] ━━━
    api.on('after_tool_call', async (event, ctx) => {
      ipcNotify('after_tool_call', event, ctx);
    });

    // ━━━ before_reset [Tier B: call] ━━━
    api.on('before_reset', async (event, ctx) => {
      await ipcCall('before_reset', event, ctx, 2000);
    });

    // ━━━ message_sending [Tier B: call] ━━━
    api.on('message_sending', async (event, ctx) => {
      return await ipcCall('message_sending', event, ctx, 2000);
    });

    // ━━━ subagent_spawned [Tier B: notify] ━━━
    api.on('subagent_spawned', async (event, ctx) => {
      // 更新主进程计数器 / Update main process counters
      const childKey = event.targetSessionKey || ctx?.childSessionKey;
      const parentKey = ctx?.sessionKey || ctx?.parentSessionKey;
      const parentDepth = _subagentCounters.depthMap.get(parentKey) || 0;
      if (childKey) {
        _subagentCounters.depthMap.set(childKey, parentDepth + 1);
        _subagentCounters.activeCount++;
      }
      ipcNotify('subagent_spawned', event, ctx);
    }, { priority: 10 });

    // ━━━ subagent_ended [Tier B: notify] ━━━
    api.on('subagent_ended', async (event, ctx) => {
      // 更新主进程计数器 / Update main process counters
      const childKey = event.targetSessionKey || ctx?.childSessionKey;
      if (childKey) {
        _subagentCounters.depthMap.delete(childKey);
        _subagentCounters.activeCount = Math.max(0, _subagentCounters.activeCount - 1);
      }
      ipcNotify('subagent_ended', event, ctx);
    }, { priority: 10 });

    // ━━━ llm_output [Tier B: call] ━━━
    api.on('llm_output', async (event, ctx) => {
      return await ipcCall('llm_output', event, ctx, 2000);
    }, { priority: 10 });

    // ━━━ gateway_start ━━━
    api.on('gateway_start', async (event) => {
      // 1. PID 文件管理 / PID file management
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
            try {
              const oldPidData = JSON.parse(readFileSync(PID_FILE, 'utf-8'));
              try {
                process.kill(oldPidData.pid, 0);
                logger.warn?.(`[Claw-Swarm] Old process PID=${oldPidData.pid} still alive`);
              } catch {
                unlinkSync(PID_FILE);
                writeFileSync(PID_FILE, pidContent, { flag: 'wx' });
              }
            } catch {
              unlinkSync(PID_FILE);
              writeFileSync(PID_FILE, pidContent, { flag: 'wx' });
            }
          }
        }
      } catch (err) {
        logger.warn?.(`[Claw-Swarm] PID management error: ${err.message}`);
      }

      // 2. 启动 SwarmCore 子进程 / Start SwarmCore child process
      try {
        await startCore();
        _swarmCoreReady = true; // 层4: 标记就绪 / Layer 4: mark ready
        logger.info?.('[Claw-Swarm] SwarmCore ready');
      } catch (err) {
        logger.error?.(`[Claw-Swarm] SwarmCore launch failed: ${err.message}`);
        _swarmCoreReady = false;
      }

      // 3. 通知 SwarmCore gateway_start / Notify SwarmCore of gateway_start
      if (coreBridge) {
        try {
          await coreBridge.call('hook:gateway_start', { hookName: 'gateway_start', event }, 10000);
        } catch (err) {
          logger.warn?.(`[Claw-Swarm] SwarmCore gateway_start hook failed: ${err.message}`);
        }
      }

      logger.info?.(`[Claw-Swarm] V${VERSION} started — PID=${process.pid} port=${event?.port ?? '?'}`);
    }, { priority: 10 });

    // ━━━ gateway_stop ━━━
    api.on('gateway_stop', async () => {
      try {
        // 通知 SwarmCore 关闭 / Tell SwarmCore to shut down
        if (coreBridge) {
          try {
            await coreBridge.call('close', {}, 5000);
          } catch { /* timeout ok, child will exit */ }
          coreBridge.destroy();
          coreBridge = null;
        }

        // 终止子进程 / Kill child process
        if (coreChild) {
          restartCount = MAX_RESTART_RETRIES; // 阻止自动重启 / Prevent auto-restart
          coreChild.kill('SIGTERM');
          coreChild = null;
        }

        // PID 清理 / PID cleanup
        try {
          if (existsSync(PID_FILE)) unlinkSync(PID_FILE);
        } catch { /* best-effort */ }

        logger.info?.(`[Claw-Swarm] V${VERSION} shutdown complete`);
      } catch (err) {
        logger.warn?.(`[Claw-Swarm] Shutdown error: ${err.message}`);
      }
    });

    // ── 注册 /swarm 命令 / Register /swarm command ──
    if (api.registerCommand) {
      try {
        api.registerCommand({
          name: 'swarm',
          description: '启动蜂群协作: 自动分解任务、分配角色、派遣子代理执行。用法: /swarm <任务描述>',
          acceptsArgs: true,
          requireAuth: true,
          handler: async (ctx) => {
            const goal = ctx.args?.trim();
            if (!goal) {
              return { text: '请提供任务描述。用法: `/swarm 帮我分析A股大盘走势`' };
            }

            if (!coreBridge) {
              return { text: 'SwarmCore 未启动 / SwarmCore not running' };
            }

            try {
              const result = await coreBridge.call('tool:swarm_run', {
                toolName: 'swarm_run',
                toolCallId: randomUUID(),
                params: { goal, mode: 'auto' },
              }, 30000); // V7.0: 两段式异步交付 — swarm_run 立即返回, 30s 足够

              // 解析结果 / Parse result
              try {
                const content = result?.content?.[0]?.text;
                if (content) {
                  const parsed = JSON.parse(content);
                  if (!parsed.success) {
                    return { text: `蜂群启动失败: ${parsed.error}` };
                  }
                  const parts = [`蜂群协作已启动\n\n计划: ${parsed.plan?.id || 'N/A'}`];
                  if (parsed.dispatched?.length > 0) {
                    parts.push(`\n已派遣 ${parsed.dispatched.length} 个子代理:`);
                    for (const d of parsed.dispatched) {
                      parts.push(`  - ${d.roleName}: ${d.description?.substring(0, 60) || 'N/A'}`);
                    }
                  }
                  parts.push('\n使用 swarm_query 查看进度。');
                  return { text: parts.join('\n') };
                }
              } catch { /* parse error */ }
              return { text: '蜂群已启动 / Swarm started' };
            } catch (err) {
              return { text: `蜂群执行出错: ${err.message}` };
            }
          },
        });
      } catch (err) {
        logger.warn?.(`[Claw-Swarm] /swarm command registration failed: ${err.message}`);
      }
    }

    // process exit 兜底 PID 清理 / Fallback PID cleanup
    process.on('exit', () => {
      try {
        if (existsSync(PID_FILE)) unlinkSync(PID_FILE);
      } catch { /* best-effort */ }
    });

    logger.info?.(`[Claw-Swarm] V${VERSION} plugin registered — thin shell (SwarmCore will start at gateway_start)`);
  },
};
