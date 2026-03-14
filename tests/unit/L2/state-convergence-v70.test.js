/**
 * StateConvergence V7.0 增量测试 / StateConvergence V7.0 Incremental Tests
 *
 * V7.0 L2: CRDT 分布式状态 — LWW (Last-Writer-Wins) 合并测试
 * V7.0 L2: CRDT distributed state — LWW merge tests (putSharedState / getSharedState / mergeState)
 *
 * @author DEEP-IOS
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { StateConvergence } from '../../../src/L2-communication/state-convergence.js';

// ── 辅助 / Helpers ──────────────────────────────────────────────────────────

const silentLogger = { info() {}, warn() {}, error() {}, debug() {} };

/** 模拟 MessageBus / Mock MessageBus */
function createMockBus() {
  const _subs = {};
  return {
    publish(topic, data) { if (_subs[topic]) for (const cb of _subs[topic]) cb(data); },
    subscribe(topic, cb) { if (!_subs[topic]) _subs[topic] = []; _subs[topic].push(cb); },
    _subs,
  };
}

// ── 测试 / Tests ────────────────────────────────────────────────────────────

describe('StateConvergence V7.0 — CRDT LWW', () => {
  let sc;
  let bus;

  beforeEach(() => {
    bus = createMockBus();
    sc = new StateConvergence({
      messageBus: bus,
      logger: silentLogger,
      config: {},
    });
  });

  // ━━━ 1. putSharedState — 存储值 / Stores value ━━━
  describe('putSharedState', () => {
    it('存储值并返回元数据 / stores value and returns metadata', () => {
      const result = sc.putSharedState('key1', 'value1', 'writer-A');

      expect(result).toBeDefined();
      expect(result.key).toBe('key1');
      expect(result.writerId).toBe('writer-A');
      expect(typeof result.timestamp).toBe('number');
      expect(result.timestamp).toBeGreaterThan(0);
    });

    it('默认 writerId 为 "unknown" / defaults writerId to "unknown"', () => {
      const result = sc.putSharedState('key2', 42);
      expect(result.writerId).toBe('unknown');
    });

    it('可以存储各种类型的值 / can store various value types', () => {
      sc.putSharedState('str', 'hello');
      sc.putSharedState('num', 42);
      sc.putSharedState('obj', { nested: true });
      sc.putSharedState('arr', [1, 2, 3]);
      sc.putSharedState('bool', false);

      expect(sc.getSharedState('str').value).toBe('hello');
      expect(sc.getSharedState('num').value).toBe(42);
      expect(sc.getSharedState('obj').value).toEqual({ nested: true });
      expect(sc.getSharedState('arr').value).toEqual([1, 2, 3]);
      expect(sc.getSharedState('bool').value).toBe(false);
    });
  });

  // ━━━ 2. getSharedState — 读取存储的值 / Returns stored value ━━━
  describe('getSharedState', () => {
    it('返回已存储的值 / returns stored value', () => {
      sc.putSharedState('myKey', 'myValue', 'writer-B');

      const entry = sc.getSharedState('myKey');
      expect(entry).not.toBeNull();
      expect(entry.value).toBe('myValue');
      expect(entry.writerId).toBe('writer-B');
      expect(typeof entry.timestamp).toBe('number');
    });

    it('不存在的 key 返回 null / returns null for nonexistent key', () => {
      const entry = sc.getSharedState('nonexistent');
      expect(entry).toBeNull();
    });
  });

  // ━━━ 3. LWW — 新时间戳获胜 / Newer timestamp wins ━━━
  describe('LWW: newer timestamp wins', () => {
    it('后写入覆盖前值 / later write overwrites earlier value', () => {
      sc.putSharedState('conflict', 'first', 'writer-A');

      // 等待时间戳变化 (同步足够, Date.now() 精度为 ms)
      // putSharedState 使用 >= 比较, 所以同时间戳也会覆盖
      sc.putSharedState('conflict', 'second', 'writer-B');

      const entry = sc.getSharedState('conflict');
      expect(entry.value).toBe('second');
      expect(entry.writerId).toBe('writer-B');
    });
  });

  // ━━━ 4. mergeState — 合并远端条目 / Merges remote entries ━━━
  describe('mergeState', () => {
    it('合并远端新条目 / merges new remote entries', () => {
      const remote = new Map();
      remote.set('remote-key1', { value: 'remoteVal1', timestamp: Date.now(), writerId: 'remote-writer' });
      remote.set('remote-key2', { value: 'remoteVal2', timestamp: Date.now(), writerId: 'remote-writer' });

      const merged = sc.mergeState(remote);
      expect(merged).toBe(2);

      expect(sc.getSharedState('remote-key1').value).toBe('remoteVal1');
      expect(sc.getSharedState('remote-key2').value).toBe('remoteVal2');
    });

    it('远端空 Map 不合并任何条目 / empty remote Map merges 0 entries', () => {
      const remote = new Map();
      const merged = sc.mergeState(remote);
      expect(merged).toBe(0);
    });
  });

  // ━━━ 5. mergeState — 远端新值覆盖本地 / Newer remote overwrites local ━━━
  describe('mergeState — remote overwrites local', () => {
    it('远端时间戳更新时覆盖本地 / remote overwrites local when timestamp is newer', () => {
      // 先写入本地 / Write local first
      sc.putSharedState('shared', 'localVal', 'local-writer');
      const localEntry = sc.getSharedState('shared');

      // 构造更新的远端 / Build newer remote
      const remote = new Map();
      remote.set('shared', {
        value: 'remoteVal',
        timestamp: localEntry.timestamp + 1000,
        writerId: 'remote-writer',
      });

      const merged = sc.mergeState(remote);
      expect(merged).toBe(1);

      const entry = sc.getSharedState('shared');
      expect(entry.value).toBe('remoteVal');
      expect(entry.writerId).toBe('remote-writer');
    });

    it('远端时间戳更旧时不覆盖本地 / remote does NOT overwrite local when timestamp is older', () => {
      // 先写入本地 / Write local first
      sc.putSharedState('preserved', 'localVal', 'local-writer');
      const localEntry = sc.getSharedState('preserved');

      // 构造更旧的远端 / Build older remote
      const remote = new Map();
      remote.set('preserved', {
        value: 'oldRemoteVal',
        timestamp: localEntry.timestamp - 5000,
        writerId: 'old-remote-writer',
      });

      const merged = sc.mergeState(remote);
      expect(merged).toBe(0);

      const entry = sc.getSharedState('preserved');
      expect(entry.value).toBe('localVal');
      expect(entry.writerId).toBe('local-writer');
    });
  });
});
