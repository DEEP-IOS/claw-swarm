/**
 * Observe domain integration tests
 * Tests createObserveSystem facade — module wiring, delegation, lifecycle.
 * All dependencies are mocked; verifies that the facade correctly routes
 * calls through to the underlying modules.
 * @module tests/observe/integration/observe-flow
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createObserveSystem } from '../../../src/observe/index.js';

// ── Mock factories ───────────────────────────────────────────────────────────

function createMockField() {
  return {
    emit: vi.fn(),
    query: vi.fn().mockReturnValue([]),
    stats: vi.fn().mockReturnValue({ signalCount: 100 }),
    superpose: vi.fn().mockReturnValue({ trail: 0.5, alarm: 0.2 }),
  };
}

function createMockBus() {
  const handlers = new Map();
  return {
    publish: vi.fn((topic, data) => {
      (handlers.get(topic) || []).forEach(fn => fn(data));
    }),
    subscribe: vi.fn((topic, fn) => {
      if (!handlers.has(topic)) handlers.set(topic, []);
      handlers.get(topic).push(fn);
      return () => {};
    }),
    unsubscribe: vi.fn(),
    on: vi.fn((topic, fn) => {
      if (!handlers.has(topic)) handlers.set(topic, []);
      handlers.get(topic).push(fn);
      return () => {};
    }),
    off: vi.fn(),
    emit: vi.fn(),
    stats: vi.fn().mockReturnValue({}),
    _handlers: handlers,
    _trigger(topic, data) {
      (handlers.get(topic) || []).forEach(fn => fn(data));
    },
  };
}

function createMockStore() {
  const data = new Map();
  return {
    put: vi.fn((d, k, v) => data.set(`${d}/${k}`, v)),
    get: vi.fn((d, k) => data.get(`${d}/${k}`) || null),
    query: vi.fn((domain, filterFn) => {
      const results = [];
      for (const [key, value] of data) {
        if (key.startsWith(`${domain}/`)) {
          const shortKey = key.slice(domain.length + 1);
          if (!filterFn || filterFn(value, shortKey)) {
            results.push(value);
          }
        }
      }
      return results;
    }),
    delete: vi.fn(),
    stats: vi.fn().mockReturnValue({}),
  };
}

describe('createObserveSystem integration', () => {
  let field, bus, store, observe;

  beforeEach(() => {
    field = createMockField();
    bus = createMockBus();
    store = createMockStore();

    observe = createObserveSystem({
      field,
      bus,
      store,
      domains: {},
      config: { dashboard: { port: 0 } }, // port 0 = don't bind
    });
  });

  // ── 1. createObserveSystem returns facade with all methods ────

  it('returns facade with all expected methods', () => {
    expect(observe).toBeDefined();

    // Metrics
    expect(typeof observe.getMetrics).toBe('function');
    expect(typeof observe.getHookStats).toBe('function');

    // Health
    expect(typeof observe.getHealth).toBe('function');
    expect(typeof observe.getHealthHistory).toBe('function');

    // Traces
    expect(typeof observe.startSpan).toBe('function');
    expect(typeof observe.endSpan).toBe('function');
    expect(typeof observe.addSpanEvent).toBe('function');
    expect(typeof observe.getTrace).toBe('function');
    expect(typeof observe.getTraces).toBe('function');

    // Dashboard
    expect(typeof observe.getDashboardPort).toBe('function');
    expect(typeof observe.handleRequest).toBe('function');
    expect(typeof observe.getRouteCount).toBe('function');

    // Broadcast
    expect(typeof observe.getClientCount).toBe('function');

    // Lifecycle
    expect(typeof observe.start).toBe('function');
    expect(typeof observe.stop).toBe('function');
  });

  // ── 2. getMetrics returns metrics object ──────────────────────

  it('getMetrics returns a metrics object with expected structure', () => {
    const metrics = observe.getMetrics();
    expect(metrics).toBeDefined();
    expect(typeof metrics).toBe('object');
    expect(metrics).toHaveProperty('agents');
    expect(metrics).toHaveProperty('tasks');
    expect(metrics).toHaveProperty('signals');
    expect(metrics).toHaveProperty('startedAt');
  });

  // ── 3. getHealth returns health status ────────────────────────

  it('getHealth returns health entry with status and score', () => {
    const health = observe.getHealth();
    expect(health).toBeDefined();
    expect(health).toHaveProperty('status');
    expect(health).toHaveProperty('score');
    expect(health).toHaveProperty('dimensions');
    expect(typeof health.score).toBe('number');
    // In a fresh state with no load, should be healthy
    expect(['healthy', 'degraded', 'unhealthy']).toContain(health.status);
  });

  // ── 4. startSpan + endSpan full trace workflow ────────────────

  it('startSpan + endSpan creates and completes a span', () => {
    const spanId = observe.startSpan('test-operation', null, null, { agentId: 'a1' });
    expect(typeof spanId).toBe('string');
    expect(spanId.length).toBeGreaterThan(0);

    const completed = observe.endSpan(spanId, {});
    expect(completed).toBeDefined();
    expect(completed.name).toBe('test-operation');
    expect(completed.status).toBe('completed');
    expect(completed.durationMs).toBeGreaterThanOrEqual(0);
    expect(completed.metadata.agentId).toBe('a1');
  });

  // ── 5. getTrace returns trace with spans ──────────────────────

  it('getTrace returns a trace tree after spans are created', () => {
    const spanId = observe.startSpan('root-op');
    observe.endSpan(spanId);

    // The span's traceId defaults to the spanId when no traceId is provided
    const trace = observe.getTrace(spanId);
    expect(trace).toBeDefined();
    expect(trace.traceId).toBe(spanId);
    expect(trace.rootSpan).toBeDefined();
    expect(trace.rootSpan.name).toBe('root-op');
    expect(Array.isArray(trace.spans)).toBe(true);
    expect(trace.spans.length).toBeGreaterThanOrEqual(1);
  });

  // ── 6. handleRequest delegates to DashboardService ────────────

  it('handleRequest delegates to dashboard and returns route result', async () => {
    const res = await observe.handleRequest('GET', '/api/v9/field/dimensions');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.data)).toBe(true);
    expect(res.data.length).toBe(12);
  });

  // ── 7. getRouteCount returns registered route count ───────────

  it('getRouteCount returns the total number of registered routes', () => {
    const count = observe.getRouteCount();
    expect(typeof count).toBe('number');
    expect(count).toBeGreaterThanOrEqual(55);
  });

  // ── 8. _modules contains all 5 module instances ───────────────

  it('_modules contains all 5 module instances', () => {
    const mods = observe._modules;
    expect(mods).toBeDefined();
    expect(mods.metricsCollector).toBeDefined();
    expect(mods.dashboardService).toBeDefined();
    expect(mods.healthChecker).toBeDefined();
    expect(mods.traceCollector).toBeDefined();
    expect(mods.stateBroadcaster).toBeDefined();
    expect(Object.keys(mods)).toHaveLength(5);
  });

  // ── 9. allModules returns array of 5 modules ─────────────────

  it('allModules returns array of exactly 5 modules', () => {
    const all = observe.allModules();
    expect(Array.isArray(all)).toBe(true);
    expect(all).toHaveLength(5);

    // Each module should be an object (class instance)
    for (const mod of all) {
      expect(typeof mod).toBe('object');
      expect(mod).not.toBeNull();
    }
  });

  // ── 10. start/stop lifecycle completes without errors ─────────

  it('start and stop lifecycle completes without errors', async () => {
    // start() will try to listen on port 0, which should succeed.
    // We mock createServer to avoid real HTTP binding.
    const { _modules } = observe;

    // Patch dashboardService.start/stop to avoid real HTTP server
    const origStart = _modules.dashboardService.start.bind(_modules.dashboardService);
    const origStop = _modules.dashboardService.stop.bind(_modules.dashboardService);
    _modules.dashboardService.start = vi.fn().mockResolvedValue(undefined);
    _modules.dashboardService.stop = vi.fn().mockResolvedValue(undefined);

    await expect(observe.start()).resolves.toBeUndefined();

    // Verify sub-modules got started (metrics subscribes to bus topics)
    // MetricsCollector.start() calls bus.on() for each subscription
    expect(bus.on.mock.calls.length).toBeGreaterThan(0);

    await expect(observe.stop()).resolves.toBeUndefined();

    // Verify dashboard start/stop were called
    expect(_modules.dashboardService.start).toHaveBeenCalledTimes(1);
    expect(_modules.dashboardService.stop).toHaveBeenCalledTimes(1);
  });
});
