/**
 * MonotonicClock — 单调时钟工具 / Monotonic Clock Utility
 *
 * 使用 process.hrtime.bigint() 提供单调递增的高精度时间测量，
 * 免疫 NTP 跳变导致的时间回拨问题。
 *
 * Uses process.hrtime.bigint() for monotonically increasing high-precision
 * time measurement, immune to NTP time jumps.
 *
 * 使用场景 / Use Cases:
 * - 断路器超时 / Circuit breaker timeouts
 * - 缓存 TTL / Cache TTL
 * - 信息素衰减间隔 / Pheromone decay intervals
 * - 健康检查轮询间隔 / Health check polling intervals
 *
 * ⚠️ 注意: 仅用于进程内相对时间差计算。
 *    写入 DB 的绝对时间戳仍然使用 Date.now()。
 * ⚠️ Note: Only for in-process relative time differences.
 *    Use Date.now() for absolute timestamps written to DB.
 *
 * @module L1-infrastructure/monotonic-clock
 * @author DEEP-IOS
 */

'use strict';

// ---------------------------------------------------------------------------
// 常量 / Constants
// ---------------------------------------------------------------------------

/** 纳秒 → 毫秒 转换因子 / Nanosecond to millisecond conversion factor */
const NS_PER_MS = 1_000_000n;

/** 纳秒 → 秒 转换因子 / Nanosecond to second conversion factor */
const NS_PER_SEC = 1_000_000_000n;

// ---------------------------------------------------------------------------
// MonotonicClock 类 / MonotonicClock Class
// ---------------------------------------------------------------------------

export class MonotonicClock {
  /**
   * 获取当前单调时钟值 (纳秒 BigInt)
   * Get current monotonic clock value (nanoseconds as BigInt)
   *
   * @returns {bigint} 纳秒级单调时间 / Nanosecond monotonic time
   */
  static nowNs() {
    return process.hrtime.bigint();
  }

  /**
   * 获取当前单调时钟值 (毫秒 Number)
   * Get current monotonic clock value (milliseconds as Number)
   *
   * ⚠️ 精度损失: BigInt → Number 转换在极大值时可能丢失精度，
   *    但进程运行期内（< 292 年）完全安全。
   *
   * @returns {number} 毫秒级单调时间 / Millisecond monotonic time
   */
  static nowMs() {
    return Number(process.hrtime.bigint() / NS_PER_MS);
  }

  /**
   * 计算自 startNs 以来经过的毫秒数
   * Calculate elapsed milliseconds since startNs
   *
   * @param {bigint} startNs - 起始时间 (hrtime.bigint) / Start time from nowNs()
   * @returns {number} 经过的毫秒数 / Elapsed milliseconds
   */
  static elapsedMs(startNs) {
    return Number((process.hrtime.bigint() - startNs) / NS_PER_MS);
  }

  /**
   * 计算自 startNs 以来经过的秒数
   * Calculate elapsed seconds since startNs
   *
   * @param {bigint} startNs - 起始时间 (hrtime.bigint) / Start time from nowNs()
   * @returns {number} 经过的秒数 (含小数) / Elapsed seconds (with decimals)
   */
  static elapsedSec(startNs) {
    const elapsed = process.hrtime.bigint() - startNs;
    return Number(elapsed) / 1e9;
  }

  /**
   * 检查是否已超过指定的毫秒超时
   * Check if a millisecond timeout has been exceeded
   *
   * @param {bigint} startNs - 起始时间 / Start time from nowNs()
   * @param {number} timeoutMs - 超时毫秒数 / Timeout in milliseconds
   * @returns {boolean} 是否已超时 / Whether timeout has been exceeded
   */
  static isExpired(startNs, timeoutMs) {
    const elapsedNs = process.hrtime.bigint() - startNs;
    return elapsedNs >= BigInt(timeoutMs) * NS_PER_MS;
  }

  /**
   * 获取当前绝对时间戳 (用于 DB 写入)
   * Get current absolute timestamp (for DB writes)
   *
   * 语义等同 Date.now()，但提供统一入口，便于未来替换。
   * Semantically equivalent to Date.now(), unified entry point.
   *
   * @returns {number} Unix 毫秒时间戳 / Unix millisecond timestamp
   */
  static wallClockMs() {
    return Date.now();
  }
}
