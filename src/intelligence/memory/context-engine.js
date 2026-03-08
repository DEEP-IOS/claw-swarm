/**
 * ContextEngine — 上下文窗口组装引擎（CJK 感知 token 估算）
 * Context window assembly engine with CJK-aware token estimation
 *
 * 按 Section 优先级组装上下文：CRITICAL > HIGH > MEDIUM > LOW > OPTIONAL，
 * 在 token 预算内尽量填充，超限时截断最后一个 section。
 * token 估算对 CJK 字符使用 ~1.5 tokens/char，ASCII ~0.25 tokens/char。
 *
 * Assembles context by section priority: CRITICAL > HIGH > MEDIUM > LOW > OPTIONAL,
 * filling as much as possible within the token budget and truncating the last
 * section on overflow. CJK chars estimated at ~1.5 tokens/char, ASCII at ~0.25.
 *
 * @module intelligence/memory/context-engine
 * @version 9.0.0
 */

import { ModuleBase } from '../../core/module-base.js';

// ─── CJK 检测正则 / CJK detection regex ────────────────────────────
const CJK_REGEX = /[一-鿿㐀-䶿𠀀-𪛟𪜀-𫜿぀-ゟ゠-ヿ가-힯]/u;

/** Section 优先级枚举 / Priority constants */
export const PRIORITY = Object.freeze({
  CRITICAL: 1,
  HIGH:     2,
  MEDIUM:   3,
  LOW:      4,
  OPTIONAL: 5,
});

// ─── ContextEngine ──────────────────────────────────────────────────
export class ContextEngine extends ModuleBase {
  static produces() { return []; }
  static consumes() { return []; }
  static publishes() { return []; }
  static subscribes() { return []; }

  /**
   * @param {object} [opts]
   * @param {number} [opts.maxTokens=128000]
   * @param {number} [opts.reservedTokens=4000]
   */
  constructor({ maxTokens = 128000, reservedTokens = 4000 } = {}) {
    super();
    this._maxTokens = maxTokens;
    this._reservedTokens = reservedTokens;
  }

  /**
   * CJK 感知 token 估算 / CJK-aware token estimation
   * CJK: ~1.5 tokens per character; ASCII: ~4 characters per token
   * @param {string} text
   * @returns {number}
   */
  estimateTokens(text) {
    if (!text) return 0;
    let cjkCount = 0;
    let asciiCount = 0;

    for (const char of text) {
      if (CJK_REGEX.test(char)) {
        cjkCount++;
      } else {
        asciiCount++;
      }
    }

    return Math.ceil(cjkCount * 1.5 + asciiCount / 4);
  }

  /**
   * 组装上下文 / Assemble context from prioritized sections
   * @param {Array<{ priority: number, content: string, estimatedTokens?: number }>} sections
   * @returns {string}
   */
  assemble(sections) {
    if (!sections || sections.length === 0) return '';

    const budget = this._maxTokens - this._reservedTokens;
    const sorted = [...sections].sort((a, b) => a.priority - b.priority);

    let accumulated = 0;
    const parts = [];

    for (const section of sorted) {
      const tokens = section.estimatedTokens ?? this.estimateTokens(section.content);

      if (accumulated + tokens <= budget) {
        parts.push(section.content);
        accumulated += tokens;
      } else {
        const remaining = budget - accumulated;
        if (remaining > 0) {
          const truncated = this.fitToTokenBudget(section.content, remaining);
          parts.push(truncated);
        }
        break;
      }
    }

    return parts.join('\n\n');
  }

  /**
   * 将文本裁剪到 token 预算 / Fit text within token budget
   * @param {string} text
   * @param {number} maxTokens
   * @returns {string}
   */
  fitToTokenBudget(text, maxTokens) {
    if (this.estimateTokens(text) <= maxTokens) return text;

    const lines = text.split('\n');
    let result = '';
    let tokens = 0;

    for (const line of lines) {
      const lineTokens = this.estimateTokens(line);
      if (tokens + lineTokens > maxTokens) break;
      result += (result ? '\n' : '') + line;
      tokens += lineTokens;
    }

    return result + '\n...(已截断 / truncated)';
  }

  /**
   * 按优先级分配 token 预算 / Allocate token budgets by priority
   * @param {number} totalBudget
   * @param {Array<{ priority: number }>} sections
   * @returns {Map<number, number>} priority -> token budget
   */
  getSectionBudgets(totalBudget, sections) {
    const budgets = new Map();
    const priorities = [...new Set(sections.map((s) => s.priority))].sort((a, b) => a - b);

    const ratios = {
      [PRIORITY.CRITICAL]: 0.30,
      [PRIORITY.HIGH]:     0.25,
      [PRIORITY.MEDIUM]:   0.25,
      [PRIORITY.LOW]:      0.15,
      [PRIORITY.OPTIONAL]: 0.05,
    };

    let allocated = 0;
    for (const p of priorities) {
      const ratio = ratios[p] ?? 0.05;
      const budget = Math.floor(totalBudget * ratio);
      budgets.set(p, budget);
      allocated += budget;
    }

    const remainder = totalBudget - allocated;
    if (remainder > 0) {
      const lastP = priorities[priorities.length - 1] ?? PRIORITY.OPTIONAL;
      budgets.set(lastP, (budgets.get(lastP) || 0) + remainder);
    }

    return budgets;
  }
}

export { PRIORITY as ContextPriority };
export default ContextEngine;
