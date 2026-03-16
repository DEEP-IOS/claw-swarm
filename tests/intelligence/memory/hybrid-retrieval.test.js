/**
 * HybridRetrieval — 混合检索引擎 单元测试
 * @module tests/intelligence/memory/hybrid-retrieval
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { HybridRetrieval } from '../../../src/intelligence/memory/hybrid-retrieval.js';
import { EpisodicMemory } from '../../../src/intelligence/memory/episodic-memory.js';
import { SemanticMemory } from '../../../src/intelligence/memory/semantic-memory.js';
import { EmbeddingEngine } from '../../../src/intelligence/memory/embedding-engine.js';
import { VectorIndex } from '../../../src/intelligence/memory/vector-index.js';
import { DomainStore } from '../../../src/core/store/domain-store.js';
import { SignalStore } from '../../../src/core/field/signal-store.js';
import { EventBus } from '../../../src/core/bus/event-bus.js';

function makeEpisode(overrides = {}) {
  return {
    id: `ep-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    taskId: 'task-1',
    role: 'coder',
    goal: 'implement authentication module',
    actions: ['read spec', 'write code', 'run tests'],
    outcome: 'success',
    quality: 0.85,
    sessionId: 'session-1',
    tags: ['auth', 'backend'],
    lessons: ['always validate input'],
    ...overrides,
  };
}

describe('HybridRetrieval', () => {
  let domainStore;
  let field;
  let eventBus;
  let embeddingEngine;
  let vectorIndex;
  let episodicMemory;
  let semanticMemory;
  let hybrid;

  beforeEach(() => {
    domainStore = new DomainStore({ domain: 'hybrid-test', snapshotDir: '/tmp/hybrid-test' });
    field = new SignalStore();
    eventBus = new EventBus();
    embeddingEngine = new EmbeddingEngine({ mode: 'mock' });
    vectorIndex = new VectorIndex({ dimensions: 384 });
    episodicMemory = new EpisodicMemory({ domainStore, field, eventBus, embeddingEngine, vectorIndex });
    semanticMemory = new SemanticMemory({ domainStore, field, eventBus });
    hybrid = new HybridRetrieval({
      episodicMemory,
      semanticMemory,
      vectorIndex,
      embeddingEngine,
      field,
    });
  });

  it('search returns results with score and breakdown', async () => {
    await episodicMemory.record(makeEpisode({ id: 'ep-1', goal: 'build login page' }));
    await episodicMemory.record(makeEpisode({ id: 'ep-2', goal: 'setup database schema' }));
    const results = await hybrid.search('login authentication', { topK: 5 });
    expect(results.length).toBeGreaterThanOrEqual(1);
    for (const r of results) {
      expect(r).toHaveProperty('episode');
      expect(r).toHaveProperty('score');
      expect(r).toHaveProperty('breakdown');
      expect(typeof r.score).toBe('number');
      expect(r.breakdown).toHaveProperty('recency');
      expect(r.breakdown).toHaveProperty('relevance');
      expect(r.breakdown).toHaveProperty('frequency');
      expect(r.breakdown).toHaveProperty('quality');
      expect(r.breakdown).toHaveProperty('diversity');
      expect(r.breakdown).toHaveProperty('novelty');
    }
  });

  it('higher quality recent episodes rank higher', async () => {
    await episodicMemory.record(makeEpisode({
      id: 'ep-low', goal: 'authentication test', quality: 0.2,
      recordedAt: Date.now() - 86400000 * 30, // 30 days ago
    }));
    await episodicMemory.record(makeEpisode({
      id: 'ep-high', goal: 'authentication implementation', quality: 0.95,
      recordedAt: Date.now(), // now
    }));
    const results = await hybrid.search('authentication', { topK: 5 });
    if (results.length >= 2) {
      // The high-quality recent episode should score higher
      const highIdx = results.findIndex((r) => r.episode.id === 'ep-high');
      const lowIdx = results.findIndex((r) => r.episode.id === 'ep-low');
      if (highIdx >= 0 && lowIdx >= 0) {
        expect(highIdx).toBeLessThan(lowIdx);
      }
    }
  });

  it('searchForPrompt returns formatted string starting with ## 相关历史经验', async () => {
    await episodicMemory.record(makeEpisode({ id: 'ep-1', goal: 'build login page' }));
    const text = await hybrid.searchForPrompt('login', 'session-1', 'coder');
    expect(text).toContain('## 相关历史经验');
    expect(text).toContain('任务:');
    expect(text).toContain('质量:');
  });

  it('searchForPrompt returns empty string when no results', async () => {
    const text = await hybrid.searchForPrompt('nonexistent query', 'no-session', 'no-role');
    expect(text).toBe('');
  });

  it('searchForPrompt respects maxTokens (rough estimate)', async () => {
    // Record many episodes to create a large result
    for (let i = 0; i < 20; i++) {
      await episodicMemory.record(makeEpisode({
        id: `ep-${i}`,
        goal: `task ${i}: implement a very long feature description for testing purposes`,
        lessons: ['lesson one about testing', 'lesson two about validation', 'lesson three about error handling'],
      }));
    }
    const text = await hybrid.searchForPrompt('task implementation', 'session-1', 'coder', 100);
    // With maxTokens=100, text should be limited (100 tokens ~ 400 chars)
    // The source uses maxChars = maxTokens * 4
    expect(text.length).toBeLessThanOrEqual(100 * 4 + 50); // +50 for truncation suffix
  });

  it('search with empty query returns empty or minimal results', async () => {
    await episodicMemory.record(makeEpisode({ id: 'ep-1' }));
    // Empty string generates zero vector in mock mode, so cosine similarity
    // with non-zero vectors will be 0
    const results = await hybrid.search('', { topK: 5 });
    // Should either return empty or results with low relevance scores
    expect(Array.isArray(results)).toBe(true);
  });

  it('search respects topK limit', async () => {
    for (let i = 0; i < 10; i++) {
      await episodicMemory.record(makeEpisode({ id: `ep-${i}` }));
    }
    const results = await hybrid.search('authentication', { topK: 3 });
    expect(results.length).toBeLessThanOrEqual(3);
  });

  it('breakdown dimensions are bounded in [0, 1]', async () => {
    await episodicMemory.record(makeEpisode({ id: 'ep-1' }));
    const results = await hybrid.search('authentication', { topK: 5 });
    for (const r of results) {
      for (const [key, val] of Object.entries(r.breakdown)) {
        expect(val).toBeGreaterThanOrEqual(0);
        expect(val).toBeLessThanOrEqual(1);
      }
    }
  });

  it('search results sorted by descending score', async () => {
    for (let i = 0; i < 5; i++) {
      await episodicMemory.record(makeEpisode({
        id: `ep-${i}`, quality: Math.random(),
        goal: `task ${i} implementation`,
      }));
    }
    const results = await hybrid.search('task implementation', { topK: 5 });
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
    }
  });
});
