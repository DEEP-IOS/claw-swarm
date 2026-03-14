/**
 * FailureModeAnalyzer 单元测试 / FailureModeAnalyzer Unit Tests
 *
 * V6.0 L3: 失败根因分类测试
 * V6.0 L3: Tests for failure root-cause classification
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FailureModeAnalyzer } from '../../../src/L3-agent/failure-mode-analyzer.js';

// ── 辅助 / Helpers ──────────────────────────────────────────────────────────

const silentLogger = { info() {}, warn() {}, error() {}, debug() {} };
const mockBus = { publish: vi.fn(), subscribe: vi.fn(() => () => {}) };

function createMockDb() {
  const rows = [];
  return {
    prepare: vi.fn(() => ({
      run: vi.fn((...args) => { rows.push(args); return { changes: 1 }; }),
      get: vi.fn(() => null),
      all: vi.fn(() => rows.map((r, i) => ({
        id: i, tool_name: r[0], error_category: r[1],
        error_message: r[2], timestamp: Date.now(),
      }))),
    })),
    exec: vi.fn(),
    _rows: rows,
  };
}

// ── 测试 / Tests ────────────────────────────────────────────────────────────

describe('FailureModeAnalyzer', () => {
  let fma;
  let db;

  beforeEach(() => {
    mockBus.publish.mockClear();
    db = createMockDb();
    fma = new FailureModeAnalyzer({
      messageBus: mockBus,
      logger: silentLogger,
      db,
    });
  });

  describe('构造 / Construction', () => {
    it('创建实例不报错 / creates without error', () => {
      expect(fma).toBeDefined();
    });
  });

  describe('classify / Classify', () => {
    it('超时错误分类为 TIMEOUT / timeout error classified as TIMEOUT', () => {
      const result = fma.classify(
        new Error('Request timeout after 30000ms'),
        { toolName: 'web_search' },
      );
      expect(result).toBeDefined();
      expect(result.category).toBe('TIMEOUT');
      expect(result.confidence).toBeGreaterThan(0);
      expect(result.mitigation).toBeDefined();
    });

    it('网络错误分类为 NETWORK / network error classified as NETWORK', () => {
      const result = fma.classify(
        new Error('fetch failed: network error connecting to api'),
        { toolName: 'api_call' },
      );
      expect(result.category).toBe('NETWORK');
    });

    it('LLM 拒绝分类为 LLM_REFUSAL / LLM refusal classified as LLM_REFUSAL', () => {
      const result = fma.classify(
        new Error('The request was refused due to content filter policy'),
        { toolName: 'generate' },
      );
      expect(result.category).toBe('LLM_REFUSAL');
    });

    it('输入错误分类为 INPUT_ERROR / input error classified as INPUT_ERROR', () => {
      const result = fma.classify(
        new Error('Invalid parameter: expected string, got number'),
        { toolName: 'tool_x' },
      );
      expect(result.category).toBe('INPUT_ERROR');
    });

    it('资源耗尽分类为 RESOURCE_EXHAUSTION / resource exhaustion classified', () => {
      const result = fma.classify(
        new Error('Out of memory: heap limit reached'),
        { toolName: 'compute' },
      );
      expect(result.category).toBe('RESOURCE_EXHAUSTION');
    });

    it('未知错误有合理默认 / unknown error has reasonable default', () => {
      const result = fma.classify(
        new Error('Something very unusual happened'),
        {},
      );
      expect(result).toBeDefined();
      expect(result.category).toBeDefined();
      expect(result.confidence).toBeGreaterThanOrEqual(0);
    });

    it('字符串错误也可分类 / string error also classifiable', () => {
      const result = fma.classify('timeout exceeded', { toolName: 'test' });
      expect(result).toBeDefined();
      expect(result.category).toBeDefined();
    });

    it('null 错误不崩溃 / null error does not crash', () => {
      expect(() => fma.classify(null, {})).not.toThrow();
    });

    it('发布 MessageBus 事件 / publishes to MessageBus', () => {
      fma.classify(new Error('timeout'), { toolName: 'test' });
      expect(mockBus.publish).toHaveBeenCalled();
    });
  });

  describe('analyzeTrend / Analyze Trend', () => {
    it('无数据时返回 stable / returns stable with no data', () => {
      const trend = fma.analyzeTrend('TIMEOUT');
      expect(trend).toBeDefined();
      expect(trend.trend).toBe('stable');
    });

    it('getTrendSummary 不报错 / getTrendSummary does not throw', () => {
      expect(() => fma.getTrendSummary()).not.toThrow();
    });
  });
});
