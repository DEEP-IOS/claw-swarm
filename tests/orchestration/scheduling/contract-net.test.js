/**
 * Unit tests for ContractNet
 * Contract Net Protocol for task allocation via bid evaluation
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ContractNet } from '../../../src/orchestration/scheduling/contract-net.js'

describe('ContractNet', () => {
  let contract
  let mockField
  let mockBus
  let mockCapabilityEngine

  beforeEach(() => {
    mockField = {
      emit: vi.fn(),
      query: vi.fn().mockReturnValue([{ strength: 0.6 }]),
    }
    mockBus = {
      publish: vi.fn(),
    }
    mockCapabilityEngine = {
      score: vi.fn().mockReturnValue(0.7),
    }
    contract = new ContractNet({
      field: mockField,
      bus: mockBus,
      capabilityEngine: mockCapabilityEngine,
    })
  })

  // ── 1) 3 candidates -> 3 bids ────────────────────────────────────────
  it('generates one bid per candidate role', () => {
    const bids = contract.issueCall({ description: 'implement feature' }, ['alpha', 'beta', 'gamma'])
    expect(bids).toHaveLength(3)
    expect(bids[0].roleId).toBe('alpha')
    expect(bids[1].roleId).toBe('beta')
    expect(bids[2].roleId).toBe('gamma')
    // Each bid should have all required fields
    for (const bid of bids) {
      expect(bid).toHaveProperty('cost')
      expect(bid).toHaveProperty('qualityEstimate')
      expect(bid).toHaveProperty('speedEstimate')
      expect(bid).toHaveProperty('trustScore')
      expect(bid).toHaveProperty('capabilityScore')
    }
    // Bus event should have been published
    expect(mockBus.publish).toHaveBeenCalledWith('contract.cfp.issued', expect.objectContaining({
      candidateRoles: ['alpha', 'beta', 'gamma'],
    }))
  })

  // ── 2) budgetTight -> CHEAP role gets bonus ───────────────────────────
  it('awards budget bonus to CHEAP roles when budgetTight', () => {
    const bids = [
      { roleId: 'fast-worker', cost: 'CHEAP', qualityEstimate: 0.5, speedEstimate: 0.5, trustScore: 0.5, capabilityScore: 0.5 },
      { roleId: 'normal', cost: 'MODERATE', qualityEstimate: 0.5, speedEstimate: 0.5, trustScore: 0.5, capabilityScore: 0.5 },
    ]

    const result = contract.evaluateBids(bids, { budgetTight: true })
    expect(result.winner.roleId).toBe('fast-worker')
    // CHEAP bid gets +0.15 bonus
    // fast-worker: 0.5*0.35 + 0.5*0.25 + 0.5*0.25 + 0.15 = 0.575
    // normal:      0.5*0.35 + 0.5*0.25 + 0.5*0.25          = 0.425
    expect(result.score).toBeCloseTo(0.575, 3)
  })

  // ── 3) timeTight -> fast role gets bonus ──────────────────────────────
  it('awards speed bonus to fast roles when timeTight', () => {
    const bids = [
      { roleId: 'slow', cost: 'MODERATE', qualityEstimate: 0.5, speedEstimate: 0.3, trustScore: 0.5, capabilityScore: 0.5 },
      { roleId: 'fast', cost: 'MODERATE', qualityEstimate: 0.5, speedEstimate: 0.8, trustScore: 0.5, capabilityScore: 0.5 },
    ]

    const result = contract.evaluateBids(bids, { timeTight: true })
    expect(result.winner.roleId).toBe('fast')
    // fast: 0.5*0.35 + 0.5*0.25 + 0.5*0.25 + 0.15 (speed>0.7) = 0.575
    // slow: 0.5*0.35 + 0.5*0.25 + 0.5*0.25                     = 0.425
    expect(result.score).toBeCloseTo(0.575, 3)
  })

  // ── 4) riskHigh -> high quality role gets bonus ──────────────────────
  it('awards quality-risk bonus when riskHigh', () => {
    const bids = [
      { roleId: 'low-q', cost: 'MODERATE', qualityEstimate: 0.3, speedEstimate: 0.5, trustScore: 0.5, capabilityScore: 0.5 },
      { roleId: 'high-q', cost: 'MODERATE', qualityEstimate: 0.9, speedEstimate: 0.5, trustScore: 0.5, capabilityScore: 0.5 },
    ]

    const result = contract.evaluateBids(bids, { riskHigh: true })
    expect(result.winner.roleId).toBe('high-q')
    // high-q: 0.5*0.35 + 0.5*0.25 + 0.9*0.25 + 0.9*0.15 = 0.175+0.125+0.225+0.135 = 0.66
    // low-q:  0.5*0.35 + 0.5*0.25 + 0.3*0.25 + 0.3*0.15 = 0.175+0.125+0.075+0.045 = 0.42
    expect(result.score).toBeCloseTo(0.66, 2)
  })

  // ── 5) highest score bid wins ────────────────────────────────────────
  it('selects the bid with the highest final score as winner', () => {
    const bids = [
      { roleId: 'weak', cost: 'EXPENSIVE', qualityEstimate: 0.2, speedEstimate: 0.2, trustScore: 0.2, capabilityScore: 0.2 },
      { roleId: 'strong', cost: 'MODERATE', qualityEstimate: 0.9, speedEstimate: 0.9, trustScore: 0.9, capabilityScore: 0.9 },
      { roleId: 'mid', cost: 'MODERATE', qualityEstimate: 0.5, speedEstimate: 0.5, trustScore: 0.5, capabilityScore: 0.5 },
    ]

    const result = contract.evaluateBids(bids)
    expect(result.winner.roleId).toBe('strong')
    expect(result.score).toBeGreaterThan(0.5)
    // Verify bus events
    expect(mockBus.publish).toHaveBeenCalledWith('contract.awarded', expect.objectContaining({
      winner: expect.objectContaining({ roleId: 'strong' }),
    }))
  })

  // ── extra: issueCall with empty candidates returns empty ─────────────
  it('returns empty array when no candidates provided', () => {
    const bids = contract.issueCall({ description: 'task' }, [])
    expect(bids).toEqual([])
  })

  // ── extra: evaluateBids with empty bids returns null ─────────────────
  it('returns null when no bids to evaluate', () => {
    const result = contract.evaluateBids([])
    expect(result).toBeNull()
  })

  // ── extra: trust score comes from field query ────────────────────────
  it('reads trust score from signal field', () => {
    mockField.query.mockReturnValue([{ strength: 0.85 }])
    const bids = contract.issueCall({ description: 'task' }, ['role-x'])
    expect(bids[0].trustScore).toBe(0.85)
  })

  // ── extra: capability score comes from capability engine ─────────────
  it('reads capability score from capability engine', () => {
    mockCapabilityEngine.score.mockReturnValue(0.95)
    const bids = contract.issueCall({ description: 'task' }, ['role-x'])
    expect(bids[0].capabilityScore).toBe(0.95)
  })

  // ── extra: cost estimation by role name heuristic ────────────────────
  it('estimates cost as CHEAP for "fast" roles and EXPENSIVE for "strong" roles', () => {
    const bids = contract.issueCall({}, ['fast-reader', 'strong-expert', 'normal-worker'])
    expect(bids[0].cost).toBe('CHEAP')
    expect(bids[1].cost).toBe('EXPENSIVE')
    expect(bids[2].cost).toBe('MODERATE')
  })
})
