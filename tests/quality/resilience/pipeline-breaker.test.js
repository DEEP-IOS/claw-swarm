/**
 * PipelineBreaker - DAG execution pipeline timeout breaker tests
 * @module tests/quality/resilience/pipeline-breaker.test
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PipelineBreaker } from '../../../src/quality/resilience/pipeline-breaker.js';

// ─── Mock Factories ──────────────────────────────────────────────────────────

function createMockField() {
  return {
    emit: vi.fn(),
    query: vi.fn().mockReturnValue([]),
    superpose: vi.fn().mockReturnValue({}),
  };
}

function createMockBus() {
  const handlers = {};
  return {
    publish: vi.fn(),
    subscribe: vi.fn((topic, handler) => { handlers[topic] = handler; }),
    unsubscribe: vi.fn(),
    _handlers: handlers,
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function createPipelineBreaker(overrides = {}) {
  const field = createMockField();
  const bus = createMockBus();
  const pb = new PipelineBreaker({ field, bus, ...overrides });
  return { pb, field, bus };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('PipelineBreaker', () => {
  let pb, field, bus;

  beforeEach(() => {
    vi.useFakeTimers();
    ({ pb, field, bus } = createPipelineBreaker());
  });

  afterEach(() => {
    // Clean up all timers tracked by the breaker
    for (const [dagId] of pb._dagTimers) {
      pb.stopTracking(dagId);
    }
    vi.useRealTimers();
  });

  // 1. Constructor
  it('creates instance with empty state', () => {
    expect(pb).toBeInstanceOf(PipelineBreaker);
    expect(pb._dagTimers.size).toBe(0);
    expect(pb.getStats().totalTracked).toBe(0);
    expect(pb.getStats().totalBroken).toBe(0);
  });

  // 2. startTracking: registers DAG timer
  it('startTracking: registers a new DAG timer', () => {
    pb.startTracking('dag-1', 10000);

    expect(pb._dagTimers.has('dag-1')).toBe(true);
    const entry = pb._dagTimers.get('dag-1');
    expect(entry.budgetMs).toBe(10000);
    expect(entry.broken).toBe(false);
    expect(pb.getStats().totalTracked).toBe(1);
  });

  // 3. At 80% budget: DIM_ALARM emitted with strength 0.5
  it('emits DIM_ALARM with strength 0.5 at 80% of budget', () => {
    pb.startTracking('dag-warn', 10000);

    // Advance to exactly 80% = 8000ms
    vi.advanceTimersByTime(8000);

    expect(field.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        dimension: 'alarm',
        scope: 'dag-warn',
        strength: 0.5,
        emitterId: 'PipelineBreaker',
        metadata: expect.objectContaining({
          event: 'pipeline_warning',
        }),
      }),
    );
  });

  // 4. At 100% budget: break() called, DIM_ALARM strength 1.0
  it('auto-breaks at 100% of budget with DIM_ALARM strength 1.0', () => {
    pb.startTracking('dag-break', 10000);

    // Advance to 100% = 10000ms
    vi.advanceTimersByTime(10000);

    // The break should have been called
    const entry = pb._dagTimers.get('dag-break');
    expect(entry.broken).toBe(true);

    // Check for the break alarm signal (strength 1.0)
    const breakCalls = field.emit.mock.calls.filter(
      c => c[0].metadata?.event === 'pipeline_broken',
    );
    expect(breakCalls.length).toBe(1);
    expect(breakCalls[0][0].strength).toBe(1.0);
    expect(breakCalls[0][0].scope).toBe('dag-break');
  });

  // 5. break: bus.publish 'quality.pipeline.broken'
  it('break: publishes quality.pipeline.broken on bus', () => {
    pb.startTracking('dag-pub', 5000);

    // Advance past the full budget
    vi.advanceTimersByTime(5000);

    expect(bus.publish).toHaveBeenCalledWith(
      'quality.pipeline.broken',
      expect.objectContaining({
        dagId: 'dag-pub',
        reason: 'timeout',
        budget: 5000,
      }),
      'PipelineBreaker',
    );
  });

  // 6. stopTracking: clears timers, no alarm emitted after
  it('stopTracking: clears timers and prevents further alarms', () => {
    pb.startTracking('dag-stop', 10000);

    // Stop tracking before any timer fires
    vi.advanceTimersByTime(5000);
    field.emit.mockClear();

    const wasTracking = pb.stopTracking('dag-stop');
    expect(wasTracking).toBe(true);

    // Advance well past what would have been the full budget
    vi.advanceTimersByTime(20000);

    // No new emissions after stop
    expect(field.emit).not.toHaveBeenCalled();
  });

  // 7. Multiple DAGs tracked independently
  it('tracks multiple DAGs independently', () => {
    pb.startTracking('dag-A', 5000);
    pb.startTracking('dag-B', 20000);

    // dag-A should break at 5000ms; dag-B should only warn at 16000ms
    vi.advanceTimersByTime(5000);

    // dag-A should be broken
    expect(pb._dagTimers.get('dag-A').broken).toBe(true);
    // dag-B should still be alive
    expect(pb._dagTimers.get('dag-B').broken).toBe(false);

    // Advance to dag-B warning time (80% of 20000 = 16000)
    vi.advanceTimersByTime(11000); // total 16000ms

    const warningCalls = field.emit.mock.calls.filter(
      c => c[0].scope === 'dag-B' && c[0].metadata?.event === 'pipeline_warning',
    );
    expect(warningCalls.length).toBe(1);

    // dag-B should break at 20000ms total
    vi.advanceTimersByTime(4000); // total 20000ms
    expect(pb._dagTimers.get('dag-B').broken).toBe(true);
  });

  // 8. getStats: totalTracked and totalBroken correct
  it('getStats: totalTracked and totalBroken reflect actual state', () => {
    pb.startTracking('dag-s1', 3000);
    pb.startTracking('dag-s2', 6000);
    pb.startTracking('dag-s3', 9000);

    // Break dag-s1 at 3000ms
    vi.advanceTimersByTime(3000);
    // Break dag-s2 at 6000ms
    vi.advanceTimersByTime(3000);

    // dag-s3 still alive, stop it normally
    pb.stopTracking('dag-s3');

    const stats = pb.getStats();
    expect(stats.totalTracked).toBe(3);
    expect(stats.totalBroken).toBe(2);
    expect(stats.avgTimeToBreak).toBeGreaterThan(0);
  });
});
