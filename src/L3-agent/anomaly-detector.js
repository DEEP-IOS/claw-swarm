/**
 * AnomalyDetector — 负选择异常检测 / Negative Selection Anomaly Detection
 *
 * P2-3: 维护每个 agent 的"正常行为基线"（滑动窗口），
 * 当新结果偏离基线超过 σ 阈值时判定异常。
 * 可与 FailureVaccination 联动，查找已知免疫策略。
 *
 * P2-3: Maintains per-agent "normal behavior baseline" (rolling window).
 * When new results deviate beyond σ threshold from baseline, an anomaly
 * is detected. Integrates with FailureVaccination for known repair vaccines.
 *
 * 检测公式 / Detection formula:
 *   |value - mean| > sigmaThreshold × stdDev  →  anomaly
 *
 * @module L3-agent/anomaly-detector
 * @version 5.7.0
 * @author DEEP-IOS
 */

import { EventTopics, wrapEvent } from '../event-catalog.js';

// ============================================================================
// 常量 / Constants
// ============================================================================

/** 默认滑动窗口大小 / Default rolling window size */
const DEFAULT_WINDOW_SIZE = 20;

/** 默认标准差阈值 / Default sigma threshold for anomaly detection */
const DEFAULT_SIGMA_THRESHOLD = 2.0;

/** 默认最少样本数 / Default minimum samples before detection activates */
const DEFAULT_MIN_SAMPLES = 5;

/** 异常历史最大保留量 / Maximum anomaly history entries per agent */
const MAX_ANOMALY_HISTORY = 100;

/** 监控的指标列表 / Tracked metric names */
const TRACKED_METRICS = ['latencyMs', 'quality', 'tokenCount'];

const SOURCE = 'anomaly-detector';

// ============================================================================
// CircularBuffer — 固定大小环形缓冲区 / Fixed-size Circular Buffer
// ============================================================================

/**
 * 简单环形缓冲区，超出 maxSize 后覆盖最旧条目
 * Simple circular buffer that overwrites oldest entries when full
 */
class CircularBuffer {
  /**
   * @param {number} maxSize - 缓冲区最大容量 / Maximum capacity
   */
  constructor(maxSize) {
    /** @private */
    this._buffer = new Array(maxSize);
    /** @private */
    this._maxSize = maxSize;
    /** @private 下一个写入位置 / Next write position */
    this._pointer = 0;
    /** @private 已存储的元素数 / Number of stored elements */
    this._count = 0;
  }

  /**
   * 推入新元素 / Push a new element
   * @param {*} item
   */
  push(item) {
    this._buffer[this._pointer] = item;
    this._pointer = (this._pointer + 1) % this._maxSize;
    if (this._count < this._maxSize) this._count++;
  }

  /**
   * 获取所有有效元素（按插入顺序）
   * Get all valid elements in insertion order
   * @returns {Array}
   */
  toArray() {
    if (this._count < this._maxSize) {
      return this._buffer.slice(0, this._count);
    }
    // 环形: pointer 之后是最旧的 / Circular: after pointer is oldest
    return [
      ...this._buffer.slice(this._pointer),
      ...this._buffer.slice(0, this._pointer),
    ];
  }

  /** 已存储元素数 / Number of stored elements */
  get size() {
    return this._count;
  }
}

// ============================================================================
// 统计工具 / Statistical Utilities
// ============================================================================

/**
 * 计算数组的均值和标准差 / Compute mean and standard deviation
 *
 * @param {number[]} values
 * @returns {{ mean: number, stdDev: number }}
 */
function computeStats(values) {
  if (values.length === 0) return { mean: 0, stdDev: 0 };

  const n = values.length;
  const mean = values.reduce((sum, v) => sum + v, 0) / n;

  if (n < 2) return { mean, stdDev: 0 };

  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (n - 1);
  const stdDev = Math.sqrt(variance);

  return { mean, stdDev };
}

// ============================================================================
// AnomalyDetector
// ============================================================================

export class AnomalyDetector {
  /**
   * @param {Object} deps - 依赖注入 / Dependency injection
   * @param {Object} [deps.messageBus] - 消息总线 / Message bus for event publishing
   * @param {Object} [deps.failureVaccination] - 免疫记忆库 / FailureVaccination instance
   * @param {Object} [deps.logger] - 日志器 / Logger
   * @param {Object} [deps.config] - 配置 / Configuration overrides
   * @param {number} [deps.config.windowSize=20] - 滑动窗口大小 / Rolling window size
   * @param {number} [deps.config.sigmaThreshold=2.0] - σ 阈值 / Standard deviations for anomaly
   * @param {number} [deps.config.minSamples=5] - 最小样本数 / Minimum samples before detection
   */
  constructor({ messageBus, failureVaccination, logger, config = {} } = {}) {
    /** @private */
    this._messageBus = messageBus || null;
    /** @private */
    this._failureVaccination = failureVaccination || null;
    /** @private */
    this._logger = logger || console;

    /** @private 滑动窗口大小 / Rolling window size */
    this._windowSize = config.windowSize ?? DEFAULT_WINDOW_SIZE;
    /** @private σ 阈值 / Sigma threshold */
    this._sigmaThreshold = config.sigmaThreshold ?? DEFAULT_SIGMA_THRESHOLD;
    /** @private 最小样本数 / Minimum samples */
    this._minSamples = config.minSamples ?? DEFAULT_MIN_SAMPLES;

    /**
     * 每个 agent 的状态 / Per-agent state
     * @private
     * @type {Map<string, { window: CircularBuffer, anomalies: Array }>}
     */
    this._agents = new Map();

    /** @private 全局统计 / Global stats */
    this._stats = {
      totalRecords: 0,
      totalAnomalies: 0,
      agentsTracked: 0,
    };
  }

