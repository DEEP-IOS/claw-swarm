/**
 * 信号场垃圾回收调度器
 * Signal field garbage collection scheduler
 *
 * 定期扫描信号场后端，清除已衰减到阈值以下的过期信号。
 * 当信号总数超过上限时触发紧急 GC，额外移除最旧的 10%。
 * Periodically scans the signal field backend to remove expired signals
 * whose strength has decayed below the threshold. Triggers emergency GC
 * when total signal count exceeds the cap, removing the oldest 10%.
 *
 * @module core/field/gc-scheduler
 * @version 9.0.0
 */

import { isExpired } from './forward-decay.js'

export class GCScheduler {
  /**
   * @param {Object} opts
   * @param {Object} opts.backend     - 信号后端实例（需实现 scan/remove/count） / Signal backend instance
   * @param {number} [opts.intervalMs=60000] - GC 间隔毫秒 / GC interval in ms
   * @param {number} [opts.threshold=0.001]  - 过期阈值 / Expiry threshold
   * @param {number} [opts.maxSignals=100000] - 信号数量上限 / Maximum signal count
   */
  constructor({ backend, intervalMs = 60000, threshold = 0.001, maxSignals = 100000 }) {
    this._backend = backend
    this._intervalMs = intervalMs
    this._threshold = threshold
    this._maxSignals = maxSignals

    // 统计数据 / Statistics
    this._lastGCTime = 0
    this._lastRemoved = 0
    this._totalRemoved = 0
    this._runs = 0
    this._emergencyRuns = 0

    // 定时器句柄 / Timer handle
    this._timer = null
  }

  /**
   * 启动定时 GC
   * Start periodic GC
   */
  start() {
    if (this._timer) return
    this._timer = setInterval(() => {
      this.runGC(Date.now())
    }, this._intervalMs)
    // 不阻止进程退出 / Don't prevent process exit
    if (this._timer.unref) this._timer.unref()
  }

  /**
   * 停止定时 GC
   * Stop periodic GC
   */
  stop() {
    if (this._timer) {
      clearInterval(this._timer)
      this._timer = null
    }
  }

  /**
   * 执行一次常规 GC
   * Run a regular GC cycle
   *
   * @param {number} now - 当前时间戳 / Current timestamp
   * @returns {{ removed: number, remaining: number, durationMs: number }}
   */
  runGC(now) {
    const start = Date.now()
    this._runs++

    // 扫描全部信号 / Scan all signals
    const allSignals = this._backend.scan({})
    const expiredIds = []

    for (const sig of allSignals) {
      if (isExpired(sig.strength, sig.lambda, sig.emitTime, now, this._threshold)) {
        expiredIds.push(sig.id)
      }
    }

    // 批量移除过期信号 / Batch remove expired signals
    const removed = expiredIds.length > 0
      ? this._backend.remove(expiredIds)
      : 0

    this._lastGCTime = now
    this._lastRemoved = removed
    this._totalRemoved += removed

    const remaining = this._backend.count()
    const durationMs = Date.now() - start

    return { removed, remaining, durationMs }
  }

  /**
   * 执行紧急 GC：常规 GC + 如果仍超限则移除最旧的 10%
   * Run emergency GC: regular GC + if still over limit, remove oldest 10%
   *
   * @param {number} now - 当前时间戳 / Current timestamp
   * @returns {{ removed: number, remaining: number, durationMs: number, emergency: boolean }}
   */
  runEmergencyGC(now) {
    const start = Date.now()
    this._emergencyRuns++

    // 第一步：常规 GC / Step 1: regular GC
    const regularResult = this.runGC(now)
    let totalRemoved = regularResult.removed
    let remaining = regularResult.remaining
    let emergency = false

    // 第二步：如果仍超限，移除最旧的 10% / Step 2: if still over limit, remove oldest 10%
    if (remaining > this._maxSignals) {
      emergency = true
      const allSignals = this._backend.scan({ sortBy: 'emitTime' })
      const removeCount = Math.ceil(remaining * 0.1)
      const oldestIds = allSignals.slice(0, removeCount).map(s => s.id)

      if (oldestIds.length > 0) {
        const emergencyRemoved = this._backend.remove(oldestIds)
        totalRemoved += emergencyRemoved
        this._totalRemoved += emergencyRemoved
      }

      remaining = this._backend.count()
    }

    this._lastRemoved = totalRemoved
    const durationMs = Date.now() - start

    return { removed: totalRemoved, remaining, durationMs, emergency }
  }

  /**
   * 获取 GC 统计数据
   * Get GC statistics
   *
   * @returns {{ lastGCTime: number, lastRemoved: number, totalRemoved: number, runs: number, emergencyRuns: number }}
   */
  getStats() {
    return {
      lastGCTime: this._lastGCTime,
      lastRemoved: this._lastRemoved,
      totalRemoved: this._totalRemoved,
      runs: this._runs,
      emergencyRuns: this._emergencyRuns,
    }
  }
}
