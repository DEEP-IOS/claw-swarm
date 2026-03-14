/**
 * GossipProtocol — Gossip 广播协议 / Gossip Broadcast Protocol
 *
 * V5.0 新增: 同进程 Gossip 模拟, 提供:
 * - 扇出广播 (每次随机选取 fanout 个节点转发)
 * - Agent 状态同步 (心跳 + 状态合并)
 * - 最终一致性保证
 * - 轮次计数 + 收敛检测
 *
 * V5.0 new: In-process Gossip simulation, providing:
 * - Fanout broadcast (randomly select fanout peers per round)
 * - Agent state synchronization (heartbeat + state merge)
 * - Eventual consistency guarantee
 * - Round counting + convergence detection
 *
 * P2-1: 记忆共享 — 心跳时携带 top-3 高重要性记忆摘要
 * P2-1: Memory sharing — during heartbeat, share top-3 high-importance memory summaries
 *
 * P2-2: Gossip 信息素快照 — 同步时携带 top-10 最高浓度信息素
 * P2-2: Gossip pheromone snapshot — during sync, carry top-10 highest intensity pheromones
 *
 * @module L2-communication/gossip-protocol
 * @author DEEP-IOS
 */

const DEFAULT_FANOUT = 3;
const DEFAULT_HEARTBEAT_MS = 5000;
const MAX_STATE_AGE_MS = 60000; // 60s 未更新视为过期 / 60s without update = stale

/** P2-1: 记忆共享数量上限 / Memory sharing count limit */
const MEMORY_SHARE_TOP_N = 3;

/** P2-2: 信息素快照数量上限 / Pheromone snapshot count limit */
const PHEROMONE_SNAPSHOT_TOP_N = 10;

export class GossipProtocol {
  /**
   * @param {Object} [deps]
   * @param {import('./message-bus.js').MessageBus} [deps.messageBus]
   * @param {Object} [deps.logger]
   * @param {number} [deps.fanout=3] - 扇出系数 / Fanout factor
   * @param {import('../L3-agent/memory/episodic-memory.js').EpisodicMemory} [deps.episodicMemory] - P2-1: 情景记忆引用 / Episodic memory reference
   * @param {import('./pheromone-engine.js').PheromoneEngine} [deps.pheromoneEngine] - P2-2: 信息素引擎引用 / Pheromone engine reference
   * @param {Object} [deps.config] - 配置 / Configuration
   * @param {'all'|'zone'|'none'} [deps.config.sharingPolicy='all'] - 共享策略 / Sharing policy
   */
  constructor({ messageBus, logger, fanout, episodicMemory, pheromoneEngine, config } = {}) {
    /** @type {import('./message-bus.js').MessageBus | null} */
    this._messageBus = messageBus || null;

    /** @type {Object} */
    this._logger = logger || console;

    /** @type {number} 扇出系数 / Fanout factor */
    this._fanout = fanout || DEFAULT_FANOUT;

    /** @type {import('../L3-agent/memory/episodic-memory.js').EpisodicMemory | null} P2-1: 情景记忆 / Episodic memory */
    this._episodicMemory = episodicMemory || null;

    /** @type {import('./pheromone-engine.js').PheromoneEngine | null} P2-2: 信息素引擎 / Pheromone engine */
    this._pheromoneEngine = pheromoneEngine || null;

    /** @type {Object} 配置 / Configuration */
    this._config = config || {};

    /** @type {string} 共享策略: 'all' | 'zone' | 'none' / Sharing policy */
    this._sharingPolicy = this._config.sharingPolicy || 'all';

    /**
     * Agent 状态表 / Agent state table
     * @type {Map<string, { state: Object, version: number, lastSeen: number }>}
     */
    this._states = new Map();

    /** @type {number} 广播轮次 / Broadcast round counter */
    this._roundCount = 0;

    /** @type {number | null} 心跳定时器 / Heartbeat timer */
    this._heartbeatTimer = null;

    /** @type {boolean} */
    this._running = false;

    /** @type {Object} 统计 / Statistics */
    this._stats = {
      broadcasts: 0,
      merges: 0,
      staleRemoved: 0,
    };

    /** @type {Object} P2-1/P2-2: 同步统计 / Sync statistics */
    this._syncStats = {
      memoriesShared: 0,
      memoriesReceived: 0,
      pheromonesSync: 0,
    };

    /**
     * V7.0 §30: 传播日志环形缓冲区 / Propagation log ring buffer
     * @type {Array<{ senderId: string, recipients: string[], round: number, summary: string, timestamp: number }>}
     */
    this._propagationLog = [];

    /** V7.0 §30: 传播日志最大条目 / Max propagation log entries */
    this._propagationLogMax = 50;
  }

