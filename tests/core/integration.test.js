/**
 * V9 R0 Integration Tests
 * End-to-end scenarios combining SignalStore + DomainStore + EventBus + SnapshotManager
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { SignalStore } from '../../src/core/field/signal-store.js'
import { EventBus } from '../../src/core/bus/event-bus.js'
import { DomainStore } from '../../src/core/store/domain-store.js'
import { SnapshotManager } from '../../src/core/store/snapshot-manager.js'
import { ALL_DIMENSIONS } from '../../src/core/field/types.js'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

describe('V9 R0 Integration', () => {
  let eventBus
  let signalStore
  let tmpDir

  beforeEach(async () => {
    eventBus = new EventBus()
    signalStore = new SignalStore({ eventBus, maxSignals: 200000, gcIntervalMs: 600_000 })
    tmpDir = await mkdtemp(path.join(tmpdir(), 'v9-integ-'))
  })

  afterEach(async () => {
    await signalStore.stop()
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {})
  })

  // ── Scenario 1: Multi-dimension signal emit -> superpose -> 12D vector ──
  describe('multi-dimension emit + superpose', () => {
    it('should superpose 5 different dimension signals into a 12D vector', () => {
      const dims = ['trail', 'alarm', 'reputation', 'task', 'knowledge']
      const strengths = [0.9, 0.7, 0.5, 0.3, 0.1]

      for (let i = 0; i < dims.length; i++) {
        signalStore.emit({
          dimension: dims[i],
          scope: 'task-1',
          strength: strengths[i],
          emitterId: 'agent-a',
        })
      }

      const vec = signalStore.superpose('task-1')

      // vector must have all 12 dimensions as keys
      expect(Object.keys(vec)).toHaveLength(12)
      for (const dim of ALL_DIMENSIONS) {
        expect(typeof vec[dim]).toBe('number')
      }

      // emitted dimensions should be non-zero (strength decays negligibly over ~ms)
      for (const dim of dims) {
        expect(vec[dim]).toBeGreaterThan(0)
      }

      // non-emitted dimensions should be zero
      const nonEmitted = ALL_DIMENSIONS.filter(d => !dims.includes(d))
      for (const dim of nonEmitted) {
        expect(vec[dim]).toBe(0)
      }
    })
  })

  // ── Scenario 2: GC cycle removes expired signals ──────────────────────
  describe('GC removes expired signals', () => {
    it('should remove signals with very old emitTime after gc()', () => {
      // emit with emitTime far in the past and small lambda so they expire
      const veryOldTime = Date.now() - 10_000_000 // 10 million ms ago
      signalStore.emit({
        dimension: 'trail',
        scope: 'gc-test',
        strength: 0.5,
        emitterId: 'old-agent',
        lambda: 0.01,
        emitTime: veryOldTime,
      })

      expect(signalStore.stats().signalCount).toBe(1)

      // run GC -- signal should be expired (0.5 * exp(-0.01 * 10_000_000) ~ 0)
      signalStore.gc()

      // after GC, the expired signal should be removed
      expect(signalStore.stats().signalCount).toBe(0)

      // query should return nothing for that scope
      const results = signalStore.query({ scope: 'gc-test' })
      expect(results).toHaveLength(0)
    })
  })

  // ── Scenario 3: DomainStore snapshot -> new store -> restore -> consistent ─
  describe('DomainStore snapshot + restore consistency', () => {
    it('should restore data identically from snapshot', async () => {
      const store1 = new DomainStore({ domain: 'agents', snapshotDir: tmpDir })
      store1.put('agents', 'a1', { name: 'Alpha', score: 95 })
      store1.put('agents', 'a2', { name: 'Beta', score: 82 })
      store1.put('tasks', 't1', { title: 'Explore', status: 'running' })

      await store1.snapshot()

      // create a brand new store with the same domain and dir
      const store2 = new DomainStore({ domain: 'agents', snapshotDir: tmpDir })
      await store2.restore()

      expect(store2.get('agents', 'a1')).toEqual({ name: 'Alpha', score: 95 })
      expect(store2.get('agents', 'a2')).toEqual({ name: 'Beta', score: 82 })
      expect(store2.get('tasks', 't1')).toEqual({ title: 'Explore', status: 'running' })
    })
  })

  // ── Scenario 4: EventBus receives signal emission events ──────────────
  describe('EventBus linkage with SignalStore', () => {
    it('should fire field.signal.emitted event with signalId', () => {
      const received = []
      eventBus.subscribe('field.signal.emitted', (envelope) => {
        received.push(envelope)
      })

      signalStore.emit({
        dimension: 'alarm',
        scope: 'alert-zone',
        strength: 0.8,
        emitterId: 'sensor-1',
      })

      expect(received).toHaveLength(1)
      const env = received[0]
      expect(env.topic).toBe('field.signal.emitted')
      expect(env.data).toBeDefined()
      expect(env.data.payload).toBeDefined()
      expect(typeof env.data.payload.signalId).toBe('string')
      expect(env.data.payload.dimension).toBe('alarm')
      expect(env.data.payload.scope).toBe('alert-zone')
    })
  })

  // ── Scenario 5: Concurrent 100 emits -> count consistency ─────────────
  describe('100 concurrent emits', () => {
    it('should count exactly 100 signals after 100 emits', () => {
      for (let i = 0; i < 100; i++) {
        signalStore.emit({
          dimension: ALL_DIMENSIONS[i % 12],
          scope: `scope-${i % 20}`,
          strength: 0.5 + (i % 5) * 0.1,
          emitterId: `agent-${i % 10}`,
        })
      }

      expect(signalStore.stats().signalCount).toBe(100)
      expect(signalStore.stats().totalEmitted).toBe(100)
    })
  })

  // ── Scenario 6: SnapshotManager manages multiple DomainStores ─────────
  describe('SnapshotManager with multiple DomainStores', () => {
    it('should snapshotAll and restoreAll across 2 stores', async () => {
      const storeA = new DomainStore({ domain: 'config', snapshotDir: tmpDir })
      const storeB = new DomainStore({ domain: 'metrics', snapshotDir: tmpDir })

      storeA.put('settings', 'theme', { mode: 'dark', fontSize: 14 })
      storeB.put('counters', 'requests', { total: 9001 })
      storeB.put('counters', 'errors', { total: 42 })

      const mgr1 = new SnapshotManager({ snapshotDir: tmpDir })
      mgr1.register(storeA)
      mgr1.register(storeB)

      const snapResult = await mgr1.snapshotAll()
      expect(snapResult.succeeded).toContain('config')
      expect(snapResult.succeeded).toContain('metrics')
      expect(snapResult.failed).toHaveLength(0)

      // create fresh stores and a new SnapshotManager
      const storeA2 = new DomainStore({ domain: 'config', snapshotDir: tmpDir })
      const storeB2 = new DomainStore({ domain: 'metrics', snapshotDir: tmpDir })

      const mgr2 = new SnapshotManager({ snapshotDir: tmpDir })
      mgr2.register(storeA2)
      mgr2.register(storeB2)

      const restoreResult = await mgr2.restoreAll()
      expect(restoreResult.succeeded).toContain('config')
      expect(restoreResult.succeeded).toContain('metrics')

      // verify data consistency
      expect(storeA2.get('settings', 'theme')).toEqual({ mode: 'dark', fontSize: 14 })
      expect(storeB2.get('counters', 'requests')).toEqual({ total: 9001 })
      expect(storeB2.get('counters', 'errors')).toEqual({ total: 42 })
    })
  })
})
