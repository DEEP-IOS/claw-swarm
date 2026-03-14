/**
 * SwarmRelayClient — 直接 Subagent Spawn 客户端 / Direct Subagent Spawn Client
 *
 * 通过 WebSocket 直接调用 OpenClaw Gateway 的内部 API,
 * 以 lane="subagent" + spawnedBy=parentKey 创建真正的子代理。
 *
 * Spawns real subagents by calling the OpenClaw Gateway's internal API
 * via WebSocket with lane="subagent" + spawnedBy=parentKey.
 *
 * 关键区别 / Key Difference:
 * - 旧方案: HTTP POST /hooks/agent → 独立 hook session (无 parent-child 关系)
 * - 新方案: WS callGateway → agent(lane=subagent) → 真正子代理 (完整生命周期)
 *
 * - Old: HTTP POST /hooks/agent → isolated hook session (no parent-child)
 * - New: WS callGateway → agent(lane=subagent) → real subagent (full lifecycle)
 *
 * 注意 / Note:
 * Gateway 的 WS `agent` 方法创建真正的 subagent session, 但
 * `subagent_spawned`/`subagent_ended` 钩子由客户端 (spawnSubagentDirect) 触发,
 * 不由 Gateway 服务端触发。因此本客户端提供 `spawnAndMonitor()` 方法,
 * 在 spawn 后主动轮询子代理状态, 通过回调自触发钩子。
 *
 * The Gateway's WS `agent` method creates real subagent sessions, but
 * `subagent_spawned`/`subagent_ended` hooks are client-side events fired by
 * spawnSubagentDirect, NOT by the Gateway server. This client provides
 * `spawnAndMonitor()` which polls subagent status after spawn and
 * self-triggers hooks via callbacks.
 *
 * @module L2-communication/swarm-relay-client
 * @version 7.0.0
 * @author DEEP-IOS
 */

'use strict';

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { createRequire } from 'node:module';

// ws 模块在 OpenClaw Gateway 进程中可用 (OpenClaw 依赖项)
// 优先使用 ws npm 模块 (Node.js EventEmitter API: .on/.removeListener)
// 而非 globalThis.WebSocket (浏览器 API: .addEventListener, 无 .on)
// Lazy import 避免 test 环境中的 module resolution 错误
//
// ws module is available in OpenClaw Gateway process (OpenClaw dependency)
// Prefer ws npm module (Node.js EventEmitter API: .on/.removeListener)
// over globalThis.WebSocket (browser API: .addEventListener, no .on)
// Lazy import avoids module resolution errors in test environments
let _WebSocket = null;
function getWebSocket() {
  if (!_WebSocket) {
    // Strategy 1: ws npm module via createRequire (works in Gateway process)
    try {
      const _require = createRequire(import.meta.url);
      const wsModule = _require('ws');
      _WebSocket = wsModule.WebSocket || wsModule;
      return _WebSocket;
    } catch {
      // Strategy 1 failed — fall through to Strategy 2
    }

    // Strategy 2: globalThis.WebSocket with EventEmitter adapter
    // Node.js ≥21 has built-in WebSocket but it uses addEventListener, not .on()
    // Wrap it to provide .on() / .removeListener() / .removeAllListeners()
    if (globalThis.WebSocket) {
      _WebSocket = _createAdaptedWebSocket(globalThis.WebSocket);
      return _WebSocket;
    }

    throw new Error(
      'WebSocket not available. The ws module is required and should be provided by the OpenClaw runtime.'
    );
  }
  return _WebSocket;
}

/**
 * 将浏览器标准 WebSocket 包装为支持 Node.js EventEmitter 风格 API 的构造函数
 * Wraps browser-standard WebSocket to support Node.js EventEmitter-style API
 *
 * @param {typeof WebSocket} NativeWS - 原生 WebSocket 构造函数
 * @returns {Function} 包装后的构造函数 (支持 .on / .removeListener / .removeAllListeners)
 */
