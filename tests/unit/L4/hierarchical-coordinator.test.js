/**
 * HierarchicalCoordinator 单元测试 / HierarchicalCoordinator Unit Tests
 *
 * 测试 L4 层级蜂群协调器的深度限制、并发控制和生命周期管理。
 * Tests L4 hierarchical swarm coordinator depth limits, concurrency control,
 * and lifecycle management.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { HierarchicalCoordinator } from '../../../src/L4-orchestration/hierarchical-coordinator.js';

// ── 辅助函数 / Helpers ──────────────────────────────────────────────────────

const silentLogger = { info() {}, warn() {}, error() {}, debug() {} };

/** 模拟 MessageBus / Mock MessageBus */
function createMockBus() {
  const published = [];
  return {
    publish(topic, data) { published.push({ topic, data }); },
    subscribe() { return () => {}; },
    _published: published,
  };
}

/** 模拟 PheromoneEngine / Mock PheromoneEngine */
function createMockPheromone() {
  const emitted = [];
  return {
    emitPheromone(params) { emitted.push(params); },
    getHotspots() { return []; },
    _emitted: emitted,
  };
}

/** 模拟 AgentRepository / Mock AgentRepository */
function createMockAgentRepo() {
  return {
    listAgents() { return []; },
  };
}

// ── 测试 / Tests ────────────────────────────────────────────────────────────

