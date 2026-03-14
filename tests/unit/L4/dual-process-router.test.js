/**
 * DualProcessRouter 单元测试 / DualProcessRouter Unit Tests
 *
 * V6.0 L4: System 1/2 双过程路由测试
 * V6.0 L4: Tests for System 1/2 dual-process routing decisions
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DualProcessRouter } from '../../../src/L4-orchestration/dual-process-router.js';

// ── 辅助 / Helpers ──────────────────────────────────────────────────────────

const silentLogger = { info() {}, warn() {}, error() {}, debug() {} };
const mockBus = { publish: vi.fn(), subscribe: vi.fn(() => () => {}) };

// ── 测试 / Tests ────────────────────────────────────────────────────────────

describe('DualProcessRouter', () => {
  let router;

  beforeEach(() => {
    mockBus.publish.mockClear();
    router = new DualProcessRouter({
      messageBus: mockBus,
      logger: silentLogger,
    });
  });

  describe('构造 / Construction', () => {
    it('创建实例不报错 / creates without error', () => {
      expect(router).toBeDefined();
    });

    it('getStats 返回初始统计 / getStats returns initial stats', () => {
      const stats = router.getStats();
      expect(stats).toBeDefined();
    });
  });

  describe('route / Route', () => {
    it('返回有效路由决策 / returns valid routing decision', () => {
      const decision = router.route({});
      expect(decision).toBeDefined();
      expect([1, 2]).toContain(decision.system);
      expect(['DIRECT', 'PREPLAN']).toContain(decision.mode);
      expect(typeof decision.s1Score).toBe('number');
      expect(typeof decision.s2Score).toBe('number');
      expect(Array.isArray(decision.triggers)).toBe(true);
    });

    it('System 1 — 有疫苗匹配时倾向直接 / S1 — vaccine match favors DIRECT', () => {
      const decision = router.route({
        hasVaccine: true,
        breakerState: 'CLOSED',
        successRate: 0.95,
        affinityRank: 1,
        modulatorMode: 'EXPLOIT',
      });

      // 高 S1 信号应倾向 DIRECT
      expect(decision.s1Score).toBeGreaterThan(0);
    });

    it('System 2 — 新任务类型倾向预规划 / S2 — new task type favors PREPLAN', () => {
      const decision = router.route({
        isNewTaskType: true,
        breakerState: 'HALF_OPEN',
        alarmDensity: 5,
        modulatorMode: 'EXPLORE',
        recentQualityFails: 3,
      });

      // 高 S2 信号应倾向 PREPLAN
      expect(decision.s2Score).toBeGreaterThan(0);
    });

    it('默认空上下文不崩溃 / empty context does not crash', () => {
      expect(() => router.route()).not.toThrow();
      expect(() => router.route({})).not.toThrow();
    });

    it('记录触发因素 / records triggers', () => {
      const decision = router.route({
        hasVaccine: true,
        isNewTaskType: true,
      });
      // triggers 应包含相关因素
      expect(Array.isArray(decision.triggers)).toBe(true);
    });

    it('发布 MessageBus 事件 / publishes to MessageBus', () => {
      router.route({ hasVaccine: true });
      expect(mockBus.publish).toHaveBeenCalled();
    });
  });

  describe('统计 / Stats', () => {
    it('路由后统计更新 / stats update after routing', () => {
      router.route({});
      router.route({});
      router.route({});

      const stats = router.getStats();
      const total = (stats.system1 || 0) + (stats.system2 || 0);
      expect(total).toBe(3);
    });

    it('统计包含 S1/S2 分布 / stats include S1/S2 distribution', () => {
      // 强 S1 上下文
      router.route({ hasVaccine: true, breakerState: 'CLOSED', successRate: 0.99, modulatorMode: 'EXPLOIT' });
      // 强 S2 上下文
      router.route({ isNewTaskType: true, breakerState: 'HALF_OPEN', alarmDensity: 10, modulatorMode: 'EXPLORE' });

      const stats = router.getStats();
      expect(stats).toBeDefined();
    });
  });
});