function _createAdaptedWebSocket(NativeWS) {
  function AdaptedWebSocket(url) {
    const ws = new NativeWS(url);
    const _listeners = new Map(); // eventName → Set<{ original, wrapped }>

    ws.on = (event, fn) => {
      const wrapped = (e) => {
        // message 事件: 浏览器 API 传 MessageEvent, ws 模块传 data
        if (event === 'message') fn(e.data ?? e);
        else if (event === 'error') fn(e.error ?? e);
        else fn(e);
      };
      if (!_listeners.has(event)) _listeners.set(event, new Set());
      _listeners.get(event).add({ original: fn, wrapped });
      ws.addEventListener(event, wrapped);
    };

    ws.removeListener = (event, fn) => {
      const set = _listeners.get(event);
      if (!set) return;
      for (const entry of set) {
        if (entry.original === fn) {
          ws.removeEventListener(event, entry.wrapped);
          set.delete(entry);
          break;
        }
      }
    };

    ws.removeAllListeners = (event) => {
      const set = _listeners.get(event);
      if (!set) return;
      for (const entry of set) {
        ws.removeEventListener(event, entry.wrapped);
      }
      set.clear();
    };

    return ws;
  }

  // 复制静态常量 / Copy static constants
  AdaptedWebSocket.CONNECTING = NativeWS.CONNECTING ?? 0;
  AdaptedWebSocket.OPEN = NativeWS.OPEN ?? 1;
  AdaptedWebSocket.CLOSING = NativeWS.CLOSING ?? 2;
  AdaptedWebSocket.CLOSED = NativeWS.CLOSED ?? 3;

  return AdaptedWebSocket;
}

// ============================================================================
// SwarmRelayClient 类 / SwarmRelayClient Class
// ============================================================================

export class SwarmRelayClient {
  /**
   * @param {Object} opts
   * @param {string} [opts.gatewayUrl='http://127.0.0.1:18789'] - Gateway URL (auto-converts to ws://)
   * @param {string} [opts.gatewayToken=''] - Gateway auth token
   * @param {string} [opts.parentSessionKey] - 父 session key (main agent session)
   * @param {Object} [opts.logger] - Logger
   * @param {number} [opts.maxRetries=3] - 最大重试次数 / Max retries
   * @param {number} [opts.baseDelayMs=500] - 初始退避延迟 / Base backoff delay
   * @param {Array} [opts.availableModels=[]] - 可用模型列表
   * @param {boolean} [opts.detachSubagentsOnParentDisconnect=true] - 父会话断连时子代理是否继续执行
   */
  constructor({
    gatewayUrl,
    gatewayToken,
    parentSessionKey,
    logger,
    maxRetries,
    baseDelayMs,
    availableModels,
    detachSubagentsOnParentDisconnect,
  } = {}) {
    const httpUrl = gatewayUrl || 'http://127.0.0.1:18789';
    this._wsUrl = httpUrl.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:');
    this._gatewayToken = gatewayToken || this._loadGatewayToken();
    this._parentSessionKey = parentSessionKey || null; // 由 setParentSessionKey 动态设置
    this._logger = logger || { info() {}, warn() {}, error() {}, debug() {} };
    this._maxRetries = maxRetries ?? 3;
    this._baseDelayMs = baseDelayMs ?? 500;
    this._detachSubagentsOnParentDisconnect = detachSubagentsOnParentDisconnect !== false;

    // 模型列表, 按 costPerKToken 升序排列
    this._availableModels = (availableModels || [])
      .slice()
      .sort((a, b) => (a.costPerKToken || Infinity) - (b.costPerKToken || Infinity));

    /** @type {{ spawned: number, sent: number, failed: number, retries: number }} */
    this._stats = { spawned: 0, sent: 0, failed: 0, retries: 0 };
  }

  /**
   * 从 config 文件加载 gateway token
   * @returns {string}
   * @private
   */
  _loadGatewayToken() {
    try {
      const configPath = join(homedir(), '.openclaw', 'openclaw.json');
      const cfg = JSON.parse(readFileSync(configPath, 'utf8'));
      return cfg.gateway?.auth?.token || '';
    } catch {
      return '';
    }
  }

  /**
   * 动态设置父 session key (从 hook 事件中捕获)
   * Set parent session key dynamically (captured from hook events)
   *
   * @param {string} key - 父 session key
   */
  setParentSessionKey(key) {
    if (key && typeof key === 'string') {
      this._parentSessionKey = key;
      this._logger.debug?.(`[DirectSpawn] parentSessionKey set: ${key}`);
    }
  }