  // ━━━ 状态管理 / State Management ━━━

  /**
   * 更新本地 Agent 状态
   * Update local agent state
   *
   * @param {string} agentId - Agent ID
   * @param {Object} state - 状态数据 / State data
   */
  updateState(agentId, state) {
    const existing = this._states.get(agentId);
    const version = existing ? existing.version + 1 : 1;

    this._states.set(agentId, {
      state: { ...state },
      version,
      lastSeen: Date.now(),
    });
  }

  /**
   * 获取 Agent 状态
   * Get agent state
   *
   * @param {string} agentId
   * @returns {Object | null}
   */
  getState(agentId) {
    const entry = this._states.get(agentId);
    if (!entry) return null;
    return { ...entry.state, _version: entry.version, _lastSeen: entry.lastSeen };
  }

  /**
   * 获取所有 Agent 状态
   * Get all agent states
   *
   * @returns {Map<string, Object>}
   */
  getAllStates() {
    const result = new Map();
    for (const [id, entry] of this._states) {
      result.set(id, { ...entry.state, _version: entry.version, _lastSeen: entry.lastSeen });
    }
    return result;
  }

  /**
   * 移除 Agent 状态
   * Remove agent state
   *
   * @param {string} agentId
   */
  removeState(agentId) {
    this._states.delete(agentId);
  }

  // ━━━ 广播 / Broadcast ━━━

  /**
   * 扇出广播: 随机选取 fanout 个节点, 将消息转发给它们
   * Fanout broadcast: randomly select fanout peers, forward message to them
   *
   * @param {string} senderId - 发送者 / Sender
   * @param {Object} message - 消息内容 / Message content
   * @param {Object} [options]
   * @param {string[]} [options.exclude=[]] - 排除列表 / Exclude list
   * @returns {{ recipients: string[], round: number }}
   */
  broadcast(senderId, message, { exclude = [] } = {}) {
    this._roundCount++;
    this._stats.broadcasts++;

    // 获取所有可能的接收者 (排除发送者和排除列表)
    // Get all possible recipients (exclude sender and exclude list)
    const excludeSet = new Set([senderId, ...exclude]);
    const candidates = [];

    for (const [id] of this._states) {
      if (!excludeSet.has(id)) {
        candidates.push(id);
      }
    }

    // 随机选取 fanout 个 / Randomly select fanout peers
    const recipients = this._selectRandom(candidates, this._fanout);

    // P2-1/P2-2: 构建同步负载 (如果共享策略允许)
    // Build sync payload (if sharing policy allows)
    const syncPayload = this._sharingPolicy !== 'none'
      ? this._buildSyncPayload()
      : null;

    // 通过消息总线广播 / Broadcast via message bus
    if (this._messageBus && recipients.length > 0) {
      this._messageBus.publish('gossip.broadcast', {
        senderId,
        recipients,
        message,
        round: this._roundCount,
        ...(syncPayload ? { syncPayload } : {}),
      }, { senderId });
    }

    // V7.0 §30: 记录传播日志 / Record propagation log
    if (recipients.length > 0) {
      this._propagationLog.push({
        senderId,
        recipients,
        round: this._roundCount,
        summary: typeof message === 'string'
          ? message.substring(0, 80)
          : (message?.content || message?.type || JSON.stringify(message)).substring(0, 80),
        timestamp: Date.now(),
      });
      // 环形缓冲: 超过上限时裁剪 / Ring buffer: trim when exceeding limit
      if (this._propagationLog.length > this._propagationLogMax) {
        this._propagationLog = this._propagationLog.slice(-Math.floor(this._propagationLogMax / 2));
      }
    }

    return { recipients, round: this._roundCount };
  }

