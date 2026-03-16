/**
 * VectorIndex — HNSW/brute-force 向量索引 单元测试
 * @module tests/intelligence/memory/vector-index
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { VectorIndex } from '../../../src/intelligence/memory/vector-index.js';

/** 生成随机 Float32Array 向量 */
function randomVector(dim = 384) {
  const v = new Float32Array(dim);
  for (let i = 0; i < dim; i++) v[i] = Math.random() - 0.5;
  return v;
}

/** 归一化向量 */
function normalize(v) {
  let norm = 0;
  for (let i = 0; i < v.length; i++) norm += v[i] * v[i];
  norm = Math.sqrt(norm);
  const out = new Float32Array(v.length);
  if (norm > 0) for (let i = 0; i < v.length; i++) out[i] = v[i] / norm;
  return out;
}

describe('VectorIndex', () => {
  let index;

  beforeEach(() => {
    index = new VectorIndex({ dimensions: 384 });
  });

  it('add + has: vector is stored', () => {
    const v = randomVector();
    index.add('v1', v);
    expect(index.has('v1')).toBe(true);
    expect(index.has('v2')).toBe(false);
  });

  it('size() reflects count', () => {
    expect(index.size()).toBe(0);
    index.add('v1', randomVector());
    index.add('v2', randomVector());
    expect(index.size()).toBe(2);
  });

  it('search self: query vector matches itself (top-1)', () => {
    const vectors = {};
    for (let i = 0; i < 50; i++) {
      const id = `v${i}`;
      vectors[id] = normalize(randomVector());
      index.add(id, vectors[id]);
    }
    // Search for v0's vector — should find v0 as top result
    const results = index.search(vectors['v0'], 1);
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('v0');
    expect(results[0].score).toBeCloseTo(1.0, 3);
  });

  it('search topK returns correct count', () => {
    for (let i = 0; i < 30; i++) {
      index.add(`v${i}`, randomVector());
    }
    const results = index.search(randomVector(), 5);
    expect(results).toHaveLength(5);
  });

  it('search topK larger than index size returns all', () => {
    for (let i = 0; i < 3; i++) {
      index.add(`v${i}`, randomVector());
    }
    const results = index.search(randomVector(), 10);
    expect(results).toHaveLength(3);
  });

  it('search on empty index returns empty', () => {
    const results = index.search(randomVector(), 5);
    expect(results).toEqual([]);
  });

  it('remove: deleted vector no longer found', () => {
    const v1 = normalize(randomVector());
    index.add('v1', v1);
    index.add('v2', randomVector());
    expect(index.has('v1')).toBe(true);
    index.remove('v1');
    expect(index.has('v1')).toBe(false);
    expect(index.size()).toBe(1);
    // Search should not return removed vector
    const results = index.search(v1, 5);
    for (const r of results) {
      expect(r.id).not.toBe('v1');
    }
  });

  it('remove non-existent id returns false', () => {
    expect(index.remove('nonexistent')).toBe(false);
  });

  it('clear() resets index', () => {
    for (let i = 0; i < 10; i++) {
      index.add(`v${i}`, randomVector());
    }
    expect(index.size()).toBe(10);
    index.clear();
    expect(index.size()).toBe(0);
    expect(index.search(randomVector(), 5)).toEqual([]);
  });

  it('stats() returns correct structure', () => {
    for (let i = 0; i < 5; i++) {
      index.add(`v${i}`, randomVector());
    }
    const s = index.stats();
    expect(s.vectorCount).toBe(5);
    expect(typeof s.layerCount).toBe('number');
    expect(typeof s.averageConnections).toBe('number');
    expect(typeof s.memoryEstimateBytes).toBe('number');
  });

  it('brute-force used when < 1000 vectors', () => {
    // With < 1000 vectors, search uses brute-force internally
    for (let i = 0; i < 100; i++) {
      index.add(`v${i}`, normalize(randomVector()));
    }
    // Brute-force should give exact nearest neighbors
    const queryVec = normalize(randomVector());
    const results = index.search(queryVec, 10);
    expect(results).toHaveLength(10);
    // Results should be sorted by descending score
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
    }
  });

  it('search results sorted by descending score', () => {
    for (let i = 0; i < 50; i++) {
      index.add(`v${i}`, randomVector());
    }
    const results = index.search(randomVector(), 10);
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
    }
  });

  it('scores are in [-1, 1] range (cosine similarity)', () => {
    for (let i = 0; i < 20; i++) {
      index.add(`v${i}`, randomVector());
    }
    const results = index.search(randomVector(), 10);
    for (const r of results) {
      expect(r.score).toBeGreaterThanOrEqual(-1);
      expect(r.score).toBeLessThanOrEqual(1);
    }
  });

  it('add with duplicate id overwrites vector', () => {
    const v1 = normalize(randomVector());
    const v2 = normalize(randomVector());
    index.add('dup', v1);
    index.add('dup', v2);
    expect(index.size()).toBe(1);
    // Search for v2 should find 'dup' as top result
    const results = index.search(v2, 1);
    expect(results[0].id).toBe('dup');
    expect(results[0].score).toBeCloseTo(1.0, 3);
  });

  it('recall@10 brute-force baseline: 100 vectors', () => {
    const vectors = {};
    for (let i = 0; i < 100; i++) {
      const id = `v${i}`;
      vectors[id] = normalize(randomVector());
      index.add(id, vectors[id]);
    }
    const query = normalize(randomVector());
    const results = index.search(query, 10);
    // With <1000 vectors, brute-force is used, so recall should be 100%
    expect(results).toHaveLength(10);
    // Verify top-1 is the actual closest
    let bestId = null;
    let bestScore = -2;
    for (const [id, vec] of Object.entries(vectors)) {
      let dot = 0, nA = 0, nB = 0;
      for (let i = 0; i < 384; i++) {
        dot += query[i] * vec[i];
        nA += query[i] * query[i];
        nB += vec[i] * vec[i];
      }
      const sim = dot / (Math.sqrt(nA) * Math.sqrt(nB));
      if (sim > bestScore) { bestScore = sim; bestId = id; }
    }
    expect(results[0].id).toBe(bestId);
  });

  it('maxCapacity evicts oldest vector when exceeded', () => {
    const smallIndex = new VectorIndex({ dimensions: 384, maxCapacity: 5 });
    for (let i = 0; i < 7; i++) {
      smallIndex.add(`v${i}`, randomVector());
    }
    expect(smallIndex.size()).toBe(5);
    // First two (v0, v1) should have been evicted
    expect(smallIndex.has('v0')).toBe(false);
    expect(smallIndex.has('v1')).toBe(false);
    expect(smallIndex.has('v6')).toBe(true);
  });

  it('remove updates size and subsequent search', () => {
    for (let i = 0; i < 10; i++) {
      index.add(`v${i}`, randomVector());
    }
    index.remove('v5');
    expect(index.size()).toBe(9);
    const results = index.search(randomVector(), 20);
    const ids = results.map((r) => r.id);
    expect(ids).not.toContain('v5');
  });
});