  // ━━━ 结果记录 / Result Recording ━━━

  /**
   * 记录任务结果并自动检测异常
   * Record a task result and automatically check for anomalies
   *
   * @param {string} agentId - Agent 标识 / Agent identifier
   * @param {Object} result - 任务结果指标 / Task result metrics
   * @param {number} [result.latencyMs] - 执行延迟（毫秒）/ Execution latency in ms
   * @param {number} [result.quality] - 质量评分 0-1 / Quality score 0-1
   * @param {number} [result.tokenCount] - Token 消耗 / Token usage
   * @param {string} [result.taskType] - 任务类型 / Task type
   * @returns {{ anomalies: Array<Object> }} 检测到的异常列表 / Detected anomalies
   */
  recordResult(agentId, { latencyMs, quality, tokenCount, taskType } = {}) {
    const state = this._ensureAgentState(agentId);
    const metrics = { latencyMs, quality, tokenCount };
    const timestamp = Date.now();

    // 推入环形缓冲区 / Push into circular buffer
    state.window.push({ ...metrics, taskType, timestamp });
    this._stats.totalRecords++;

    // 样本不足时跳过检测 / Skip detection if insufficient samples
    if (state.window.size < this._minSamples) {
      return { anomalies: [] };
    }

    // 逐指标检测异常 / Check each metric for anomalies
    const detected = [];
    for (const metricName of TRACKED_METRICS) {
      const value = metrics[metricName];
      if (value === undefined || value === null) continue;

      const anomaly = this._checkMetricAnomaly(agentId, state, metricName, value, taskType);
      if (anomaly) {
        detected.push(anomaly);
      }
    }

    return { anomalies: detected };
  }

  // ━━━ 基线查询 / Baseline Query ━━━

  /**
   * 获取 agent 当前各指标的基线统计
   * Get current baseline stats for each metric of an agent
   *
   * @param {string} agentId
   * @returns {Record<string, { mean: number, stdDev: number }>} 各指标的均值和标准差
   */
  getBaseline(agentId) {
    const state = this._agents.get(agentId);
    if (!state) return {};

    const entries = state.window.toArray();
    const result = {};

    for (const metricName of TRACKED_METRICS) {
      const values = entries
        .map(e => e[metricName])
        .filter(v => v !== undefined && v !== null);

      if (values.length > 0) {
        const { mean, stdDev } = computeStats(values);
        result[metricName] = {
          mean: Math.round(mean * 1000) / 1000,
          stdDev: Math.round(stdDev * 1000) / 1000,
        };
      }
    }

    return result;
  }

  // ━━━ 手动异常检查 / Manual Anomaly Check ━━━

  /**
   * 手动检查指标是否偏离基线
   * Manually check if metrics deviate from baseline
   *
   * @param {string} agentId
   * @param {Object} metrics - 待检查的指标 / Metrics to check
   * @param {number} [metrics.latencyMs]
   * @param {number} [metrics.quality]
   * @param {number} [metrics.tokenCount]
   * @returns {{ isAnomaly: boolean, details: Array<Object> }}
   */
  checkAnomaly(agentId, metrics) {
    const state = this._agents.get(agentId);
    if (!state || state.window.size < this._minSamples) {
      return { isAnomaly: false, details: [] };
    }

    const details = [];
    for (const metricName of TRACKED_METRICS) {
      const value = metrics[metricName];
      if (value === undefined || value === null) continue;

      const entries = state.window.toArray();
      const values = entries
        .map(e => e[metricName])
        .filter(v => v !== undefined && v !== null);

      if (values.length < this._minSamples) continue;

      const { mean, stdDev } = computeStats(values);
      const deviation = Math.abs(value - mean);

      if (stdDev > 0 && deviation > this._sigmaThreshold * stdDev) {
        details.push({
          metric: metricName,
          value,
          mean: Math.round(mean * 1000) / 1000,
          stdDev: Math.round(stdDev * 1000) / 1000,
          deviation: Math.round(deviation * 1000) / 1000,
          sigmas: Math.round((deviation / stdDev) * 100) / 100,
        });
      }
    }

    return {
      isAnomaly: details.length > 0,
      details,
    };
  }