  /**
   * 获取最低成本模型
   * @returns {string|undefined}
   */
  getRelayModel() {
    if (this._availableModels.length > 0) {
      return this._availableModels[0].id;
    }
    return undefined;
  }

  /**
   * 直接 Spawn 子代理 — 通过 WS callGateway 创建真正的 subagent
   * Directly spawn a subagent via WS callGateway (real subagent with full lifecycle)
   *
   * 流程 / Flow:
   * 1. 生成 childSessionKey: agent:{agentId}:subagent:{uuid}
   * 2. sessions.patch: 设置 spawnDepth
   * 3. sessions.patch: 设置 model (如有)
   * 4. agent: lane=subagent, spawnedBy=parentKey → 启动子代理
   *
   * @param {Object} opts
   * @param {string} opts.agentId - 目标 OpenClaw Agent ID (如 mpu-d2, mpu-d3)
   * @param {string} opts.task - 任务描述
   * @param {string} [opts.model] - 指定模型
   * @param {number} [opts.timeoutSeconds=300] - 超时秒数
   * @param {string} [opts.label] - Session label (swarm:taskId:agentId)
   * @returns {Promise<{ status: string, childSessionKey?: string, runId?: string, error?: string }>}
   */
  async spawn({ agentId, task, model, timeoutSeconds = 300, label }) {
    const childSessionKey = `agent:${agentId}:subagent:${randomUUID()}`;

    for (let attempt = 0; attempt <= this._maxRetries; attempt++) {
      try {
        const result = await this._spawnDirect(childSessionKey, {
          agentId, task, model, timeoutSeconds, label,
        });
        this._stats.spawned++;
        this._logger.info?.(
          `[DirectSpawn] spawned: agent=${agentId}, child=${childSessionKey}, ` +
          `model=${model || 'default'}, label=${label || 'none'}, ` +
          `detached=${this._detachSubagentsOnParentDisconnect ? 'yes' : 'no'}, runId=${result.runId || 'n/a'}`
        );
        return result;
      } catch (err) {
        this._logger.warn?.(
          `[DirectSpawn] attempt ${attempt + 1}/${this._maxRetries + 1} failed: ${err.message}`
        );
        if (attempt < this._maxRetries) {
          const delay = this._baseDelayMs * Math.pow(2, attempt);
          this._stats.retries++;
          await this._sleep(delay);
        }
      }
    }

    this._stats.failed++;
    return { status: 'spawn_exhausted', retries: this._maxRetries, error: 'All attempts exhausted' };
  }

  /**
   * Spawn + 后台监控: spawn 后自动轮询子代理完成状态, 通过回调自触发钩子
   * Spawn + background monitor: polls subagent status and self-triggers hooks via callbacks
   *
   * 解决的问题 / Problem solved:
   * Gateway WS `agent` 方法不触发 subagent_spawned/ended 钩子 (这些是 client-side events)。
   * 本方法在 spawn 成功后: (1) 立即调用 onSpawned, (2) 启动后台轮询, (3) 完成时调用 onEnded。
   *
   * @param {Object} opts
   * @param {string} opts.agentId - 目标 Agent ID
   * @param {string} opts.task - 任务描述
   * @param {string} [opts.model] - 指定模型
   * @param {number} [opts.timeoutSeconds=300] - 超时秒数
   * @param {string} [opts.label] - Session label
   * @param {Function} [opts.onSpawned] - spawn 成功后的回调 (event)
   * @param {Function} [opts.onEnded] - 子代理完成/失败后的回调 (event)
   * @param {Function} [opts.onProgress] - V7.0 §15: 中间输出回调 (partialOutput, childKey)
   * @returns {Promise<{ status: string, childSessionKey?: string, runId?: string }>}
   */
  async spawnAndMonitor({ agentId, task, model, timeoutSeconds = 300, label, onSpawned, onEnded, onProgress }) {
    const result = await this.spawn({ agentId, task, model, timeoutSeconds, label });

    if (result.status !== 'spawned') return result;

    // 自触发 subagent_spawned 回调 / Self-trigger spawned callback
    try {
      onSpawned?.({
        targetSessionKey: result.childSessionKey,
        childSessionKey: result.childSessionKey,
        runId: result.runId,
        agentId,
        label: label || undefined,
      });
    } catch (err) {
      this._logger.warn?.(`[DirectSpawn] onSpawned callback error: ${err.message}`);
    }

    // 后台监控: 轮询子代理 session 状态 / Background monitor: poll session status
    if (onEnded) {
      this._monitorLoop(result.childSessionKey, result.runId, agentId, label, timeoutSeconds, onEnded, onProgress);
    }

    return result;
  }

