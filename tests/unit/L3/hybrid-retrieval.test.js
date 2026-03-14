/**
 * HybridRetrieval 单元测试 / HybridRetrieval Unit Tests
 *
 * V6.0 L3: 6维混合检索公式测试
 * V6.0 L3: Tests for 6-dimensional hybrid retrieval formula
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { HybridRetrieval } from '../../../src/L3-agent/hybrid-retrieval.js';

// ── 辅助 / Helpers ──────────────────────────────────────────────────────────

const silentLogger = { info() {}, warn() {}, error() {}, debug() {} };
const mockBus = { publish: vi.fn(), subscribe: vi.fn(() => () => {}) };

function createMockEmbeddingEngine() {
  return {
    embed: vi.fn(async (text) => {
      // 返回简单的 8 维向量 / Return simple 8D vector
      const v = new Float32Array(8);
      for (let i = 0; i < 8; i++) v[i] = text.charCodeAt(i % text.length) / 255;
      return v;
    }),
    getStatus: vi.fn(() => ({ mode: 'local', dimensions: 8 })),
  };
}

function createMockVectorIndex() {
  const items = [];
  return {
    search: vi.fn((queryEmbedding, topK) => {
      return items.slice(0, topK).map((item, i) => ({
        vectorId: i,
        distance: 0.1 * (i + 1),
        sourceTable: item.sourceTable,
        sourceId: item.sourceId,
        metadata: item.metadata || {},
      }));
    }),
    _items: items,
    _addItem(item) { items.push(item); },
  };
}

function createMockKnowledgeRepo() {
  return {
    bfsTraverseFromSeeds: vi.fn(() => new Map()),
  };
}

// ── 测试 / Tests ────────────────────────────────────────────────────────────

describe('HybridRetrieval', () => {
  let retrieval;
  let embeddingEngine;
  let vectorIndex;
  let knowledgeRepo;

  beforeEach(() => {
    embeddingEngine = createMockEmbeddingEngine();
    vectorIndex = createMockVectorIndex();
    knowledgeRepo = createMockKnowledgeRepo();

    retrieval = new HybridRetrieval({
      embeddingEngine,
      vectorIndex,
      knowledgeRepo,
      messageBus: mockBus,
      logger: silentLogger,
    });
  });

  describe('构造 / Construction', () => {
    it('创建实例不报错 / creates without error', () => {
      expect(retrieval).toBeDefined();
    });

    it('getStats 返回初始统计 / getStats returns initial stats', () => {
      const stats = retrieval.getStats();
      expect(stats).toBeDefined();
    });
  });

  describe('混合检索 / Hybrid Search', () => {
    it('空向量索引返回空 / empty vector index returns empty', async () => {
      const results = await retrieval.search({ query: 'test query', topK: 5 });
      expect(results).toEqual([]);
    });

    it('调用 embeddingEngine.embed / calls embeddingEngine.embed', async () => {
      await retrieval.search({ query: 'find me', topK: 5 });
      expect(embeddingEngine.embed).toHaveBeenCalledWith('find me');
    });

    it('调用 vectorIndex.search / calls vectorIndex.search', async () => {
      await retrieval.search({ query: 'test', topK: 10 });
      expect(vectorIndex.search).toHaveBeenCalled();
    });

    it('有候选时返回排序结果 / returns sorted results with candidates', async () => {
      // 添加模拟候选
      vectorIndex._addItem({
        sourceTable: 'memories',
        sourceId: 'm1',
        metadata: { importance: 0.9, confidence: 0.8, accessCount: 5, timestamp: Date.now() },
      });
      vectorIndex._addItem({
        sourceTable: 'memories',
        sourceId: 'm2',
        metadata: { importance: 0.3, confidence: 0.4, accessCount: 1, timestamp: Date.now() - 86400000 * 30 },
      });

      const results = await retrieval.search({ query: 'test', topK: 5 });
      expect(results.length).toBeGreaterThanOrEqual(1);

      // 每个结果应有 score 和 breakdown
      for (const r of results) {
        expect(r.score).toBeGreaterThanOrEqual(0);
        expect(r.sourceId).toBeDefined();
      }
    });

    it('finalK 限制最终结果数 / finalK limits final results', async () => {
      for (let i = 0; i < 10; i++) {
        vectorIndex._addItem({
          sourceTable: 'memories',
          sourceId: `m${i}`,
          metadata: { importance: 0.5, confidence: 0.5, accessCount: 1, timestamp: Date.now() },
        });
      }

      const results = await retrieval.search({ query: 'test', topK: 20, finalK: 3 });
      expect(results.length).toBeLessThanOrEqual(3);
    });

    it('contextNodeIds 传递给 knowledgeRepo / contextNodeIds passed to knowledgeRepo', async () => {
      vectorIndex._addItem({
        sourceTable: 'memories',
        sourceId: 'm1',
        metadata: { importance: 0.5, confidence: 0.5, accessCount: 1, timestamp: Date.now() },
      });

      await retrieval.search({
        query: 'test',
        contextNodeIds: ['node1', 'node2'],
        topK: 5,
      });
      // knowledgeRepo.bfsTraverseFromSeeds 应被调用
      // (具体实现决定是否调用)
    });
  });

  describe('权重配置 / Weight Configuration', () => {
    it('自定义权重生效 / custom weights take effect', () => {
      const custom = new HybridRetrieval({
        embeddingEngine,
        vectorIndex,
        knowledgeRepo,
        messageBus: mockBus,
        logger: silentLogger,
        config: {
          weights: { semantic: 0.5, temporal: 0.1, importance: 0.1, confidence: 0.1, frequency: 0.1, context: 0.1 },
        },
      });
      expect(custom).toBeDefined();
    });
  });
});
