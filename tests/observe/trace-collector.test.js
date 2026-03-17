/**
 * TraceCollector unit tests
 * Tests span lifecycle, parent-child relationships, trace tree reconstruction,
 * and cumulative statistics.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TraceCollector } from '../../src/observe/health/trace-collector.js';

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

/**
 * Mock DomainStore that supports the callback-based query() signature
 * used by TraceCollector: store.query(domain, filterFn).
 */
function createMockStore() {
  const data = new Map();
  return {
    put: vi.fn((domain, key, value) => {
      data.set(`${domain}/${key}`, structuredClone(value));
    }),
    get: vi.fn((domain, key) => {
      const v = data.get(`${domain}/${key}`);
      return v ? structuredClone(v) : null;
    }),
    query: vi.fn((domain, filterFn) => {
      const results = [];
      for (const [compositeKey, value] of data) {
        if (!compositeKey.startsWith(`${domain}/`)) continue;
        const key = compositeKey.slice(domain.length + 1);
        if (typeof filterFn === 'function') {
          if (filterFn(value, key)) results.push(structuredClone(value));
        } else {
          results.push(structuredClone(value));
        }
      }
      return results;
    }),
    delete: vi.fn((domain, key) => {
      data.delete(`${domain}/${key}`);
    }),
    _data: data,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TraceCollector', () => {
  let store;
  let tracer;

  beforeEach(() => {
    store = createMockStore();
    tracer = new TraceCollector({ store });
  });

  afterEach(() => {
    tracer.stop();
  });

  // ---- Constructor --------------------------------------------------------

  it('creates instance with empty stats', () => {
    const stats = tracer.getStats();
    expect(stats.totalSpans).toBe(0);
    expect(stats.completedSpans).toBe(0);
    expect(stats.avgSpanDuration).toBe(0);
  });

  // ---- startSpan ----------------------------------------------------------

  it('startSpan returns a spanId and stores the span', () => {
    const spanId = tracer.startSpan('test-op');
    expect(typeof spanId).toBe('string');
    expect(spanId.length).toBeGreaterThan(0);
    // Verify store.put was called
    expect(store.put).toHaveBeenCalledWith(
      'observe',
      `span-${spanId}`,
      expect.objectContaining({
        spanId,
        name: 'test-op',
        status: 'running',
        parentSpanId: null,
      }),
    );
  });

  // ---- endSpan ------------------------------------------------------------

  it('endSpan sets endTime, durationMs, and status=completed', () => {
    const spanId = tracer.startSpan('my-op');
    const ended = tracer.endSpan(spanId);
    expect(ended).not.toBeNull();
    expect(ended.status).toBe('completed');
    expect(typeof ended.endTime).toBe('number');
    expect(typeof ended.durationMs).toBe('number');
    expect(ended.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('endSpan with metadata.failed=true sets status=failed', () => {
    const spanId = tracer.startSpan('failing-op');
    const ended = tracer.endSpan(spanId, { failed: true, reason: 'timeout' });
    expect(ended.status).toBe('failed');
    expect(ended.metadata.failed).toBe(true);
    expect(ended.metadata.reason).toBe('timeout');
  });

  it('endSpan returns null for unknown spanId', () => {
    const result = tracer.endSpan('nonexistent-id');
    expect(result).toBeNull();
  });

  // ---- addEvent -----------------------------------------------------------

  it('addEvent appends an event to the span events array', () => {
    const spanId = tracer.startSpan('evented-op');
    const added = tracer.addEvent(spanId, { name: 'checkpoint', data: { step: 1 } });
    expect(added).toBe(true);

    // End and verify events persisted
    const ended = tracer.endSpan(spanId);
    // The ended span comes from store, which was updated
    // Verify via store directly
    const storedSpan = store.get('observe', `span-${spanId}`);
    expect(storedSpan.events).toHaveLength(1);
    expect(storedSpan.events[0].name).toBe('checkpoint');
    expect(storedSpan.events[0].data).toEqual({ step: 1 });
    expect(typeof storedSpan.events[0].ts).toBe('number');
  });

  it('addEvent returns false for unknown spanId', () => {
    const result = tracer.addEvent('no-such-span', { name: 'x' });
    expect(result).toBe(false);
  });

  // ---- Parent-child relationships -----------------------------------------

  it('child span has parentSpanId linking to parent', () => {
    const parentId = tracer.startSpan('parent-op');
    // Use the parent's traceId (which defaults to parentId) for the child
    const parentSpan = store.get('observe', `span-${parentId}`);
    const childId = tracer.startSpan('child-op', parentId, parentSpan.traceId);

    const childSpan = store.get('observe', `span-${childId}`);
    expect(childSpan.parentSpanId).toBe(parentId);
    expect(childSpan.traceId).toBe(parentSpan.traceId);
  });

  // ---- getTrace: tree reconstruction --------------------------------------

  it('getTrace returns tree structure with children array', () => {
    const rootId = tracer.startSpan('root');
    const rootSpan = store.get('observe', `span-${rootId}`);
    const traceId = rootSpan.traceId;

    const childId = tracer.startSpan('child', rootId, traceId);
    tracer.endSpan(childId);
    tracer.endSpan(rootId);

    const tree = tracer.getTrace(traceId);
    expect(tree).not.toBeNull();
    expect(tree.traceId).toBe(traceId);
    expect(tree.rootSpan).toBeDefined();
    expect(tree.rootSpan.name).toBe('root');
    expect(tree.rootSpan.children).toHaveLength(1);
    expect(tree.rootSpan.children[0].name).toBe('child');
    expect(tree.spans).toHaveLength(2);
    expect(typeof tree.totalDurationMs).toBe('number');
  });

  it('getTrace returns null for unknown traceId', () => {
    const result = tracer.getTrace('no-such-trace');
    expect(result).toBeNull();
  });

  // ---- getTraces: summaries -----------------------------------------------

  it('getTraces returns trace summaries grouped by traceId', () => {
    // Create two separate traces
    const id1 = tracer.startSpan('trace-A');
    tracer.endSpan(id1);

    const id2 = tracer.startSpan('trace-B');
    tracer.endSpan(id2);

    const summaries = tracer.getTraces();
    expect(summaries.length).toBe(2);
    for (const s of summaries) {
      expect(s).toHaveProperty('traceId');
      expect(s).toHaveProperty('rootSpan');
      expect(s).toHaveProperty('spanCount');
      expect(s).toHaveProperty('totalDurationMs');
      expect(s).toHaveProperty('startTime');
      expect(s).toHaveProperty('status');
      expect(s.spanCount).toBe(1);
    }
  });

  it('getTraces respects limit filter', () => {
    // Create 5 traces
    for (let i = 0; i < 5; i++) {
      const id = tracer.startSpan(`trace-${i}`);
      tracer.endSpan(id);
    }

    const limited = tracer.getTraces({ limit: 2 });
    expect(limited).toHaveLength(2);

    const all = tracer.getTraces({ limit: 100 });
    expect(all).toHaveLength(5);
  });

  // ---- getStats -----------------------------------------------------------

  it('getStats returns correct totals and avg duration', () => {
    const id1 = tracer.startSpan('op-1');
    const id2 = tracer.startSpan('op-2');
    const id3 = tracer.startSpan('op-3');

    tracer.endSpan(id1);
    tracer.endSpan(id2);
    // id3 left running intentionally

    const stats = tracer.getStats();
    expect(stats.totalSpans).toBe(3);
    expect(stats.completedSpans).toBe(2);
    expect(typeof stats.avgSpanDuration).toBe('number');
    expect(stats.avgSpanDuration).toBeGreaterThanOrEqual(0);
  });
});
