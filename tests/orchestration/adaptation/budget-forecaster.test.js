/**
 * BudgetForecaster unit tests
 * @module tests/orchestration/adaptation/budget-forecaster.test
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { BudgetForecaster } from '../../../src/orchestration/adaptation/budget-forecaster.js'

// ============================================================================
// Mocks
// ============================================================================

const mockField = {
  emit: vi.fn(),
  read: vi.fn().mockReturnValue([]),
  query: vi.fn().mockReturnValue([]),
  superpose: vi.fn().mockReturnValue({}),
}
const mockBus = {
  publish: vi.fn(),
  subscribe: vi.fn(),
  emit: vi.fn(),
  on: vi.fn(),
}
const mockStore = { get: vi.fn().mockReturnValue(null), set: vi.fn() }

// ============================================================================
// Helpers
// ============================================================================

/**
 * Feed linear data: actualCost = slope * complexity + intercept + noise
 */
function feedLinearData(forecaster, taskType, count, slope, intercept, noiseScale = 0) {
  for (let i = 0; i < count; i++) {
    const complexity = i / (count - 1) // 0 to 1
    const noise = noiseScale > 0 ? (Math.random() - 0.5) * noiseScale : 0
    const actualCost = slope * complexity + intercept + noise
    forecaster.recordActual(taskType, complexity, Math.max(0, Math.round(actualCost)))
  }
}

// ============================================================================
// Tests
// ============================================================================

