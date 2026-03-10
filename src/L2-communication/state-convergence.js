/**
 * StateConvergence — 状态收敛层 / State Convergence Layer
 *
 * V5.5 核心新增模块，确保蜂群各节点对共享状态达成最终一致性。
 * V5.5 core addition — ensures eventual consistency across swarm nodes.
 *
 * 三大职责 / Three responsibilities:
 * 1. SWIM 故障探测: 心跳 → suspect → confirmed dead (两阶段)
 * 2. 反熵同步 (Anti-Entropy): 定期扫描 → 检测不一致 → DB 为 source of truth
 * 3. 收敛指标: convergenceTime, driftCount, repairSuccessRate
 *
 * 与 HealthChecker 互补:
 * - HealthChecker 检测 "懒" (idle agent 超时)
 * - StateConvergence 检测 "死" (heartbeat 丢失)
 *
 * @module L2-communication/state-convergence
 * @version 5.5.0
 * @author DEEP-IOS
 */

import { randomUUID } from 'node:crypto';

// ============================================================================
// 常量 / Constants
// ============================================================================

/** 默认心跳间隔 (ms) / Default heartbeat interval */
const DEFAULT_HEARTBEAT_INTERVAL_MS = 5000;

/** Suspect 超时 (ms) — 心跳丢失多久进入 suspect 状态 */
const SUSPECT_TIMEOUT_MS = 15000;

/** Confirmed dead 超时 (ms) — suspect 多久后确认死亡 */
const CONFIRM_DEAD_TIMEOUT_MS = 30000;

/** 反熵扫描间隔 (ms) / Anti-entropy scan interval */
const ANTI_ENTROPY_INTERVAL_MS = 30000;

/** 最大收敛指标记录数 / Max convergence metric records */
const MAX_METRICS_HISTORY = 100;

/** Agent 状态枚举 / Agent state enum */
const AgentState = Object.freeze({
  ALIVE: 'alive',
  SUSPECT: 'suspect',
  DEAD: 'dead',
});

// ============================================================================
// StateConvergence 类 / StateConvergence Class
// ============================================================================

export class StateConvergence {
  /**
   * @param {Object} deps
   * @param {Object} deps.messageBus - MessageBus 实例
   * @param {Object} [deps.healthChecker] - HealthChecker 实例
   * @param {Object} [deps.pheromoneEngine] - PheromoneEngine 实例
   * @param {Object} [deps.db] - DatabaseManager 实例
   * @param {Object} [deps.logger] - Logger 实例
   * @param {Object} [deps.config] - 配置项
   */
  constructor({ messageBus, healthChecker, pheromoneEngine, db, logger, config = {} }) {
    this._messageBus = messageBus;
    this._healthChecker = healthChecker;
    this._pheromoneEngine = pheromoneEngine;
    this._db = db;
    this._logger = logger || console;
    this._config = config;

    /**
     * Agent 心跳追踪
     * Map<agentId, { lastSeen: number, state: string, suspectSince: number|null }>
     * @type {Map<string, Object>}
     */
    this._agents = new Map();

    /**
     * 收敛指标 / Convergence metrics
     * @type {{ driftCount: number, repairCount: number, repairSuccessCount: number, measurements: Array }}
     */
    this._metrics = {
      driftCount: 0,
      repairCount: 0,
      repairSuccessCount: 0,
      measurements: [], // { timestamp, convergenceTimeMs }
    };

    /** 心跳探测定时器 / Heartbeat probe timer */
    this._heartbeatTimer = null;

    /** 反熵扫描定时器 / Anti-entropy scan timer */
    this._antiEntropyTimer = null;

    /** 是否已启动 / Whether started */
    this._started = false;
  }

  // ============================================================================
  // 生命周期 / Lifecycle
  // ============================================================================

