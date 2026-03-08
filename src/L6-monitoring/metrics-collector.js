/**
 * MetricsCollector -- 指标收集器 / Metrics Collector
 *
 * V5.0 L6 监控层: 聚合 RED 指标 (Rate/Error/Duration) + 蜂群特定指标。
 * V5.0 L6 Monitoring Layer: aggregates RED metrics (Rate/Error/Duration)
 * plus swarm-specific metrics via MessageBus subscriptions.
 *
 * @module L6-monitoring/metrics-collector
 * @author DEEP-IOS
 */

// ============================================================================
// 常量 / Constants
// ============================================================================

/** 默认时间窗口 (ms) / Default time window (ms) */
const DEFAULT_WINDOW_MS = 5 * 60 * 1000;

/** 指标桶间隔 (ms) / Metric bucket interval */
const BUCKET_INTERVAL_MS = 5000;

// ============================================================================
// MetricsCollector 类 / MetricsCollector Class
// ============================================================================

export class MetricsCollector {
  /**
   * @param {Object} deps
   * @param {import('../L2-communication/message-bus.js').MessageBus} deps.messageBus
   * @param {Object} [deps.logger]
   * @param {number} [deps.windowMs] - 滚动窗口大小 / Rolling window size
   */
  constructor({ messageBus, logger, windowMs }) {
    this._messageBus = messageBus;
    this._logger = logger || console;
    this._windowMs = windowMs || DEFAULT_WINDOW_MS;

    /** @type {Function[]} 取消订阅列表 / Unsubscribe list */
    this._subscriptions = [];

    /** @type {boolean} */
    this._running = false;

    // ── RED 指标 / RED metrics ───────────────────────────
    /** @type {number} 总请求数 / Total requests */
    this._totalRequests = 0;
    /** @type {number} 总错误数 / Total errors */
    this._totalErrors = 0;
    /** @type {number[]} 响应时间列表 / Duration samples */
    this._durations = [];

    // ── 蜂群指标 / Swarm metrics ────────────────────────
    /** @type {number} 代理事件计数 / Agent event count */
    this._agentEvents = 0;
    /** @type {number} 任务完成数 / Tasks completed */
    this._tasksCompleted = 0;
    /** @type {number} 任务失败数 / Tasks failed */
    this._tasksFailed = 0;
    /** @type {number} 信息素事件 / Pheromone events */
    this._pheromoneEvents = 0;
    /** @type {number} 记忆事件 / Memory events */
    this._memoryEvents = 0;
    /** @type {number} 质量事件 / Quality events */
    this._qualityEvents = 0;

    // ── 时间序列 / Time series ──────────────────────────
    /** @type {Map<string, Array<{ timestamp: number, value: number }>>} */
    this._timeSeries = new Map();
  }

  // ━━━ 生命周期 / Lifecycle ━━━

  /**
   * 启动指标收集 (订阅 MessageBus 主题)
   * Start metrics collection (subscribe to MessageBus topics)
   */
  start() {
    if (this._running) return;

    const topics = ['task.*', 'agent.*', 'pheromone.*', 'quality.*', 'memory.*'];

    for (const topic of topics) {
      const unsub = this._messageBus.subscribe(topic, (msg) => this._onMessage(topic, msg));
      this._subscriptions.push(unsub);
    }

    this._running = true;
    this._logger.info?.('[MetricsCollector] 指标收集已启动 / Metrics collection started');
  }

  /**
   * 停止指标收集
   * Stop metrics collection
   */
  stop() {
    if (!this._running) return;

    for (const unsub of this._subscriptions) {
      try { unsub(); } catch { /* 忽略 / ignore */ }
    }
    this._subscriptions = [];
    this._running = false;
    this._logger.info?.('[MetricsCollector] 指标收集已停止 / Metrics collection stopped');
  }

  /**
   * 销毁: 停止 + 重置
   * Destroy: stop + reset
   */
  destroy() {
    this.stop();
    this.reset();
  }

  // ━━━ 手动记录 / Manual Recording ━━━

  /**
   * 手动记录一条指标
   * Manually record a metric
   *
   * @param {string} name - 指标名称 / Metric name
   * @param {number} value - 指标值 / Metric value
   * @param {Object} [tags] - 标签 / Tags
   */
  recordMetric(name, value, tags = {}) {
    this._totalRequests++;

    if (tags.error) this._totalErrors++;
    if (tags.duration) this._durations.push(tags.duration);

    // 追加到时间序列 / Append to time series
    this._appendTimeSeries(name, value);
  }