  // ━━━ 异常历史 / Anomaly History ━━━

  /**
   * 获取 agent 的近期异常记录
   * Get recent anomaly records for an agent
   *
   * @param {string} agentId
   * @param {Object} [options]
   * @param {number} [options.limit=10] - 最多返回条数 / Maximum entries to return
   * @returns {Array<Object>}
   */
  getAnomalyHistory(agentId, { limit = 10 } = {}) {
    const state = this._agents.get(agentId);
    if (!state) return [];

    // 最新的在前 / Most recent first
    return state.anomalies.slice(-limit).reverse();
  }

  // ━━━ 全局统计 / Global Stats ━━━

  /**
   * 获取全局统计信息
   * Get global anomaly detection statistics
   *
   * @returns {Object}
   */
  getStats() {
    return {
      ...this._stats,
      agentsTracked: this._agents.size,
    };
  }

  // ━━━ 内部方法 / Internal Methods ━━━

  /**
   * 确保 agent 状态已初始化 / Ensure agent state is initialized
   *
   * @param {string} agentId
   * @returns {{ window: CircularBuffer, anomalies: Array }}
   * @private
   */
  _ensureAgentState(agentId) {
    if (!this._agents.has(agentId)) {
      this._agents.set(agentId, {
        window: new CircularBuffer(this._windowSize),
        anomalies: [],
      });
    }
    return this._agents.get(agentId);
  }

  /**
   * 检查单个指标是否异常
   * Check if a single metric is anomalous
   *
   * @param {string} agentId
   * @param {Object} state - Agent 状态 / Agent state
   * @param {string} metricName - 指标名 / Metric name
   * @param {number} value - 当前值 / Current value
   * @param {string} [taskType] - 任务类型 / Task type
   * @returns {Object|null} 异常记录或 null / Anomaly record or null
   * @private
   */
  _checkMetricAnomaly(agentId, state, metricName, value, taskType) {
    const entries = state.window.toArray();
    // 排除最新推入的条目（它已在窗口中）/ Exclude the just-pushed entry
    const historical = entries.slice(0, -1);

    const values = historical
      .map(e => e[metricName])
      .filter(v => v !== undefined && v !== null);

    if (values.length < this._minSamples) return null;

    const { mean, stdDev } = computeStats(values);
    const deviation = Math.abs(value - mean);

    // stdDev 为 0 表示所有值相同，任何不同值视为异常
    // stdDev of 0 means all identical; any different value is anomalous
    if (stdDev === 0) {
      if (deviation === 0) return null;
      // 值不同但 stdDev 为 0 → 异常 / Different value with zero stdDev → anomaly
    } else if (deviation <= this._sigmaThreshold * stdDev) {
      return null;
    }

    const sigmas = stdDev > 0 ? Math.round((deviation / stdDev) * 100) / 100 : Infinity;

    const anomaly = {
      agentId,
      metric: metricName,
      value,
      mean: Math.round(mean * 1000) / 1000,
      stdDev: Math.round(stdDev * 1000) / 1000,
      deviation: Math.round(deviation * 1000) / 1000,
      sigmas,
      taskType: taskType || null,
      timestamp: Date.now(),
    };

    // 1. 发布异常事件 / Publish anomaly event
    this._publish(EventTopics.AGENT_SUSPECT, {
      agentId,
      metric: metricName,
      value,
      mean: anomaly.mean,
      stdDev: anomaly.stdDev,
      deviation: anomaly.deviation,
      sigmas,
    });

    // 2. 查找已知免疫策略 / Look up known vaccines
    if (this._failureVaccination && taskType) {
      try {
        const vaccines = this._failureVaccination.findSimilar(taskType);
        if (vaccines.length > 0) {
          anomaly.vaccines = vaccines;
          this._logger.debug?.(
            { agentId, metricName, vaccineCount: vaccines.length },
            'found vaccines for anomaly / 找到异常相关的免疫策略'
          );
        }
      } catch { /* 忽略疫苗查找错误 / Ignore vaccine lookup errors */ }
    }

    // 3. 记录异常历史 / Record in anomaly history
    state.anomalies.push(anomaly);
    if (state.anomalies.length > MAX_ANOMALY_HISTORY) {
      state.anomalies.splice(0, state.anomalies.length - MAX_ANOMALY_HISTORY);
    }
    this._stats.totalAnomalies++;

    this._logger.info?.(
      { agentId, metric: metricName, value, mean: anomaly.mean, sigmas },
      'anomaly detected / 检测到异常'
    );

    return anomaly;
  }

  /**
   * 发布事件到 MessageBus / Publish event to MessageBus
   *
   * @param {string} topic
   * @param {Object} payload
   * @private
   */
  _publish(topic, payload) {
    if (this._messageBus) {
      try {
        this._messageBus.publish(topic, wrapEvent(topic, payload, SOURCE));
      } catch { /* 忽略发布错误 / Ignore publish errors */ }
    }
  }
}