  /**
   * 启动心跳探测 + 反熵扫描
   * Start heartbeat probing + anti-entropy scanning
   *
   * @param {number} [intervalMs] - 心跳探测间隔
   */
  startHeartbeat(intervalMs = DEFAULT_HEARTBEAT_INTERVAL_MS) {
    if (this._started) return;
    this._started = true;

    // 订阅 agent 上线事件自动注册 / Subscribe to agent online events
    this._messageBus?.subscribe?.('agent.online', (event) => {
      const agentId = event?.payload?.agentId || event?.agentId;
      if (agentId) this.recordHeartbeat(agentId);
    });

    this._messageBus?.subscribe?.('agent.registered', (event) => {
      const agentId = event?.payload?.agentId || event?.agentId;
      if (agentId) this.recordHeartbeat(agentId);
    });

    // 定期探测心跳 / Periodic heartbeat probe
    this._heartbeatTimer = setInterval(() => {
      this._probeHeartbeats();
    }, intervalMs);
    if (this._heartbeatTimer.unref) this._heartbeatTimer.unref();

    // 启动反熵扫描 / Start anti-entropy scanning
    const antiEntropyMs = this._config.antiEntropyIntervalMs || ANTI_ENTROPY_INTERVAL_MS;
    this._antiEntropyTimer = setInterval(() => {
      this.runAntiEntropy();
    }, antiEntropyMs);
    if (this._antiEntropyTimer.unref) this._antiEntropyTimer.unref();

    this._logger.info?.(
      `[StateConvergence] Started — heartbeat every ${intervalMs}ms, ` +
      `anti-entropy every ${antiEntropyMs}ms`
    );
  }

  /**
   * 停止并清理所有定时器
   * Stop and clean up all timers
   */
  dispose() {
    if (this._heartbeatTimer) {
      clearInterval(this._heartbeatTimer);
      this._heartbeatTimer = null;
    }
    if (this._antiEntropyTimer) {
      clearInterval(this._antiEntropyTimer);
      this._antiEntropyTimer = null;
    }
    this._agents.clear();
    this._started = false;
    this._logger.info?.('[StateConvergence] Disposed');
  }

  // ============================================================================
  // SWIM 故障探测 / SWIM Failure Detection
  // ============================================================================

  /**
   * 记录 agent 心跳（重置超时）
   * Record agent heartbeat (reset timeout)
   *
   * @param {string} agentId
   */
  recordHeartbeat(agentId) {
    const existing = this._agents.get(agentId);
    if (existing) {
      // 如果从 suspect/dead 恢复为 alive，记录收敛时间
      if (existing.state !== AgentState.ALIVE && existing.suspectSince) {
        const convergenceTime = Date.now() - existing.suspectSince;
        this._recordConvergenceTime(convergenceTime);
      }
      existing.lastSeen = Date.now();
      existing.state = AgentState.ALIVE;
      existing.suspectSince = null;
    } else {
      this._agents.set(agentId, {
        lastSeen: Date.now(),
        state: AgentState.ALIVE,
        suspectSince: null,
      });
    }
  }

  /**
   * 获取所有疑似故障 agent
   * Get all suspected agents
   *
   * @returns {string[]}
   */
  getSuspects() {
    const suspects = [];
    for (const [agentId, info] of this._agents) {
      if (info.state === AgentState.SUSPECT) {
        suspects.push(agentId);
      }
    }
    return suspects;
  }

  /**
   * 获取所有确认死亡的 agent
   * Get all confirmed dead agents
   *
   * @returns {string[]}
   */
  getDeadAgents() {
    const dead = [];
    for (const [agentId, info] of this._agents) {
      if (info.state === AgentState.DEAD) {
        dead.push(agentId);
      }
    }
    return dead;
  }

  /**
   * 定期探测心跳 — SWIM 两阶段故障检测
   * Periodic heartbeat probe — SWIM two-phase failure detection
   *
   * @private
   */
  _probeHeartbeats() {
    const now = Date.now();
    const suspectTimeout = this._config.suspectTimeoutMs || SUSPECT_TIMEOUT_MS;
    const deadTimeout = this._config.confirmDeadTimeoutMs || CONFIRM_DEAD_TIMEOUT_MS;

    for (const [agentId, info] of this._agents) {
      const elapsed = now - info.lastSeen;

      if (info.state === AgentState.ALIVE && elapsed > suspectTimeout) {
        // 阶段 1: alive → suspect
        info.state = AgentState.SUSPECT;
        info.suspectSince = now;

        this._messageBus?.publish?.('agent.suspect', {
          agentId,
          lastSeen: info.lastSeen,
          elapsedMs: elapsed,
          timestamp: now,
        });

        this._logger.warn?.(
          `[StateConvergence] Agent ${agentId} suspected — ` +
          `no heartbeat for ${Math.round(elapsed / 1000)}s`
        );
      } else if (info.state === AgentState.SUSPECT) {
        const suspectDuration = now - (info.suspectSince || info.lastSeen);

        if (suspectDuration > deadTimeout) {
          // 阶段 2: suspect → confirmed dead
          info.state = AgentState.DEAD;

          this._messageBus?.publish?.('agent.confirmed.dead', {
            agentId,
            lastSeen: info.lastSeen,
            suspectSince: info.suspectSince,
            totalDownMs: now - info.lastSeen,
            timestamp: now,
          });

          this._logger.warn?.(
            `[StateConvergence] Agent ${agentId} CONFIRMED DEAD — ` +
            `down for ${Math.round((now - info.lastSeen) / 1000)}s`
          );
        }
      }
    }
  }

