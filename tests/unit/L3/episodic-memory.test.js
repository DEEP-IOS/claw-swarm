/**
 * EpisodicMemory 单元测试 / EpisodicMemory Unit Tests
 *
 * 使用真实 DatabaseManager + 内存 SQLite 测试情景记忆服务核心功能:
 * 记录/检索、关键词过滤、时间线、会话查询、固化、Ebbinghaus 遗忘清理等。
 *
 * Uses real DatabaseManager + in-memory SQLite to test episodic memory
 * service core: record/recall, keyword filter, timeline, session query,
 * consolidation, Ebbinghaus pruning, statistics.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DatabaseManager } from '../../../src/L1-infrastructure/database/database-manager.js';
import { EpisodicRepository } from '../../../src/L1-infrastructure/database/repositories/episodic-repo.js';
import { EpisodicMemory } from '../../../src/L3-agent/memory/episodic-memory.js';
import { TABLE_SCHEMAS } from '../../../src/L1-infrastructure/schemas/database-schemas.js';

// 静默 logger / Silent logger
const silentLogger = { info() {}, warn() {}, error() {}, debug() {} };

// 最小 MessageBus 桩 / Minimal MessageBus stub
function createStubBus() {
  const published = [];
  return {
    publish(topic, data, opts) { published.push({ topic, data, opts }); },
    _published: published,
  };
}

describe('EpisodicMemory', () => {
  /** @type {DatabaseManager} */
  let dbManager;
  /** @type {EpisodicRepository} */
  let repo;
  /** @type {ReturnType<typeof createStubBus>} */
  let bus;
  /** @type {EpisodicMemory} */
  let mem;

  const AGENT = 'agent-test';

  beforeEach(() => {
    // 创建内存数据库并初始化所有表 / Create in-memory DB and bootstrap all tables
    dbManager = new DatabaseManager({ memory: true });
    dbManager.open(TABLE_SCHEMAS);
    repo = new EpisodicRepository(dbManager);
    bus = createStubBus();
    mem = new EpisodicMemory({ episodicRepo: repo, messageBus: bus, logger: silentLogger });
  });

  afterEach(() => { dbManager.close(); });

  // ━━━ 1. 基本记录与检索 / Basic record and recall ━━━
  describe('record & recall', () => {
    it('应记录事件并通过 recall 取回 / should record and recall an event', () => {
      const id = mem.record({
        agentId: AGENT,
        eventType: 'action',
        subject: 'agent-test',
        predicate: 'completed',
        object: 'task-42',
        importance: 0.8,
      });
      expect(id).toBeTruthy();

      const results = mem.recall(AGENT);
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0].subject).toBe('agent-test');
      expect(results[0].predicate).toBe('completed');
      expect(results[0]).toHaveProperty('_score');
    });

    it('记录应广播事件到 MessageBus / record should publish to message bus', () => {
      mem.record({
        agentId: AGENT, eventType: 'observation',
        subject: 'env', predicate: 'changed',
      });
      const msg = bus._published.find(p => p.topic === 'memory.episodic.recorded');
      expect(msg).toBeTruthy();
      expect(msg.data.agentId).toBe(AGENT);
    });
  });

  // ━━━ 2. 关键词过滤 / Keyword filter ━━━
  describe('recall with keyword', () => {
    it('应根据关键词过滤事件 / should filter events by keyword', () => {
      mem.record({ agentId: AGENT, eventType: 'action', subject: 'agent', predicate: 'deployed', object: 'frontend-service' });
      mem.record({ agentId: AGENT, eventType: 'action', subject: 'agent', predicate: 'deployed', object: 'backend-service' });
      mem.record({ agentId: AGENT, eventType: 'error', subject: 'agent', predicate: 'crashed', object: 'database' });

      const results = mem.recall(AGENT, { keyword: 'frontend' });
      expect(results.length).toBeGreaterThanOrEqual(1);
      // 带有 'frontend' 的结果应排在前面 (相关性更高)
      // Results with 'frontend' should rank higher (higher relevance)
      expect(results[0].object).toBe('frontend-service');
    });
  });

  // ━━━ 3. 综合评分排序 / Composite score sorting ━━━
  describe('recall scoring', () => {
    it('高重要性事件应排在低重要性之前 / high importance ranks before low importance', () => {
      mem.record({ agentId: AGENT, eventType: 'action', subject: 'a', predicate: 'p', importance: 0.9 });
      mem.record({ agentId: AGENT, eventType: 'action', subject: 'b', predicate: 'p', importance: 0.1 });

      const results = mem.recall(AGENT, { limit: 2 });
      expect(results.length).toBe(2);
      // 第一个应有更高评分 / First should have higher score
      expect(results[0]._score).toBeGreaterThanOrEqual(results[1]._score);
      expect(results[0].importance).toBe(0.9);
    });
  });

  // ━━━ 4. 时间线 / Timeline ━━━
  describe('getTimeline', () => {
    it('应返回按时间正序排列的事件 / should return events in chronological order', () => {
      mem.record({ agentId: AGENT, eventType: 'action', subject: 'first', predicate: 'p' });
      mem.record({ agentId: AGENT, eventType: 'action', subject: 'second', predicate: 'p' });
      mem.record({ agentId: AGENT, eventType: 'action', subject: 'third', predicate: 'p' });

      const timeline = mem.getTimeline(AGENT, { limit: 10 });
      expect(timeline.length).toBe(3);

      // 时间应正序: 第一条 timestamp <= 最后一条
      // Chronological: first timestamp <= last timestamp
      expect(Number(timeline[0].timestamp)).toBeLessThanOrEqual(Number(timeline[2].timestamp));
      // 同一毫秒内按 ID 排序, 验证所有 subject 都存在
      // Within same ms, sorted by ID; verify all subjects present
      const subjects = timeline.map(e => e.subject);
      expect(subjects).toContain('first');
      expect(subjects).toContain('second');
      expect(subjects).toContain('third');
    });
  });

  // ━━━ 5. 会话查询 / getBySession ━━━
  describe('getBySession', () => {
    it('应按会话 ID 返回事件 / should return events for a specific session', () => {
      mem.record({ agentId: AGENT, eventType: 'action', subject: 'a', predicate: 'p', sessionId: 'sess-1' });
      mem.record({ agentId: AGENT, eventType: 'action', subject: 'b', predicate: 'p', sessionId: 'sess-1' });
      mem.record({ agentId: AGENT, eventType: 'action', subject: 'c', predicate: 'p', sessionId: 'sess-2' });

      const sess1 = mem.getBySession('sess-1');
      expect(sess1.length).toBe(2);
      expect(sess1.every(e => e.sessionId === 'sess-1')).toBe(true);

      const sess2 = mem.getBySession('sess-2');
      expect(sess2.length).toBe(1);
    });
  });

  // ━━━ 6. 固化 / Consolidation ━━━
  describe('consolidate', () => {
    it('应将工作记忆条目持久化为情景事件 / should persist working memory items as episodic events', () => {
      const workingMemoryItems = [
        { key: 'wm-1', value: 'plan-data', layer: 'focus', accessCount: 5, priority: 9, importance: 0.8 },
        { key: 'wm-2', value: { steps: 3 }, layer: 'context', accessCount: 2, priority: 6, importance: 0.4 },
      ];

      const ids = mem.consolidate(AGENT, workingMemoryItems);
      expect(ids).toHaveLength(2);

      // 验证已存储到数据库 / Verify stored in database
      const total = mem.getStats(AGENT);
      expect(total.totalEvents).toBe(2);

      // 验证固化事件的内容 / Verify consolidated event content
      const events = mem.recall(AGENT, { limit: 10 });
      expect(events.some(e => e.predicate === 'consolidated' && e.object === 'wm-1')).toBe(true);
    });

    it('空数组应返回空 / empty array returns empty', () => {
      expect(mem.consolidate(AGENT, [])).toEqual([]);
      expect(mem.consolidate(AGENT, null)).toEqual([]);
    });

    it('固化应广播事件 / consolidation should broadcast event', () => {
      mem.consolidate(AGENT, [{ key: 'k', value: 'v', importance: 0.5 }]);
      const msg = bus._published.find(p => p.topic === 'memory.episodic.consolidated');
      expect(msg).toBeTruthy();
      expect(msg.data.count).toBe(1);
    });
  });

  // ━━━ 7. Ebbinghaus 遗忘清理 / Prune ━━━
  describe('prune', () => {
    it('应删除低保留率的旧事件 / should remove old events with low retention', () => {
      // 手动插入一条极旧的低重要性事件 / Manually insert an ancient low-importance event
      const oldTimestamp = Date.now() - 365 * 86400000; // 一年前 / 1 year ago
      repo.record({
        id: 'old-event',
        agentId: AGENT,
        eventType: 'action',
        subject: 'ancient',
        predicate: 'forgotten',
        importance: 0.1,
      });
      // 直接修改时间戳使其变旧 / Directly backdate the timestamp
      dbManager.run('UPDATE episodic_events SET timestamp = ? WHERE id = ?', oldTimestamp, 'old-event');

      // 插入一条新的高重要性事件 (不应被清理) / Insert a new high-importance event (should survive)
      mem.record({ agentId: AGENT, eventType: 'action', subject: 'fresh', predicate: 'remembered', importance: 0.9 });

      const pruned = mem.prune({ lambdaDays: 30, retentionThreshold: 0.1 });
      expect(pruned).toBeGreaterThanOrEqual(1);

      // 旧事件应已被删除 / Old event should be gone
      const remaining = mem.recall(AGENT, { limit: 100 });
      expect(remaining.some(e => e.id === 'old-event')).toBe(false);
      // 新事件应仍在 / New event should remain
      expect(remaining.some(e => e.subject === 'fresh')).toBe(true);
    });

    it('无过期事件时返回 0 / returns 0 when nothing to prune', () => {
      mem.record({ agentId: AGENT, eventType: 'action', subject: 'new', predicate: 'p', importance: 0.9 });
      expect(mem.prune()).toBe(0);
    });
  });

  // ━━━ 8. 统计 / getStats ━━━
  describe('getStats', () => {
    it('应返回正确的总数和近期数 / should return correct total and recent counts', () => {
      mem.record({ agentId: AGENT, eventType: 'action', subject: 'a', predicate: 'p' });
      mem.record({ agentId: AGENT, eventType: 'action', subject: 'b', predicate: 'p' });
      mem.record({ agentId: AGENT, eventType: 'action', subject: 'c', predicate: 'p' });

      const stats = mem.getStats(AGENT);
      expect(stats.totalEvents).toBe(3);
      // 刚创建的事件都在 24 小时内 / Just-created events are all within 24h
      expect(stats.recentEvents).toBe(3);
    });

    it('不指定 agentId 时返回全局总数 / no agentId returns global total', () => {
      mem.record({ agentId: 'agent-a', eventType: 'action', subject: 'x', predicate: 'p' });
      mem.record({ agentId: 'agent-b', eventType: 'action', subject: 'y', predicate: 'p' });

      const stats = mem.getStats();
      expect(stats.totalEvents).toBe(2);
    });
  });
});
