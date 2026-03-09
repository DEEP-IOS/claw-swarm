/**
 * TaskDAGEngine 单元测试 / TaskDAGEngine Unit Tests
 *
 * 测试 L4 DAG 任务编排引擎的 DAG 构建、状态机、CPM、拍卖和 DLQ。
 * Tests L4 DAG task orchestration engine: DAG construction, state machine,
 * CPM analysis, auction, and dead letter queue.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TaskDAGEngine, TaskState } from '../../../src/L4-orchestration/task-dag-engine.js';

// ── 辅助函数 / Helpers ──────────────────────────────────────────────────────

const silentLogger = { info() {}, warn() {}, error() {}, debug() {} };

function createMockBus() {
  const published = [];
  return {
    publish(topic, data) { published.push({ topic, data }); },
    subscribe() { return () => {}; },
    _published: published,
  };
}

function createMockPheromone() {
  const emitted = [];
  return {
    emitPheromone(params) { emitted.push(params); },
    _emitted: emitted,
  };
}

function createMockAgentRepo() {
  const agents = [];
  return {
    listAgents() { return agents; },
    _agents: agents,
    addAgent(a) { agents.push(a); },
  };
}

function createMockTaskRepo() {
  return {
    createTask() {},
    updateTaskStatus() {},
    listTasks() { return []; },
  };
}

// ── 测试 / Tests ────────────────────────────────────────────────────────────

describe('TaskDAGEngine', () => {
  let bus;
  let pheromone;
  let agentRepo;
  let taskRepo;
  let engine;

  beforeEach(() => {
    bus = createMockBus();
    pheromone = createMockPheromone();
    agentRepo = createMockAgentRepo();
    taskRepo = createMockTaskRepo();
    engine = new TaskDAGEngine({
      messageBus: bus,
      pheromoneEngine: pheromone,
      agentRepo,
      taskRepo,
      logger: silentLogger,
      config: { auctionTimeoutMs: 100 },
    });
  });

  afterEach(() => {
    engine.destroy();
  });

  // ── DAG 创建 / DAG Creation ──

  it('创建有效 DAG / creates valid DAG', () => {
    const result = engine.createDAG('dag-1', {
      nodes: [
        { id: 'A', deps: [] },
        { id: 'B', deps: ['A'] },
        { id: 'C', deps: ['A'] },
        { id: 'D', deps: ['B', 'C'] },
      ],
    });
    expect(result.success).toBe(true);
    expect(result.dagId).toBe('dag-1');
  });

  it('拒绝空节点 / rejects empty nodes', () => {
    const result = engine.createDAG('dag-1', { nodes: [] });
    expect(result.success).toBe(false);
    expect(result.error).toContain('non-empty');
  });

  it('拒绝重复 DAG ID / rejects duplicate DAG ID', () => {
    engine.createDAG('dag-1', { nodes: [{ id: 'A', deps: [] }] });
    const result = engine.createDAG('dag-1', { nodes: [{ id: 'B', deps: [] }] });
    expect(result.success).toBe(false);
    expect(result.error).toContain('already exists');
  });

  it('检测循环依赖 / detects cycle', () => {
    const result = engine.createDAG('dag-1', {
      nodes: [
        { id: 'A', deps: ['B'] },
        { id: 'B', deps: ['A'] },
      ],
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('Cycle');
  });

  it('发布 DAG 创建事件 / publishes DAG created event', () => {
    engine.createDAG('dag-1', { nodes: [{ id: 'A', deps: [] }] });
    const events = bus._published.filter(e => e.topic === 'dag.created');
    expect(events.length).toBe(1);
  });

  // ── CPM 分析 / CPM Analysis ──

  it('计算关键路径 / computes critical path', () => {
    engine.createDAG('dag-1', {
      nodes: [
        { id: 'A', deps: [], estimatedDuration: 10000 },
        { id: 'B', deps: ['A'], estimatedDuration: 20000 },
        { id: 'C', deps: ['A'], estimatedDuration: 5000 },
        { id: 'D', deps: ['B', 'C'], estimatedDuration: 10000 },
      ],
    });

    const snap = engine.getDAGSnapshot('dag-1');
    const criticalNodes = snap.criticalPath;

    // 关键路径: A → B → D (总 40000ms)
    // 非关键: C (slack > 0)
    expect(criticalNodes).toContain('A');
    expect(criticalNodes).toContain('B');
    expect(criticalNodes).toContain('D');

    const nodeC = snap.nodes.find(n => n.id === 'C');
    expect(nodeC.isCritical).toBe(false);
    expect(nodeC.slack).toBeGreaterThan(0);
  });

  // ── 状态机 / State Machine ──

  it('有效状态转换 / valid state transitions', () => {
    engine.createDAG('dag-1', { nodes: [{ id: 'A', deps: [] }] });

    expect(engine.transitionState('dag-1', 'A', TaskState.ASSIGNED, { agentId: 'a1' })).toBe(true);
    expect(engine.transitionState('dag-1', 'A', TaskState.EXECUTING)).toBe(true);
    expect(engine.transitionState('dag-1', 'A', TaskState.COMPLETED)).toBe(true);
  });

  it('无效状态转换被拒绝 / invalid state transitions rejected', () => {
    engine.createDAG('dag-1', { nodes: [{ id: 'A', deps: [] }] });

    // pending → completed 无效 / pending → completed is invalid
    expect(engine.transitionState('dag-1', 'A', TaskState.COMPLETED)).toBe(false);
  });

  it('未知任务转换返回 false / unknown task transition returns false', () => {
    expect(engine.transitionState('dag-1', 'NOPE', TaskState.ASSIGNED)).toBe(false);
  });

  // ── Stigmergic 信息素 ──

  it('完成沉积 trail 信息素 / completion deposits trail pheromone', () => {
    engine.createDAG('dag-1', { nodes: [{ id: 'A', deps: [] }] });
    engine.transitionState('dag-1', 'A', TaskState.ASSIGNED, { agentId: 'a1' });
    engine.transitionState('dag-1', 'A', TaskState.EXECUTING);
    engine.transitionState('dag-1', 'A', TaskState.COMPLETED);

    const trails = pheromone._emitted.filter(p => p.type === 'trail');
    expect(trails.length).toBeGreaterThanOrEqual(1);
  });

  it('失败沉积 alarm 信息素 / failure deposits alarm pheromone', () => {
    engine.createDAG('dag-1', { nodes: [{ id: 'A', deps: [] }] });
    engine.transitionState('dag-1', 'A', TaskState.ASSIGNED, { agentId: 'a1' });
    engine.transitionState('dag-1', 'A', TaskState.EXECUTING);
    engine.transitionState('dag-1', 'A', TaskState.FAILED, { error: 'test error' });

    const alarms = pheromone._emitted.filter(p => p.type === 'alarm');
    expect(alarms.length).toBeGreaterThanOrEqual(1);
  });

  // ── DLQ ──

  it('重试超限进入 DLQ / enters DLQ after max retries', () => {
    engine.createDAG('dag-1', { nodes: [{ id: 'A', deps: [] }] });

    // 显式状态转换（不依赖快照，快照是值拷贝）
    // Explicit state transitions (don't rely on snapshot, it's a value copy)
    for (let i = 0; i < 3; i++) {
      if (i > 0) {
        // FAILED → PENDING（重试回 pending）/ retry back to pending
        engine.transitionState('dag-1', 'A', TaskState.PENDING);
      }
      // PENDING → ASSIGNED → EXECUTING → FAILED
      engine.transitionState('dag-1', 'A', TaskState.ASSIGNED, { agentId: 'a1' });
      engine.transitionState('dag-1', 'A', TaskState.EXECUTING);
      engine.transitionState('dag-1', 'A', TaskState.FAILED, { error: `fail-${i}` });
      // 第 3 次失败 (retryCount=3) 内部自动转 DEAD_LETTER
    }

    const dlq = engine.getDeadLetterQueue();
    expect(dlq.length).toBe(1);
    expect(dlq[0].dagId).toBe('dag-1');
    expect(dlq[0].taskNodeId).toBe('A');
  });

  it('DLQ 发布 task.dead_letter 事件 / publishes dead letter event', () => {
    engine.createDAG('dag-1', { nodes: [{ id: 'A', deps: [] }] });

    for (let i = 0; i < 3; i++) {
      if (i > 0) {
        // FAILED → PENDING（重试）/ retry back to pending
        engine.transitionState('dag-1', 'A', TaskState.PENDING);
      }
      engine.transitionState('dag-1', 'A', TaskState.ASSIGNED, { agentId: 'a1' });
      engine.transitionState('dag-1', 'A', TaskState.EXECUTING);
      engine.transitionState('dag-1', 'A', TaskState.FAILED, { error: 'fail' });
    }

    const dlqEvents = bus._published.filter(e => e.topic === 'task.dead_letter');
    expect(dlqEvents.length).toBe(1);
  });

  // ── 拓扑排序 / Topological Sort ──

  it('拓扑排序正确 / topological sort is correct', () => {
    engine.createDAG('dag-1', {
      nodes: [
        { id: 'A', deps: [] },
        { id: 'B', deps: ['A'] },
        { id: 'C', deps: ['A'] },
        { id: 'D', deps: ['B', 'C'] },
      ],
    });

    const sorted = engine.topologicalSort('dag-1');
    expect(sorted[0]).toBe('A');
    expect(sorted[sorted.length - 1]).toBe('D');
    // B 和 C 在 A 之后, D 之前 / B and C after A, before D
    expect(sorted.indexOf('B')).toBeGreaterThan(sorted.indexOf('A'));
    expect(sorted.indexOf('C')).toBeGreaterThan(sorted.indexOf('A'));
    expect(sorted.indexOf('D')).toBeGreaterThan(sorted.indexOf('B'));
    expect(sorted.indexOf('D')).toBeGreaterThan(sorted.indexOf('C'));
  });

  it('空 DAG 拓扑排序返回空数组 / empty DAG returns empty sort', () => {
    expect(engine.topologicalSort('nonexistent')).toEqual([]);
  });

  // ── DAG 完成检测 ──

  it('所有节点完成时发布 dag.completed 事件 / publishes dag.completed on full completion', () => {
    engine.createDAG('dag-1', {
      nodes: [
        { id: 'A', deps: [] },
        { id: 'B', deps: ['A'] },
      ],
    });

    // 完成 A / Complete A
    engine.transitionState('dag-1', 'A', TaskState.ASSIGNED, { agentId: 'a1' });
    engine.transitionState('dag-1', 'A', TaskState.EXECUTING);
    engine.transitionState('dag-1', 'A', TaskState.COMPLETED);

    // 完成 B / Complete B
    engine.transitionState('dag-1', 'B', TaskState.ASSIGNED, { agentId: 'a2' });
    engine.transitionState('dag-1', 'B', TaskState.EXECUTING);
    engine.transitionState('dag-1', 'B', TaskState.COMPLETED);

    const dagCompleted = bus._published.filter(e => e.topic === 'dag.completed');
    expect(dagCompleted.length).toBe(1);
  });

  // ── 拍卖 / Auction ──

  it('拍卖分配到最佳 Agent / auction assigns to best agent', () => {
    agentRepo.addAgent({ id: 'a1', status: 'active' });
    agentRepo.addAgent({ id: 'a2', status: 'active' });

    engine.createDAG('dag-1', { nodes: [{ id: 'A', deps: [] }] });

    // 手动拍卖 / Manual auction
    const result = engine.auctionTask('dag-1', 'A');
    expect(result.agentId).toBeTruthy();
    expect(result.score).toBeGreaterThan(0);
  });

  it('无 Agent 时拍卖返回 null / auction returns null when no agents', () => {
    engine.createDAG('dag-1', { nodes: [{ id: 'A', deps: [] }] });
    const result = engine.auctionTask('dag-1', 'A');
    expect(result.agentId).toBeNull();
  });

  // ── 管道失败传播 ──

  it('上游失败传播 tainted 标记 / upstream failure propagates tainted mark', () => {
    engine.createDAG('dag-1', {
      nodes: [
        { id: 'A', deps: [] },
        { id: 'B', deps: ['A'] },
      ],
    });

    // B 正在执行 / B is executing
    engine.transitionState('dag-1', 'B', TaskState.ASSIGNED, { agentId: 'a1' });
    engine.transitionState('dag-1', 'B', TaskState.EXECUTING);

    // A 失败传播 / A failure propagates
    engine.propagateUpstreamFailure('dag-1', 'A');

    const snap = engine.getDAGSnapshot('dag-1');
    const nodeB = snap.nodes.find(n => n.id === 'B');
    expect(nodeB.state).toBe(TaskState.TAINTED);
  });

  it('上游失败发布 task.upstream_failed 事件 / publishes upstream failed event', () => {
    engine.createDAG('dag-1', {
      nodes: [
        { id: 'A', deps: [] },
        { id: 'B', deps: ['A'] },
      ],
    });

    engine.transitionState('dag-1', 'B', TaskState.ASSIGNED, { agentId: 'a1' });
    engine.transitionState('dag-1', 'B', TaskState.EXECUTING);
    engine.propagateUpstreamFailure('dag-1', 'A');

    const events = bus._published.filter(e => e.topic === 'task.upstream_failed');
    expect(events.length).toBe(1);
    expect(events[0].data.payload.affectedNodes).toContain('B');
  });

  // ── 部分结果 / Partial Results ──

  it('部分结果发布事件 / partial result publishes event', () => {
    engine.createDAG('dag-1', { nodes: [{ id: 'A', deps: [] }] });
    engine.publishPartialResult('dag-1', 'A', { partial: true });

    const events = bus._published.filter(e => e.topic === 'task.partial_result');
    expect(events.length).toBe(1);
  });

  // ── Work-Stealing ──

  it('Work-Stealing 默认禁用时不偷 / no steal when disabled', () => {
    const result = engine.tryStealTask('a1');
    expect(result.stolen).toBe(false);
  });

  // ── 查询 / Queries ──

  it('getDAGSnapshot 返回快照 / returns snapshot', () => {
    engine.createDAG('dag-1', {
      nodes: [
        { id: 'A', deps: [] },
        { id: 'B', deps: ['A'] },
      ],
    });

    const snap = engine.getDAGSnapshot('dag-1');
    expect(snap.dagId).toBe('dag-1');
    expect(snap.nodes).toHaveLength(2);
    expect(snap.status).toBe('active');
  });

  it('getDAGSnapshot 未知 DAG 返回 null / returns null for unknown DAG', () => {
    expect(engine.getDAGSnapshot('unknown')).toBeNull();
  });

  it('listActiveDags 返回 ID 列表 / returns list of DAG IDs', () => {
    engine.createDAG('dag-1', { nodes: [{ id: 'A', deps: [] }] });
    engine.createDAG('dag-2', { nodes: [{ id: 'B', deps: [] }] });
    expect(engine.listActiveDags()).toEqual(['dag-1', 'dag-2']);
  });

  it('getStats 返回统计 / returns statistics', () => {
    engine.createDAG('dag-1', {
      nodes: [
        { id: 'A', deps: [] },
        { id: 'B', deps: ['A'] },
      ],
    });

    const stats = engine.getStats();
    expect(stats.activeDags).toBe(1);
    expect(stats.totalNodes).toBe(2);
    expect(stats.deadLetterQueueSize).toBe(0);
  });

  // ── removeDAG ──

  it('removeDAG 清理 DAG 及索引 / cleans up DAG and index', () => {
    engine.createDAG('dag-1', { nodes: [{ id: 'A', deps: [] }] });
    engine.removeDAG('dag-1');

    expect(engine.getDAGSnapshot('dag-1')).toBeNull();
    expect(engine.listActiveDags()).toEqual([]);
  });

  // ── destroy ──

  it('destroy 清理所有状态 / clears all state', () => {
    engine.createDAG('dag-1', { nodes: [{ id: 'A', deps: [] }] });
    engine.destroy();

    expect(engine.getStats().activeDags).toBe(0);
    expect(engine.getStats().totalNodes).toBe(0);
  });
});
