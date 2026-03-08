/**
 * CapabilityEngine 单元测试 / CapabilityEngine Unit Tests
 *
 * 使用真实 DatabaseManager + 内存 SQLite 测试 8D 能力评估 + PARL 奖励。
 * Uses real DatabaseManager + in-memory SQLite to test 8D capability assessment + PARL reward.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DatabaseManager } from '../../../src/L1-infrastructure/database/database-manager.js';
import { TABLE_SCHEMAS } from '../../../src/L1-infrastructure/schemas/database-schemas.js';
import { AgentRepository } from '../../../src/L1-infrastructure/database/repositories/agent-repo.js';
import { CapabilityEngine } from '../../../src/L3-agent/capability-engine.js';

// 静默 logger / Silent logger
const silentLogger = { info() {}, warn() {}, error() {}, debug() {} };

// 静默消息总线 / Silent message bus (records emitted events)
const createMockBus = () => {
  const events = [];
  return { emit(name, data) { events.push({ name, data }); }, events };
};

describe('CapabilityEngine', () => {
  let dbManager, agentRepo, messageBus, engine;

  beforeEach(() => {
    // 创建内存数据库并初始化所有表 / Create in-memory DB and bootstrap all tables
    dbManager = new DatabaseManager({ memory: true });
    dbManager.open(TABLE_SCHEMAS);
    agentRepo = new AgentRepository(dbManager);
    messageBus = createMockBus();
    engine = new CapabilityEngine({ agentRepo, messageBus, logger: silentLogger });
  });

  afterEach(() => { dbManager.close(); });

  // ━━━ 1. 默认档案 / Default Profile ━━━
  describe('getCapabilityProfile', () => {
    it('新 agent 应返回 8 个维度默认分 50 / should return default scores (50) for new agent', () => {
      const agentId = agentRepo.createAgent({ name: 'test-agent', role: 'coder' });

      const profile = engine.getCapabilityProfile(agentId);

      // 8 个维度都应存在, 默认分 50 / All 8 dimensions present, default 50
      const dims = ['coding', 'architecture', 'testing', 'documentation',
        'security', 'performance', 'communication', 'domain'];
      for (const dim of dims) {
        expect(profile[dim]).toBe(50);
      }
      expect(Object.keys(profile)).toHaveLength(8);
    });
  });

  // ━━━ 2. 更新并回读 / Update + Read Back ━━━
  describe('updateCapability', () => {
    it('应正确存储并读取分数 / should store score and read it back correctly', () => {
      const agentId = agentRepo.createAgent({ name: 'updater', role: 'coder' });
      // 先初始化, 确保行存在 / Initialize to ensure rows exist
      engine.initializeProfile(agentId);

      engine.updateCapability(agentId, 'coding', 85);
      engine.updateCapability(agentId, 'security', 72.5);

      const profile = engine.getCapabilityProfile(agentId);
      expect(profile.coding).toBe(85);
      expect(profile.security).toBe(72.5);
      // 其他维度保持默认 / Other dimensions remain default
      expect(profile.architecture).toBe(50);
    });
  });

  // ━━━ 3. 匹配分计算 / Compute Match ━━━
  describe('computeMatch', () => {
    it('能力满足需求时应返回高匹配分 / should return high score when capabilities meet requirements', () => {
      const capabilities = { coding: 80, architecture: 70, testing: 60 };
      const requirements = { coding: 80, architecture: 70 };

      const match = engine.computeMatch(capabilities, requirements);

      // 完全满足 → 匹配分接近 1.0 / Fully met → score near 1.0
      expect(match).toBeCloseTo(1.0, 1);
    });

    it('能力不足时应返回较低匹配分 / should return lower score when capabilities are below requirements', () => {
      const capabilities = { coding: 30, architecture: 20 };
      const requirements = { coding: 80, architecture: 80 };

      const match = engine.computeMatch(capabilities, requirements);

      // 30/80 ≈ 0.375, 20/80 = 0.25 → 加权平均 < 0.5
      expect(match).toBeLessThan(0.5);
    });

    it('无需求维度应返回中性分 0.5 / should return 0.5 when no requirements specified', () => {
      const match = engine.computeMatch({ coding: 80 }, {});
      expect(match).toBe(0.5);
    });
  });

  // ━━━ 4. PARL 权重三阶段 / PARL Weights — Three Phases ━━━
  describe('getPARLWeights', () => {
    it('探索期 (<30%): speedWeight=0.7, qualityWeight=0.3 / exploration phase', () => {
      const w = engine.getPARLWeights(15);
      expect(w.phase).toBe('exploration');
      expect(w.speedWeight).toBe(0.7);
      expect(w.qualityWeight).toBe(0.3);
    });

    it('收敛期 (30-70%): speedWeight=0.4, qualityWeight=0.6 / convergence phase', () => {
      const w = engine.getPARLWeights(50);
      expect(w.phase).toBe('convergence');
      expect(w.speedWeight).toBe(0.4);
      expect(w.qualityWeight).toBe(0.6);
    });

    it('开发期 (>70%): speedWeight=0.2, qualityWeight=0.8 / exploitation phase', () => {
      const w = engine.getPARLWeights(85);
      expect(w.phase).toBe('exploitation');
      expect(w.speedWeight).toBe(0.2);
      expect(w.qualityWeight).toBe(0.8);
    });
  });

  // ━━━ 5. PARL 奖励计算 / PARL Reward Computation ━━━
  describe('computePARLReward', () => {
    it('探索期: 速度权重更高 / exploration: speed weighted higher', () => {
      // speed=0.8, quality=0.4, progress=10% → 0.7×0.8 + 0.3×0.4 = 0.68
      const reward = engine.computePARLReward({ speed: 0.8, quality: 0.4 }, 10);
      expect(reward).toBeCloseTo(0.68, 2);
    });

    it('开发期: 质量权重更高 / exploitation: quality weighted higher', () => {
      // speed=0.8, quality=0.4, progress=80% → 0.2×0.8 + 0.8×0.4 = 0.48
      const reward = engine.computePARLReward({ speed: 0.8, quality: 0.4 }, 80);
      expect(reward).toBeCloseTo(0.48, 2);
    });

    it('收敛期: 均衡权重 / convergence: balanced weights', () => {
      // speed=0.6, quality=0.6, progress=50% → 0.4×0.6 + 0.6×0.6 = 0.6
      const reward = engine.computePARLReward({ speed: 0.6, quality: 0.6 }, 50);
      expect(reward).toBeCloseTo(0.6, 2);
    });
  });

  // ━━━ 6. 评估 / Evaluate ━━━
  describe('evaluate', () => {
    it('任务成功后应更新对应维度分数 / should update dimension score after successful task', () => {
      const agentId = agentRepo.createAgent({ name: 'eval-agent', role: 'coder' });
      engine.initializeProfile(agentId);

      const result = engine.evaluate(agentId, {
        taskType: 'coding',
        success: true,
        quality: 0.9,
        speed: 0.7,
        complexity: 5,
        progressPercent: 50,
      });

      // coding 维度应高于初始 50 / coding dimension should be above initial 50
      expect(result.dimensions.coding).toBeGreaterThan(50);
      expect(result.overallScore).toBeGreaterThan(0);

      // 持久化验证: 从 DB 重新读取 / Persistence check: re-read from DB
      engine.clearCache(agentId);
      const freshProfile = engine.getCapabilityProfile(agentId);
      expect(freshProfile.coding).toBeGreaterThan(50);
    });

    it('任务失败应降低分数 / failed task should decrease score', () => {
      const agentId = agentRepo.createAgent({ name: 'fail-agent', role: 'coder' });
      engine.initializeProfile(agentId);

      const result = engine.evaluate(agentId, {
        taskType: 'testing',
        success: false,
        quality: 0.3,
        speed: 0.5,
        complexity: 3,
        progressPercent: 20,
      });

      // testing 维度应低于初始 50 / testing dimension should be below initial 50
      expect(result.dimensions.testing).toBeLessThan(50);
    });
  });

  // ━━━ 7. 排名 / Top Agents Ranking ━━━
  describe('getTopAgents', () => {
    it('应按分数降序返回 agent / should return agents sorted by score descending', () => {
      // 创建 3 个 agent, 各有不同 coding 分 / Create 3 agents with different coding scores
      const a1 = agentRepo.createAgent({ name: 'low', role: 'coder' });
      const a2 = agentRepo.createAgent({ name: 'mid', role: 'coder' });
      const a3 = agentRepo.createAgent({ name: 'high', role: 'coder' });

      engine.initializeProfile(a1);
      engine.initializeProfile(a2);
      engine.initializeProfile(a3);

      engine.updateCapability(a1, 'coding', 30);
      engine.updateCapability(a2, 'coding', 60);
      engine.updateCapability(a3, 'coding', 95);

      const top = engine.getTopAgents('coding', 3);

      expect(top).toHaveLength(3);
      // 最高分排第一 / Highest score first
      expect(top[0].agentId).toBe(a3);
      expect(top[0].score).toBe(95);
      expect(top[1].agentId).toBe(a2);
      expect(top[2].agentId).toBe(a1);
    });

    it('未知维度应返回空数组 / unknown dimension should return empty array', () => {
      expect(engine.getTopAgents('nonexistent')).toEqual([]);
    });
  });
});
