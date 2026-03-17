/**
 * FailureVaccination - Failure immunity system tests
 * @module tests/quality/resilience/failure-vaccination.test
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FailureVaccination } from '../../../src/quality/resilience/failure-vaccination.js';

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

/**
 * Mock store that supports queryAll and standard put/get.
 * queryAll returns all values stored under a given domain.
 */
function createMockStore() {
  const data = new Map();
  return {
    put: vi.fn((domain, key, value) => data.set(`${domain}/${key}`, value)),
    get: vi.fn((domain, key) => data.get(`${domain}/${key}`) || null),
    queryAll: vi.fn((domain) => {
      const results = [];
      for (const [k, v] of data) {
        if (k.startsWith(`${domain}/`)) results.push(v);
      }
      return results;
    }),
    query: vi.fn((domain, filterFn) => {
      const results = [];
      for (const [k, v] of data) {
        if (k.startsWith(`${domain}/`)) {
          const bareKey = k.slice(domain.length + 1);
          if (!filterFn || filterFn(v, bareKey)) results.push(v);
        }
      }
      return results;
    }),
    delete: vi.fn((domain, key) => data.delete(`${domain}/${key}`)),
    _data: data,
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function createVaccination(overrides = {}) {
  const field = createMockField();
  const bus = createMockBus();
  const store = createMockStore();
  const vacc = new FailureVaccination({ field, bus, store, ...overrides });
  return { vacc, field, bus, store };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('FailureVaccination', () => {
  let vacc, field, bus, store;

  beforeEach(() => {
    ({ vacc, field, bus, store } = createVaccination());
  });

  // 1. Constructor
  it('creates instance with default matchThreshold', () => {
    expect(vacc).toBeInstanceOf(FailureVaccination);
    expect(vacc._matchThreshold).toBe(0.5);
  });

  // 2. learn: creates new antigen from failure context
  it('learn: creates a new antigen from failure context', () => {
    const antigen = vacc.learn({
      error: 'TypeError: cannot read property length of undefined',
      taskDescription: 'Parse the user input data',
      severity: 'high',
    });

    expect(antigen).not.toBeNull();
    expect(antigen.id).toMatch(/^ag-/);
    expect(antigen.keywords.length).toBeGreaterThan(0);
    expect(antigen.severity).toBe('high');
    expect(antigen.preventionPrompt).toBeDefined();

    // Stored in mock store
    expect(store.put).toHaveBeenCalledWith(
      'vaccination-antigens',
      antigen.id,
      expect.objectContaining({ id: antigen.id }),
    );
  });

  // 3. learn: merges with existing similar antigen (70% keyword overlap)
  it('learn: merges keywords into existing antigen with high overlap', () => {
    // First learn
    const first = vacc.learn({
      error: 'TypeError: cannot read property length of undefined',
      taskDescription: 'Parse the user input data',
    });

    // Second learn with very similar keywords
    const second = vacc.learn({
      error: 'TypeError: cannot read property length of null',
      taskDescription: 'Parse the user input stream',
    });

    // Should have merged into the first antigen (same id)
    expect(second.id).toBe(first.id);
    // Keywords should be a superset
    expect(second.keywords.length).toBeGreaterThanOrEqual(first.keywords.length);
  });

  // 4. checkImmunity: no antigens -> { immune: false }
  it('checkImmunity: returns immune=false when no antigens exist', () => {
    const result = vacc.checkImmunity('some task about file processing');
    expect(result.immune).toBe(false);
    expect(result.antigens).toEqual([]);
    expect(result.preventionPrompts).toEqual([]);
  });

  // 5. checkImmunity: matching antigen -> { immune: true, preventionPrompts non-empty }
  it('checkImmunity: returns immune=true when antigen matches', () => {
    // Learn a failure pattern
    vacc.learn({
      error: 'timeout error connecting to database server',
      taskDescription: 'Query the database for user records',
      severity: 'high',
      preventionPrompt: 'Ensure database connection pool is initialized before querying.',
    });

    // Check immunity with a task that contains matching keywords
    const result = vacc.checkImmunity('timeout error when connecting to the database server');

    expect(result.immune).toBe(true);
    expect(result.antigens.length).toBeGreaterThan(0);
    expect(result.preventionPrompts.length).toBeGreaterThan(0);
  });

  // 6. checkImmunity: DIM_KNOWLEDGE emitted on match
  it('checkImmunity: emits DIM_KNOWLEDGE signal on antigen match', () => {
    vacc.learn({
      error: 'network timeout failure during authentication',
      taskDescription: 'Authenticate user session',
    });

    vacc.checkImmunity('network timeout failure during authentication check');

    expect(field.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        dimension: 'knowledge',
        scope: 'vaccination',
        emitterId: 'FailureVaccination',
      }),
    );
  });

  // 7. checkImmunity: bus.publish 'quality.vaccination.matched'
  it('checkImmunity: publishes quality.vaccination.matched on bus', () => {
    vacc.learn({
      error: 'permission denied accessing secret file',
      taskDescription: 'Read configuration from secret store',
    });

    vacc.checkImmunity('permission denied when accessing secret file resource');

    expect(bus.publish).toHaveBeenCalledWith(
      'quality.vaccination.matched',
      expect.objectContaining({
        matchedCount: expect.any(Number),
        antigens: expect.any(Array),
      }),
      'FailureVaccination',
    );
  });

  // 8. checkImmunity: matchCount incremented on hit
  it('checkImmunity: increments matchCount on antigen hit', () => {
    vacc.learn({
      error: 'segmentation fault in parser module execution',
      taskDescription: 'Parse binary file format',
    });

    // First immunity check
    vacc.checkImmunity('segmentation fault in parser module for binary data');
    // Second immunity check
    vacc.checkImmunity('segmentation fault in parser module handling');

    // Retrieve the stored antigen
    const antigens = vacc.getAntigens();
    expect(antigens.length).toBe(1);
    // matchCount should have been incremented at least twice during checkImmunity
    expect(antigens[0].matchCount).toBeGreaterThanOrEqual(2);
  });

  // 9. Keyword matching supports CJK (Chinese characters)
  it('keyword matching supports CJK characters', () => {
    vacc.learn({
      error: '数据库连接超时 database timeout',
      taskDescription: '查询用户记录',
    });

    const result = vacc.checkImmunity('数据库连接超时问题 database timeout issue');

    expect(result.immune).toBe(true);
    expect(result.antigens.length).toBeGreaterThan(0);
  });

  // 10. getAntigens returns stored antigens
  it('getAntigens: returns all stored antigens', () => {
    vacc.learn({
      error: 'error alpha in process one',
      taskDescription: 'Task alpha for module processing',
    });
    vacc.learn({
      error: 'error beta in network communication layer',
      taskDescription: 'Task beta for network protocol handling',
    });

    const antigens = vacc.getAntigens();
    expect(antigens.length).toBe(2);
    expect(antigens[0].id).toMatch(/^ag-/);
    expect(antigens[1].id).toMatch(/^ag-/);
  });
});