  /**
   * 检查子代理 session 是否已完成
   * Check if a subagent session has completed
   *
   * @param {string} childSessionKey
   * @returns {Promise<{ completed: boolean, success?: boolean, result?: string, usage?: Object }>}
   */
  async checkSession(childSessionKey) {
    let ws;
    try {
      ws = await this._connectAndAuth();
      const session = await this._sendRequest(ws, 'sessions.get', { key: childSessionKey });
      const messages = session?.messages || [];

      if (messages.length === 0) {
        return { completed: false, empty: true };
      }

      // 找到最后一条有终端 stopReason 的 assistant 消息
      // Find last assistant message with a terminal stopReason
      for (let i = messages.length - 1; i >= 0; i--) {
        const msg = messages[i];
        if (msg.role !== 'assistant') continue;

        const reason = msg.stopReason || msg.stop_reason;
        if (!reason) continue;

        // toolUse/tool_use = agent 仍在执行, 非终端 stopReason
        // toolUse/tool_use = agent still executing, non-terminal stopReason
        if (reason === 'toolUse' || reason === 'tool_use') continue;

        const text = Array.isArray(msg.content)
          ? msg.content.map(c => c.text || '').join('')
          : (msg.content || '');

        const isSuccess = reason === 'stop' || reason === 'end_turn';
        return {
          completed: true,
          success: isSuccess,
          result: text,
          usage: msg.usage || null,
          stopReason: reason,
        };
      }
      return { completed: false, messageCount: messages.length };
    } catch (err) {
      const errMsg = err.message || '';
      // B6-fix: 区分网络错误（应重试）和真实 session 消失（视为完成）
      const isNetworkError = /ECONNREFUSED|ETIMEDOUT|EHOSTUNREACH|socket hang up|refused/i.test(errMsg);
      const isNotFound = !isNetworkError && /not found|no session|does not exist|ENOENT/i.test(errMsg);
      this._logger.debug?.(`[DirectSpawn] checkSession error (network=${isNetworkError}): ${errMsg}`);
      return {
        completed: isNotFound,
        success: isNotFound,
        error: errMsg,
        sessionGone: isNotFound,
        retryable: isNetworkError, // B6-fix: 网络错误可重试，不视为 session 消失
      };
    } finally {
      if (ws) this._closeWs(ws);
    }
  }

