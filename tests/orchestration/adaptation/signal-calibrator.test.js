/**
 * Unit tests for SignalCalibrator
 * Mutual-information-driven signal dimension weight calibration
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SignalCalibrator } from '../../../src/orchestration/adaptation/signal-calibrator.js'

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

describe('SignalCalibrator', () => {
  let calibrator

  beforeEach(() => {
    vi.clearAllMocks()
    calibrator = new SignalCalibrator({
      field: mockField,
      bus: mockBus,
      store: mockStore,
      config: { calibrationInterval: 10, maxObservations: 100 },
    })
  })

  // --------------------------------------------------------------------------
  // High-correlation dimension gets higher weight
  // --------------------------------------------------------------------------

  it('assigns higher weight to dimensions with high MI correlation to outcomes', () => {
    // Binarization uses `v > median`. To ensure alarm splits cleanly:
    // 12 success with alarm=0.1, 8 failure with alarm=0.9
    // sorted alarm: [0.1x12, 0.9x8], median = sorted[10] = 0.1
    // bins: 0.1 > 0.1 = false(0), 0.9 > 0.1 = true(1)
    // So successes get bin=0, failures get bin=1 => strong MI
    // trail stays constant at 0.5 => median=0.5, all bins 0 => MI=0
    // Binarization: v > median(sorted[n/2]).
    // For alarm: 12 obs at 0.1 (success) + 8 obs at 0.9 (failure)
    //   sorted: [0.1x12, 0.9x8], median=sorted[10]=0.1
    //   bins: 0.1>0.1=false(0) for successes, 0.9>0.1=true(1) for failures
    //   => perfect correlation with outcome => high MI
    // For reputation: 8 obs at 0.9 (failure) + 12 obs at 0.1 (success)
    //   sorted: [0.1x12, 0.9x8], median=sorted[10]=0.1
    //   bins: 0.1>0.1=false(0) for successes, 0.9>0.1=true(1) for failures
    //   => same perfect correlation => high MI
    // For trail: constant 0.5 => median=0.5, all bins=0 => MI=0
    for (let i = 0; i < 12; i++) {
      calibrator.recordObservation(
        { trail: 0.5, alarm: 0.1, reputation: 0.1, task: 0.5, knowledge: 0.5, coordination: 0.5 },
        true,
      )
    }
    for (let i = 0; i < 8; i++) {
      calibrator.recordObservation(
        { trail: 0.5, alarm: 0.9, reputation: 0.9, task: 0.5, knowledge: 0.5, coordination: 0.5 },
        false,
      )
    }

    const result = calibrator.calibrate()
    const weights = result.weights

    // alarm and reputation vary with outcome => higher MI => higher weight
    // trail, task, knowledge, coordination are constant => MI = 0 => minWeight
    expect(weights.alarm).toBeGreaterThan(weights.trail)
    expect(weights.reputation).toBeGreaterThan(weights.trail)
  })

  // --------------------------------------------------------------------------
  // Low-correlation dimension gets lower weight
  // --------------------------------------------------------------------------

  it('assigns lower weight to dimensions with no correlation to outcomes', () => {
    // Use asymmetric split: 12 success (alarm=0.9), 8 failure (alarm=0.1)
    // sorted alarm: [0.1x8, 0.9x12], median = sorted[10] = 0.9
    // bins: 0.1 > 0.9 = false(0) for failures, 0.9 > 0.9 = false(0) for successes => all 0
    // That still gives MI=0. Instead use 3 levels to ensure proper split:
    // 12 success with alarm=0.8, 8 failure with alarm=0.2
    // sorted: [0.2x8, 0.8x12], median = sorted[10] = 0.8
    // bins: 0.2>0.8=false, 0.8>0.8=false => still all 0!
    // The trick: make more low values so median is low.
    // 8 success with alarm=0.9, 12 failure with alarm=0.1
    // sorted: [0.1x12, 0.9x8], median = sorted[10] = 0.1
    // bins: 0.1>0.1=false(0) for failures, 0.9>0.1=true(1) for successes
    // Joint: (0,0)=12-8=... let me recalculate.
    // Obs 0..7: alarm=0.9, success=true  => bin=1, outcome=1
    // Obs 8..19: alarm=0.1, success=false => bin=0, outcome=0
    // But we need 20 total: 8 success + 12 failure
    for (let i = 0; i < 8; i++) {
      // Success with high alarm
      calibrator.recordObservation(
        { trail: 0.5, alarm: 0.9, reputation: 0.5, task: 0.5, knowledge: 0.5, coordination: 0.5 },
        true,
      )
    }
    for (let i = 0; i < 12; i++) {
      // Failure with low alarm
      calibrator.recordObservation(
        { trail: 0.5, alarm: 0.1, reputation: 0.5, task: 0.5, knowledge: 0.5, coordination: 0.5 },
        false,
      )
    }

    const result = calibrator.calibrate()
    const weights = result.weights

    // trail is constant at 0.5 => median=0.5, all bins=0 => MI=0 => minWeight
    expect(weights.trail).toBeCloseTo(0.5, 1)
    // alarm varies with outcome and has proper binarization => MI > 0 => higher weight
    expect(weights.alarm).toBeGreaterThan(weights.trail)
  })

  // --------------------------------------------------------------------------
  // Weights clamped to [0.5, 1.5]
  // --------------------------------------------------------------------------

  it('keeps weights within [0.5, 1.5] range', () => {
    // Feed correlated data and calibrate
    for (let i = 0; i < 20; i++) {
      calibrator.recordObservation(
        {
          trail: i % 2 === 0 ? 0.9 : 0.1,
          alarm: i < 10 ? 0.9 : 0.1,
          reputation: Math.random(),
          task: Math.random(),
          knowledge: Math.random(),
          coordination: Math.random(),
        },
        i < 10,
      )
    }

    const result = calibrator.calibrate()
    const weights = result.weights

    for (const [dim, w] of Object.entries(weights)) {
      expect(w, `weight for ${dim}`).toBeGreaterThanOrEqual(0.5)
      expect(w, `weight for ${dim}`).toBeLessThanOrEqual(1.5)
    }
  })

  // --------------------------------------------------------------------------
  // No calibration before reaching calibrationInterval
  // --------------------------------------------------------------------------

  it('does not auto-calibrate before reaching calibrationInterval', () => {
    // calibrationInterval = 10, record only 9 observations
    for (let i = 0; i < 9; i++) {
      calibrator.recordObservation(
        { trail: 0.5, alarm: 0.5, reputation: 0.5, task: 0.5, knowledge: 0.5, coordination: 0.5 },
        true,
      )
    }

    // field.emit should NOT have been called since calibration hasn't triggered
    expect(mockField.emit).not.toHaveBeenCalled()
  })

  // --------------------------------------------------------------------------
  // Auto-calibrate at exact interval
  // --------------------------------------------------------------------------

  it('auto-calibrates and emits DIM_CALIBRATION at calibrationInterval', () => {
    // Record exactly 10 observations (calibrationInterval = 10)
    for (let i = 0; i < 10; i++) {
      calibrator.recordObservation(
        { trail: 0.5, alarm: i < 5 ? 0.9 : 0.1, reputation: 0.5, task: 0.5, knowledge: 0.5, coordination: 0.5 },
        i < 5,
      )
    }

    // field.emit should be called with DIM_CALIBRATION
    expect(mockField.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        dimension: 'calibration',
        scope: 'global',
        emitterId: 'signal-calibrator',
        metadata: expect.objectContaining({
          weights: expect.any(Object),
          sampleSize: 10,
        }),
      }),
    )

    // Bus should publish calibration.completed
    expect(mockBus.publish).toHaveBeenCalledWith(
      'calibration.completed',
      expect.objectContaining({
        weights: expect.any(Object),
        miScores: expect.any(Object),
        sampleSize: 10,
      }),
    )
  })
})
