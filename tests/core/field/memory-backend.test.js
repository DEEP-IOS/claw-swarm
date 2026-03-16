/**
 * memory.js (MemoryBackend) 单元测试
 * Tests for triple-indexed in-memory signal backend: put, scan, remove, count, clear, stats
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { MemoryBackend } from '../../../src/core/field/backends/memory.js'

function makeSignal(overrides = {}) {
  return {
    id: overrides.id || `sig-${Math.random().toString(36).slice(2, 8)}`,
    dimension: overrides.dimension || 'trail',
    scope: overrides.scope || 'default',
    strength: overrides.strength ?? 0.8,
    lambda: overrides.lambda ?? 0.01,
    emitTime: overrides.emitTime ?? Date.now(),
    encodedScore: overrides.encodedScore ?? 0,
    emitterId: overrides.emitterId || 'system',
    ...(overrides.metadata ? { metadata: overrides.metadata } : {}),
  }
}

describe('MemoryBackend', () => {
  let backend

  beforeEach(() => {
    backend = new MemoryBackend()
  })

  // ── put + count ────────────────────────────────────────────────────────
  describe('put / count', () => {
    it('should increment count for each inserted signal', () => {
      backend.put(makeSignal({ id: 'a' }))
      backend.put(makeSignal({ id: 'b' }))
      backend.put(makeSignal({ id: 'c' }))
      expect(backend.count()).toBe(3)
    })

    it('should overwrite when the same id is put again', () => {
      backend.put(makeSignal({ id: 'dup', strength: 0.5 }))
      backend.put(makeSignal({ id: 'dup', strength: 0.9 }))
      expect(backend.count()).toBe(1)
      const results = backend.scan({})
      expect(results[0].strength).toBe(0.9)
    })
  })

  // ── scan ───────────────────────────────────────────────────────────────
  describe('scan', () => {
    it('should return all signals with empty filter', () => {
      backend.put(makeSignal({ id: 's1' }))
      backend.put(makeSignal({ id: 's2' }))
      expect(backend.scan({}).length).toBe(2)
    })

    it('should filter by scope', () => {
      backend.put(makeSignal({ id: 's1', scope: 'task-1' }))
      backend.put(makeSignal({ id: 's2', scope: 'task-2' }))
      backend.put(makeSignal({ id: 's3', scope: 'task-1' }))
      const results = backend.scan({ scope: 'task-1' })
      expect(results.length).toBe(2)
      results.forEach(s => expect(s.scope).toBe('task-1'))
    })

    it('should filter by dimension', () => {
      backend.put(makeSignal({ id: 's1', dimension: 'trail' }))
      backend.put(makeSignal({ id: 's2', dimension: 'alarm' }))
      backend.put(makeSignal({ id: 's3', dimension: 'trail' }))
      const results = backend.scan({ dimension: 'trail' })
      expect(results.length).toBe(2)
      results.forEach(s => expect(s.dimension).toBe('trail'))
    })

    it('should intersect scope + dimension filters', () => {
      backend.put(makeSignal({ id: 's1', scope: 'x', dimension: 'trail' }))
      backend.put(makeSignal({ id: 's2', scope: 'x', dimension: 'alarm' }))
      backend.put(makeSignal({ id: 's3', scope: 'y', dimension: 'trail' }))
      const results = backend.scan({ scope: 'x', dimension: 'trail' })
      expect(results.length).toBe(1)
      expect(results[0].id).toBe('s1')
    })

    it('should return empty when scope or dimension has no matches', () => {
      backend.put(makeSignal({ id: 's1', scope: 'a', dimension: 'trail' }))
      expect(backend.scan({ scope: 'nonexistent' })).toHaveLength(0)
      expect(backend.scan({ dimension: 'nonexistent' })).toHaveLength(0)
      expect(backend.scan({ scope: 'a', dimension: 'nonexistent' })).toHaveLength(0)
    })

    it('should apply secondary emitterId filter', () => {
      backend.put(makeSignal({ id: 's1', emitterId: 'agent-1' }))
      backend.put(makeSignal({ id: 's2', emitterId: 'agent-2' }))
      backend.put(makeSignal({ id: 's3', emitterId: 'agent-1' }))
      const results = backend.scan({ emitterId: 'agent-1' })
      expect(results.length).toBe(2)
      results.forEach(s => expect(s.emitterId).toBe('agent-1'))
    })

    it('should filter by maxAge', () => {
      const now = Date.now()
      backend.put(makeSignal({ id: 'old', emitTime: now - 10000 }))
      backend.put(makeSignal({ id: 'new', emitTime: now }))
      const results = backend.scan({ maxAge: 5000 })
      expect(results.length).toBe(1)
      expect(results[0].id).toBe('new')
    })

    it('should sort by strength descending', () => {
      backend.put(makeSignal({ id: 'lo', strength: 0.2 }))
      backend.put(makeSignal({ id: 'hi', strength: 0.9 }))
      backend.put(makeSignal({ id: 'mid', strength: 0.5 }))
      const results = backend.scan({ sortBy: 'strength' })
      expect(results[0].strength).toBe(0.9)
      expect(results[1].strength).toBe(0.5)
      expect(results[2].strength).toBe(0.2)
    })

    it('should sort by emitTime ascending', () => {
      backend.put(makeSignal({ id: 'last', emitTime: 3000 }))
      backend.put(makeSignal({ id: 'first', emitTime: 1000 }))
      backend.put(makeSignal({ id: 'mid', emitTime: 2000 }))
      const results = backend.scan({ sortBy: 'emitTime' })
      expect(results[0].emitTime).toBe(1000)
      expect(results[1].emitTime).toBe(2000)
      expect(results[2].emitTime).toBe(3000)
    })

    it('should respect limit', () => {
      for (let i = 0; i < 10; i++) {
        backend.put(makeSignal({ id: `s-${i}` }))
      }
      const results = backend.scan({ limit: 3 })
      expect(results.length).toBe(3)
    })
  })

  // ── remove ─────────────────────────────────────────────────────────────
  describe('remove', () => {
    it('should remove signals from all three indexes', () => {
      backend.put(makeSignal({ id: 'r1', scope: 'sc', dimension: 'trail' }))
      backend.put(makeSignal({ id: 'r2', scope: 'sc', dimension: 'alarm' }))
      const removed = backend.remove(['r1'])
      expect(removed).toBe(1)
      expect(backend.count()).toBe(1)
      expect(backend.scan({ scope: 'sc' }).length).toBe(1)
      expect(backend.scan({ dimension: 'trail' })).toHaveLength(0)
    })

    it('should return 0 for non-existent ids', () => {
      expect(backend.remove(['ghost'])).toBe(0)
    })

    it('should clean up empty scope from scopeIndex after removal', () => {
      backend.put(makeSignal({ id: 'only', scope: 'lonely' }))
      backend.remove(['only'])
      // scope "lonely" should be gone from scopeIndex
      expect(backend.scan({ scope: 'lonely' })).toHaveLength(0)
      expect(backend.stats().scopeCount).toBe(0)
    })
  })

  // ── clear ──────────────────────────────────────────────────────────────
  describe('clear', () => {
    it('should empty all indexes', () => {
      backend.put(makeSignal({ id: 'a' }))
      backend.put(makeSignal({ id: 'b', scope: 'other', dimension: 'alarm' }))
      backend.clear()
      expect(backend.count()).toBe(0)
      expect(backend.scan({}).length).toBe(0)
      expect(backend.stats().scopeCount).toBe(0)
      expect(backend.stats().dimensionCount).toBe(0)
    })
  })

  // ── stats ──────────────────────────────────────────────────────────────
  describe('stats', () => {
    it('should report correct signalCount, scopeCount, dimensionCount', () => {
      backend.put(makeSignal({ id: 'a', scope: 's1', dimension: 'trail' }))
      backend.put(makeSignal({ id: 'b', scope: 's2', dimension: 'trail' }))
      backend.put(makeSignal({ id: 'c', scope: 's1', dimension: 'alarm' }))

      const s = backend.stats()
      expect(s.signalCount).toBe(3)
      expect(s.scopeCount).toBe(2)   // s1, s2
      expect(s.dimensionCount).toBe(2) // trail, alarm
      expect(s.memoryEstimateBytes).toBeGreaterThan(0)
    })
  })
})
