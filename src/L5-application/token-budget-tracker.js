/**
 * TokenBudgetTracker — Prompt Token 预算协调器 / Prompt Token Budget Coordinator
 *
 * 协调各 hook handler 向 prompt 注入内容时的 token 预算分配，
 * 防止多个 handler 各自独立注入导致超出总预算。
 *
 * Coordinates token budget allocation when multiple hook handlers
 * inject content into prompts, preventing budget overflow.
 *
 * 预算分配 / Budget Allocation:
 * - 蜂群上下文 (Phase 3): ≤ 500 tokens
 * - Skill 推荐 (Phase 5): ≤ 200 tokens
 * - 工具失败提示 (Phase 1): ≤ 100 tokens
 * - 总注入上限 / Total cap: ≤ 800 tokens
 *
 * Token 估算策略 / Token Estimation Strategy:
 * - 中文: 1 字 ≈ 2 tokens
 * - 英文: 4 字符 ≈ 1 token
 * - 混合: (中文字数 × 2 + 英文字符数 / 4) 加权估算
 *
 * @module L5-application/token-budget-tracker
 * @author DEEP-IOS
 */

'use strict';

// ---------------------------------------------------------------------------
// 常量 / Constants
// ---------------------------------------------------------------------------

/** 默认总预算 / Default total budget */
const DEFAULT_TOTAL_BUDGET = 800;

/** 各用途预算配额 / Per-purpose budget quotas */
const DEFAULT_QUOTAS = {
  swarmContext: 500,       // Phase 3 蜂群上下文
  skillRecommendation: 200, // Phase 5 Skill 推荐
  toolFailureHint: 100,    // Phase 1 工具失败提示
};

/** 裁剪优先级（低优先级先裁） / Trim priority (lower = trimmed first) */
const TRIM_PRIORITY = ['skillRecommendation', 'swarmContext', 'toolFailureHint'];

// CJK Unicode 范围正则 / CJK Unicode range regex
const CJK_REGEX = /[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff\u2e80-\u2eff\u3000-\u303f]/g;

// ---------------------------------------------------------------------------
// TokenBudgetTracker 类 / TokenBudgetTracker Class
// ---------------------------------------------------------------------------

export class TokenBudgetTracker {
  /**
   * @param {Object} [options]
   * @param {number} [options.totalBudget=800] - 总 token 预算 / Total token budget
   * @param {Object} [options.quotas] - 各用途配额 / Per-purpose quotas
   */
  constructor({ totalBudget, quotas } = {}) {
    this._totalBudget = totalBudget || DEFAULT_TOTAL_BUDGET;
    this._quotas = { ...DEFAULT_QUOTAS, ...(quotas || {}) };

    /** @private 本轮已消耗量 / Current turn consumption */
    this._consumed = new Map();
  }

  /**
   * 估算字符串的 token 数（无需 tiktoken 依赖）
   * Estimate token count for a string (no tiktoken dependency needed)
   *
   * @param {string} text
   * @returns {number} 估算 token 数 / Estimated token count
   */
  estimateTokens(text) {
    if (!text) return 0;

    const cjkMatches = text.match(CJK_REGEX);
    const cjkCount = cjkMatches ? cjkMatches.length : 0;
    const nonCjkLength = text.length - cjkCount;

    // 中文: 1字 ≈ 2 tokens, 英文: 4字符 ≈ 1 token
    return Math.ceil(cjkCount * 2 + nonCjkLength / 4);
  }

  /**
   * 申请预算配额，返回允许使用的 token 数
   * Request budget quota, returns allowed token count
   *
   * @param {string} purpose - 用途标识 / Purpose identifier (e.g., 'swarmContext')
   * @param {string} content - 待注入内容 / Content to inject
   * @returns {{ allowed: boolean, tokens: number, trimmed: string | null }}
   */
  request(purpose, content) {
    if (!content) return { allowed: false, tokens: 0, trimmed: null };

    const estimated = this.estimateTokens(content);
    const quota = this._quotas[purpose] || this._totalBudget;
    const totalConsumed = this._getTotalConsumed();
    const remaining = this._totalBudget - totalConsumed;

    // 该用途已用量 / Already consumed for this purpose
    const purposeConsumed = this._consumed.get(purpose) || 0;
    const purposeRemaining = quota - purposeConsumed;

    // 取两者最小值 / Take minimum of both limits
    const maxAllowed = Math.min(remaining, purposeRemaining);

    if (maxAllowed <= 0) {
      return { allowed: false, tokens: 0, trimmed: null };
    }

    if (estimated <= maxAllowed) {
      // 在预算内 / Within budget
      this._consumed.set(purpose, purposeConsumed + estimated);
      return { allowed: true, tokens: estimated, trimmed: content };
    }

    // 需要裁剪 / Needs trimming
    const ratio = maxAllowed / estimated;
    const trimLength = Math.floor(content.length * ratio);
    const trimmed = content.substring(0, trimLength) + '...';
    const trimmedTokens = this.estimateTokens(trimmed);

    this._consumed.set(purpose, purposeConsumed + trimmedTokens);
    return { allowed: true, tokens: trimmedTokens, trimmed };
  }

  /**
   * 获取剩余总预算
   * Get remaining total budget
   *
   * @returns {number}
   */
  getRemaining() {
    return Math.max(0, this._totalBudget - this._getTotalConsumed());
  }

  /**
   * 获取当前消耗统计
   * Get current consumption stats
   *
   * @returns {Object}
   */
  getStats() {
    const consumed = {};
    for (const [k, v] of this._consumed) {
      consumed[k] = v;
    }
    return {
      totalBudget: this._totalBudget,
      totalConsumed: this._getTotalConsumed(),
      remaining: this.getRemaining(),
      byPurpose: consumed,
    };
  }

  /**
   * 每轮结束后重置 / Reset at end of each turn
   */
  reset() {
    this._consumed.clear();
  }

  // ━━━ 内部方法 / Internal Methods ━━━

  /** @private */
  _getTotalConsumed() {
    let total = 0;
    for (const v of this._consumed.values()) {
      total += v;
    }
    return total;
  }
}
