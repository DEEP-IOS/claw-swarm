/**
 * AnomalyDetector unit tests
 * Tests behavioral anomaly detection in agent execution patterns.
 *
 * @module tests/quality/analysis/anomaly-detector
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

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
}));

// ─── Import after mocks ────────────────────────────────────────────────────
const { AnomalyDetector } = await import('../../../src/quality/analysis/anomaly-detector.js');

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

// ─── Test Suite ────────────────────────────────────────────────────────────

describe('AnomalyDetector', () => {
  let detector;
  let field;
  let bus;

  beforeEach(() => {
    field = createMockField();
    bus = createMockBus();
    detector = new AnomalyDetector({ field, bus, config: {} });
  });

  // ── 1. Constructor ──────────────────────────────────────────────────

  it('creates an instance with empty histories', () => {
    expect(detector).toBeInstanceOf(AnomalyDetector);
    const stats = detector.getStats();
    expect(stats.totalDetections).toBe(0);
    expect(stats.typeDistribution).toEqual({});
  });

  // ── 2. detect: empty history ────────────────────────────────────────

  it('returns { anomaly: false } for agent with no history', () => {
    const result = detector.detect('unknown-agent');
    expect(result.anomaly).toBe(false);
    expect(result.type).toBeNull();
    expect(result.confidence).toBe(0);
  });

  // ── 3. repeated_failures: 3+ consecutive failures in last 5 ────────

  it('detects repeated_failures when 3+ failures in last 5 events', () => {
    for (let i = 0; i < 4; i++) {
      detector.recordEvent('agent-1', { type: 'failure', timestamp: Date.now() + i });
    }

    const result = detector.detect('agent-1');
    expect(result.anomaly).toBe(true);
    expect(result.type).toBe('repeated_failures');
    expect(result.confidence).toBeGreaterThan(0);
  });

  // ── 4. oscillating_outputs: A->B->A on same file ───────────────────

  it('detects oscillating_outputs for A->B->A edit pattern', () => {
    detector.recordEvent('agent-2', {
      type: 'file_edit', filePath: 'foo.js', content: 'A', timestamp: 1,
    });
    detector.recordEvent('agent-2', {
      type: 'file_edit', filePath: 'foo.js', content: 'B', timestamp: 2,
    });
    detector.recordEvent('agent-2', {
      type: 'file_edit', filePath: 'foo.js', content: 'A', timestamp: 3,
    });

    const result = detector.detect('agent-2');
    expect(result.anomaly).toBe(true);
    expect(result.type).toBe('oscillating_outputs');
    expect(result.confidence).toBe(0.8);
  });

  // ── 5. resource_exhaustion: monotonically increasing token usage ────

  it('detects resource_exhaustion for monotonically increasing tokens', () => {
    detector.recordEvent('agent-3', { type: 'tool_call', tokensUsed: 1000, timestamp: 1 });
    detector.recordEvent('agent-3', { type: 'tool_call', tokensUsed: 2000, timestamp: 2 });
    detector.recordEvent('agent-3', { type: 'tool_call', tokensUsed: 3000, timestamp: 3 });

    const result = detector.detect('agent-3');
    expect(result.anomaly).toBe(true);
    expect(result.type).toBe('resource_exhaustion');
    expect(result.confidence).toBe(0.6);
  });

  // ── 6. stalled_progress: 10 read-only events with no productivity ──

  it('detects stalled_progress when 10 events have no file_edit or result', () => {
    for (let i = 0; i < 10; i++) {
      detector.recordEvent('agent-4', { type: 'tool_call', timestamp: i });
    }

    const result = detector.detect('agent-4');
    expect(result.anomaly).toBe(true);
    expect(result.type).toBe('stalled_progress');
    expect(result.confidence).toBe(0.7);
  });

  // ── 7. detect: normal event sequence ────────────────────────────────

  it('returns { anomaly: false } for a normal event sequence', () => {
    // Mix of productive and non-productive events, no failure streaks
    detector.recordEvent('agent-ok', { type: 'tool_call', timestamp: 1 });
    detector.recordEvent('agent-ok', { type: 'file_edit', filePath: 'a.js', content: 'X', timestamp: 2 });
    detector.recordEvent('agent-ok', { type: 'result', timestamp: 3 });
    detector.recordEvent('agent-ok', { type: 'tool_call', timestamp: 4 });

    const result = detector.detect('agent-ok');
    expect(result.anomaly).toBe(false);
  });

  // ── 8. detect: DIM_ALARM emitted with confidence as strength ───────

  it('emits DIM_ALARM with confidence as strength when anomaly found', () => {
    for (let i = 0; i < 4; i++) {
      detector.recordEvent('agent-alarm', { type: 'failure', timestamp: i });
    }

    detector.detect('agent-alarm');

    expect(field.emit).toHaveBeenCalledTimes(1);
    const emission = field.emit.mock.calls[0][0];
    expect(emission.dimension).toBe('alarm');
    expect(emission.scope).toBe('agent-alarm');
    expect(emission.strength).toBeGreaterThan(0);
    expect(emission.metadata.event).toBe('anomaly_detected');
  });

  // ── 9. detect: bus.publish quality.anomaly.detected ─────────────────

  it('publishes quality.anomaly.detected on bus when anomaly found', () => {
    for (let i = 0; i < 4; i++) {
      detector.recordEvent('agent-pub', { type: 'failure', timestamp: i });
    }

    detector.detect('agent-pub');

    expect(bus.publish).toHaveBeenCalledTimes(1);
    expect(bus.publish.mock.calls[0][0]).toBe('quality.anomaly.detected');
    const payload = bus.publish.mock.calls[0][1];
    expect(payload.agentId).toBe('agent-pub');
    expect(payload.worst.type).toBe('repeated_failures');
    expect(Array.isArray(payload.anomalies)).toBe(true);
  });

  // ── 10. cleanup: removes history, subsequent detect returns false ───

  it('removes agent history on cleanup; subsequent detect returns no anomaly', () => {
    for (let i = 0; i < 4; i++) {
      detector.recordEvent('agent-clean', { type: 'failure', timestamp: i });
    }

    // Confirm anomaly exists before cleanup
    const before = detector.detect('agent-clean');
    expect(before.anomaly).toBe(true);

    // Cleanup and re-detect
    detector.cleanup('agent-clean');
    const after = detector.detect('agent-clean');
    expect(after.anomaly).toBe(false);
    expect(after.type).toBeNull();
  });
});
