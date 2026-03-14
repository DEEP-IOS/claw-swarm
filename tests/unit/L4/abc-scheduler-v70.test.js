/**
 * ABCScheduler V7.0 增量测试 / ABCScheduler V7.0 Incremental Tests
 *
 * V7.0 L4: getAgentRole() 角色查询方法测试
 * V7.0 L4: Tests for getAgentRole() role query method
 *
 * @author DEEP-IOS
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ABCScheduler } from '../../../src/L4-orchestration/abc-scheduler.js';

// ── 辅助 / Helpers ──────────────────────────────────────────────────────────

const silentLogger = { info() {}, warn() {}, error() {}, debug() {} };

/** 模拟 MessageBus / Mock MessageBus */
function createMockBus() {
  const published = [];
  return {
    publish(topic, data) { published.push({ topic, data }); },
    subscribe(topic, handler) { return () => {}; },
    _published: published,
  };
}

/**
 * 创建模拟 Agent 列表 / Create mock agent list
 *
 * @param {number} count
 * @param {Object} [overrides]
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

// ── 测试 / Tests ────────────────────────────────────────────────────────────

describe('ABCScheduler V7.0 — getAgentRole()', () => {
  let scheduler;

  beforeEach(() => {
    scheduler = new ABCScheduler({
      messageBus: createMockBus(),
      config: {},
      logger: silentLogger,
    });
  });

  // ━━━ 1. 未注册 agent 返回 'unknown' / Unregistered agent returns 'unknown' ━━━
  it('未注册 agent 返回 "unknown" / returns "unknown" for unregistered agent', () => {
    const role = scheduler.getAgentRole('nonexistent-agent');
    expect(role).toBe('unknown');
  });

  // ━━━ 2. classifyAgents 后返回正确角色 / Returns correct role after classifyAgents ━━━
  describe('after classifyAgents', () => {
    it('idle agent 被分类后有角色 / idle agents have roles after classification', () => {
      const agents = createMockAgents(10);
      const { employed, onlookers, scouts } = scheduler.classifyAgents(agents);

      // 验证每个分组中的 agent 都有正确角色
      // Verify each grouped agent has the correct role
      for (const agent of employed) {
        const role = scheduler.getAgentRole(agent.id);
        expect(role).toBe('employed');
      }

      for (const agent of onlookers) {
        const role = scheduler.getAgentRole(agent.id);
        expect(role).toBe('onlooker');
      }

      for (const agent of scouts) {
        const role = scheduler.getAgentRole(agent.id);
        expect(role).toBe('scout');
      }
    });

    it('busy agent 被分类为 employed / busy agents classified as employed', () => {
      const agents = [
        { id: 'busy-1', status: 'busy', taskId: 'task-A', performance: 0.7 },
        { id: 'busy-2', status: 'busy', taskId: 'task-B', performance: 0.6 },
        { id: 'idle-1', status: 'idle', taskId: null, performance: 0.5 },
        { id: 'idle-2', status: 'idle', taskId: null, performance: 0.4 },
      ];

      scheduler.classifyAgents(agents);

      // busy agents 应被分为 employed
      const r1 = scheduler.getAgentRole('busy-1');
      const r2 = scheduler.getAgentRole('busy-2');
      expect(r1).toBe('employed');
      expect(r2).toBe('employed');
    });

    it('分类结果中所有角色都是有效值 / all roles are valid values after classification', () => {
      const agents = createMockAgents(20);
      scheduler.classifyAgents(agents);

      const validRoles = ['employed', 'onlooker', 'scout'];
      for (const agent of agents) {
        const role = scheduler.getAgentRole(agent.id);
        expect(validRoles).toContain(role);
      }
    });
  });

  // ━━━ 3. reset 后角色丢失 / Role lost after reset ━━━
  it('reset 后 getAgentRole 返回 "unknown" / returns "unknown" after reset', () => {
    const agents = createMockAgents(5);
    scheduler.classifyAgents(agents);

    // 确认有角色 / Confirm role exists
    expect(scheduler.getAgentRole('agent-1')).not.toBe('unknown');

    // 重置 / Reset
    scheduler.reset();
    expect(scheduler.getAgentRole('agent-1')).toBe('unknown');
  });
});
