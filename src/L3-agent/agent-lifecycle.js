/**
 * AgentLifecycle — 8 态有限状态机 / 8-State Finite State Machine
 *
 * P1-3: 审计优化路线图中的 Agent 生命周期管理。
 * 定义 8 个生命周期状态和合法转换矩阵，保证状态流转的可预测性与可审计性。
 *
 * P1-3: Agent lifecycle management from audit optimization roadmap.
 * Defines 8 lifecycle states and valid transition matrix, ensuring
 * predictable and auditable state transitions.
 *
 * 状态流 / State Flow:
 *   INIT → IDLE → ACTIVE → BUSY → ACTIVE → IDLE → STANDBY → RETIRED
 *                    ↕       ↕
 *                  PAUSED  PAUSED
 *                    ↓       ↓
 *              MAINTENANCE ←─┘
 *                    ↓
 *                 RETIRED (终态 / Terminal)
 *
 * @module L3-agent/agent-lifecycle
 * @version 6.0.0
 * @author DEEP-IOS
 */

import { nanoid } from 'nanoid';
import { EventTopics, wrapEvent } from '../event-catalog.js';

// ============================================================================
// 常量 / Constants
// ============================================================================

const SOURCE = 'agent-lifecycle';

/**
 * 生命周期状态枚举 / Lifecycle state enum
 * @enum {string}
 */
export const LIFECYCLE_STATES = Object.freeze({
  INIT:        'INIT',
  IDLE:        'IDLE',
  ACTIVE:      'ACTIVE',
  BUSY:        'BUSY',
  PAUSED:      'PAUSED',
  STANDBY:     'STANDBY',
  MAINTENANCE: 'MAINTENANCE',
  RETIRED:     'RETIRED',
});

/**
 * 合法状态转换矩阵 / Valid state transition matrix
 * key = 当前状态, value = 允许转换到的状态集合
 * key = current state, value = set of allowed target states
 * @type {Record<string, Set<string>>}
 */
const TRANSITION_RULES = Object.freeze({
  [LIFECYCLE_STATES.INIT]:        new Set([LIFECYCLE_STATES.IDLE]),
  [LIFECYCLE_STATES.IDLE]:        new Set([LIFECYCLE_STATES.ACTIVE, LIFECYCLE_STATES.STANDBY, LIFECYCLE_STATES.MAINTENANCE, LIFECYCLE_STATES.RETIRED]),
  [LIFECYCLE_STATES.ACTIVE]:      new Set([LIFECYCLE_STATES.BUSY, LIFECYCLE_STATES.IDLE, LIFECYCLE_STATES.PAUSED, LIFECYCLE_STATES.MAINTENANCE]),
  [LIFECYCLE_STATES.BUSY]:        new Set([LIFECYCLE_STATES.ACTIVE, LIFECYCLE_STATES.PAUSED]),
  [LIFECYCLE_STATES.PAUSED]:      new Set([LIFECYCLE_STATES.ACTIVE, LIFECYCLE_STATES.IDLE, LIFECYCLE_STATES.MAINTENANCE]),
  [LIFECYCLE_STATES.STANDBY]:     new Set([LIFECYCLE_STATES.IDLE, LIFECYCLE_STATES.MAINTENANCE, LIFECYCLE_STATES.RETIRED]),
  [LIFECYCLE_STATES.MAINTENANCE]: new Set([LIFECYCLE_STATES.IDLE, LIFECYCLE_STATES.RETIRED]),
  [LIFECYCLE_STATES.RETIRED]:     new Set(),  // 终态，无出边 / Terminal state, no outgoing edges
});

/** 每个 agent 保留的最大历史记录数 / Max history entries per agent */
const MAX_HISTORY_PER_AGENT = 50;

/** 生命周期转换事件主题 / Lifecycle transition event topic */
const LIFECYCLE_TRANSITION_TOPIC = 'agent.lifecycle.transition';

// ============================================================================
// AgentLifecycle
// ============================================================================

