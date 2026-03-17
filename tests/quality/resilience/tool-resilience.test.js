/**
 * ToolResilience - Tool call parameter validation and retry management tests
 * @module tests/quality/resilience/tool-resilience.test
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ToolResilience } from '../../../src/quality/resilience/tool-resilience.js';

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

function createEngine(overrides = {}) {
  const field = createMockField();
  const bus = createMockBus();
  const engine = new ToolResilience({ field, bus, ...overrides });
  return { engine, field, bus };
}

function registerTestTool(engine) {
  engine.registerToolSchemas([{
    name: 'test_tool',
    parameters: {
      type: 'object',
      properties: {
        goal: { type: 'string' },
        count: { type: 'number' },
      },
      required: ['goal'],
    },
  }]);
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('ToolResilience', () => {
  let engine, field, bus;

  beforeEach(() => {
    ({ engine, field, bus } = createEngine());
  });

  // 1. Constructor
  it('creates instance with default config', () => {
    expect(engine).toBeInstanceOf(ToolResilience);
    expect(engine._maxRetries).toBe(3);
  });

  // 2. registerToolSchemas
  it('registerToolSchemas: registers tool validators', () => {
    registerTestTool(engine);
    expect(engine._schemas.has('test_tool')).toBe(true);
    expect(engine._validators.has('test_tool')).toBe(true);
  });

  // 3. validateAndRepair: valid params -> { valid: true }
  it('validateAndRepair: valid params returns valid=true', () => {
    registerTestTool(engine);
    const result = engine.validateAndRepair('test_tool', { goal: 'build app', count: 5 });
    expect(result.valid).toBe(true);
    expect(result.repairPrompt).toBeUndefined();
  });

  // 4. validateAndRepair: missing required field
  it('validateAndRepair: missing required field returns valid=false with repair prompt', () => {
    registerTestTool(engine);
    const result = engine.validateAndRepair('test_tool', { count: 5 });

    expect(result.valid).toBe(false);
    expect(result.repairPrompt).toBeDefined();
    expect(result.repairPrompt).toContain('goal');
  });

  // 5. validateAndRepair: wrong type
  it('validateAndRepair: wrong type returns valid=false with type info', () => {
    registerTestTool(engine);
    const result = engine.validateAndRepair('test_tool', { goal: 123 });

    expect(result.valid).toBe(false);
    expect(result.repairPrompt).toBeDefined();
    expect(result.repairPrompt).toContain('string');
  });

  // 6. validateAndRepair: unknown tool -> passthrough { valid: true }
  it('validateAndRepair: unknown tool passes through as valid', () => {
    const result = engine.validateAndRepair('unknown_tool', { anything: 'goes' });
    expect(result.valid).toBe(true);
  });

  // 7. validateAndRepair: failure -> DIM_ALARM emitted
  it('validateAndRepair: failure emits DIM_ALARM signal', () => {
    registerTestTool(engine);
    engine.validateAndRepair('test_tool', { count: 'wrong type' });

    expect(field.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        dimension: 'alarm',
        scope: 'test_tool',
        strength: 0.5,
        emitterId: 'ToolResilience',
      }),
    );
  });

  // 8. validateAndRepair: failure -> bus.publish called
  it('validateAndRepair: failure publishes quality.tool.validation_failed on bus', () => {
    registerTestTool(engine);
    engine.validateAndRepair('test_tool', { count: 'bad' });

    expect(bus.publish).toHaveBeenCalledWith(
      'quality.tool.validation_failed',
      expect.objectContaining({
        toolName: 'test_tool',
        errors: expect.any(String),
      }),
      'ToolResilience',
    );
  });

  // 9. shouldRetry: first call -> retry: true, delay: 1000, attempt: 1
  it('shouldRetry: first call returns retry=true, delay=1000, attempt=1', () => {
    const result = engine.shouldRetry('call-1', 'test_tool');
    expect(result.retry).toBe(true);
    expect(result.delay).toBe(1000);
    expect(result.attempt).toBe(1);
  });

  // 10. shouldRetry: exponential backoff
  it('shouldRetry: exponential backoff on successive calls', () => {
    const r1 = engine.shouldRetry('call-2', 'tool_a');
    expect(r1.delay).toBe(1000);

    const r2 = engine.shouldRetry('call-2', 'tool_a');
    expect(r2.delay).toBe(2000);

    const r3 = engine.shouldRetry('call-2', 'tool_a');
    expect(r3.delay).toBe(4000);
  });

  // 11. shouldRetry: exceeds maxRetries -> retry: false
  it('shouldRetry: returns retry=false after exceeding maxRetries', () => {
    engine.shouldRetry('call-3', 'tool_b'); // attempt 1
    engine.shouldRetry('call-3', 'tool_b'); // attempt 2
    engine.shouldRetry('call-3', 'tool_b'); // attempt 3

    const r4 = engine.shouldRetry('call-3', 'tool_b'); // attempt 4 > maxRetries(3)
    expect(r4.retry).toBe(false);
    expect(r4.reason).toContain('max retries');
  });

  // 12. recordSuccess: clears retry counter
  it('recordSuccess: clears retry counters for the tool', () => {
    engine.shouldRetry('call-4', 'tool_c'); // attempt 1
    engine.shouldRetry('call-4', 'tool_c'); // attempt 2

    engine.recordSuccess('tool_c');

    // After clearing, next shouldRetry starts fresh at attempt 1
    const result = engine.shouldRetry('call-4', 'tool_c');
    expect(result.attempt).toBe(1);
    expect(result.retry).toBe(true);
  });
});
