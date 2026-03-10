/**
 * SpeculativeExecutor 单元测试 / SpeculativeExecutor Unit Tests
 *
 * 测试 L4 推测执行引擎的条件检查、首胜解析、生命周期管理。
 * Tests L4 speculative execution engine condition checks,
 * first-completion-wins resolution, and lifecycle management.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { SpeculativeExecutor } from '../../../src/L4-orchestration/speculative-executor.js';

// ── 辅助函数 / Helpers ──────────────────────────────────────────────────────

const silentLogger = { info() {}, warn() {}, error() {}, debug() {} };

/** 模拟 MessageBus / Mock MessageBus */
function createMockBus() {
  const published = [];
  return {
    publish(topic, data) { published.push({ topic, data }); },
    _published: published,
  };
}

/** 模拟 DAGEngine / Mock DAGEngine */
function createMockDagEngine({ nodes = [], agentQueues = new Map() } = {}) {
  return {
    getDAGSnapshot(dagId) {
      return { dagId, nodes };
    },
    _completionSet: new Map(),
    _agentQueues: agentQueues,
    auctionTask() {},
  };
}

/** 模拟 GlobalModulator / Mock GlobalModulator */
function createMockModulator(mode = 'EXPLORE') {
  return {
    getCurrentMode() { return mode; },
  };
}

/** 模拟 AgentRepository / Mock AgentRepository */
function createMockAgentRepo(agents = []) {
  return {
    listAgents() { return agents; },
  };
}

/**
 * 创建完整依赖集（带临界节点和空闲 Agent）
 * Create full dependency set with critical node and idle agents
 */
function createFullDeps(overrides = {}) {
  const idleAgents = overrides.agents || [
    { agent_id: 'agent-primary', status: 'active' },
    { agent_id: 'agent-idle-1', status: 'active' },
    { agent_id: 'agent-idle-2', status: 'active' },
  ];

  const nodes = overrides.nodes || [
    { id: 'task-1', isCritical: true, assignedAgent: 'agent-primary' },
  ];

  const agentQueues = overrides.agentQueues || new Map([
    ['agent-primary', ['some-task']],
  ]);

  return {
    dagEngine: createMockDagEngine({ nodes, agentQueues }),
    globalModulator: createMockModulator(overrides.mode || 'EXPLORE'),
    agentRepo: createMockAgentRepo(idleAgents),
    messageBus: createMockBus(),
    logger: silentLogger,
    config: overrides.config || {},
  };
}

// ── 测试 / Tests ────────────────────────────────────────────────────────────

