/**
 * SnapshotManager 单元测试 — 多 DomainStore 统一快照管理
 * @module tests/core/store/snapshot-manager.test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DomainStore } from '../../../src/core/store/domain-store.js';
import { SnapshotManager } from '../../../src/core/store/snapshot-manager.js';

describe('SnapshotManager', () => {
  let tmpDir;
  let mgr;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), 'sm-test-'));
    mgr = new SnapshotManager({ snapshotDir: tmpDir });
  });

  afterEach(async () => {
    mgr.stop();
    await rm(tmpDir, { recursive: true, force: true });
  });

  // ── register / getStats ──────────────────────────────────────

  it('register adds store to stats', () => {
    const ds = new DomainStore({ domain: 'alpha', snapshotDir: tmpDir });
    mgr.register(ds);
    const stats = mgr.getStats();
    expect(stats.has('alpha')).toBe(true);
    expect(stats.get('alpha')).toEqual({ dirty: false, collectionCount: 0 });
  });

  it('register throws on invalid object', () => {
    expect(() => mgr.register(null)).toThrow();
    expect(() => mgr.register({})).toThrow();
    expect(() => mgr.register({ domain: '' })).toThrow();
  });

  // ── unregister ───────────────────────────────────────────────

  it('unregister removes store from stats', () => {
    const ds = new DomainStore({ domain: 'beta', snapshotDir: tmpDir });
    mgr.register(ds);
    mgr.unregister('beta');
    expect(mgr.getStats().has('beta')).toBe(false);
  });

  // ── snapshotAll ──────────────────────────────────────────────

  it('snapshotAll succeeds for all registered stores', async () => {
    const ds1 = new DomainStore({ domain: 'one', snapshotDir: tmpDir });
    const ds2 = new DomainStore({ domain: 'two', snapshotDir: tmpDir });
    ds1.put('col', 'k', 1);
    ds2.put('col', 'k', 2);
    mgr.register(ds1);
    mgr.register(ds2);

    const result = await mgr.snapshotAll();
    expect(result.succeeded).toEqual(expect.arrayContaining(['one', 'two']));
    expect(result.failed).toHaveLength(0);
  });

  // ── restoreAll ───────────────────────────────────────────────

  it('restoreAll recovers data after snapshotAll', async () => {
    const ds1 = new DomainStore({ domain: 'r1', snapshotDir: tmpDir });
    ds1.put('agents', 'a', { role: 'scout' });
    mgr.register(ds1);
    await mgr.snapshotAll();

    // New store instance, re-register, restore
    const ds1b = new DomainStore({ domain: 'r1', snapshotDir: tmpDir });
    mgr.unregister('r1');
    mgr.register(ds1b);
    const result = await mgr.restoreAll();

    expect(result.succeeded).toContain('r1');
    expect(ds1b.get('agents', 'a')).toEqual({ role: 'scout' });
  });

  // ── error isolation ──────────────────────────────────────────

  it('one store snapshot failure does not block others', async () => {
    const good = new DomainStore({ domain: 'good', snapshotDir: tmpDir });
    good.put('col', 'k', 'v');

    // Create a mock store whose snapshot always throws
    const bad = {
      domain: 'bad',
      dirty: true,
      collections: () => ['x'],
      snapshot: vi.fn().mockRejectedValue(new Error('disk full')),
    };

    mgr.register(good);
    mgr.register(bad);

    const result = await mgr.snapshotAll();
    expect(result.succeeded).toContain('good');
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].domain).toBe('bad');
  });

  // ── start / stop ─────────────────────────────────────────────

  it('start and stop do not throw', () => {
    expect(() => mgr.start()).not.toThrow();
    expect(() => mgr.stop()).not.toThrow();
  });

  it('calling start twice does not create duplicate timers', () => {
    mgr.start();
    const t1 = mgr._timer;
    mgr.start();
    expect(mgr._timer).toBe(t1);
  });
});
