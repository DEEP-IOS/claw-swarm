/**
 * Claw-Swarm V5.1 — 事件驱动健康检查器 / Event-Driven Health Checker
 *
 * 双模式检测: 事件驱动（主）+ 定期轮询（辅）
 * Dual-mode detection: event-driven (primary) + periodic polling (secondary)
 *
 * 健康评分 0-100，通过 MessageBus 发布 system.health 事件。
 * 各模块自主订阅并自我调节（观察者模式，不违反分层架构）。
 *
 * @module health-checker
 * @version 5.1.0
 */

import { EventTopics, wrapEvent } from '../event-catalog.js';

// ============================================================================
// 常量 / Constants
// ============================================================================

const SOURCE = 'health-checker';

/** 各检查维度权重 / Check dimension weights */
const WEIGHTS = {
  connectivity: 0.25,
  latency: 0.20,
  errorRate: 0.25,
  resource: 0.15,
  dependency: 0.15,
};

/** 最大工具调用耗时记录数 / Max tool call latency records */
const MAX_LATENCY_RECORDS = 100;

/** 自适应轮询间隔 / Adaptive polling intervals (ms) */
const POLL_INTERVALS = {
  healthy: 60000,   // 评分 > 90
  degraded: 30000,  // 评分 70-90
  critical: 10000,  // 评分 < 70
};

// ============================================================================
// HealthChecker
// ============================================================================

export class HealthChecker {
  /**
   * @param {Object} options
   * @param {Object} options.messageBus - MessageBus 实例
   * @param {Object} options.logger
   * @param {Object} [options.pluginAdapter] - PluginAdapter 实例（用于 DB 检查）
   */
  constructor({ messageBus, logger, pluginAdapter }) {
    this._messageBus = messageBus;
    this._logger = logger;
    this._pluginAdapter = pluginAdapter;

    /** @type {number} 当前健康评分 0-100 */
    this._score = 100;

    /** @type {number[]} 最近工具调用耗时 (ms) */
    this._latencies = [];

    /** @type {Map<string, string>} agent 连接状态 */
    this._connectionStatus = new Map();

    /** @type {number} 断路器 OPEN 计数 */
    this._openCircuitBreakers = 0;

    /** @type {number} 最近错误计数 */
    this._recentErrors = 0;

    /** @type {NodeJS.Timeout|null} 轮询定时器 */
    this._pollTimer = null;

    /** @type {boolean} 是否已启动 */
    this._started = false;

    // V5.2: Agent 空闲检测 / Agent idle detection
    /** @type {Map<string, number>} agent 最后活动时间 / Agent last activity time */
    this._lastActivity = new Map();
    /** @type {number} 空闲阈值 (ms, 默认 5 分钟) / Idle threshold (ms, default 5 min) */
    this._idleThresholdMs = 5 * 60 * 1000;
    /** @type {NodeJS.Timeout|null} 空闲检测定时器 / Idle detection timer */
    this._idleTimer = null;
  }

  /**
   * 启动健康检查
   * Start health checking (subscribe to events + start polling)
   */
  start() {
    if (this._started) return;
    this._started = true;

    // ── 事件驱动订阅（主模式） / Event-driven subscriptions (primary mode) ──
    this._messageBus.subscribe?.('system.error', (event) => {
      this._recentErrors++;
      this._recalculate();
    });

    this._messageBus.subscribe?.('tool.failure', (event) => {
      this._recentErrors++;
      this._recalculate();
    });

    this._messageBus.subscribe?.('agent.offline', (event) => {
      const agentId = event?.payload?.agentId || event?.agentId;
      if (agentId) {
        this._connectionStatus.set(agentId, 'offline');
        this._recalculate();
      }
    });

    this._messageBus.subscribe?.('agent.registered', (event) => {
      const agentId = event?.payload?.agentId || event?.agentId;
      if (agentId) {
        this._connectionStatus.set(agentId, 'online');
      }
    });

    // V5.2: Agent 活动追踪 / Agent activity tracking
    this._messageBus.subscribe?.('task.completed', (event) => {
      const agentId = event?.payload?.agentId || event?.agentId;
      if (agentId) this._lastActivity.set(agentId, Date.now());
    });

    this._messageBus.subscribe?.('task.assigned', (event) => {
      const agentId = event?.payload?.agentId || event?.agentId;
      if (agentId) this._lastActivity.set(agentId, Date.now());
    });

    // V5.2: 空闲检测定时器 / Idle detection timer
    this._idleTimer = setInterval(() => {
      this._detectIdleAgents();
    }, 60000);
    if (this._idleTimer.unref) this._idleTimer.unref();

    // ── 轮询（辅模式） / Polling (secondary mode) ──
    this._schedulePoll();

    this._logger.info?.('[HealthChecker] Started — event-driven + adaptive polling + idle detection');
  }

  /**
   * 停止健康检查
   * Stop health checking
   */
  stop() {
    if (!this._started) return;
    this._started = false;

    if (this._pollTimer) {
      clearTimeout(this._pollTimer);
      this._pollTimer = null;
    }

    // V5.2: 停止空闲检测 / Stop idle detection
    if (this._idleTimer) {
      clearInterval(this._idleTimer);
      this._idleTimer = null;
    }

    this._logger.info?.('[HealthChecker] Stopped');
  }

  /**
   * 记录工具调用耗时
   * Record a tool call latency
   *
   * @param {number} latencyMs
   */
  recordLatency(latencyMs) {
    this._latencies.push(latencyMs);
    if (this._latencies.length > MAX_LATENCY_RECORDS) {
      this._latencies.shift();
    }
  }