export class AgentLifecycle {
  /**
   * @param {Object} deps
   * @param {Object} [deps.messageBus] - 消息总线实例 / MessageBus instance
   * @param {Object} [deps.agentRepo] - Agent 仓储 / Agent repository
   * @param {Object} [deps.logger] - 日志器 / Logger
   */
  constructor({ messageBus, agentRepo, logger } = {}) {
    this._messageBus = messageBus || null;
    this._agentRepo = agentRepo || null;
    this._logger = logger || console;

    /**
     * 内部状态存储 / Internal state storage
     * @type {Map<string, { state: string, lastTransition: number, history: Array }>}
     */
    this._agents = new Map();

    /** 转换统计 / Transition statistics */
    this._stats = {
      totalTransitions: 0,
      successfulTransitions: 0,
      rejectedTransitions: 0,
      /** @type {Record<string, number>} from→to 计数 / from→to counts */
      transitionCounts: {},
    };
  }

  // ━━━ 状态转换 / State Transition ━━━

  /**
   * 执行状态转换（含校验和事件发布）
   * Perform state transition (with validation and event publishing)
   *
   * @param {string} agentId - Agent 标识 / Agent identifier
   * @param {string} targetState - 目标状态 / Target state
   * @param {Object} [options]
   * @param {string} [options.reason] - 转换原因 / Transition reason
   * @returns {{ success: boolean, transitionId?: string, from?: string, to?: string, error?: string }}
   */
  transition(agentId, targetState, { reason } = {}) {
    this._stats.totalTransitions++;

    // 验证目标状态合法性 / Validate target state
    if (!LIFECYCLE_STATES[targetState]) {
      this._stats.rejectedTransitions++;
      const error = `无效的目标状态 / Invalid target state: ${targetState}`;
      this._logger.warn({ agentId, targetState }, error);
      return { success: false, error };
    }

    // 获取或初始化 agent 记录 / Get or initialize agent record
    const record = this._ensureRecord(agentId);
    const fromState = record.state;

    // 校验转换合法性 / Validate transition legality
    const allowed = TRANSITION_RULES[fromState];
    if (!allowed || !allowed.has(targetState)) {
      this._stats.rejectedTransitions++;
      const error = `非法转换 / Illegal transition: ${fromState} → ${targetState}`;
      this._logger.warn({ agentId, from: fromState, to: targetState }, error);
      return { success: false, error, from: fromState, to: targetState };
    }

    // 执行转换 / Execute transition
    const transitionId = nanoid(12);
    const timestamp = Date.now();

    record.state = targetState;
    record.lastTransition = timestamp;

    // 追加历史记录（保持上限）/ Append history (respect limit)
    const entry = {
      transitionId,
      from: fromState,
      to: targetState,
      reason: reason || null,
      timestamp,
    };
    record.history.push(entry);
    if (record.history.length > MAX_HISTORY_PER_AGENT) {
      record.history.splice(0, record.history.length - MAX_HISTORY_PER_AGENT);
    }

    // 更新统计 / Update statistics
    this._stats.successfulTransitions++;
    const countKey = `${fromState}→${targetState}`;
    this._stats.transitionCounts[countKey] = (this._stats.transitionCounts[countKey] || 0) + 1;

    this._logger.info(
      { agentId, from: fromState, to: targetState, transitionId, reason },
      `生命周期转换 / Lifecycle transition: ${fromState} → ${targetState}`
    );

    // 发布事件 / Publish event
    this._publishTransition({ agentId, from: fromState, to: targetState, reason, timestamp, transitionId });

    return { success: true, transitionId, from: fromState, to: targetState };
  }

  // ━━━ 状态查询 / State Query ━━━

  /**
   * 获取 agent 当前生命周期状态
   * Get agent's current lifecycle state
   *
   * @param {string} agentId
   * @returns {string} 当前状态 / Current state (LIFECYCLE_STATES value)
   */
  getState(agentId) {
    const record = this._agents.get(agentId);
    return record ? record.state : LIFECYCLE_STATES.INIT;
  }

