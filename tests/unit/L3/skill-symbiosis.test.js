/**
 * SkillSymbiosisTracker V5.2 单元测试 / SkillSymbiosisTracker Unit Tests
 *
 * 测试共生技能配对追踪: recordCollaboration + getComplementarity + recommendPartners
 * Tests symbiosis skill pairing: recordCollaboration + getComplementarity + recommendPartners
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillSymbiosisTracker } from '../../../src/L3-agent/skill-symbiosis.js';

// ── 模拟依赖 / Mock Dependencies ──

function createMockCapabilityEngine() {
  return {
    getAgentCapabilities: () => ({
      coding: 0.8,
      testing: 0.3,
      documentation: 0.5,
      domain: 0.4,
    }),
  };
}

function createMockBus() {
  const _published = [];
  return {
    publish(topic, data) { _published.push({ topic, data }); },
    subscribe() {},
    _published,
  };
}

const logger = { info() {}, warn() {}, error() {}, debug() {} };

// ── 测试 / Tests ──

describe('SkillSymbiosisTracker', () => {
  let tracker;

  beforeEach(() => {
    tracker = new SkillSymbiosisTracker({
      capabilityEngine: createMockCapabilityEngine(),
      db: null,
      logger,
    });
  });

  // ━━━ recordCollaboration ━━━

  describe('recordCollaboration', () => {
    it('记录协作数据到 pairCache / stores collaboration data in pair cache', () => {
      const scoresA = { technical: 0.9, delivery: 0.3, collaboration: 0.5, innovation: 0.2 };
      const scoresB = { technical: 0.2, delivery: 0.8, collaboration: 0.4, innovation: 0.7 };

      tracker.recordCollaboration('agent-alpha', 'agent-beta', 0.85, scoresA, scoresB);

      const stats = tracker.getStats();
      expect(stats.trackedPairs).toBe(1);
    });

    it('多次记录增量更新平均质量 / incremental average quality on multiple records', () => {
      const scoresA = { technical: 0.9, delivery: 0.3, collaboration: 0.5, innovation: 0.2 };
      const scoresB = { technical: 0.2, delivery: 0.8, collaboration: 0.4, innovation: 0.7 };

      tracker.recordCollaboration('agent-alpha', 'agent-beta', 0.8, scoresA, scoresB);
      tracker.recordCollaboration('agent-alpha', 'agent-beta', 0.6, scoresA, scoresB);

      // 平均质量应为 (0.8 + 0.6) / 2 = 0.7（增量计算）
      const partners = tracker.recommendPartners('agent-alpha', 5);
      expect(partners.length).toBe(1);
      // avgQuality should be close to 0.7 via incremental averaging
      expect(partners[0].avgQuality).toBeGreaterThanOrEqual(0.6);
      expect(partners[0].avgQuality).toBeLessThanOrEqual(0.8);
    });

    it('key 顺序一致（agentA/B 反转不影响）/ consistent key ordering regardless of agent order', () => {
      const scoresA = { technical: 0.5, delivery: 0.5, collaboration: 0.5, innovation: 0.5 };
      const scoresB = { technical: 0.5, delivery: 0.5, collaboration: 0.5, innovation: 0.5 };

      tracker.recordCollaboration('agent-beta', 'agent-alpha', 0.7, scoresA, scoresB);
      tracker.recordCollaboration('agent-alpha', 'agent-beta', 0.9, scoresA, scoresB);

      // 两次记录同一对，应该只有 1 个 pair / Two records for same pair, should be 1
      const stats = tracker.getStats();
      expect(stats.trackedPairs).toBe(1);
    });
  });

  // ━━━ computeComplementarity ━━━

  describe('computeComplementarity', () => {
    it('返回值在 0 到 1 之间 / returns value between 0 and 1', () => {
      const scoresA = { technical: 0.9, delivery: 0.1, collaboration: 0.2, innovation: 0.8 };
      const scoresB = { technical: 0.1, delivery: 0.9, collaboration: 0.8, innovation: 0.2 };

      const result = tracker.computeComplementarity(scoresA, scoresB);

      expect(result).toBeGreaterThanOrEqual(0);
      expect(result).toBeLessThanOrEqual(1);
    });

    it('互补向量返回高互补度 / complementary vectors yield high complementarity', () => {
      // 完全互补: A 擅长 technical/innovation, B 擅长 delivery/collaboration
      const scoresA = { technical: 1.0, delivery: 0.0, collaboration: 0.0, innovation: 1.0 };
      const scoresB = { technical: 0.0, delivery: 1.0, collaboration: 1.0, innovation: 0.0 };

      const result = tracker.computeComplementarity(scoresA, scoresB);

      // 完全正交 -> cosine sim = 0 -> complementarity = 1
      expect(result).toBeGreaterThan(0.8);
    });

    it('相同向量返回低互补度 / identical vectors yield low complementarity', () => {
      const scores = { technical: 0.7, delivery: 0.7, collaboration: 0.7, innovation: 0.7 };

      const result = tracker.computeComplementarity(scores, scores);

      // 完全相同 -> cosine sim = 1 -> complementarity = 0
      expect(result).toBeLessThan(0.1);
    });

    it('零向量返回中性值 0.5 / zero vector returns neutral 0.5', () => {
      const zero = { technical: 0, delivery: 0, collaboration: 0, innovation: 0 };
      const other = { technical: 0.5, delivery: 0.5, collaboration: 0.5, innovation: 0.5 };

      const result = tracker.computeComplementarity(zero, other);

      expect(result).toBe(0.5);
    });
  });

  // ━━━ recommendPartners ━━━

  describe('recommendPartners', () => {
    it('返回按评分排序的结果 / returns results sorted by composite score', () => {
      // 创建 3 个配对记录 / Create 3 pair records
      const scoresA = { technical: 0.9, delivery: 0.1, collaboration: 0.5, innovation: 0.3 };
      const scoresB = { technical: 0.1, delivery: 0.9, collaboration: 0.3, innovation: 0.5 };
      const scoresC = { technical: 0.5, delivery: 0.5, collaboration: 0.8, innovation: 0.8 };

      tracker.recordCollaboration('agent-1', 'agent-2', 0.9, scoresA, scoresB);
      tracker.recordCollaboration('agent-1', 'agent-3', 0.5, scoresA, scoresC);
      tracker.recordCollaboration('agent-1', 'agent-4', 0.3, scoresA, scoresB);

      const partners = tracker.recommendPartners('agent-1', 3);

      expect(Array.isArray(partners)).toBe(true);
      expect(partners.length).toBeLessThanOrEqual(3);
      expect(partners.length).toBeGreaterThan(0);

      // 每个结果应有 partnerId, complementarity, avgQuality, collaborations
      for (const p of partners) {
        expect(typeof p.partnerId).toBe('string');
        expect(typeof p.complementarity).toBe('number');
        expect(typeof p.avgQuality).toBe('number');
        expect(typeof p.collaborations).toBe('number');
      }

      // 验证排序: 第一个的复合分 >= 第二个 / Verify sort: first composite score >= second
      if (partners.length >= 2) {
        const score0 = partners[0].complementarity * 0.4 + partners[0].avgQuality * 0.6;
        const score1 = partners[1].complementarity * 0.4 + partners[1].avgQuality * 0.6;
        expect(score0).toBeGreaterThanOrEqual(score1);
      }
    });

    it('限制返回数量 / limits result count with topN', () => {
      const scores = { technical: 0.5, delivery: 0.5, collaboration: 0.5, innovation: 0.5 };
      for (let i = 2; i <= 6; i++) {
        tracker.recordCollaboration('agent-1', `agent-${i}`, 0.7, scores, scores);
      }

      const partners = tracker.recommendPartners('agent-1', 2);
      expect(partners.length).toBeLessThanOrEqual(2);
    });

    it('无匹配时返回空数组 / returns empty array when no matches', () => {
      const partners = tracker.recommendPartners('nonexistent-agent', 5);
      expect(partners).toEqual([]);
    });
  });

  // ━━━ getStats ━━━

  describe('getStats', () => {
    it('返回统计信息 / returns statistics', () => {
      const stats = tracker.getStats();
      expect(stats.computations).toBe(0);
      expect(stats.recommendations).toBe(0);
      expect(stats.trackedPairs).toBe(0);
    });

    it('操作后更新计数器 / updates counters after operations', () => {
      const scores = { technical: 0.5, delivery: 0.5, collaboration: 0.5, innovation: 0.5 };
      tracker.computeComplementarity(scores, scores);
      tracker.recommendPartners('agent-1', 3);

      const stats = tracker.getStats();
      expect(stats.computations).toBe(1);
      expect(stats.recommendations).toBe(1);
    });
  });
});
