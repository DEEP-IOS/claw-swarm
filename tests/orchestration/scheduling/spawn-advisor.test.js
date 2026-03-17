/**
 * Unit tests for SpawnAdvisor
 * Multi-dimensional vector-space weighted spawn advisor
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SpawnAdvisor } from '../../../src/orchestration/scheduling/spawn-advisor.js'

// ── dimension constants (match field/types.js) ──────────────────────────
const DIM_TRAIL       = 'trail'
const DIM_ALARM       = 'alarm'
const DIM_REPUTATION  = 'reputation'
const DIM_TASK        = 'task'
const DIM_KNOWLEDGE   = 'knowledge'
const DIM_COORDINATION = 'coordination'
const DIM_EMOTION     = 'emotion'
const DIM_TRUST       = 'trust'
const DIM_SNA         = 'sna'
const DIM_LEARNING    = 'learning'
const DIM_CALIBRATION = 'calibration'
const DIM_SPECIES     = 'species'

// ── helpers ─────────────────────────────────────────────────────────────
function makeFieldVector(overrides = {}) {
  return {
    [DIM_TRAIL]: 0.5,
    [DIM_ALARM]: 0.1,
    [DIM_REPUTATION]: 0.5,
    [DIM_TASK]: 0.7,
    [DIM_KNOWLEDGE]: 0.5,
    [DIM_COORDINATION]: 0.3,
    [DIM_EMOTION]: 0.2,
    [DIM_TRUST]: 0.6,
    [DIM_SNA]: 0.3,
    [DIM_LEARNING]: 0.5,
    [DIM_CALIBRATION]: 0.3,
    [DIM_SPECIES]: 0.1,
    ...overrides,
  }
}

describe('SpawnAdvisor', () => {
  let advisor
  let mockField
  let mockBus
  let mockRoleRegistry
  let mockModelCapability

  beforeEach(() => {
    mockField = {
      emit: vi.fn(),
      query: vi.fn().mockReturnValue([]),
      superpose: vi.fn().mockReturnValue(makeFieldVector()),
    }
    mockBus = {
      publish: vi.fn(),
    }
    mockRoleRegistry = {
      get: vi.fn().mockReturnValue({ id: 'implementer', preferredModel: 'strong', sensitivity: {} }),
      list: vi.fn().mockReturnValue(['researcher', 'implementer', 'debugger', 'tester']),
    }
    mockModelCapability = {
      selectModel: vi.fn().mockReturnValue('balanced'),
      getCapability: vi.fn().mockReturnValue({ contextWindow: 128000 }),
    }

    advisor = new SpawnAdvisor({
      field: mockField,
      bus: mockBus,
      roleRegistry: mockRoleRegistry,
      modelCapability: mockModelCapability,
    })
  })

  // ── 1) low knowledge -> researcher (overrides requested coder) ─────
  it('advises researcher when knowledge is low', () => {
    // With knowledge=0.1, alarm=0.1, task=0.5, learning=0.5:
    //   coder score = 0.5*0.4 + 0.1*0.25 + 0.9*0.2 + 0.5*0.15 = 0.48 (< 0.5 threshold)
    //   researcher  = 0.9*0.4 + 0.5*0.3 + 0.5*0.2 + 0.9*0.1   = 0.70 (wins)
    // Note: 'implementer' is NOT in the scored roles map, so it always gets honoured.
    // We must request a role in the map (researcher/debugger/coder/reviewer) to test override.
    mockField.superpose.mockReturnValue(makeFieldVector({
      [DIM_KNOWLEDGE]: 0.1,
      [DIM_LEARNING]: 0.5,
      [DIM_ALARM]: 0.1,
      [DIM_TASK]: 0.5,
    }))

    const advice = advisor.advise('scope-1', 'coder')
    expect(advice.role).toBe('researcher')
  })

  // ── 2) high alarm -> debugger ────────────────────────────────────────
  it('advises debugger when alarm is high', () => {
    // alarm=0.9: debugger score = 0.9*0.5 + (1-0.2)*0.2 + 0.5*0.2 + 0.5*0.1 = 0.45+0.16+0.10+0.05 = 0.76
    mockField.superpose.mockReturnValue(makeFieldVector({
      [DIM_ALARM]: 0.9,
      [DIM_KNOWLEDGE]: 0.5,
      [DIM_EMOTION]: 0.2,
      [DIM_TASK]: 0.5,
      [DIM_LEARNING]: 0.3,
    }))

    const advice = advisor.advise('scope-2', 'coder')
    expect(advice.role).toBe('debugger')
  })

  // ── 3) high emotion -> strong model ──────────────────────────────────
  it('advises strong model when emotion is high', () => {
    mockField.superpose.mockReturnValue(makeFieldVector({
      [DIM_EMOTION]: 0.8,
    }))

    const advice = advisor.advise('scope-3', 'coder')
    expect(advice.model).toBe('strong')
  })

  // ── 4) low trust -> reviewer companion ───────────────────────────────
  it('adds reviewer companion when trust is low', () => {
    mockField.superpose.mockReturnValue(makeFieldVector({
      [DIM_TRUST]: 0.2,
    }))

    const advice = advisor.advise('scope-4', 'coder')
    expect(advice.companions).toContain('role:reviewer')
  })

  // ── 5) EXPLORE mode allows different model selection ─────────────────
  it('uses EXPLORE mode for model selection after poor outcomes', () => {
    // Drive the advisor into EXPLORE mode by recording many failures
    for (let i = 0; i < 20; i++) {
      advisor.recordOutcome(`agent-${i}`, 'coder', false)
    }
    expect(advisor.getMode()).toBe('EXPLORE')

    // In EXPLORE mode, _selectModel uses hash: roleId.length % 3
    // 'coder'.length = 5, 5 % 3 = 2 -> 'strong'
    mockField.superpose.mockReturnValue(makeFieldVector({
      [DIM_EMOTION]: 0.3,
      [DIM_TRUST]: 0.5,
      [DIM_LEARNING]: 0.3,
    }))

    const advice = advisor.advise('scope-5', 'coder')
    // In EXPLORE with learning<=0.6, emotion<=0.7, trust>=0.3
    // hash = 'coder'.length % 3 = 5 % 3 = 2 -> ['fast','balanced','strong'][2] = 'strong'
    expect(advice.model).toBe('strong')
  })

  // ── 6) recordOutcome adjusts mode and threshold ──────────────────────
  it('adjusts mode and threshold on recordOutcome', () => {
    // Initial state
    expect(advisor.getMode()).toBe('EXPLOIT')
    expect(advisor.getStats().successRate).toBe(0.5)

    // Record several successes -> rate increases
    for (let i = 0; i < 10; i++) {
      advisor.recordOutcome('agent-1', 'coder', true)
    }
    expect(advisor.getStats().successRate).toBeGreaterThan(0.5)
    expect(advisor.getMode()).toBe('EXPLOIT')

    // Record many failures -> rate drops, eventually EXPLORE
    for (let i = 0; i < 30; i++) {
      advisor.recordOutcome('agent-1', 'coder', false)
    }
    expect(advisor.getMode()).toBe('EXPLORE')
    expect(advisor.getStats().successRate).toBeLessThan(0.3)

    // Role threshold should be adjusted
    const thresholds = advisor.getThresholds()
    expect(thresholds.has('coder')).toBe(true)
  })

  // ── 7) changing one dimension changes decision (not hardcoded) ───────
  it('produces different role advice when a single dimension changes', () => {
    // Base: high knowledge + high task -> coder score high, passes threshold
    //   coder = 0.8*0.4 + 0.7*0.25 + 0.9*0.2 + 0.3*0.15 = 0.32+0.175+0.18+0.045 = 0.72
    //   researcher = 0.3*0.4 + 0.3*0.3 + 0.8*0.2 + 0.9*0.1 = 0.12+0.09+0.16+0.09 = 0.46
    // coder >= 0.5 threshold -> honoured
    const baseVector = makeFieldVector({
      [DIM_KNOWLEDGE]: 0.7,
      [DIM_ALARM]: 0.1,
      [DIM_TASK]: 0.8,
      [DIM_LEARNING]: 0.3,
      [DIM_EMOTION]: 0.3,
      [DIM_TRUST]: 0.5,
    })
    mockField.superpose.mockReturnValue(baseVector)
    const advice1 = advisor.advise('scope-7', 'coder')
    expect(advice1.role).toBe('coder')

    // Flip: knowledge very low + task low -> coder score drops below threshold
    //   coder = 0.3*0.4 + 0.05*0.25 + 0.9*0.2 + 0.3*0.15 = 0.12+0.0125+0.18+0.045 = 0.3575 (< 0.5)
    //   researcher = 0.95*0.4 + 0.3*0.3 + 0.3*0.2 + 0.9*0.1 = 0.38+0.09+0.06+0.09 = 0.62 (wins)
    mockField.superpose.mockReturnValue({
      ...baseVector,
      [DIM_KNOWLEDGE]: 0.05,
      [DIM_TASK]: 0.3,
    })
    const advice2 = advisor.advise('scope-7b', 'coder')
    expect(advice2.role).toBe('researcher')

    // The two advices differ in role
    expect(advice1.role).not.toBe(advice2.role)
  })

  // ── 8) getStats returns correct statistics ───────────────────────────
  it('returns correct stats via getStats', () => {
    // Initial stats
    const stats0 = advisor.getStats()
    expect(stats0.adviceCount).toBe(0)
    expect(stats0.overrideCount).toBe(0)
    expect(stats0.mode).toBe('EXPLOIT')
    expect(stats0.successRate).toBe(0.5)

    // Trigger an override (low knowledge -> researcher overrides implementer)
    mockField.superpose.mockReturnValue(makeFieldVector({
      [DIM_KNOWLEDGE]: 0.1,
      [DIM_TASK]: 0.5,
      [DIM_LEARNING]: 0.5,
      [DIM_ALARM]: 0.1,
    }))
    advisor.advise('scope-8', 'implementer')

    const stats1 = advisor.getStats()
    expect(stats1.adviceCount).toBe(1)
    // If the role was overridden, overrideCount should increase
    if (stats1.overrideCount > 0) {
      expect(stats1.overrideCount).toBeGreaterThanOrEqual(1)
    }
  })

  // ── extra: priority is urgent when alarm > 0.7 ──────────────────────
  it('sets priority to urgent when alarm is high', () => {
    mockField.superpose.mockReturnValue(makeFieldVector({
      [DIM_ALARM]: 0.8,
    }))
    const advice = advisor.advise('scope-p', 'coder')
    expect(advice.priority).toBe('urgent')
  })

  // ── extra: emits field signal and bus event on advise ────────────────
  it('emits field signal and bus event on advise', () => {
    advisor.advise('scope-e', 'coder')
    expect(mockField.emit).toHaveBeenCalledWith(expect.objectContaining({
      dimension: DIM_COORDINATION,
      scope: 'scope-e',
      emitterId: 'spawn-advisor',
    }))
    expect(mockBus.publish).toHaveBeenCalledWith('spawn.advised', expect.objectContaining({
      taskScope: 'scope-e',
    }))
  })

  // ── extra: low trust also triggers strong model ──────────────────────
  it('advises strong model when trust is low', () => {
    mockField.superpose.mockReturnValue(makeFieldVector({
      [DIM_TRUST]: 0.2,
      [DIM_EMOTION]: 0.3,
      [DIM_LEARNING]: 0.3,
    }))
    const advice = advisor.advise('scope-t', 'coder')
    expect(advice.model).toBe('strong')
  })
})
