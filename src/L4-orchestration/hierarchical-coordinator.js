/**
 * HierarchicalCoordinator -- 层级蜂群协调器 / Hierarchical Swarm Coordinator
 *
 * V5.1 L4 编排层: 管理 Agent 父子层级关系, 控制 spawn 深度和全局并发。
 * V5.1 L4 Orchestration Layer: manages parent-child agent hierarchy,
 * controls spawn depth and global concurrency.
 *
 * 核心能力 / Core capabilities:
 * - 层级深度限制 (最大 3 层) / Hierarchy depth limit (max 3 levels)
 * - 全局 Agent 并发数软上限 / Global agent concurrency soft limit
 * - subagent_spawning hook 元数据注入 / Metadata injection in subagent_spawning
 * - subagent_ended hook 结果收集 / Result collection in subagent_ended
 * - 信息素快照传递 (COW + 衰减参数) / Pheromone snapshot passing (COW + decay params)
 *
 * ⚠️ SDK 字段纠正:
 * - subagent_ended: event.targetSessionKey (非 event.childSessionKey)
 * - childSessionKey 在 ctx (第二个参数) 上
 * - outcome 字段: success | error | timeout
 *
 * @module L4-orchestration/hierarchical-coordinator
 * @version 5.1.0
 * @author DEEP-IOS
 */

import { EventTopics, wrapEvent } from '../event-catalog.js';

// ============================================================================
// 常量 / Constants
// ============================================================================

/** 默认最大层级深度 / Default max hierarchy depth */
const DEFAULT_MAX_DEPTH = 3;

/** 默认蜂群 Agent 并发软上限 / Default swarm agent concurrency soft limit */
const DEFAULT_SWARM_MAX_AGENTS = 20;

/** 去抖窗口 (ms) — 同一 turnId 内文本+tool_call 去重 / Dedup window */
const DEDUP_WINDOW_MS = 300;

// ============================================================================
// HierarchicalCoordinator 类 / HierarchicalCoordinator Class
// ============================================================================

export class HierarchicalCoordinator {
  /**
   * @param {Object} deps
   * @param {Object} deps.messageBus - MessageBus 实例
   * @param {Object} deps.pheromoneEngine - PheromoneEngine 实例
   * @param {Object} deps.agentRepo - AgentRepository 实例
   * @param {Object} deps.logger - 日志器
   * @param {Object} [deps.config] - 配置项
   * @param {number} [deps.config.maxDepth=3] - 最大层级深度
   * @param {number} [deps.config.swarmMaxAgents=20] - 蜂群 Agent 并发软上限
   */
  constructor({ messageBus, pheromoneEngine, agentRepo, logger, config = {} }) {
    this._messageBus = messageBus;
    this._pheromoneEngine = pheromoneEngine;
    this._agentRepo = agentRepo;
    this._logger = logger || console;

    this._maxDepth = config.maxDepth || DEFAULT_MAX_DEPTH;
    this._swarmMaxAgents = config.swarmMaxAgents || DEFAULT_SWARM_MAX_AGENTS;

    /**
     * 层级元数据: sessionKey → { parentSessionKey, depth, childCount, agentId }
     * Hierarchy metadata
     * @type {Map<string, Object>}
     */
    this._hierarchy = new Map();

    /**
     * 父 → 子映射: parentSessionKey → Set<childSessionKey>
     * Parent → children mapping
     * @type {Map<string, Set<string>>}
     */
    this._parentChildren = new Map();

    /**
     * 当前活跃 Agent 计数 / Current active agent count
     * @type {number}
     */
    this._activeAgentCount = 0;

    /**
     * 去抖缓存: turnId → { timestamp, processed }
     * Dedup cache for text→tool_call conversion
     * @type {Map<string, Object>}
     */
    this._dedupCache = new Map();

    // 定期清理去抖缓存 / Periodic dedup cache cleanup
    this._cleanupTimer = setInterval(() => this._cleanupDedupCache(), 10000);
    if (this._cleanupTimer.unref) this._cleanupTimer.unref();
  }

  // ━━━ subagent_spawning hook handler ━━━