  /**
   * 后台轮询子代理状态, 完成时调用 onEnded 回调
   * Background polling loop — calls onEnded when subagent finishes
   *
   * @param {string} childSessionKey
   * @param {string} runId
   * @param {string} agentId
   * @param {string} label
   * @param {number} timeoutSeconds
   * @param {Function} onEnded
   * @param {Function} [onProgress] - V7.0 §15: 中间输出回调 / Progress callback
   * @private
   */
  async _monitorLoop(childSessionKey, runId, agentId, label, timeoutSeconds, onEnded, onProgress) {
    const maxWaitMs = (timeoutSeconds + 60) * 1000; // 额外 60s 缓冲
    const pollIntervalMs = 5000; // 5 秒轮询一次
    const startTime = Date.now();
    let consecutiveEmpty = 0;
    let sawMessages = false;
    const MAX_CONSECUTIVE_EMPTY = 6; // 6 × 5s = 30s 连续空消息后视为完成

    this._logger.debug?.(
      `[DirectSpawn] Monitor started: ${childSessionKey} (timeout=${timeoutSeconds}s, poll=${pollIntervalMs}ms)`
    );

    try {
      while (Date.now() - startTime < maxWaitMs) {
        await this._sleep(pollIntervalMs);

        const status = await this.checkSession(childSessionKey);

        // V7.0 §15: 中间输出回调 — 执行中干预检查
        // V7.0 §15: Progress callback — in-flight intervention check
        if (!status.completed && onProgress && status.partialOutput) {
          try {
            onProgress(status.partialOutput, childSessionKey);
          } catch (err) {
            this._logger.debug?.(`[DirectSpawn] onProgress callback error: ${err.message}`);
          }
        }

        // 连续空检测: 曾有消息后变空 → session 被 Gateway 清理
        // Consecutive empty detection: had messages then emptied → session cleaned by Gateway
        if (status.empty) {
          if (sawMessages) {
            consecutiveEmpty++;
            if (consecutiveEmpty >= MAX_CONSECUTIVE_EMPTY) {
              this._logger.info?.(`[DirectSpawn] Session emptied after messages, treating as done: ${childSessionKey}`);
              try {
                onEnded({
                  targetSessionKey: childSessionKey, childSessionKey, runId, agentId,
                  label: label || undefined, outcome: 'ok', result: null, sessionCleanedUp: true,
                });
              } catch (e) { this._logger.warn?.(`[DirectSpawn] onEnded error: ${e.message}`); }
              return;
            }
          }
        } else {
          consecutiveEmpty = 0;
          if (status.messageCount > 0 || status.completed) sawMessages = true;
        }

        if (status.completed) {
          // B6-fix: 网络错误且尚无实质消息时，不提前结束，继续等待
          if (status.retryable && !sawMessages) {
            this._logger.debug?.(`[DirectSpawn] Network error (retryable), continuing wait: ${childSessionKey}`);
            continue;
          }
          this._logger.info?.(
            `[DirectSpawn] Subagent completed: ${childSessionKey}, ` +
            `success=${status.success}, stopReason=${status.stopReason}`
          );
          try {
            onEnded({
              targetSessionKey: childSessionKey, childSessionKey, runId, agentId,
              label: label || undefined,
              outcome: status.success ? 'ok' : 'error',
              result: status.result, usage: status.usage,
            });
          } catch (err) {
            this._logger.warn?.(`[DirectSpawn] onEnded callback error: ${err.message}`);
          }
          return;
        }
      }

      // 超时 / Timeout
      this._logger.warn?.(`[DirectSpawn] Monitor timeout: ${childSessionKey}`);
      try {
        onEnded({
          targetSessionKey: childSessionKey, childSessionKey, runId, agentId,
          label: label || undefined, outcome: 'timeout',
          error: `Subagent did not complete within ${timeoutSeconds + 60}s`,
        });
      } catch (err) {
        this._logger.warn?.(`[DirectSpawn] onEnded timeout callback error: ${err.message}`);
      }
    } catch (err) {
      // 关键修复: 错误时也必须调用 onEnded, 否则任务永久孤立
      // Critical fix: must call onEnded on error, otherwise task is permanently orphaned
      this._logger.error?.(`[DirectSpawn] Monitor loop error: ${err.message}`);
      try {
        onEnded({
          targetSessionKey: childSessionKey, childSessionKey, runId, agentId,
          label: label || undefined, outcome: 'error',
          error: `Monitor loop error: ${err.message}`,
        });
      } catch (e) {
        this._logger.warn?.(`[DirectSpawn] onEnded error callback: ${e.message}`);
      }
    }
  }

  /**
   * 发送消息到指定 session
   * @param {Object} opts
   * @param {string} opts.targetSessionKey
   * @param {string} opts.message
   * @returns {Promise<{ status: string }>}
   */
  async send({ targetSessionKey, message }) {
    let ws;
    try {
      ws = await this._connectAndAuth();
      const result = await this._sendRequest(ws, 'agent', {
        message,
        sessionKey: targetSessionKey,
        idempotencyKey: randomUUID(),
        deliver: false,
      });
      this._stats.sent++;
      return { status: 'sent', ...result };
    } catch (err) {
      this._stats.failed++;
      this._logger.error?.(`[DirectSpawn] send failed: ${err.message}`);
      return { status: 'send_failed', error: err.message };
    } finally {
      if (ws) this._closeWs(ws);
    }
  }

