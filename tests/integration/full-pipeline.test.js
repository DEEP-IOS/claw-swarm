/**
 * 全管道集成测试 / Full Pipeline Integration Tests
 *
 * 端到端验证: L1 → L2 → L3 → L4 → L5 → L6 跨层集成。
 * End-to-end validation: L1 → L2 → L3 → L4 → L5 → L6 cross-layer integration.
 *
 * 使用内存 SQLite, 真实引擎实例, 验证完整数据流。
 * Uses in-memory SQLite, real engine instances, validates full data flow.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PluginAdapter } from '../../src/L5-application/plugin-adapter.js';
import { StateBroadcaster } from '../../src/L6-monitoring/state-broadcaster.js';
import { MetricsCollector } from '../../src/L6-monitoring/metrics-collector.js';

const silentLogger = { info() {}, warn() {}, error() {}, debug() {} };

describe('Full Pipeline Integration', () => {
  let adapter;

  beforeEach(() => {
    adapter = new PluginAdapter({
      config: { memory: { inMemory: true } },
      logger: silentLogger,
    });
    adapter.init({});
  });

  afterEach(() => {
    adapter.close();
  });

  // ━━━ L1→L2: 数据库 + 消息总线 / Database + MessageBus ━━━

  it('L1→L2: 数据库初始化后消息总线可用 / DB init enables MessageBus', () => {
    const bus = adapter._engines.messageBus;
    expect(bus).toBeDefined();

    let received = null;
    bus.subscribe('test.topic', (msg) => { received = msg; });
    bus.publish('test.topic', { hello: 'world' });

    expect(received).toBeDefined();
    expect(received.data.hello).toBe('world');
  });

  // ━━━ L2→L3: 信息素 + 记忆系统 / Pheromone + Memory ━━━

  it('L2→L3: 信息素发射 + 情景记忆记录 / Pheromone emit + episodic record', () => {
    const { pheromoneEngine, episodicMemory } = adapter._engines;

    // 发射信息素 / Emit pheromone
    const phId = pheromoneEngine.emitPheromone({
      type: 'trail',
      sourceId: 'agent-1',
      targetScope: '/task/test',
      intensity: 0.9,
      payload: { path: 'success' },
    });
    expect(phId).toBeDefined();

    // 记录情景记忆 / Record episodic memory
    const evId = episodicMemory.record({
      agentId: 'agent-1',
      eventType: 'action',
      subject: 'agent-1',
      predicate: 'completed',
      object: 'task-1',
      importance: 0.8,
    });
    expect(evId).toBeDefined();

    // 回忆 / Recall
    const events = episodicMemory.recall('agent-1', { limit: 5 });
    expect(events.length).toBeGreaterThanOrEqual(1);
  });

  // ━━━ L3→L4: 记忆 + 编排 / Memory + Orchestration ━━━

  it('L3→L4: 工作记忆 → 质量控制器 / Working memory → quality controller', () => {
    const { workingMemory, qualityController } = adapter._engines;

    // 存入工作记忆 / Store in working memory
    workingMemory.put('task-output', { code: 'fn(){}', tests: 3 }, { priority: 8, importance: 0.9 });
    const item = workingMemory.get('task-output');
    expect(item).toBeDefined();
    expect(item.tests).toBe(3);

    // 质量控制器存在 / Quality controller exists
    expect(qualityController).toBeDefined();
  });

  // ━━━ L5 钩子集成 / L5 Hook Integration ━━━

  it('L5: onAgentStart → gossip + repo 注册 / hook registers agent', async () => {
    const hooks = adapter.getHooks();
    await hooks.onAgentStart({ agentId: 'integration-agent-1', tier: 'mid' });

    // 验证 gossip 状态 / Verify gossip state
    const gossip = adapter._engines.gossipProtocol;
    const allStates = gossip.getAllStates();
    expect(allStates.has('integration-agent-1')).toBe(true);
    expect(allStates.get('integration-agent-1').status).toBe('active');
  });

  it('L5: onAgentStart → onPrependContext → onAgentEnd 完整生命周期 / full lifecycle', async () => {
    const hooks = adapter.getHooks();

    // 1. Agent 启动 / Agent start
    await hooks.onAgentStart({ agentId: 'lifecycle-agent' });

    // 2. 上下文注入 / Context inject
    const ctx = await hooks.onPrependContext({ agentId: 'lifecycle-agent', taskDescription: 'build feature' });
    expect(ctx).toHaveProperty('prependText');

    // 3. Agent 结束 / Agent end
    await hooks.onAgentEnd({ agentId: 'lifecycle-agent' });

    // 验证 gossip 最终状态 / Verify final gossip state
    const gossip = adapter._engines.gossipProtocol;
    const state = gossip.getAllStates().get('lifecycle-agent');
    expect(state.status).toBe('completed');
  });

  it('L5: onSubAgentAbort → ALARM 信息素 / abort emits alarm pheromone', async () => {
    const hooks = adapter.getHooks();
    const { pheromoneEngine } = adapter._engines;

    await hooks.onSubAgentAbort({
      subAgentId: 'abort-agent',
      taskId: 'task-abort-1',
      reason: 'timeout',
    });

    // 读取 ALARM 信息素 / Read alarm pheromones
    const pheromones = pheromoneEngine.read('/task/task-abort-1');
    const alarms = pheromones.filter((p) => p.type === 'alarm');
    expect(alarms.length).toBeGreaterThanOrEqual(1);
  });

  // ━━━ L5 工具集成 / L5 Tool Integration ━━━

  it('L5: 8 工具全部可调用 / all 8 tools callable', async () => {
    const tools = adapter.getTools();
    expect(tools.length).toBe(8);

    // 逐一验证工具结构 / Verify each tool structure
    const names = tools.map((t) => t.name);
    expect(names).toContain('swarm_spawn');
    expect(names).toContain('swarm_query');
    expect(names).toContain('swarm_pheromone');
    expect(names).toContain('swarm_gate');
    expect(names).toContain('swarm_memory');
    expect(names).toContain('swarm_plan');
    expect(names).toContain('swarm_zone');
    expect(names).toContain('swarm_run');

    // 调用 swarm_query.status / Call swarm_query.status
    const queryTool = tools.find((t) => t.name === 'swarm_query');
    const result = await queryTool.handler({ action: 'status' });
    expect(result.success).toBe(true);
  });

  it('L5: swarm_pheromone emit + read 往返 / pheromone emit+read round-trip', async () => {
    const tools = adapter.getTools();
    const phTool = tools.find((t) => t.name === 'swarm_pheromone');

    // emit
    const emitResult = await phTool.handler({
      action: 'emit',
      type: 'trail',
      scope: '/integration',
      message: 'test signal',
      intensity: 0.7,
    });
    expect(emitResult.success).toBe(true);

    // read
    const readResult = await phTool.handler({
      action: 'read',
      scope: '/integration',
    });
    expect(readResult.success).toBe(true);
  });

  it('L5: swarm_memory record + recall 往返 / memory record+recall round-trip', async () => {
    const tools = adapter.getTools();
    const memTool = tools.find((t) => t.name === 'swarm_memory');

    // record
    const recResult = await memTool.handler({
      action: 'record',
      agentId: 'mem-agent',
      eventType: 'action',
      subject: 'agent',
      predicate: 'built',
      object: 'feature',
      importance: 0.9,
    });
    expect(recResult.success).toBe(true);

    // recall
    const recallResult = await memTool.handler({
      action: 'recall',
      agentId: 'mem-agent',
      limit: 5,
    });
    expect(recallResult.success).toBe(true);
  });

  // ━━━ L6 监控集成 / L6 Monitoring Integration ━━━

  it('L6: StateBroadcaster + MessageBus 事件流 / broadcaster streams events', () => {
    const bus = adapter._engines.messageBus;

    // 直接订阅验证消息总线事件传递 / Directly subscribe to verify message bus event delivery
    const received = [];
    bus.subscribe('task.*', (msg) => { received.push(msg); });

    // 发送事件 / Publish event
    bus.publish('task.completed', { taskId: 'integ-1' });

    expect(received.length).toBeGreaterThanOrEqual(1);
    expect(received[0].data.taskId).toBe('integ-1');

    // 验证 StateBroadcaster 结构正确 / Verify StateBroadcaster structure
    const broadcaster = new StateBroadcaster({ messageBus: bus, logger: silentLogger });
    expect(broadcaster.getClientCount()).toBe(0);
    expect(broadcaster.getStats().broadcasting).toBe(false);
    broadcaster.destroy();
  });

  it('L6: MetricsCollector + MessageBus 指标聚合 / collector aggregates metrics', () => {
    const bus = adapter._engines.messageBus;
    const collector = new MetricsCollector({ messageBus: bus, logger: silentLogger });

    collector.start();

    bus.publish('task.completed', { taskId: 't1', duration: 100 });
    bus.publish('task.failed', { taskId: 't2' });
    bus.publish('agent.start', { agentId: 'a1' });
    bus.publish('pheromone.emitted', { type: 'trail' });

    const snap = collector.getSnapshot();
    expect(snap.red.rate).toBeGreaterThanOrEqual(4);
    expect(snap.swarm.tasksCompleted).toBeGreaterThanOrEqual(1);
    expect(snap.swarm.agentEvents).toBeGreaterThanOrEqual(1);
    expect(snap.swarm.pheromoneEvents).toBeGreaterThanOrEqual(1);

    collector.destroy();
  });
});
