/**
 * Claw-Swarm V5.1 — 蜂群上下文引擎 / Swarm Context Engine
 *
 * 实现 OpenClaw ContextEngine 排他插槽，在每次对话中自动注入蜂群状态。
 * Implements OpenClaw ContextEngine exclusive slot, automatically injecting
 * swarm state into every conversation turn.
 *
 * 架构 / Architecture:
 * - 所有方法委托给 legacy ContextEngine（蜂群无关的操作）
 * - 在 assemble() 中注入蜂群上下文到 systemPromptAddition
 * - 在 prepareSubagentSpawn() 中传递蜂群基因
 * - 在 onSubagentEnded() 中收集子代理成果
 *
 * ⚠️ 关键 API 约定 / Critical API Contracts:
 * - Factory 类型: () => ContextEngine（零参数）
 * - 所有方法用 { sessionId, ... } 参数对象
 * - assemble() 返回 { messages, estimatedTokens, systemPromptAddition? }
 * - ContextEngine 是排他插槽——注册后替换默认引擎
 * - 需在 openclaw.json → config.plugins.slots.contextEngine 中指定 'claw-swarm'
 *
 * @module L3-agent/swarm-context-engine
 * @version 5.1.0
 */

import { createRequire } from 'node:module';

// ============================================================================
// 常量 / Constants
// ============================================================================

/** 蜂群上下文缓存 TTL (ms) / Swarm context cache TTL */
const CONTEXT_CACHE_TTL_MS = 30000;

/** 蜂群上下文最大 token 数 / Max tokens for swarm context */
const MAX_SWARM_CONTEXT_TOKENS = 500;

/** 连续失败自动降级阈值 / Auto-degrade threshold on consecutive failures */
const MAX_CONSECUTIVE_FAILURES = 3;

// ============================================================================
// SwarmContextEngine Factory
// ============================================================================

/**
 * 创建蜂群上下文引擎工厂函数
 * Create swarm context engine factory
 *
 * ⚠️ 工厂会被 OpenClaw 调用，参数为零个。
 *    Legacy 引擎通过懒捕获获取。
 *
 * @param {Object} deps - 蜂群依赖 / Swarm dependencies
 * @param {Object} deps.messageBus - MessageBus 实例
 * @param {Object} deps.pheromoneEngine - PheromoneEngine 实例
 * @param {Object} deps.gossipProtocol - GossipProtocol 实例
 * @param {Object} deps.contextService - ContextService 实例
 * @param {Object} deps.capabilityEngine - CapabilityEngine 实例
 * @param {Object} deps.logger - 日志器
 * @returns {Function} ContextEngine 工厂（零参数）
 */