  /**
   * 接收并合并远程状态 (用于状态同步)
   * Receive and merge remote state (for state sync)
   *
   * 合并规则: 版本号更高的覆盖本地状态。
   * Merge rule: higher version overwrites local state.
   *
   * P2-1/P2-2: 如果传入数据包含 syncPayload, 同时处理记忆和信息素同步。
   * If incoming data contains syncPayload, also process memory and pheromone sync.
   *
   * @param {string} agentId - 远程 Agent ID / Remote agent ID
   * @param {Object} remoteState - 远程状态 / Remote state
   * @param {number} remoteVersion - 远程版本号 / Remote version
   * @param {Object} [syncPayload] - P2-1/P2-2: 同步负载 / Sync payload
   * @returns {boolean} 是否更新了本地状态 / Whether local state was updated
   */
  mergeState(agentId, remoteState, remoteVersion, syncPayload) {
    const local = this._states.get(agentId);
    let stateUpdated = false;

    if (!local || remoteVersion > local.version) {
      this._states.set(agentId, {
        state: { ...remoteState },
        version: remoteVersion,
        lastSeen: Date.now(),
      });
      this._stats.merges++;
      stateUpdated = true;
    }

    // 更新 lastSeen (即使版本没变, 说明节点还活着)
    // Update lastSeen (even if version unchanged, node is still alive)
    if (!stateUpdated && local) {
      local.lastSeen = Date.now();
    }

    // P2-1/P2-2: 合并同步负载 / Merge sync payload
    if (syncPayload && this._sharingPolicy !== 'none') {
      this._mergeSyncPayload(syncPayload);
    }

    return stateUpdated;
  }

  // ━━━ 心跳 / Heartbeat ━━━

  /**
   * 启动心跳循环
   * Start heartbeat loop
   *
   * @param {number} [intervalMs=5000] - 心跳间隔 / Heartbeat interval
   */
  startHeartbeat(intervalMs = DEFAULT_HEARTBEAT_MS) {
    if (this._running) return;

    this._running = true;
    this._heartbeatTimer = setInterval(() => {
      this._cleanStale();
    }, intervalMs);

    // 避免阻止进程退出 / Prevent blocking process exit
    if (this._heartbeatTimer.unref) {
      this._heartbeatTimer.unref();
    }
  }

  /**
   * 停止心跳循环
   * Stop heartbeat loop
   */
  stopHeartbeat() {
    this._running = false;
    if (this._heartbeatTimer) {
      clearInterval(this._heartbeatTimer);
      this._heartbeatTimer = null;
    }
  }

  // ━━━ 查询 / Query ━━━

  /**
   * 获取活跃 Agent 列表
   * Get list of active agents
   *
   * @param {number} [maxAgeMs=60000] - 最大年龄 / Max age
   * @returns {string[]}
   */
  getActiveAgents(maxAgeMs = MAX_STATE_AGE_MS) {
    const now = Date.now();
    const active = [];

    for (const [id, entry] of this._states) {
      if (now - entry.lastSeen <= maxAgeMs) {
        active.push(id);
      }
    }

    return active;
  }

  /**
   * 获取 Agent 数量
   * Get agent count
   *
   * @returns {number}
   */
  getAgentCount() {
    return this._states.size;
  }

  /**
   * 获取统计
   * Get statistics
   *
   * @returns {Object}
   */
  getStats() {
    return {
      ...this._stats,
      rounds: this._roundCount,
      agentCount: this._states.size,
      running: this._running,
    };
  }

  /**
   * P2-1/P2-2: 获取同步统计
   * Get sync statistics (memory sharing + pheromone sync)
   *
   * @returns {{ memoriesShared: number, memoriesReceived: number, pheromonesSync: number }}
   */
  getSyncStats() {
    return { ...this._syncStats };
  }

  /**
   * V7.0 §30: 获取最近的传播记录
   * V7.0 §30: Get recent propagation records
   *
   * 用于 before_prompt_build_inject 注入蜂群记忆传播信息。
   * Used in before_prompt_build_inject to inject swarm memory propagation info.
   *
   * @param {Object} [options]
   * @param {number} [options.limit=5] - 返回条目上限 / Max entries to return
   * @returns {Array<{ senderId: string, recipients: string[], round: number, summary: string, timestamp: number }>}
   */
  getRecentPropagations({ limit = 5 } = {}) {
    if (this._propagationLog.length === 0) return [];
    return this._propagationLog.slice(-limit);
  }

