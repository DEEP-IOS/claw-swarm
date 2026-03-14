/**
 * ZoneManager V6.2 单元测试 / ZoneManager V6.2 Unit Tests
 *
 * 测试 Zone 选举增强:
 * Tests Zone election enhancements:
 * - setAgentLifecycle 生命周期绑定
 * - demoteLeader 降级方法
 * - electLeader 生命周期状态过滤
 * - zone.leader.elected 事件发布
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ZoneManager } from '../../../src/L4-orchestration/zone-manager.js';

// ── 模拟依赖 / Mock Dependencies ──

const logger = { info() {}, warn() {}, error() {}, debug() {} };

function createDeps(overrides = {}) {
  return {
    zoneRepo: {
      getZone: vi.fn(),
      listZones: vi.fn(() => []),
      getMembers: vi.fn(() => []),
      getMemberCount: vi.fn(() => 0),
      updateMemberRole: vi.fn(),
      updateZone: vi.fn(),
      addMember: vi.fn(),
      createZone: vi.fn(() => 'zone-1'),
    },
    agentRepo: {
      getAgent: vi.fn(() => ({
        agentId: 'agent-1',
        success_count: 95,
        failure_count: 5,
        total_score: 900,
        contribution_points: 500,
      })),
    },
    messageBus: { publish: vi.fn(), subscribe: vi.fn(() => () => {}) },
    logger,
    ...overrides,
  };
}

// ── Tests ──

describe('ZoneManager V6.2 — Election Enhancements', () => {
  let zm;
  let deps;
  let agentLifecycle;

  beforeEach(() => {
    deps = createDeps();
    zm = new ZoneManager(deps);
    agentLifecycle = { getState: vi.fn(() => 'ACTIVE') };
  });

  // ━━━ 1. setAgentLifecycle ━━━

  it('should have setAgentLifecycle method', () => {
    expect(typeof zm.setAgentLifecycle).toBe('function');
    zm.setAgentLifecycle(agentLifecycle);
    expect(zm._agentLifecycle).toBe(agentLifecycle);
  });

  // ━━━ 2. demoteLeader ━━━

  it('should have demoteLeader method', () => {
    expect(typeof zm.demoteLeader).toBe('function');
  });

  // ━━━ 3. electLeader 生命周期状态过滤 ━━━

  it('electLeader should filter by lifecycle state', () => {
    zm.setAgentLifecycle(agentLifecycle);

    // 配置 mock: Zone 存在, 有一个成员
    // Configure mock: zone exists with one member
    deps.zoneRepo.getZone.mockReturnValue({ id: 'zone-1', name: 'test-zone' });
    deps.zoneRepo.getMembers.mockReturnValue([
      { agent_id: 'agent-1', role: 'member' },
    ]);
    agentLifecycle.getState.mockReturnValue('ACTIVE');

    const result = zm.electLeader('zone-1');
    expect(result).not.toBeNull();
    expect(result.leaderId).toBe('agent-1');
    expect(agentLifecycle.getState).toHaveBeenCalledWith('agent-1');
  });

  it('electLeader should skip agents in MAINTENANCE state', () => {
    zm.setAgentLifecycle(agentLifecycle);

    deps.zoneRepo.getZone.mockReturnValue({ id: 'zone-1', name: 'test-zone' });
    deps.zoneRepo.getMembers.mockReturnValue([
      { agent_id: 'agent-1', role: 'member' },
    ]);
    // Agent 处于 MAINTENANCE 状态, 不应被选举
    // Agent in MAINTENANCE state should be skipped
    agentLifecycle.getState.mockReturnValue('MAINTENANCE');

    const result = zm.electLeader('zone-1');
    expect(result).toBeNull();
  });

  it('electLeader should work without agentLifecycle', () => {
    // 不设置 agentLifecycle, 选举仍应正常工作
    // Without agentLifecycle, election should still work
    deps.zoneRepo.getZone.mockReturnValue({ id: 'zone-1', name: 'test-zone' });
    deps.zoneRepo.getMembers.mockReturnValue([
      { agent_id: 'agent-1', role: 'member' },
    ]);

    const result = zm.electLeader('zone-1');
    expect(result).not.toBeNull();
    expect(result.leaderId).toBe('agent-1');
  });

  // ━━━ 4. demoteLeader 降级并发布事件 ━━━

  it('demoteLeader should demote and publish event', () => {
    deps.zoneRepo.getZone.mockReturnValue({
      id: 'zone-1',
      name: 'test-zone',
      leaderId: 'agent-1',
    });

    const result = zm.demoteLeader('zone-1', { reason: 'performance' });

    expect(result).not.toBeNull();
    expect(result.demotedAgentId).toBe('agent-1');
    expect(result.reason).toBe('performance');

    // 应调用 repo 更新 / Should call repo updates
    expect(deps.zoneRepo.updateMemberRole).toHaveBeenCalledWith('zone-1', 'agent-1', 'member');
    expect(deps.zoneRepo.updateZone).toHaveBeenCalledWith('zone-1', { leaderId: null });

    // 应发布降级事件 / Should publish demotion event
    const demotionCall = deps.messageBus.publish.mock.calls.find(
      ([topic]) => topic === 'zone.leader.demoted',
    );
    expect(demotionCall).toBeDefined();
  });

  it('demoteLeader should return null when no leader', () => {
    deps.zoneRepo.getZone.mockReturnValue({
      id: 'zone-1',
      name: 'test-zone',
      leaderId: null,
    });

    const result = zm.demoteLeader('zone-1');
    expect(result).toBeNull();
  });

  // ━━━ 5. zone.leader.elected 事件 ━━━

  it('should publish zone.leader.elected event', () => {
    deps.zoneRepo.getZone.mockReturnValue({ id: 'zone-1', name: 'test-zone' });
    deps.zoneRepo.getMembers.mockReturnValue([
      { agent_id: 'agent-1', role: 'member' },
    ]);

    zm.electLeader('zone-1');

    const electionCall = deps.messageBus.publish.mock.calls.find(
      ([topic]) => topic === 'zone.leader.elected',
    );
    expect(electionCall).toBeDefined();
    expect(electionCall[1]).toHaveProperty('leaderId', 'agent-1');
    expect(electionCall[1]).toHaveProperty('zoneId', 'zone-1');
  });
});
