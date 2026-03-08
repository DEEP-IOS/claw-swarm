/**
 * ContextCompressor -- 上下文压缩器 / Context Compressor
 *
 * 将记忆条目压缩为适合 LLM 上下文注入的紧凑文本表示:
 * - 按 importance * confidence * recency 排序
 * - 截断到目标条目数或目标字符数
 * - 格式化为可读文本块
 *
 * Compresses memory items into compact text for LLM context injection:
 * - Ranks by importance * confidence * recency
 * - Truncates to target item count or character limit
 * - Formats into readable text block
 *
 * @module L3-agent/memory/context-compressor
 * @author DEEP-IOS
 */

export class ContextCompressor {
  /**
   * @param {Object} [options]
   * @param {number} [options.maxItems=20] - 默认最大条目数 / Default max items
   * @param {number} [options.maxChars=4000] - 默认最大字符数 / Default max characters
   */
  constructor({ maxItems = 20, maxChars = 4000 } = {}) {
    /** @type {number} */
    this._defaultMaxItems = maxItems;
    /** @type {number} */
    this._defaultMaxChars = maxChars;
  }

  /**
   * 压缩记忆条目为紧凑文本
   * Compress memory items into compact text
   *
   * @param {Array<Object>} items - 记忆条目 (来自任何记忆层) / Memory items from any layer
   * @param {Object} [options]
   * @param {number} [options.maxItems] - 最大条目数 (覆盖默认值)
   * @param {number} [options.maxChars] - 最大字符数 (覆盖默认值)
   * @returns {{ compressed: string, itemCount: number, truncated: boolean }}
   */
  compress(items, { maxItems, maxChars } = {}) {
    const itemLimit = maxItems || this._defaultMaxItems;
    const charLimit = maxChars || this._defaultMaxChars;

    if (!items || items.length === 0) {
      return { compressed: '', itemCount: 0, truncated: false };
    }

    // 排序 / Rank items
    const ranked = this.rank(items);

    // 截断到条目数限制, 然后按字符数限制进一步截断
    // Truncate to item limit, then further by character limit
    const lines = [];
    let totalChars = 0;
    let usedCount = 0;
    let truncated = false;

    for (let i = 0; i < ranked.length && usedCount < itemLimit; i++) {
      const line = this._formatItem(ranked[i]);

      // 检查字符数限制 / Check character limit
      if (totalChars + line.length > charLimit && usedCount > 0) {
        truncated = true;
        break;
      }

      lines.push(line);
      totalChars += line.length + 1; // +1 换行符
      usedCount++;
    }

    if (ranked.length > usedCount) {
      truncated = true;
    }

    return {
      compressed: lines.join('\n'),
      itemCount: usedCount,
      truncated,
    };
  }

  /**
   * 按 importance * confidence * recency 降序排列
   * Rank items by importance * confidence * recency descending
   *
   * @param {Array<Object>} items
   * @returns {Array<Object>} 排序后的副本 / Sorted copy
   */
  rank(items) {
    const now = Date.now();
    return [...items].sort((a, b) => {
      const scoreA = this._rankScore(a, now);
      const scoreB = this._rankScore(b, now);
      return scoreB - scoreA;
    });
  }

  // ━━━ 内部方法 / Internal Methods ━━━

  /**
   * 计算排名分数: importance * confidence * recencyWeight
   * Compute rank score: importance * confidence * recencyWeight
   *
   * @private
   * @param {Object} item
   * @param {number} now
   * @returns {number}
   */
  _rankScore(item, now) {
    const importance = item.importance ?? 0.5;
    const confidence = item.confidence ?? 1.0;
    const lastAccess = item.lastAccessedAt || item.timestamp || item.createdAt || now;
    const ageMs = now - lastAccess;
    const recency = 1 / (1 + ageMs / 60000);
    return importance * confidence * recency;
  }

  /**
   * 将单个条目格式化为紧凑文本行
   * Format a single item into a compact text line
   *
   * @private
   * @param {Object} item
   * @returns {string}
   */
  _formatItem(item) {
    // 工作记忆条目格式 / Working memory entry format
    if (item.key !== undefined) {
      const val = typeof item.value === 'object' ? JSON.stringify(item.value) : String(item.value);
      const truncVal = val.length > 200 ? val.slice(0, 197) + '...' : val;
      return `[${item.layer || 'mem'}] ${item.key}: ${truncVal}`;
    }

    // 情景记忆条目格式 / Episodic memory entry format
    if (item.subject !== undefined) {
      const obj = item.object ? ` ${item.object}` : '';
      return `[${item.eventType || 'event'}] ${item.subject} ${item.predicate}${obj}`;
    }

    // 语义记忆条目格式 / Semantic memory entry format
    if (item.label !== undefined) {
      return `[${item.nodeType || 'knowledge'}] ${item.label}`;
    }

    // 通用回退 / Generic fallback
    return `[item] ${JSON.stringify(item).slice(0, 200)}`;
  }
}
