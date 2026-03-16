/**
 * GossipProtocol unit tests -- visibility propagation delay model
 * @module tests/communication/stigmergy/gossip-protocol.test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { GossipProtocol } from '../../../src/communication/stigmergy/gossip-protocol.js'

const ROUND = 100 // short round for fast tests

describe('GossipProtocol', () => {
  let gp

  beforeEach(() => {
    vi.useFakeTimers()
    gp = new GossipProtocol({ roundDurationMs: ROUND })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // ── registerAgent ──────────────────────────────────────────

  it('registerAgent increases agentCount', () => {
    expect(gp.getAgentCount()).toBe(0)
    gp.registerAgent('a1', { session: 's1', scope: 'sc1' })
    expect(gp.getAgentCount()).toBe(1)
    gp.registerAgent('a2', { session: 's1', scope: 'sc1' })
    expect(gp.getAgentCount()).toBe(2)
  })

  // ── scheduleVisibility ─────────────────────────────────────

  it('scheduleVisibility increases entryCount', () => {
    gp.registerAgent('a1', { session: 's1', scope: 'sc1' })
    expect(gp.getEntryCount()).toBe(0)
    gp.scheduleVisibility('key1', 'a1', 'sc1', 's1')
    expect(gp.getEntryCount()).toBe(1)
  })

  // ── writer sees own entry immediately ──────────────────────

  it('writer sees own entry immediately', () => {
    gp.registerAgent('a1', { session: 's1', scope: 'sc1' })
    gp.scheduleVisibility('key1', 'a1', 'sc1', 's1')
    expect(gp.isVisible('key1', 'a1')).toBe(true)
  })

  // ── same session agent: 1 round delay ──────────────────────

  it('same-session agent cannot see before 1 round, can see after', () => {
    gp.registerAgent('writer', { session: 'S', scope: 'sc1' })
    gp.registerAgent('reader', { session: 'S', scope: 'sc2' })
    gp.scheduleVisibility('k', 'writer', 'sc1', 'S')

    expect(gp.isVisible('k', 'reader')).toBe(false)
    vi.advanceTimersByTime(ROUND - 1)
    expect(gp.isVisible('k', 'reader')).toBe(false)
    vi.advanceTimersByTime(1)
    expect(gp.isVisible('k', 'reader')).toBe(true)
  })

  // ── same scope agent: 2 round delay ────────────────────────

  it('same-scope agent cannot see before 2 rounds, can see after', () => {
    gp.registerAgent('writer', { session: 'S1', scope: 'SC' })
    gp.registerAgent('reader', { session: 'S2', scope: 'SC' })
    gp.scheduleVisibility('k', 'writer', 'SC', 'S1')

    vi.advanceTimersByTime(2 * ROUND - 1)
    expect(gp.isVisible('k', 'reader')).toBe(false)
    vi.advanceTimersByTime(1)
    expect(gp.isVisible('k', 'reader')).toBe(true)
  })

  // ── global agent: 3 round delay ────────────────────────────

  it('global agent cannot see before 3 rounds, can see after', () => {
    gp.registerAgent('writer', { session: 'S1', scope: 'SC1' })
    gp.registerAgent('reader', { session: 'S2', scope: 'SC2' })
    gp.scheduleVisibility('k', 'writer', 'SC1', 'S1')

    vi.advanceTimersByTime(3 * ROUND - 1)
    expect(gp.isVisible('k', 'reader')).toBe(false)
    vi.advanceTimersByTime(1)
    expect(gp.isVisible('k', 'reader')).toBe(true)
  })

  // ── getVisibilityStatus progression ────────────────────────

  it('getVisibilityStatus transitions through all stages', () => {
    gp.registerAgent('w', { session: 'S', scope: 'SC' })
    gp.scheduleVisibility('k', 'w', 'SC', 'S')

    expect(gp.getVisibilityStatus('k')).toBe('writer-only')
    vi.advanceTimersByTime(ROUND)
    expect(gp.getVisibilityStatus('k')).toBe('session')
    vi.advanceTimersByTime(ROUND)
    expect(gp.getVisibilityStatus('k')).toBe('scope')
    vi.advanceTimersByTime(ROUND)
    expect(gp.getVisibilityStatus('k')).toBe('global')
  })

  // ── non-existent entry → visible ───────────────────────────

  it('non-existent entry returns isVisible=true', () => {
    gp.registerAgent('a1', { session: 's', scope: 'sc' })
    expect(gp.isVisible('no-such-key', 'a1')).toBe(true)
  })

  // ── non-existent entry → getVisibilityStatus returns global ─

  it('non-existent entry returns getVisibilityStatus=global', () => {
    expect(gp.getVisibilityStatus('no-such-key')).toBe('global')
  })

  // ── unregistered reader treated as global (max delay) ──────

  it('unregistered reader treated as global delay', () => {
    gp.registerAgent('writer', { session: 'S1', scope: 'SC1' })
    gp.scheduleVisibility('k', 'writer', 'SC1', 'S1')

    // 'stranger' is not registered
    vi.advanceTimersByTime(3 * ROUND - 1)
    expect(gp.isVisible('k', 'stranger')).toBe(false)
    vi.advanceTimersByTime(1)
    expect(gp.isVisible('k', 'stranger')).toBe(true)
  })
})
