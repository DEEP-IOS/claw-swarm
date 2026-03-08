/**
 * WorkingMemory 单元测试 / WorkingMemory Unit Tests
 *
 * 纯内存测试, 无需数据库。验证三层工作记忆的核心行为:
 * 自动分层、LRU 驱逐、访问刷新、压缩、快照等。
 *
 * Pure in-memory tests, no database needed. Verifies core behaviour of
 * the three-layer working memory: auto-layering, LRU eviction, access
 * bumping, compression, snapshot, etc.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { WorkingMemory } from '../../../src/L3-agent/memory/working-memory.js';

// 静默 logger / Silent logger
const silentLogger = { info() {}, warn() {}, error() {}, debug() {} };

describe('WorkingMemory', () => {
  /** @type {WorkingMemory} */
  let wm;

  beforeEach(() => {
    // 使用较小容量便于测试驱逐 / Use small capacities to make eviction easy to test
    wm = new WorkingMemory({ maxFocus: 3, maxContext: 5, maxScratch: 5, logger: silentLogger });
  });

  // ━━━ 1. 基本读写 / Basic put & get round-trip ━━━
  describe('put / get', () => {
    it('应写入并读取相同的值 / should store and retrieve a value', () => {
      wm.put('key-1', { foo: 'bar' }, { priority: 5 });
      const val = wm.get('key-1');
      expect(val).toEqual({ foo: 'bar' });
    });

    it('不存在的 key 应返回 null / non-existent key returns null', () => {
      expect(wm.get('missing')).toBeNull();
    });

    it('重复 put 相同 key 应更新值 / duplicate put should update value', () => {
      wm.put('dup', 1, { priority: 5 });
      wm.put('dup', 2, { priority: 5 });
      expect(wm.get('dup')).toBe(2);
    });
  });

  // ━━━ 2. 自动分层 / Auto-layering ━━━
  describe('auto-layering', () => {
    it('priority >= 8 应进入 focus 层 / priority >= 8 routes to focus', () => {
      const entry = wm.put('hi-pri', 'x', { priority: 9 });
      expect(entry.layer).toBe('focus');
    });

    it('priority >= 5 且 < 8 应进入 context 层 / priority 5-7 routes to context', () => {
      const entry = wm.put('mid-pri', 'x', { priority: 6 });
      expect(entry.layer).toBe('context');
    });

    it('priority < 5 应进入 scratchpad 层 / priority < 5 routes to scratchpad', () => {
      const entry = wm.put('lo-pri', 'x', { priority: 2 });
      expect(entry.layer).toBe('scratchpad');
    });
  });

  // ━━━ 3. 驱逐 / Eviction ━━━
  describe('eviction', () => {
    it('focus 满时最低激活度项应级联到 context / overflow evicts lowest-activation to context', () => {
      // maxFocus = 3, 插入 4 项, 最低激活度的应被驱逐
      // maxFocus = 3, insert 4 items, lowest activation should be evicted
      wm.put('f1', 1, { priority: 8 });
      wm.put('f2', 2, { priority: 9 });
      wm.put('f3', 3, { priority: 10 });
      wm.put('f4', 4, { priority: 8 });

      // focus 层应剩 3 项 / focus layer should have 3 items
      const focusItems = wm.getLayer('focus');
      expect(focusItems.length).toBe(3);

      // 被驱逐的项应出现在 context 层 / evicted item should appear in context
      const contextItems = wm.getLayer('context');
      expect(contextItems.length).toBe(1);

      // 统计中应记录驱逐 / eviction count should increase
      const stats = wm.getStats();
      expect(stats.evictions).toBeGreaterThanOrEqual(1);
    });
  });

  // ━━━ 4. 访问刷新 / Access bumps recency ━━━
  describe('access bumps recency', () => {
    it('get() 应更新 lastAccessedAt 和 accessCount / get() should bump access info', () => {
      wm.put('bump', 'hello', { priority: 5 });

      // 记录初始访问信息 / Record initial access info
      const entryBefore = wm.getLayer('context').find(e => e.key === 'bump');
      const tBefore = entryBefore.lastAccessedAt;
      const countBefore = entryBefore.accessCount;

      // 等待 1ms 以确保时间戳变化 / Wait 1ms to ensure timestamp changes
      const start = Date.now();
      while (Date.now() === start) { /* spin */ }

      wm.get('bump');

      const entryAfter = wm.getLayer('context').find(e => e.key === 'bump');
      expect(entryAfter.lastAccessedAt).toBeGreaterThanOrEqual(tBefore);
      expect(entryAfter.accessCount).toBe(countBefore + 1);
    });
  });

  // ━━━ 5. getLayer / getLayer ━━━
  describe('getLayer', () => {
    it('应按激活度降序排列 / should return items sorted by activation desc', () => {
      // 插入多个 context 层项, 不同 priority 影响 baseScore
      // Insert multiple context items with different priorities affecting baseScore
      wm.put('c1', 1, { priority: 5 });
      wm.put('c2', 2, { priority: 7 });
      wm.put('c3', 3, { priority: 6 });

      const items = wm.getLayer('context');
      expect(items.length).toBe(3);

      // 激活度 = priority/10 * recencyWeight, 相同时间下 priority 高者排前
      // activation = priority/10 * recencyWeight, higher priority first at same time
      expect(items[0].priority).toBeGreaterThanOrEqual(items[1].priority);
    });

    it('空层应返回空数组 / empty layer returns empty array', () => {
      expect(wm.getLayer('focus')).toEqual([]);
    });
  });

  // ━━━ 6. 快照 / Snapshot ━━━
  describe('snapshot', () => {
    it('应返回三层及总数 / should return all 3 layers with counts', () => {
      wm.put('f1', 1, { priority: 9 });
      wm.put('c1', 2, { priority: 6 });
      wm.put('s1', 3, { priority: 2 });

      const snap = wm.snapshot();
      expect(snap.focus).toHaveLength(1);
      expect(snap.context).toHaveLength(1);
      expect(snap.scratchpad).toHaveLength(1);
      expect(snap.totalItems).toBe(3);
    });

    it('空记忆快照 / empty memory snapshot', () => {
      const snap = wm.snapshot();
      expect(snap.totalItems).toBe(0);
      expect(snap.focus).toEqual([]);
      expect(snap.context).toEqual([]);
      expect(snap.scratchpad).toEqual([]);
    });
  });

  // ━━━ 7. 压缩 / Compress ━━━
  describe('compress', () => {
    it('应按 importance*confidence 保留 top N 项 / keeps top N by importance*confidence', () => {
      wm.put('a', 1, { priority: 5, importance: 0.9, confidence: 1.0 });
      wm.put('b', 2, { priority: 5, importance: 0.1, confidence: 0.5 });
      wm.put('c', 3, { priority: 5, importance: 0.7, confidence: 0.8 });
      wm.put('d', 4, { priority: 5, importance: 0.3, confidence: 0.3 });

      const evicted = wm.compress(2);
      expect(evicted).toBe(2);
      expect(wm.getStats().totalItems).toBe(2);

      // 保留的应是 importance*confidence 最高的两项 / Kept should be top-2
      expect(wm.get('a')).not.toBeNull(); // 0.9 * 1.0 = 0.90
      expect(wm.get('c')).not.toBeNull(); // 0.7 * 0.8 = 0.56
    });

    it('条目数 <= targetCount 时不驱逐 / no eviction when within target', () => {
      wm.put('x', 1, { priority: 5 });
      const evicted = wm.compress(10);
      expect(evicted).toBe(0);
    });
  });

  // ━━━ 8. 删除 / Remove ━━━
  describe('remove', () => {
    it('应删除指定 key / should remove the specified key', () => {
      wm.put('del-me', 'gone', { priority: 5 });
      expect(wm.remove('del-me')).toBe(true);
      expect(wm.get('del-me')).toBeNull();
    });

    it('删除不存在的 key 返回 false / removing non-existent key returns false', () => {
      expect(wm.remove('nope')).toBe(false);
    });
  });

  // ━━━ 9. 清空 / Clear ━━━
  describe('clear', () => {
    it('应清空所有层 / should empty all layers', () => {
      wm.put('a', 1, { priority: 9 });
      wm.put('b', 2, { priority: 6 });
      wm.put('c', 3, { priority: 2 });

      wm.clear();

      expect(wm.getStats().totalItems).toBe(0);
      expect(wm.getLayer('focus')).toEqual([]);
      expect(wm.getLayer('context')).toEqual([]);
      expect(wm.getLayer('scratchpad')).toEqual([]);
    });
  });

  // ━━━ 10. 统计 / getStats ━━━
  describe('getStats', () => {
    it('应返回各层正确计数 / should return correct per-layer counts', () => {
      wm.put('f1', 1, { priority: 9 });
      wm.put('f2', 2, { priority: 8 });
      wm.put('c1', 3, { priority: 6 });
      wm.put('s1', 4, { priority: 1 });

      const stats = wm.getStats();
      expect(stats.focusCount).toBe(2);
      expect(stats.contextCount).toBe(1);
      expect(stats.scratchCount).toBe(1);
      expect(stats.totalItems).toBe(4);
      expect(stats).toHaveProperty('evictions');
    });
  });
});
