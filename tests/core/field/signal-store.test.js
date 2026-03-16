/**
 * signal-store.js 单元测试
 * Tests for SignalStore: emit, query, superpose, gc, events, lifecycle, ModuleBase contract
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  SignalStore,
  FIELD_SIGNAL_EMITTED,
  FIELD_GC_COMPLETED,
  FIELD_EMERGENCY_GC,
} from '../../../src/core/field/signal-store.js'
import { EventBus } from '../../../src/core/bus/event-bus.js'
import { ALL_DIMENSIONS, DEFAULT_LAMBDA } from '../../../src/core/field/types.js'

describe('SignalStore', () => {
  let store
  let eventBus

  beforeEach(() => {
    eventBus = new EventBus()
    store = new SignalStore({ eventBus, maxSignals: 100, gcIntervalMs: 600_000 })
  })

  afterEach(async () => {
    await store.stop()
  })

  // ── ModuleBase contract ────────────────────────────────────────────────
  describe('ModuleBase static contract', () => {
    it('produces() should return all 12 dimensions', () => {
      const p = SignalStore.produces()
      expect(p).toHaveLength(ALL_DIMENSIONS.length)
      for (const d of ALL_DIMENSIONS) {
        expect(p).toContain(d)
      }
    })

    it('consumes() should return empty array', () => {
      expect(SignalStore.consumes()).toEqual([])
    })

    it('publishes() should return the three event topics', () => {
      const topics = SignalStore.publishes()
      expect(topics).toContain(FIELD_SIGNAL_EMITTED)
      expect(topics).toContain(FIELD_GC_COMPLETED)
      expect(topics).toContain(FIELD_EMERGENCY_GC)
    })

    it('subscribes() should return empty array', () => {
      expect(SignalStore.subscribes()).toEqual([])
    })
  })

  // ── emit ───────────────────────────────────────────────────────────────
  describe('emit', () => {
    it('should return a complete Signal with id and encodedScore', () => {
      const sig = store.emit({ dimension: 'trail', scope: 'task-1', strength: 0.7 })
      expect(typeof sig.id).toBe('string')
      expect(sig.id).toHaveLength(12)
      expect(sig.dimension).toBe('trail')
      expect(sig.scope).toBe('task-1')
      expect(sig.strength).toBe(0.7)
      expect(typeof sig.encodedScore).toBe('number')
      expect(sig.emitterId).toBe('system')
    })

    it('should throw on invalid dimension', () => {
      expect(() => store.emit({ dimension: 'bogus', scope: 's', strength: 0.5 }))
        .toThrow(/Invalid dimension/)
    })

    it('should throw on empty scope', () => {
      expect(() => store.emit({ dimension: 'trail', scope: '', strength: 0.5 }))
        .toThrow(/scope/)
    })

    it('should throw on non-number strength', () => {
      expect(() => store.emit({ dimension: 'trail', scope: 's', strength: 'high' }))
        .toThrow(/strength/)
    })

    it('should clamp strength > 1 to 1', () => {
      const sig = store.emit({ dimension: 'trail', scope: 's', strength: 5.0 })
      expect(sig.strength).toBe(1)
    })

    it('should clamp strength < 0 to 0', () => {
      const sig = store.emit({ dimension: 'trail', scope: 's', strength: -2 })
      expect(sig.strength).toBe(0)
    })

    it('should use DEFAULT_LAMBDA when lambda is not specified', () => {
      const sig = store.emit({ dimension: 'alarm', scope: 's', strength: 0.5 })
      expect(sig.lambda).toBe(DEFAULT_LAMBDA['alarm'])
    })

    it('should allow custom lambda', () => {
      const sig = store.emit({ dimension: 'trail', scope: 's', strength: 0.5, lambda: 0.05 })
      expect(sig.lambda).toBe(0.05)
    })

    it('should publish FIELD_SIGNAL_EMITTED event', () => {
      const received = []
      eventBus.subscribe(FIELD_SIGNAL_EMITTED, (envelope) => {
        received.push(envelope)
      })

      store.emit({ dimension: 'trail', scope: 'task-1', strength: 0.6, emitterId: 'agent-a' })

      expect(received).toHaveLength(1)
      expect(received[0].data.payload.dimension).toBe('trail')
      expect(received[0].data.payload.emitterId).toBe('agent-a')
    })

    it('should attach metadata when provided', () => {
      const sig = store.emit({
        dimension: 'knowledge',
        scope: 'k1',
        strength: 0.5,
        metadata: { detail: 'extra' },
      })
      expect(sig.metadata).toEqual({ detail: 'extra' })
    })
  })

  // ── query ──────────────────────────────────────────────────────────────
  describe('query', () => {
    beforeEach(() => {
      store.emit({ dimension: 'trail', scope: 'a', strength: 0.9, emitterId: 'x', lambda: 0 })
      store.emit({ dimension: 'trail', scope: 'b', strength: 0.3, emitterId: 'y', lambda: 0 })
      store.emit({ dimension: 'alarm', scope: 'a', strength: 0.5, emitterId: 'x', lambda: 0 })
    })

    it('should return all signals without filter', () => {
      const results = store.query()
      expect(results.length).toBe(3)
    })

    it('should filter by scope', () => {
      const results = store.query({ scope: 'a' })
      expect(results.length).toBe(2)
      results.forEach(s => expect(s.scope).toBe('a'))
    })

    it('should filter by dimension', () => {
      const results = store.query({ dimension: 'trail' })
      expect(results.length).toBe(2)
      results.forEach(s => expect(s.dimension).toBe('trail'))
    })

    it('should filter by minStrength', () => {
      const results = store.query({ minStrength: 0.4 })
      expect(results.every(s => s._actualStrength >= 0.4)).toBe(true)
    })

    it('should sort by strength descending', () => {
      const results = store.query({ sortBy: 'strength' })
      for (let i = 1; i < results.length; i++) {
        expect(results[i - 1]._actualStrength).toBeGreaterThanOrEqual(results[i]._actualStrength)
      }
    })

    it('should respect limit', () => {
      const results = store.query({ limit: 2 })
      expect(results.length).toBe(2)
    })

    it('should attach _actualStrength to each result', () => {
      const results = store.query()
      results.forEach(s => {
        expect(typeof s._actualStrength).toBe('number')
      })
    })
  })

  // ── superpose ──────────────────────────────────────────────────────────
  describe('superpose', () => {
    it('should return a 12-dim vector for the given scope', () => {
      store.emit({ dimension: 'trail', scope: 'sp', strength: 0.7, lambda: 0 })
      store.emit({ dimension: 'alarm', scope: 'sp', strength: 0.4, lambda: 0 })
      store.emit({ dimension: 'trail', scope: 'other', strength: 0.9, lambda: 0 })

      const vec = store.superpose('sp')
      expect(Object.keys(vec)).toHaveLength(ALL_DIMENSIONS.length)
      expect(vec.trail).toBeGreaterThan(0)
      expect(vec.alarm).toBeGreaterThan(0)
      // "other" scope should not leak into "sp"
      expect(vec.knowledge).toBe(0)
    })
  })

  // ── gc ─────────────────────────────────────────────────────────────────
  describe('gc', () => {
    it('should remove expired signals', () => {
      // emit with very old emitTime and high lambda so it decays fully
      store.emit({ dimension: 'trail', scope: 'g', strength: 0.5, lambda: 1, emitTime: 1 })
      store.emit({ dimension: 'alarm', scope: 'g', strength: 0.8, lambda: 0 }) // never expires

      const result = store.gc()
      expect(result.removed).toBeGreaterThanOrEqual(1)
      expect(result.remaining).toBe(1)
    })

    it('should publish FIELD_GC_COMPLETED event', () => {
      const received = []
      eventBus.subscribe(FIELD_GC_COMPLETED, (envelope) => {
        received.push(envelope)
      })

      store.gc()
      expect(received).toHaveLength(1)
    })
  })

  // ── maxSignals / emergency GC ──────────────────────────────────────────
  describe('maxSignals emergency GC', () => {
    it('should trigger emergency GC when count exceeds maxSignals', () => {
      const smallStore = new SignalStore({ eventBus, maxSignals: 5, gcIntervalMs: 600_000 })
      const emergencyEvents = []
      eventBus.subscribe(FIELD_EMERGENCY_GC, (envelope) => {
        emergencyEvents.push(envelope)
      })

      // emit 6 signals that never expire (lambda=0)
      for (let i = 0; i < 6; i++) {
        smallStore.emit({ dimension: 'trail', scope: `s-${i}`, strength: 0.9, lambda: 0 })
      }

      expect(emergencyEvents.length).toBeGreaterThanOrEqual(1)
      // after emergency GC, count should be <= maxSignals
      const remaining = smallStore.query().length
      expect(remaining).toBeLessThanOrEqual(5)

      smallStore.stop()
    })
  })

  // ── stats ──────────────────────────────────────────────────────────────
  describe('stats', () => {
    it('should return merged backend + GC + operation statistics', () => {
      store.emit({ dimension: 'trail', scope: 'st', strength: 0.5 })
      store.query()
      const s = store.stats()

      expect(s.signalCount).toBeGreaterThanOrEqual(1)
      expect(s.totalEmitted).toBe(1)
      expect(s.totalQueried).toBe(1)
      expect(s.maxSignals).toBe(100)
      expect(typeof s.runs).toBe('number')
      expect(typeof s.scopeCount).toBe('number')
      expect(typeof s.memoryEstimateBytes).toBe('number')
    })
  })

  // ── start / stop ───────────────────────────────────────────────────────
  describe('start / stop lifecycle', () => {
    it('should not throw on start then stop', async () => {
      await expect(store.start()).resolves.toBeUndefined()
      await expect(store.stop()).resolves.toBeUndefined()
    })

    it('should not throw on double stop', async () => {
      await store.start()
      await store.stop()
      await expect(store.stop()).resolves.toBeUndefined()
    })
  })

  // ── edge cases ─────────────────────────────────────────────────────────
  describe('edge cases', () => {
    it('should work without eventBus', () => {
      const bare = new SignalStore({ maxSignals: 50 })
      const sig = bare.emit({ dimension: 'trail', scope: 'solo', strength: 0.5 })
      expect(sig.id).toHaveLength(12)
      bare.gc()
      bare.stop()
    })

    it('should accept custom emitTime', () => {
      const sig = store.emit({ dimension: 'trail', scope: 's', strength: 0.6, emitTime: 42 })
      expect(sig.emitTime).toBe(42)
    })
  })
})
