/**
 * SpeciesEvolver 单元测试 / SpeciesEvolver Unit Tests
 *
 * 测试种群提议 + 试用期管理 + 淘汰 + GEP 锦标赛选择
 * Tests species proposal + trial management + culling + GEP tournament selection
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { SpeciesEvolver } from '../../../src/L4-orchestration/species-evolver.js';

// ── 模拟依赖 / Mock Dependencies ──

function createMockBus() {
  const _published = [];
  return {
    publish(topic, data) { _published.push({ topic, data }); },
    _published,
  };
}

function createMockCapabilityEngine() {
  return {
    getCapabilityProfile: () => ({
      coding: 60, architecture: 50, testing: 50, documentation: 50,
      security: 50, performance: 55, communication: 50, domain: 50,
    }),
    computeMatch: () => 0.7,
  };
}

function createMockRoleManager() {
  return {
    getAllTemplates: () => [
      {
        name: 'developer',
        capabilities: { coding: 0.9, architecture: 0.4, testing: 0.3, documentation: 0.2,
          security: 0.2, performance: 0.3, communication: 0.2, domain: 0.3 },
      },
      {
        name: 'reviewer',
        capabilities: { coding: 0.5, architecture: 0.6, testing: 0.8, documentation: 0.4,
          security: 0.7, performance: 0.3, communication: 0.3, domain: 0.2 },
      },
    ],
  };
}

function createMockPersonaEvolution() {
  const mutations = [];
  return {
    getPersonaStats: (agentId) => ({ winRate: agentId === 'agent-1' ? 0.8 : 0.4, executions: 10 }),
    mutatePersona: (personaId, opts) => {
      mutations.push({ personaId, opts });
      return { id: `${personaId}_mutated` };
    },
    _getPersonaConfig: (personaId) => ({
      creativity: 0.5, verbosity: 0.5, riskTolerance: 0.5, detailOrientation: 0.5,
      collaborativeness: 0.5, autonomy: 0.5, speed: 0.5, thoroughness: 0.5,
    }),
    _mutations: mutations,
  };
}

const logger = { info() {}, warn() {}, error() {}, debug() {} };

// ── 有效提议模板 / Valid Proposal Template ──

function validProposal(overrides = {}) {
  return {
    name: 'data-analyst',
    capabilityWeights: {
      coding: 0.3, architecture: 0.1, testing: 0.1, documentation: 0.2,
      security: 0.1, performance: 0.1, communication: 0.4, domain: 0.9,
    },
    taskTypes: ['analysis', 'reporting'],
    expectedBenefit: 'Specialized data analysis for financial tasks',
    historicalCases: [
      { task: 'Analyze stock data', outcome: 'success' },
      { task: 'Generate report', outcome: 'success' },
      { task: 'Clean dataset', outcome: 'success' },
    ],
    proposedBy: 'agent-queen',
    ...overrides,
  };
}

describe('SpeciesEvolver', () => {
  let evolver, bus;

  beforeEach(() => {
    bus = createMockBus();
    evolver = new SpeciesEvolver({
      messageBus: bus,
      capabilityEngine: createMockCapabilityEngine(),
      roleManager: createMockRoleManager(),
      logger,
      config: { enabled: true, gep: true },
    });
  });

  // ── 种群提议 / Species Proposal ──

  it('接受有效种群提议 / accepts valid species proposal', () => {
    const result = evolver.proposeSpecies(validProposal());
    expect(result.accepted).toBe(true);
    expect(result.speciesId).toBe('data-analyst');
  });

  it('拒绝无效种群名 / rejects invalid species name', () => {
    const result = evolver.proposeSpecies(validProposal({ name: 'invalid name!!' }));
    expect(result.accepted).toBe(false);
    expect(result.reason).toContain('Invalid species name');
  });

  it('拒绝重复种群名 / rejects duplicate species name', () => {
    evolver.proposeSpecies(validProposal());
    const result = evolver.proposeSpecies(validProposal());
    expect(result.accepted).toBe(false);
    expect(result.reason).toContain('already exists');
  });

  it('拒绝不足历史案例 / rejects insufficient historical cases', () => {
    const result = evolver.proposeSpecies(validProposal({
      historicalCases: [{ task: 'one' }],
    }));
    expect(result.accepted).toBe(false);
    expect(result.reason).toContain('3 historical cases');
  });

  it('拒绝无效能力权重 / rejects invalid capability weights', () => {
    const result = evolver.proposeSpecies(validProposal({
      capabilityWeights: { coding: 2.0 }, // 超过上限 / Exceeds max
    }));
    expect(result.accepted).toBe(false);
    expect(result.reason).toContain('out of range');
  });

  it('拒绝 L2 范数过小 / rejects weak L2 norm', () => {
    const result = evolver.proposeSpecies(validProposal({
      capabilityWeights: { coding: 0.05, architecture: 0.05 },
    }));
    expect(result.accepted).toBe(false);
    expect(result.reason).toContain('L2 norm');
  });

  it('拒绝与现有角色重叠过高 / rejects high overlap with existing role', () => {
    // 与 developer 重叠过高 / Too similar to developer
    const result = evolver.proposeSpecies(validProposal({
      name: 'coder-v2',
      capabilityWeights: {
        coding: 0.85, architecture: 0.35, testing: 0.3, documentation: 0.2,
        security: 0.2, performance: 0.3, communication: 0.2, domain: 0.3,
      },
    }));
    expect(result.accepted).toBe(false);
    expect(result.reason).toContain('Overlap');
  });

  it('禁用时拒绝提议 / rejects proposal when disabled', () => {
    const disabled = new SpeciesEvolver({
      messageBus: bus, capabilityEngine: createMockCapabilityEngine(),
      roleManager: createMockRoleManager(), logger,
      config: { enabled: false },
    });
    const result = disabled.proposeSpecies(validProposal());
    expect(result.accepted).toBe(false);
    expect(result.reason).toContain('disabled');
  });

  it('提议发布 species.proposed 事件 / publishes species.proposed event', () => {
    evolver.proposeSpecies(validProposal());
    const events = bus._published.filter(e =>
      e.topic === 'species.proposed' || e.topic?.includes?.('species'));
    expect(events.length).toBeGreaterThanOrEqual(1);
  });

  // ── 试用期管理 / Trial Period Management ──

  it('记录分配结果 / records assignment outcome', () => {
    evolver.proposeSpecies(validProposal());
    evolver.recordAssignment('data-analyst', true);
    evolver.recordAssignment('data-analyst', false);

    const species = evolver.getSpecies('data-analyst');
    expect(species.assignments).toBe(2);
    expect(species.successes).toBe(1);
    expect(species.failures).toBe(1);
  });

  it('满足条件提前转正 / early promotion when criteria met', () => {
    evolver.proposeSpecies(validProposal());
    // 3次成功 0次失败 = 100% 成功率 / 3 successes 0 failures = 100% success rate
    for (let i = 0; i < 3; i++) {
      evolver.recordAssignment('data-analyst', true);
    }

    const { promoted, retired } = evolver.evaluateTrials();
    expect(promoted).toContain('data-analyst');
    expect(retired.length).toBe(0);
  });

  it('试用期满低成功率退役 / retires on expired trial with low success rate', () => {
    evolver.proposeSpecies(validProposal());
    // 模拟试用期到期 / Simulate trial expiry
    const species = evolver._species.get('data-analyst');
    species.trialExpiresAt = Date.now() - 1000; // 已过期 / Expired
    species.assignments = 5;
    species.successes = 2; // 40% 成功率, 低于 70% / 40% success rate, below 70%
    species.failures = 3;

    const { promoted, retired } = evolver.evaluateTrials();
    expect(retired).toContain('data-analyst');
    expect(promoted.length).toBe(0);
  });

  // ── 进化淘汰 / Evolution Culling ──

  it('淘汰底部 20% 使用率种群 / culls bottom 20% by usage', () => {
    // 直接注入 5 个活跃种群（绕过 proposeSpecies 的重叠检查，聚焦测试淘汰逻辑）
    // Directly inject 5 active species (bypass overlap check, focus on culling logic)
    for (let i = 1; i <= 5; i++) {
      const name = `species-${i}`;
      evolver._species.set(name, {
        name,
        capabilityWeights: { coding: 0.1 * i + 0.1, domain: 0.1 + i * 0.15 },
        taskTypes: ['test'],
        expectedBenefit: 'test',
        proposedBy: 'test',
        status: 'active',
        createdAt: Date.now(),
        trialExpiresAt: Date.now() + 86400000,
        assignments: i * 10,
        successes: i * 8,
        failures: i * 2,
      });
    }

    const culled = evolver.performCulling();
    expect(culled.length).toBe(1); // 20% of 5 = 1
    expect(culled[0]).toBe('species-1'); // 最少分配的 / Least assigned
  });

  it('少于 3 个种群不淘汰 / no culling when fewer than 3 species', () => {
    evolver.proposeSpecies(validProposal());
    evolver._species.get('data-analyst').status = 'active';

    const culled = evolver.performCulling();
    expect(culled.length).toBe(0);
  });

  // ── GEP 锦标赛 / GEP Tournament ──

  it('GEP 锦标赛进化 / GEP tournament evolution', () => {
    const personaEvo = createMockPersonaEvolution();
    const result = evolver.performGEPEvolution(personaEvo, ['agent-1', 'agent-2']);
    expect(result.evolved).toBeGreaterThanOrEqual(0);
    expect(typeof result.stagnant).toBe('boolean');
  });

  it('GEP 禁用时不进化 / no evolution when GEP disabled', () => {
    const disabled = new SpeciesEvolver({
      messageBus: bus, capabilityEngine: createMockCapabilityEngine(),
      roleManager: createMockRoleManager(), logger,
      config: { enabled: true, gep: false },
    });
    const personaEvo = createMockPersonaEvolution();
    const result = disabled.performGEPEvolution(personaEvo, ['agent-1', 'agent-2']);
    expect(result.evolved).toBe(0);
  });

  it('不足 2 个 agent 时不进化 / no evolution with less than 2 agents', () => {
    const personaEvo = createMockPersonaEvolution();
    const result = evolver.performGEPEvolution(personaEvo, ['agent-1']);
    expect(result.evolved).toBe(0);
  });

  // ── 查询方法 / Query Methods ──

  it('listSpecies 返回种群列表 / returns species list', () => {
    evolver.proposeSpecies(validProposal());
    const list = evolver.listSpecies();
    expect(list.length).toBe(1);
    expect(list[0].name).toBe('data-analyst');
    expect(list[0].status).toBe('trial');
  });

  it('listSpecies 按状态过滤 / filters by status', () => {
    evolver.proposeSpecies(validProposal());
    const list = evolver.listSpecies({ status: 'active' });
    expect(list.length).toBe(0);
  });

  it('getStats 返回统计 / returns statistics', () => {
    evolver.proposeSpecies(validProposal());
    const stats = evolver.getStats();
    expect(stats.trial).toBe(1);
    expect(stats.active).toBe(0);
    expect(stats.total).toBe(1);
    expect(stats.gepEnabled).toBe(true);
  });

  it('getEvolutionLog 返回日志 / returns evolution log', () => {
    evolver.proposeSpecies(validProposal());
    const log = evolver.getEvolutionLog();
    expect(log.length).toBeGreaterThanOrEqual(1);
    expect(log[0].type).toBe('species_proposed');
  });

  // ── 生命周期 / Lifecycle ──

  it('destroy 清理所有状态 / clears all state', () => {
    evolver.proposeSpecies(validProposal());
    evolver.destroy();
    expect(evolver.listSpecies().length).toBe(0);
    expect(evolver.getStats().total).toBe(0);
  });
});
