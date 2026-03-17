/**
 * Unit tests for ResourceArbiter
 * File locking (read-shared/write-exclusive), rate limits, tool concurrency
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ResourceArbiter } from '../../../src/orchestration/scheduling/resource-arbiter.js'

describe('ResourceArbiter', () => {
  let arbiter
  let mockField
  let mockBus
  let mockZoneManager

  beforeEach(() => {
    mockField = {
      emit: vi.fn(),
      query: vi.fn().mockReturnValue([]),
    }
    mockBus = {
      publish: vi.fn(),
    }
    mockZoneManager = {
      identifyZone: vi.fn().mockReturnValue('core'),
      getZoneLockGranularity: vi.fn().mockReturnValue('file'),
    }
    arbiter = new ResourceArbiter({
      field: mockField,
      bus: mockBus,
      zoneManager: mockZoneManager,
    })
  })

  // ════════════════════════════════════════════════════════════════
  //  File Locking Tests
  // ════════════════════════════════════════════════════════════════

  // ── 1) read lock shared: two readers succeed ─────────────────────────
  it('allows multiple readers to acquire shared read locks', () => {
    const r1 = arbiter.acquireLock('agent-1', 'src/main.js', 'read')
    const r2 = arbiter.acquireLock('agent-2', 'src/main.js', 'read')

    expect(r1.acquired).toBe(true)
    expect(r2.acquired).toBe(true)
  })

  // ── 2) write lock exclusive: reader + writer -> writer waits ─────────
  it('blocks writer when file is read-locked', () => {
    arbiter.acquireLock('agent-1', 'src/main.js', 'read')
    const w = arbiter.acquireLock('agent-2', 'src/main.js', 'write')

    expect(w.acquired).toBe(false)
    expect(w.waiters).toBe(1)
  })

  // ── 3) write lock exclusive: writer + writer -> second waits ─────────
  it('blocks second writer when file is write-locked', () => {
    const w1 = arbiter.acquireLock('agent-1', 'src/main.js', 'write')
    const w2 = arbiter.acquireLock('agent-2', 'src/main.js', 'write')

    expect(w1.acquired).toBe(true)
    expect(w2.acquired).toBe(false)
    expect(w2.waiters).toBe(1)
  })

  // ── extra: reader blocked by writer ──────────────────────────────────
  it('blocks reader when file is write-locked', () => {
    arbiter.acquireLock('agent-1', 'src/main.js', 'write')
    const r = arbiter.acquireLock('agent-2', 'src/main.js', 'read')

    expect(r.acquired).toBe(false)
    expect(r.waiters).toBe(1)
  })

  // ── 4) releaseLock -> waiter automatically acquires ──────────────────
  it('grants lock to next waiter when current holder releases', () => {
    // Agent-1 acquires write lock
    arbiter.acquireLock('agent-1', 'src/main.js', 'write')
    // Agent-2 waits for write
    arbiter.acquireLock('agent-2', 'src/main.js', 'write')

    // Release agent-1's lock
    arbiter.releaseLock('agent-1', 'src/main.js')

    // Verify agent-2 was granted the lock (bus event published)
    const acquiredEvents = mockBus.publish.mock.calls.filter(
      ([topic, data]) => topic === 'resource.lock.acquired' && data.agentId === 'agent-2'
    )
    expect(acquiredEvents.length).toBeGreaterThanOrEqual(1)
  })

  // ── 5) core zone -> file-level lock (each file gets own path as key) ─
  it('uses file-level granularity for core zone', () => {
    // _resolveLockKey calls zoneManager.getZoneLockGranularity(filePath).
    // The return value IS the lock key. For file-level locks, we return
    // the file path itself so each file has its own lock.
    mockZoneManager.getZoneLockGranularity.mockImplementation((fp) => fp)

    // Two different files in core zone should have independent locks
    const r1 = arbiter.acquireLock('agent-1', 'src/core/a.js', 'write')
    const r2 = arbiter.acquireLock('agent-2', 'src/core/b.js', 'write')

    expect(r1.acquired).toBe(true)
    expect(r2.acquired).toBe(true)

    expect(mockZoneManager.getZoneLockGranularity).toHaveBeenCalled()
  })

  // ── 6) test zone -> directory-level lock ─────────────────────────────
  it('uses directory-level granularity for test zone', () => {
    // For directory-level locks, all files in the same directory share
    // a single lock key. We simulate this by returning a directory path.
    mockZoneManager.getZoneLockGranularity.mockReturnValue('tests/')

    // Two different files in test zone share the same lock key
    const r1 = arbiter.acquireLock('agent-1', 'tests/a.test.js', 'write')
    const r2 = arbiter.acquireLock('agent-2', 'tests/b.test.js', 'write')

    // Both resolve to same lock key 'tests/', so second is blocked
    expect(r1.acquired).toBe(true)
    expect(r2.acquired).toBe(false)
  })

  // ════════════════════════════════════════════════════════════════
  //  Rate Limiting Tests
  // ════════════════════════════════════════════════════════════════

  // ── 7) API rate limit: exceed -> returns false ───────────────────────
  it('blocks requests when rate limit is exhausted', () => {
    // Default rate limit: maxTokens=60 for 'default' provider
    // Consume all tokens
    for (let i = 0; i < 60; i++) {
      const allowed = arbiter.checkRateLimit('default')
      expect(allowed).toBe(true)
    }

    // 61st request should be blocked
    const blocked = arbiter.checkRateLimit('default')
    expect(blocked).toBe(false)
  })

  // ════════════════════════════════════════════════════════════════
  //  Tool Concurrency Tests
  // ════════════════════════════════════════════════════════════════

  // ── 8) write tool max 1 -> second request blocked ────────────────────
  it('limits write tool to max 1 concurrent execution', () => {
    // Default: toolConcurrency.write = 1
    const first = arbiter.checkToolConcurrency('write')
    expect(first).toBe(true)

    const second = arbiter.checkToolConcurrency('write')
    expect(second).toBe(false)
  })

  it('allows tool concurrency again after slot release', () => {
    arbiter.checkToolConcurrency('write')
    arbiter.releaseToolSlot('write')

    const next = arbiter.checkToolConcurrency('write')
    expect(next).toBe(true)
  })

  it('allows multiple concurrent reads up to configured limit', () => {
    // Default: toolConcurrency.read = 10
    for (let i = 0; i < 10; i++) {
      expect(arbiter.checkToolConcurrency('read')).toBe(true)
    }
    expect(arbiter.checkToolConcurrency('read')).toBe(false)
  })

  it('allows unknown tools (no gate configured)', () => {
    expect(arbiter.checkToolConcurrency('unknown-tool')).toBe(true)
  })

  // ════════════════════════════════════════════════════════════════
  //  Conflict Detection Tests
  // ════════════════════════════════════════════════════════════════

  it('detects conflict between holder and waiter', () => {
    arbiter.acquireLock('agent-A', 'src/file.js', 'write')
    arbiter.acquireLock('agent-B', 'src/file.js', 'write')

    const result = arbiter.detectConflict('agent-A', 'agent-B', 'src/file.js')
    expect(result.conflict).toBe(true)
    expect(['wait', 'merge', 'abort']).toContain(result.strategy)
  })

  it('reports no conflict when no lock exists', () => {
    const result = arbiter.detectConflict('agent-A', 'agent-B', 'src/none.js')
    expect(result.conflict).toBe(false)
    expect(result.strategy).toBe('none')
  })

  // ── extra: bus events on lock acquire/release ────────────────────────
  it('publishes bus events on lock acquire and release', () => {
    arbiter.acquireLock('agent-1', 'src/x.js', 'write')
    expect(mockBus.publish).toHaveBeenCalledWith('resource.lock.acquired', expect.objectContaining({
      agentId: 'agent-1',
      filePath: 'src/x.js',
      mode: 'write',
    }))

    arbiter.releaseLock('agent-1', 'src/x.js')
    expect(mockBus.publish).toHaveBeenCalledWith('resource.lock.released', expect.objectContaining({
      agentId: 'agent-1',
    }))
  })
})
