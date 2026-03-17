/**
 * Unit tests for DeadlineTracker
 * Time budget tracking with warning/exceeded events and learning-adjusted estimates
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DeadlineTracker } from '../../../src/orchestration/scheduling/deadline-tracker.js'

describe('DeadlineTracker', () => {
  let tracker
  let mockField
  let mockBus

  beforeEach(() => {
    mockField = {
      emit: vi.fn(),
      query: vi.fn().mockReturnValue([]),
    }
    mockBus = {
      publish: vi.fn(),
    }
    tracker = new DeadlineTracker({ field: mockField, bus: mockBus })
  })

  // ── 1) normal progress -> overdue = false ────────────────────────────
  it('reports not overdue when within time budget', () => {
    tracker.setDeadline('dag-1', 60_000)  // 60s budget

    const status = tracker.checkOverdue('dag-1')
    expect(status.overdue).toBe(false)
    expect(status.remaining).toBeGreaterThan(0)
    expect(status.overduePhases).toEqual([])
    // No events should have fired
    expect(mockBus.publish).not.toHaveBeenCalled()
  })

  // ── 2) > 90% consumed -> deadline.warning event ──────────────────────
  it('emits deadline.warning when >90% of budget consumed', () => {
    // Set a deadline with a very short budget, then fake elapsed time
    const budget = 1000  // 1 second
    tracker.setDeadline('dag-2', budget)

    // Manually adjust startedAt so that elapsed > 90%
    const entry = tracker._deadlines.get('dag-2')
    entry.startedAt = Date.now() - 950  // 95% consumed

    const status = tracker.checkOverdue('dag-2')
    expect(status.overdue).toBe(false)  // not yet 100%
    expect(mockBus.publish).toHaveBeenCalledWith('deadline.warning', expect.objectContaining({
      dagId: 'dag-2',
    }))
  })

  it('only emits warning once', () => {
    tracker.setDeadline('dag-w', 1000)
    const entry = tracker._deadlines.get('dag-w')
    entry.startedAt = Date.now() - 950

    tracker.checkOverdue('dag-w')
    tracker.checkOverdue('dag-w')  // second call

    const warningCalls = mockBus.publish.mock.calls.filter(
      ([topic]) => topic === 'deadline.warning'
    )
    expect(warningCalls).toHaveLength(1)
  })

  // ── 3) > 100% consumed -> deadline.exceeded + DIM_ALARM ─────────────
  it('emits deadline.exceeded and DIM_ALARM when budget exhausted', () => {
    tracker.setDeadline('dag-3', 1000)
    const entry = tracker._deadlines.get('dag-3')
    entry.startedAt = Date.now() - 1100  // 110% consumed

    const status = tracker.checkOverdue('dag-3')
    expect(status.overdue).toBe(true)
    expect(status.remaining).toBe(0)

    expect(mockBus.publish).toHaveBeenCalledWith('deadline.exceeded', expect.objectContaining({
      dagId: 'dag-3',
    }))
    expect(mockField.emit).toHaveBeenCalledWith(expect.objectContaining({
      dimension: 'alarm',
      scope: 'dag-3',
      emitterId: 'deadline-tracker',
    }))
  })

  // ── 4) estimateRemaining adjusted by learning signal ─────────────────
  it('adjusts estimate down when learning signal is strong', () => {
    tracker.setDeadline('dag-4', 10_000)
    const entry = tracker._deadlines.get('dag-4')
    // Set startedAt so that roughly 50% elapsed
    entry.startedAt = Date.now() - 5000

    // No learning signal -> raw remaining ~ 5000
    mockField.query.mockReturnValue([])
    const rawEstimate = tracker.estimateRemaining('dag-4')

    // With strong learning signal -> remaining reduced by up to 30%
    mockField.query.mockReturnValue([{ strength: 0.8 }])
    const adjustedEstimate = tracker.estimateRemaining('dag-4')

    // learningFactor = 1 - 0.8 * 0.3 = 0.76
    // adjustedEstimate should be roughly 76% of rawEstimate
    expect(adjustedEstimate).toBeLessThan(rawEstimate)
    // Allow some timing slack
    const ratio = adjustedEstimate / rawEstimate
    expect(ratio).toBeGreaterThan(0.7)
    expect(ratio).toBeLessThan(0.85)
  })

  it('returns raw estimate when no learning signal', () => {
    tracker.setDeadline('dag-4b', 10_000)
    const entry = tracker._deadlines.get('dag-4b')
    entry.startedAt = Date.now() - 5000

    mockField.query.mockReturnValue([])
    const estimate = tracker.estimateRemaining('dag-4b')
    // Should be close to 5000ms remaining
    expect(estimate).toBeGreaterThan(4500)
    expect(estimate).toBeLessThanOrEqual(5100)
  })

  // ── extra: phase overdue tracking ────────────────────────────────────
  it('tracks overdue phases correctly', () => {
    tracker.setDeadline('dag-5', 60_000, { planning: 5_000, coding: 20_000 })
    // Record that planning took 7000ms (over its 5000ms budget)
    tracker.recordPhaseCompletion('dag-5', 'planning', 7000)

    const entry = tracker._deadlines.get('dag-5')
    entry.startedAt = Date.now() - 61_000  // force overall overdue

    const status = tracker.checkOverdue('dag-5')
    expect(status.overduePhases).toContain('planning')
  })

  // ── extra: getDeadlineStatus returns full status ─────────────────────
  it('returns full deadline status', () => {
    tracker.setDeadline('dag-6', 30_000, { phase1: 10_000 })
    tracker.recordPhaseCompletion('dag-6', 'phase1', 8000)

    const status = tracker.getDeadlineStatus('dag-6')
    expect(status).not.toBeNull()
    expect(status.dagId).toBe('dag-6')
    expect(status.totalBudgetMs).toBe(30_000)
    expect(status.phaseBudgets).toEqual({ phase1: 10_000 })
    expect(status.phaseActuals).toEqual({ phase1: 8000 })
    expect(typeof status.elapsed).toBe('number')
    expect(typeof status.fraction).toBe('number')
  })

  // ── extra: non-existent DAG returns defaults ─────────────────────────
  it('handles non-existent DAG gracefully', () => {
    const status = tracker.checkOverdue('nonexistent')
    expect(status.overdue).toBe(false)
    expect(status.remaining).toBe(Infinity)

    expect(tracker.estimateRemaining('nonexistent')).toBe(0)
    expect(tracker.getDeadlineStatus('nonexistent')).toBeNull()
  })
})