  /**
   * 销毁
   * Destroy
   */
  destroy() {
    this.stopHeartbeat();
    this._states.clear();
    this._roundCount = 0;
    this._propagationLog = [];
  }

  // ━━━ 内部方法 / Internal Methods ━━━

  /**
   * 随机选取 n 个元素
   * Randomly select n elements (Fisher-Yates partial shuffle)
   *
   * @param {Array} array
   * @param {number} n
   * @returns {Array}
   * @private
   */
  _selectRandom(array, n) {
    if (array.length <= n) return [...array];

    const copy = [...array];
    const selected = [];

    for (let i = 0; i < n && i < copy.length; i++) {
      const j = i + Math.floor(Math.random() * (copy.length - i));
      [copy[i], copy[j]] = [copy[j], copy[i]];
      selected.push(copy[i]);
    }

    return selected;
  }

  // ━━━ P2-1/P2-2: 同步负载 / Sync Payload ━━━

  /**
   * P2-1/P2-2: 构建同步负载
   * Build sync payload for gossip broadcast
   *
   * 包含: 高重要性记忆摘要 (top-3) + 高浓度信息素快照 (top-10)
   * Contains: high-importance memory summaries (top-3) + high-intensity pheromone snapshot (top-10)
   *
   * @returns {{ memorySummaries: Array, pheromoneSnapshot: Array }}
   * @private
   */
  _buildSyncPayload() {
    const payload = {
      memorySummaries: [],
      pheromoneSnapshot: [],
    };

    // P2-1: 记忆摘要 — 从情景记忆中获取 top-3 高重要性事件
    // Memory summaries — get top-3 highest importance events from episodic memory
    if (this._episodicMemory) {
      try {
        // 遍历所有已知 Agent, 收集各自的 top 记忆
        // Iterate all known agents, collect top memories from each
        const allAgentIds = [...this._states.keys()];
        const allMemories = [];

        for (const agentId of allAgentIds) {
          const memories = this._episodicMemory.recall(agentId, {
            limit: MEMORY_SHARE_TOP_N,
            minImportance: 0.5,
          });
          for (const mem of memories) {
            allMemories.push({
              subject: mem.subject,
              predicate: mem.predicate,
              object: mem.object || null,
              importance: mem.importance,
              eventType: mem.eventType,
              agentId: mem.agentId || agentId,
              timestamp: mem.timestamp,
            });
          }
        }

        // 按重要性降序, 取 top-N / Sort by importance desc, take top-N
        allMemories.sort((a, b) => b.importance - a.importance);
        payload.memorySummaries = allMemories.slice(0, MEMORY_SHARE_TOP_N);
        this._syncStats.memoriesShared += payload.memorySummaries.length;
      } catch (err) {
        this._logger.debug?.(`[GossipProtocol] Failed to build memory summaries: ${err.message}`);
      }
    }

    // P2-2: 信息素快照 — 获取 top-10 最高浓度活跃信息素
    // Pheromone snapshot — get top-10 highest intensity active pheromones
    if (this._pheromoneEngine) {
      try {
        const snapshot = this._pheromoneEngine.buildSnapshot();
        if (snapshot && snapshot.pheromones && snapshot.pheromones.length > 0) {
          // 按浓度降序, 取 top-N / Sort by intensity desc, take top-N
          const sorted = [...snapshot.pheromones].sort((a, b) => b.intensity - a.intensity);
          payload.pheromoneSnapshot = sorted.slice(0, PHEROMONE_SNAPSHOT_TOP_N).map(ph => ({
            type: ph.type,
            targetScope: ph.targetScope,
            intensity: ph.intensity,
            sourceId: ph.sourceId,
            payload: ph.payload || null,
          }));
        }
      } catch (err) {
        this._logger.debug?.(`[GossipProtocol] Failed to build pheromone snapshot: ${err.message}`);
      }
    }

    return payload;
  }

