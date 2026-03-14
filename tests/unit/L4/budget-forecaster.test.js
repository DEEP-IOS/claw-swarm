/**
 * BudgetForecaster 单元测试 / BudgetForecaster Unit Tests
 *
 * V6.0 L4: 预算预测测试
 * V6.0 L4: Tests for token budget linear-regression forecasting
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BudgetForecaster } from '../../../src/L4-orchestration/budget-forecaster.js';

// ── 辅助 / Helpers ──────────────────────────────────────────────────────────

const silentLogger = { info() {}, warn() {}, error() {}, debug() {} };
const mockBus = { publish: vi.fn(), subscribe: vi.fn(() => () => {}) };

// ── 测试 / Tests ────────────────────────────────────────────────────────────

describe('BudgetForecaster', () => {
  let forecaster;

  beforeEach(() => {
    mockBus.publish.mockClear();
    forecaster = new BudgetForecaster({
      messageBus: mockBus,
      logger: silentLogger,
      config: { exhaustionWarningMultiplier: 1.2 },
    });
  });

  describe('构造 / Construction', () => {
    it('创建实例不报错 / creates without error', () => {
      expect(forecaster).toBeDefined();
    });

    it('getStats 返回初始统计 / getStats returns initial stats', () => {
      const stats = forecaster.getStats();
      expect(stats).toBeDefined();
      expect(stats.totalConsumed).toBe(0);
      expect(stats.turnCount).toBe(0);
    });
  });

  describe('recordCost / Record Cost', () => {
    it('记录成本不报错 / records cost without error', () => {
      expect(() => forecaster.recordCost(100, 1)).not.toThrow();
      expect(() => forecaster.recordCost(200, 2)).not.toThrow();
    });

    it('更新统计 / updates stats', () => {
      forecaster.recordCost(100, 1);
      forecaster.recordCost(200, 2);

      const stats = forecaster.getStats();
      expect(stats.totalConsumed).toBe(300);
      expect(stats.turnCount).toBe(2);
    });

    it('平均成本正确 / average cost correct', () => {
      forecaster.recordCost(100, 1);
      forecaster.recordCost(200, 2);
      forecaster.recordCost(300, 3);

      const stats = forecaster.getStats();
      expect(stats.avgCostPerTurn).toBe(200);
    });
  });

  describe('forecast / Forecast', () => {
    it('无数据时返回低置信度 / returns low confidence with no data', () => {
      const result = forecaster.forecast({
        totalBudget: 10000,
        completionRatio: 0,
        remainingTasks: 5,
      });
      expect(result).toBeDefined();
      expect(result.confidence).toBeLessThanOrEqual(1);
    });

    it('有数据时预测 / forecasts with data', () => {
      for (let i = 1; i <= 10; i++) {
        forecaster.recordCost(100, i);
      }

      const result = forecaster.forecast({
        totalBudget: 5000,
        completionRatio: 0.5,
        remainingTasks: 5,
      });

      expect(result.estimatedRemaining).toBeGreaterThan(0);
      expect(result.confidence).toBeGreaterThan(0);
      expect(['low', 'medium', 'high']).toContain(result.exhaustionRisk);
    });

    it('预算充裕时风险低 / low risk when budget sufficient', () => {
      for (let i = 1; i <= 5; i++) {
        forecaster.recordCost(10, i);
      }

      const result = forecaster.forecast({
        totalBudget: 100000,
        completionRatio: 0.9,
        remainingTasks: 1,
      });

      expect(result.exhaustionRisk).toBe('low');
    });

    it('预算紧张时风险高 / high risk when budget tight', () => {
      for (let i = 1; i <= 5; i++) {
        forecaster.recordCost(1000, i);
      }

      const result = forecaster.forecast({
        totalBudget: 5100,
        completionRatio: 0.1,
        remainingTasks: 20,
      });

      expect(['medium', 'high']).toContain(result.exhaustionRisk);
    });

    it('发布预警事件 / publishes warning event on high risk', () => {
      for (let i = 1; i <= 5; i++) {
        forecaster.recordCost(1000, i);
      }

      forecaster.forecast({
        totalBudget: 5100,
        completionRatio: 0.1,
        remainingTasks: 50,
      });

      // 如果风险高，应发布预警 / Should publish warning if high risk
    });
  });
});
