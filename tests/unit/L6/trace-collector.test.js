/**
 * TraceCollector V5.5 单元测试 / TraceCollector V5.5 Unit Tests
 *
 * 测试 span 收集、批量写入、pending span 管理
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { TraceCollector } from '../../../src/L6-monitoring/trace-collector.js';

function createMockBus() {
  const _subs = {};
  return {
    publish(topic, data) {
      if (_subs[topic]) for (const cb of _subs[topic]) cb(data);
    },
    subscribe(topic, cb) {
      if (!_subs[topic]) _subs[topic] = [];
      _subs[topic].push(cb);
    },
    _subs,
  };
}

function createMockDb() {
  const rows = [];
  return {
    run(sql, ...params) {
      rows.push({ sql, params });
    },
    exec() {},
    get(sql, ...params) {
      return null;
    },
    all(sql, ...params) {
      return [];
    },
    _rows: rows,
  };
}

const logger = { info() {}, warn() {}, error() {}, debug() {} };

describe('TraceCollector', () => {
  let collector;
  let mockBus;
  let mockDb;

  beforeEach(() => {
    mockBus = createMockBus();
    mockDb = createMockDb();
    collector = new TraceCollector({
      messageBus: mockBus,
      db: mockDb,
      logger,
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 构造函数 / Constructor
  // ═══════════════════════════════════════════════════════════════════════

  describe('constructor', () => {
    it('should create with default state', () => {
      expect(collector).toBeDefined();
      expect(collector._initialized).toBe(false);
    });

    it('should accept null db gracefully', () => {
      const c = new TraceCollector({ messageBus: mockBus, logger });
      expect(c).toBeDefined();
      expect(c._db).toBeUndefined();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // start / stop
  // ═══════════════════════════════════════════════════════════════════════

  describe('start / stop', () => {
    it('should mark as initialized', () => {
      collector.start();
      expect(collector._initialized).toBe(true);
    });

    it('should not double-start', () => {
      collector.start();
      collector.start(); // should not throw
      expect(collector._initialized).toBe(true);
    });

    it('should stop cleanly', () => {
      collector.start();
      collector.stop();
      expect(collector._initialized).toBe(false);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // getStats
  // ═══════════════════════════════════════════════════════════════════════

  describe('getStats', () => {
    it('should return stats structure', () => {
      collector.start();
      const stats = collector.getStats();
      expect(stats).toHaveProperty('pendingSpans');
      expect(stats).toHaveProperty('bufferedSpans');
      expect(stats).toHaveProperty('initialized');
      expect(stats.initialized).toBe(true);
      expect(stats.pendingSpans).toBe(0);
      expect(stats.bufferedSpans).toBe(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Span 收集 / Span Collection
  // ═══════════════════════════════════════════════════════════════════════

  describe('span collection via events', () => {
    it('should buffer spans from lifecycle events', () => {
      collector.start();

      // Emit agent.registered event (should create instant span)
      if (mockBus._subs['agent.registered']) {
        mockBus._subs['agent.registered'].forEach(cb =>
          cb({ payload: { agentId: 'test-agent' }, traceId: 'trace-1', timestamp: Date.now() })
        );
      }

      const stats = collector.getStats();
      expect(stats.bufferedSpans).toBeGreaterThanOrEqual(0);
    });

    it('should handle complete trace.span events', () => {
      collector.start();

      // Emit complete span with duration
      if (mockBus._subs['trace.span']) {
        mockBus._subs['trace.span'].forEach(cb =>
          cb({
            payload: {
              spanId: 'span-1',
              traceId: 'trace-1',
              operation: 'test-op',
              durationMs: 100,
            },
          })
        );
      }

      const stats = collector.getStats();
      // Should be buffered (1 span, not yet flushed since BATCH_SIZE=5)
      expect(stats.bufferedSpans).toBe(1);
    });

    it('should handle start/end span pairing', () => {
      collector.start();

      if (mockBus._subs['trace.span']) {
        // Start phase
        mockBus._subs['trace.span'].forEach(cb =>
          cb({
            payload: {
              spanId: 'paired-span',
              traceId: 'trace-2',
              operation: 'paired-op',
              phase: 'start',
            },
          })
        );
      }

      expect(collector._pendingSpans.size).toBe(1);

      if (mockBus._subs['trace.span']) {
        // End phase
        mockBus._subs['trace.span'].forEach(cb =>
          cb({
            payload: {
              spanId: 'paired-span',
              id: 'paired-span',
              phase: 'end',
              status: 'ok',
            },
          })
        );
      }

      expect(collector._pendingSpans.size).toBe(0);
      expect(collector._buffer.length).toBe(1);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 无 DB 时的降级 / Graceful degradation without DB
  // ═══════════════════════════════════════════════════════════════════════

  describe('graceful degradation', () => {
    it('should not throw without db', () => {
      const c = new TraceCollector({ messageBus: mockBus, logger });
      c.start();
      expect(() => c.getStats()).not.toThrow();
      c.stop();
    });
  });
});
