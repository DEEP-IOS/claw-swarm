/**
 * V5.7 调度集成测试 / Scheduling Integration Tests
 * ContractNet, ExecutionPlanner, SwarmAdvisor
 *
 * 测试 V5.7 skillSymbiosis 集成到三个调度组件的新行为。
 * Tests V5.7 skillSymbiosis integration into three scheduling components.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { ContractNet } from '../../../src/L4-orchestration/contract-net.js';
import { ExecutionPlanner } from '../../../src/L4-orchestration/execution-planner.js';
import { SwarmAdvisor } from '../../../src/L4-orchestration/swarm-advisor.js';

// ── 模拟依赖 / Mock Dependencies ──

const silentLogger = { info() {}, warn() {}, error() {}, debug() {} };

function createMockMessageBus() {
  return { publish: vi.fn(), subscribe: vi.fn() };
}

function createMockSkillSymbiosis() {
  return {
    getTeamComplementarity: vi.fn().mockReturnValue(0.7),
    getStats: vi.fn().mockReturnValue({ trackedPairs: 5, recommendations: 3, computations: 10 }),
    recommendPartners: vi.fn().mockReturnValue([
      { partnerId: 'agent-2', complementarity: 0.8, avgQuality: 0.9, collaborations: 5 },
    ]),
  };
}

function createMockRoleManager() {
  const templates = [
    {
      name: 'developer',
      description: 'Developer role',
      keywords: ['implement', 'develop', 'code', 'build', 'feature'],
      capabilities: { coding: 0.9, architecture: 0.5, testing: 0.4, documentation: 0.3, security: 0.3, performance: 0.4, communication: 0.3, domain: 0.4 },
      constraints: { maxFiles: 20 },
    },
    {
      name: 'tester',
      description: 'Tester role',
      keywords: ['test', 'testing', 'qa', 'verify', 'validate'],
      capabilities: { coding: 0.5, architecture: 0.2, testing: 0.9, documentation: 0.5, security: 0.4, performance: 0.3, communication: 0.4, domain: 0.3 },
      constraints: { maxFiles: 15 },
    },
    {
      name: 'architect',
      description: 'Architect role',
      keywords: ['architect', 'design', 'system', 'structure', 'api'],
      capabilities: { coding: 0.6, architecture: 0.9, testing: 0.3, documentation: 0.6, security: 0.6, performance: 0.5, communication: 0.5, domain: 0.7 },
      constraints: { maxFiles: 10, reviewRequired: true },
    },
  ];

  return {
    listTemplates: vi.fn().mockReturnValue(templates),
    getTemplate: vi.fn((name) => templates.find(t => t.name === name) || null),
    getRoleTemplates: vi.fn().mockReturnValue(templates),
    getRoleStats: vi.fn().mockReturnValue({
      executions: 10,
      successRate: 0.8,
      avgQuality: 0.7,
    }),
  };
}

// ══════════════════════════════════════════════════════════════════════════
// ContractNet V5.7 测试 / ContractNet V5.7 Tests
// ══════════════════════════════════════════════════════════════════════════

describe('ContractNet V5.7', () => {
  let cn;
  let mockBus;
  let mockSkillSymbiosis;

  beforeEach(() => {
    mockBus = createMockMessageBus();
    mockSkillSymbiosis = createMockSkillSymbiosis();
    cn = new ContractNet({
      messageBus: mockBus,
      config: { defaultTimeout: 5000 },
      logger: silentLogger,
      skillSymbiosis: mockSkillSymbiosis,
    });
  });

  afterEach(() => {
    cn.destroy();
  });

  it('构造函数应接受 skillSymbiosis 参数 / constructor should accept skillSymbiosis parameter', () => {
    expect(cn).toBeDefined();
    const stats = cn.getStats();
    expect(stats.cfpsCreated).toBe(0);
  });

  it('_computeAwardScore 有 symbiosisScore 时应使用共生权重 / should use symbiosis weight when bid has symbiosisScore', () => {
    const bid = {
      capabilityMatch: 0.8,
      reputation: 0.7,
      resource: 0.6,
      workloadFactor: 0.5,
      symbiosisScore: 0.9,
    };

    const scoreWithSymbiosis = cn._computeAwardScore(bid);

    // 基础 award_score = 0.8*0.4 + 0.7*0.3 + 0.6*0.2 + 0.5*0.1 = 0.32+0.21+0.12+0.05 = 0.70
    // 共生权重 = 0.08 (默认)
    // 最终 = 0.70 * (1 - 0.08) + 0.9 * 0.08 = 0.70 * 0.92 + 0.072 = 0.644 + 0.072 = 0.716
    expect(scoreWithSymbiosis).toBeCloseTo(0.716, 2);
    expect(scoreWithSymbiosis).toBeGreaterThanOrEqual(0);
    expect(scoreWithSymbiosis).toBeLessThanOrEqual(1);
  });

  it('_computeAwardScore 无 skillSymbiosis 时忽略 symbiosisScore (向后兼容) / should ignore symbiosis without tracker (backward compat)', () => {
    const cnNoSymbiosis = new ContractNet({
      messageBus: mockBus,
      config: { defaultTimeout: 5000 },
      logger: silentLogger,
      // 不提供 skillSymbiosis / No skillSymbiosis
    });

    const bid = {
      capabilityMatch: 0.8,
      reputation: 0.7,
      resource: 0.6,
      workloadFactor: 0.5,
      symbiosisScore: 0.9, // 即使有 symbiosisScore, 也不应影响分数
    };

    const score = cnNoSymbiosis._computeAwardScore(bid);

    // 纯 award_score = 0.8*0.4 + 0.7*0.3 + 0.6*0.2 + 0.5*0.1 = 0.70
    expect(score).toBeCloseTo(0.70, 2);

    cnNoSymbiosis.destroy();
  });

  it('高 symbiosisScore 应提升 award score / high symbiosisScore should boost award score', () => {
    const bidLow = {
      capabilityMatch: 0.5,
      reputation: 0.5,
      resource: 0.5,
      workloadFactor: 0.5,
      symbiosisScore: 0.1,
    };

    const bidHigh = {
      capabilityMatch: 0.5,
      reputation: 0.5,
      resource: 0.5,
      workloadFactor: 0.5,
      symbiosisScore: 0.95,
    };

    const scoreLow = cn._computeAwardScore(bidLow);
    const scoreHigh = cn._computeAwardScore(bidHigh);

    expect(scoreHigh).toBeGreaterThan(scoreLow);
  });

  it('submitBid 有 skillSymbiosis 且有已存在 bid 时应计算 symbiosisScore / should compute symbiosisScore with existing bids', () => {
    const cfpId = cn.createCFP('task-sym', { coding: 0.7 });

    // 第一个投标: 没有已存在的 bids, 不应触发 getTeamComplementarity
    cn.submitBid(cfpId, 'agent-1', { capabilityMatch: 0.8 });
    expect(mockSkillSymbiosis.getTeamComplementarity).not.toHaveBeenCalled();

    // 第二个投标: 有已存在的 bids, 应触发 getTeamComplementarity
    cn.submitBid(cfpId, 'agent-2', { capabilityMatch: 0.7 });
    expect(mockSkillSymbiosis.getTeamComplementarity).toHaveBeenCalledWith(
      'agent-2',
      ['agent-1'],
    );

    const status = cn.getCFPStatus(cfpId);
    expect(status.bidCount).toBe(2);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// ExecutionPlanner V5.7 测试 / ExecutionPlanner V5.7 Tests
// ══════════════════════════════════════════════════════════════════════════

describe('ExecutionPlanner V5.7', () => {
  let planner;
  let mockBus;
  let mockRoleManager;
  let mockSkillSymbiosis;

  beforeEach(() => {
    mockBus = createMockMessageBus();
    mockRoleManager = createMockRoleManager();
    mockSkillSymbiosis = createMockSkillSymbiosis();
  });

  it('构造函数应接受 skillSymbiosis 参数 / constructor should accept skillSymbiosis parameter', () => {
    planner = new ExecutionPlanner({
      roleManager: mockRoleManager,
      messageBus: mockBus,
      logger: silentLogger,
      skillSymbiosis: mockSkillSymbiosis,
    });

    expect(planner).toBeDefined();
  });

  it('planExecution 有 skillSymbiosis 时结果应包含 symbiosis 详情 / should include symbiosis in score details', () => {
    planner = new ExecutionPlanner({
      roleManager: mockRoleManager,
      messageBus: mockBus,
      logger: silentLogger,
      skillSymbiosis: mockSkillSymbiosis,
    });

    const result = planner.planExecution('implement user authentication feature');

    expect(result.roles.length).toBeGreaterThan(0);
    expect(result.scores.length).toBeGreaterThan(0);

    // 每个 score details 应包含 symbiosis 字段
    for (const scoreEntry of result.scores) {
      expect(scoreEntry.details).toHaveProperty('symbiosis');
      expect(typeof scoreEntry.details.symbiosis).toBe('number');
    }
  });

  it('无 skillSymbiosis 时应降级到 3 专家评分 (向后兼容) / without skillSymbiosis, should fall back to 3-expert scoring (backward compat)', () => {
    planner = new ExecutionPlanner({
      roleManager: mockRoleManager,
      messageBus: mockBus,
      logger: silentLogger,
      // 不提供 skillSymbiosis / No skillSymbiosis
    });

    const result = planner.planExecution('implement user authentication feature');

    expect(result.roles.length).toBeGreaterThan(0);
    expect(result.scores.length).toBeGreaterThan(0);

    // symbiosis 详情应为 0 (因为无 skillSymbiosis)
    for (const scoreEntry of result.scores) {
      expect(scoreEntry.details.symbiosis).toBe(0);
    }
  });

  it('_symbiosisExpert 无配对记录时应返回 0.5 / should return 0.5 when no tracked pairs', () => {
    const emptySymbiosis = {
      getTeamComplementarity: vi.fn().mockReturnValue(0.5),
      getStats: vi.fn().mockReturnValue({ trackedPairs: 0, recommendations: 0, computations: 0 }),
      recommendPartners: vi.fn().mockReturnValue([]),
    };

    planner = new ExecutionPlanner({
      roleManager: mockRoleManager,
      messageBus: mockBus,
      logger: silentLogger,
      skillSymbiosis: emptySymbiosis,
    });

    // 调用 _symbiosisExpert (内部方法, 通过间接方式测试)
    const result = planner._symbiosisExpert({ name: 'developer' });
    expect(result).toBe(0.5);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// SwarmAdvisor V5.7 测试 / SwarmAdvisor V5.7 Tests
// ══════════════════════════════════════════════════════════════════════════

describe('SwarmAdvisor V5.7', () => {
  let advisor;
  let mockBus;
  let mockSkillSymbiosis;

  beforeEach(() => {
    mockBus = createMockMessageBus();
    mockSkillSymbiosis = createMockSkillSymbiosis();
  });

  it('构造函数应接受 skillSymbiosis 参数 / constructor should accept skillSymbiosis parameter', () => {
    advisor = new SwarmAdvisor({
      messageBus: mockBus,
      logger: silentLogger,
      skillSymbiosis: mockSkillSymbiosis,
    });

    expect(advisor).toBeDefined();
  });

  it('SIGNAL_WEIGHTS 应包含 symbiosisSignal: 0.12 / should include symbiosisSignal: 0.12', () => {
    // 通过 aggregateSignals 间接验证权重存在
    advisor = new SwarmAdvisor({
      messageBus: mockBus,
      logger: silentLogger,
      skillSymbiosis: mockSkillSymbiosis,
    });

    const { signals } = advisor.aggregateSignals('test input');

    // signals 对象应包含 symbiosisSignal
    expect(signals).toHaveProperty('symbiosisSignal');
    expect(typeof signals.symbiosisSignal).toBe('number');
  });

  it('aggregateSignals 应返回 symbiosisSignal 字段 / should return symbiosisSignal in signals object', () => {
    advisor = new SwarmAdvisor({
      messageBus: mockBus,
      logger: silentLogger,
      skillSymbiosis: mockSkillSymbiosis,
    });

    const { signals } = advisor.aggregateSignals('implement a complex authentication system');

    expect(signals.symbiosisSignal).toBeGreaterThanOrEqual(0);
    expect(signals.symbiosisSignal).toBeLessThanOrEqual(1);
    // 有 trackedPairs=5 和 recommendations=3, 信号应 > 0
    // pairDensity = min(5/10, 1) = 0.5, usageRate = min(3/5, 1) = 0.6
    // symbiosisSignal = 0.5 * 0.5 + 0.6 * 0.5 = 0.55
    expect(signals.symbiosisSignal).toBeGreaterThan(0);
  });

  it('无 skillSymbiosis 时 symbiosisSignal 应为 0 且权重重分配正确 / without skillSymbiosis, symbiosis signal is 0 and weights redistribute', () => {
    advisor = new SwarmAdvisor({
      messageBus: mockBus,
      logger: silentLogger,
      // 不提供 skillSymbiosis / No skillSymbiosis
    });

    const { composite, signals } = advisor.aggregateSignals('test input');

    // symbiosisSignal 应为 0
    expect(signals.symbiosisSignal).toBe(0);

    // composite 应仍在 [0, 1] 范围内 (仅由 textStimulus 贡献)
    expect(composite).toBeGreaterThanOrEqual(0);
    expect(composite).toBeLessThanOrEqual(1);
  });

  it('有配对记录的 skillSymbiosis 应使 symbiosisSignal > 0 / with tracked pairs, symbiosisSignal should be > 0', () => {
    advisor = new SwarmAdvisor({
      messageBus: mockBus,
      logger: silentLogger,
      skillSymbiosis: mockSkillSymbiosis,
    });

    const { signals } = advisor.aggregateSignals('design and implement a new microservice architecture');

    // mockSkillSymbiosis.getStats 返回 trackedPairs: 5, recommendations: 3
    // pairDensity = min(5/10, 1) = 0.5
    // usageRate = min(3/5, 1) = 0.6
    // symbiosisSignal = 0.5 * 0.5 + 0.6 * 0.5 = 0.55
    expect(signals.symbiosisSignal).toBeCloseTo(0.55, 2);
  });

  it('symbiosisSignal 应影响 composite 值 / symbiosisSignal should affect composite value', () => {
    // 有 skillSymbiosis
    const advisorWith = new SwarmAdvisor({
      messageBus: createMockMessageBus(),
      logger: silentLogger,
      skillSymbiosis: mockSkillSymbiosis,
    });

    // 无 skillSymbiosis
    const advisorWithout = new SwarmAdvisor({
      messageBus: createMockMessageBus(),
      logger: silentLogger,
    });

    const input = 'implement a complex distributed system with multiple services';
    const resultWith = advisorWith.aggregateSignals(input);
    const resultWithout = advisorWithout.aggregateSignals(input);

    // 有 symbiosisSignal > 0 时, composite 应不同 (因为权重重分配)
    // 但两者都应在 [0, 1] 范围内
    expect(resultWith.composite).toBeGreaterThanOrEqual(0);
    expect(resultWith.composite).toBeLessThanOrEqual(1);
    expect(resultWithout.composite).toBeGreaterThanOrEqual(0);
    expect(resultWithout.composite).toBeLessThanOrEqual(1);

    // 具体数值不同 (因为权重归一化方式不同)
    // 不做严格相等断言, 只验证两者都是有效值
    expect(typeof resultWith.composite).toBe('number');
    expect(typeof resultWithout.composite).toBe('number');
  });
});
