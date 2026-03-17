/**
 * ResultSynthesizer -- unit tests
 * @module tests/orchestration/planning/result-synthesizer
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ResultSynthesizer } from '../../../src/orchestration/planning/result-synthesizer.js';

// ============================================================================
// Shared mocks
// ============================================================================

const makeMocks = () => ({
  field: {
    emit: vi.fn(),
    read: vi.fn().mockReturnValue([]),
    superpose: vi.fn().mockReturnValue({}),
  },
  bus: {
    emit: vi.fn(),
    publish: vi.fn(),
    subscribe: vi.fn(),
  },
  artifactRegistry: {
    register: vi.fn().mockResolvedValue(undefined),
  },
});

// ============================================================================
// Tests
// ============================================================================

describe('ResultSynthesizer', () => {
  /** @type {ReturnType<typeof makeMocks>} */
  let mocks;
  /** @type {ResultSynthesizer} */
  let synth;

  beforeEach(() => {
    mocks = makeMocks();
    synth = new ResultSynthesizer({
      field: mocks.field,
      bus: mocks.bus,
      artifactRegistry: mocks.artifactRegistry,
    });
  });

  // --------------------------------------------------------------------------
  // 1. No-conflict merge: directly combined
  // --------------------------------------------------------------------------
  it('merges files from different paths without conflict', async () => {
    const nodeResults = new Map([
      ['node-1', {
        files: [{ path: 'src/a.js', content: 'code-a', agentId: 'ag1' }],
        text: 'Agent 1 produced a good result with reasonable output quality measures.',
        quality: 0.8,
      }],
      ['node-2', {
        files: [{ path: 'src/b.js', content: 'code-b', agentId: 'ag2' }],
        text: 'Agent 2 produced a different result with some alternative approach here.',
        quality: 0.9,
      }],
    ]);

    const result = await synth.merge('dag-1', nodeResults);

    // No conflicts since paths are different
    expect(result.conflicts).toHaveLength(0);
    // Both files should be in the merged result
    expect(result.mergedResult.files).toHaveLength(2);
    const paths = result.mergedResult.files.map(f => f.path).sort();
    expect(paths).toEqual(['src/a.js', 'src/b.js']);
  });

  // --------------------------------------------------------------------------
  // 2. Same-file conflict -> trust-weighted resolution
  // --------------------------------------------------------------------------
  it('resolves same-file conflict using trust scores (higher trust wins)', async () => {
    // ag1 has lower trust, ag2 has higher trust
    mocks.field.superpose.mockImplementation((agentId) => {
      if (agentId === 'ag1') return { trust: 0.3 };
      if (agentId === 'ag2') return { trust: 0.9 };
      return {};
    });

    synth = new ResultSynthesizer({
      field: mocks.field,
      bus: mocks.bus,
      artifactRegistry: mocks.artifactRegistry,
    });

    const nodeResults = new Map([
      ['node-1', {
        files: [{ path: 'src/shared.js', content: 'version-A', agentId: 'ag1' }],
        quality: 0.7,
      }],
      ['node-2', {
        files: [{ path: 'src/shared.js', content: 'version-B', agentId: 'ag2' }],
        quality: 0.6,
      }],
    ]);

    const result = await synth.merge('dag-1', nodeResults);

    // Conflict should be detected
    expect(result.conflicts.length).toBeGreaterThan(0);

    // The winning file should be from ag2 (higher trust)
    const sharedFile = result.mergedResult.files.find(f => f.path === 'src/shared.js');
    expect(sharedFile).toBeDefined();
    expect(sharedFile.agentId).toBe('ag2');
    expect(sharedFile.content).toBe('version-B');
  });

  // --------------------------------------------------------------------------
  // 3. Jaccard bigram > 0.6 -> dedup
  // --------------------------------------------------------------------------
  it('deduplicates texts with Jaccard bigram similarity > threshold', async () => {
    // Two texts that are near-identical (very high Jaccard similarity)
    const text1 = 'The implementation uses a hash map for fast lookup performance in production.';
    const text2 = 'The implementation uses a hash map for fast lookup performance in staging.';

    const nodeResults = new Map([
      ['node-1', { text: text1, quality: 0.7 }],
      ['node-2', { text: text2, quality: 0.8 }],
    ]);

    const result = await synth.merge('dag-1', nodeResults);

    // High similarity -> one should be deduplicated
    expect(result.deduplicatedCount).toBe(1);
    // Only 1 text should remain
    expect(result.mergedResult.texts).toHaveLength(1);
    // The higher quality one should be kept
    expect(result.mergedResult.texts[0]).toBe(text2);
  });

  it('keeps both texts when similarity is below threshold', async () => {
    const text1 = 'The database connection pool uses exponential backoff strategy for reconnection.';
    const text2 = 'We should consider implementing a cache invalidation strategy using event-driven approach.';

    const nodeResults = new Map([
      ['node-1', { text: text1, quality: 0.7 }],
      ['node-2', { text: text2, quality: 0.8 }],
    ]);

    const result = await synth.merge('dag-1', nodeResults);

    expect(result.deduplicatedCount).toBe(0);
    expect(result.mergedResult.texts).toHaveLength(2);
  });

  // --------------------------------------------------------------------------
  // 4. Artifacts extracted and registered
  // --------------------------------------------------------------------------
  it('extracts artifacts and calls artifactRegistry.register', async () => {
    const nodeResults = new Map([
      ['node-1', {
        files: [{ path: 'src/foo.js', content: 'code', agentId: 'ag1' }],
        text: 'A sufficiently long analysis result text that exceeds the minimum threshold.',
        quality: 0.8,
      }],
    ]);

    const result = await synth.merge('dag-1', nodeResults);

    // Should have artifacts for the file and the text
    expect(result.artifacts.length).toBeGreaterThanOrEqual(2);

    // artifactRegistry.register should have been called for each artifact
    expect(mocks.artifactRegistry.register).toHaveBeenCalled();
    const registerCalls = mocks.artifactRegistry.register.mock.calls;
    expect(registerCalls.length).toBe(result.artifacts.length);

    // All register calls should use the correct dagId
    for (const call of registerCalls) {
      expect(call[0]).toBe('dag-1');
    }
  });

  // --------------------------------------------------------------------------
  // 5. avgQuality calculation is correct
  // --------------------------------------------------------------------------
  it('calculates avgQuality correctly', async () => {
    const nodeResults = new Map([
      ['node-1', { quality: 0.6 }],
      ['node-2', { quality: 0.8 }],
      ['node-3', { quality: 1.0 }],
    ]);

    const result = await synth.merge('dag-1', nodeResults);

    // (0.6 + 0.8 + 1.0) / 3 = 0.8
    expect(result.avgQuality).toBeCloseTo(0.8, 5);
    expect(result.mergedResult.avgQuality).toBeCloseTo(0.8, 5);
  });

  it('avgQuality is 0 when no quality scores provided', async () => {
    const nodeResults = new Map([
      ['node-1', { text: 'no quality field here' }],
    ]);

    const result = await synth.merge('dag-1', nodeResults);
    expect(result.avgQuality).toBe(0);
  });

  // --------------------------------------------------------------------------
  // 6. Emits signals after merge
  // --------------------------------------------------------------------------
  it('emits trail and knowledge signals on merge', async () => {
    const nodeResults = new Map([
      ['node-1', { quality: 0.7 }],
    ]);

    await synth.merge('dag-1', nodeResults);

    // field.emit should have been called for DIM_TRAIL and DIM_KNOWLEDGE
    expect(mocks.field.emit).toHaveBeenCalled();
    const emitCalls = mocks.field.emit.mock.calls;
    const dimensions = emitCalls.map(c => c[0]?.dimension);
    expect(dimensions).toContain('trail');
    expect(dimensions).toContain('knowledge');
  });

  // --------------------------------------------------------------------------
  // 7. Publishes synthesis.completed event
  // --------------------------------------------------------------------------
  it('publishes synthesis.completed event on bus', async () => {
    const nodeResults = new Map([
      ['node-1', { quality: 0.8 }],
    ]);

    await synth.merge('dag-1', nodeResults);

    const completedCalls = mocks.bus.publish.mock.calls.filter(
      ([topic]) => topic === 'synthesis.completed'
    );
    expect(completedCalls.length).toBe(1);
    expect(completedCalls[0][1]).toHaveProperty('dagId', 'dag-1');
    expect(completedCalls[0][1]).toHaveProperty('avgQuality');
  });

  // --------------------------------------------------------------------------
  // 8. Publishes synthesis.conflict.detected when conflicts exist
  // --------------------------------------------------------------------------
  it('publishes conflict event when conflicts detected', async () => {
    const nodeResults = new Map([
      ['node-1', {
        files: [{ path: 'shared.js', content: 'v1', agentId: 'ag1' }],
        quality: 0.5,
      }],
      ['node-2', {
        files: [{ path: 'shared.js', content: 'v2', agentId: 'ag2' }],
        quality: 0.5,
      }],
    ]);

    await synth.merge('dag-1', nodeResults);

    const conflictCalls = mocks.bus.publish.mock.calls.filter(
      ([topic]) => topic === 'synthesis.conflict.detected'
    );
    expect(conflictCalls.length).toBe(1);
    expect(conflictCalls[0][1].count).toBeGreaterThan(0);
  });

  // --------------------------------------------------------------------------
  // 9. Works without artifactRegistry
  // --------------------------------------------------------------------------
  it('works gracefully without artifactRegistry', async () => {
    synth = new ResultSynthesizer({
      field: mocks.field,
      bus: mocks.bus,
      // no artifactRegistry
    });

    const nodeResults = new Map([
      ['node-1', {
        files: [{ path: 'src/a.js', content: 'code', agentId: 'ag1' }],
        quality: 0.8,
      }],
    ]);

    const result = await synth.merge('dag-1', nodeResults);
    expect(result.mergedResult.files).toHaveLength(1);
    expect(result.artifacts.length).toBeGreaterThan(0);
  });
});
