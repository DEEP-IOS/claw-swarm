/**
 * BudgetForecaster V7.0 增量测试 / BudgetForecaster V7.0 Incremental Tests
 *
 * V7.0 L4: 预算弹性调度 + 任务市场定价
 * V7.0 L4: Budget elastic scheduling (recommendDegradation) + task market pricing (priceTask)
 *
 * @author DEEP-IOS
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { BudgetForecaster } from '../../../src/L4-orchestration/budget-forecaster.js';

// ── 辅助 / Helpers ──────────────────────────────────────────────────────────

const silentLogger = { info() {}, warn() {}, error() {}, debug() {} };

/** 模拟 MessageBus / Mock MessageBus */
function createMockBus() {
  const published = [];
  return {
    publish(topic, data) { published.push({ topic, data }); },
    subscribe(topic, handler) { return () => {}; },
    _published: published,
  };
}

/**
 * 填充成本历史 (用于计算 avgCostPerTurn)
 * Populate cost history (for avgCostPerTurn calculation)
 *
 * @param {BudgetForecaster} forecaster
 * @param {number} count - turn 数
 * @param {number} costPerTurn - 每 turn 成本
 */
function seedCosts(forecaster, count, costPerTurn) {
  for (let i = 1; i <= count; i++) {
    forecaster.recordCost(costPerTurn, i);
  }
}

// ── 测试 / Tests ────────────────────────────────────────────────────────────

describe('BudgetForecaster V7.0', () => {
  let forecaster;
  let messageBus;

  beforeEach(() => {
    messageBus = createMockBus();
    forecaster = new BudgetForecaster({
      messageBus,
      logger: silentLogger,
      config: { exhaustionWarningMultiplier: 1.2 },
    });
  });

  // ━━━ V7.0 §33: recommendDegradation ━━━
  describe('recommendDegradation', () => {
    it('预算充足时返回 null / returns null when budget is sufficient', () => {
      // avgCostPerTurn = 100, remainingPhases = 2, estimated = 100 * 2 * 3 = 600
      // ratio = 10000 / 600 = 16.67 >> 0.7 → null
      seedCosts(forecaster, 10, 100);
      const result = forecaster.recommendDegradation(10000, 2);
      expect(result).toBeNull();
    });

    it('中度紧张时返回 downgrade / returns downgrade when ratio < 0.7', () => {
      // avgCostPerTurn = 100, remainingPhases = 5, estimated = 100 * 5 * 3 = 1500
      // ratio = 800 / 1500 = 0.533 → downgrade
      seedCosts(forecaster, 10, 100);
      const result = forecaster.recommendDegradation(800, 5);

      expect(result).not.toBeNull();
      expect(result.action).toBe('downgrade');
      expect(result.targetModel).toBe('haiku');
      expect(result.reason).toContain('moderate shortage');
    });

    it('严重不足时返回 merge_phases / returns merge_phases when ratio < 0.3', () => {
      // avgCostPerTurn = 100, remainingPhases = 5, estimated = 100 * 5 * 3 = 1500
      // ratio = 200 / 1500 = 0.133 → merge_phases
      seedCosts(forecaster, 10, 100);
      const result = forecaster.recommendDegradation(200, 5);

      expect(result).not.toBeNull();
      expect(result.action).toBe('merge_phases');
      expect(result.targetModel).toBe('haiku');
      expect(result.reason).toContain('severe shortage');
    });

    it('无预算时返回 halt / returns halt when no budget', () => {
      seedCosts(forecaster, 5, 100);
      const result = forecaster.recommendDegradation(0, 3);

      expect(result).not.toBeNull();
      expect(result.action).toBe('halt');
      expect(result.reason).toBe('no_budget_or_phases');
    });

    it('无 phase 时返回 halt / returns halt when no phases', () => {
      seedCosts(forecaster, 5, 100);
      const result = forecaster.recommendDegradation(5000, 0);

      expect(result).not.toBeNull();
      expect(result.action).toBe('halt');
    });
  });

  // ━━━ V7.0 §32: priceTask ━━━
  describe('priceTask', () => {
    it('基于历史数据返回估算 tokens / returns estimated tokens based on complexity', () => {
      seedCosts(forecaster, 10, 200);
      // avgCost = 200, complexity = 0.5 → multiplier = 0.5 + 0.5*1.5 = 1.25
      // type = 'test' → typeMultiplier = 1.0
      // estimated = 200 * 1.25 * 1.0 = 250
      const result = forecaster.priceTask('test', 0.5);

      expect(result.estimatedTokens).toBe(250);
      expect(result.confidence).toBeGreaterThan(0);
      expect(result.costFactor).toBeCloseTo(1.25, 1);
    });

    it('应用任务类型乘数 — code 类型 / applies task type multipliers — code type', () => {
      seedCosts(forecaster, 10, 200);
      // avgCost = 200, complexity = 0.5 → complexityMul = 1.25
      // type = 'code' → typeMultiplier = 1.5
      // estimated = 200 * 1.25 * 1.5 = 375
      const result = forecaster.priceTask('code', 0.5);

      expect(result.estimatedTokens).toBe(375);
      expect(result.costFactor).toBeCloseTo(1.875, 1);
    });

    it('应用任务类型乘数 — architect 类型 / applies task type multipliers — architect type', () => {
      seedCosts(forecaster, 10, 200);
      // avgCost = 200, complexity = 0.5 → complexityMul = 1.25
      // type = 'architect' → typeMultiplier = 2.0
      // estimated = 200 * 1.25 * 2.0 = 500
      const result = forecaster.priceTask('architect', 0.5);

      expect(result.estimatedTokens).toBe(500);
    });

    it('应用任务类型乘数 — review 类型 / applies task type multipliers — review type', () => {
      seedCosts(forecaster, 10, 200);
      // avgCost = 200, complexity = 0.5 → complexityMul = 1.25
      // type = 'review' → typeMultiplier = 0.8
      // estimated = 200 * 1.25 * 0.8 = 200
      const result = forecaster.priceTask('review', 0.5);

      expect(result.estimatedTokens).toBe(200);
    });

    it('无历史数据时使用默认 1000 / uses default 1000 when no history', () => {
      // avgCost = 1000 (default), complexity = 0.5 → multiplier = 1.25
      // type = 'test' → typeMultiplier = 1.0
      // estimated = 1000 * 1.25 * 1.0 = 1250
      const result = forecaster.priceTask('test', 0.5);

      expect(result.estimatedTokens).toBe(1250);
      expect(result.confidence).toBe(0);
    });

    it('高复杂度产生更高估值 / high complexity yields higher estimate', () => {
      seedCosts(forecaster, 10, 200);
      const low = forecaster.priceTask('test', 0.2);
      const high = forecaster.priceTask('test', 0.9);

      expect(high.estimatedTokens).toBeGreaterThan(low.estimatedTokens);
    });

    it('未知任务类型使用默认乘数 1.0 / unknown task type uses default multiplier 1.0', () => {
      seedCosts(forecaster, 10, 200);
      const knownTest = forecaster.priceTask('test', 0.5);
      const unknown = forecaster.priceTask('unknown_type', 0.5);

      // test multiplier = 1.0, unknown multiplier = 1.0 → same result
      expect(unknown.estimatedTokens).toBe(knownTest.estimatedTokens);
    });
  });
});
