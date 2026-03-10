/**
 * V5.7 SkillSymbiosisTracker 调度集成测试 / Scheduling Integration Tests
 *
 * 测试 V5.7 新增的 8D→4D 维度映射、团队互补度、MessageBus 集成。
 * Tests V5.7 new 8D→4D dimension mapping, team complementarity, MessageBus integration.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { SkillSymbiosisTracker } from '../../../src/L3-agent/skill-symbiosis.js';

// ── 模拟依赖 / Mock Dependencies ──

const silentLogger = { info() {}, warn() {}, error() {}, debug() {} };

// ── 测试 / Tests ──

describe('SkillSymbiosisTracker V5.7', () => {

  // ━━━ mapDimensions8Dto4D ━━━

  describe('mapDimensions8Dto4D', () => {
    it('应正确映射 8D→4D 维度 / should correctly map 8D to 4D dimensions', () => {
      const scores8D = {
        coding: 0.8,
        architecture: 0.6,
        security: 0.4,
        performance: 0.2,
        testing: 0.7,
        documentation: 0.3,
        communication: 0.9,
        domain: 0.5,
      };

      const result = SkillSymbiosisTracker.mapDimensions8Dto4D(scores8D);

      // technical = (0.8 + 0.6 + 0.4 + 0.2) / 4 = 2.0 / 4 = 0.5
      expect(result.technical).toBeCloseTo(0.5, 4);

      // delivery = (0.7 + 0.3) / 2 = 1.0 / 2 = 0.5
      expect(result.delivery).toBeCloseTo(0.5, 4);

      // collaboration = communication = 0.9
      expect(result.collaboration).toBeCloseTo(0.9, 4);

      // innovation = domain = 0.5
      expect(result.innovation).toBeCloseTo(0.5, 4);
    });

    it('null/undefined 输入应返回全零 / null/undefined input should return zeros', () => {
      const resultNull = SkillSymbiosisTracker.mapDimensions8Dto4D(null);
      expect(resultNull.technical).toBe(0);
      expect(resultNull.delivery).toBe(0);
      expect(resultNull.collaboration).toBe(0);
      expect(resultNull.innovation).toBe(0);

      const resultUndefined = SkillSymbiosisTracker.mapDimensions8Dto4D(undefined);
      expect(resultUndefined.technical).toBe(0);
      expect(resultUndefined.delivery).toBe(0);
      expect(resultUndefined.collaboration).toBe(0);
      expect(resultUndefined.innovation).toBe(0);
    });

    it('缺失维度应视为 0 / missing dimensions should be treated as 0', () => {
      const partial = { coding: 1.0, testing: 0.6 };
      const result = SkillSymbiosisTracker.mapDimensions8Dto4D(partial);

      // technical = (1.0 + 0 + 0 + 0) / 4 = 0.25
      expect(result.technical).toBeCloseTo(0.25, 4);
      // delivery = (0.6 + 0) / 2 = 0.3
      expect(result.delivery).toBeCloseTo(0.3, 4);
      // collaboration = 0 (no communication)
      expect(result.collaboration).toBe(0);
      // innovation = 0 (no domain)
      expect(result.innovation).toBe(0);
    });
  });

  // ━━━ getTeamComplementarity ━━━

  describe('getTeamComplementarity', () => {
    let tracker;

    beforeEach(() => {
      tracker = new SkillSymbiosisTracker({ logger: silentLogger });
    });

    it('空团队应返回 0.5 / empty team should return 0.5', () => {
      const result = tracker.getTeamComplementarity('agent-1', []);
      expect(result).toBe(0.5);
    });

    it('null 团队应返回 0.5 / null team should return 0.5', () => {
      const result = tracker.getTeamComplementarity('agent-1', null);
      expect(result).toBe(0.5);
    });

    it('无缓存数据应返回 0.5 / no cached data should return 0.5', () => {
      // 团队成员存在但没有配对记录
      const result = tracker.getTeamComplementarity('agent-1', ['agent-2', 'agent-3']);
      expect(result).toBe(0.5);
    });

    it('有缓存配对数据时应返回实际互补度 / should return actual complementarity with cached pairs', () => {
      // 先记录协作来填充 pairCache
      const scoresA = { technical: 0.9, delivery: 0.1, collaboration: 0.5, innovation: 0.2 };
      const scoresB = { technical: 0.1, delivery: 0.9, collaboration: 0.3, innovation: 0.8 };
      const scoresC = { technical: 0.5, delivery: 0.5, collaboration: 0.7, innovation: 0.4 };

      tracker.recordCollaboration('agent-1', 'agent-2', 0.8, scoresA, scoresB);
      tracker.recordCollaboration('agent-1', 'agent-3', 0.7, scoresA, scoresC);

      const result = tracker.getTeamComplementarity('agent-1', ['agent-2', 'agent-3']);

      // 应返回两个配对互补度的平均值, 而非 0.5
      expect(result).not.toBe(0.5);
      expect(result).toBeGreaterThanOrEqual(0);
      expect(result).toBeLessThanOrEqual(1);
    });

    it('agentId 与团队成员相同时应跳过自身 / should skip self in team', () => {
      const scores = { technical: 0.5, delivery: 0.5, collaboration: 0.5, innovation: 0.5 };
      tracker.recordCollaboration('agent-1', 'agent-2', 0.9, scores, scores);

      // 团队包含 agent-1 自身, 应被跳过
      const result = tracker.getTeamComplementarity('agent-1', ['agent-1', 'agent-2']);
      // 只有 agent-2 的配对生效
      expect(result).not.toBe(0.5); // 因为 agent-1::agent-2 有记录
    });
  });

  // ━━━ Constructor messageBus ━━━

  describe('constructor', () => {
    it('应接受 messageBus 参数 / should accept messageBus parameter', () => {
      const mockBus = { publish: vi.fn(), subscribe: vi.fn() };
      const tracker = new SkillSymbiosisTracker({
        logger: silentLogger,
        messageBus: mockBus,
      });

      // 应能正常创建实例
      expect(tracker).toBeDefined();
      expect(tracker.getStats().trackedPairs).toBe(0);
    });
  });

  // ━━━ recordCollaboration + MessageBus ━━━

  describe('recordCollaboration with messageBus', () => {
    it('应在 messageBus 上发布 symbiosis.collaboration.recorded 事件 / should publish event on messageBus', () => {
      const mockBus = { publish: vi.fn(), subscribe: vi.fn() };
      const tracker = new SkillSymbiosisTracker({
        logger: silentLogger,
        messageBus: mockBus,
      });

      const scoresA = { technical: 0.8, delivery: 0.3, collaboration: 0.5, innovation: 0.4 };
      const scoresB = { technical: 0.3, delivery: 0.7, collaboration: 0.6, innovation: 0.9 };

      tracker.recordCollaboration('agent-x', 'agent-y', 0.85, scoresA, scoresB);

      expect(mockBus.publish).toHaveBeenCalledTimes(1);
      expect(mockBus.publish).toHaveBeenCalledWith(
        'symbiosis.collaboration.recorded',
        expect.objectContaining({
          agentAId: expect.any(String),
          agentBId: expect.any(String),
          complementarity: expect.any(Number),
          avgQuality: expect.any(Number),
          collaborations: 1,
        }),
        expect.objectContaining({ senderId: 'skill-symbiosis' }),
      );
    });

    it('无 messageBus 时不应报错 (向后兼容) / should not throw without messageBus (backward compat)', () => {
      const tracker = new SkillSymbiosisTracker({
        logger: silentLogger,
        // 不提供 messageBus / No messageBus
      });

      const scores = { technical: 0.5, delivery: 0.5, collaboration: 0.5, innovation: 0.5 };

      // 应不抛出异常
      expect(() => {
        tracker.recordCollaboration('agent-a', 'agent-b', 0.7, scores, scores);
      }).not.toThrow();

      expect(tracker.getStats().trackedPairs).toBe(1);
    });
  });
});