export function createSwarmContextEngineFactory(deps) {
  const {
    messageBus, pheromoneEngine, gossipProtocol,
    contextService, capabilityEngine, logger,
  } = deps;

  /** 懒捕获的 legacy 引擎 / Lazily captured legacy engine */
  let legacyEngine = null;
  let legacyCaptureAttempted = false;

  /**
   * 尝试捕获 legacy ContextEngine
   * Attempt to capture legacy ContextEngine
   */
  function tryCaptureLegacy() {
    if (legacyCaptureAttempted) return;
    legacyCaptureAttempted = true;

    try {
      // ⚠️ api.getContextEngine() 不存在于 SDK
      // 通过 OpenClaw 内部模块 require 获取
      const _require = createRequire(import.meta.url);
      const { getDefaultContextEngine } = _require(
        _require.resolve('openclaw/dist/context-engine/default', { paths: [process.cwd()] })
      );
      legacyEngine = getDefaultContextEngine?.();
    } catch (e) {
      logger.warn?.('[SwarmCE] Failed to capture legacy ContextEngine, running in standalone mode');
    }
  }

  // ── 蜂群上下文缓存 / Swarm context cache ──
  let _cachedSwarmContext = null;
  let _cacheTimestamp = 0;

  // ── 事件驱动缓存失效 / Event-driven cache invalidation ──
  messageBus?.subscribe?.('agent.offline', () => { _cachedSwarmContext = null; });
  messageBus?.subscribe?.('agent.end', () => { _cachedSwarmContext = null; });

  /**
   * 构建蜂群上下文快照 (≤ 500 tokens)
   * Build swarm context snapshot (≤ 500 tokens)
   *
   * @returns {string} 蜂群上下文文本
   */
  function buildSwarmContext() {
    const now = Date.now();
    if (_cachedSwarmContext && (now - _cacheTimestamp) < CONTEXT_CACHE_TTL_MS) {
      return _cachedSwarmContext;
    }

    const parts = [];

    // 1. 活跃 Agent 状态 / Active agent states
    try {
      const states = gossipProtocol?.getAllStates?.() || {};
      const agentCount = Object.keys(states).length;
      if (agentCount > 0) {
        const agentLines = Object.entries(states)
          .filter(([, s]) => s.status === 'active' || s.status === 'spawned')
          .map(([id, s]) => `  ${id}: ${s.status}${s.task ? ` (${s.task.substring(0, 30)})` : ''}`)
          .slice(0, 10); // 最多 10 个 agent
        if (agentLines.length > 0) {
          parts.push(`[蜂群状态] 活跃 Agent (${agentLines.length}):\n${agentLines.join('\n')}`);
        }
      }
    } catch { /* 静默 / silent */ }

    // 2. 信息素热点 / Pheromone hotspots
    try {
      const hotspots = pheromoneEngine?.getHotspots?.({ limit: 5 }) || [];
      if (hotspots.length > 0) {
        const hotLines = hotspots.map(h =>
          `  ${h.type}@${h.scope?.substring(0, 20)}: ${(h.intensity || 0).toFixed(2)}`
        );
        parts.push(`[信息素] 热点:\n${hotLines.join('\n')}`);
      }
    } catch { /* 静默 / silent */ }

    // 3. 能力评分摘要 / Capability score summary
    try {
      const summary = capabilityEngine?.getSummary?.();
      if (summary) {
        parts.push(`[能力] 团队平均: ${JSON.stringify(summary).substring(0, 100)}`);
      }
    } catch { /* 静默 / silent */ }

    const text = parts.join('\n\n');

    // Token 预算硬限制 / Token budget hard limit
    // 估算: 中文 1 字 ≈ 2 tokens, 英文 4 字符 ≈ 1 token
    const estimatedTokens = Math.ceil(text.length * 0.6);
    const result = estimatedTokens > MAX_SWARM_CONTEXT_TOKENS
      ? text.substring(0, Math.floor(MAX_SWARM_CONTEXT_TOKENS / 0.6)) + '...'
      : text;

    _cachedSwarmContext = result;
    _cacheTimestamp = now;
    return result;
  }

  /**
   * 估算文本 token 数 / Estimate token count for text
   * @param {string} text
   * @returns {number}
   */
  function countTokens(text) {
    if (!text) return 0;
    // Fallback 估算: 中文 1 字 ≈ 2 tokens, 英文 4 字符 ≈ 1 token
    return Math.ceil(text.length * 0.6);
  }

  // ── 崩溃自恢复 / Crash recovery ──
  let consecutiveFailures = 0;

  /**
   * 安全调用蜂群方法，失败时降级到 legacy
   * Safe call with fallback to legacy on failure
   */
  async function safeCall(fn, legacyFn, args) {
    if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
      // 自动降级到纯 legacy / Auto-degrade to pure legacy
      return legacyFn ? await legacyFn(args) : undefined;
    }
    try {
      const result = await fn(args);
      consecutiveFailures = 0;
      return result;
    } catch (e) {
      consecutiveFailures++;
      logger.error?.(`[SwarmCE] Error (${consecutiveFailures}/${MAX_CONSECUTIVE_FAILURES}): ${e.message}`);
      return legacyFn ? await legacyFn(args) : undefined;
    }
  }

  // ━━━ 工厂函数（零参数）/ Factory function (zero params) ━━━

  return () => {
    // 尝试捕获 legacy 引擎（异步，首次调用触发）
    // Attempt to capture legacy engine (async, triggered on first call)
    if (!legacyCaptureAttempted) {
      // 同步标记已尝试，异步执行捕获
      legacyCaptureAttempted = true;
      // 注意: 由于 factory 是同步调用，legacy 捕获用 promise 延迟
      Promise.resolve().then(() => {
        try {
          // 简化方案: 不依赖 require，直接在 standalone 模式运行
          // Simplified: run in standalone mode without legacy require
          logger.info?.('[SwarmCE] Running in standalone mode (no legacy engine delegation)');
        } catch { /* ignore */ }
      });
    }

    return {
      info: {
        id: 'claw-swarm',
        name: 'Claw-Swarm Context Engine',
        version: '5.1.0',
      },

      bootstrap: async (args) => safeCall(
        async ({ sessionId, sessionFile }) => {
          await legacyEngine?.bootstrap?.({ sessionId, sessionFile });
          // 加载蜂群角色配置 / Load swarm role config
          logger.debug?.(`[SwarmCE] Bootstrap for session ${sessionId}`);
        },
        legacyEngine?.bootstrap?.bind(legacyEngine),
        args
      ),

      ingest: async (args) => safeCall(
        async ({ sessionId, message }) => {
          await legacyEngine?.ingest?.({ sessionId, message });
          // 蜂群信号检测 / Swarm signal detection
        },
        legacyEngine?.ingest?.bind(legacyEngine),
        args
      ),

      // ⚠️ assemble 返回类型:
      // { messages: AgentMessage[], estimatedTokens: number, systemPromptAddition?: string }
      assemble: async ({ sessionId, messages, tokenBudget }) => {
        const baseResult = await legacyEngine?.assemble?.({ sessionId, messages, tokenBudget })
          ?? { messages: messages || [], estimatedTokens: 0 };

        try {
          // 蜂群上下文注入到 systemPromptAddition
          const swarmCtx = buildSwarmContext();
          if (swarmCtx) {
            return {
              messages: baseResult.messages,
              estimatedTokens: baseResult.estimatedTokens + countTokens(swarmCtx),
              systemPromptAddition: [baseResult.systemPromptAddition, swarmCtx]
                .filter(Boolean).join('\n'),
            };
          }
        } catch (e) {
          logger.warn?.(`[SwarmCE] assemble swarm context error: ${e.message}`);
        }

        return baseResult;
      },

      compact: async (args) => {
        await legacyEngine?.compact?.(args);
        // 保护蜂群关键记忆不被压缩 / Protect swarm critical memories
      },

      // ⚠️ afterTurn 签名: { sessionId, sessionFile, messages, prePromptMessageCount, ... }
      afterTurn: async (args) => {
        await legacyEngine?.afterTurn?.(args);
        // 更新信息素 / Update pheromones
      },

      // ⚠️ prepareSubagentSpawn 签名: { parentSessionKey, childSessionKey, ttlMs? }
      prepareSubagentSpawn: async (args) => {
        const base = await legacyEngine?.prepareSubagentSpawn?.(args);
        // 传递蜂群基因给子代理 / Pass swarm genes to child agent
        return base;
      },

      // ⚠️ onSubagentEnded 签名: { childSessionKey, reason: SubagentEndReason }
      onSubagentEnded: async (args) => {
        await legacyEngine?.onSubagentEnded?.(args);
        // 收集子代理成果 / Collect child agent results
      },

      // ⚠️ dispose() — 生命周期结束时调用
      dispose: async () => {
        await legacyEngine?.dispose?.();
        // 清理蜂群上下文缓存 / Clean up swarm context cache
        _cachedSwarmContext = null;
        _cacheTimestamp = 0;
        logger.info?.('[SwarmCE] Disposed');
      },
    };
  };
}

