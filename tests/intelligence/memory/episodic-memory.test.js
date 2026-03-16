/**
 * EpisodicMemory — 情景记忆 单元测试
 * @module tests/intelligence/memory/episodic-memory
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EpisodicMemory } from '../../../src/intelligence/memory/episodic-memory.js';
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

describe('EpisodicMemory', () => {
  let domainStore;
  let field;
  let eventBus;
  let embeddingEngine;
  let vectorIndex;
  let em;

  beforeEach(() => {
    domainStore = new DomainStore({ domain: 'episodic-test', snapshotDir: '/tmp/episodic-test' });
    field = new SignalStore();
    eventBus = new EventBus();
    embeddingEngine = new EmbeddingEngine({ mode: 'mock' });
    vectorIndex = new VectorIndex({ dimensions: 384 });
    em = new EpisodicMemory({ domainStore, field, eventBus, embeddingEngine, vectorIndex });
  });

  it('record stores episode in domainStore and vectorIndex', async () => {
    const ep = makeEpisode({ id: 'ep-1' });
    await em.record(ep);
    expect(vectorIndex.has('ep-1')).toBe(true);
    expect(vectorIndex.size()).toBe(1);
  });

  it('record emits knowledge signal to field', async () => {
    const emitSpy = vi.spyOn(field, 'emit');
    const ep = makeEpisode();
    await em.record(ep);
    expect(emitSpy).toHaveBeenCalled();
    const call = emitSpy.mock.calls[0][0];
    expect(call.dimension).toBe('knowledge');
    expect(call.emitterId).toBe('episodic-memory');
  });

  it('record publishes memory.episode.recorded event', async () => {
    const events = [];
    eventBus.subscribe('memory.episode.recorded', (envelope) => {
      events.push(envelope);
    });
    const ep = makeEpisode({ id: 'ep-evt', taskId: 'task-evt', role: 'reviewer' });
    await em.record(ep);
    expect(events).toHaveLength(1);
    expect(events[0].data.episodeId).toBe('ep-evt');
    expect(events[0].data.role).toBe('reviewer');
  });

  it('query returns episodes matching semantic search', async () => {
    await em.record(makeEpisode({
      id: 'ep-auth', goal: 'implement authentication', actions: ['auth login flow'],
    }));
    await em.record(makeEpisode({
      id: 'ep-db', goal: 'setup database migration', actions: ['create schema'],
    }));
    const results = await em.query('auth login');
    expect(results.length).toBeGreaterThanOrEqual(1);
    // Auth-related episode should be present
    const ids = results.map((r) => r.id);
    expect(ids).toContain('ep-auth');
  });

  it('query filters by role', async () => {
    await em.record(makeEpisode({ id: 'ep-c', role: 'coder' }));
    await em.record(makeEpisode({ id: 'ep-r', role: 'reviewer' }));
    const results = await em.query('authentication', { role: 'reviewer' });
    for (const ep of results) {
      expect(ep.role).toBe('reviewer');
    }
  });

  it('query filters by outcome', async () => {
    await em.record(makeEpisode({ id: 'ep-s', outcome: 'success' }));
    await em.record(makeEpisode({ id: 'ep-f', outcome: 'failure' }));
    const results = await em.query('authentication', { outcome: 'success' });
    for (const ep of results) {
      expect(ep.outcome).toBe('success');
    }
  });

  it('query filters by minQuality', async () => {
    await em.record(makeEpisode({ id: 'ep-hq', quality: 0.95 }));
    await em.record(makeEpisode({ id: 'ep-lq', quality: 0.2 }));
    const results = await em.query('authentication', { minQuality: 0.5 });
    for (const ep of results) {
      expect(ep.quality).toBeGreaterThanOrEqual(0.5);
    }
  });

  it('query respects topK', async () => {
    for (let i = 0; i < 10; i++) {
      await em.record(makeEpisode({ id: `ep-${i}` }));
    }
    const results = await em.query('test', { topK: 3 });
    expect(results.length).toBeLessThanOrEqual(3);
  });

  it('consolidate extracts bestPractices and antiPatterns', async () => {
    // Record multiple success episodes with common tags
    for (let i = 0; i < 3; i++) {
      await em.record(makeEpisode({
        id: `ep-s${i}`, outcome: 'success', sessionId: 'sess-c',
        tags: ['auth', 'validation'],
        lessons: ['always validate input'],
      }));
    }
    // Record failure episodes
    for (let i = 0; i < 3; i++) {
      await em.record(makeEpisode({
        id: `ep-f${i}`, outcome: 'failure', sessionId: 'sess-c',
        tags: ['timeout', 'network'],
        lessons: ['add retry logic'],
      }));
    }
    await em.consolidate('sess-c');
    const consolidated = em.getConsolidated('sess-c');
    expect(consolidated).toBeDefined();
    expect(consolidated.sessionId).toBe('sess-c');
    expect(consolidated.episodeCount).toBe(6);
    expect(consolidated.successCount).toBe(3);
    expect(consolidated.failureCount).toBe(3);
    expect(consolidated.bestPractices).toBeDefined();
    expect(consolidated.antiPatterns).toBeDefined();
  });

  it('getConsolidated returns undefined for unknown session', () => {
    expect(em.getConsolidated('unknown-session')).toBeUndefined();
  });

  it('stats returns correct aggregate data', async () => {
    await em.record(makeEpisode({ id: 'ep-1', outcome: 'success', quality: 0.9 }));
    await em.record(makeEpisode({ id: 'ep-2', outcome: 'failure', quality: 0.3 }));
    await em.record(makeEpisode({ id: 'ep-3', outcome: 'success', quality: 0.6 }));
    const s = em.stats();
    expect(s.totalEpisodes).toBe(3);
    expect(s.successRate).toBeCloseTo(2 / 3, 5);
    expect(s.averageQuality).toBeCloseTo(0.6, 5);
  });

  it('stats on empty returns zeros', () => {
    const s = em.stats();
    expect(s.totalEpisodes).toBe(0);
    expect(s.successRate).toBe(0);
    expect(s.averageQuality).toBe(0);
  });

  it('record adds recordedAt timestamp if not provided', async () => {
    const before = Date.now();
    const ep = makeEpisode({ id: 'ep-ts' });
    delete ep.recordedAt;
    await em.record(ep);
    const results = await em.query('authentication', { topK: 10 });
    const stored = results.find((r) => r.id === 'ep-ts');
    expect(stored).toBeDefined();
    expect(stored.recordedAt).toBeGreaterThanOrEqual(before);
  });
});
