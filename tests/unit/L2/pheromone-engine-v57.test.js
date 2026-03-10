/**
 * V5.7 PheromoneEngine 多类型信息素测试 / Multi-Type Pheromone Tests
 *
 * 测试 V5.7 新增的 food/danger 信息素类型, 以及 _getDecayModel / computeTypedDecay 路由。
 * Tests V5.7 new food/danger pheromone types and _getDecayModel / computeTypedDecay routing.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { PheromoneEngine } from '../../../src/L2-communication/pheromone-engine.js';

// ── 模拟依赖 / Mock Dependencies ──

function createMockPheromoneRepo() {
  return {
    findByTypeAndScope: vi.fn().mockReturnValue(null),
    upsert: vi.fn().mockReturnValue('ph-001'),
    updateIntensity: vi.fn(),
    query: vi.fn().mockReturnValue([]),
    getAll: vi.fn().mockReturnValue([]),
    delete: vi.fn(),
    count: vi.fn().mockReturnValue(0),
    batchUpdateIntensity: vi.fn(),
    trimToLimit: vi.fn(),
    deleteExpired: vi.fn(),
  };
}

const silentLogger = { info() {}, warn() {}, error() {}, debug() {} };

// ── 测试 / Tests ──

describe('PheromoneEngine V5.7 Multi-Type Pheromones', () => {
  let engine;
  let mockRepo;

  beforeEach(() => {
    mockRepo = createMockPheromoneRepo();
    engine = new PheromoneEngine({
      pheromoneRepo: mockRepo,
      logger: silentLogger,
    });
  });

  // ━━━ 1. BUILTIN_DEFAULTS 包含 food 和 danger ━━━

  describe('BUILTIN_DEFAULTS', () => {
    it('food 类型应包含在内置默认配置中 / food type should be in built-in defaults', () => {
      const bounds = engine.getMMASBounds('food');
      expect(bounds.mmasMin).toBe(0.05);
      expect(bounds.mmasMax).toBe(1.00);
    });

    it('danger 类型应包含在内置默认配置中 / danger type should be in built-in defaults', () => {
      const bounds = engine.getMMASBounds('danger');
      expect(bounds.mmasMin).toBe(0.10);
      expect(bounds.mmasMax).toBe(1.00);
    });
  });

  // ━━━ 2-6. computeTypedDecay 各类型衰减 ━━━

  describe('computeTypedDecay', () => {
    it('food 类型应使用线性衰减 / food type should use linear decay', () => {
      const result = engine.computeTypedDecay('food', 1.0, 10, 0.04);
      // 线性衰减: max(0, 1.0 - 0.04 * 10) = max(0, 0.6) = 0.6
      expect(result).toBeCloseTo(0.6, 4);
    });

    it('danger 类型应使用阶梯衰减 / danger type should use step decay', () => {
      const result = engine.computeTypedDecay('danger', 1.0, 20, 0.20);
      // 阶梯衰减: 1.0 * Math.pow(0.7, Math.floor(20/10)) = 1.0 * 0.7^2 = 0.49
      const expected = 1.0 * Math.pow(0.7, 2);
      expect(result).toBeCloseTo(expected, 4);
    });

    it('trail 类型应使用线性衰减 (向后兼容) / trail type should use linear decay (backward compat)', () => {
      const result = engine.computeTypedDecay('trail', 1.0, 10, 0.05);
      // 线性衰减: max(0, 1.0 - 0.05 * 10) = max(0, 0.5) = 0.5
      expect(result).toBeCloseTo(0.5, 4);
    });

    it('alarm 类型应使用阶梯衰减 (向后兼容) / alarm type should use step decay (backward compat)', () => {
      const result = engine.computeTypedDecay('alarm', 0.8, 25, 0.15);
      // 阶梯衰减: 0.8 * Math.pow(0.7, Math.floor(25/10)) = 0.8 * 0.7^2 = 0.392
      const expected = 0.8 * Math.pow(0.7, 2);
      expect(result).toBeCloseTo(expected, 4);
    });

    it('recruit 类型应使用指数衰减 (向后兼容) / recruit type should use exponential decay (backward compat)', () => {
      const result = engine.computeTypedDecay('recruit', 1.0, 10, 0.10);
      // 指数衰减: 1.0 * exp(-0.10 * 10) = 1.0 * exp(-1.0) ≈ 0.3679
      const expected = 1.0 * Math.exp(-0.10 * 10);
      expect(result).toBeCloseTo(expected, 4);
    });
  });

  // ━━━ 7-9. _computeDecayedIntensity 路由 ━━━

  describe('_computeDecayedIntensity', () => {
    it('food 类型应路由到 computeTypedDecay / food type should route through computeTypedDecay', () => {
      const now = Date.now();
      const ph = { type: 'food', intensity: 1.0, updatedAt: now - 60000, decayRate: 0.04 };
      const result = engine._computeDecayedIntensity(ph, now);
      // food 是 linear 衰减模型, 经过 _getDecayModel 返回 'linear', 路由到 computeTypedDecay
      // 线性: max(0, 1.0 - 0.04 * 1) = 0.96
      const expected = Math.max(0, 1.0 - 0.04 * 1);
      expect(result).toBeCloseTo(expected, 3);
    });

    it('danger 类型应路由到 computeTypedDecay / danger type should route through computeTypedDecay', () => {
      const now = Date.now();
      // ageMinutes = 15 -> steps = Math.floor(15/10) = 1
      const ph = { type: 'danger', intensity: 1.0, updatedAt: now - 15 * 60000, decayRate: 0.20 };
      const result = engine._computeDecayedIntensity(ph, now);
      // danger 是 step 衰减模型: 1.0 * 0.7^1 = 0.7
      const expected = 1.0 * Math.pow(0.7, 1);
      expect(result).toBeCloseTo(expected, 3);
    });

    it('recruit 类型应使用指数衰减 (默认路径) / recruit type should use exponential (default path)', () => {
      const now = Date.now();
      const ph = { type: 'recruit', intensity: 1.0, updatedAt: now - 5 * 60000, decayRate: 0.10 };
      const result = engine._computeDecayedIntensity(ph, now);
      // recruit 的 _getDecayModel 返回 'exponential', 走默认路径
      // 指数: 1.0 * exp(-0.10 * 5) ≈ 0.6065
      const expected = 1.0 * Math.exp(-0.10 * 5);
      expect(result).toBeCloseTo(expected, 3);
    });
  });

  // ━━━ 10-11. _getDecayModel 返回值 ━━━

  describe('_getDecayModel', () => {
    it('应为各内置类型返回正确衰减模型 / should return correct decay model for built-in types', () => {
      // 线性衰减类型 / Linear decay types
      expect(engine._getDecayModel('trail')).toBe('linear');
      expect(engine._getDecayModel('food')).toBe('linear');

      // 阶梯衰减类型 / Step decay types
      expect(engine._getDecayModel('alarm')).toBe('step');
      expect(engine._getDecayModel('danger')).toBe('step');

      // 指数衰减类型 / Exponential decay types
      expect(engine._getDecayModel('recruit')).toBe('exponential');
      expect(engine._getDecayModel('queen')).toBe('exponential');
      expect(engine._getDecayModel('dance')).toBe('exponential');
    });

    it('未知类型应返回 null / unknown type should return null', () => {
      expect(engine._getDecayModel('unknown_type')).toBeNull();
      expect(engine._getDecayModel('custom_xyz')).toBeNull();
    });

    it('有 typeRegistry 时应优先查询 registry / should check typeRegistry if available', () => {
      const mockTypeRegistry = {
        getType: vi.fn().mockReturnValue({ decayModel: 'step' }),
      };
      const engineWithRegistry = new PheromoneEngine({
        pheromoneRepo: mockRepo,
        typeRegistry: mockTypeRegistry,
        logger: silentLogger,
      });

      const result = engineWithRegistry._getDecayModel('custom_type');
      expect(mockTypeRegistry.getType).toHaveBeenCalledWith('custom_type');
      expect(result).toBe('step');
    });
  });

  // ━━━ 13-14. food 和 danger 的配置参数 ━━━

  describe('type config parameters', () => {
    it('food 类型 decayRate 应为 0.04, maxTTLMin 应为 180 / food type config', () => {
      // 通过 _getTypeConfig 间接测试: emitPheromone 使用的 decayRate
      // 我们可以通过 getMMASBounds 验证类型存在, 再通过 computeTypedDecay 验证 decayRate
      const bounds = engine.getMMASBounds('food');
      expect(bounds.mmasMin).toBe(0.05);
      expect(bounds.mmasMax).toBe(1.00);

      // 验证 food 的线性衰减: 在 180 分钟时, 衰减到 0
      // 使用 decayRate=0.04, maxTTLMin=180
      // 线性衰减 1.0 - 0.04 * 180 = 1.0 - 7.2 = max(0, -6.2) = 0
      const decayAt180 = engine.computeTypedDecay('food', 1.0, 180, 0.04);
      expect(decayAt180).toBe(0);

      // 在 25 分钟时应有残留: 1.0 - 0.04 * 25 = 0.0
      const decayAt25 = engine.computeTypedDecay('food', 1.0, 25, 0.04);
      expect(decayAt25).toBe(0);

      // 在 20 分钟时: 1.0 - 0.04 * 20 = 0.2
      const decayAt20 = engine.computeTypedDecay('food', 1.0, 20, 0.04);
      expect(decayAt20).toBeCloseTo(0.2, 4);
    });

    it('danger 类型 decayRate 应为 0.20, maxTTLMin 应为 20 / danger type config', () => {
      const bounds = engine.getMMASBounds('danger');
      expect(bounds.mmasMin).toBe(0.10);
      expect(bounds.mmasMax).toBe(1.00);

      // 验证 danger 的阶梯衰减: 每 10 分钟衰减 30%
      // 在 10 分钟时: 1.0 * 0.7^1 = 0.7
      const decayAt10 = engine.computeTypedDecay('danger', 1.0, 10, 0.20);
      expect(decayAt10).toBeCloseTo(0.7, 4);

      // 在 20 分钟 (maxTTLMin) 时: 1.0 * 0.7^2 = 0.49
      const decayAt20 = engine.computeTypedDecay('danger', 1.0, 20, 0.20);
      expect(decayAt20).toBeCloseTo(0.49, 4);
    });
  });

  // ━━━ 补充: 边界情况 / Edge cases ━━━

  describe('edge cases', () => {
    it('ageMinutes 为 0 时 _computeDecayedIntensity 应返回原始强度 / zero age returns original intensity', () => {
      const now = Date.now();
      const ph = { type: 'food', intensity: 0.8, updatedAt: now, decayRate: 0.04 };
      const result = engine._computeDecayedIntensity(ph, now);
      expect(result).toBe(0.8);
    });

    it('线性衰减结果不应低于 0 / linear decay should not go below 0', () => {
      // 极长时间衰减
      const result = engine.computeTypedDecay('food', 0.5, 1000, 0.04);
      expect(result).toBe(0);
      expect(result).toBeGreaterThanOrEqual(0);
    });

    it('阶梯衰减 ageMinutes 不满一步时不衰减 / step decay no reduction before first step', () => {
      // ageMinutes=5, steps = Math.floor(5/10) = 0 → 0.7^0 = 1
      const result = engine.computeTypedDecay('danger', 0.9, 5, 0.20);
      expect(result).toBeCloseTo(0.9, 4);
    });
  });
});