  /**
   * V7.0: 两段式异步交付 — 向 parent session 注入蜂群结果
   * V7.0: Two-phase async delivery — inject swarm result into parent session
   *
   * 使用 chat.inject (operator.admin) 而非 agent, 因为:
   * - chat.inject 不触发 agent run (零 LLM 消耗)
   * - 直接写入 assistant-role 消息到 session transcript
   * - 广播 "chat" 事件到所有 WS 客户端 (WebChat UI 立即刷新)
   *
   * Uses chat.inject (operator.admin) instead of agent, because:
   * - chat.inject doesn't trigger an agent run (zero LLM cost)
   * - Directly writes an assistant-role message to session transcript
   * - Broadcasts "chat" event to all connected WS clients (WebChat UI updates immediately)
   *
   * @param {Object} opts
   * @param {string} opts.sessionKey - 目标 session key (parent session)
   * @param {string} opts.message - 要注入的消息文本
   * @param {string} [opts.label] - 可选标签前缀 (如 "swarm:result")
   * @returns {Promise<{ status: string, messageId?: string }>}
   */
  async injectResult({ sessionKey, message, label }) {
    if (!sessionKey || !message) {
      return { status: 'skipped', reason: 'missing sessionKey or message' };
    }
    let ws;
    try {
      ws = await this._connectAndAuth();
      const result = await this._sendRequest(ws, 'chat.inject', {
        sessionKey,
        message,
        label: label || undefined,
      });
      this._logger.info?.(`[DirectSpawn] chat.inject to ${sessionKey}: ok (len=${message.length})`);
      return { status: 'injected', messageId: result?.messageId };
    } catch (err) {
      this._logger.warn?.(`[DirectSpawn] chat.inject failed: ${err.message}`);
      return { status: 'inject_failed', error: err.message };
    } finally {
      if (ws) this._closeWs(ws);
    }
  }

  /**
   * 获取统计信息
   * @returns {{ spawned: number, sent: number, failed: number, retries: number }}
   */
  getStats() {
    return { ...this._stats };
  }

  // ━━━ V7.0: Session 操作 API / Session Operation API ━━━

  /**
   * 修改活跃 session 的参数 (model, temperature 等)
   * Patch active session parameters via WS sessions.patch
   *
   * 用途 / Use cases:
   * - PI Controller 闭环: 根据阈值调整切换 model (§7)
   * - ABC 角色分化: 根据蜜蜂角色调整参数 (§6)
   * - GlobalModulator: URGENT 模式切换到强模型
   * - Budget 弹性调度: 预算紧张时降级 model (§33)
   *
   * @param {string} sessionKey - 目标 session key
   * @param {Object} params - 任意 sessions.patch 支持的字段 { model?, spawnDepth?, ... }
   * @returns {Promise<{ status: string, error?: string }>}
   */
  async patchSession(sessionKey, params) {
    let ws;
    try {
      ws = await this._connectAndAuth();
      await this._sendRequest(ws, 'sessions.patch', {
        key: sessionKey,
        ...params,
      });
      this._logger.debug?.(
        `[DirectSpawn] patchSession: ${sessionKey} → ${JSON.stringify(params)}`
      );
      return { status: 'patched' };
    } catch (err) {
      this._logger.warn?.(`[DirectSpawn] patchSession failed: ${err.message}`);
      return { status: 'patch_failed', error: err.message };
    } finally {
      if (ws) this._closeWs(ws);
    }
  }

  /**
   * 读取 session 完整消息历史 (跨 agent 知识传递)
   * Read full session message history for cross-agent knowledge transfer
   *
   * 用途 / Use cases:
   * - §10 Session 历史读取: 连续任务上下文延续
   * - §2 记忆共享: 提取关键发现注入下游 agent
   * - §34 知识蒸馏: 强模型推理链提取
   * - §35 用户行为建模: main session 对话模式分析
   *
   * @param {string} sessionKey - 目标 session key
   * @returns {Promise<{ messages: Array, error?: string }>}
   */
  async getSessionHistory(sessionKey) {
    let ws;
    try {
      ws = await this._connectAndAuth();
      const session = await this._sendRequest(ws, 'sessions.get', {
        key: sessionKey,
      });
      return { messages: session?.messages || [] };
    } catch (err) {
      this._logger.debug?.(
        `[DirectSpawn] getSessionHistory error: ${err.message}`
      );
      return { messages: [], error: err.message };
    } finally {
      if (ws) this._closeWs(ws);
    }
  }

