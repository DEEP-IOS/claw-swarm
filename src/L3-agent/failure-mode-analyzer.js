/**
 * FailureModeAnalyzer — 失败根因分类 / Failure Root Cause Classification
 *
 * V6.0 新增模块: 自动分类失败根因, 关联缓解策略。
 * V6.0 new module: Automatically classifies failure root causes with mitigation strategies.
 *
 * 5 类根因 / 5 Root Cause Categories:
 *   INPUT_ERROR — 参数/格式错误
 *   TIMEOUT — 超时
 *   LLM_REFUSAL — LLM 拒绝/安全过滤
 *   NETWORK — 网络/API 错误
 *   RESOURCE_EXHAUSTION — 资源耗尽 (内存/Token/配额)
 *
 * @module L3-agent/failure-mode-analyzer
 * @author DEEP-IOS
 */

import { EventTopics, wrapEvent } from '../event-catalog.js';

// ============================================================================
// 根因分类模式 / Root Cause Classification Patterns
// ============================================================================

const CATEGORY_PATTERNS = {
  INPUT_ERROR: [
    /invalid\s*(param|argument|input|type|format)/i,
    /validation\s*(fail|error)/i,
    /missing\s*(required|param|field)/i,
    /schema\s*(validation|error|mismatch)/i,
    /parse\s*error/i,
    /unexpected\s*token/i,
    /type\s*error/i,
  ],
  TIMEOUT: [
    /timeout/i,
    /timed?\s*out/i,
    /ETIMEDOUT/i,
    /deadline\s*exceeded/i,
    /request\s*aborted/i,
  ],
  LLM_REFUSAL: [
    /refus(al|ed|e)/i,
    /content\s*filter/i,
    /safety\s*filter/i,
    /blocked\s*by\s*(safety|policy|content)/i,
    /inappropriate\s*content/i,
    /violat(es?|ion|ing)\s*(policy|guidelines|terms)/i,
  ],
  NETWORK: [
    /ECONNREFUSED/i,
    /ECONNRESET/i,
    /ENOTFOUND/i,
    /network\s*error/i,
    /fetch\s*failed/i,
    /socket\s*hang\s*up/i,
    /ERR_INTERNET/i,
    /502|503|504/,
    /bad\s*gateway/i,
    /service\s*unavailable/i,
  ],
  RESOURCE_EXHAUSTION: [
    /out\s*of\s*memory/i,
    /OOM/i,
    /token\s*limit/i,
    /rate\s*limit/i,
    /quota\s*exceeded/i,
    /too\s*many\s*requests/i,
    /429/,
    /heap\s*out/i,
    /ENOMEM/i,
  ],
};

// 缓解策略 / Mitigation Strategies
const MITIGATIONS = {
  INPUT_ERROR: 'validate_and_retry',
  TIMEOUT: 'retry_with_longer_timeout',
  LLM_REFUSAL: 'rephrase_or_skip',
  NETWORK: 'retry_with_backoff',
  RESOURCE_EXHAUSTION: 'reduce_scope_or_wait',
};

// ============================================================================
// FailureModeAnalyzer
// ============================================================================

export class FailureModeAnalyzer {
  /**
   * @param {Object} deps
   * @param {Object} [deps.messageBus]
   * @param {Object} [deps.logger]
   * @param {Object} [deps.db] - DatabaseManager (写入 failure_mode_log)
   */
  constructor({ messageBus, logger, db } = {}) {
    this._messageBus = messageBus || null;
    this._logger = logger || console;
    this._db = db || null;

    /** @type {Map<string, number[]>} 趋势窗口 / Trend windows: category → [timestamps] */
    this._trendWindows = new Map();
    for (const cat of Object.keys(CATEGORY_PATTERNS)) {
      this._trendWindows.set(cat, []);
    }
  }

  // ━━━ 核心 API / Core API ━━━

