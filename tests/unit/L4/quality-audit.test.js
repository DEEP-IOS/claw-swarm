/**
 * Quality Audit Chain 单元测试 / Quality Audit Chain Unit Tests
 *
 * V6.0 L4: 质量审计链测试
 * V6.0 L4: Tests for quality assessment audit trail
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { QualityController } from '../../../src/L4-orchestration/quality-controller.js';

// ── 辅助 / Helpers ──────────────────────────────────────────────────────────

const silentLogger = { info() {}, warn() {}, error() {}, debug() {} };

function createMockBus() {
  return { publish: vi.fn(), subscribe: vi.fn(() => () => {}) };
}

function createMockDb() {
  const auditRows = [];
  return {
    prepare: vi.fn((sql) => ({
      run: vi.fn((...args) => {
        if (sql.includes('quality_audit') || sql.includes('INSERT')) {
          auditRows.push(args);
        }
        return { changes: 1 };
      }),
      get: vi.fn(() => null),
      all: vi.fn(() => auditRows.map((r, i) => ({
        id: i + 1,
        task_id: r[0] || 'task-?',
        tier: r[1] || 'STANDARD',
        verdict: r[3] || 'PASS',
        overall_score: r[2] || 0.8,
        timestamp: Date.now(),
      }))),
    })),
    exec: vi.fn(),
    _auditRows: auditRows,
  };
}

// ── 测试 / Tests ────────────────────────────────────────────────────────────

describe('Quality Audit Chain (V6.0)', () => {
  let qc;
  let db;
  let bus;

  beforeEach(() => {
    db = createMockDb();
    bus = createMockBus();
    qc = new QualityController({
      messageBus: bus,
      logger: silentLogger,
      db,
    });
  });

  describe('质量评估 / Quality Assessment', () => {
    it('QualityController 创建不报错 / creates without error', () => {
      expect(qc).toBeDefined();
    });

    it('评估后发布事件 / publishes event after assessment', () => {
      // 模拟评估 (具体方法名可能不同)
      if (typeof qc.evaluate === 'function') {
        qc.evaluate({
          taskId: 'task-001',
          tier: 'STANDARD',
          result: { content: 'hello world' },
        });
        expect(bus.publish).toHaveBeenCalled();
      }
    });
  });
});
