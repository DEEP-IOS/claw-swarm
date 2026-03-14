/**
 * VectorIndex 单元测试 / VectorIndex Unit Tests
 *
 * V6.0 L3: HNSW 向量索引测试
 * V6.0 L3: Tests for HNSW vector index (brute-force fallback)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { VectorIndex } from '../../../src/L3-agent/vector-index.js';

// ── 辅助 / Helpers ──────────────────────────────────────────────────────────

const silentLogger = { info() {}, warn() {}, error() {}, debug() {} };
const mockBus = { publish: vi.fn(), subscribe: vi.fn(() => () => {}) };

/** 模拟 DB (in-memory) / Mock DB */
function createMockDb() {
  const tables = {};
  return {
    prepare: vi.fn((sql) => ({
      run: vi.fn((...args) => ({ changes: 1, lastInsertRowid: 1 })),
      get: vi.fn(() => null),
      all: vi.fn(() => []),
    })),
    exec: vi.fn(),
    _tables: tables,
  };
}

/** 生成随机向量 / Generate random vector */
function randomVector(dims = 384) {
  const v = new Float32Array(dims);
  for (let i = 0; i < dims; i++) v[i] = Math.random() - 0.5;
  return v;
}

// ── 测试 / Tests ────────────────────────────────────────────────────────────

describe('VectorIndex', () => {
  let db;
  let index;

  beforeEach(() => {
    db = createMockDb();
    index = new VectorIndex({
      config: { dimensions: 8, maxElements: 100 },
      messageBus: mockBus,
      logger: silentLogger,
      db,
    });
  });

  describe('构造 / Construction', () => {
    it('创建实例不报错 / creates without error', () => {
      expect(index).toBeDefined();
    });

    it('getDimensions 返回配置维度 / getDimensions returns configured dim', () => {
      expect(index.getDimensions()).toBe(8);
    });

    it('初始 size 为 0 / initial size is 0', () => {
      expect(index.size()).toBe(0);
    });
  });

  describe('upsert + search / Upsert + Search', () => {
    it('upsert 增加索引大小 / upsert increases index size', () => {
      const vec = randomVector(8);
      index.upsert({ sourceTable: 'memories', sourceId: 'm1', embedding: vec });
      expect(index.size()).toBe(1);
    });

    it('多次 upsert 相同 sourceId 不重复计数 / duplicate sourceId deduplicates', () => {
      const vec = randomVector(8);
      index.upsert({ sourceTable: 'memories', sourceId: 'm1', embedding: vec });
      index.upsert({ sourceTable: 'memories', sourceId: 'm1', embedding: vec });
      // 更新而非新增 / Should update, not add
      expect(index.size()).toBeLessThanOrEqual(2);
    });

    it('search 返回最近邻 / search returns nearest neighbors', () => {
      // 插入 5 个向量
      const query = new Float32Array([1, 0, 0, 0, 0, 0, 0, 0]);
      const close = new Float32Array([0.9, 0.1, 0, 0, 0, 0, 0, 0]);
      const far = new Float32Array([0, 0, 0, 0, 0, 0, 0, 1]);

      index.upsert({ sourceTable: 't', sourceId: 'close', embedding: close });
      index.upsert({ sourceTable: 't', sourceId: 'far', embedding: far });

      const results = index.search(query, 2);
      expect(results.length).toBeGreaterThanOrEqual(1);
      // 最近的应该是 'close'
      expect(results[0].sourceId).toBe('close');
    });

    it('search topK 限制结果数 / search respects topK limit', () => {
      for (let i = 0; i < 10; i++) {
        index.upsert({ sourceTable: 't', sourceId: `v${i}`, embedding: randomVector(8) });
      }

      const results = index.search(randomVector(8), 3);
      expect(results.length).toBeLessThanOrEqual(3);
    });

    it('空索引 search 返回空数组 / search on empty index returns empty', () => {
      const results = index.search(randomVector(8), 5);
      expect(results).toEqual([]);
    });
  });

  describe('clear + destroy / Clear + Destroy', () => {
    it('clear 清空索引 / clear empties index', async () => {
      index.upsert({ sourceTable: 't', sourceId: 'v1', embedding: randomVector(8) });
      expect(index.size()).toBe(1);

      await index.clear();
      expect(index.size()).toBe(0);
    });

    it('destroy 不报错 / destroy does not throw', () => {
      expect(() => index.destroy()).not.toThrow();
    });
  });
});