  /**
   * 分类失败根因 / Classify failure root cause
   *
   * @param {Error|string} error - 错误对象或消息
   * @param {Object} [context] - 上下文 { toolName, agentId, taskType }
   * @returns {{ category: string, confidence: number, mitigation: string }}
   */
  classify(error, context = {}) {
    const message = typeof error === 'string' ? error : (error?.message || String(error));
    let bestCategory = 'UNKNOWN';
    let bestConfidence = 0;

    for (const [category, patterns] of Object.entries(CATEGORY_PATTERNS)) {
      for (const pattern of patterns) {
        if (pattern.test(message)) {
          const confidence = 0.8; // 模式匹配基础置信度
          if (confidence > bestConfidence) {
            bestConfidence = confidence;
            bestCategory = category;
          }
        }
      }
    }

    // 如果无匹配, 基于错误码辅助分类 / Error code auxiliary classification
    if (bestCategory === 'UNKNOWN') {
      const code = error?.code || '';
      if (code.startsWith('E')) {
        bestCategory = 'NETWORK';
        bestConfidence = 0.5;
      } else {
        bestConfidence = 0.3;
      }
    }

    const result = {
      category: bestCategory,
      confidence: bestConfidence,
      mitigation: MITIGATIONS[bestCategory] || 'manual_investigation',
    };

    // 记录趋势 / Record trend
    const now = Date.now();
    const window = this._trendWindows.get(bestCategory);
    if (window) {
      window.push(now);
      // 保留最近 1 小时 / Keep last hour
      const cutoff = now - 3600000;
      while (window.length > 0 && window[0] < cutoff) window.shift();
    }

    // 持久化 / Persist
    this._persist(context.toolName || 'unknown', result, message);

    // 发布事件 / Publish event
    this._messageBus?.publish?.(
      EventTopics.FAILURE_MODE_CLASSIFIED,
      wrapEvent(EventTopics.FAILURE_MODE_CLASSIFIED, {
        ...result,
        toolName: context.toolName,
        agentId: context.agentId,
      }),
    );

    return result;
  }

  /**
   * 分析趋势 / Analyze trend
   *
   * @param {string} category - 根因类别
   * @param {number} [windowMs=3600000] - 时间窗口 (默认 1 小时)
   * @returns {{ trend: 'rising'|'stable'|'falling', rate: number, count: number }}
   */
  analyzeTrend(category, windowMs = 3600000) {
    const window = this._trendWindows.get(category);
    if (!window || window.length < 2) {
      return { trend: 'stable', rate: 0, count: window?.length || 0 };
    }

    const now = Date.now();
    const cutoff = now - windowMs;
    const recent = window.filter((t) => t >= cutoff);
    const halfPoint = now - windowMs / 2;
    const firstHalf = recent.filter((t) => t < halfPoint).length;
    const secondHalf = recent.filter((t) => t >= halfPoint).length;

    let trend = 'stable';
    if (secondHalf > firstHalf * 1.5) trend = 'rising';
    else if (firstHalf > secondHalf * 1.5) trend = 'falling';

    const rate = recent.length / (windowMs / 60000); // 每分钟频率

    // 趋势告警 / Trend alert
    if (trend === 'rising' && rate > 0.5) {
      this._messageBus?.publish?.(
        EventTopics.FAILURE_TREND_ALERT,
        wrapEvent(EventTopics.FAILURE_TREND_ALERT, {
          category,
          trend,
          rate,
          count: recent.length,
        }),
      );
    }

    return { trend, rate: Math.round(rate * 100) / 100, count: recent.length };
  }

  /**
   * 获取所有类别的趋势摘要 / Get trend summary for all categories
   */
  getTrendSummary() {
    const summary = {};
    for (const cat of Object.keys(CATEGORY_PATTERNS)) {
      summary[cat] = this.analyzeTrend(cat);
    }
    return summary;
  }

  // ━━━ 内部 / Internal ━━━

  /**
   * @private
   */
  _persist(toolName, result, errorMessage) {
    if (!this._db) return;

    try {
      this._db.run?.(
        `INSERT INTO failure_mode_log (tool_name, error_category, error_message, mitigation, timestamp)
         VALUES (?, ?, ?, ?, ?)`,
        toolName,
        result.category,
        (errorMessage || '').slice(0, 500),
        result.mitigation,
        Date.now(),
      );
    } catch {
      // non-fatal
    }
  }
}
