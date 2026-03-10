/**
 * TaskDAGEngine V5.6 增量单元测试 / TaskDAGEngine V5.6 Incremental Unit Tests
 *
 * 测试 V5.6 新增功能:
 *   - _getEffectiveCooldown(): 全局调节器感知的冷却期 / Modulator-aware cooldown
 *   - checkAndPublishPartial(): 部分结果条件发布 / Conditional partial result publishing
 *   - tryStealTask(): 调节器感知冷却 + WORK_STEAL_COMPLETED 事件
 *
 * Tests V5.6 additions:
 *   - _getEffectiveCooldown(): global modulator-aware cooldown
 *   - checkAndPublishPartial(): conditional partial result publishing
 *   - tryStealTask(): modulator-aware cooldown + WORK_STEAL_COMPLETED event
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TaskDAGEngine, TaskState } from '../../../src/L4-orchestration/task-dag-engine.js';

// ── 辅助函数 / Helpers ──────────────────────────────────────────────────────

const silentLogger = { info() {}, warn() {}, error() {}, debug() {} };

/** 创建模拟 MessageBus / Create mock MessageBus */
function createMockBus() {
  const published = [];
  return {
    publish(topic, data) { published.push({ topic, data }); },
    subscribe() { return () => {}; },
    _published: published,
  };
}

/** 创建模拟 PheromoneEngine / Create mock PheromoneEngine */
function createMockPheromone() {
  const emitted = [];
  return {
    emitPheromone(params) { emitted.push(params); },
    _emitted: emitted,
  };
}

/** 创建模拟 AgentRepo / Create mock AgentRepo */
function createMockAgentRepo() {
  const agents = [];
  return {
    listAgents() { return agents; },
    _agents: agents,
    addAgent(a) { agents.push(a); },
  };
}

/** 创建模拟 TaskRepo / Create mock TaskRepo */
function createMockTaskRepo() {
  return {
    createTask() {},
    updateTaskStatus() {},
    listTasks() { return []; },
  };
}

/**
 * 创建基本的 V5.6 引擎实例 / Create a basic V5.6 engine instance
 *
 * @param {Object} [overrides] - 覆盖依赖项 / Override dependencies
 * @returns {{ engine, bus, pheromone, agentRepo, taskRepo }}
 */
function createEngine(overrides = {}) {
  const bus = overrides.messageBus || createMockBus();
  const pheromone = overrides.pheromoneEngine || createMockPheromone();
  const agentRepo = overrides.agentRepo || createMockAgentRepo();
  const taskRepo = overrides.taskRepo || createMockTaskRepo();

  const engine = new TaskDAGEngine({
    messageBus: bus,
    pheromoneEngine: pheromone,
    agentRepo,
    taskRepo,
    logger: silentLogger,
    config: overrides.config || { auctionTimeoutMs: 100 },
    ...(overrides.db ? { db: overrides.db } : {}),
  });

  return { engine, bus, pheromone, agentRepo, taskRepo };
}

// ── 测试 / Tests ────────────────────────────────────────────────────────────

