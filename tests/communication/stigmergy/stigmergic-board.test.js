/**
 * StigmergicBoard unit tests -- write/read/search/list/remove + gossip visibility + field signals
 * @module tests/communication/stigmergy/stigmergic-board.test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { DomainStore } from '../../../src/core/store/domain-store.js'
import { SignalStore } from '../../../src/core/field/signal-store.js'
import { EventBus } from '../../../src/core/bus/event-bus.js'
import { GossipProtocol } from '../../../src/communication/stigmergy/gossip-protocol.js'
import { StigmergicBoard } from '../../../src/communication/stigmergy/stigmergic-board.js'
import { DIM_KNOWLEDGE } from '../../../src/core/field/types.js'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

const ROUND = 100

describe('StigmergicBoard', () => {
  let tmpDir, domainStore, field, eventBus, board

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), 'board-test-'))
    domainStore = new DomainStore({ domain: 'test', snapshotDir: tmpDir })
    eventBus = new EventBus()
    field = new SignalStore({ eventBus })
    board = new StigmergicBoard({ domainStore, field, eventBus })
  })

  afterEach(async () => {
    await field.stop()
    await rm(tmpDir, { recursive: true, force: true })
  })

  // ── write + read ───────────────────────────────────────────

  it('write then read returns consistent data', () => {
    board.write('a1', 'discovery-1', { result: 42 })
    const entry = board.read('discovery-1', 'a1')
    expect(entry).toBeDefined()
    expect(entry.value).toEqual({ result: 42 })
    expect(entry.writtenBy).toBe('a1')
  })

  it('read non-existent key returns undefined', () => {
    expect(board.read('no-key', 'a1')).toBeUndefined()
  })

  // ── domainStore persistence ────────────────────────────────

  it('write stores data in domainStore', () => {
    board.write('a1', 'k1', 'val1')
    expect(domainStore.get('board', 'k1')).toBeDefined()
    expect(domainStore.get('board', 'k1').value).toBe('val1')
  })

  // ── field signal emission ──────────────────────────────────

  it('write emits DIM_KNOWLEDGE signal to field', () => {
    board.write('a1', 'k1', 'data')
    const signals = field.query({ dimension: DIM_KNOWLEDGE })
    expect(signals.length).toBeGreaterThanOrEqual(1)
    const sig = signals.find(s => s.metadata?.key === 'k1')
    expect(sig).toBeDefined()
  })

  // ── eventBus events ────────────────────────────────────────

  it('write publishes stigmergy.entry.written', () => {
    const captured = []
    eventBus.subscribe('stigmergy.entry.written', (env) => captured.push(env.data))
    board.write('a1', 'k1', 'v')
    expect(captured.length).toBe(1)
    expect(captured[0].key).toBe('k1')
  })

  it('read publishes stigmergy.entry.read', () => {
    board.write('a1', 'k1', 'v')
    const captured = []
    eventBus.subscribe('stigmergy.entry.read', (env) => captured.push(env.data))
    board.read('k1', 'reader-1')
    expect(captured.length).toBe(1)
    expect(captured[0].readerAgentId).toBe('reader-1')
  })

  // ── search ─────────────────────────────────────────────────

  it('search matches by key substring', () => {
    board.write('a1', 'api-error-fix', 'fixed timeout')
    board.write('a1', 'db-migration', 'added index')
    const results = board.search('error', 'a1')
    expect(results.length).toBe(1)
    expect(results[0]._key).toBe('api-error-fix')
  })

  it('search matches by value substring', () => {
    board.write('a1', 'k1', 'found memory leak')
    const results = board.search('memory', 'a1')
    expect(results.length).toBe(1)
  })

  it('search with no match returns empty array', () => {
    board.write('a1', 'k1', 'v1')
    expect(board.search('zzz', 'a1')).toEqual([])
  })

  // ── list by scope ──────────────────────────────────────────

  it('list filters by scope', () => {
    board.write('a1', 'k1', 'v1', { scope: 'frontend' })
    board.write('a1', 'k2', 'v2', { scope: 'backend' })
    board.write('a1', 'k3', 'v3', { scope: 'frontend' })
    const fe = board.list('frontend', 'a1')
    expect(fe.length).toBe(2)
    const be = board.list('backend', 'a1')
    expect(be.length).toBe(1)
  })

  // ── gossip visibility ──────────────────────────────────────

  describe('with GossipProtocol', () => {
    let gossip, gBoard

    beforeEach(() => {
      vi.useFakeTimers()
      gossip = new GossipProtocol({ eventBus, roundDurationMs: ROUND })
      gBoard = new StigmergicBoard({ domainStore, field, eventBus, gossipProtocol: gossip })
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('new agent in different session cannot read freshly written entry', () => {
      gossip.registerAgent('writer', { session: 'S1', scope: 'SC' })
      gossip.registerAgent('reader', { session: 'S2', scope: 'SC' })
      gBoard.write('writer', 'finding', 'important data', { scope: 'SC', session: 'S1' })

      // same scope, different session -> 2-round delay
      expect(gBoard.read('finding', 'reader')).toBeUndefined()
    })

    it('entry becomes visible after sufficient time', () => {
      gossip.registerAgent('writer', { session: 'S1', scope: 'SC' })
      gossip.registerAgent('reader', { session: 'S2', scope: 'SC' })
      gBoard.write('writer', 'finding', 'important data', { scope: 'SC', session: 'S1' })

      vi.advanceTimersByTime(2 * ROUND)
      expect(gBoard.read('finding', 'reader')).toBeDefined()
      expect(gBoard.read('finding', 'reader').value).toBe('important data')
    })
  })

  // ── remove ─────────────────────────────────────────────────

  it('author can remove own entry', () => {
    board.write('a1', 'k1', 'v1')
    expect(board.remove('k1', 'a1')).toBe(true)
    expect(board.read('k1', 'a1')).toBeUndefined()
  })

  it('non-author remove throws', () => {
    board.write('a1', 'k1', 'v1')
    expect(() => board.remove('k1', 'other')).toThrow('Only the author')
  })

  it('remove non-existent key returns false', () => {
    expect(board.remove('no-key', 'a1')).toBe(false)
  })

  // ── stats ──────────────────────────────────────────────────

  it('stats returns correct totalEntries', () => {
    expect(board.stats().totalEntries).toBe(0)
    board.write('a1', 'k1', 'v1')
    board.write('a1', 'k2', 'v2')
    expect(board.stats().totalEntries).toBe(2)
    board.remove('k1', 'a1')
    expect(board.stats().totalEntries).toBe(1)
  })

  // ── no gossipProtocol → always visible ─────────────────────

  it('without gossipProtocol read is always visible', () => {
    // board has no gossipProtocol
    board.write('a1', 'k1', 'data')
    expect(board.read('k1', 'unknown-agent')).toBeDefined()
  })
})
