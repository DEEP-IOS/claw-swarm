/**
 * FailureAnalyzer unit tests
 * Tests classification of agent/tool failures into actionable categories.
 *
 * @module tests/quality/analysis/failure-analyzer
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock ModuleBase so that constructor stores deps on `this` ─────────────
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
}));

// ─── Import after mocks ────────────────────────────────────────────────────
const { FailureAnalyzer } = await import('../../../src/quality/analysis/failure-analyzer.js');

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
    subscribe: vi.fn((topic, handler) => { handlers[topic] = handler; }),
    unsubscribe: vi.fn(),
    _handlers: handlers,
  };
}

function createMockStore() {
  const data = new Map();
  return {
    put: vi.fn((domain, key, value) => data.set(`${domain}/${key}`, value)),
    get: vi.fn((domain, key) => data.get(`${domain}/${key}`) || null),
    query: vi.fn((domain, opts) => {
      const results = [];
      for (const [k, v] of data) {
        if (k.startsWith(`${domain}/`)) {
          if (!opts?.prefix || k.includes(opts.prefix)) results.push(v);
        }
      }
      return results;
    }),
    delete: vi.fn((domain, key) => data.delete(`${domain}/${key}`)),
  };
}

// ─── Test Suite ────────────────────────────────────────────────────────────

describe('FailureAnalyzer', () => {
  let analyzer;
  let field;
  let bus;
  let store;

  beforeEach(() => {
    field = createMockField();
    bus = createMockBus();
    store = createMockStore();
    analyzer = new FailureAnalyzer({ field, bus, store, config: {} });
  });

  // ── 1. Constructor ──────────────────────────────────────────────────

  it('creates an instance with initial stats', () => {
    expect(analyzer).toBeInstanceOf(FailureAnalyzer);
    const stats = analyzer.getStats();
    expect(stats.totalClassified).toBe(0);
    expect(stats.classDistribution).toEqual({});
    expect(stats.avgConfidence).toBe(0);
  });

  // ── 2. classify: tool_error ─────────────────────────────────────────

  it('classifies "schema validation" errors as tool_error', () => {
    const result = analyzer.classify({
      agentId: 'agent-1',
      error: 'schema validation failed for tool swarm_run',
      toolName: 'swarm_run',
      taskDescription: 'Fix the bug',
    });

    expect(result.class).toBe('tool_error');
    expect(result.severity).toBe('medium');
    expect(result.confidence).toBeGreaterThan(0);
  });

  // ── 3. classify: model_hallucination (CJK) ─────────────────────────

  it('classifies "file not found" / CJK variant as model_hallucination', () => {
    const result = analyzer.classify({
      agentId: 'agent-2',
      error: '\u6587\u4EF6\u4E0D\u5B58\u5728: src/foo.js',
      toolName: 'read',
      taskDescription: 'Read the file',
    });

    expect(result.class).toBe('model_hallucination');
    expect(result.severity).toBe('high');
  });

  // ── 4. classify: context_overflow ───────────────────────────────────

  it('classifies "context window" errors as context_overflow', () => {
    const result = analyzer.classify({
      agentId: 'agent-3',
      error: 'context window exceeded, token limit reached',
      toolName: null,
      taskDescription: 'Large task',
    });

    expect(result.class).toBe('context_overflow');
    expect(result.severity).toBe('medium');
  });

  // ── 5. classify: permission_denied ──────────────────────────────────

  it('classifies "forbidden" / "403" errors as permission_denied', () => {
    const result = analyzer.classify({
      agentId: 'agent-4',
      error: 'HTTP 403 forbidden',
      toolName: 'fetch',
      taskDescription: 'Access resource',
    });

    expect(result.class).toBe('permission_denied');
    expect(result.severity).toBe('high');
  });

  // ── 6. classify: task_ambiguity ─────────────────────────────────────

  it('classifies "ambiguous" / CJK variant as task_ambiguity', () => {
    const result = analyzer.classify({
      agentId: 'agent-5',
      error: '\u4E0D\u786E\u5B9A what action to take',
      toolName: null,
      taskDescription: 'Do something',
    });

    expect(result.class).toBe('task_ambiguity');
    expect(result.severity).toBe('low');
  });

  // ── 7. classify: unknown defaults to task_ambiguity with low conf ──

  it('defaults unknown errors to task_ambiguity with low confidence', () => {
    const result = analyzer.classify({
      agentId: 'agent-6',
      error: 'xyzzy gobbledygook nonsense',
      toolName: null,
      taskDescription: '',
    });

    expect(result.class).toBe('task_ambiguity');
    // No indicators matched, so bestRatio is 0 => confidence = max(0.2, 0) = 0.2
    expect(result.confidence).toBeLessThanOrEqual(0.3);
  });

  // ── 8. classify: suggestedStrategy matches class default ───────────

  it('returns suggestedStrategy matching the class default', () => {
    const toolResult = analyzer.classify({
      agentId: 'agent-1',
      error: 'schema validation failed',
      toolName: 'swarm_run',
      taskDescription: '',
    });
    expect(toolResult.suggestedStrategy).toBe('retry_with_fix');

    const halluResult = analyzer.classify({
      agentId: 'agent-2',
      error: 'file not found',
      toolName: 'read',
      taskDescription: '',
    });
    expect(halluResult.suggestedStrategy).toBe('add_context');

    const overflowResult = analyzer.classify({
      agentId: 'agent-3',
      error: 'context window exceeded',
      toolName: null,
      taskDescription: '',
    });
    expect(overflowResult.suggestedStrategy).toBe('split_task');

    const permResult = analyzer.classify({
      agentId: 'agent-4',
      error: 'forbidden access',
      toolName: null,
      taskDescription: '',
    });
    expect(permResult.suggestedStrategy).toBe('escalate');
  });

  // ── 9. classify: DIM_ALARM emitted with severity-based strength ────

  it('emits DIM_ALARM with severity-based strength', () => {
    // low severity => 0.3
    analyzer.classify({
      agentId: 'agent-amb',
      error: 'ambiguous instruction',
      toolName: null,
      taskDescription: '',
    });
    expect(field.emit).toHaveBeenCalled();
    const lowCall = field.emit.mock.calls[0][0];
    expect(lowCall.dimension).toBe('alarm');
    expect(lowCall.strength).toBe(0.3);

    field.emit.mockClear();

    // medium severity => 0.5
    analyzer.classify({
      agentId: 'agent-med',
      error: 'schema validation failed',
      toolName: 'swarm_run',
      taskDescription: '',
    });
    const medCall = field.emit.mock.calls[0][0];
    expect(medCall.strength).toBe(0.5);

    field.emit.mockClear();

    // high severity => 0.7
    analyzer.classify({
      agentId: 'agent-high',
      error: 'file not found in module',
      toolName: 'read',
      taskDescription: '',
    });
    const highCall = field.emit.mock.calls[0][0];
    expect(highCall.strength).toBe(0.7);
  });

  // ── 10. classify: bus.publish with full context ─────────────────────

  it('publishes quality.failure.classified on bus with full context', () => {
    const ctx = {
      agentId: 'agent-1',
      error: 'schema validation failed for tool swarm_run',
      toolName: 'swarm_run',
      taskDescription: 'Fix the bug',
    };
    const result = analyzer.classify(ctx);

    expect(bus.publish).toHaveBeenCalledTimes(1);
    expect(bus.publish.mock.calls[0][0]).toBe('quality.failure.classified');
    const payload = bus.publish.mock.calls[0][1];
    expect(payload.class).toBe(result.class);
    expect(payload.severity).toBe(result.severity);
    expect(payload.failureContext).toEqual(ctx);
  });

  // ── 11. classify: store.put for audit record ────────────────────────

  it('persists audit record in store', () => {
    analyzer.classify({
      agentId: 'agent-1',
      error: 'schema validation failed',
      toolName: 'swarm_run',
      taskDescription: '',
    });

    expect(store.put).toHaveBeenCalledTimes(1);
    const [domain, key, value] = store.put.mock.calls[0];
    expect(domain).toBe('quality');
    expect(key).toMatch(/^failure-agent-1-/);
    expect(value.class).toBe('tool_error');
    expect(value.timestamp).toBeGreaterThan(0);
  });

  // ── 12. getStats: totalClassified and classDistribution updated ────

  it('updates totalClassified and classDistribution after multiple classifications', () => {
    analyzer.classify({ agentId: 'a1', error: 'schema validation', toolName: 't', taskDescription: '' });
    analyzer.classify({ agentId: 'a2', error: 'file not found', toolName: 't', taskDescription: '' });
    analyzer.classify({ agentId: 'a3', error: 'schema validation', toolName: 't', taskDescription: '' });

    const stats = analyzer.getStats();
    expect(stats.totalClassified).toBe(3);
    expect(stats.classDistribution.tool_error).toBe(2);
    expect(stats.classDistribution.model_hallucination).toBe(1);
    expect(stats.avgConfidence).toBeGreaterThan(0);
  });
});
