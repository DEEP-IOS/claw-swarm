/**
 * Unit tests for GlobalModulator
 * Exploit/Explore mode switching with EMA success rate and Shannon entropy novelty
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { GlobalModulator } from '../../../src/orchestration/adaptation/global-modulator.js'

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

describe('GlobalModulator', () => {
  let modulator

  beforeEach(() => {
    vi.clearAllMocks()
    modulator = new GlobalModulator({ field: mockField, bus: mockBus })
  })

  // --------------------------------------------------------------------------
  // EXPLOIT mode on high success rate
  // --------------------------------------------------------------------------

  it('switches to EXPLOIT with continuous high success rate and low novelty', () => {
    // Feed many successes of the same type to get EMA > 0.7 and novelty = 0 (one type)
    // EMA starts at 0.5, alpha = 0.2
    // After each success: ema = 0.2 * 1.0 + 0.8 * ema
    // We need ema > 0.7, and single type gives novelty = 0
    for (let i = 0; i < 30; i++) {
      modulator.recordOutcome(true, 'bug_fix')
    }

    expect(modulator.getMode()).toBe('EXPLOIT')
  })

  // --------------------------------------------------------------------------
  // EXPLORE mode on low success rate
  // --------------------------------------------------------------------------

  it('switches to EXPLORE with continuous low success rate', () => {
    // Feed many failures to get EMA < 0.4
    // EMA starts at 0.5, alpha = 0.2
    // After each failure: ema = 0.2 * 0.0 + 0.8 * ema
    // After ~5 failures: 0.5 * 0.8^5 = 0.164, well below 0.4
    for (let i = 0; i < 10; i++) {
      modulator.recordOutcome(false, 'bug_fix')
    }

    expect(modulator.getMode()).toBe('EXPLORE')
  })

  // --------------------------------------------------------------------------
  // DIM_COORDINATION signal emission on mode change
  // --------------------------------------------------------------------------

  it('emits DIM_COORDINATION signal when mode changes', () => {
    // Drive into EXPLORE mode (successive failures)
    for (let i = 0; i < 10; i++) {
      modulator.recordOutcome(false, 'bug_fix')
    }

    expect(mockField.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        dimension: 'coordination',
        scope: 'global',
        emitterId: 'global-modulator',
        metadata: expect.objectContaining({ mode: 'EXPLORE' }),
      }),
    )

    // Also publishes a bus event
    expect(mockBus.publish).toHaveBeenCalledWith(
      'modulator.mode.changed',
      expect.objectContaining({
        from: 'EXPLOIT',
        to: 'EXPLORE',
      }),
    )
  })

  // --------------------------------------------------------------------------
  // Novelty score rises with task type diversity
  // --------------------------------------------------------------------------

  it('noveltyScore rises when task types are diverse, triggering EXPLORE', () => {
    // First, raise success rate high so mode = EXPLOIT
    for (let i = 0; i < 20; i++) {
      modulator.recordOutcome(true, 'bug_fix')
    }
    expect(modulator.getMode()).toBe('EXPLOIT')

    // Now inject many diverse task types (high novelty > 0.7 triggers EXPLORE)
    // Shannon entropy is normalized: with many different types, novelty -> 1.0
    const diverseTypes = [
      'type_a', 'type_b', 'type_c', 'type_d', 'type_e',
      'type_f', 'type_g', 'type_h', 'type_i', 'type_j',
      'type_k', 'type_l', 'type_m', 'type_n', 'type_o',
      'type_p', 'type_q', 'type_r', 'type_s', 'type_t',
    ]
    for (const t of diverseTypes) {
      modulator.recordOutcome(true, t)
    }

    // High novelty (many unique types => entropy ~ 1.0) => EXPLORE
    // even though success rate is still high, novelty > 0.7 triggers EXPLORE
    expect(modulator.getMode()).toBe('EXPLORE')
  })

  // --------------------------------------------------------------------------
  // Stats correctness
  // --------------------------------------------------------------------------

  it('returns correct stats', () => {
    modulator.recordOutcome(true, 'bug_fix')
    modulator.recordOutcome(false, 'refactor')

    const stats = modulator.getStats()
    expect(stats.mode).toMatch(/^(EXPLOIT|EXPLORE)$/)
    expect(stats.historySize).toBe(2)
    expect(typeof stats.successRate).toBe('number')
    expect(typeof stats.explorationRate).toBe('number')
  })
})