describe('HierarchicalCoordinator', () => {
  let bus;
  let pheromone;
  let agentRepo;
  let coordinator;

  beforeEach(() => {
    bus = createMockBus();
    pheromone = createMockPheromone();
    agentRepo = createMockAgentRepo();
    coordinator = new HierarchicalCoordinator({
      messageBus: bus,
      pheromoneEngine: pheromone,
      agentRepo,
      logger: silentLogger,
      config: { maxDepth: 3, swarmMaxAgents: 5 },
    });
  });

  afterEach(() => {
    coordinator.destroy();
  });

  // ── subagent_spawning ──

  it('允许正常 spawn / allows normal spawn', () => {
    const result = coordinator.handleSubagentSpawning({
      childSessionKey: 'child-1',
      requesterSessionKey: 'parent-1',
    });
    expect(result.status).toBe('ok');
  });

  it('深度限制拒绝 / rejects spawn exceeding depth limit', () => {
    // 建立 3 层深度 / Build 3-level depth
    coordinator.handleSubagentSpawning({ childSessionKey: 'L1', requesterSessionKey: 'root' });
    coordinator.handleSubagentSpawning({ childSessionKey: 'L2', requesterSessionKey: 'L1' });
    coordinator.handleSubagentSpawning({ childSessionKey: 'L3', requesterSessionKey: 'L2' });

    // 第 4 层应被拒绝 / 4th level should be rejected
    const result = coordinator.handleSubagentSpawning({
      childSessionKey: 'L4',
      requesterSessionKey: 'L3',
    });
    expect(result.status).toBe('error');
    expect(result.errorMessage).toContain('exceeds max');
  });

  it('并发上限拒绝 / rejects spawn exceeding concurrency limit', () => {
    // 填满 5 个 agent / Fill up 5 agents
    for (let i = 0; i < 5; i++) {
      coordinator.handleSubagentSpawning({
        childSessionKey: `agent-${i}`,
        requesterSessionKey: 'root',
      });
    }

    // 第 6 个应被拒绝 / 6th should be rejected
    const result = coordinator.handleSubagentSpawning({
      childSessionKey: 'agent-5',
      requesterSessionKey: 'root',
    });
    expect(result.status).toBe('error');
    expect(result.errorMessage).toContain('swarm limit');
  });

  // ── subagent_spawned ──

  it('subagent_spawned 确认状态 / confirms spawn status', () => {
    coordinator.handleSubagentSpawning({ childSessionKey: 'c1', requesterSessionKey: 'p1' });
    coordinator.handleSubagentSpawned({ childSessionKey: 'c1' });

    const meta = coordinator.getMetadata('c1');
    expect(meta.status).toBe('active');
  });

  it('subagent_spawned 发布 agent.registered 事件 / publishes agent.registered event', () => {
    coordinator.handleSubagentSpawning({ childSessionKey: 'c1', requesterSessionKey: 'p1' });
    coordinator.handleSubagentSpawned({ childSessionKey: 'c1' });

    const events = bus._published.filter(e => e.topic === 'agent.registered');
    expect(events.length).toBe(1);
  });

  // ── subagent_ended ──

  it('subagent_ended 成功: 递减计数 + trail 信息素', () => {
    coordinator.handleSubagentSpawning({ childSessionKey: 'c1', requesterSessionKey: 'p1' });
    coordinator.handleSubagentSpawned({ childSessionKey: 'c1' });
    expect(coordinator.getStats().currentActiveAgents).toBe(1);

    coordinator.handleSubagentEnded({ targetSessionKey: 'c1', outcome: 'success' });
    expect(coordinator.getStats().currentActiveAgents).toBe(0);

    // trail 信息素 / Trail pheromone
    const trails = pheromone._emitted.filter(p => p.type === 'trail');
    expect(trails.length).toBe(1);
  });

  it('subagent_ended 失败: 递减计数 + alarm 信息素', () => {
    coordinator.handleSubagentSpawning({ childSessionKey: 'c1', requesterSessionKey: 'p1' });
    coordinator.handleSubagentEnded({ targetSessionKey: 'c1', outcome: 'error' });

    expect(coordinator.getStats().currentActiveAgents).toBe(0);
    const alarms = pheromone._emitted.filter(p => p.type === 'alarm');
    expect(alarms.length).toBe(1);
  });

  it('subagent_ended 非管理 Agent 静默 / silent for non-managed agent', () => {
    // 不应抛出 / Should not throw
    coordinator.handleSubagentEnded({ targetSessionKey: 'unknown', outcome: 'success' });
    expect(coordinator.getStats().currentActiveAgents).toBe(0);
  });

  // ── 层级查询 ──

  it('getChildren 返回子列表 / returns child list', () => {
    coordinator.handleSubagentSpawning({ childSessionKey: 'c1', requesterSessionKey: 'p1' });
    coordinator.handleSubagentSpawning({ childSessionKey: 'c2', requesterSessionKey: 'p1' });

    const children = coordinator.getChildren('p1');
    expect(children).toHaveLength(2);
    expect(children).toContain('c1');
    expect(children).toContain('c2');
  });

  it('isManaged 检查 / checks management status', () => {
    coordinator.handleSubagentSpawning({ childSessionKey: 'c1', requesterSessionKey: 'p1' });
    expect(coordinator.isManaged('c1')).toBe(true);
    expect(coordinator.isManaged('unknown')).toBe(false);
  });

  // ── 上下文构建 ──

  it('buildChildContext 返回蜂群上下文 / builds swarm context', () => {
    coordinator.handleSubagentSpawning({ childSessionKey: 'c1', requesterSessionKey: 'p1' });
    const ctx = coordinator.buildChildContext('c1');
    expect(ctx).toContain('蜂群层级');
    expect(ctx).toContain('1/3'); // depth 1, max 3
  });

  it('buildChildContext 未知 Agent 返回 null / returns null for unknown agent', () => {
    expect(coordinator.buildChildContext('unknown')).toBeNull();
  });

  // ── 去抖 ──

  it('去抖逻辑: tool_call 抑制文本解析 / dedup: tool_call suppresses text parsing', () => {
    expect(coordinator.shouldSuppressTextParsing('turn-1')).toBe(false);
    coordinator.recordToolCallDetected('turn-1');
    expect(coordinator.shouldSuppressTextParsing('turn-1')).toBe(true);
  });

  // ── getStats ──

  it('getStats 返回正确统计 / returns correct stats', () => {
    coordinator.handleSubagentSpawning({ childSessionKey: 'c1', requesterSessionKey: 'p1' });
    coordinator.handleSubagentSpawning({ childSessionKey: 'c2', requesterSessionKey: 'p1' });
    coordinator.handleSubagentEnded({ targetSessionKey: 'c1', outcome: 'success' });

    const stats = coordinator.getStats();
    expect(stats.maxDepth).toBe(3);
    expect(stats.swarmMaxAgents).toBe(5);
    expect(stats.currentActiveAgents).toBe(1);
    expect(stats.maxDepthSeen).toBe(1);
    expect(stats.completedCount).toBe(1);
  });

  // ── destroy ──

  it('destroy 清理所有状态 / clears all state', () => {
    coordinator.handleSubagentSpawning({ childSessionKey: 'c1', requesterSessionKey: 'p1' });
    coordinator.destroy();

    expect(coordinator.getStats().hierarchySize).toBe(0);
    expect(coordinator.getStats().currentActiveAgents).toBe(0);
  });
});