describe('TaskDAGEngine V5.6', () => {

  // ━━━ _getEffectiveCooldown() ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  describe('_getEffectiveCooldown()', () => {
    it('无 globalModulator 时返回基础冷却期 5000ms / returns base cooldown when no globalModulator', () => {
      const { engine } = createEngine();

      // 默认没有 _globalModulator / No _globalModulator by default
      const cooldown = engine._getEffectiveCooldown();
      expect(cooldown).toBe(5000);

      engine.destroy();
    });

    it('EXPLORE 模式: 乘数 0.4 → 2000ms / EXPLORE mode: multiplier 0.4 → 2000ms', () => {
      const { engine } = createEngine();
      engine._globalModulator = { getCurrentMode: () => 'EXPLORE' };

      expect(engine._getEffectiveCooldown()).toBe(2000);
      engine.destroy();
    });

    it('EXPLOIT 模式: 乘数 0.6 → 3000ms / EXPLOIT mode: multiplier 0.6 → 3000ms', () => {
      const { engine } = createEngine();
      engine._globalModulator = { getCurrentMode: () => 'EXPLOIT' };

      expect(engine._getEffectiveCooldown()).toBe(3000);
      engine.destroy();
    });

    it('RELIABLE 模式: 乘数 1.0 → 5000ms / RELIABLE mode: multiplier 1.0 → 5000ms', () => {
      const { engine } = createEngine();
      engine._globalModulator = { getCurrentMode: () => 'RELIABLE' };

      expect(engine._getEffectiveCooldown()).toBe(5000);
      engine.destroy();
    });

    it('URGENT 模式: 乘数 0.2 → 1000ms / URGENT mode: multiplier 0.2 → 1000ms', () => {
      const { engine } = createEngine();
      engine._globalModulator = { getCurrentMode: () => 'URGENT' };

      expect(engine._getEffectiveCooldown()).toBe(1000);
      engine.destroy();
    });

    it('未知模式回退乘数 1.0 → 5000ms / unknown mode falls back to multiplier 1.0 → 5000ms', () => {
      const { engine } = createEngine();
      engine._globalModulator = { getCurrentMode: () => 'UNKNOWN_MODE' };

      expect(engine._getEffectiveCooldown()).toBe(5000);
      engine.destroy();
    });
  });

  // ━━━ checkAndPublishPartial() ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  describe('checkAndPublishPartial()', () => {
    it('不存在的 DAG 返回 false / returns false for non-existent DAG', () => {
      const { engine } = createEngine();

      const result = engine.checkAndPublishPartial('no-such-dag', 'node-a', { partial: true });
      expect(result).toBe(false);

      engine.destroy();
    });

    it('非 executing 状态节点返回 false / returns false when node not executing', () => {
      const { engine } = createEngine();

      // 创建 DAG: 节点 A 初始状态为 pending / Create DAG: node A starts as pending
      engine.createDAG('dag-1', {
        nodes: [{ id: 'A', deps: [] }],
      });

      // A 此时为 pending, 不是 executing / A is pending, not executing
      const result = engine.checkAndPublishPartial('dag-1', 'A', { data: 'interim' });
      expect(result).toBe(false);

      engine.destroy();
    });

    it('无下游依赖节点返回 false / returns false when no downstream dependents', () => {
      const { engine, agentRepo } = createEngine();

      // 添加 agent 使拍卖可以分配 / Add agent so auction can assign
      agentRepo.addAgent({ id: 'agent-1' });

      // 创建 DAG: A → B（A 是叶子无后继）/ Create DAG: A → B (A is leaf, no successors)
      // 但我们让 B 单独（无依赖），A 也无依赖
      // Both A and B are independent, so A has no downstream
      engine.createDAG('dag-2', {
        nodes: [
          { id: 'A', deps: [] },
          { id: 'B', deps: [] },
        ],
      });

      // 手动转换 A 到 executing / Manually transition A to executing
      engine.transitionState('dag-2', 'A', TaskState.ASSIGNED, { agentId: 'agent-1' });
      engine.transitionState('dag-2', 'A', TaskState.EXECUTING);

      // A 没有下游 (B 不依赖 A) / A has no downstream (B does not depend on A)
      const result = engine.checkAndPublishPartial('dag-2', 'A', { partial: true });
      expect(result).toBe(false);

      engine.destroy();
    });

    it('有下游依赖时发布部分结果并返回 true / publishes partial result when downstream exists', () => {
      const { engine, bus, agentRepo } = createEngine();

      agentRepo.addAgent({ id: 'agent-1' });

      // 创建 DAG: A → B (B 依赖 A) / Create DAG: A → B (B depends on A)
      engine.createDAG('dag-3', {
        nodes: [
          { id: 'A', deps: [] },
          { id: 'B', deps: ['A'] },
        ],
      });

      // 转换 A 到 executing / Transition A to executing
      engine.transitionState('dag-3', 'A', TaskState.ASSIGNED, { agentId: 'agent-1' });
      engine.transitionState('dag-3', 'A', TaskState.EXECUTING);

      // 清空已发布事件，方便断言 / Clear published events for clean assertion
      bus._published.length = 0;

      const intermediateOutput = { progress: 0.5, chunk: 'partial-data' };
      const result = engine.checkAndPublishPartial('dag-3', 'A', intermediateOutput);

      expect(result).toBe(true);

      // 验证发布了 TASK_PARTIAL_RESULT 事件 / Verify TASK_PARTIAL_RESULT event was published
      const partialEvent = bus._published.find(
        e => e.topic === 'task.partial_result'
      );
      expect(partialEvent).toBeDefined();
      expect(partialEvent.data.payload.dagId).toBe('dag-3');
      expect(partialEvent.data.payload.nodeId).toBe('A');
      expect(partialEvent.data.payload.partialResult).toEqual(intermediateOutput);

      engine.destroy();
    });
  });

  // ━━━ tryStealTask() — 调节器感知冷却 / Modulator-aware Cooldown ━━━━━━━━━

  describe('tryStealTask() — V5.6 modulator-aware cooldown', () => {
    it('使用调节器感知冷却期控制偷取频率 / uses modulator-aware cooldown', () => {
      const { engine, agentRepo } = createEngine({
        config: {
          auctionTimeoutMs: 100,
          workStealing: { enabled: true },
        },
      });

      // 设置 URGENT 模式 (冷却 1000ms) / Set URGENT mode (cooldown 1000ms)
      engine._globalModulator = { getCurrentMode: () => 'URGENT' };

      agentRepo.addAgent({ id: 'agent-busy' });
      agentRepo.addAgent({ id: 'agent-idle' });

      // 创建 DAG 并手动构造队列场景 / Create DAG and manually set up queue scenario
      engine.createDAG('dag-steal', {
        nodes: [
          { id: 'T1', agent: 'agent-busy', deps: [] },
          { id: 'T2', agent: 'agent-busy', deps: [] },
        ],
      });

      // 手动设置任务状态为 assigned + agent 队列
      // Manually set task state to assigned + agent queues
      engine.transitionState('dag-steal', 'T1', TaskState.ASSIGNED, { agentId: 'agent-busy' });
      engine.transitionState('dag-steal', 'T2', TaskState.ASSIGNED, { agentId: 'agent-busy' });

      engine._agentQueues.set('agent-busy', ['dag-steal:T1', 'dag-steal:T2']);
      engine._agentQueues.set('agent-idle', []);

      // 首次偷取应成功 / First steal should succeed
      const result1 = engine.tryStealTask('agent-idle');
      expect(result1.stolen).toBe(true);

      // 立即再次偷取应被冷却拒绝 (URGENT = 1000ms)
      // Immediate re-steal should be denied by cooldown (URGENT = 1000ms)
      const result2 = engine.tryStealTask('agent-idle');
      expect(result2.stolen).toBe(false);

      engine.destroy();
    });

    it('偷取完成后发布 WORK_STEAL_COMPLETED 事件 / publishes WORK_STEAL_COMPLETED event after steal', () => {
      const { engine, bus, agentRepo } = createEngine({
        config: {
          auctionTimeoutMs: 100,
          workStealing: { enabled: true },
        },
      });

      agentRepo.addAgent({ id: 'agent-src' });
      agentRepo.addAgent({ id: 'agent-dst' });

      // 创建 DAG / Create DAG
      engine.createDAG('dag-event', {
        nodes: [
          { id: 'X1', agent: 'agent-src', deps: [] },
          { id: 'X2', agent: 'agent-src', deps: [] },
        ],
      });

      // 设置任务为 assigned 状态 / Set tasks to assigned state
      engine.transitionState('dag-event', 'X1', TaskState.ASSIGNED, { agentId: 'agent-src' });
      engine.transitionState('dag-event', 'X2', TaskState.ASSIGNED, { agentId: 'agent-src' });

      engine._agentQueues.set('agent-src', ['dag-event:X1', 'dag-event:X2']);
      engine._agentQueues.set('agent-dst', []);

      // 清空之前的事件 / Clear previous events
      bus._published.length = 0;

      const result = engine.tryStealTask('agent-dst');
      expect(result.stolen).toBe(true);

      // 验证 WORK_STEAL_COMPLETED 事件 / Verify WORK_STEAL_COMPLETED event
      const stealEvent = bus._published.find(
        e => e.topic === 'work.steal.completed'
      );
      expect(stealEvent).toBeDefined();
      expect(stealEvent.data.payload.agentId).toBe('agent-dst');
      expect(stealEvent.data.payload.fromAgent).toBe('agent-src');
      expect(stealEvent.data.payload.dagId).toBe('dag-event');

      engine.destroy();
    });
  });
});