  /**
   * 处理 subagent_spawning 事件 — 验证 + 元数据注入
   * Handle subagent_spawning — validation + metadata injection
   *
   * ⚠️ 此 hook 只返回 {status:"ok"} 或 {status:"error",errorMessage:string}
   *
   * @param {Object} event - Hook 事件
   * @param {string} event.childSessionKey - 子 Agent 会话键
   * @param {string} event.requesterSessionKey - 父 Agent 会话键
   * @param {Object} [ctx] - 上下文对象
   * @returns {{ status: string, errorMessage?: string }}
   */
  handleSubagentSpawning(event, ctx) {
    const childKey = event.childSessionKey;
    const parentKey = event.requesterSessionKey;

    this._logger.info?.(
      `[HierarchicalCoord] subagent_spawning: child=${childKey}, parent=${parentKey}`
    );

    // 1. 计算深度 / Calculate depth
    const parentMeta = this._hierarchy.get(parentKey);
    const parentDepth = parentMeta?.depth ?? 0;
    const childDepth = parentDepth + 1;

    // 2. 深度检查 / Depth check
    if (childDepth > this._maxDepth) {
      this._logger.warn?.(
        `[HierarchicalCoord] Spawn rejected: depth ${childDepth} > maxDepth ${this._maxDepth}`
      );
      return {
        status: 'error',
        errorMessage: `Spawn rejected: hierarchy depth ${childDepth} exceeds max ${this._maxDepth}`,
      };
    }

    // 3. 全局并发检查 / Global concurrency check
    if (this._activeAgentCount >= this._swarmMaxAgents) {
      this._logger.warn?.(
        `[HierarchicalCoord] Spawn rejected: active agents ${this._activeAgentCount} >= limit ${this._swarmMaxAgents}`
      );
      return {
        status: 'error',
        errorMessage: `Spawn rejected: active agent count ${this._activeAgentCount} >= swarm limit ${this._swarmMaxAgents}`,
      };
    }

    // 4. 注册层级元数据 / Register hierarchy metadata
    this._hierarchy.set(childKey, {
      parentSessionKey: parentKey,
      depth: childDepth,
      childCount: 0,
      agentId: event.agentId || childKey,
      spawnedAt: Date.now(),
      status: 'spawning',
    });

    // 更新父节点的子计数 / Update parent child count
    if (parentMeta) {
      parentMeta.childCount++;
    }

    // 更新父子映射 / Update parent-children mapping
    if (!this._parentChildren.has(parentKey)) {
      this._parentChildren.set(parentKey, new Set());
    }
    this._parentChildren.get(parentKey).add(childKey);

    this._activeAgentCount++;

    this._logger.info?.(
      `[HierarchicalCoord] Spawn approved: depth=${childDepth}, active=${this._activeAgentCount}`
    );

    return { status: 'ok' };
  }

  // ━━━ subagent_spawned hook handler ━━━

  /**
   * 处理 subagent_spawned 事件 — 确认 spawn 成功, 更新状态
   * Handle subagent_spawned — confirm spawn success, update status
   *
   * @param {Object} event
   * @param {Object} [ctx]
   */
  handleSubagentSpawned(event, ctx) {
    const childKey = event.childSessionKey;

    const meta = this._hierarchy.get(childKey);
    if (meta) {
      meta.status = 'active';
      this._logger.info?.(
        `[HierarchicalCoord] subagent_spawned confirmed: ${childKey} (depth=${meta.depth})`
      );
    }

    // 发布 agent.registered 事件 / Publish agent.registered event
    this._messageBus?.publish?.(
      EventTopics.AGENT_REGISTERED,
      wrapEvent(EventTopics.AGENT_REGISTERED, {
        agentId: meta?.agentId || childKey,
        parentSessionKey: meta?.parentSessionKey,
        depth: meta?.depth,
        status: 'active',
      }, 'hierarchical-coordinator')
    );
  }

  // ━━━ subagent_ended hook handler ━━━

