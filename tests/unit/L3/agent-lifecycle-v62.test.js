/**
 * AgentLifecycle V6.2 单元测试 / AgentLifecycle V6.2 Unit Tests
 *
 * 无需真实数据库, 使用 mock 测试 8 态有限状态机。
 * No real DB needed, uses mocks to test 8-state finite state machine.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentLifecycle, LIFECYCLE_STATES } from '../../../src/L3-agent/agent-lifecycle.js';

// 静默 logger / Silent logger
const silentLogger = { info() {}, warn() {}, error() {}, debug() {} };

describe('AgentLifecycle', () => {
  let lifecycle;
  let messageBus;
  let agentRepo;

  beforeEach(() => {
    messageBus = {
      publish: vi.fn(),
      subscribe: vi.fn(() => () => {}),
    };

    agentRepo = {};

    lifecycle = new AgentLifecycle({
      messageBus,
      agentRepo,
      logger: silentLogger,
    });
  });

  // ━━━ 1. LIFECYCLE_STATES 导出 / LIFECYCLE_STATES export ━━━

  it('should export LIFECYCLE_STATES enum', () => {
    expect(LIFECYCLE_STATES).toBeDefined();
    expect(typeof LIFECYCLE_STATES).toBe('object');
    expect(Object.isFrozen(LIFECYCLE_STATES)).toBe(true);
  });

  // ━━━ 2. 8 个状态 / 8 states ━━━

  it('LIFECYCLE_STATES should have 8 states', () => {
    const states = Object.keys(LIFECYCLE_STATES);
    expect(states).toHaveLength(8);
    expect(states).toContain('INIT');
    expect(states).toContain('IDLE');
    expect(states).toContain('ACTIVE');
    expect(states).toContain('BUSY');
    expect(states).toContain('PAUSED');
    expect(states).toContain('STANDBY');
    expect(states).toContain('MAINTENANCE');
    expect(states).toContain('RETIRED');
  });

  // ━━━ 3. 新 agent 默认 INIT / New agent defaults to INIT ━━━

  it('new agent should default to INIT state', () => {
    const state = lifecycle.getState('agent-new');
    expect(state).toBe(LIFECYCLE_STATES.INIT);
  });

  // ━━━ 4. INIT -> IDLE 转换 / INIT -> IDLE transition ━━━

  it('should transition from INIT to IDLE', () => {
    const result = lifecycle.transition('agent-1', LIFECYCLE_STATES.IDLE);
    expect(result.success).toBe(true);
    expect(result.from).toBe(LIFECYCLE_STATES.INIT);
    expect(result.to).toBe(LIFECYCLE_STATES.IDLE);
    expect(lifecycle.getState('agent-1')).toBe(LIFECYCLE_STATES.IDLE);
  });

  // ━━━ 5. IDLE -> ACTIVE 转换 / IDLE -> ACTIVE transition ━━━

  it('should transition from IDLE to ACTIVE', () => {
    lifecycle.transition('agent-2', LIFECYCLE_STATES.IDLE);
    const result = lifecycle.transition('agent-2', LIFECYCLE_STATES.ACTIVE);
    expect(result.success).toBe(true);
    expect(result.from).toBe(LIFECYCLE_STATES.IDLE);
    expect(result.to).toBe(LIFECYCLE_STATES.ACTIVE);
    expect(lifecycle.getState('agent-2')).toBe(LIFECYCLE_STATES.ACTIVE);
  });

  // ━━━ 6. ACTIVE -> BUSY 转换 / ACTIVE -> BUSY transition ━━━

  it('should transition from ACTIVE to BUSY', () => {
    lifecycle.transition('agent-3', LIFECYCLE_STATES.IDLE);
    lifecycle.transition('agent-3', LIFECYCLE_STATES.ACTIVE);
    const result = lifecycle.transition('agent-3', LIFECYCLE_STATES.BUSY);
    expect(result.success).toBe(true);
    expect(result.from).toBe(LIFECYCLE_STATES.ACTIVE);
    expect(result.to).toBe(LIFECYCLE_STATES.BUSY);
    expect(lifecycle.getState('agent-3')).toBe(LIFECYCLE_STATES.BUSY);
  });

  // ━━━ 7. 非法转换 INIT -> ACTIVE / Illegal transition INIT -> ACTIVE ━━━

  it('should reject invalid transitions (INIT -> ACTIVE)', () => {
    const result = lifecycle.transition('agent-bad', LIFECYCLE_STATES.ACTIVE);
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.from).toBe(LIFECYCLE_STATES.INIT);
    expect(result.to).toBe(LIFECYCLE_STATES.ACTIVE);
    // 状态应保持不变 / State should remain unchanged
    expect(lifecycle.getState('agent-bad')).toBe(LIFECYCLE_STATES.INIT);
  });

  // ━━━ 8. 终态 RETIRED 不可转换 / Terminal RETIRED cannot transition ━━━

  it('should reject invalid transitions (RETIRED -> any)', () => {
    // 构建路径到 RETIRED: INIT -> IDLE -> RETIRED
    // Build path to RETIRED: INIT -> IDLE -> RETIRED
    lifecycle.transition('agent-ret', LIFECYCLE_STATES.IDLE);
    lifecycle.transition('agent-ret', LIFECYCLE_STATES.RETIRED);
    expect(lifecycle.getState('agent-ret')).toBe(LIFECYCLE_STATES.RETIRED);

    // 尝试从 RETIRED 转换 / Try to transition from RETIRED
    const result = lifecycle.transition('agent-ret', LIFECYCLE_STATES.IDLE);
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(lifecycle.getState('agent-ret')).toBe(LIFECYCLE_STATES.RETIRED);
  });

  // ━━━ 9. 拒绝未知状态 / Reject unknown state ━━━

  it('should reject transition to unknown state', () => {
    const result = lifecycle.transition('agent-unk', 'FLYING');
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  // ━━━ 10. canTransition 合法返回 true / canTransition returns true for valid ━━━

  it('canTransition should return true for valid transitions', () => {
    // 新 agent 默认 INIT, INIT -> IDLE 合法 / New agent default INIT, INIT -> IDLE is valid
    expect(lifecycle.canTransition('agent-can', LIFECYCLE_STATES.IDLE)).toBe(true);

    // 转换到 IDLE 后, IDLE -> ACTIVE 合法 / After IDLE, IDLE -> ACTIVE is valid
    lifecycle.transition('agent-can', LIFECYCLE_STATES.IDLE);
    expect(lifecycle.canTransition('agent-can', LIFECYCLE_STATES.ACTIVE)).toBe(true);
    expect(lifecycle.canTransition('agent-can', LIFECYCLE_STATES.STANDBY)).toBe(true);
  });

  // ━━━ 11. canTransition 非法返回 false / canTransition returns false for invalid ━━━

  it('canTransition should return false for invalid transitions', () => {
    // INIT -> ACTIVE 不合法 / INIT -> ACTIVE is invalid
    expect(lifecycle.canTransition('agent-cant', LIFECYCLE_STATES.ACTIVE)).toBe(false);
    expect(lifecycle.canTransition('agent-cant', LIFECYCLE_STATES.BUSY)).toBe(false);
    // 未知状态 / Unknown state
    expect(lifecycle.canTransition('agent-cant', 'FLYING')).toBe(false);
  });

  // ━━━ 12. 转换发布生命周期事件 / Transition publishes lifecycle event ━━━

  it('transition should publish lifecycle event', () => {
    lifecycle.transition('agent-ev', LIFECYCLE_STATES.IDLE);

    expect(messageBus.publish).toHaveBeenCalled();
    const [topic, event] = messageBus.publish.mock.calls[0];
    expect(topic).toBe('agent.lifecycle.transition');
    expect(event.payload.agentId).toBe('agent-ev');
    expect(event.payload.from).toBe(LIFECYCLE_STATES.INIT);
    expect(event.payload.to).toBe(LIFECYCLE_STATES.IDLE);
  });

  // ━━━ 13. 转换历史 / Transition history ━━━

  it('getTransitionHistory should return recent transitions', () => {
    lifecycle.transition('agent-hist', LIFECYCLE_STATES.IDLE);
    lifecycle.transition('agent-hist', LIFECYCLE_STATES.ACTIVE);
    lifecycle.transition('agent-hist', LIFECYCLE_STATES.BUSY);

    const history = lifecycle.getTransitionHistory('agent-hist', { limit: 10 });
    expect(history).toHaveLength(3);
    expect(history[0].from).toBe(LIFECYCLE_STATES.INIT);
    expect(history[0].to).toBe(LIFECYCLE_STATES.IDLE);
    expect(history[2].from).toBe(LIFECYCLE_STATES.ACTIVE);
    expect(history[2].to).toBe(LIFECYCLE_STATES.BUSY);
    expect(history[0].transitionId).toBeDefined();
    expect(history[0].timestamp).toBeDefined();
  });

  // ━━━ 14. 历史上限 50 条 / History capped at 50 entries ━━━

  it('history should be capped at 50 entries', () => {
    // 执行超过 50 次转换 (IDLE <-> ACTIVE 循环)
    // Perform more than 50 transitions (IDLE <-> ACTIVE loop)
    lifecycle.transition('agent-cap', LIFECYCLE_STATES.IDLE);
    for (let i = 0; i < 55; i++) {
      lifecycle.transition('agent-cap', LIFECYCLE_STATES.ACTIVE);
      lifecycle.transition('agent-cap', LIFECYCLE_STATES.IDLE);
    }

    // 1 次 INIT->IDLE + 55*2 次 IDLE<->ACTIVE = 111 次转换, 但历史应被截断
    // 1 INIT->IDLE + 55*2 IDLE<->ACTIVE = 111 transitions, but history should be capped
    const history = lifecycle.getTransitionHistory('agent-cap', { limit: 100 });
    expect(history.length).toBeLessThanOrEqual(50);
  });

  // ━━━ 15. getAllStates 返回 Map / getAllStates returns Map ━━━

  it('getAllStates should return Map of all agent states', () => {
    lifecycle.transition('agent-a', LIFECYCLE_STATES.IDLE);
    lifecycle.transition('agent-b', LIFECYCLE_STATES.IDLE);
    lifecycle.transition('agent-b', LIFECYCLE_STATES.ACTIVE);

    const allStates = lifecycle.getAllStates();
    expect(allStates).toBeInstanceOf(Map);
    expect(allStates.get('agent-a')).toBe(LIFECYCLE_STATES.IDLE);
    expect(allStates.get('agent-b')).toBe(LIFECYCLE_STATES.ACTIVE);
  });

  // ━━━ 16. getStats 跟踪转换计数 / getStats tracks transition counts ━━━

  it('getStats should track transition counts', () => {
    lifecycle.transition('agent-s1', LIFECYCLE_STATES.IDLE);
    lifecycle.transition('agent-s1', LIFECYCLE_STATES.ACTIVE);
    lifecycle.transition('agent-s2', LIFECYCLE_STATES.IDLE);
    // 一次非法转换 / One invalid transition
    lifecycle.transition('agent-s2', LIFECYCLE_STATES.BUSY);

    const stats = lifecycle.getStats();
    expect(stats.totalTransitions).toBe(4);
    expect(stats.successfulTransitions).toBe(3);
    expect(stats.rejectedTransitions).toBe(1);
    expect(stats.agentCount).toBe(2);
    expect(stats.transitionCounts['INIT\u2192IDLE']).toBe(2);
    expect(stats.transitionCounts['IDLE\u2192ACTIVE']).toBe(1);
    expect(stats.stateDistribution).toBeDefined();
    expect(stats.stateDistribution[LIFECYCLE_STATES.ACTIVE]).toBe(1);
    expect(stats.stateDistribution[LIFECYCLE_STATES.IDLE]).toBe(1);
  });
});
