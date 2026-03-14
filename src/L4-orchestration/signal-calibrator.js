/**
 * SignalCalibrator — 互信息信号自校准 / Mutual Information Signal Auto-Calibration
 *
 * V6.0 新增模块: 基于互信息 (MI) 自动校准 SwarmAdvisor 信号权重。
 * V6.0 new module: Automatically calibrates SwarmAdvisor signal weights using MI.
 *
 * MI(X;Y) = Σ Σ p(x,y) × log[p(x,y) / (p(x)×p(y))]
 *
 * 三阶段渐进策略 / Three-phase progressive strategy:
 *   Phase 1 (turn < 200): 手动权重, 仅收集样本
 *   Phase 2 (200 ≤ turn < 500): 保守混合 (0.7×manual + 0.3×MI)
 *   Phase 3 (turn ≥ 500): 完全 MI 自校准
 *
 * @module L4-orchestration/signal-calibrator
 * @author DEEP-IOS
 */

import { EventTopics, wrapEvent } from '../event-catalog.js';

// ============================================================================
// 默认配置 / Default Configuration
// ============================================================================

const DEFAULT_CONFIG = {
  enabled: true,
  minSamples: 200,
  stableSamples: 500,
  calibrationIntervalTurns: 100,
  floor: 0.03,
  cap: 0.40,
  mixingRatio: 0.3,
  bins: 10,
};

// V5.7 手动权重基线 / V5.7 manual weight baseline
const MANUAL_WEIGHTS = {
  reputationScore: 0.18,
  capabilityScore: 0.18,
  pheromoneScore: 0.16,
  vaccinationScore: 0.14,
  circuitBreakerScore: 0.14,
  symbiosisScore: 0.10,
  skillGovernorSignal: 0.10,
};

// ============================================================================
// SignalCalibrator
// ============================================================================

export class SignalCalibrator {
  /**
   * @param {Object} deps
   * @param {Object} [deps.messageBus] - MessageBus 实例
   * @param {Object} [deps.logger]
   * @param {Object} [deps.config] - 校准配置
   * @param {Object} [deps.workerPool] - Worker 线程池 (MI 计算可委托)
   */
  constructor({ messageBus, logger, config = {}, workerPool } = {}) {
    this._messageBus = messageBus || null;
    this._logger = logger || console;
    this._workerPool = workerPool || null;

    this._config = { ...DEFAULT_CONFIG, ...config };

    /** @type {Array<{signals: Object, outcome: number}>} 历史样本 / History samples */
    this._samples = [];

    /** @type {Map<string, number>} 当前权重 / Current weights */
    this._currentWeights = new Map(Object.entries(MANUAL_WEIGHTS));

    /** @type {string} 当前阶段 / Current phase */
    this._phase = 'manual'; // 'manual' | 'mixing' | 'auto'

    /** @type {number} 上次校准的 turn 数 / Last calibration turn count */
    this._lastCalibrationAt = 0;

    /** @type {number} 总 turn 数 / Total turn count */
    this._turnCount = 0;
  }

  // ━━━ 核心 API / Core API ━━━

  /**
   * 记录一个 turn 的信号和结果
   * Record signals and outcome for one turn
   *
   * @param {Object} signals - 信号值 { signalName: value }
   * @param {number} outcome - 结果 (0=失败, 1=成功, 0-1 连续值)
   */
  recordSample(signals, outcome) {
    if (!this._config.enabled) return;

    this._turnCount++;
    this._samples.push({ signals: { ...signals }, outcome });

    // 限制样本数量 / Limit sample count
    if (this._samples.length > this._config.stableSamples * 2) {
      this._samples = this._samples.slice(-this._config.stableSamples);
    }

    // 阶段切换检查 / Phase transition check
    this._updatePhase();

    // 周期性校准 / Periodic calibration
    if (this._turnCount - this._lastCalibrationAt >= this._config.calibrationIntervalTurns) {
      if (this._phase !== 'manual') {
        this.calibrate();
      }
    }
  }