describe('SpeculativeExecutor', () => {

  // ═══════════════════════════════════════════════════════════════════════════
  // 构造器 / Constructor
  // ═══════════════════════════════════════════════════════════════════════════

  describe('constructor 默认值 / constructor defaults', () => {
    it('使用默认配置初始化 / initializes with default config values', () => {
      const deps = createFullDeps();
      const executor = new SpeculativeExecutor(deps);
      const stats = executor.getStats();

      // 默认 maxPaths=2, budget=3
      expect(stats.maxPaths).toBe(2);
      expect(stats.budget).toBe(3);
      expect(stats.activeSpeculations).toBe(0);
      expect(stats.started).toBe(0);
      expect(stats.resolved).toBe(0);
      expect(stats.cancelled).toBe(0);
      expect(stats.savingsMs).toBe(0);
    });

    it('接受自定义配置 / accepts custom config', () => {
      const deps = createFullDeps({ config: { maxSpeculativePaths: 5, speculationBudget: 10 } });
      const executor = new SpeculativeExecutor(deps);
      const stats = executor.getStats();

      expect(stats.maxPaths).toBe(5);
      expect(stats.budget).toBe(10);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // maybeSpeculate 条件检查 / maybeSpeculate condition checks
  // ═══════════════════════════════════════════════════════════════════════════

  describe('maybeSpeculate 条件检查 / maybeSpeculate condition checks', () => {
    let executor;

    // ── 条件 1: 预算耗尽 / Condition 1: Budget exhausted ──

    it('预算耗尽时返回 false / returns false when budget exhausted', () => {
      // 设置预算为 1，先消耗一次 / Set budget to 1, consume it first
      const deps = createFullDeps({ config: { speculationBudget: 1 } });
      executor = new SpeculativeExecutor(deps);

      // 第一次应成功 / First call should succeed
      const first = executor.maybeSpeculate('dag-1', 'task-1');
      expect(first).toBe(true);

      // 第二次应因预算耗尽而失败 / Second call should fail due to budget
      const second = executor.maybeSpeculate('dag-2', 'task-1');
      expect(second).toBe(false);
    });

    // ── 条件 2: 非 EXPLORE 模式 / Condition 2: Not EXPLORE mode ──

    it('非 EXPLORE 模式时返回 false / returns false when not in EXPLORE mode', () => {
      const deps = createFullDeps({ mode: 'EXPLOIT' });
      executor = new SpeculativeExecutor(deps);

      const result = executor.maybeSpeculate('dag-1', 'task-1');
      expect(result).toBe(false);
    });

    // ── 条件 3: dagEngine 缺失 / Condition 3: dagEngine missing ──

    it('dagEngine 缺失时返回 false / returns false when dagEngine is missing', () => {
      const deps = createFullDeps();
      deps.dagEngine = null;
      executor = new SpeculativeExecutor(deps);

      const result = executor.maybeSpeculate('dag-1', 'task-1');
      expect(result).toBe(false);
    });

    // ── 条件 4: 节点非临界 / Condition 4: Node not critical ──

    it('节点非临界时返回 false / returns false when node is not critical', () => {
      const deps = createFullDeps({
        nodes: [{ id: 'task-1', isCritical: false, assignedAgent: 'agent-primary' }],
      });
      executor = new SpeculativeExecutor(deps);

      const result = executor.maybeSpeculate('dag-1', 'task-1');
      expect(result).toBe(false);
    });

    // ── 条件 5: 重复推测 / Condition 5: Duplicate speculation ──

    it('重复推测时返回 false / returns false for duplicate speculation', () => {
      const deps = createFullDeps();
      executor = new SpeculativeExecutor(deps);

      // 第一次应成功 / First call should succeed
      const first = executor.maybeSpeculate('dag-1', 'task-1');
      expect(first).toBe(true);

      // 同一 dagId:nodeId 应返回 false / Same dagId:nodeId should return false
      const second = executor.maybeSpeculate('dag-1', 'task-1');
      expect(second).toBe(false);
    });

    // ── 条件 6: 无空闲 Agent / Condition 6: No idle agents ──

    it('无空闲 Agent 时返回 false / returns false when no idle agents', () => {
      // 所有 Agent 都在 dagEngine._agentQueues 中繁忙
      // All agents are busy in dagEngine._agentQueues
      const busyQueues = new Map([
        ['agent-primary', ['task-a']],
        ['agent-idle-1', ['task-b']],
        ['agent-idle-2', ['task-c']],
      ]);

      const deps = createFullDeps({ agentQueues: busyQueues });
      executor = new SpeculativeExecutor(deps);

      const result = executor.maybeSpeculate('dag-1', 'task-1');
      expect(result).toBe(false);
    });

    // ── 条件全部满足 / All conditions met ──

    it('所有条件满足时返回 true / returns true when all conditions met', () => {
      const deps = createFullDeps();
      executor = new SpeculativeExecutor(deps);

      const result = executor.maybeSpeculate('dag-1', 'task-1');
      expect(result).toBe(true);
      expect(executor.getStats().started).toBe(1);
      expect(executor.getStats().activeSpeculations).toBe(1);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // resolveSpeculation 解析 / resolveSpeculation resolution
  // ═══════════════════════════════════════════════════════════════════════════

  describe('resolveSpeculation 解析 / resolveSpeculation resolution', () => {

    it('首个完成者获胜, 其余取消 / first completion wins, others cancelled', () => {
      const deps = createFullDeps();
      const executor = new SpeculativeExecutor(deps);

      executor.maybeSpeculate('dag-1', 'task-1');
      expect(executor.isSpeculative('dag-1', 'task-1')).toBe(true);

      // 推测路径 agent-idle-1 首先完成 / Speculative path agent-idle-1 finishes first
      executor.resolveSpeculation('dag-1', 'task-1', { output: 'result-A' }, 'agent-idle-1');

      const stats = executor.getStats();
      expect(stats.resolved).toBe(1);
      // agent-idle-2 应被取消 / agent-idle-2 should be cancelled
      expect(stats.cancelled).toBeGreaterThanOrEqual(1);
    });

    it('迟到的完成被标记为取消 / late arrival is marked cancelled', () => {
      const deps = createFullDeps();
      const executor = new SpeculativeExecutor(deps);

      executor.maybeSpeculate('dag-1', 'task-1');

      // 首次解析 / First resolution
      executor.resolveSpeculation('dag-1', 'task-1', { output: 'result-A' }, 'agent-idle-1');
      const statsAfterFirst = executor.getStats();
      const cancelledAfterFirst = statsAfterFirst.cancelled;

      // 迟到的第二次解析 / Late second resolution
      executor.resolveSpeculation('dag-1', 'task-1', { output: 'result-B' }, 'agent-idle-2');
      const statsAfterLate = executor.getStats();

      // 迟到者应增加 cancelled 计数 / Late arrival should increment cancelled count
      expect(statsAfterLate.cancelled).toBe(cancelledAfterFirst + 1);
    });

    it('对不存在的推测不做任何操作 / does nothing for non-existent speculation', () => {
      const deps = createFullDeps();
      const executor = new SpeculativeExecutor(deps);

      // 不应抛异常 / Should not throw
      executor.resolveSpeculation('dag-404', 'task-404', { output: 'x' }, 'agent-1');

      const stats = executor.getStats();
      expect(stats.resolved).toBe(0);
      expect(stats.cancelled).toBe(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // isSpeculative 查询 / isSpeculative query
  // ═══════════════════════════════════════════════════════════════════════════

  describe('isSpeculative 查询 / isSpeculative query', () => {

    it('活跃推测返回 true / returns true for active speculation', () => {
      const deps = createFullDeps();
      const executor = new SpeculativeExecutor(deps);

      executor.maybeSpeculate('dag-1', 'task-1');
      expect(executor.isSpeculative('dag-1', 'task-1')).toBe(true);
    });

    it('不存在的推测返回 false / returns false for non-existent speculation', () => {
      const deps = createFullDeps();
      const executor = new SpeculativeExecutor(deps);

      expect(executor.isSpeculative('dag-404', 'task-404')).toBe(false);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // getStats 统计 / getStats statistics
  // ═══════════════════════════════════════════════════════════════════════════

  describe('getStats 统计 / getStats statistics', () => {

    it('返回正确的统计结构 / returns correct stats structure', () => {
      const deps = createFullDeps({ config: { maxSpeculativePaths: 4, speculationBudget: 8 } });
      const executor = new SpeculativeExecutor(deps);
      const stats = executor.getStats();

      expect(stats).toHaveProperty('activeSpeculations');
      expect(stats).toHaveProperty('started');
      expect(stats).toHaveProperty('resolved');
      expect(stats).toHaveProperty('cancelled');
      expect(stats).toHaveProperty('savingsMs');
      expect(stats).toHaveProperty('budget');
      expect(stats).toHaveProperty('maxPaths');

      // 验证配置值正确反映 / Verify config values are correctly reflected
      expect(stats.budget).toBe(8);
      expect(stats.maxPaths).toBe(4);

      // 初始统计为零 / Initial stats should be zero
      expect(stats.activeSpeculations).toBe(0);
      expect(stats.started).toBe(0);
      expect(stats.resolved).toBe(0);
      expect(stats.cancelled).toBe(0);
      expect(stats.savingsMs).toBe(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // destroy 生命周期 / destroy lifecycle
  // ═══════════════════════════════════════════════════════════════════════════

  describe('destroy 生命周期 / destroy lifecycle', () => {

    it('取消所有活跃推测并清空 / cancels all active speculations and clears', () => {
      const deps = createFullDeps({ config: { speculationBudget: 5 } });

      // 添加多个不同的临界节点 / Add multiple distinct critical nodes
      deps.dagEngine.getDAGSnapshot = (dagId) => ({
        dagId,
        nodes: [
          { id: 'task-1', isCritical: true, assignedAgent: 'agent-primary' },
          { id: 'task-2', isCritical: true, assignedAgent: 'agent-primary' },
          { id: 'task-3', isCritical: true, assignedAgent: 'agent-primary' },
        ],
      });

      const executor = new SpeculativeExecutor(deps);

      // 启动多个推测 / Start multiple speculations
      executor.maybeSpeculate('dag-1', 'task-1');
      executor.maybeSpeculate('dag-1', 'task-2');
      executor.maybeSpeculate('dag-1', 'task-3');

      expect(executor.getStats().activeSpeculations).toBe(3);

      // 执行销毁 / Execute destroy
      executor.destroy();

      // 所有推测应被清除 / All speculations should be cleared
      expect(executor.getStats().activeSpeculations).toBe(0);
      expect(executor.isSpeculative('dag-1', 'task-1')).toBe(false);
      expect(executor.isSpeculative('dag-1', 'task-2')).toBe(false);
      expect(executor.isSpeculative('dag-1', 'task-3')).toBe(false);

      // cancelled 计数应增加 / cancelled count should have increased
      expect(executor.getStats().cancelled).toBeGreaterThan(0);
    });

    it('destroy 清理 DAG _completionSet / destroy cleans up DAG _completionSet', () => {
      const deps = createFullDeps();
      const executor = new SpeculativeExecutor(deps);

      executor.maybeSpeculate('dag-1', 'task-1');
      expect(deps.dagEngine._completionSet.size).toBeGreaterThan(0);

      executor.destroy();
      expect(deps.dagEngine._completionSet.size).toBe(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 事件发布 / Event publishing
  // ═══════════════════════════════════════════════════════════════════════════

  describe('事件发布 / event publishing', () => {

    it('推测启动时发布事件 / publishes event when speculation starts', () => {
      const deps = createFullDeps();
      const executor = new SpeculativeExecutor(deps);

      executor.maybeSpeculate('dag-1', 'task-1');

      const events = deps.messageBus._published;
      const startEvent = events.find(e => e.topic === 'speculative.task.started');
      expect(startEvent).toBeDefined();
    });
  });
});
