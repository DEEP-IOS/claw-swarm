/**
 * Repair Memory V5.5 单元测试 / Repair Memory V5.5 Unit Tests
 *
 * 测试修复记忆激活: findRepairStrategy + recordRepairOutcome + 回流链
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { ToolResilience } from '../../../src/L5-application/tool-resilience.js';

function createMockBus() {
  const events = [];
  return {
    publish(topic, data) { events.push({ topic, data }); },
    subscribe() {},
    events,
  };
}

function createMockDb(strategies = []) {
  return {
    all(sql, ...params) {
      if (sql.includes('repair_memory')) return strategies;
      return [];
    },
    get(sql, ...params) {
      if (sql.includes('repair_memory') && strategies.length > 0) {
        return strategies[0];
      }
      return null;
    },
    run() {},
  };
}

const logger = { info() {}, warn() {}, error() {}, debug() {} };

describe('ToolResilience V5.5 — Repair Memory', () => {
  let resilience;
  let mockBus;

  beforeEach(() => {
    mockBus = createMockBus();
    resilience = new ToolResilience({
      messageBus: mockBus,
      logger,
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // findRepairStrategy
  // ═══════════════════════════════════════════════════════════════════════

  describe('findRepairStrategy', () => {
    it('should return null when no db', () => {
      const result = resilience.findRepairStrategy('test_tool', 'validation', '/param');
      expect(result).toBeNull();
    });

    it('should return null when no matching strategy', () => {
      resilience._db = createMockDb([]);
      const result = resilience.findRepairStrategy('test_tool', 'validation', '/param');
      expect(result).toBeNull();
    });

    it('should return strategy with confidence when found', () => {
      const mockStrategy = {
        error_signature: 'test_tool:validation:/param',
        strategy: 'Add required field',
        affinity: 0.85,
        hit_count: 5,
      };
      resilience._db = createMockDb([mockStrategy]);
      const result = resilience.findRepairStrategy('test_tool', 'validation', '/param');
      expect(result).not.toBeNull();
      expect(result.strategy).toBe('Add required field');
      expect(result.confidence).toBe(0.85);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // recordRepairOutcome
  // ═══════════════════════════════════════════════════════════════════════

  describe('recordRepairOutcome', () => {
    it('should not throw when no db', () => {
      expect(() => {
        resilience.recordRepairOutcome('tool', 'validation', '/param', true);
      }).not.toThrow();
    });

    it('should call db.run for upsert', () => {
      let runCalled = false;
      resilience._db = {
        get() { return null; },
        run() { runCalled = true; },
      };
      resilience.recordRepairOutcome('tool', 'validation', '/param', true);
      expect(runCalled).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // getCircuitBreakerStates
  // ═══════════════════════════════════════════════════════════════════════

  describe('getCircuitBreakerStates', () => {
    it('should return empty object initially', () => {
      const states = resilience.getCircuitBreakerStates();
      expect(states).toBeDefined();
      expect(typeof states).toBe('object');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 构造函数 / Constructor
  // ═══════════════════════════════════════════════════════════════════════

  describe('constructor with db', () => {
    it('should accept db parameter', () => {
      const db = createMockDb();
      const r = new ToolResilience({ messageBus: mockBus, logger, db });
      expect(r._db).toBe(db);
    });
  });
});