  /**
   * 执行校准 / Perform calibration
   *
   * @returns {Map<string, number>} 新权重 / New weights
   */
  calibrate() {
    if (this._samples.length < this._config.minSamples) {
      return this._currentWeights;
    }

    const signalNames = Object.keys(MANUAL_WEIGHTS);
    const miScores = new Map();

    // 计算每个信号的 MI / Compute MI for each signal
    for (const name of signalNames) {
      const signalValues = this._samples.map((s) => s.signals[name] || 0);
      const outcomeValues = this._samples.map((s) => s.outcome);
      const mi = this._computeMI(signalValues, outcomeValues);
      miScores.set(name, mi);
    }

    // MI → 权重归一化 / MI → Weight normalization
    const totalMI = Array.from(miScores.values()).reduce((s, v) => s + v, 0);
    const miWeights = new Map();

    if (totalMI > 0) {
      for (const [name, mi] of miScores) {
        let w = mi / totalMI;
        // 应用 floor/cap 约束 / Apply floor/cap constraints
        w = Math.max(this._config.floor, Math.min(this._config.cap, w));
        miWeights.set(name, w);
      }
      // 重归一化 / Re-normalize
      const sum = Array.from(miWeights.values()).reduce((s, v) => s + v, 0);
      for (const [name, w] of miWeights) {
        miWeights.set(name, w / sum);
      }
    } else {
      // MI 全为 0, 保持手动权重 / All MI=0, keep manual weights
      for (const [name, w] of Object.entries(MANUAL_WEIGHTS)) {
        miWeights.set(name, w);
      }
    }

    // 根据阶段混合 / Phase-based mixing
    if (this._phase === 'mixing') {
      const ratio = this._config.mixingRatio;
      for (const name of signalNames) {
        const manual = MANUAL_WEIGHTS[name] || 0;
        const mi = miWeights.get(name) || 0;
        this._currentWeights.set(name, (1 - ratio) * manual + ratio * mi);
      }
    } else if (this._phase === 'auto') {
      this._currentWeights = miWeights;
    }

    this._lastCalibrationAt = this._turnCount;

    // 发布事件 / Publish event
    this._messageBus?.publish?.(
      EventTopics.SIGNAL_WEIGHTS_CALIBRATED,
      wrapEvent(EventTopics.SIGNAL_WEIGHTS_CALIBRATED, {
        phase: this._phase,
        weights: Object.fromEntries(this._currentWeights),
        sampleCount: this._samples.length,
        miScores: Object.fromEntries(miScores),
      }),
    );

    return this._currentWeights;
  }

  /**
   * 获取当前权重 / Get current weights
   *
   * @returns {Object} 信号权重映射 / Signal weight map
   */
  getWeights() {
    return Object.fromEntries(this._currentWeights);
  }

  /**
   * 获取当前阶段信息 / Get current phase info
   */
  getPhaseInfo() {
    return {
      phase: this._phase,
      turnCount: this._turnCount,
      sampleCount: this._samples.length,
      lastCalibrationAt: this._lastCalibrationAt,
    };
  }

  // ━━━ 内部方法 / Internal ━━━

  /**
   * 更新校准阶段 / Update calibration phase
   * @private
   */
  _updatePhase() {
    const prevPhase = this._phase;

    if (this._turnCount < this._config.minSamples) {
      this._phase = 'manual';
    } else if (this._turnCount < this._config.stableSamples) {
      this._phase = 'mixing';
    } else {
      this._phase = 'auto';
    }

    if (prevPhase !== this._phase) {
      this._logger.info?.(`[SignalCalibrator] Phase: ${prevPhase} → ${this._phase} (turn ${this._turnCount})`);
      this._messageBus?.publish?.(
        EventTopics.SIGNAL_CALIBRATOR_PHASE_CHANGED,
        wrapEvent(EventTopics.SIGNAL_CALIBRATOR_PHASE_CHANGED, {
          from: prevPhase,
          to: this._phase,
          turnCount: this._turnCount,
        }),
      );
    }
  }

  /**
   * 离散互信息计算 / Discrete Mutual Information
   * MI(X;Y) = Σ Σ p(x,y) × log[p(x,y) / (p(x)×p(y))]
   *
   * @private
   * @param {number[]} xValues
   * @param {number[]} yValues
   * @returns {number}
   */
  _computeMI(xValues, yValues) {
    const n = xValues.length;
    if (n < 10) return 0;

    const bins = this._config.bins;

    // 离散化 / Discretize
    const discretize = (values) => {
      const min = Math.min(...values);
      const max = Math.max(...values);
      const range = max - min || 1;
      return values.map((v) => Math.min(Math.floor(((v - min) / range) * bins), bins - 1));
    };

    const xBins = discretize(xValues);
    const yBins = discretize(yValues);

    // 联合分布和边缘分布 / Joint and marginal distributions
    const jointCount = new Map();
    const xCount = new Float64Array(bins);
    const yCount = new Float64Array(bins);

    for (let i = 0; i < n; i++) {
      const key = `${xBins[i]}_${yBins[i]}`;
      jointCount.set(key, (jointCount.get(key) || 0) + 1);
      xCount[xBins[i]]++;
      yCount[yBins[i]]++;
    }

    let mi = 0;
    for (const [key, count] of jointCount) {
      const [xb, yb] = key.split('_').map(Number);
      const pxy = count / n;
      const px = xCount[xb] / n;
      const py = yCount[yb] / n;
      if (pxy > 0 && px > 0 && py > 0) {
        mi += pxy * Math.log(pxy / (px * py));
      }
    }

    return Math.max(0, mi);
  }
}
