/**
 * EmbeddingEngine 单元测试 / EmbeddingEngine Unit Tests
 *
 * V6.0 L3: 双模式嵌入引擎测试
 * V6.0 L3: Tests for dual-mode embedding engine (local ONNX / API)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EmbeddingEngine } from '../../../src/L3-agent/embedding-engine.js';

// ── 辅助 / Helpers ──────────────────────────────────────────────────────────

const silentLogger = { info() {}, warn() {}, error() {}, debug() {} };
const mockBus = { publish: vi.fn(), subscribe: vi.fn(() => () => {}) };

// ── 测试 / Tests ────────────────────────────────────────────────────────────

describe('EmbeddingEngine', () => {
  describe('构造 / Construction', () => {
    it('创建实例不报错 / creates without error', () => {
      const engine = new EmbeddingEngine({
        config: { mode: 'local', dimensions: 384 },
        messageBus: mockBus,
        logger: silentLogger,
      });
      expect(engine).toBeDefined();
    });

    it('getStatus 返回初始状态 / getStatus returns initial status', () => {
      const engine = new EmbeddingEngine({
        config: { mode: 'local' },
        messageBus: mockBus,
        logger: silentLogger,
      });
      const status = engine.getStatus();
      expect(status).toBeDefined();
      expect(status.mode).toBe('local');
    });

    it('默认 local 模式 384 维 / defaults to local mode 384D', () => {
      const engine = new EmbeddingEngine({
        messageBus: mockBus,
        logger: silentLogger,
      });
      const status = engine.getStatus();
      expect(status.mode).toBe('local');
    });
  });

  describe('cosineSimilarity 静态方法 / Static cosineSimilarity', () => {
    it('相同向量相似度为 1 / identical vectors = 1', () => {
      const a = new Float32Array([1, 0, 0]);
      const b = new Float32Array([1, 0, 0]);
      expect(EmbeddingEngine.cosineSimilarity(a, b)).toBeCloseTo(1.0, 5);
    });

    it('正交向量相似度为 0 / orthogonal vectors = 0', () => {
      const a = new Float32Array([1, 0, 0]);
      const b = new Float32Array([0, 1, 0]);
      expect(EmbeddingEngine.cosineSimilarity(a, b)).toBeCloseTo(0.0, 5);
    });

    it('反向向量相似度为 -1 / opposite vectors = -1', () => {
      const a = new Float32Array([1, 0, 0]);
      const b = new Float32Array([-1, 0, 0]);
      expect(EmbeddingEngine.cosineSimilarity(a, b)).toBeCloseTo(-1.0, 5);
    });

    it('缩放不影响相似度 / scaling does not affect similarity', () => {
      const a = new Float32Array([1, 2, 3]);
      const b = new Float32Array([2, 4, 6]);
      expect(EmbeddingEngine.cosineSimilarity(a, b)).toBeCloseTo(1.0, 5);
    });
  });

  describe('destroy / Destroy', () => {
    it('destroy 不报错 / destroy does not throw', () => {
      const engine = new EmbeddingEngine({
        config: { mode: 'local' },
        messageBus: mockBus,
        logger: silentLogger,
      });
      expect(() => engine.destroy()).not.toThrow();
    });
  });
});