  /**
   * 列出所有活跃 session (实时监控 / dashboard 数据源)
   * List all active sessions for real-time monitoring
   *
   * 用途 / Use cases:
   * - §11 实时会话流监控: dashboard 显示活跃 session
   * - §9 动态 Agent: 评估当前 agent 数量决定是否需要更多
   *
   * @returns {Promise<{ sessions: Array, error?: string }>}
   */
  async listActiveSessions() {
    let ws;
    try {
      ws = await this._connectAndAuth();
      const result = await this._sendRequest(ws, 'sessions.list', {});
      return { sessions: result?.sessions || result || [] };
    } catch (err) {
      this._logger.debug?.(
        `[DirectSpawn] listActiveSessions error: ${err.message}`
      );
      return { sessions: [], error: err.message };
    } finally {
      if (ws) this._closeWs(ws);
    }
  }

  /**
   * 终止并删除指定 session
   * Terminate and delete a session via Gateway sessions.delete
   *
   * 说明 / Notes:
   * - OpenClaw Gateway 不提供 sessions.end, 正确方法是 sessions.delete
   * - delete 会先清理运行中的会话并触发生命周期事件
   *
   * @param {string} sessionKey - 目标 session key
   * @param {Object} [opts]
   * @param {boolean} [opts.deleteTranscript=false] - 是否删除会话 transcript
   * @param {boolean} [opts.emitLifecycleHooks=true] - 是否触发生命周期钩子
   * @returns {Promise<{ status: string, key?: string, deleted?: boolean, error?: string }>}
   */
  async endSession(sessionKey, opts = {}) {
    if (!sessionKey || typeof sessionKey !== 'string') {
      return { status: 'end_failed', error: 'sessionKey is required' };
    }

    const {
      deleteTranscript = false,
      emitLifecycleHooks = true,
    } = opts;

    let ws;
    try {
      ws = await this._connectAndAuth();
      const result = await this._sendRequest(ws, 'sessions.delete', {
        key: sessionKey,
        deleteTranscript,
        emitLifecycleHooks,
      });

      this._logger.info?.(
        `[DirectSpawn] endSession: ${sessionKey}, deleted=${result?.deleted === true}`
      );

      return {
        status: 'ended',
        key: result?.key || sessionKey,
        deleted: result?.deleted === true,
      };
    } catch (err) {
      this._logger.warn?.(`[DirectSpawn] endSession failed: ${sessionKey}, ${err.message}`);
      return { status: 'end_failed', error: err.message };
    } finally {
      if (ws) this._closeWs(ws);
    }
  }

  // ━━━ 内部方法 / Internal Methods ━━━

  /**
   * 执行直接 spawn: sessions.patch + agent(lane=subagent)
   *
   * @param {string} childSessionKey
   * @param {Object} opts
   * @returns {Promise<{ status: string, childSessionKey: string, runId?: string }>}
   * @private
   */
  async _spawnDirect(childSessionKey, { agentId, task, model, timeoutSeconds, label }) {
    // 建立一个 WS 连接, 发送所有请求
    // Open one WS connection, send all requests
    const ws = await this._connectAndAuth();

    try {
      // Step 1: sessions.patch — 设置 spawnDepth
      await this._sendRequest(ws, 'sessions.patch', {
        key: childSessionKey,
        spawnDepth: 1,
      });

      // Step 2: sessions.patch — 设置 model (如果指定)
      if (model) {
        await this._sendRequest(ws, 'sessions.patch', {
          key: childSessionKey,
          model: model,
        });
      }

      // Step 3: agent — 以 subagent lane 启动
      const childTaskMessage = [
        `[Subagent Context] You are running as a subagent (depth 1). Results auto-announce to your requester; do not busy-poll for status.`,
        `[Subagent Task]: ${task}`,
      ].join('\n\n');

      const agentResult = await this._sendRequest(ws, 'agent', {
        message: childTaskMessage,
        sessionKey: childSessionKey,
        idempotencyKey: randomUUID(),
        deliver: false,
        lane: 'subagent',
        // V7.0: 默认使用 detached subagent, 避免父会话断连导致子代理被级联终止。
        // 保留可配置开关以兼容严格 parent-child 生命周期场景。
        spawnedBy: this._detachSubagentsOnParentDisconnect ? undefined : (this._parentSessionKey || undefined),
        timeout: timeoutSeconds,
        label: label || undefined,
      });

      return {
        status: 'spawned',
        childSessionKey,
        runId: agentResult?.runId || undefined,
      };
    } finally {
      // 关闭 WS 连接
      this._closeWs(ws);
    }
  }

