#!/usr/bin/env node
/**
 * Claw-Swarm — OpenClaw API Surface Snapshot Generator
 * OpenClaw API 表面快照生成器
 *
 * Probes the real OpenClaw Gateway to capture the actual API surface,
 * producing a versioned JSON snapshot for contract-testing.
 * 探测真实 OpenClaw Gateway，捕获实际 API 表面，生成版本化 JSON 快照供契约测试使用。
 *
 * Usage / 用法:
 *   import { generateSnapshot, loadSnapshot } from './openclaw-api-snapshot.js';
 *   const snap = await generateSnapshot(api, console);
 *
 * @module tests/snapshots/openclaw-api-snapshot
 */

import { readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

// ============================================================================
// 常量 / Constants
// ============================================================================

/** 快照版本号，与 OpenClaw 主版本对齐 / Snapshot version, aligned with OpenClaw */
const SNAPSHOT_VERSION = '3.13';

/** 输出文件名 / Output filename */
const SNAPSHOT_FILENAME = `openclaw-${SNAPSHOT_VERSION}.snapshot.json`;

// ----------------------------------------------------------------------------
// 24 个 hook 名称（完整列表）/ All 24 hook names (complete list)
// 来源：src/L0-field/probe-gate.js HOOK_NAMES
// Source: src/L0-field/probe-gate.js HOOK_NAMES
// ----------------------------------------------------------------------------
const HOOK_NAMES = Object.freeze([
  // --- 模型 & 提示 / Model & Prompt ---
  'before_model_resolve',
  'before_prompt_build',
  'before_agent_start',

  // --- LLM 输入/输出 / LLM I/O ---
  'llm_input',
  'llm_output',
  'agent_end',

  // --- 消息生命周期 / Message Lifecycle ---
  'message_received',
  'message_sending',
  'message_sent',

  // --- 工具调用 / Tool Calls ---
  'before_tool_call',
  'after_tool_call',
  'tool_result_persist',

  // --- 会话管理 / Session Management ---
  'session_start',
  'session_end',

  // --- 重置 & 压缩 / Reset & Compaction ---
  'before_reset',
  'before_message_write',
  'before_compaction',
  'after_compaction',

  // --- 子代理 / Sub-agents ---
  'subagent_spawning',
  'subagent_delivery_target',
  'subagent_spawned',
  'subagent_ended',

  // --- 网关生命周期 / Gateway Lifecycle ---
  'gateway_start',
  'gateway_stop',
]);

// ----------------------------------------------------------------------------
// 10 个非 hook API 方法 / 10 non-hook API methods to probe
// ----------------------------------------------------------------------------
const API_METHODS = Object.freeze([
  'registerContextEngine',
  'registerProvider',
  'registerChannel',
  'registerCli',
  'registerGatewayMethod',
  'registerHttpRoute',
  'registerService',
  'registerTool',
  'getDb',
  'getConfig',
]);

// ============================================================================
// generateSnapshot — 主探测函数 / Main probing function
// ============================================================================

/**
 * 探测 OpenClaw Gateway 的真实 API 表面并生成快照 JSON。
 * Probes the real OpenClaw Gateway API surface and produces a snapshot JSON.
 *
 * @param {Object} api    - OpenClaw plugin API 实例 / OpenClaw plugin API instance
 * @param {Object} logger - 日志接口（需有 info/warn/error）/ Logger (needs info/warn/error)
 * @returns {Promise<Object>} 快照对象 / The snapshot object
 */
export async function generateSnapshot(api, logger) {
  const log = logger || console;
  log.info?.('[Snapshot] 开始探测 OpenClaw API 表面 / Starting API surface probe...');

  // ------ 1. 探测 24 个 hook / Probe 24 hooks ------
  const hooks = {};
  for (const hookName of HOOK_NAMES) {
    try {
      // 注册一个优先级 999 的空回调来测试 hook 是否可注册
      // Register a priority-999 no-op callback to test registrability
      api.on(hookName, async () => {}, { priority: 999 });
      hooks[hookName] = { registrable: true };
    } catch (err) {
      hooks[hookName] = { registrable: false, error: err.message };
      log.warn?.(`[Snapshot] hook "${hookName}" 注册失败 / registration failed: ${err.message}`);
    }
  }

  const hooksOk = Object.values(hooks).filter(h => h.registrable).length;
  log.info?.(`[Snapshot] Hooks: ${hooksOk}/${HOOK_NAMES.length} 可注册 / registrable`);

  // ------ 2. 探测 10 个 API 方法 / Probe 10 API methods ------
  const apis = {};
  for (const name of API_METHODS) {
    const exists = typeof api?.[name] === 'function';
    apis[name] = { exists };
    if (!exists) {
      log.warn?.(`[Snapshot] API "${name}" 不存在或非函数 / not found or not a function`);
    }
  }

  const apisOk = Object.values(apis).filter(a => a.exists).length;
  log.info?.(`[Snapshot] APIs: ${apisOk}/${API_METHODS.length} 存在 / exist`);

  // ------ 3. IPC 协议元数据 / IPC protocol metadata ------
  // OpenClaw Gateway 使用 structured-clone 格式的 IPC 消息，支持通配符订阅
  // OpenClaw Gateway uses structured-clone format IPC messages with wildcard support
  const ipc = {
    messageFormat: 'structured-clone',
    wildcardSupport: true,
  };

  // ------ 4. 平台信息 / Platform info ------
  const platform = {
    nodeVersion: process.version,
    os: os.platform(),
    arch: os.arch(),
  };

  // ------ 5. 组装快照对象 / Assemble snapshot object ------
  const snapshot = {
    version: SNAPSHOT_VERSION,
    generatedAt: new Date().toISOString(),
    hooks,
    apis,
    ipc,
    platform,
  };

  // ------ 6. 写入 JSON 文件 / Write JSON file ------
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const outPath = join(__dirname, SNAPSHOT_FILENAME);
  await writeFile(outPath, JSON.stringify(snapshot, null, 2), 'utf-8');
  log.info?.(`[Snapshot] 快照已写入 / Snapshot written to: ${outPath}`);

  return snapshot;
}

// ============================================================================
// loadSnapshot — 读取已有快照 / Load an existing snapshot
// ============================================================================

/**
 * 从指定路径读取快照 JSON。若未指定路径，则从默认位置加载。
 * Reads a snapshot JSON from the given path. Falls back to default location.
 *
 * @param {string} [snapshotPath] - JSON 文件的绝对或相对路径 / Path to the JSON file
 * @returns {Promise<Object>} 解析后的快照对象 / Parsed snapshot object
 */
export async function loadSnapshot(snapshotPath) {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const target = snapshotPath || join(__dirname, SNAPSHOT_FILENAME);
  const raw = await readFile(target, 'utf-8');
  return JSON.parse(raw);
}
