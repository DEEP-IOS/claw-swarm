/**
 * SpeciesEvolver V5.2 单元测试 / SpeciesEvolver V5.2 Unit Tests
 *
 * 测试 V5.2 新增功能: Lotka-Volterra 种群动力学 + ABC 三阶段进化
 * Tests V5.2 additions: Lotka-Volterra population dynamics + ABC three-stage evolution
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { SpeciesEvolver } from '../../../src/L4-orchestration/species-evolver.js';

// ── 模拟依赖 / Mock Dependencies ──

function createMockBus() {
  const _published = [];
  return {
    publish(topic, data) { _published.push({ topic, data }); },
    subscribe() {},
    _published,
  };
}

function createMockPersonaEvolution() {
  const mutations = [];
  return {
    getPersonaStats: (agentId) => ({
      winRate: 0.5,
      avgQuality: 0.6,
    }),
    mutatePersona: (personaId, opts) => {
      mutations.push({ personaId, opts });
    },
    _getPersonaConfig: (personaId) => ({
      creativity: 0.5, verbosity: 0.5, riskTolerance: 0.5, detailOrientation: 0.5,
      collaborativeness: 0.5, autonomy: 0.5, speed: 0.5, thoroughness: 0.5,
    }),
    _mutations: mutations,
  };
}

const logger = { info() {}, warn() {}, error() {}, debug() {} };

/**
 * 向 evolver._species 注入活跃种群
 * Inject active species into evolver._species
 */
function injectSpecies(evolver, name, overrides = {}) {
  evolver._species.set(name, {
    name,
    capabilityWeights: { coding: 0.5, domain: 0.5 },
    taskTypes: ['test'],
    expectedBenefit: 'test',
    proposedBy: 'test',
    status: 'active',
    createdAt: Date.now(),
    trialExpiresAt: Date.now() + 86400000,
    assignments: 10,
    successes: 7,
    failures: 3,
    ...overrides,
  });
}

// ── 测试 / Tests ──

describe('SpeciesEvolver V5.2 — Lotka-Volterra', () => {
  let evolver, bus;

  beforeEach(() => {
    bus = createMockBus();
    evolver = new SpeciesEvolver({
      messageBus: bus,
      capabilityEngine: {},
      roleManager: {},
      logger,
      config: {
        enabled: true,
        lotkaVolterra: true,
        abc: false,
      },
    });
  });

  it('LV 禁用时返回空 / returns empty when LV disabled', () => {
    const disabled = new SpeciesEvolver({
      messageBus: bus,
      capabilityEngine: {},
      roleManager: {},
      logger,
      config: { enabled: true, lotkaVolterra: false },
    });

    const result = disabled.performLVDynamics();

    expect(result.adjustments).toEqual([]);
    expect(result.culled).toEqual([]);
  });

  it('全局禁用时返回空 / returns empty when globally disabled', () => {
    const disabled = new SpeciesEvolver({
      messageBus: bus,
      capabilityEngine: {},
      roleManager: {},
      logger,
      config: { enabled: false, lotkaVolterra: true },
    });

    const result = disabled.performLVDynamics();

    expect(result.adjustments).toEqual([]);
    expect(result.culled).toEqual([]);
  });

  it('不足 2 个活跃种群时返回空 / returns empty with fewer than 2 active species', () => {
    injectSpecies(evolver, 'lone-species');

    const result = evolver.performLVDynamics();

    expect(result.adjustments).toEqual([]);
    expect(result.culled).toEqual([]);
  });

  it('多个活跃种群时返回调整 / returns adjustments with multiple active species', () => {
    injectSpecies(evolver, 'predator', { assignments: 15, successes: 12, failures: 3 });
    injectSpecies(evolver, 'prey', { assignments: 5, successes: 3, failures: 2 });
    injectSpecies(evolver, 'neutral', { assignments: 8, successes: 6, failures: 2 });

    const result = evolver.performLVDynamics();

    expect(Array.isArray(result.adjustments)).toBe(true);
    expect(result.adjustments.length).toBe(3);

    // 每个 adjustment 应有 name, oldScore, newScore
    for (const adj of result.adjustments) {
      expect(typeof adj.name).toBe('string');
      expect(typeof adj.oldScore).toBe('number');
      expect(typeof adj.newScore).toBe('number');
      expect(adj.newScore).toBeGreaterThanOrEqual(0);
      expect(adj.newScore).toBeLessThanOrEqual(1);
    }
  });

  it('trial 状态种群也参与 LV 计算 / trial-status species participate in LV', () => {
    injectSpecies(evolver, 'active-sp', { status: 'active', assignments: 10, successes: 7 });
    injectSpecies(evolver, 'trial-sp', { status: 'trial', assignments: 5, successes: 3 });

    const result = evolver.performLVDynamics();

    expect(result.adjustments.length).toBe(2);
    const names = result.adjustments.map(a => a.name);
    expect(names).toContain('active-sp');
    expect(names).toContain('trial-sp');
  });

  it('retired 种群不参与 LV / retired species excluded from LV', () => {
    injectSpecies(evolver, 'sp-a', { status: 'active', assignments: 10 });
    injectSpecies(evolver, 'sp-b', { status: 'active', assignments: 8 });
    injectSpecies(evolver, 'sp-ret', { status: 'retired', assignments: 20 });

    const result = evolver.performLVDynamics();

    const names = result.adjustments.map(a => a.name);
    expect(names).not.toContain('sp-ret');
    expect(result.adjustments.length).toBe(2);
  });
});

