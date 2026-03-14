/**
 * NegativeSelection — 负选择免疫检测器 / Negative Selection Immune Detector
 *
 * V7.0 §27 新建模块: 基于免疫系统负选择算法, 检测 agent 输出中的异常模式。
 * V7.0 §27 new module: Based on immune system negative selection algorithm,
 * detects anomalous patterns in agent outputs.
 *
 * 原理: 维护一组 "自体" 检测器 (已知失败模式), 当输出匹配自体时标记为异常。
 * 复用 FailureVaccination.findSimilar() + AnomalyDetector.recordResult() 的已有逻辑。
 *
 * Principle: Maintains a set of "self" detectors (known failure patterns).
 * When output matches self, it is flagged as anomalous.
 * Reuses FailureVaccination.findSimilar() + AnomalyDetector.recordResult() logic.
 *
 * @module L3-agent/negative-selection
 * @version 7.0.0
 * @author DEEP-IOS
 */

import { EventTopics, wrapEvent } from '../event-catalog.js';

// ============================================================================
// 常量 / Constants
// ============================================================================

/** 匹配置信度阈值 / Match confidence threshold */
const CONFIDENCE_THRESHOLD = 0.6;

/** 内置异常模式 (hardcoded self-detectors) */
const BUILTIN_PATTERNS = [
  { pattern: /error|exception|failed|crash/i, label: 'error_keyword', weight: 0.4 },
  { pattern: /infinite loop|stack overflow|out of memory/i, label: 'resource_exhaust', weight: 0.8 },
  { pattern: /undefined is not|cannot read prop|null reference/i, label: 'null_reference', weight: 0.6 },
  { pattern: /ECONNREFUSED|ETIMEDOUT|ENOTFOUND/i, label: 'network_failure', weight: 0.7 },
  { pattern: /rate limit|quota exceeded|429/i, label: 'rate_limit', weight: 0.5 },
];

const SOURCE = 'negative-selection';

// ============================================================================
// NegativeSelection
// ============================================================================

export class NegativeSelection {
  /**
   * @param {Object} deps
   * @param {Object} [deps.failureVaccination] - FailureVaccination 实例
   * @param {Object} [deps.anomalyDetector] - AnomalyDetector 实例
   * @param {Object} [deps.messageBus] - MessageBus
   * @param {Object} [deps.logger]
   * @param {Object} [deps.config]
   */
  constructor({ failureVaccination, anomalyDetector, messageBus, logger, config = {} } = {}) {
    this._failureVaccination = failureVaccination || null;
    this._anomalyDetector = anomalyDetector || null;
    this._messageBus = messageBus || null;
    this._logger = logger || console;

    /** 自定义检测器 (动态添加) / Custom detectors (dynamically added) */
    this._customDetectors = [];

    /** 统计 / Statistics */
    this._stats = {
      checks: 0,
      anomaliesDetected: 0,
      vaccineMatches: 0,
      patternMatches: 0,
    };
  }

  // ━━━ 核心 API / Core API ━━━