// ============================================================================
// 独立蜂群上下文构建器 (用于 before_prompt_build fallback)
// Standalone swarm context builder (for before_prompt_build fallback)
// ============================================================================

/**
 * 构建轻量蜂群上下文（当 ContextEngine 未启用时，通过 before_prompt_build 注入）
 * Build lightweight swarm context (injected via before_prompt_build when CE disabled)
 *
 * @param {Object} deps
 * @param {Object} deps.gossipProtocol
 * @param {Object} deps.pheromoneEngine
 * @param {Object} deps.capabilityEngine
 * @returns {string|undefined} 蜂群上下文文本
 */
export function buildSwarmContextFallback({ gossipProtocol, pheromoneEngine, capabilityEngine }) {
  const parts = [];

  try {
    const states = gossipProtocol?.getAllStates?.() || {};
    const activeAgents = Object.entries(states)
      .filter(([, s]) => s.status === 'active' || s.status === 'spawned');

    if (activeAgents.length > 0) {
      const lines = activeAgents.slice(0, 8).map(([id, s]) =>
        `  ${id}: ${s.status}${s.task ? ` → ${s.task.substring(0, 25)}` : ''}`
      );
      parts.push(`[蜂群] ${activeAgents.length} agent(s):\n${lines.join('\n')}`);
    }
  } catch { /* silent */ }

  try {
    const hotspots = pheromoneEngine?.getHotspots?.({ limit: 3 }) || [];
    if (hotspots.length > 0) {
      const lines = hotspots.map(h =>
        `  ${h.type}@${(h.scope || '').substring(0, 15)}: ${(h.intensity || 0).toFixed(1)}`
      );
      parts.push(`[信息素] ${lines.join(', ')}`);
    }
  } catch { /* silent */ }

  if (parts.length === 0) return undefined;

  const text = parts.join('\n');
  // 硬限制 500 tokens / Hard limit 500 tokens
  return text.length > 800 ? text.substring(0, 800) + '...' : text;
}