  /**
   * 建立 WebSocket 连接并完成 challenge/connect 握手
   *
   * Gateway 协议:
   * 1. Server → Client: { type: "event", event: "connect.challenge", payload: { nonce } }
   * 2. Client → Server: { type: "req", method: "connect", params: { auth: { token }, ... } }
   * 3. Server → Client: { type: "res", ok: true, payload: { type: "hello-ok" } }
   *
   * @returns {Promise<WebSocket>} 已认证的 WebSocket 连接
   * @private
   */
  async _connectAndAuth() {
    const WS = getWebSocket();
    return new Promise((resolve, reject) => {
      const ws = new WS(this._wsUrl);
      let settled = false;
      let connectReqId = null;

      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          this._closeWs(ws);
          reject(new Error('Gateway WS connect timeout (10s)'));
        }
      }, 10000);

      ws.on('error', (err) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(new Error(`WS error: ${err.message}`));
        }
      });

      ws.on('close', (evtOrCode) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(new Error('WS closed during handshake'));
        }
      });

      ws.on('message', (data) => {
        if (settled) return;
        try {
          const frame = JSON.parse(data.toString());

          // Step 1: challenge → 回复 connect 请求
          if (frame.type === 'event' && frame.event === 'connect.challenge') {
            connectReqId = randomUUID();
            const connectReq = {
              type: 'req',
              id: connectReqId,
              method: 'connect',
              params: {
                minProtocol: 3,
                maxProtocol: 3,
                client: {
                  id: 'gateway-client',
                  displayName: 'Claw-Swarm DirectSpawn',
                  version: '6.4.0',
                  platform: process.platform || 'win32',
                  mode: 'backend',
                  instanceId: randomUUID(),
                },
                role: 'operator',
                scopes: ['operator.admin'],
                auth: {
                  token: this._gatewayToken || undefined,
                },
              },
            };
            ws.send(JSON.stringify(connectReq));
            return;
          }

          // Step 2: connect 响应 (hello-ok)
          if (frame.type === 'res' && frame.id === connectReqId) {
            if (frame.ok) {
              settled = true;
              clearTimeout(timer);
              // 保留 message handler 用于后续请求
              ws.removeAllListeners('message');
              resolve(ws);
            } else {
              settled = true;
              clearTimeout(timer);
              this._closeWs(ws);
              const errMsg = frame.error?.message || 'connect rejected';
              reject(new Error(`Gateway auth failed: ${errMsg}`));
            }
            return;
          }
        } catch (parseErr) {
          // 忽略解析错误
        }
      });
    });
  }

  /**
   * 在已认证的 WS 连接上发送请求并等待响应
   *
   * @param {WebSocket} ws
   * @param {string} method
   * @param {Object} params
   * @returns {Promise<Object>} 响应 payload
   * @private
   */
  async _sendRequest(ws, method, params) {
    return new Promise((resolve, reject) => {
      const reqId = randomUUID();
      const timer = setTimeout(() => {
        reject(new Error(`Gateway request timeout: ${method} (10s)`));
      }, 10000);

      const handler = (data) => {
        try {
          const frame = JSON.parse(data.toString());
          // 忽略事件帧 (如 tick)
          if (frame.type !== 'res' || frame.id !== reqId) return;

          clearTimeout(timer);
          ws.removeListener('message', handler);

          if (frame.ok) {
            resolve(frame.payload || {});
          } else {
            const errMsg = frame.error?.message || `${method} failed`;
            reject(new Error(errMsg));
          }
        } catch {
          // 忽略解析错误
        }
      };

      ws.on('message', handler);
      ws.send(JSON.stringify({
        type: 'req',
        id: reqId,
        method,
        params,
      }));
    });
  }

  /**
   * 安全关闭 WebSocket
   * @param {WebSocket} ws
   * @private
   */
  _closeWs(ws) {
    try {
      const WS = getWebSocket();
      if (ws && ws.readyState !== WS.CLOSED && ws.readyState !== WS.CLOSING) {
        ws.close();
      }
    } catch {
      // Best-effort close
    }
  }

  /**
   * @param {number} ms
   * @returns {Promise<void>}
   * @private
   */
  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