  /**
   * 检测输出是否匹配已知异常模式 ("自体" 检测)
   * Detect if output matches known anomaly patterns ("self" detection)
   *
   * 三层检测:
   * 1. FailureVaccination 疫苗库匹配 (已知失败模式)
   * 2. 内置异常关键词模式匹配
   * 3. AnomalyDetector 统计异常检测
   *
   * Three-layer detection:
   * 1. FailureVaccination vaccine library match (known failure patterns)
   * 2. Built-in anomaly keyword pattern matching
   * 3. AnomalyDetector statistical anomaly detection
   *
   * @param {string} output - 待检测的输出内容 / Output to check
   * @param {Object} [context] - 上下文 / Context
   * @param {string} [context.agentId]
   * @param {string} [context.taskType]
   * @returns {{ isAnomaly: boolean, confidence: number, matchedPatterns: string[], vaccines: Array }}
   */
  detect(output, context = {}) {
    this._stats.checks++;

    if (!output || typeof output !== 'string') {
      return { isAnomaly: false, confidence: 0, matchedPatterns: [], vaccines: [] };
    }

    const matchedPatterns = [];
    let totalWeight = 0;
    let maxWeight = 0;

    // Layer 1: FailureVaccination 疫苗匹配 / Vaccine library match
    let vaccines = [];
    if (this._failureVaccination) {
      try {
        vaccines = this._failureVaccination.findSimilar?.(output.substring(0, 500)) || [];
        if (vaccines.length > 0) {
          this._stats.vaccineMatches++;
          matchedPatterns.push(`vaccine:${vaccines[0].pattern || vaccines[0].errorType || 'unknown'}`);
          totalWeight += 0.7;
          maxWeight = Math.max(maxWeight, 0.7);
        }
      } catch { /* silent */ }
    }

    // Layer 2: 内置 + 自定义模式匹配 / Built-in + custom pattern matching
    const allPatterns = [...BUILTIN_PATTERNS, ...this._customDetectors];
    for (const detector of allPatterns) {
      if (detector.pattern.test(output)) {
        matchedPatterns.push(detector.label);
        totalWeight += detector.weight;
        maxWeight = Math.max(maxWeight, detector.weight);
        this._stats.patternMatches++;
      }
    }

    // Layer 3: AnomalyDetector 统计异常 / Statistical anomaly
    if (this._anomalyDetector) {
      try {
        // 检查输出长度异常 (过短可能是错误)
        // Check output length anomaly (too short might be error)
        const isLengthAnomaly = output.length < 20 && context.taskType !== 'simple';
        if (isLengthAnomaly) {
          matchedPatterns.push('length_anomaly');
          totalWeight += 0.3;
        }
      } catch { /* silent */ }
    }

    // 计算综合置信度 / Calculate combined confidence
    const confidence = Math.min(1.0, maxWeight > 0 ? (maxWeight * 0.6 + Math.min(totalWeight, 2) * 0.2) : 0);
    const isAnomaly = confidence >= CONFIDENCE_THRESHOLD;

    if (isAnomaly) {
      this._stats.anomaliesDetected++;

      // 发布事件 / Publish event
      this._publish(EventTopics.ANOMALY_DETECTED || 'negative_selection.anomaly', {
        agentId: context.agentId,
        confidence: Math.round(confidence * 1000) / 1000,
        matchedPatterns,
        outputPreview: output.substring(0, 100),
      });

      this._logger.debug?.(
        `[NegativeSelection] Anomaly detected: confidence=${confidence.toFixed(3)}, ` +
        `patterns=[${matchedPatterns.join(',')}]`
      );
    }

    return { isAnomaly, confidence: Math.round(confidence * 1000) / 1000, matchedPatterns, vaccines };
  }

  // ━━━ 检测器管理 / Detector Management ━━━

  /**
   * 添加自定义检测器
   * Add custom detector
   *
   * @param {RegExp} pattern - 匹配模式 / Match pattern
   * @param {string} label - 标签 / Label
   * @param {number} [weight=0.5] - 权重 / Weight (0-1)
   */
  addDetector(pattern, label, weight = 0.5) {
    this._customDetectors.push({
      pattern,
      label,
      weight: Math.max(0.1, Math.min(1.0, weight)),
    });
  }

  /**
   * 从 FailureVaccination 历史构建检测器
   * Build detectors from FailureVaccination history
   *
   * @returns {number} 构建的检测器数量 / Number of detectors built
   */
  buildFromVaccines() {
    if (!this._failureVaccination) return 0;

    try {
      const vaccines = this._failureVaccination.getVaccines?.() || [];
      let built = 0;

      for (const vaccine of vaccines) {
        if (vaccine.errorType || vaccine.pattern) {
          const escapedPattern = (vaccine.errorType || vaccine.pattern)
            .replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          try {
            this.addDetector(new RegExp(escapedPattern, 'i'), `vaccine:${vaccine.errorType || 'auto'}`, 0.6);
            built++;
          } catch { /* invalid regex */ }
        }
      }

      return built;
    } catch {
      return 0;
    }
  }

  // ━━━ 统计 / Statistics ━━━

  /**
   * 获取统计
   * Get statistics
   *
   * @returns {Object}
   */
  getStats() {
    return {
      ...this._stats,
      customDetectorCount: this._customDetectors.length,
      builtinPatternCount: BUILTIN_PATTERNS.length,
    };
  }

  // ━━━ 内部方法 / Internal ━━━

  _publish(topic, payload) {
    if (this._messageBus) {
      try {
        this._messageBus.publish(topic, wrapEvent(topic, payload, SOURCE));
      } catch { /* ignore */ }
    }
  }
}
