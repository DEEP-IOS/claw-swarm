/**
 * HealthChecker unit tests
 * Tests multi-dimensional health assessment, adaptive polling, and history.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HealthChecker } from '../../src/observe/health/health-checker.js';

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
    getSignalCount: vi.fn().mockReturnValue(0),
    superpose: vi.fn().mockReturnValue({}),
  };
}

function createHealthyMetrics() {
  return {
    agents: { spawned: 5, completed: 4, failed: 0, active: 1 },
    tasks: { created: 3, completed: 2, failed: 0, inProgress: 1 },
    signals: { emitted: 100, currentCount: 100 },
    quality: { anomalies: 0 },
    errors: { total: 0 },
  };
}

function createDegradedMetrics() {
  return {
    agents: { spawned: 10, completed: 5, failed: 4, active: 1 },
    tasks: { created: 5, completed: 3, failed: 2, inProgress: 0 },
    signals: { emitted: 200, currentCount: 200 },
    quality: { anomalies: 3 },
    errors: { total: 4 },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('HealthChecker', () => {
  let bus;
  let field;
  let mockMetricsCollector;
  let checker;

  beforeEach(() => {
    vi.useFakeTimers();
    bus = createMockBus();
    field = createMockField();
    mockMetricsCollector = {
      getMetrics: vi.fn().mockReturnValue(createHealthyMetrics()),
    };
    checker = new HealthChecker({
      field,
      bus,
      metricsCollector: mockMetricsCollector,
    });
  });

  afterEach(() => {
    checker.stop();
    vi.useRealTimers();
  });

  // ---- Constructor --------------------------------------------------------

  it('creates instance with empty history', () => {
    expect(checker).toBeDefined();
    expect(checker.getHistory()).toHaveLength(0);
  });

  // ---- getHealth: healthy scenario ----------------------------------------

  it('returns healthy status and high score when metrics are good', () => {
    const health = checker.getHealth();
    expect(health.status).toBe('healthy');
    expect(health.score).toBeGreaterThanOrEqual(0.8);
    expect(health.score).toBeLessThanOrEqual(1);
  });

  // ---- getHealth: degraded scenario ---------------------------------------

  it('returns degraded status when error rate is high', () => {
    mockMetricsCollector.getMetrics.mockReturnValue(createDegradedMetrics());
    const health = checker.getHealth();
    // errorRate = failed / (completed + failed) = 4/9 ~ 0.44 > threshold 0.3
    // This pulls score down significantly (errorRate weight = 0.30)
    expect(['degraded', 'unhealthy']).toContain(health.status);
    expect(health.score).toBeLessThan(0.8);
  });

  // ---- getHealth: score range ---------------------------------------------

  it('returns score between 0 and 1', () => {
    const health = checker.getHealth();
    expect(health.score).toBeGreaterThanOrEqual(0);
    expect(health.score).toBeLessThanOrEqual(1);
  });

  // ---- getHealth: dimensions object ---------------------------------------

  it('returns dimensions with expected keys', () => {
    const health = checker.getHealth();
    const expectedDims = ['cpu', 'memory', 'eventLoopLag', 'signalCount', 'agentCount', 'errorRate'];
    for (const dim of expectedDims) {
      expect(health.dimensions).toHaveProperty(dim);
    }
  });

  it('each dimension has value, threshold, score, and ok properties', () => {
    const health = checker.getHealth();
    for (const [name, dim] of Object.entries(health.dimensions)) {
      expect(dim).toHaveProperty('value');
      expect(dim).toHaveProperty('threshold');
      expect(dim).toHaveProperty('score');
      expect(dim).toHaveProperty('ok');
      expect(typeof dim.value).toBe('number');
      expect(typeof dim.threshold).toBe('number');
      expect(typeof dim.score).toBe('number');
      expect(typeof dim.ok).toBe('boolean');
    }
  });

  // ---- start: begins polling ----------------------------------------------

  it('start() invokes an immediate health check and schedules next poll', () => {
    checker.start();
    // The immediate getHealth() call in start() populates history
    expect(checker.getHistory()).toHaveLength(1);
    // Advance past the polling interval (healthy=30s)
    vi.advanceTimersByTime(31_000);
    // Another health check should have fired
    expect(checker.getHistory().length).toBeGreaterThanOrEqual(2);
  });

  // ---- stop: clears timeout -----------------------------------------------

  it('stop() prevents further polling', () => {
    checker.start();
    expect(checker.getHistory()).toHaveLength(1);
    checker.stop();
    // Advance time well past polling interval
    vi.advanceTimersByTime(120_000);
    // No additional checks should have been performed
    expect(checker.getHistory()).toHaveLength(1);
  });

  // ---- getHistory ---------------------------------------------------------

  it('getHistory returns accumulated health check results', () => {
    checker.getHealth();
    checker.getHealth();
    checker.getHealth();
    const history = checker.getHistory();
    expect(history).toHaveLength(3);
    for (const entry of history) {
      expect(entry).toHaveProperty('status');
      expect(entry).toHaveProperty('score');
      expect(entry).toHaveProperty('dimensions');
      expect(entry).toHaveProperty('ts');
    }
  });

  it('getHistory respects the limit parameter', () => {
    // Generate several health checks
    for (let i = 0; i < 10; i++) {
      checker.getHealth();
    }
    const limited = checker.getHistory(3);
    expect(limited).toHaveLength(3);
    // Returns the most recent 3 entries
    const all = checker.getHistory(100);
    expect(limited[0].ts).toBe(all[all.length - 3].ts);
    expect(limited[2].ts).toBe(all[all.length - 1].ts);
  });
});
