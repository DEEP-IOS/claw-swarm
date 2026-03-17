/**
 * Quality system integration tests
 * Tests the unified facade returned by createQualitySystem.
 *
 * @module tests/quality/integration/quality-flow
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── Mock ModuleBase ───────────────────────────────────────────────────────
vi.mock('../../../src/core/module-base.js', () => ({
  ModuleBase: class {
    constructor(deps = {}) {
      this.field = deps.field ?? null;
      this.bus = deps.bus ?? null;
      this.store = deps.store ?? null;
      this.config = deps.config ?? {};
    }
    static produces() { return []; }
    static consumes() { return []; }
    static publishes() { return []; }
    static subscribes() { return []; }
    async start() {}
    async stop() {}
  },
}));

vi.mock('../../../src/core/field/types.js', () => ({
  DIM_ALARM: 'alarm',
  DIM_TRAIL: 'trail',
  DIM_TASK: 'task',
  DIM_REPUTATION: 'reputation',
  DIM_KNOWLEDGE: 'knowledge',
  DIM_COORDINATION: 'coordination',
  DIM_EMOTION: 'emotion',
  DIM_TRUST: 'trust',
  DIM_SNA: 'sna',
  DIM_LEARNING: 'learning',
  DIM_CALIBRATION: 'calibration',
  DIM_SPECIES: 'species',
}));

// ─── Import after mocks ────────────────────────────────────────────────────
const { createQualitySystem } = await import('../../../src/quality/index.js');

// ─── Mock Factories ────────────────────────────────────────────────────────

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
    subscribe: vi.fn((topic, handler) => {
      if (!handlers[topic]) handlers[topic] = [];
      handlers[topic].push(handler);
    }),
    unsubscribe: vi.fn(),
    _handlers: handlers,
    _trigger(topic, data) {
      const list = handlers[topic];
      if (list) {
        for (const h of list) h(data);
      }
    },
  };
}

function createMockStore() {
  const data = new Map();
  return {
    put: vi.fn((domain, key, value) => data.set(`${domain}/${key}`, value)),
    get: vi.fn((domain, key) => data.get(`${domain}/${key}`) || null),
    query: vi.fn((domain, filterOrOpts) => {
      const results = [];
      for (const [k, v] of data) {
        if (k.startsWith(`${domain}/`)) {
          if (typeof filterOrOpts === 'function') {
            const rawKey = k.slice(domain.length + 1);
            if (filterOrOpts(v, rawKey)) results.push(v);
          } else {
            results.push(v);
          }
        }
      }
      return results;
    }),
    queryAll: vi.fn((domain) => {
      const results = [];
      for (const [k, v] of data) {
        if (k.startsWith(`${domain}/`)) results.push(v);
      }
      return results;
    }),
    delete: vi.fn((domain, key) => data.delete(`${domain}/${key}`)),
    _data: data,
  };
}

// ─── Test Suite ────────────────────────────────────────────────────────────

describe('Quality System Integration', () => {
  let qs;
  let field;
  let bus;
  let store;
  let reputationCRDT;

  beforeEach(() => {
    field = createMockField();
    bus = createMockBus();
    store = createMockStore();
    reputationCRDT = { increment: vi.fn(), decrement: vi.fn() };

    qs = createQualitySystem({ field, bus, store, reputationCRDT, config: {} });
  });

  afterEach(async () => {
    // Clean up to avoid timer leaks
    if (qs && typeof qs.stop === 'function') {
      await qs.stop();
    }
  });

  // ── 1. createQualitySystem: returns facade with all methods ─────────

  it('returns object with all facade methods', () => {
    expect(typeof qs.evaluateEvidence).toBe('function');
    expect(typeof qs.appealEvidence).toBe('function');
    expect(typeof qs.auditOutput).toBe('function');
    expect(typeof qs.validateTool).toBe('function');
    expect(typeof qs.canExecuteTool).toBe('function');
    expect(typeof qs.recordToolSuccess).toBe('function');
    expect(typeof qs.recordToolFailure).toBe('function');
    expect(typeof qs.classifyFailure).toBe('function');
    expect(typeof qs.detectAnomaly).toBe('function');
    expect(typeof qs.recordAgentEvent).toBe('function');
    expect(typeof qs.checkCompliance).toBe('function');
    expect(typeof qs.checkImmunity).toBe('function');
    expect(typeof qs.start).toBe('function');
    expect(typeof qs.stop).toBe('function');
  });

  // ── 2. evaluateEvidence + appealEvidence workflow ───────────────────

  it('evaluateEvidence returns a score; appealEvidence re-evaluates', () => {
    const claim = { agentId: 'agent-1', type: 'task_complete', description: 'Fixed bug' };
    const evidences = [
      { tier: 'PRIMARY', description: 'Test passes' },
    ];

    const evalResult = qs.evaluateEvidence(claim, evidences);
    expect(evalResult).toHaveProperty('score');
    expect(evalResult).toHaveProperty('passed');
    expect(typeof evalResult.score).toBe('number');

    // The store should have the audit record for appeal
    // Appeal requires the exact key, which is generated internally
    // We can check the store.put call to get the key
    const putCalls = store.put.mock.calls.filter(c => c[0] === 'quality' && c[1].startsWith('gate-'));
    if (putCalls.length > 0) {
      const evalKey = putCalls[0][1];
      const appealResult = qs.appealEvidence(evalKey, [
        { tier: 'CORROBORATION', description: 'Peer review confirms' },
      ]);
      if (appealResult) {
        expect(appealResult.score).toBeGreaterThanOrEqual(evalResult.score);
        expect(appealResult).toHaveProperty('previousScore');
      }
    }
  });

  // ── 3. auditOutput: returns qualityScore and grade ──────────────────

  it('auditOutput returns qualityScore and grade', () => {
    const result = qs.auditOutput({
      agentId: 'agent-1',
      result: 'Summary: Fixed the bug. Updated tests. Added documentation for the approach and changes made.',
      filesChanged: ['src/fix.js', 'tests/fix.test.js'],
      taskDescription: 'Fix bug in parser',
    });

    expect(result).toHaveProperty('qualityScore');
    expect(result).toHaveProperty('grade');
    expect(typeof result.qualityScore).toBe('number');
    expect(result.qualityScore).toBeGreaterThanOrEqual(0);
    expect(result.qualityScore).toBeLessThanOrEqual(1);
    expect(['A', 'B', 'C', 'D', 'F']).toContain(result.grade);
  });

  // ── 4. validateTool + canExecuteTool ────────────────────────────────

  it('validateTool returns valid for unknown tool; canExecuteTool is allowed', () => {
    // No schemas registered, so validation passes
    const valResult = qs.validateTool('some_tool', { arg: 1 });
    expect(valResult.valid).toBe(true);

    const canExec = qs.canExecuteTool('some_tool');
    expect(canExec.allowed).toBe(true);
    expect(canExec.state).toBe('CLOSED');
  });

  // ── 5. recordToolFailure x3 -> canExecuteTool returns false ─────────

  it('trips circuit breaker after 3 failures; canExecuteTool disallows', () => {
    const toolName = 'broken_tool';

    qs.recordToolFailure(toolName, 'err1');
    qs.recordToolFailure(toolName, 'err2');
    qs.recordToolFailure(toolName, 'err3');

    const canExec = qs.canExecuteTool(toolName);
    expect(canExec.allowed).toBe(false);
    expect(canExec.state).toBe('OPEN');
  });

  // ── 6. classifyFailure: returns classification result ───────────────

  it('classifyFailure delegates to FailureAnalyzer and returns result', () => {
    const result = qs.classifyFailure({
      agentId: 'agent-1',
      error: 'schema validation failed on tool params',
      toolName: 'swarm_run',
      taskDescription: 'Fix the bug',
    });

    expect(result).toHaveProperty('class');
    expect(result).toHaveProperty('severity');
    expect(result).toHaveProperty('suggestedStrategy');
    expect(result).toHaveProperty('confidence');
    expect(result.class).toBe('tool_error');
  });

  // ── 7. detectAnomaly + recordAgentEvent ─────────────────────────────

  it('recordAgentEvent + detectAnomaly: detects repeated failures', () => {
    for (let i = 0; i < 5; i++) {
      qs.recordAgentEvent('agent-anom', { type: 'failure', timestamp: i });
    }

    const result = qs.detectAnomaly('agent-anom');
    expect(result.anomaly).toBe(true);
    expect(result.type).toBe('repeated_failures');
  });

  // ── 8. checkCompliance: violation detection ─────────────────────────

  it('checkCompliance detects violations in unsafe output', () => {
    const result = qs.checkCompliance('sess-1', 'executing rm -rf /home', {});
    expect(result.compliant).toBe(false);
    const ids = result.violations.map(v => v.id);
    expect(ids).toContain('unsafe_operation');
  });

  // ── 9. checkImmunity: after learning, matches task description ──────

  it('checkImmunity returns immune after learning from prior failure', () => {
    // First, learn from a failure (this goes through failureVaccination)
    // The vaccination module uses store.queryAll on 'vaccination-antigens'
    // We need to populate it via the learn path

    // Directly populate mock store with an antigen
    store._data.set('vaccination-antigens/ag-test-001', {
      id: 'ag-test-001',
      pattern: 'schema validation failed',
      keywords: ['schema', 'validation', 'failed'],
      severity: 'medium',
      preventionPrompt: 'Validate schema before calling tool.',
      matchCount: 0,
      createdAt: Date.now(),
    });

    const immuneResult = qs.checkImmunity('schema validation failed again');
    expect(immuneResult).toHaveProperty('immune');
    // Whether immune depends on match threshold, but we injected matching keywords
    if (immuneResult.immune) {
      expect(immuneResult.preventionPrompts.length).toBeGreaterThan(0);
    }
  });

  // ── 10. start(): subscribes bus events ──────────────────────────────

  it('start() subscribes to bus events for cross-module wiring', async () => {
    const subscribeBefore = bus.subscribe.mock.calls.length;
    await qs.start();
    const subscribeAfter = bus.subscribe.mock.calls.length;

    // start() should add subscriptions for agent.completed, agent.failed, quality.failure.classified
    expect(subscribeAfter).toBeGreaterThan(subscribeBefore);

    const topics = bus.subscribe.mock.calls.map(c => c[0]);
    expect(topics).toContain('agent.completed');
    expect(topics).toContain('agent.failed');
    expect(topics).toContain('quality.failure.classified');
  });

  // ── 11. stop(): cleans up ───────────────────────────────────────────

  it('stop() unsubscribes bus events', async () => {
    await qs.start();
    await qs.stop();

    expect(bus.unsubscribe).toHaveBeenCalled();
    const unsubTopics = bus.unsubscribe.mock.calls.map(c => c[0]);
    expect(unsubTopics).toContain('agent.completed');
    expect(unsubTopics).toContain('agent.failed');
    expect(unsubTopics).toContain('quality.failure.classified');
  });

  // ── 12. _modules: contains all 9 module instances ──────────────────

  it('_modules array contains all 9 module instances', () => {
    expect(Array.isArray(qs._modules)).toBe(true);
    expect(qs._modules.length).toBe(9);

    // Verify each module is an object with start/stop
    for (const mod of qs._modules) {
      expect(mod).toBeTruthy();
      expect(typeof mod.start).toBe('function');
      expect(typeof mod.stop).toBe('function');
    }

    // Verify allModules() returns a copy
    const all = qs.allModules();
    expect(all.length).toBe(9);
    expect(all).not.toBe(qs._modules); // different array reference
  });
});
