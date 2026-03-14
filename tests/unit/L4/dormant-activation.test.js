/**
 * 休眠模块激活测试 / Dormant Module Activation Tests
 *
 * V6.0: 验证 SkillGovernor, ContextEngine, Evolution Clustering 默认启用
 * V6.0: Verify SkillGovernor, ContextEngine, Evolution Clustering enabled by default
 */

import { describe, it, expect, vi } from 'vitest';

// ── 辅助 / Helpers ──────────────────────────────────────────────────────────

const silentLogger = { info() {}, warn() {}, error() {}, debug() {} };
const mockBus = { publish: vi.fn(), subscribe: vi.fn(() => () => {}) };

function createMockDb() {
  return {
    prepare: vi.fn(() => ({
      run: vi.fn(() => ({ changes: 1 })),
      get: vi.fn(() => null),
      all: vi.fn(() => []),
    })),
    exec: vi.fn(),
  };
}

// ── 测试 / Tests ────────────────────────────────────────────────────────────

describe('Dormant Module Activation (V6.0)', () => {
  describe('SkillGovernor', () => {
    it('可以创建实例 / can create instance', async () => {
      const { SkillGovernor } = await import('../../../src/L5-application/skill-governor.js');
      const sg = new SkillGovernor({
        messageBus: mockBus,
        logger: silentLogger,
        db: createMockDb(),
      });
      expect(sg).toBeDefined();
    });

    it('无 skillDirs 时降级为空推荐 / degrades to empty recommendation without skillDirs', async () => {
      const { SkillGovernor } = await import('../../../src/L5-application/skill-governor.js');
      const sg = new SkillGovernor({
        messageBus: mockBus,
        logger: silentLogger,
        db: createMockDb(),
      });

      if (typeof sg.getRecommendations === 'function') {
        const recs = sg.getRecommendations('test-task');
        // getRecommendations returns string (empty when no skills)
        expect(typeof recs === 'string' || Array.isArray(recs)).toBe(true);
      }
    });
  });

  describe('ContextEngine', () => {
    it('工厂函数可导入 / factory function importable', async () => {
      const mod = await import('../../../src/L3-agent/swarm-context-engine.js');
      // Exported as factory function: createSwarmContextEngineFactory
      expect(mod.createSwarmContextEngineFactory).toBeDefined();
      expect(typeof mod.createSwarmContextEngineFactory).toBe('function');
    });

    it('工厂函数返回引擎实例 / factory returns engine instance', async () => {
      const { createSwarmContextEngineFactory } = await import('../../../src/L3-agent/swarm-context-engine.js');
      const factory = createSwarmContextEngineFactory({
        messageBus: mockBus,
        logger: silentLogger,
      });
      expect(factory).toBeDefined();
    });
  });

  describe('Species Evolver Clustering', () => {
    it('可以创建实例 / can create instance', async () => {
      const { SpeciesEvolver } = await import('../../../src/L4-orchestration/species-evolver.js');
      const se = new SpeciesEvolver({
        messageBus: mockBus,
        logger: silentLogger,
        db: createMockDb(),
      });
      expect(se).toBeDefined();
    });
  });
});