  /**
   * 处理 subagent_ended 事件 — 结果收集 + 信息素更新
   * Handle subagent_ended — result collection + pheromone update
   *
   * ⚠️ SDK 字段: event.targetSessionKey (非 event.childSessionKey)
   *    outcome: 'success' | 'error' | 'timeout'
   *
   * @param {Object} event
   * @param {string} event.targetSessionKey - 结束的子 Agent 会话键
   * @param {string} event.outcome - success | error | timeout
   * @param {Object} [ctx]
   */
  handleSubagentEnded(event, ctx) {
    // ⚠️ SDK: targetSessionKey 在 event 上, childSessionKey 可能在 ctx 上
    const childKey = event.targetSessionKey || ctx?.childSessionKey;
    const outcome = event.outcome || 'unknown';

    this._logger.info?.(
      `[HierarchicalCoord] subagent_ended: ${childKey}, outcome=${outcome}`
    );

    const meta = this._hierarchy.get(childKey);
    if (!meta) {
      // 非蜂群管理的子 agent / Non-swarm managed sub-agent
      return;
    }

    // 1. 更新状态 / Update status
    meta.status = outcome === 'success' ? 'completed' : 'failed';
    meta.endedAt = Date.now();

    // 2. 递减父节点子计数 / Decrement parent child count
    const parentMeta = this._hierarchy.get(meta.parentSessionKey);
    if (parentMeta && parentMeta.childCount > 0) {
      parentMeta.childCount--;
    }

    // 从父子映射中移除 / Remove from parent-children mapping
    const siblings = this._parentChildren.get(meta.parentSessionKey);
    if (siblings) {
      siblings.delete(childKey);
      if (siblings.size === 0) {
        this._parentChildren.delete(meta.parentSessionKey);
      }
    }

    // 3. 递减活跃计数 / Decrement active count
    if (this._activeAgentCount > 0) {
      this._activeAgentCount--;
    }

    // 4. 信息素更新 / Pheromone update
    try {
      if (this._pheromoneEngine) {
        const pheromoneType = outcome === 'success' ? 'trail' : 'alarm';
        const intensity = outcome === 'success' ? 0.8 : 0.6;

        this._pheromoneEngine.emitPheromone?.({
          type: pheromoneType,
          sourceId: meta.agentId || childKey,
          targetScope: `/hierarchy/${meta.parentSessionKey}`,
          intensity,
          payload: {
            outcome,
            depth: meta.depth,
            duration: meta.endedAt - meta.spawnedAt,
          },
        });
      }
    } catch (err) {
      this._logger.warn?.(
        `[HierarchicalCoord] Pheromone update failed: ${err.message}`
      );
    }

    // 5. 发布事件 / Publish event
    this._messageBus?.publish?.(
      EventTopics.AGENT_END,
      wrapEvent(EventTopics.AGENT_END, {
        agentId: meta.agentId || childKey,
        outcome,
        depth: meta.depth,
        parentSessionKey: meta.parentSessionKey,
        duration: meta.endedAt - meta.spawnedAt,
      }, 'hierarchical-coordinator')
    );

    // 6. 延迟清理元数据 (保留 30s 供查询) / Delayed cleanup (keep 30s for queries)
    setTimeout(() => {
      this._hierarchy.delete(childKey);
    }, 30000);
  }

  // ━━━ 上下文注入辅助 / Context injection helpers ━━━

  /**
   * 为子 Agent 构建蜂群上下文（父角色、任务链、信息素快照）
   * Build swarm context for child agent
   *
   * @param {string} childSessionKey - 子 Agent 会话键
   * @returns {string|null} 上下文文本
   */
  buildChildContext(childSessionKey) {
    const meta = this._hierarchy.get(childSessionKey);
    if (!meta) return null;

    const parts = [];

    // 1. 层级信息 / Hierarchy info
    parts.push(
      `[蜂群层级] 深度: ${meta.depth}/${this._maxDepth}, ` +
      `父会话: ${meta.parentSessionKey}`
    );

    // 2. 信息素快照 (COW + 衰减参数) / Pheromone snapshot (COW + decay params)
    try {
      if (this._pheromoneEngine) {
        const hotspots = this._pheromoneEngine.getHotspots?.({ limit: 3 }) || [];
        if (hotspots.length > 0) {
          const snapshotTime = Date.now();
          const lines = hotspots.map(h => {
            // 携带已衰减后的 snapshotIntensity
            const lambda = h.lambda || 0.1;
            const age = (snapshotTime - (h.timestamp || snapshotTime)) / 1000;
            const snapshotIntensity = (h.intensity || 0) * Math.exp(-lambda * age);
            return `  ${h.type}@${(h.scope || '').substring(0, 15)}: ` +
              `${snapshotIntensity.toFixed(2)} (λ=${lambda}, t=${snapshotTime})`;
          });
          parts.push(`[信息素快照]\n${lines.join('\n')}`);
        }
      }
    } catch { /* silent */ }

    // 3. 兄弟 Agent 状态 / Sibling agent status
    try {
      const siblings = this._parentChildren.get(meta.parentSessionKey);
      if (siblings && siblings.size > 1) {
        const siblingInfos = [];
        for (const sibKey of siblings) {
          if (sibKey === childSessionKey) continue;
          const sibMeta = this._hierarchy.get(sibKey);
          if (sibMeta) {
            siblingInfos.push(`  ${sibMeta.agentId}: ${sibMeta.status}`);
          }
        }
        if (siblingInfos.length > 0) {
          parts.push(`[兄弟 Agent]\n${siblingInfos.join('\n')}`);
        }
      }
    } catch { /* silent */ }

    return parts.length > 0 ? parts.join('\n') : null;
  }