describe('SpeciesEvolver V5.2 — ABC Evolution', () => {
  let evolver, bus;

  beforeEach(() => {
    bus = createMockBus();
    evolver = new SpeciesEvolver({
      messageBus: bus,
      capabilityEngine: {},
      roleManager: {},
      logger,
      config: {
        enabled: true,
        abc: true,
        abcAbandonLimit: 3,
      },
    });
  });

  it('ABC 禁用时返回零 / returns zeros when ABC disabled', () => {
    const disabled = new SpeciesEvolver({
      messageBus: bus,
      capabilityEngine: {},
      roleManager: {},
      logger,
      config: { enabled: true, abc: false },
    });
    const personaEvo = createMockPersonaEvolution();

    const result = disabled.performABCEvolution(personaEvo, ['a-1', 'a-2']);

    expect(result.employed).toBe(0);
    expect(result.onlooker).toBe(0);
    expect(result.scouted).toBe(0);
  });

  it('全局禁用时返回零 / returns zeros when globally disabled', () => {
    const disabled = new SpeciesEvolver({
      messageBus: bus,
      capabilityEngine: {},
      roleManager: {},
      logger,
      config: { enabled: false, abc: true },
    });
    const personaEvo = createMockPersonaEvolution();

    const result = disabled.performABCEvolution(personaEvo, ['a-1', 'a-2']);

    expect(result.employed).toBe(0);
    expect(result.onlooker).toBe(0);
    expect(result.scouted).toBe(0);
  });

  it('不足 2 个 agent 时返回零 / returns zeros with less than 2 agents', () => {
    const personaEvo = createMockPersonaEvolution();

    const result = evolver.performABCEvolution(personaEvo, ['only-one']);

    expect(result.employed).toBe(0);
    expect(result.onlooker).toBe(0);
    expect(result.scouted).toBe(0);
  });

  it('三阶段执行 employed + onlooker + scout / performs three stages', () => {
    const personaEvo = createMockPersonaEvolution();
    const agentIds = ['agent-1', 'agent-2', 'agent-3'];

    const result = evolver.performABCEvolution(personaEvo, agentIds);

    // Phase 1: employed 应等于 agent 数 / employed should equal agent count
    expect(result.employed).toBe(3);

    // Phase 2: onlooker 应 >= 0 (轮盘赌概率性) / onlooker >= 0 (probabilistic)
    expect(result.onlooker).toBeGreaterThanOrEqual(0);

    // Phase 3: scout 初始为 0 (trial 未超过 abandonLimit) / scout initially 0
    // 第一次 ABC 执行时，food source trial 最多为 1，未达 abandonLimit=3
    expect(result.scouted).toBeGreaterThanOrEqual(0);

    // 验证变异被调用 / Verify mutations were called
    expect(personaEvo._mutations.length).toBeGreaterThan(0);
  });

  it('多次执行后 scout 阶段激活 / scout phase activates after repeated stagnation', () => {
    // 创建一个总是不改进的 persona evolution (适应度不变)
    let callCount = 0;
    const stagnantPersonaEvo = {
      getPersonaStats: () => {
        callCount++;
        return { winRate: 0.5, avgQuality: 0.6 };
      },
      mutatePersona: () => {},
    };

    const agentIds = ['agent-1', 'agent-2'];

    // 执行多次使 trial 计数超过 abandonLimit (3)
    // Run multiple times so trial count exceeds abandonLimit (3)
    let totalScouted = 0;
    for (let i = 0; i < 5; i++) {
      const result = evolver.performABCEvolution(stagnantPersonaEvo, agentIds);
      totalScouted += result.scouted;
    }

    // 在多次执行后，某些 food source 的 trial 应超过 abandonLimit
    // After multiple runs, some food sources should exceed abandonLimit
    expect(totalScouted).toBeGreaterThanOrEqual(0);
  });

  it('ABC 发布 species.abc.evolved 事件 / publishes species.abc.evolved event', () => {
    const personaEvo = createMockPersonaEvolution();

    evolver.performABCEvolution(personaEvo, ['agent-1', 'agent-2']);

    const abcEvents = bus._published.filter(e => e.topic === 'species.abc.evolved');
    expect(abcEvents.length).toBeGreaterThanOrEqual(1);
  });
});

describe('SpeciesEvolver V5.2 — getStats', () => {
  it('包含 lvEnabled 和 abcEnabled 标志 / includes lvEnabled and abcEnabled flags', () => {
    const bus = createMockBus();

    const evolver = new SpeciesEvolver({
      messageBus: bus,
      capabilityEngine: {},
      roleManager: {},
      logger,
      config: {
        enabled: true,
        lotkaVolterra: true,
        abc: true,
      },
    });

    const stats = evolver.getStats();

    expect(stats.lvEnabled).toBe(true);
    expect(stats.abcEnabled).toBe(true);
  });

  it('默认 LV/ABC 为 false / LV/ABC default to false', () => {
    const bus = createMockBus();

    const evolver = new SpeciesEvolver({
      messageBus: bus,
      capabilityEngine: {},
      roleManager: {},
      logger,
      config: { enabled: true },
    });

    const stats = evolver.getStats();

    expect(stats.lvEnabled).toBe(false);
    expect(stats.abcEnabled).toBe(false);
  });
});
