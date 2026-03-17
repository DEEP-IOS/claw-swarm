/**
 * Unit tests for ResponseThreshold
 * Per-role activation thresholds with adaptive feedback
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ResponseThreshold } from '../../../src/orchestration/adaptation/response-threshold.js'

// ============================================================================
// Mocks
// ============================================================================

const mockField = {
  emit: vi.fn(),
  query: vi.fn().mockReturnValue([]),
  superpose: vi.fn().mockReturnValue({}),
}
const mockBus = { publish: vi.fn(), subscribe: vi.fn() }
const mockStore = { get: vi.fn().mockReturnValue(null), put: vi.fn() }

// ============================================================================
// Tests
// ============================================================================

describe('ResponseThreshold', () => {
  let threshold

  beforeEach(() => {
    vi.clearAllMocks()
    threshold = new ResponseThreshold({ field: mockField, bus: mockBus, store: mockStore })
  })

  // --------------------------------------------------------------------------
  // Default threshold
  // --------------------------------------------------------------------------

  it('initializes role threshold to 0.5 by default', () => {
    expect(threshold.getThreshold('coder')).toBe(0.5)
  })

  // --------------------------------------------------------------------------
  // Consecutive success lowers threshold
  // --------------------------------------------------------------------------

  it('lowers threshold on consecutive successes', () => {
    const roleId = 'coder'
    const initial = threshold.getThreshold(roleId)

    // SUCCESS_DELTA = -0.02 per success (base delta, no field modifiers since superpose returns {})
    // DIM_REPUTATION defaults to 0.5 (not > 0.8, not < 0.3), DIM_LEARNING defaults to 0.5 (not > 0.6, not < 0.3)
    // So only base delta applies: -0.02 per success
    for (let i = 0; i < 5; i++) {
      threshold.recordOutcome(roleId, true)
    }

    const after = threshold.getThreshold(roleId)
    expect(after).toBeLessThan(initial)
    // 0.5 + 5 * (-0.02) = 0.4
    expect(after).toBeCloseTo(0.4, 5)
  })

  // --------------------------------------------------------------------------
  // Consecutive failure raises threshold (faster than success lowers)
  // --------------------------------------------------------------------------

  it('raises threshold on consecutive failures with larger delta than success', () => {
    const roleId = 'planner'
    const initial = threshold.getThreshold(roleId)

    // FAILURE_DELTA = +0.05 per failure
    for (let i = 0; i < 5; i++) {
      threshold.recordOutcome(roleId, false)
    }

    const after = threshold.getThreshold(roleId)
    expect(after).toBeGreaterThan(initial)
    // 0.5 + 5 * (+0.05) = 0.75 but clamped to 0.9 max
    expect(after).toBeCloseTo(0.75, 5)

    // Verify failure delta (0.05) > success delta (0.02)
    const successDelta = Math.abs(-0.02)
    const failureDelta = Math.abs(0.05)
    expect(failureDelta).toBeGreaterThan(successDelta)
  })

  // --------------------------------------------------------------------------
  // Threshold clamped within [0.1, 0.9]
  // --------------------------------------------------------------------------

  it('clamps threshold to [0.1, 0.9]', () => {
    const roleId = 'reviewer'

    // Many successes to push down
    for (let i = 0; i < 100; i++) {
      threshold.recordOutcome(roleId, true)
    }
    expect(threshold.getThreshold(roleId)).toBeGreaterThanOrEqual(0.1)

    // Reset and push up with many failures
    threshold.reset(roleId)
    for (let i = 0; i < 100; i++) {
      threshold.recordOutcome(roleId, false)
    }
    expect(threshold.getThreshold(roleId)).toBeLessThanOrEqual(0.9)
  })

  // --------------------------------------------------------------------------
  // isActivatable
  // --------------------------------------------------------------------------

  it('isActivatable returns true when fieldStrength >= threshold', () => {
    // Default threshold = 0.5
    expect(threshold.isActivatable('coder', 0.5)).toBe(true)
    expect(threshold.isActivatable('coder', 0.8)).toBe(true)
    expect(threshold.isActivatable('coder', 0.3)).toBe(false)
  })

  // --------------------------------------------------------------------------
  // isActivatable tracks threshold changes
  // --------------------------------------------------------------------------

  it('isActivatable reflects adjusted threshold', () => {
    const roleId = 'analyst'

    // Lower threshold via successes
    for (let i = 0; i < 10; i++) {
      threshold.recordOutcome(roleId, true)
    }

    // Threshold should be around 0.3 (0.5 + 10 * -0.02 = 0.3)
    const currentThreshold = threshold.getThreshold(roleId)
    expect(currentThreshold).toBeCloseTo(0.3, 1)

    // A field strength of 0.35 should now activate (was not activatable at default 0.5)
    expect(threshold.isActivatable(roleId, 0.35)).toBe(true)
  })

  // --------------------------------------------------------------------------
  // Emits coordination signal on recordOutcome
  // --------------------------------------------------------------------------

  it('emits DIM_COORDINATION signal on recordOutcome', () => {
    threshold.recordOutcome('coder', true)

    expect(mockField.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        dimension: 'coordination',
        scope: 'coder',
        emitterId: 'response-threshold',
      }),
    )
  })
})