  // ━━━ SOUL.md 双阶段迁移辅助 / SOUL.md dual-phase migration helpers ━━━

  /**
   * 检查是否需要去重（同一 turnId 内文本"派遣" + tool_call 同时出现）
   * Check if dedup is needed (text dispatch + tool_call in same turn)
   *
   * @param {string} turnId
   * @returns {boolean} true 时抑制文本解析
   */
  shouldSuppressTextParsing(turnId) {
    if (!turnId) return false;
    const cached = this._dedupCache.get(turnId);
    if (cached && (Date.now() - cached.timestamp) < DEDUP_WINDOW_MS) {
      return cached.toolCallDetected;
    }
    return false;
  }

  /**
   * 记录本 turn 已检测到 tool_call
   * Record that a tool_call was detected in this turn
   *
   * @param {string} turnId
   */
  recordToolCallDetected(turnId) {
    if (!turnId) return;
    this._dedupCache.set(turnId, {
      timestamp: Date.now(),
      toolCallDetected: true,
    });
  }

  // ━━━ 查询 / Queries ━━━

  /**
   * 获取层级统计 / Get hierarchy statistics
   *
   * @returns {Object}
   */
  getStats() {
    let maxDepthSeen = 0;
    let activeCount = 0;
    let completedCount = 0;
    let failedCount = 0;

    for (const meta of this._hierarchy.values()) {
      if (meta.depth > maxDepthSeen) maxDepthSeen = meta.depth;
      if (meta.status === 'active' || meta.status === 'spawning') activeCount++;
      else if (meta.status === 'completed') completedCount++;
      else if (meta.status === 'failed') failedCount++;
    }

    return {
      maxDepth: this._maxDepth,
      swarmMaxAgents: this._swarmMaxAgents,
      currentActiveAgents: this._activeAgentCount,
      maxDepthSeen,
      hierarchySize: this._hierarchy.size,
      activeCount,
      completedCount,
      failedCount,
    };
  }

  /**
   * 获取指定 Agent 的层级元数据
   * Get hierarchy metadata for a specific agent
   *
   * @param {string} sessionKey
   * @returns {Object|null}
   */
  getMetadata(sessionKey) {
    return this._hierarchy.get(sessionKey) || null;
  }

  /**
   * 获取父 Agent 的所有子 Agent
   * Get all children of a parent agent
   *
   * @param {string} parentSessionKey
   * @returns {string[]} 子 Agent 会话键列表
   */
  getChildren(parentSessionKey) {
    const children = this._parentChildren.get(parentSessionKey);
    return children ? [...children] : [];
  }

  /**
   * 检查是否为蜂群管理的 Agent
   * Check if agent is managed by the swarm hierarchy
   *
   * @param {string} sessionKey
   * @returns {boolean}
   */
  isManaged(sessionKey) {
    return this._hierarchy.has(sessionKey);
  }

  // ━━━ 生命周期 / Lifecycle ━━━

  /**
   * 销毁协调器, 清理资源
   * Destroy coordinator, clean up resources
   */
  destroy() {
    if (this._cleanupTimer) {
      clearInterval(this._cleanupTimer);
      this._cleanupTimer = null;
    }
    this._hierarchy.clear();
    this._parentChildren.clear();
    this._dedupCache.clear();
    this._activeAgentCount = 0;
    this._logger.info?.('[HierarchicalCoord] Destroyed');
  }

  // ━━━ 内部 / Internal ━━━

  /**
   * 清理过期的去抖缓存 / Clean up expired dedup cache entries
   * @private
   */
  _cleanupDedupCache() {
    const now = Date.now();
    for (const [key, entry] of this._dedupCache) {
      if (now - entry.timestamp > DEDUP_WINDOW_MS * 3) {
        this._dedupCache.delete(key);
      }
    }
  }
}
