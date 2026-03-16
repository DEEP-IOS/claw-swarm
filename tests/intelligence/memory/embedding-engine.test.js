/**
 * EmbeddingEngine — 文本向量化引擎 单元测试 (mock 模式)
 * @module tests/intelligence/memory/embedding-engine
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { EmbeddingEngine } from '../../../src/intelligence/memory/embedding-engine.js';

describe('EmbeddingEngine', () => {
  let engine;

  beforeEach(() => {
    engine = new EmbeddingEngine({ mode: 'mock' });
  });

  it('embed() returns Float32Array of length 384', async () => {
    const vec = await engine.embed('hello world');
    expect(vec).toBeInstanceOf(Float32Array);
    expect(vec.length).toBe(384);
  });

  it('deterministic: same text -> same vector', async () => {
    const v1 = await engine.embed('test text');
    const v2 = await engine.embed('test text');
    expect(v1).toEqual(v2);
  });

  it('different text -> different vector', async () => {
    const v1 = await engine.embed('hello');
    const v2 = await engine.embed('goodbye');
    let same = true;
    for (let i = 0; i < v1.length; i++) {
      if (v1[i] !== v2[i]) { same = false; break; }
    }
    expect(same).toBe(false);
  });

  it('cosineSimilarity: identical vectors = ~1.0', async () => {
    const v = await engine.embed('test');
    const sim = EmbeddingEngine.cosineSimilarity(v, v);
    expect(sim).toBeCloseTo(1.0, 4);
  });

  it('cosineSimilarity: different vectors < 1.0', async () => {
    const v1 = await engine.embed('alpha');
    const v2 = await engine.embed('beta');
    const sim = EmbeddingEngine.cosineSimilarity(v1, v2);
    expect(sim).toBeLessThan(1.0);
  });

  it('empty text -> zero vector', async () => {
    const v = await engine.embed('');
    expect(v).toBeInstanceOf(Float32Array);
    expect(v.length).toBe(384);
    for (let i = 0; i < v.length; i++) {
      expect(v[i]).toBe(0);
    }
  });

  it('whitespace-only text -> zero vector', async () => {
    const v = await engine.embed('   ');
    for (let i = 0; i < v.length; i++) {
      expect(v[i]).toBe(0);
    }
  });

  it('cosineSimilarity: zero vector -> 0', async () => {
    const zero = new Float32Array(384);
    const v = await engine.embed('test');
    const sim = EmbeddingEngine.cosineSimilarity(zero, v);
    expect(sim).toBe(0);
  });

  it('cosineSimilarity: dimension mismatch throws', () => {
    const a = new Float32Array(384);
    const b = new Float32Array(100);
    expect(() => EmbeddingEngine.cosineSimilarity(a, b)).toThrow('dimension mismatch');
  });

  it('embedBatch returns array consistent with individual embed', async () => {
    const texts = ['hello', 'world', 'test'];
    const batch = await engine.embedBatch(texts);
    expect(batch).toHaveLength(3);
    for (let i = 0; i < texts.length; i++) {
      const single = await engine.embed(texts[i]);
      expect(batch[i]).toEqual(single);
    }
  });

  it('embedBatch with custom batchSize', async () => {
    const texts = Array.from({ length: 10 }, (_, i) => `text-${i}`);
    const batch = await engine.embedBatch(texts, 3);
    expect(batch).toHaveLength(10);
    expect(batch[0]).toBeInstanceOf(Float32Array);
  });

  it('isReady returns false before first embed, true after', async () => {
    expect(engine.isReady()).toBe(false);
    await engine.embed('init');
    expect(engine.isReady()).toBe(true);
  });

  it('getModelInfo returns correct metadata', async () => {
    await engine.embed('init');
    const info = engine.getModelInfo();
    expect(info.mode).toBe('mock');
    expect(info.dimensions).toBe(384);
    expect(typeof info.loadTimeMs).toBe('number');
  });

  it('mock vectors are unit-normalized', async () => {
    const v = await engine.embed('normalize test');
    let normSq = 0;
    for (let i = 0; i < v.length; i++) normSq += v[i] * v[i];
    expect(Math.sqrt(normSq)).toBeCloseTo(1.0, 3);
  });

  it('CJK text produces valid vector', async () => {
    const v = await engine.embed('你好世界');
    expect(v).toBeInstanceOf(Float32Array);
    expect(v.length).toBe(384);
    let hasNonZero = false;
    for (let i = 0; i < v.length; i++) {
      if (v[i] !== 0) { hasNonZero = true; break; }
    }
    expect(hasNonZero).toBe(true);
  });
});
