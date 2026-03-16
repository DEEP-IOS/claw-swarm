/**
 * gc-scheduler.js 单元测试
 * Tests for GCScheduler: runGC, runEmergencyGC, getStats, start/stop
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { GCScheduler } from '../../../src/core/field/gc-scheduler.js'
import { MemoryBackend } from '../../../src/core/field/backends/memory.js'

/** helper: create a signal with fixed timing */
function makeSig(id, strength, lambda, emitTime) {
  return {
    id,
    dimension: 'trail',
    scope: 'test',
    strength,
    lambda,
    emitTime,
    encodedScore: 0,
    emitterId: 'gc-test',
  }
}

describe('GCScheduler', () => {
  let backend
  let gc

  beforeEach(() => {
    backend = new MemoryBackend()
    gc = new GCScheduler({ backend, intervalMs: 1000, threshold: 0.001, maxSignals: 10 })
  })

  afterEach(() => {
    gc.stop()
  })

  // ── runGC ──────────────────────────────────────────────────────────────
  describe('runGC', () => {
    it('should remove expired signals and keep live ones', () => {
      const NOW = 100_000
      // expired: high lambda, old emitTime -> strength ~ 0
      backend.put(makeSig('expired-1', 0.5, 0.1, 0))
      // live: lambda=0 -> never decays
      backend.put(makeSig('live-1', 0.8, 0, 50_000))

      const result = gc.runGC(NOW)
      expect(result.removed).toBe(1)
      expect(result.remaining).toBe(1)
      expect(typeof result.durationMs).toBe('number')
    })

    it('should remove 0 when no signals are expired', () => {
      const NOW = 100
      backend.put(makeSig('fresh-1', 0.9, 0.001, NOW))
      backend.put(makeSig('fresh-2', 0.8, 0.001, NOW))

      const result = gc.runGC(NOW)
      expect(result.removed).toBe(0)
      expect(result.remaining).toBe(2)
    })
  })

  // ── runEmergencyGC ─────────────────────────────────────────────────────
  describe('runEmergencyGC', () => {
    it('should evict the oldest 10% when count exceeds maxSignals', () => {
      const NOW = 50
      // maxSignals = 10; insert 12 non-expired signals (lambda=0, never expire)
      for (let i = 0; i < 12; i++) {
        backend.put(makeSig(`s-${i}`, 0.9, 0, i))
      }
      expect(backend.count()).toBe(12)

      const result = gc.runEmergencyGC(NOW)
      // regular GC removes 0 (lambda=0 never expires), then emergency removes ceil(12*0.1)=2
      expect(result.emergency).toBe(true)
      expect(result.removed).toBe(2)
      expect(result.remaining).toBe(10)
    })

    it('should not trigger emergency removal when count is within limit', () => {
      const NOW = 50
      for (let i = 0; i < 5; i++) {
        backend.put(makeSig(`s-${i}`, 0.9, 0, i))
      }

      const result = gc.runEmergencyGC(NOW)
      expect(result.emergency).toBe(false)
      expect(result.removed).toBe(0)
      expect(result.remaining).toBe(5)
    })
  })

  // ── getStats ───────────────────────────────────────────────────────────
  describe('getStats', () => {
    it('should accumulate runs and totalRemoved', () => {
      const NOW = 100_000
      backend.put(makeSig('e1', 0.5, 0.1, 0))
      backend.put(makeSig('e2', 0.5, 0.1, 0))

      gc.runGC(NOW)
      gc.runGC(NOW)

      const stats = gc.getStats()
      expect(stats.runs).toBe(2)
      expect(stats.totalRemoved).toBe(2) // removed 2 in first run, 0 in second
      expect(stats.lastGCTime).toBe(NOW)
    })

    it('should count emergencyRuns separately', () => {
      gc.runEmergencyGC(1000)
      const stats = gc.getStats()
      // emergencyRuns increments in runEmergencyGC, and runGC increments runs inside it
      expect(stats.emergencyRuns).toBe(1)
      expect(stats.runs).toBeGreaterThanOrEqual(1)
    })
  })

  // ── start / stop ───────────────────────────────────────────────────────
  describe('start / stop', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('should invoke GC on interval and stop cleanly', () => {
      backend.put(makeSig('x', 0.5, 0.1, 0))
      gc.start()

      // advance by one interval
      vi.advanceTimersByTime(1000)
      const stats = gc.getStats()
      expect(stats.runs).toBeGreaterThanOrEqual(1)

      gc.stop()
      const runsAfterStop = gc.getStats().runs

      // advance again — should NOT trigger more runs
      vi.advanceTimersByTime(3000)
      expect(gc.getStats().runs).toBe(runsAfterStop)
    })

    it('should be idempotent on double start / stop', () => {
      gc.start()
      gc.start() // second call is a no-op
      gc.stop()
      gc.stop() // safe to call again
    })
  })
})
