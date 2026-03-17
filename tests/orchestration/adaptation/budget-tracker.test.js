/**
 * BudgetTracker unit tests
 * @module tests/orchestration/adaptation/budget-tracker.test
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { BudgetTracker } from '../../../src/orchestration/adaptation/budget-tracker.js'

// ============================================================================
// Mocks
// ============================================================================

const mockField = {
  emit: vi.fn(),
  query: vi.fn().mockReturnValue([]),
  superpose: vi.fn().mockReturnValue({}),
}
const mockBus = {
  publish: vi.fn(),
  subscribe: vi.fn(),
  emit: vi.fn(),
  on: vi.fn(),
}

// ============================================================================
// Tests
// ============================================================================

describe('BudgetTracker', () => {
  /** @type {BudgetTracker} */
  let bt

  beforeEach(() => {
    vi.clearAllMocks()
    bt = new BudgetTracker({
      field: mockField,
      bus: mockBus,
      config: {
        defaultBudgetPerDAG: 10000,
        warningThreshold: 0.8,
        globalSessionBudget: 50000,
      },
    })
  })

  // --------------------------------------------------------------------------
  // estimateCost: strong model > fast model
  // --------------------------------------------------------------------------
  describe('estimateCost', () => {
    it('should estimate higher cost for strong model than fast model', () => {
      const strongPlan = {
        nodes: [{ id: 'n1', role: 'implementer', model: 'strong', prompt: 'implement feature' }],
      }
      const fastPlan = {
        nodes: [{ id: 'n2', role: 'implementer', model: 'fast', prompt: 'implement feature' }],
      }

      const strongEstimate = bt.estimateCost(strongPlan)
      const fastEstimate = bt.estimateCost(fastPlan)

      expect(strongEstimate.totalEstimate).toBeGreaterThan(fastEstimate.totalEstimate)
    })

    it('should return zero for empty DAG plan', () => {
      const result = bt.estimateCost({ nodes: [] })
      expect(result.totalEstimate).toBe(0)
      expect(result.perNode).toEqual([])
    })

    it('should return zero for null plan', () => {
      const result = bt.estimateCost(null)
      expect(result.totalEstimate).toBe(0)
    })

    it('should apply role cost factor multiplier', () => {
      // reviewer has factor 0.6, implementer has factor 1.5
      const reviewerPlan = {
        nodes: [{ id: 'n1', role: 'reviewer', model: 'balanced' }],
      }
      const implementerPlan = {
        nodes: [{ id: 'n2', role: 'implementer', model: 'balanced' }],
      }

      const revCost = bt.estimateCost(reviewerPlan)
      const implCost = bt.estimateCost(implementerPlan)

      expect(implCost.totalEstimate).toBeGreaterThan(revCost.totalEstimate)
    })
  })

  // --------------------------------------------------------------------------
  // CJK text token estimation > same-length ASCII text
  // --------------------------------------------------------------------------
  describe('CJK-aware token estimation', () => {
    it('should estimate more tokens for CJK text than equal-length ASCII text', () => {
      // CJK characters: each ~2 tokens
      const cjkPlan = {
        nodes: [{ id: 'n1', role: 'analyst', model: 'balanced', prompt: '分析这个代码的质量和性能问题' }],
      }
      // ASCII text of similar character count: each word ~1.3 tokens
      const asciiPlan = {
        nodes: [{ id: 'n2', role: 'analyst', model: 'balanced', prompt: 'analyze code quality perf issue' }],
      }

      const cjkEstimate = bt.estimateCost(cjkPlan)
      const asciiEstimate = bt.estimateCost(asciiPlan)

      // CJK text of similar length should produce higher token estimate
      expect(cjkEstimate.totalEstimate).toBeGreaterThan(asciiEstimate.totalEstimate)
    })
  })

  // --------------------------------------------------------------------------
  // recordSpend > 80% -> budget.warning
  // --------------------------------------------------------------------------
  describe('budget warning at 80%', () => {
    it('should emit budget.warning when spend exceeds 80% of budget', () => {
      bt.allocateBudget('dag-1', 10000)

      // Spend 8500 tokens (85% of 10000)
      bt.recordSpend('dag-1', 'node-1', 8500)

      expect(mockBus.publish).toHaveBeenCalledWith(
        'budget.warning',
        expect.objectContaining({
          dagId: 'dag-1',
          spent: 8500,
          totalBudget: 10000,
        }),
      )
    })

    it('should not emit warning when spend is below threshold', () => {
      bt.allocateBudget('dag-2', 10000)

      // Spend 5000 tokens (50%)
      bt.recordSpend('dag-2', 'node-1', 5000)

      expect(mockBus.publish).not.toHaveBeenCalledWith(
        'budget.warning',
        expect.anything(),
      )
    })
  })

  // --------------------------------------------------------------------------
  // recordSpend > 100% -> budget.exceeded + DIM_TASK signal
  // --------------------------------------------------------------------------
  describe('budget exceeded at 100%', () => {
    it('should emit budget.exceeded and DIM_TASK signal when budget is overrun', () => {
      bt.allocateBudget('dag-3', 10000)

      // Spend 11000 tokens (110%)
      bt.recordSpend('dag-3', 'node-x', 11000)

      expect(mockBus.publish).toHaveBeenCalledWith(
        'budget.exceeded',
        expect.objectContaining({
          dagId: 'dag-3',
          spent: 11000,
          totalBudget: 10000,
        }),
      )

      // Should emit DIM_TASK overrun signal into the field
      expect(mockField.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          dimension: 'task',
          emitterId: 'budget-tracker',
          metadata: expect.objectContaining({
            dagId: 'dag-3',
            overrun: true,
          }),
        }),
      )
    })

    it('should track global session budget spend', () => {
      bt.allocateBudget('dag-4', 10000)
      bt.recordSpend('dag-4', 'n1', 5000)

      const global = bt.getGlobalBudget()
      expect(global.spent).toBe(5000)
      expect(global.remaining).toBe(45000)
    })
  })

  // --------------------------------------------------------------------------
  // suggestModel returns 'fast' when budget is tight
  // --------------------------------------------------------------------------
  describe('suggestModel', () => {
    it('should suggest fast model when utilization > 70%', () => {
      bt.allocateBudget('dag-5', 10000)
      bt.recordSpend('dag-5', 'n1', 7500)

      const suggestion = bt.suggestModel('dag-5')
      expect(suggestion).not.toBeNull()
      expect(suggestion.model).toBe('fast')
    })

    it('should suggest fast model with reduceAgents when utilization > 90%', () => {
      bt.allocateBudget('dag-6', 10000)
      bt.recordSpend('dag-6', 'n1', 9500)

      const suggestion = bt.suggestModel('dag-6')
      expect(suggestion).not.toBeNull()
      expect(suggestion.model).toBe('fast')
      expect(suggestion.reduceAgents).toBe(true)
    })

    it('should return null when utilization is low', () => {
      bt.allocateBudget('dag-7', 10000)
      bt.recordSpend('dag-7', 'n1', 3000)

      const suggestion = bt.suggestModel('dag-7')
      expect(suggestion).toBeNull()
    })

    it('should return null for unknown dagId', () => {
      expect(bt.suggestModel('nonexistent')).toBeNull()
    })
  })

  // --------------------------------------------------------------------------
  // checkOverrun and generateCostReport
  // --------------------------------------------------------------------------
  describe('checkOverrun', () => {
    it('should report overrun correctly', () => {
      bt.allocateBudget('dag-8', 10000)
      bt.recordSpend('dag-8', 'n1', 12000)

      const result = bt.checkOverrun('dag-8')
      expect(result.overrun).toBe(true)
      expect(result.utilization).toBeGreaterThan(1)
      expect(result.suggestion).toBeDefined()
    })

    it('should return null for unknown dagId', () => {
      expect(bt.checkOverrun('unknown')).toBeNull()
    })
  })

  describe('generateCostReport', () => {
    it('should generate a complete cost report', () => {
      bt.allocateBudget('dag-9', 10000)
      bt.recordSpend('dag-9', 'n1', 4000)

      const report = bt.generateCostReport('dag-9')
      expect(report).not.toBeNull()
      expect(report.dagId).toBe('dag-9')
      expect(report.totalBudget).toBe(10000)
      expect(report.spent).toBe(4000)
      expect(report.remaining).toBe(6000)
      expect(report.overrun).toBe(false)

      expect(mockBus.publish).toHaveBeenCalledWith(
        'budget.report.generated',
        expect.objectContaining({ dagId: 'dag-9' }),
      )
    })
  })

  // --------------------------------------------------------------------------
  // allocateBudget with phases
  // --------------------------------------------------------------------------
  describe('allocateBudget', () => {
    it('should create default phase allocations when no phases provided', () => {
      bt.allocateBudget('dag-10', 10000)
      const report = bt.generateCostReport('dag-10')
      expect(report.phases).toHaveProperty('plan')
      expect(report.phases).toHaveProperty('execute')
      expect(report.phases).toHaveProperty('review')
    })

    it('should use custom phase allocations when provided', () => {
      bt.allocateBudget('dag-11', 10000, { coding: 0.7, testing: 0.3 })
      const report = bt.generateCostReport('dag-11')
      expect(report.phases).toHaveProperty('coding')
      expect(report.phases).toHaveProperty('testing')
      expect(report.phases.coding.allocated).toBe(7000)
      expect(report.phases.testing.allocated).toBe(3000)
    })
  })

  // --------------------------------------------------------------------------
  // Static metadata
  // --------------------------------------------------------------------------
  describe('static metadata', () => {
    it('should declare correct produces/consumes/publishes/subscribes', () => {
      expect(BudgetTracker.produces()).toContain('task')
      expect(BudgetTracker.consumes()).toContain('learning')
      expect(BudgetTracker.publishes()).toContain('budget.warning')
      expect(BudgetTracker.publishes()).toContain('budget.exceeded')
      expect(BudgetTracker.subscribes()).toContain('agent.completed')
    })
  })
})
