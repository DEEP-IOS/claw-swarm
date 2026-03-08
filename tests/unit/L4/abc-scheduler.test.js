/**
 * ABCScheduler 单元测试 / ABCScheduler Unit Tests
 *
 * 无需真实数据库, 使用 mock 测试人工蜂群调度器。
 * No real DB needed, uses mocks to test Artificial Bee Colony scheduler.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { ABCScheduler } from '../../../src/L4-orchestration/abc-scheduler.js';

// 静默 logger / Silent logger
const silentLogger = { info() {}, warn() {}, error() {}, debug() {} };

// Mock MessageBus / 模拟消息总线
const mockBus = { publish() {}, subscribe() {} };

/**
 * 创建模拟 Agent 列表 / Create mock agent list
 * @param {number} count
 * @param {Object} [overrides] - 附加属性 / Additional properties per agent
 * @returns {Array<Object>}
 */
function createMockAgents(count, overrides = {}) {
  return Array.from({ length: count }, (_, i) => ({
    id: `agent-${i + 1}`,
    status: 'idle',
    taskId: null,
    performance: 0.5,
    ...overrides,
  }));
}

describe('ABCScheduler', () => {
  let scheduler;

  beforeEach(() => {
    scheduler = new ABCScheduler({
      messageBus: mockBus,
      config: {
        ratios: { employed: 0.50, onlooker: 0.45, scout: 0.05 },
        abandonThreshold: 5,
      },
      logger: silentLogger,
    });
  });

  // ━━━ 1. classifyAgents 分类比例 / divides into employed/onlooker/scout ratios ━━━
  describe('classifyAgents', () => {
    it('应按比例划分 employed / onlooker / scout / should divide agents by configured ratios', () => {
      // 部分 Agent 有任务 (模拟 busy) / Some agents have tasks (simulate busy)
      const agents = createMockAgents(20);
      agents[0].taskId = 'task-A';
      agents[0].status = 'busy';
      agents[1].taskId = 'task-B';
      agents[1].status = 'busy';

      const { employed, onlookers, scouts } = scheduler.classifyAgents(agents);

      // 总数应等于输入 / Total should equal input
      expect(employed.length + onlookers.length + scouts.length).toBe(20);

      // 至少应有 1 个侦察蜂 / At least 1 scout
      expect(scouts.length).toBeGreaterThanOrEqual(1);

      // employed 应 <= 50% 目标 / employed should be <= 50% target
      expect(employed.length).toBeLessThanOrEqual(10);
    });

    it('空数组应返回空分类 / empty array should return empty classification', () => {
      const { employed, onlookers, scouts } = scheduler.classifyAgents([]);
      expect(employed).toHaveLength(0);
      expect(onlookers).toHaveLength(0);
      expect(scouts).toHaveLength(0);
    });
  });

  // ━━━ 2. selectByQuality 轮盘赌选择 / roulette selection ━━━
  describe('selectByQuality', () => {
    it('应从候选列表中返回一个 / should return one of the candidates', () => {
      const solutions = [
        { id: 's1', quality: 0.3 },
        { id: 's2', quality: 0.6 },
        { id: 's3', quality: 0.9 },
      ];

      const selected = scheduler.selectByQuality(solutions);
      expect(selected).not.toBeNull();
      expect(solutions.map(s => s.id)).toContain(selected.id);
    });

    it('单元素应直接返回 / single element should return directly', () => {
      const selected = scheduler.selectByQuality([{ id: 'only', quality: 0.5 }]);
      expect(selected.id).toBe('only');
    });

    it('空数组应返回 null / empty array should return null', () => {
      expect(scheduler.selectByQuality([])).toBeNull();
      expect(scheduler.selectByQuality(null)).toBeNull();
    });
  });

  // ━━━ 3. shouldScout 判定 / false initially, true after threshold ━━━
  describe('shouldScout', () => {
    it('初始状态应返回 false / should return false initially', () => {
      expect(scheduler.shouldScout('agent-new')).toBe(false);
    });

    it('连续未改善超阈值后应返回 true / should return true after exceeding threshold', () => {
      const agentId = 'agent-stale';

      // 初始化状态 / Initialize state
      scheduler.recordResult(agentId, 0.5);

      // 连续记录不改善的结果 (fitness <= 当前值)
      // Record consecutive non-improving results
      for (let i = 0; i < 5; i++) {
        scheduler.recordResult(agentId, 0.3); // 低于 0.5, 不改善 / Below 0.5, no improvement
      }

      expect(scheduler.shouldScout(agentId)).toBe(true);
    });
  });

  // ━━━ 4. recordResult 适应度追踪 / tracks fitness improvement ━━━
  describe('recordResult', () => {
    it('改善时应重置 trialCount / should reset trialCount on improvement', () => {
      const agentId = 'agent-improve';

      // 初始记录 / Initial record
      scheduler.recordResult(agentId, 0.3);
      // 不改善两次 / Non-improvement twice
      scheduler.recordResult(agentId, 0.2);
      scheduler.recordResult(agentId, 0.1);

      // 此时 trialCount 应为 2 / trialCount should be 2
      expect(scheduler.shouldScout(agentId)).toBe(false);

      // 改善: 0.5 > 0.3 → 重置 / Improve: 0.5 > 0.3 → reset
      scheduler.recordResult(agentId, 0.5);

      // 不改善 1 次, 不应 scout / Non-improvement once, should not scout
      scheduler.recordResult(agentId, 0.4);
      expect(scheduler.shouldScout(agentId)).toBe(false);
    });

    it('达到放弃阈值时 abandonments 统计应增加 / abandonments stat should increase at threshold', () => {
      const agentId = 'agent-abandon';
      scheduler.recordResult(agentId, 0.5);

      for (let i = 0; i < 5; i++) {
        scheduler.recordResult(agentId, 0.1);
      }

      const stats = scheduler.getStats();
      expect(stats.abandonments).toBeGreaterThanOrEqual(1);
    });
  });

  // ━━━ 5. explore 随机探索 / returns valid food source ━━━
  describe('explore', () => {
    it('应返回有效的探索方案 / should return valid food source', () => {
      const solution = scheduler.explore();

      expect(solution).toBeDefined();
      expect(solution.id).toBeTruthy();
      expect(solution.quality).toBeGreaterThanOrEqual(0);
      expect(solution.quality).toBeLessThanOrEqual(1);
      expect(solution.exploredAt).toBeGreaterThan(0);
    });

    it('explorations 统计应递增 / explorations stat should increment', () => {
      scheduler.explore();
      scheduler.explore();

      const stats = scheduler.getStats();
      expect(stats.explorations).toBe(2);
    });
  });

  // ━━━ 6. assignTasks 任务分配 / assigns tasks to agents ━━━
  describe('assignTasks', () => {
    it('应将任务分配给 Agent / should assign tasks to agents', () => {
      const agents = createMockAgents(5);
      const tasks = [
        { id: 't1', status: 'pending', priority: 5 },
        { id: 't2', status: 'pending', priority: 8 },
        { id: 't3', status: 'pending', priority: 3 },
      ];

      const assignments = scheduler.assignTasks(agents, tasks);

      expect(assignments).toBeInstanceOf(Map);
      expect(assignments.size).toBeGreaterThan(0);

      // 每个分配应是 agentId → taskId / Each assignment should be agentId → taskId
      for (const [agentId, taskId] of assignments) {
        expect(agentId).toMatch(/^agent-/);
        expect(taskId).toMatch(/^t\d$/);
      }
    });

    it('空输入应返回空 Map / empty input should return empty Map', () => {
      expect(scheduler.assignTasks([], []).size).toBe(0);
      expect(scheduler.assignTasks(null, null).size).toBe(0);
    });

    it('iterations 统计应递增 / iterations stat should increment', () => {
      const agents = createMockAgents(3);
      const tasks = [{ id: 't1', status: 'pending', priority: 5 }];

      scheduler.assignTasks(agents, tasks);
      scheduler.assignTasks(agents, tasks);

      const stats = scheduler.getStats();
      expect(stats.iterations).toBe(2);
    });
  });
});
