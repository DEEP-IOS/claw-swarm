/**
 * DashboardService unit tests
 * Tests route registration, handleRequest dispatch, legacy aliases, and param extraction.
 * No HTTP server is started — all tests go through handleRequest(method, pathname, query).
 * @module tests/observe/dashboard-service
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DashboardService } from '../../src/observe/dashboard/dashboard-service.js';

// ── Mock factories ───────────────────────────────────────────────────────────

function createMockField() {
  return {
    emit: vi.fn(),
    query: vi.fn().mockReturnValue([]),
    stats: vi.fn().mockReturnValue({ signalCount: 100, gcRuns: 3 }),
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
    query: vi.fn(() => []),
    delete: vi.fn(),
    stats: vi.fn().mockReturnValue({ domains: 2, keys: 50 }),
  };
}

describe('DashboardService', () => {
  let field, bus, store, dashboard;
  let mockMetrics, mockHealth, mockTraces, mockBroadcaster, mockDomains;

  beforeEach(() => {
    field = createMockField();
    bus = createMockBus();
    store = createMockStore();

    mockMetrics = {
      getMetrics: vi.fn().mockReturnValue({ agents: { active: 2 } }),
      getHookStats: vi.fn().mockReturnValue({}),
    };
    mockHealth = {
      getHealth: vi.fn().mockReturnValue({ status: 'healthy', score: 0.9 }),
    };
    mockTraces = {
      getTraces: vi.fn().mockReturnValue([]),
      getTrace: vi.fn().mockReturnValue(null),
    };
    mockBroadcaster = {
      addClient: vi.fn(),
      getClientCount: vi.fn().mockReturnValue(0),
    };
    mockDomains = {
      intelligence: {
        getActiveAgents: vi.fn().mockReturnValue([{ id: 'a1' }]),
        getAgentInfo: vi.fn().mockReturnValue({ id: 'a1', role: 'coder' }),
        getAllAgentStates: vi.fn().mockReturnValue({}),
        getCapabilities: vi.fn().mockReturnValue({}),
      },
      orchestration: {
        getTasks: vi.fn().mockReturnValue([]),
        getDAG: vi.fn().mockReturnValue({}),
        getDeadLetters: vi.fn().mockReturnValue([]),
        getCriticalPath: vi.fn().mockReturnValue({}),
        getModulatorState: vi.fn().mockReturnValue({ active: true }),
        getGovernanceStats: vi.fn().mockReturnValue({ votes: 3 }),
      },
      quality: {
        getAuditHistory: vi.fn().mockReturnValue([]),
        getFailureModeDistribution: vi.fn().mockReturnValue({}),
        getComplianceStats: vi.fn().mockReturnValue({}),
        getAllBreakerStates: vi.fn().mockReturnValue({}),
        getAntigens: vi.fn().mockReturnValue([]),
      },
      communication: {
        getPheromoneState: vi.fn().mockReturnValue({}),
        getActiveChannels: vi.fn().mockReturnValue([]),
        getStigmergy: vi.fn().mockReturnValue({}),
      },
    };

    dashboard = new DashboardService({
      field,
      bus,
      store,
      metricsCollector: mockMetrics,
      stateBroadcaster: mockBroadcaster,
      healthChecker: mockHealth,
      traceCollector: mockTraces,
      domains: mockDomains,
      config: { port: 19100 },
    });
  });

  // ── 1. Constructor ─────────────────────────────────────────────

  it('creates instance with routes registered', () => {
    expect(dashboard).toBeDefined();
    expect(dashboard._routes).toBeInstanceOf(Map);
    expect(dashboard._routes.size).toBeGreaterThan(0);
  });

  // ── 2. getRouteCount ──────────────────────────────────────────

  it('getRouteCount returns at least 55 routes (55 V9 + 14 legacy)', () => {
    const count = dashboard.getRouteCount();
    // 55 V9 routes + 14 legacy aliases = 69 total in the registry
    expect(count).toBeGreaterThanOrEqual(55);
  });

  // ── 3. GET /api/v9/metrics ────────────────────────────────────

  it('GET /api/v9/metrics returns status 200 with metrics data', async () => {
    const res = await dashboard.handleRequest('GET', '/api/v9/metrics');
    expect(res.status).toBe(200);
    expect(res.data).toEqual({ agents: { active: 2 } });
    expect(mockMetrics.getMetrics).toHaveBeenCalled();
  });

  // ── 4. GET /api/v9/health ─────────────────────────────────────

  it('GET /api/v9/health returns status 200 with healthy status', async () => {
    const res = await dashboard.handleRequest('GET', '/api/v9/health');
    expect(res.status).toBe(200);
    expect(res.data.status).toBe('healthy');
    expect(res.data.score).toBe(0.9);
    expect(mockHealth.getHealth).toHaveBeenCalled();
  });

  // ── 5. GET /api/v9/field/stats ────────────────────────────────

  it('GET /api/v9/field/stats returns status 200 with field stats', async () => {
    const res = await dashboard.handleRequest('GET', '/api/v9/field/stats');
    expect(res.status).toBe(200);
    expect(res.data).toEqual({ signalCount: 100, gcRuns: 3 });
    expect(field.stats).toHaveBeenCalled();
  });

  // ── 6. GET /api/v9/agents/active ──────────────────────────────

  it('GET /api/v9/agents/active returns status 200 with agent array', async () => {
    const res = await dashboard.handleRequest('GET', '/api/v9/agents/active');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.data)).toBe(true);
    expect(res.data).toHaveLength(1);
    expect(res.data[0].id).toBe('a1');
    expect(mockDomains.intelligence.getActiveAgents).toHaveBeenCalled();
  });

  // ── 7. GET /api/v9/agents/:id — param extraction ─────────────

  it('GET /api/v9/agents/a1 extracts :id param and returns agent info', async () => {
    const res = await dashboard.handleRequest('GET', '/api/v9/agents/a1');
    expect(res.status).toBe(200);
    expect(res.data).toEqual({ id: 'a1', role: 'coder' });
    expect(mockDomains.intelligence.getAgentInfo).toHaveBeenCalledWith('a1');
  });

  // ── 8. GET /api/v9/tasks ──────────────────────────────────────

  it('GET /api/v9/tasks returns status 200', async () => {
    const res = await dashboard.handleRequest('GET', '/api/v9/tasks');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.data)).toBe(true);
    expect(mockDomains.orchestration.getTasks).toHaveBeenCalled();
  });

  // ── 9. GET /api/v9/reputation ─────────────────────────────────

  it('GET /api/v9/reputation returns status 200', async () => {
    const res = await dashboard.handleRequest('GET', '/api/v9/reputation');
    expect(res.status).toBe(200);
    expect(res.data).toBeDefined();
  });

  // ── 10. GET /api/v9/modulator ─────────────────────────────────

  it('GET /api/v9/modulator returns status 200', async () => {
    const res = await dashboard.handleRequest('GET', '/api/v9/modulator');
    expect(res.status).toBe(200);
    expect(res.data).toEqual({ active: true });
    expect(mockDomains.orchestration.getModulatorState).toHaveBeenCalled();
  });

  // ── 11. GET /api/v9/quality-audit ─────────────────────────────

  it('GET /api/v9/quality-audit returns status 200', async () => {
    const res = await dashboard.handleRequest('GET', '/api/v9/quality-audit');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.data)).toBe(true);
    expect(mockDomains.quality.getAuditHistory).toHaveBeenCalled();
  });

  // ── 12. GET /api/v9/pheromones ────────────────────────────────

  it('GET /api/v9/pheromones returns status 200', async () => {
    const res = await dashboard.handleRequest('GET', '/api/v9/pheromones');
    expect(res.status).toBe(200);
    expect(mockDomains.communication.getPheromoneState).toHaveBeenCalled();
  });

  // ── 13. GET /api/v9/governance ────────────────────────────────

  it('GET /api/v9/governance returns status 200', async () => {
    const res = await dashboard.handleRequest('GET', '/api/v9/governance');
    expect(res.status).toBe(200);
    expect(res.data).toEqual({ votes: 3 });
    expect(mockDomains.orchestration.getGovernanceStats).toHaveBeenCalled();
  });

  // ── 14. GET /api/v9/traces ────────────────────────────────────

  it('GET /api/v9/traces returns status 200', async () => {
    const res = await dashboard.handleRequest('GET', '/api/v9/traces');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.data)).toBe(true);
    expect(mockTraces.getTraces).toHaveBeenCalled();
  });

  // ── 15. GET /nonexistent ──────────────────────────────────────

  it('GET /nonexistent returns status 404', async () => {
    const res = await dashboard.handleRequest('GET', '/nonexistent');
    expect(res.status).toBe(404);
    expect(res.message).toBe('Not found');
    expect(res.data).toBeUndefined();
  });

  // ── 16. Legacy alias: GET /api/v1/health ──────────────────────

  it('legacy GET /api/v1/health returns same data as v9 health', async () => {
    const res = await dashboard.handleRequest('GET', '/api/v1/health');
    expect(res.status).toBe(200);
    expect(res.data.status).toBe('healthy');
    expect(res.data.score).toBe(0.9);
  });

  // ── 17. Legacy alias: GET /api/v1/metrics ─────────────────────

  it('legacy GET /api/v1/metrics returns same data as v9 metrics', async () => {
    const res = await dashboard.handleRequest('GET', '/api/v1/metrics');
    expect(res.status).toBe(200);
    expect(res.data).toEqual({ agents: { active: 2 } });
  });

  // ── 18. GET /api/v9/field/dimensions ──────────────────────────

  it('GET /api/v9/field/dimensions returns 12 dimensions', async () => {
    const res = await dashboard.handleRequest('GET', '/api/v9/field/dimensions');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.data)).toBe(true);
    expect(res.data).toHaveLength(12);
    // Verify each dimension has the expected shape
    for (const dim of res.data) {
      expect(dim).toHaveProperty('id');
      expect(dim).toHaveProperty('label');
      expect(dim).toHaveProperty('description');
      expect(typeof dim.id).toBe('string');
    }
    // Verify a known dimension exists
    const taskLoad = res.data.find(d => d.id === 'task_load');
    expect(taskLoad).toBeDefined();
    expect(taskLoad.label).toBe('Task Load');
  });
});