describe('BudgetForecaster', () => {
  /** @type {BudgetForecaster} */
  let bf

  beforeEach(() => {
    vi.clearAllMocks()
    mockField.read.mockReturnValue([])
    bf = new BudgetForecaster({
      field: mockField,
      bus: mockBus,
      store: mockStore,
    })
  })

  // --------------------------------------------------------------------------
  // Linear data -> regression prediction is accurate (error < 30%)
  // --------------------------------------------------------------------------
  describe('linear data prediction accuracy', () => {
    it('should predict with < 30% error for clean linear data', () => {
      // Feed perfect linear data: cost = 5000 * complexity + 1000
      const slope = 5000
      const intercept = 1000
      feedLinearData(bf, 'coding', 20, slope, intercept, 0)

      // Predict at complexity = 0.5 -> expected = 3500
      const prediction = bf.predictCost('coding', 0.5)
      const expected = slope * 0.5 + intercept
      const errorPct = Math.abs(prediction.estimatedTokens - expected) / expected

      expect(errorPct).toBeLessThan(0.3)
      expect(prediction.basedOn).toBe(20)
    })

    it('should predict correctly at boundary complexity values', () => {
      feedLinearData(bf, 'analysis', 15, 8000, 500, 0)

      // At complexity = 0 -> expected = 500
      const low = bf.predictCost('analysis', 0)
      expect(Math.abs(low.estimatedTokens - 500) / 500).toBeLessThan(0.3)

      // At complexity = 1 -> expected = 8500
      const high = bf.predictCost('analysis', 1)
      expect(Math.abs(high.estimatedTokens - 8500) / 8500).toBeLessThan(0.3)
    })
  })

  // --------------------------------------------------------------------------
  // Insufficient data -> confidence = low
  // --------------------------------------------------------------------------
  describe('insufficient data handling', () => {
    it('should return low confidence when data is insufficient (< 2 samples)', () => {
      // No data at all
      const result0 = bf.predictCost('unknown-task', 0.5)
      expect(result0.confidence).toBeLessThanOrEqual(0.2)
      expect(result0.basedOn).toBe(0)
      // Default fallback is 2000
      expect(result0.estimatedTokens).toBe(2000)
    })

    it('should return low confidence with only 1 data point', () => {
      bf.recordActual('rare-task', 0.5, 3000)
      const result = bf.predictCost('rare-task', 0.5)
      expect(result.confidence).toBe(0.2)
      expect(result.basedOn).toBe(1)
      expect(result.estimatedTokens).toBe(3000) // returns the single actual
    })

    it('should increase confidence with more data points', () => {
      feedLinearData(bf, 'growing', 5, 3000, 500, 0)
      const result5 = bf.predictCost('growing', 0.5)

      feedLinearData(bf, 'growing', 20, 3000, 500, 0)
      const result25 = bf.predictCost('growing', 0.5)

      expect(result25.confidence).toBeGreaterThan(result5.confidence)
    })
  })

  // --------------------------------------------------------------------------
  // Improving learning -> prediction decreases (learning discount)
  // --------------------------------------------------------------------------
  describe('learning discount', () => {
    it('should apply a 0.85 discount when DIM_LEARNING signal indicates improvement', () => {
      feedLinearData(bf, 'review', 10, 4000, 1000, 0)

      // Without learning signal
      mockField.read.mockReturnValue([])
      const withoutLearning = bf.predictCost('review', 0.5)

      // With strong learning signal (strength > 0.5)
      mockField.read.mockReturnValue([{ strength: 0.8, dimension: 'learning' }])
      const withLearning = bf.predictCost('review', 0.5)

      // withLearning should be ~85% of withoutLearning
      expect(withLearning.estimatedTokens).toBeLessThan(withoutLearning.estimatedTokens)
      const ratio = withLearning.estimatedTokens / withoutLearning.estimatedTokens
      expect(ratio).toBeCloseTo(0.85, 1)
    })

    it('should not apply discount when learning signal strength <= 0.5', () => {
      feedLinearData(bf, 'debug', 10, 3000, 500, 0)

      mockField.read.mockReturnValue([])
      const noSignal = bf.predictCost('debug', 0.5)

      mockField.read.mockReturnValue([{ strength: 0.3, dimension: 'learning' }])
      const weakSignal = bf.predictCost('debug', 0.5)

      // Both should be equal since weak learning doesn't trigger discount
      expect(weakSignal.estimatedTokens).toBe(noSignal.estimatedTokens)
    })
  })

  // --------------------------------------------------------------------------
  // getAccuracy: r2Score on linear data > 0.7
  // --------------------------------------------------------------------------
  describe('getAccuracy', () => {
    it('should report r2Score > 0.7 on clean linear data', () => {
      // Feed enough clean linear data for leave-one-out evaluation
      // Need at least 3 entries overall, and >= 3 of same type (2 others + 1 being tested)
      feedLinearData(bf, 'perf-test', 20, 6000, 500, 0)

      const accuracy = bf.getAccuracy()
      expect(accuracy.r2Score).toBeGreaterThan(0.7)
      expect(accuracy.meanAbsoluteError).toBeLessThan(Infinity)
    })

    it('should return r2Score=0 and MAE=Infinity with insufficient data', () => {
      const accuracy = bf.getAccuracy()
      expect(accuracy.r2Score).toBe(0)
      expect(accuracy.meanAbsoluteError).toBe(Infinity)
    })

    it('should handle noisy data with reasonable r2Score', () => {
      // Feed linear data with moderate noise
      feedLinearData(bf, 'noisy-task', 30, 5000, 1000, 500)

      const accuracy = bf.getAccuracy()
      // With moderate noise the r2Score should still be decent
      expect(accuracy.r2Score).toBeGreaterThan(0.3)
    })
  })

  // --------------------------------------------------------------------------
  // projectBudget
  // --------------------------------------------------------------------------
  describe('projectBudget', () => {
    it('should project total budget for remaining tasks', () => {
      feedLinearData(bf, 'coding', 10, 4000, 1000, 0)

      const projection = bf.projectBudget([
        { taskType: 'coding', complexity: 0.3 },
        { taskType: 'coding', complexity: 0.7 },
      ])

      expect(projection.totalEstimate).toBeGreaterThan(0)
      expect(projection.perTask).toHaveLength(2)
      expect(projection.confidence).toBeGreaterThan(0)

      expect(mockBus.publish).toHaveBeenCalledWith(
        'forecast.updated',
        expect.objectContaining({
          taskCount: 2,
        }),
      )
    })

    it('should return zero for empty task list', () => {
      const result = bf.projectBudget([])
      expect(result.totalEstimate).toBe(0)
      expect(result.perTask).toEqual([])
    })
  })

  // --------------------------------------------------------------------------
  // History cap
  // --------------------------------------------------------------------------
  describe('history management', () => {
    it('should cap history at MAX_HISTORY (200)', () => {
      for (let i = 0; i < 250; i++) {
        bf.recordActual('task', i / 250, 1000 + i)
      }
      // Internal history should be capped
      expect(bf._history.length).toBeLessThanOrEqual(200)
    })
  })

  // --------------------------------------------------------------------------
  // Static metadata
  // --------------------------------------------------------------------------
  describe('static metadata', () => {
    it('should declare correct produces/consumes/publishes/subscribes', () => {
      expect(BudgetForecaster.produces()).toEqual([])
      expect(BudgetForecaster.consumes()).toContain('learning')
      expect(BudgetForecaster.consumes()).toContain('task')
      expect(BudgetForecaster.publishes()).toContain('forecast.updated')
      expect(BudgetForecaster.subscribes()).toContain('budget.report.generated')
    })
  })
})
