/**
 * DomainStore 单元测试 — 内存键值存储 + JSON 快照持久化
 * @module tests/core/store/domain-store.test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DomainStore } from '../../../src/core/store/domain-store.js';

describe('DomainStore', () => {
  let tmpDir;
  let store;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), 'ds-test-'));
    store = new DomainStore({ domain: 'test', snapshotDir: tmpDir });
  });

  afterEach(async () => {
    store.stopAutoSnapshot();
    await rm(tmpDir, { recursive: true, force: true });
  });

  // ── constructor ──────────────────────────────────────────────

  it('throws when domain is missing', () => {
    expect(() => new DomainStore({ snapshotDir: tmpDir })).toThrow();
  });

  it('throws when snapshotDir is missing', () => {
    expect(() => new DomainStore({ domain: 'x' })).toThrow();
  });

  // ── put / get ────────────────────────────────────────────────

  it('put + get: basic read-write', () => {
    store.put('col', 'k1', { v: 1 });
    expect(store.get('col', 'k1')).toEqual({ v: 1 });
  });

  it('get returns undefined for non-existent key', () => {
    store.put('col', 'k1', 1);
    expect(store.get('col', 'missing')).toBeUndefined();
  });

  it('get returns undefined for non-existent collection', () => {
    expect(store.get('nope', 'k1')).toBeUndefined();
  });

  it('dirty is true after put', () => {
    expect(store.dirty).toBe(false);
    store.put('col', 'k1', 1);
    expect(store.dirty).toBe(true);
  });

  // ── query ────────────────────────────────────────────────────

  it('query returns matched subset', () => {
    store.put('items', 'a', { score: 10 });
    store.put('items', 'b', { score: 5 });
    store.put('items', 'c', { score: 20 });
    const result = store.query('items', v => v.score >= 10);
    expect(result).toHaveLength(2);
    expect(result).toEqual(expect.arrayContaining([{ score: 10 }, { score: 20 }]));
  });

  it('query on non-existent collection returns []', () => {
    expect(store.query('nope', () => true)).toEqual([]);
  });

  // ── delete ───────────────────────────────────────────────────

  it('delete existing key returns true', () => {
    store.put('col', 'k1', 1);
    expect(store.delete('col', 'k1')).toBe(true);
  });

  it('delete non-existent key returns false', () => {
    expect(store.delete('col', 'k1')).toBe(false);
  });

  it('delete sets dirty to true', () => {
    store.put('col', 'k1', 1);
    // snapshot to clear dirty
    store._dirty = false;
    store.delete('col', 'k1');
    expect(store.dirty).toBe(true);
  });

  // ── putBatch ─────────────────────────────────────────────────

  it('putBatch inserts multiple entries', () => {
    store.putBatch('col', [
      { key: 'a', value: 1 },
      { key: 'b', value: 2 },
      { key: 'c', value: 3 },
    ]);
    expect(store.get('col', 'a')).toBe(1);
    expect(store.get('col', 'b')).toBe(2);
    expect(store.get('col', 'c')).toBe(3);
  });

  it('putBatch with empty array does not throw', () => {
    expect(() => store.putBatch('col', [])).not.toThrow();
  });

  // ── queryAll ─────────────────────────────────────────────────

  it('queryAll returns all values', () => {
    store.put('col', 'a', 10);
    store.put('col', 'b', 20);
    expect(store.queryAll('col')).toEqual(expect.arrayContaining([10, 20]));
    expect(store.queryAll('col')).toHaveLength(2);
  });

  it('queryAll on non-existent collection returns []', () => {
    expect(store.queryAll('nope')).toEqual([]);
  });

  // ── has ──────────────────────────────────────────────────────

  it('has returns true for existing key', () => {
    store.put('col', 'k1', 'v');
    expect(store.has('col', 'k1')).toBe(true);
  });

  it('has returns false for non-existent key', () => {
    expect(store.has('col', 'k1')).toBe(false);
  });

  // ── count ────────────────────────────────────────────────────

  it('count returns accurate number', () => {
    store.put('col', 'a', 1);
    store.put('col', 'b', 2);
    expect(store.count('col')).toBe(2);
  });

  it('count returns 0 for non-existent collection', () => {
    expect(store.count('nope')).toBe(0);
  });

  // ── collections ──────────────────────────────────────────────

  it('collections returns all collection names', () => {
    store.put('alpha', 'k', 1);
    store.put('beta', 'k', 2);
    const names = store.collections();
    expect(names).toEqual(expect.arrayContaining(['alpha', 'beta']));
    expect(names).toHaveLength(2);
  });

  // ── domain getter ────────────────────────────────────────────

  it('domain getter returns domain name', () => {
    expect(store.domain).toBe('test');
  });

  // ── snapshot / restore round-trip ────────────────────────────

  it('snapshot + restore preserves data across instances', async () => {
    store.put('agents', 'a1', { name: 'scout', hp: 100 });
    store.put('agents', 'a2', { name: 'worker', hp: 80 });
    store.put('tasks', 't1', { status: 'running' });

    await store.snapshot();

    // Create a fresh instance and restore
    const store2 = new DomainStore({ domain: 'test', snapshotDir: tmpDir });
    await store2.restore();

    expect(store2.get('agents', 'a1')).toEqual({ name: 'scout', hp: 100 });
    expect(store2.get('agents', 'a2')).toEqual({ name: 'worker', hp: 80 });
    expect(store2.get('tasks', 't1')).toEqual({ status: 'running' });
    store2.stopAutoSnapshot();
  });

  it('restore on non-existent file does not throw', async () => {
    const freshStore = new DomainStore({ domain: 'ghost', snapshotDir: tmpDir });
    await expect(freshStore.restore()).resolves.toBeUndefined();
    freshStore.stopAutoSnapshot();
  });

  it('snapshot sets dirty to false', async () => {
    store.put('col', 'k', 1);
    expect(store.dirty).toBe(true);
    await store.snapshot();
    expect(store.dirty).toBe(false);
  });

  // ── startAutoSnapshot / stopAutoSnapshot ─────────────────────

  it('startAutoSnapshot and stopAutoSnapshot do not throw', () => {
    expect(() => store.startAutoSnapshot()).not.toThrow();
    expect(() => store.stopAutoSnapshot()).not.toThrow();
  });

  it('calling startAutoSnapshot twice does not create duplicate timers', () => {
    store.startAutoSnapshot();
    const timer1 = store._autoTimer;
    store.startAutoSnapshot();
    const timer2 = store._autoTimer;
    expect(timer1).toBe(timer2);
  });
});
