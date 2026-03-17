/**
 * CircuitBreaker - Tool-level circuit breaker tests
 * @module tests/quality/resilience/circuit-breaker.test
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CircuitBreaker } from '../../../src/quality/resilience/circuit-breaker.js';

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

function createBreaker(overrides = {}) {
  const field = createMockField();
  const bus = createMockBus();
  const breaker = new CircuitBreaker({
    field,
    bus,
    config: {
      failureThreshold: 3,
      cooldownMs: 5000,
      halfOpenSuccesses: 2,
      ...overrides,
    },
  });
  return { breaker, field, bus };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('CircuitBreaker', () => {
  let breaker, field, bus;

  beforeEach(() => {
    vi.useFakeTimers();
    ({ breaker, field, bus } = createBreaker());
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // 1. Constructor
  it('creates instance with correct defaults', () => {
    expect(breaker).toBeInstanceOf(CircuitBreaker);
    expect(breaker._failureThreshold).toBe(3);
    expect(breaker._cooldownMs).toBe(5000);
    expect(breaker._halfOpenSuccesses).toBe(2);
  });

  // 2. canExecute: new tool -> CLOSED, allowed
  it('canExecute: new tool returns allowed=true and state CLOSED', () => {
    const result = breaker.canExecute('my_tool');
    expect(result.allowed).toBe(true);
    expect(result.state).toBe('CLOSED');
  });

  // 3. recordFailure: 3 consecutive failures -> OPEN
  it('recordFailure: reaching threshold trips breaker to OPEN', () => {
    breaker.recordFailure('my_tool');
    breaker.recordFailure('my_tool');
    expect(breaker.getState('my_tool').state).toBe('CLOSED');

    breaker.recordFailure('my_tool'); // 3rd failure = threshold
    expect(breaker.getState('my_tool').state).toBe('OPEN');
  });

  // 4. canExecute: OPEN state -> not allowed
  it('canExecute: OPEN state returns allowed=false', () => {
    breaker.recordFailure('my_tool');
    breaker.recordFailure('my_tool');
    breaker.recordFailure('my_tool');

    const result = breaker.canExecute('my_tool');
    expect(result.allowed).toBe(false);
    expect(result.state).toBe('OPEN');
    expect(result.retryAfterMs).toBeGreaterThan(0);
  });

  // 5. canExecute: OPEN after cooldown -> HALF_OPEN
  it('canExecute: after cooldown transitions OPEN to HALF_OPEN', () => {
    breaker.recordFailure('my_tool');
    breaker.recordFailure('my_tool');
    breaker.recordFailure('my_tool');

    // Advance past the cooldown period
    vi.advanceTimersByTime(5001);

    const result = breaker.canExecute('my_tool');
    expect(result.allowed).toBe(true);
    expect(result.state).toBe('HALF_OPEN');
  });

  // 6. recordSuccess in HALF_OPEN: 2 successes -> CLOSED
  it('recordSuccess: enough successes in HALF_OPEN closes breaker', () => {
    // Trip to OPEN
    breaker.recordFailure('my_tool');
    breaker.recordFailure('my_tool');
    breaker.recordFailure('my_tool');

    // Advance to allow HALF_OPEN
    vi.advanceTimersByTime(5001);
    breaker.canExecute('my_tool'); // transition to HALF_OPEN

    // 2 successes (halfOpenSuccesses threshold)
    breaker.recordSuccess('my_tool');
    expect(breaker.getState('my_tool').state).toBe('HALF_OPEN');

    breaker.recordSuccess('my_tool');
    expect(breaker.getState('my_tool').state).toBe('CLOSED');
  });

  // 7. recordFailure in HALF_OPEN: immediate OPEN
  it('recordFailure: in HALF_OPEN immediately trips back to OPEN', () => {
    // Trip to OPEN, then to HALF_OPEN
    breaker.recordFailure('my_tool');
    breaker.recordFailure('my_tool');
    breaker.recordFailure('my_tool');
    vi.advanceTimersByTime(5001);
    breaker.canExecute('my_tool'); // HALF_OPEN

    // Failure during HALF_OPEN
    breaker.recordFailure('my_tool');
    expect(breaker.getState('my_tool').state).toBe('OPEN');
  });

  // 8. recordFailure -> DIM_ALARM emitted when opening
  it('recordFailure: emits DIM_ALARM signal when breaker trips', () => {
    breaker.recordFailure('my_tool');
    breaker.recordFailure('my_tool');
    breaker.recordFailure('my_tool');

    expect(field.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        dimension: 'alarm',
        scope: 'my_tool',
        strength: 0.8,
        emitterId: 'CircuitBreaker',
      }),
    );
  });

  // 9. recordFailure -> bus.publish 'quality.breaker.opened'
  it('recordFailure: publishes quality.breaker.opened when tripped', () => {
    breaker.recordFailure('my_tool');
    breaker.recordFailure('my_tool');
    breaker.recordFailure('my_tool');

    expect(bus.publish).toHaveBeenCalledWith(
      'quality.breaker.opened',
      expect.objectContaining({
        toolName: 'my_tool',
        failureCount: 3,
      }),
      'CircuitBreaker',
    );
  });

  // 10. recordSuccess in HALF_OPEN closes -> bus.publish 'quality.breaker.closed'
  it('recordSuccess: publishes quality.breaker.closed on HALF_OPEN -> CLOSED', () => {
    breaker.recordFailure('my_tool');
    breaker.recordFailure('my_tool');
    breaker.recordFailure('my_tool');
    vi.advanceTimersByTime(5001);
    breaker.canExecute('my_tool'); // HALF_OPEN

    breaker.recordSuccess('my_tool');
    breaker.recordSuccess('my_tool'); // closes

    expect(bus.publish).toHaveBeenCalledWith(
      'quality.breaker.closed',
      expect.objectContaining({ toolName: 'my_tool' }),
      'CircuitBreaker',
    );
  });

  // 11. reset: forces CLOSED state
  it('reset: forces breaker back to CLOSED state', () => {
    breaker.recordFailure('my_tool');
    breaker.recordFailure('my_tool');
    breaker.recordFailure('my_tool');
    expect(breaker.getState('my_tool').state).toBe('OPEN');

    breaker.reset('my_tool');
    expect(breaker.getState('my_tool').state).toBe('CLOSED');
    expect(breaker.getState('my_tool').failureCount).toBe(0);
  });

  // 12. getStats: totalTrips counted correctly
  it('getStats: totalTrips increments on each trip', () => {
    // Trip breaker for tool_a
    breaker.recordFailure('tool_a');
    breaker.recordFailure('tool_a');
    breaker.recordFailure('tool_a');

    // Trip breaker for tool_b
    breaker.recordFailure('tool_b');
    breaker.recordFailure('tool_b');
    breaker.recordFailure('tool_b');

    const stats = breaker.getStats();
    expect(stats.totalTrips).toBe(2);
    expect(stats.breakersByState.OPEN).toBe(2);
    expect(stats.breakersByState.CLOSED).toBe(0);
  });
});
