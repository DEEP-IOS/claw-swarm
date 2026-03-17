/**
 * Unit tests for DualProcessRouter
 * System 1/2 dual-process routing with adaptive threshold
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DualProcessRouter } from '../../../src/orchestration/adaptation/dual-process-router.js'

// ============================================================================
// Mocks
// ============================================================================

const mockField = {
  emit: vi.fn(),
  query: vi.fn().mockReturnValue([]),
  superpose: vi.fn().mockReturnValue({}),
}
const mockBus = { publish: vi.fn(), subscribe: vi.fn() }

// ============================================================================
// Tests
// ============================================================================

describe('DualProcessRouter', () => {
  let router

  beforeEach(() => {
    vi.clearAllMocks()
    router = new DualProcessRouter({ field: mockField, bus: mockBus })
  })

  // --------------------------------------------------------------------------
  // SYSTEM_1 routing
  // --------------------------------------------------------------------------

  it('routes simple bug_fix with high confidence to SYSTEM_1', () => {
    // High confidence (0.95) => (1 - 0.95) * 0.3 = 0.015
    // riskLevel = 'low' => +0
    // alarm = 0 (not > 0.3) => +0
    // knowledge = 0 (< 0.3) => +0.1
    // Total complexity = 0.115 which is < default threshold 0.4
    const result = router.route({
      confidence: 0.95,
      riskLevel: 'low',
      scope: 'bug_fix',
    })

    expect(result.route.name).toBe('fast')
    expect(result.route.model).toBe('fast')
    expect(result.route.maxAgents).toBe(1)
    expect(result.route.reviewRequired).toBe(false)
    expect(result.complexity).toBeLessThan(0.4)
  })

  // --------------------------------------------------------------------------
  // SYSTEM_2 routing
  // --------------------------------------------------------------------------

  it('routes complex new_feature with low confidence and high alarm to SYSTEM_2', () => {
    // Low confidence (0.2) => (1 - 0.2) * 0.3 = 0.24
    // riskLevel = 'high' => +0.4
    // alarm strength 0.8 (> 0.3) => +0.2
    // knowledge = 0 (< 0.3) => +0.1
    // Total complexity = 0.94 which is > threshold 0.4
    mockField.superpose.mockReturnValue({ alarm: 0.8, knowledge: 0.0 })

    const result = router.route({
      confidence: 0.2,
      riskLevel: 'high',
      scope: 'new_feature',
    })

    expect(result.route.name).toBe('thorough')
    expect(result.route.model).toBe('strong')
    expect(result.route.maxAgents).toBe(3)
    expect(result.route.reviewRequired).toBe(true)
    expect(result.complexity).toBeGreaterThanOrEqual(0.4)
  })

  // --------------------------------------------------------------------------
  // Threshold adjustment on SYSTEM_1 failure
  // --------------------------------------------------------------------------

  it('lowers threshold when SYSTEM_1 fails', () => {
    const initialThreshold = router.getStats().threshold
    // Default threshold = 0.4, step = 0.02
    // After System 1 failure: threshold -= 0.02 => 0.38
    router.adjustThreshold({ system: 1, success: false })

    const newThreshold = router.getStats().threshold
    expect(newThreshold).toBeLessThan(initialThreshold)
    expect(newThreshold).toBeCloseTo(0.38, 5)
    expect(router.getStats().overrideCount).toBe(1)
  })

  // --------------------------------------------------------------------------
  // Threshold clamped within [0.2, 0.7]
  // --------------------------------------------------------------------------

  it('clamps threshold to [0.2, 0.7] bounds', () => {
    // Push threshold below minThreshold (0.2) via many System 1 failures
    for (let i = 0; i < 50; i++) {
      router.adjustThreshold({ system: 1, success: false })
    }
    expect(router.getStats().threshold).toBeGreaterThanOrEqual(0.2)

    // Push threshold above maxThreshold (0.7) via many System 2 successes
    for (let i = 0; i < 100; i++) {
      router.adjustThreshold({ system: 2, success: true })
    }
    expect(router.getStats().threshold).toBeLessThanOrEqual(0.7)
  })

  // --------------------------------------------------------------------------
  // Bus event publishing
  // --------------------------------------------------------------------------

  it('publishes routing.decided event on route()', () => {
    router.route({ confidence: 0.5, riskLevel: 'low' })

    expect(mockBus.publish).toHaveBeenCalledWith(
      'routing.decided',
      expect.objectContaining({
        route: expect.any(Object),
        complexity: expect.any(Number),
        threshold: expect.any(Number),
      }),
    )
  })
})
