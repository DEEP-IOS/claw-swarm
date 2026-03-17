/**
 * MetricsCollector unit tests
 * Tests event-driven metric aggregation across all domain topics.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MetricsCollector } from '../../src/observe/metrics/metrics-collector.js';

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

function createMockBus() {
  const handlers = new Map();
  return {
    on: vi.fn((topic, handler) => {
      if (!handlers.has(topic)) handlers.set(topic, []);
      handlers.get(topic).push(handler);
      return () => {
        const fns = handlers.get(topic);
        if (fns) {
          const idx = fns.indexOf(handler);
          if (idx >= 0) fns.splice(idx, 1);
        }
      };
    }),
    off: vi.fn(),
    _handlers: handlers,
    _trigger(topic, data) {
      const fns = handlers.get(topic) || [];
      fns.forEach(fn => fn(data));
    },
  };
}

function createMockField() {
  return {
    emit: vi.fn(),
    query: vi.fn().mockReturnValue([]),
    stats: vi.fn().mockReturnValue({ signalCount: 0 }),
    getSignalCount: vi.fn().mockReturnValue(42),
    superpose: vi.fn().mockReturnValue({}),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MetricsCollector', () => {
  let bus;
  let field;
  let collector;

  beforeEach(() => {
    bus = createMockBus();
    field = createMockField();
    collector = new MetricsCollector({ bus, field });
  });

  afterEach(() => {
    collector.stop();
  });

  // ---- Construction -------------------------------------------------------

  it('creates instance with zeroed metrics', () => {
    const m = collector.getMetrics();
    expect(m.agents.spawned).toBe(0);
    expect(m.agents.completed).toBe(0);
    expect(m.agents.failed).toBe(0);
    expect(m.agents.active).toBe(0);
    expect(m.tasks.created).toBe(0);
    expect(m.tasks.completed).toBe(0);
    expect(m.signals.emitted).toBe(0);
    expect(m.quality.gateEvaluations).toBe(0);
    expect(m.errors.total).toBe(0);
    expect(typeof m.startedAt).toBe('number');
  });

  // ---- start / stop -------------------------------------------------------

  it('start() subscribes to bus topics via on()', () => {
    collector.start();
    // MetricsCollector subscribes to 27+ topics
    expect(bus.on).toHaveBeenCalled();
    expect(bus.on.mock.calls.length).toBeGreaterThanOrEqual(20);
  });

  it('start() is idempotent — calling twice does not double subscriptions', () => {
    collector.start();
    const count1 = bus.on.mock.calls.length;
    collector.start();
    const count2 = bus.on.mock.calls.length;
    expect(count2).toBe(count1);
  });

  it('stop() clears all subscription handles', () => {
    collector.start();
    const subCount = bus.on.mock.calls.length;
    expect(subCount).toBeGreaterThan(0);
    collector.stop();
    // After stop, triggering events should have no effect
    bus._trigger('agent.spawned', {});
    expect(collector.getMetrics().agents.spawned).toBe(0);
  });

  // ---- Agent events -------------------------------------------------------

  it('agent.spawned increments spawned and active', () => {
    collector.start();
    bus._trigger('agent.spawned', {});
    bus._trigger('agent.spawned', {});
    const m = collector.getMetrics();
    expect(m.agents.spawned).toBe(2);
    expect(m.agents.active).toBe(2);
  });

  it('agent.completed increments completed and decreases active', () => {
    collector.start();
    bus._trigger('agent.spawned', {});
    bus._trigger('agent.spawned', {});
    bus._trigger('agent.completed', { durationMs: 500 });
    const m = collector.getMetrics();
    expect(m.agents.completed).toBe(1);
    expect(m.agents.active).toBe(1);
  });

  it('agent.failed increments failed, decreases active, increments errors.total', () => {
    collector.start();
    bus._trigger('agent.spawned', {});
    bus._trigger('agent.failed', { errorClass: 'timeout' });
    const m = collector.getMetrics();
    expect(m.agents.failed).toBe(1);
    expect(m.agents.active).toBe(0);
    expect(m.errors.total).toBe(1);
    expect(m.errors.byClass.timeout).toBe(1);
  });

  // ---- Orchestration events -----------------------------------------------

  it('orchestration.dag.created increments tasks.created', () => {
    collector.start();
    bus._trigger('orchestration.dag.created', {});
    bus._trigger('orchestration.dag.created', {});
    expect(collector.getMetrics().tasks.created).toBe(2);
  });

  it('orchestration.task.completed increments tasks.completed and tracks duration', () => {
    collector.start();
    bus._trigger('orchestration.task.started', {});
    bus._trigger('orchestration.task.completed', { durationMs: 200 });
    const m = collector.getMetrics();
    expect(m.tasks.completed).toBe(1);
    expect(m.tasks.inProgress).toBe(0);
    expect(m.performance.avgTaskDurationMs).toBe(200);
  });

  // ---- Quality events -----------------------------------------------------

  it('quality.gate.evaluated increments gateEvaluations and tracks pass rate', () => {
    collector.start();
    bus._trigger('quality.gate.evaluated', { passed: true });
    bus._trigger('quality.gate.evaluated', { passed: false });
    const m = collector.getMetrics();
    expect(m.quality.gateEvaluations).toBe(2);
    expect(m.quality.gatePassed).toBe(1);
    expect(m.quality.gatePassRate).toBe(0.5);
  });

  it('quality.breaker.opened increments breakerTrips', () => {
    collector.start();
    bus._trigger('quality.breaker.opened', {});
    expect(collector.getMetrics().quality.breakerTrips).toBe(1);
  });

  it('quality.anomaly.detected increments anomalies', () => {
    collector.start();
    bus._trigger('quality.anomaly.detected', {});
    bus._trigger('quality.anomaly.detected', {});
    expect(collector.getMetrics().quality.anomalies).toBe(2);
  });

  it('quality.compliance.violation increments violations', () => {
    collector.start();
    bus._trigger('quality.compliance.violation', {});
    expect(collector.getMetrics().quality.violations).toBe(1);
  });

  // ---- Field / signal events ----------------------------------------------

  it('field.signal.emitted increments signals.emitted and tracks dimension', () => {
    collector.start();
    bus._trigger('field.signal.emitted', { dimension: 'progress' });
    bus._trigger('field.signal.emitted', { dimension: 'progress' });
    bus._trigger('field.signal.emitted', { dimension: 'capability' });
    const m = collector.getMetrics();
    expect(m.signals.emitted).toBe(3);
    expect(m.signals.byDimension.progress).toBe(2);
    expect(m.signals.byDimension.capability).toBe(1);
    // Should also query field for currentCount
    expect(field.getSignalCount).toHaveBeenCalled();
    expect(m.signals.currentCount).toBe(42);
  });

  // ---- getMetrics returns deep copy ---------------------------------------

  it('getMetrics returns a deep copy — mutations do not affect internal state', () => {
    collector.start();
    bus._trigger('agent.spawned', {});
    const copy = collector.getMetrics();
    copy.agents.spawned = 9999;
    copy.agents.active = 9999;
    const fresh = collector.getMetrics();
    expect(fresh.agents.spawned).toBe(1);
    expect(fresh.agents.active).toBe(1);
  });

  // ---- reset --------------------------------------------------------------

  it('reset clears all counters but preserves startedAt', () => {
    collector.start();
    bus._trigger('agent.spawned', {});
    bus._trigger('agent.spawned', {});
    bus._trigger('quality.anomaly.detected', {});

    const beforeReset = collector.getMetrics();
    expect(beforeReset.agents.spawned).toBe(2);
    const { startedAt } = beforeReset;

    collector.reset();
    const afterReset = collector.getMetrics();
    expect(afterReset.agents.spawned).toBe(0);
    expect(afterReset.agents.active).toBe(0);
    expect(afterReset.quality.anomalies).toBe(0);
    expect(afterReset.errors.total).toBe(0);
    expect(afterReset.startedAt).toBe(startedAt);
  });
});
