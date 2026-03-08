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
 * @module L2-communication/gossip-protocol
 * @author DEEP-IOS
 */

const DEFAULT_FANOUT = 3;
const DEFAULT_HEARTBEAT_MS = 5000;
const MAX_STATE_AGE_MS = 60000; // 60s 未更新视为过期 / 60s without update = stale

export class GossipProtocol {
  /**
   * @param {Object} [deps]
   * @param {import('./message-bus.js').MessageBus} [deps.messageBus]
   * @param {Object} [deps.logger]
   * @param {number} [deps.fanout=3] - 扇出系数 / Fanout factor
   */
  constructor({ messageBus, logger, fanout } = {}) {
    /** @type {import('./message-bus.js').MessageBus | null} */
    this._messageBus = messageBus || null;

    /** @type {Object} */
    this._logger = logger || console;

    /** @type {number} 扇出系数 / Fanout factor */
    this._fanout = fanout || DEFAULT_FANOUT;

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

    // 通过消息总线广播 / Broadcast via message bus
    if (this._messageBus && recipients.length > 0) {
      this._messageBus.publish('gossip.broadcast', {
        senderId,
        recipients,
        message,
        round: this._roundCount,
      }, { senderId });
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
   * @param {string} agentId - 远程 Agent ID / Remote agent ID
   * @param {Object} remoteState - 远程状态 / Remote state
   * @param {number} remoteVersion - 远程版本号 / Remote version
   * @returns {boolean} 是否更新了本地状态 / Whether local state was updated
   */
  mergeState(agentId, remoteState, remoteVersion) {
    const local = this._states.get(agentId);

    if (!local || remoteVersion > local.version) {
      this._states.set(agentId, {
        state: { ...remoteState },
        version: remoteVersion,
        lastSeen: Date.now(),
      });
      this._stats.merges++;
      return true;
    }

    // 更新 lastSeen (即使版本没变, 说明节点还活着)
    // Update lastSeen (even if version unchanged, node is still alive)
    if (local) {
      local.lastSeen = Date.now();
    }

    return false;
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
   * 销毁
   * Destroy
   */
  destroy() {
    this.stopHeartbeat();
    this._states.clear();
    this._roundCount = 0;
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
