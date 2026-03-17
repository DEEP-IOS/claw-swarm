/**
 * Unit tests for ShapleyCredit
 * Monte Carlo Shapley credit attribution for DAG agent contributions
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ShapleyCredit } from '../../../src/orchestration/adaptation/shapley-credit.js'

// ============================================================================
// Mocks
// ============================================================================

const mockField = {
  emit: vi.fn(),
  query: vi.fn().mockReturnValue([]),
  superpose: vi.fn().mockReturnValue({}),
}
const mockBus = { publish: vi.fn(), subscribe: vi.fn(), emit: vi.fn(), on: vi.fn() }
const mockReputationCRDT = { increment: vi.fn(), decrement: vi.fn() }

// ============================================================================
// Tests
// ============================================================================

describe('ShapleyCredit', () => {
  let shapley

  beforeEach(() => {
    vi.clearAllMocks()
    shapley = new ShapleyCredit({
      field: mockField,
      bus: mockBus,
      reputationCRDT: mockReputationCRDT,
      config: { samples: 200 },
    })
  })

  // --------------------------------------------------------------------------
  // Single agent => Shapley = total value
  // --------------------------------------------------------------------------

  it('assigns total coalition value to a single agent', () => {
    const contributions = new Map([['agent-A', { quality: 0.8 }]])
    const result = shapley.compute('dag-1', contributions)

    // v({A}) = 0.8, v({}) = 0, so Shapley(A) = 0.8
    expect(result.get('agent-A')).toBeCloseTo(0.8, 1)
  })

  // --------------------------------------------------------------------------
  // Two equal agents => each ~50%
  // --------------------------------------------------------------------------

  it('assigns roughly equal Shapley values to two agents with equal quality', () => {
    const contributions = new Map([
      ['agent-A', { quality: 0.5 }],
      ['agent-B', { quality: 0.5 }],
    ])
    const result = shapley.compute('dag-2', contributions)

    const valueA = result.get('agent-A')
    const valueB = result.get('agent-B')

    // With 200 samples, these should converge reasonably
    // Total = 0.5 + 0.5 + 0.1*(2-1) = 1.1
    // Each agent should get ~0.55 (half of total)
    const total = valueA + valueB
    const ratioA = valueA / total
    const ratioB = valueB / total

    // Each should be approximately 50% (+/- 15% for Monte Carlo variance)
    expect(ratioA).toBeGreaterThan(0.35)
    expect(ratioA).toBeLessThan(0.65)
    expect(ratioB).toBeGreaterThan(0.35)
    expect(ratioB).toBeLessThan(0.65)
  })

  // --------------------------------------------------------------------------
  // Positive Shapley => reputationCRDT.increment
  // --------------------------------------------------------------------------

  it('calls reputationCRDT.increment for agents with positive Shapley', () => {
    const contributions = new Map([['agent-A', { quality: 0.7 }]])
    shapley.compute('dag-3', contributions)

    expect(mockReputationCRDT.increment).toHaveBeenCalledWith('agent-A')
  })

  // --------------------------------------------------------------------------
  // Negative Shapley => reputationCRDT.decrement
  // --------------------------------------------------------------------------

  it('calls reputationCRDT.decrement for agents with negative Shapley', () => {
    // An agent with negative quality drags the coalition down
    const contributions = new Map([
      ['agent-A', { quality: 0.9 }],
      ['agent-B', { quality: -0.5 }],
    ])
    shapley.compute('dag-4', contributions)

    // agent-B has negative quality, so its marginal contribution is negative
    // The normalization should preserve the sign
    expect(mockReputationCRDT.decrement).toHaveBeenCalledWith('agent-B')
  })

  // --------------------------------------------------------------------------
  // Shapley values sum ~ total DAG value (within 10%)
  // --------------------------------------------------------------------------

  it('Shapley values sum approximates total DAG value within 10%', () => {
    const contributions = new Map([
      ['agent-A', { quality: 0.6 }],
      ['agent-B', { quality: 0.4 }],
      ['agent-C', { quality: 0.3 }],
    ])
    const result = shapley.compute('dag-5', contributions)

    // Total coalition value:
    // v({A,B,C}) = 0.6 + 0.4 + 0.3 + 0.1*(3-1) = 1.5
    const totalValue = 0.6 + 0.4 + 0.3 + 0.1 * 2 // = 1.5
    let shapleySum = 0
    for (const val of result.values()) {
      shapleySum += val
    }

    // The compute method normalizes so sum = totalValue
    const error = Math.abs(shapleySum - totalValue) / totalValue
    expect(error).toBeLessThan(0.1)
  })

  // --------------------------------------------------------------------------
  // DAG credits stored and retrievable
  // --------------------------------------------------------------------------

  it('stores DAG credits retrievable via getDAGCredits()', () => {
    const contributions = new Map([['agent-A', { quality: 0.5 }]])
    shapley.compute('dag-6', contributions)

    const credits = shapley.getDAGCredits('dag-6')
    expect(credits).toBeDefined()
    expect(credits.has('agent-A')).toBe(true)
  })

  // --------------------------------------------------------------------------
  // Leaderboard accumulates across DAGs
  // --------------------------------------------------------------------------

  it('accumulates leaderboard across multiple DAGs', () => {
    const c1 = new Map([['agent-A', { quality: 0.5 }]])
    const c2 = new Map([['agent-A', { quality: 0.3 }]])

    shapley.compute('dag-7', c1)
    shapley.compute('dag-8', c2)

    const leaderboard = shapley.getLeaderboard()
    expect(leaderboard.length).toBeGreaterThan(0)
    expect(leaderboard[0].agentId).toBe('agent-A')
    expect(leaderboard[0].totalValue).toBeCloseTo(0.8, 1)
  })
})