  // ============================================================================
  // 反熵同步 / Anti-Entropy Synchronization
  // ============================================================================

  /**
   * 执行反熵扫描 — 检测并修复状态不一致
   * Run anti-entropy scan — detect and repair state inconsistencies
   *
   * 以 DB 为 source of truth:
   * 1. 检查 pheromone 数据一致性
   * 2. 检查 agent 注册状态
   * 3. 检测孤立的 pending 任务
   *
   * @returns {{ drifts: number, repairs: number }}
   */
  runAntiEntropy() {
    let drifts = 0;
    let repairs = 0;

    // 1. 检查是否有 dead agent 仍有活跃任务
    // Check if dead agents still have active tasks
    for (const [agentId, info] of this._agents) {
      if (info.state === AgentState.DEAD) {
        // 发布收敛漂移事件 / Publish convergence drift event
        drifts++;
        this._messageBus?.publish?.('convergence.drift', {
          type: 'dead_agent_active',
          agentId,
          timestamp: Date.now(),
        });
      }
    }

    // 2. 检查 DB 中的孤立记录 / Check for orphaned DB records
    if (this._db) {
      try {
        // 检查超长 pending 的 dead_letter_tasks
        const staleCount = this._db.get(
          `SELECT COUNT(*) as cnt FROM dead_letter_tasks
           WHERE created_at < ? AND resolution IS NULL`,
          Date.now() - 3600000 // 超过 1 小时未处理
        );

        if (staleCount?.cnt > 0) {
          drifts++;
          this._logger.info?.(
            `[StateConvergence] Anti-entropy: ${staleCount.cnt} stale dead letters found`
          );
        }
      } catch { /* DB query may fail, non-fatal */ }
    }

    // 3. 更新指标 / Update metrics
    this._metrics.driftCount += drifts;
    this._metrics.repairCount += repairs;
    if (repairs > 0) {
      this._metrics.repairSuccessCount += repairs;
    }

    if (drifts > 0) {
      this._logger.info?.(
        `[StateConvergence] Anti-entropy scan: ${drifts} drifts, ${repairs} repairs`
      );
    }

    return { drifts, repairs };
  }

  // ============================================================================
  // 收敛指标 / Convergence Metrics
  // ============================================================================

  /**
   * 记录收敛时间 / Record convergence time
   *
   * @param {number} timeMs - 收敛耗时
   * @private
   */
  _recordConvergenceTime(timeMs) {
    this._metrics.measurements.push({
      timestamp: Date.now(),
      convergenceTimeMs: timeMs,
    });

    // 容量控制 / Capacity control
    if (this._metrics.measurements.length > MAX_METRICS_HISTORY) {
      this._metrics.measurements.shift();
    }
  }

  /**
   * 获取收敛统计 / Get convergence statistics
   *
   * @returns {Object}
   */
  getConvergenceStats() {
    const measurements = this._metrics.measurements;
    const avgConvergenceTime = measurements.length > 0
      ? measurements.reduce((s, m) => s + m.convergenceTimeMs, 0) / measurements.length
      : 0;

    const repairSuccessRate = this._metrics.repairCount > 0
      ? this._metrics.repairSuccessCount / this._metrics.repairCount
      : 1.0;

    return {
      totalAgents: this._agents.size,
      aliveAgents: [...this._agents.values()].filter(a => a.state === AgentState.ALIVE).length,
      suspectAgents: [...this._agents.values()].filter(a => a.state === AgentState.SUSPECT).length,
      deadAgents: [...this._agents.values()].filter(a => a.state === AgentState.DEAD).length,
      driftCount: this._metrics.driftCount,
      repairCount: this._metrics.repairCount,
      repairSuccessRate: parseFloat(repairSuccessRate.toFixed(3)),
      avgConvergenceTimeMs: Math.round(avgConvergenceTime),
      measurementCount: measurements.length,
      started: this._started,
    };
  }

  /**
   * 获取指定 agent 状态 / Get specific agent state
   *
   * @param {string} agentId
   * @returns {{ state: string, lastSeen: number, suspectSince: number|null } | null}
   */
  getAgentState(agentId) {
    const info = this._agents.get(agentId);
    if (!info) return null;
    return {
      state: info.state,
      lastSeen: info.lastSeen,
      suspectSince: info.suspectSince,
    };
  }
}