  /**
   * P2-1/P2-2: 合并远程同步负载
   * Merge remote sync payload into local state
   *
   * 记忆: 去重 (subject+predicate+object), 新记忆通过 consolidate 注入
   * Memories: deduplicate (subject+predicate+object), inject new ones via consolidate
   *
   * 信息素: 按 type+scope 取 max(local, remote) 强度
   * Pheromones: take max(local, remote) intensity for same type+scope
   *
   * @param {Object} payload - 远程同步负载 / Remote sync payload
   * @param {Array} [payload.memorySummaries] - 记忆摘要 / Memory summaries
   * @param {Array} [payload.pheromoneSnapshot] - 信息素快照 / Pheromone snapshot
   * @private
   */
  _mergeSyncPayload(payload) {
    if (!payload) return;

    let memoriesMerged = 0;
    let pheromonesMerged = 0;

    // P2-1: 合并记忆摘要 / Merge memory summaries
    if (payload.memorySummaries && payload.memorySummaries.length > 0 && this._episodicMemory) {
      try {
        for (const remoteMem of payload.memorySummaries) {
          // 去重检查: subject + predicate + object 组合
          // Dedup check: subject + predicate + object combination
          const agentId = remoteMem.agentId || 'gossip-shared';
          const existing = this._episodicMemory.recall(agentId, {
            keyword: remoteMem.subject,
            limit: 20,
            minImportance: 0,
          });

          const isDuplicate = existing.some(e =>
            e.subject === remoteMem.subject &&
            e.predicate === remoteMem.predicate &&
            (e.object || null) === (remoteMem.object || null)
          );

          if (!isDuplicate) {
            // 注入新记忆: 通过 consolidate 方式注入
            // Inject new memory: via consolidate approach
            this._episodicMemory.record({
              agentId,
              eventType: remoteMem.eventType || 'observation',
              subject: remoteMem.subject,
              predicate: remoteMem.predicate,
              object: remoteMem.object || undefined,
              importance: remoteMem.importance || 0.5,
              context: { source: 'gossip-sync', originalAgent: remoteMem.agentId },
            });
            memoriesMerged++;
          }
        }
        this._syncStats.memoriesReceived += memoriesMerged;
      } catch (err) {
        this._logger.debug?.(`[GossipProtocol] Failed to merge memory summaries: ${err.message}`);
      }
    }

    // P2-2: 合并信息素快照 / Merge pheromone snapshot
    if (payload.pheromoneSnapshot && payload.pheromoneSnapshot.length > 0 && this._pheromoneEngine) {
      try {
        for (const remotePh of payload.pheromoneSnapshot) {
          // 读取本地同类型+同范围的信息素 / Read local pheromones of same type+scope
          const localPheromones = this._pheromoneEngine.read(remotePh.targetScope, {
            type: remotePh.type,
          });

          const localMatch = localPheromones.find(lp => lp.type === remotePh.type);
          const localIntensity = localMatch ? localMatch.intensity : 0;

          // 取 max(local, remote) / Take max(local, remote)
          if (remotePh.intensity > localIntensity) {
            this._pheromoneEngine.emitPheromone({
              type: remotePh.type,
              sourceId: remotePh.sourceId || 'gossip-sync',
              targetScope: remotePh.targetScope,
              intensity: remotePh.intensity - localIntensity, // 差值补充 / Delta reinforcement
              payload: { ...(remotePh.payload || {}), source: 'gossip-sync' },
            });
            pheromonesMerged++;
          }
        }
        this._syncStats.pheromonesSync += pheromonesMerged;
      } catch (err) {
        this._logger.debug?.(`[GossipProtocol] Failed to merge pheromone snapshot: ${err.message}`);
      }
    }

    // 发布合并事件 / Publish merge event
    if ((memoriesMerged > 0 || pheromonesMerged > 0) && this._messageBus) {
      this._messageBus.publish('gossip.sync.merged', {
        memoriesMerged,
        pheromonesMerged,
        timestamp: Date.now(),
      }, { senderId: 'gossip-protocol' });
    }
  }

  /**
   * 清理过期状态
   * Clean stale states
   *
   * @private
   */
  _cleanStale() {
    const now = Date.now();
    const toRemove = [];

    for (const [id, entry] of this._states) {
      if (now - entry.lastSeen > MAX_STATE_AGE_MS) {
        toRemove.push(id);
      }
    }

    for (const id of toRemove) {
      this._states.delete(id);
      this._stats.staleRemoved++;
    }

    if (toRemove.length > 0 && this._messageBus) {
      this._messageBus.publish('gossip.staleRemoved', {
        removedAgents: toRemove,
        remaining: this._states.size,
      }, { senderId: 'gossip-protocol' });
    }
  }
}