  /**
   * 获取所有 agent 的状态映射
   * Get state map of all agents
   *
   * @returns {Map<string, string>} agentId → state
   */
  getAllStates() {
    const result = new Map();
    for (const [agentId, record] of this._agents) {
      result.set(agentId, record.state);
    }
    return result;
  }

  /**
   * 获取 agent 的转换历史
   * Get agent's transition history
   *
   * @param {string} agentId
   * @param {Object} [options]
   * @param {number} [options.limit=10] - 返回条数上限 / Max entries to return
   * @returns {Array<{ transitionId: string, from: string, to: string, reason: string|null, timestamp: number }>}
   */
  getTransitionHistory(agentId, { limit = 10 } = {}) {
    const record = this._agents.get(agentId);
    if (!record) return [];
    // 返回最近的 N 条（倒序切片再反转，保持时间正序）
    // Return most recent N entries (slice from end, keep chronological order)
    const start = Math.max(0, record.history.length - limit);
    return record.history.slice(start);
  }

  // ━━━ 转换检查 / Transition Check ━━━

  /**
   * 检查是否可以从当前状态转换到目标状态
   * Check if transition from current state to target is allowed
   *
   * @param {string} agentId
   * @param {string} targetState
   * @returns {boolean}
   */
  canTransition(agentId, targetState) {
    if (!LIFECYCLE_STATES[targetState]) return false;
    const currentState = this.getState(agentId);
    const allowed = TRANSITION_RULES[currentState];
    return allowed ? allowed.has(targetState) : false;
  }

  // ━━━ 统计 / Statistics ━━━

  /**
   * 获取转换统计信息
   * Get transition statistics
   *
   * @returns {{ totalTransitions: number, successfulTransitions: number, rejectedTransitions: number, transitionCounts: Record<string, number>, agentCount: number, stateDistribution: Record<string, number> }}
   */
  getStats() {
    // 计算状态分布 / Compute state distribution
    const stateDistribution = {};
    for (const state of Object.values(LIFECYCLE_STATES)) {
      stateDistribution[state] = 0;
    }
    for (const [, record] of this._agents) {
      stateDistribution[record.state] = (stateDistribution[record.state] || 0) + 1;
    }

    return {
      totalTransitions: this._stats.totalTransitions,
      successfulTransitions: this._stats.successfulTransitions,
      rejectedTransitions: this._stats.rejectedTransitions,
      transitionCounts: { ...this._stats.transitionCounts },
      agentCount: this._agents.size,
      stateDistribution,
    };
  }

  // ━━━ 内部方法 / Internal Methods ━━━

  /**
   * 确保 agent 记录存在（不存在则初始化为 INIT 状态）
   * Ensure agent record exists (initialize to INIT if missing)
   *
   * @param {string} agentId
   * @returns {{ state: string, lastTransition: number, history: Array }}
   * @private
   */
  _ensureRecord(agentId) {
    if (!this._agents.has(agentId)) {
      this._agents.set(agentId, {
        state: LIFECYCLE_STATES.INIT,
        lastTransition: Date.now(),
        history: [],
      });
    }
    return this._agents.get(agentId);
  }

  /**
   * 发布生命周期转换事件到消息总线
   * Publish lifecycle transition event to message bus
   *
   * @param {Object} data
   * @param {string} data.agentId
   * @param {string} data.from
   * @param {string} data.to
   * @param {string} [data.reason]
   * @param {number} data.timestamp
   * @param {string} data.transitionId
   * @private
   */
  _publishTransition({ agentId, from, to, reason, timestamp, transitionId }) {
    if (!this._messageBus) return;
    try {
      const payload = { agentId, from, to, reason: reason || null, timestamp, transitionId };
      this._messageBus.publish(
        LIFECYCLE_TRANSITION_TOPIC,
        wrapEvent(LIFECYCLE_TRANSITION_TOPIC, payload, SOURCE)
      );
    } catch { /* 事件发布失败不阻塞主流程 / Non-fatal: don't block main flow */ }
  }
}
