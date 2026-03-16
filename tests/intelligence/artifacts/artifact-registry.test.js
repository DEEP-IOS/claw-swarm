/**
 * ArtifactRegistry 单元测试
 * Tests: register, getArtifacts, getFileHistory, getByCreator, getStats, field.emit, bus.publish
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ArtifactRegistry, ARTIFACT_TYPES } from '../../../src/intelligence/artifacts/artifact-registry.js';
import { DomainStore } from '../../../src/core/store/domain-store.js';
import { SignalStore } from '../../../src/core/field/signal-store.js';
import { EventBus } from '../../../src/core/bus/event-bus.js';
import { DIM_TRAIL } from '../../../src/core/field/types.js';
import os from 'node:os';
import path from 'node:path';

describe('ArtifactRegistry', () => {
  let field, bus, store, registry;

  beforeEach(() => {
    const tmpDir = path.join(os.tmpdir(), `art-reg-test-${Date.now()}`);
    field = new SignalStore();
    bus = new EventBus();
    store = new DomainStore({ domain: 'test-artifacts', snapshotDir: tmpDir });
    registry = new ArtifactRegistry({ field, bus, store });
  });

  it('register → getArtifacts 全流程', () => {
    const art = registry.register('dag-1', {
      type: ARTIFACT_TYPES.CODE_CHANGE,
      path: 'src/foo.js',
      description: 'Added feature X',
      createdBy: 'agent-a',
      quality: 0.9,
    });

    expect(art).toHaveProperty('id');
    expect(art).toHaveProperty('timestamp');
    expect(art.type).toBe('code_change');
    expect(art.path).toBe('src/foo.js');
    expect(art.createdBy).toBe('agent-a');

    const all = registry.getArtifacts('dag-1');
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe(art.id);
  });

  it('getArtifacts 按 type 过滤', () => {
    registry.register('dag-2', { type: ARTIFACT_TYPES.CODE_CHANGE, path: 'a.js', createdBy: 'x' });
    registry.register('dag-2', { type: ARTIFACT_TYPES.TEST, path: 'a.test.js', createdBy: 'x' });
    registry.register('dag-2', { type: ARTIFACT_TYPES.DOCUMENT, path: 'readme.md', createdBy: 'y' });

    const tests = registry.getArtifacts('dag-2', ARTIFACT_TYPES.TEST);
    expect(tests).toHaveLength(1);
    expect(tests[0].path).toBe('a.test.js');

    const code = registry.getArtifacts('dag-2', ARTIFACT_TYPES.CODE_CHANGE);
    expect(code).toHaveLength(1);

    const all = registry.getArtifacts('dag-2');
    expect(all).toHaveLength(3);
  });

  it('getFileHistory 跨 dagId', () => {
    registry.register('dag-a', { type: ARTIFACT_TYPES.CODE_CHANGE, path: 'src/shared.js', createdBy: 'x' });
    registry.register('dag-b', { type: ARTIFACT_TYPES.CODE_CHANGE, path: 'src/shared.js', createdBy: 'y' });
    registry.register('dag-b', { type: ARTIFACT_TYPES.CODE_CHANGE, path: 'src/other.js', createdBy: 'z' });

    const history = registry.getFileHistory('src/shared.js');
    expect(history).toHaveLength(2);
    expect(history.map(h => h.dagId).sort()).toEqual(['dag-a', 'dag-b']);
  });

  it('getByCreator', () => {
    registry.register('dag-1', { type: ARTIFACT_TYPES.CODE_CHANGE, path: 'a.js', createdBy: 'agent-alpha' });
    registry.register('dag-1', { type: ARTIFACT_TYPES.TEST, path: 'a.test.js', createdBy: 'agent-beta' });
    registry.register('dag-2', { type: ARTIFACT_TYPES.DOCUMENT, path: 'doc.md', createdBy: 'agent-alpha' });

    const alpha = registry.getByCreator('agent-alpha');
    expect(alpha).toHaveLength(2);
    expect(alpha.every(a => a.createdBy === 'agent-alpha')).toBe(true);

    const beta = registry.getByCreator('agent-beta');
    expect(beta).toHaveLength(1);
  });

  it('getStats 统计正确: total, byType, avgQuality', () => {
    registry.register('dag-s', { type: ARTIFACT_TYPES.CODE_CHANGE, path: 'a.js', createdBy: 'x', quality: 0.8 });
    registry.register('dag-s', { type: ARTIFACT_TYPES.CODE_CHANGE, path: 'b.js', createdBy: 'x', quality: 0.6 });
    registry.register('dag-s', { type: ARTIFACT_TYPES.TEST, path: 'a.test.js', createdBy: 'y', quality: 1.0 });
    registry.register('dag-s', { type: ARTIFACT_TYPES.DOCUMENT, path: 'doc.md', createdBy: 'z' });

    const stats = registry.getStats('dag-s');
    expect(stats.total).toBe(4);
    expect(stats.byType).toEqual({ code_change: 2, test: 1, document: 1 });
    // avgQuality = (0.8+0.6+1.0) / 3 = 0.8
    expect(stats.avgQuality).toBeCloseTo(0.8, 2);
  });

  it('field.emit DIM_TRAIL on register', () => {
    const emitSpy = vi.spyOn(field, 'emit');

    registry.register('dag-f', { type: ARTIFACT_TYPES.ANALYSIS, path: 'report.md', createdBy: 'x' });

    expect(emitSpy).toHaveBeenCalledTimes(1);
    const call = emitSpy.mock.calls[0][0];
    expect(call.dimension).toBe(DIM_TRAIL);
    expect(call.scope).toBe('dag-f');
    expect(call.metadata.event).toBe('artifact_created');
    expect(call.metadata.type).toBe('analysis');
  });

  it('bus.publish artifact.registered on register', () => {
    const publishSpy = vi.spyOn(bus, 'publish');

    const art = registry.register('dag-p', { type: ARTIFACT_TYPES.CONFIG, path: 'cfg.json', createdBy: 'x' });

    // bus.publish may be called by field.emit internals too; filter for artifact.registered
    const artifactCalls = publishSpy.mock.calls.filter(c => c[0] === 'artifact.registered');
    expect(artifactCalls).toHaveLength(1);
    expect(artifactCalls[0][1].dagId).toBe('dag-p');
    expect(artifactCalls[0][1].artifact.id).toBe(art.id);
  });

  it('getArtifacts returns empty array for unknown dagId', () => {
    expect(registry.getArtifacts('nonexistent')).toEqual([]);
  });
});
