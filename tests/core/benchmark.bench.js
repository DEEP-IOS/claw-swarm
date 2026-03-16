/**
 * V9 R0 Performance Benchmarks
 * Vitest bench mode — SignalStore + DomainStore throughput baselines
 */
import { describe, bench } from 'vitest'
import { SignalStore } from '../../src/core/field/signal-store.js'
import { DomainStore } from '../../src/core/store/domain-store.js'
import { ALL_DIMENSIONS } from '../../src/core/field/types.js'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

// ── Pre-built stores for read-only benchmarks ─────────────────────────────
// Setup once at module level (bench does not support beforeAll reliably)

const prebuiltSignalStore = new SignalStore({ maxSignals: 200000, gcIntervalMs: 600_000 })
for (let i = 0; i < 10000; i++) {
  prebuiltSignalStore.emit({
    dimension: ALL_DIMENSIONS[i % 12],
    scope: `scope-${i % 100}`,
    strength: Math.random(),
    emitterId: `emitter-${i % 50}`,
  })
}

const benchTmpDir = mkdtempSync(path.join(tmpdir(), 'v9-bench-'))

// ── Benchmark 1: emit throughput ──────────────────────────────────────────
describe('SignalStore emit performance', () => {
  bench('emit 10000 signals', () => {
    const store = new SignalStore({ maxSignals: 200000, gcIntervalMs: 600_000 })
    for (let i = 0; i < 10000; i++) {
      store.emit({
        dimension: ALL_DIMENSIONS[i % 12],
        scope: `scope-${i % 100}`,
        strength: Math.random(),
        emitterId: 'bench',
      })
    }
  })
})

// ── Benchmark 2: query throughput ─────────────────────────────────────────
describe('SignalStore query performance', () => {
  bench('100 queries with mixed filters', () => {
    for (let i = 0; i < 100; i++) {
      prebuiltSignalStore.query({
        scope: `scope-${i % 100}`,
        dimension: ALL_DIMENSIONS[i % 12],
        minStrength: 0.1,
        limit: 20,
      })
    }
  })
})

// ── Benchmark 3: superpose throughput ─────────────────────────────────────
describe('SignalStore superpose performance', () => {
  bench('100 superpose on different scopes', () => {
    for (let i = 0; i < 100; i++) {
      prebuiltSignalStore.superpose(`scope-${i % 100}`)
    }
  })
})

// ── Benchmark 4: GC with 50% expired signals ─────────────────────────────
describe('SignalStore GC performance', () => {
  bench('gc 10000 signals (50% expired)', () => {
    const store = new SignalStore({ maxSignals: 200000, gcIntervalMs: 600_000 })
    const now = Date.now()
    for (let i = 0; i < 10000; i++) {
      store.emit({
        dimension: ALL_DIMENSIONS[i % 12],
        scope: `scope-${i % 100}`,
        strength: 0.5,
        emitterId: 'bench',
        emitTime: i % 2 === 0 ? now - 10_000_000 : now,
        lambda: 0.01,
      })
    }
    store.gc()
  })
})

// ── Benchmark 5: DomainStore put throughput ───────────────────────────────
describe('DomainStore put performance', () => {
  bench('10000 puts', () => {
    const ds = new DomainStore({ domain: 'bench-put', snapshotDir: benchTmpDir })
    for (let i = 0; i < 10000; i++) {
      ds.put('items', `key-${i}`, { idx: i, payload: 'x'.repeat(32) })
    }
  })
})

// ── Benchmark 6: DomainStore snapshot 10000 records ──────────────────────
describe('DomainStore snapshot performance', () => {
  bench('snapshot 10000 records', async () => {
    const ds = new DomainStore({ domain: 'bench-snap', snapshotDir: benchTmpDir })
    for (let i = 0; i < 10000; i++) {
      ds.put('records', `r-${i}`, { idx: i, data: 'bench-data' })
    }
    await ds.snapshot()
  })
})
