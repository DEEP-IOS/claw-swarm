/**
 * 数据格式化工具 / Data Formatting Utilities
 *
 * @module utils/formatters
 * @author DEEP-IOS
 */

/**
 * 格式化时间 (HH:MM:SS) / Format time
 * @param {number|Date} ts - 时间戳或 Date
 * @returns {string}
 */
export function fmtTime(ts) {
  const d = ts instanceof Date ? ts : new Date(ts);
  return d.toLocaleTimeString('en-US', { hour12: false });
}

/**
 * 格式化持续时间 (ms → 人类可读) / Format duration
 * @param {number} ms - 毫秒
 * @returns {string}
 */
export function fmtDuration(ms) {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 3600000) return `${(ms / 60000).toFixed(1)}m`;
  return `${(ms / 3600000).toFixed(1)}h`;
}

/**
 * 格式化百分比 / Format percentage
 * @param {number} v - 值 (0-1)
 * @param {number} [decimals=1] - 小数位
 * @returns {string}
 */
export function fmtPct(v, decimals = 1) {
  return `${(v * 100).toFixed(decimals)}%`;
}

/**
 * 格式化数字 (带千分符) / Format number with commas
 * @param {number} n
 * @returns {string}
 */
export function fmtNumber(n) {
  return n.toLocaleString('en-US');
}

/**
 * 格式化 token 数量 / Format token count
 * @param {number} tokens
 * @returns {string}
 */
export function fmtTokens(tokens) {
  if (tokens < 1000) return `${tokens}`;
  if (tokens < 1000000) return `${(tokens / 1000).toFixed(1)}K`;
  return `${(tokens / 1000000).toFixed(2)}M`;
}

/**
 * 格式化相对时间 / Format relative time
 * @param {number} ts - 时间戳
 * @returns {string}
 */
export function fmtRelative(ts) {
  const diff = Date.now() - ts;
  if (diff < 5000) return 'just now';
  if (diff < 60000) return `${Math.round(diff / 1000)}s ago`;
  if (diff < 3600000) return `${Math.round(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.round(diff / 3600000)}h ago`;
  return `${Math.round(diff / 86400000)}d ago`;
}

/**
 * 截断字符串 / Truncate string
 * @param {string} s
 * @param {number} [maxLen=30]
 * @returns {string}
 */
export function truncate(s, maxLen = 30) {
  if (!s || s.length <= maxLen) return s;
  return s.substring(0, maxLen - 1) + '\u2026';
}

/**
 * 格式化信号权重 / Format signal weight
 * @param {number} w - 权重 (0-1)
 * @returns {string}
 */
export function fmtWeight(w) {
  return w.toFixed(3);
}