  // ━━━ 查询 / Queries ━━━

  /**
   * 获取当前指标快照
   * Get current metrics snapshot
   *
   * @returns {{ red: Object, swarm: Object, timestamp: number }}
   */
  getSnapshot() {
    const now = Date.now();
    const windowStart = now - this._windowMs;

    // 过滤窗口内的时间 / Filter durations within window
    const recentDurations = this._durations.slice(-100);
    const avgDuration = recentDurations.length > 0
      ? recentDurations.reduce((a, b) => a + b, 0) / recentDurations.length
      : 0;

    const errorRate = this._totalRequests > 0
      ? this._totalErrors / this._totalRequests
      : 0;

    return {
      timestamp: now,
      red: {
        rate: this._totalRequests,
        errorRate: Math.round(errorRate * 10000) / 10000,
        avgDuration: Math.round(avgDuration * 100) / 100,
      },
      swarm: {
        agentEvents: this._agentEvents,
        tasksCompleted: this._tasksCompleted,
        tasksFailed: this._tasksFailed,
        pheromoneEvents: this._pheromoneEvents,
        memoryEvents: this._memoryEvents,
        qualityEvents: this._qualityEvents,
      },
    };
  }

  /**
   * 获取指定指标的时间序列
   * Get time series for a specific metric
   *
   * @param {string} metricName
   * @param {number} [windowMs] - 时间窗口 / Time window
   * @returns {Array<{ timestamp: number, value: number }>}
   */
  getTimeSeries(metricName, windowMs) {
    const series = this._timeSeries.get(metricName) || [];
    if (!windowMs) return [...series];

    const cutoff = Date.now() - windowMs;
    return series.filter((s) => s.timestamp >= cutoff);
  }

  /**
   * 重置所有指标
   * Reset all metrics
   */
  reset() {
    this._totalRequests = 0;
    this._totalErrors = 0;
    this._durations = [];
    this._agentEvents = 0;
    this._tasksCompleted = 0;
    this._tasksFailed = 0;
    this._pheromoneEvents = 0;
    this._memoryEvents = 0;
    this._qualityEvents = 0;
    this._timeSeries.clear();
    this._logger.debug?.('[MetricsCollector] 已重置 / Reset');
  }

  /**
   * 获取收集器统计
   * Get collector stats
   *
   * @returns {Object}
   */
  getStats() {
    return {
      running: this._running,
      totalRequests: this._totalRequests,
      totalErrors: this._totalErrors,
      subscriptionCount: this._subscriptions.length,
      timeSeriesKeys: [...this._timeSeries.keys()],
    };
  }

  // ━━━ 内部 / Internal ━━━

  /**
   * 处理 MessageBus 消息
   * Handle MessageBus message
   *
   * @param {string} topicPattern
   * @param {Object} msg
   * @private
   */
  _onMessage(topicPattern, msg) {
    this._totalRequests++;
    const topic = msg.topic || topicPattern;

    if (topic.startsWith('task.')) {
      if (topic.includes('complete') || topic.includes('success')) this._tasksCompleted++;
      if (topic.includes('fail') || topic.includes('error')) { this._tasksFailed++; this._totalErrors++; }
      this._appendTimeSeries('tasks', 1);
    } else if (topic.startsWith('agent.')) {
      this._agentEvents++;
      this._appendTimeSeries('agents', 1);
    } else if (topic.startsWith('pheromone.')) {
      this._pheromoneEvents++;
      this._appendTimeSeries('pheromones', 1);
    } else if (topic.startsWith('quality.')) {
      this._qualityEvents++;
      this._appendTimeSeries('quality', 1);
    } else if (topic.startsWith('memory.')) {
      this._memoryEvents++;
      this._appendTimeSeries('memory', 1);
    }

    // 如果消息包含 duration, 记录 / If message has duration, record it
    if (msg.data?.duration) {
      this._durations.push(msg.data.duration);
    }
  }

  /**
   * 追加时间序列数据点
   * Append time series data point
   *
   * @param {string} name
   * @param {number} value
   * @private
   */
  _appendTimeSeries(name, value) {
    if (!this._timeSeries.has(name)) {
      this._timeSeries.set(name, []);
    }
    const series = this._timeSeries.get(name);
    series.push({ timestamp: Date.now(), value });

    // 裁剪超出窗口的数据 / Trim data outside window
    const cutoff = Date.now() - this._windowMs;
    while (series.length > 0 && series[0].timestamp < cutoff) {
      series.shift();
    }
  }
}