  /**
   * 获取当前健康评分
   * Get current health score
   *
   * @returns {number} 0-100
   */
  getScore() {
    return this._score;
  }

  // ── 内部方法 / Internal methods ──────────────────────────────────────

  /**
   * 重算健康评分并广播
   * Recalculate health score and broadcast
   * @private
   */
  _recalculate() {
    const scores = {};

    // 1. 连接性 / Connectivity
    const totalAgents = this._connectionStatus.size || 1;
    const onlineAgents = [...this._connectionStatus.values()].filter(s => s === 'online').length;
    scores.connectivity = (onlineAgents / totalAgents) * 100;

    // 2. 延迟 / Latency
    if (this._latencies.length > 0) {
      const avgLatency = this._latencies.reduce((a, b) => a + b, 0) / this._latencies.length;
      // 1s 以下 = 100分，10s 以上 = 0分，线性插值
      scores.latency = Math.max(0, Math.min(100, 100 - ((avgLatency - 1000) / 9000) * 100));
    } else {
      scores.latency = 100; // 无数据时默认满分
    }

    // 3. 错误率 / Error rate
    // 每分钟内 0 错误 = 100分，5+ 错误 = 0分
    scores.errorRate = Math.max(0, 100 - this._recentErrors * 20);

    // 4. 资源 / Resources
    try {
      const mem = process.memoryUsage();
      const heapUsedMB = mem.heapUsed / 1024 / 1024;
      // < 256MB = 100分，> 1024MB = 0分
      scores.resource = Math.max(0, Math.min(100, 100 - ((heapUsedMB - 256) / 768) * 100));
    } catch {
      scores.resource = 80;
    }

    // 5. 依赖 / Dependencies
    let depScore = 100;
    if (this._pluginAdapter) {
      const health = this._pluginAdapter.healthCheck();
      if (!health.dbReachable) depScore -= 40;
      if (!health.messageBusActive) depScore -= 30;
      if (!health.initialized) depScore -= 30;
    }
    scores.dependency = Math.max(0, depScore);

    // 加权汇总 / Weighted sum
    this._score = Math.round(
      WEIGHTS.connectivity * scores.connectivity +
      WEIGHTS.latency * scores.latency +
      WEIGHTS.errorRate * scores.errorRate +
      WEIGHTS.resource * scores.resource +
      WEIGHTS.dependency * scores.dependency
    );

    // 衰减错误计数（每次计算后减半，模拟时间窗口）
    // Decay error count (halve after each calculation, simulates time window)
    this._recentErrors = Math.max(0, Math.floor(this._recentErrors * 0.5));

    // 发布健康事件 / Publish health event
    const healthEvent = wrapEvent(
      EventTopics.SYSTEM_HEALTH,
      {
        score: this._score,
        dimensions: scores,
        timestamp: Date.now(),
      },
      SOURCE
    );
    this._messageBus.publish?.(EventTopics.SYSTEM_HEALTH, healthEvent);
  }

  /**
   * 调度下一次轮询（自适应间隔）
   * Schedule next poll (adaptive interval)
   * @private
   */
  _schedulePoll() {
    if (!this._started) return;

    let interval;
    if (this._score > 90) {
      interval = POLL_INTERVALS.healthy;
    } else if (this._score >= 70) {
      interval = POLL_INTERVALS.degraded;
    } else {
      interval = POLL_INTERVALS.critical;
    }

    this._pollTimer = setTimeout(() => {
      this._recalculate();
      this._schedulePoll();
    }, interval);

    if (this._pollTimer.unref) this._pollTimer.unref();
  }

  /**
   * V5.2: 检测空闲 Agent 并发出 recruit 信号
   * Detect idle agents and emit recruit pheromone signals
   * @private
   */
  _detectIdleAgents() {
    const now = Date.now();
    const idleAgents = [];

    for (const [agentId, status] of this._connectionStatus) {
      if (status !== 'online') continue;

      const lastActive = this._lastActivity.get(agentId) || 0;
      if (lastActive > 0 && (now - lastActive) > this._idleThresholdMs) {
        idleAgents.push(agentId);
      }
    }

    if (idleAgents.length > 0) {
      // 发布 recruit 信号给空闲 agent / Emit recruit signal for idle agents
      this._messageBus.publish?.(
        EventTopics.PHEROMONE_DEPOSITED || 'pheromone.deposited',
        wrapEvent(EventTopics.PHEROMONE_DEPOSITED || 'pheromone.deposited', {
          type: 'recruit',
          targetAgents: idleAgents,
          reason: 'idle_detection',
          idleCount: idleAgents.length,
        }, SOURCE)
      );

      this._logger.info?.(
        `[HealthChecker] Idle detection: ${idleAgents.length} agent(s) idle > ${this._idleThresholdMs / 1000}s`
      );
    }
  }

  /**
   * V5.2: 记录 Agent 活动
   * Record agent activity timestamp
   *
   * @param {string} agentId
   */
  recordActivity(agentId) {
    if (agentId) {
      this._lastActivity.set(agentId, Date.now());
    }
  }

  /**
   * V5.2: 获取空闲 Agent 列表
   * Get list of idle agents
   *
   * @returns {string[]}
   */
  getIdleAgents() {
    const now = Date.now();
    const idle = [];
    for (const [agentId, status] of this._connectionStatus) {
      if (status !== 'online') continue;
      const lastActive = this._lastActivity.get(agentId) || 0;
      if (lastActive > 0 && (now - lastActive) > this._idleThresholdMs) {
        idle.push(agentId);
      }
    }
    return idle;
  }
}
