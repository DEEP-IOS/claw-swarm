/**
 * HealthChecker V5.2 单元测试 / HealthChecker V5.2 Unit Tests
 *
 * 测试 V5.2 新增功能: recordActivity + getIdleAgents
 * Tests V5.2 additions: recordActivity + getIdleAgents
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { HealthChecker } from '../../../src/L6-monitoring/health-checker.js';

// ── 模拟依赖 / Mock Dependencies ──

function createMockBus() {
  const _published = [];
  const _subscriptions = new Map();
  return {
    publish(topic, data) { _published.push({ topic, data }); },
    subscribe(topic, handler) {
      if (!_subscriptions.has(topic)) _subscriptions.set(topic, []);
      _subscriptions.get(topic).push(handler);
    },
    _published,
    _subscriptions,
  };
}

const logger = { info() {}, warn() {}, error() {}, debug() {} };

// ── 测试 / Tests ──

describe('HealthChecker V5.2 — recordActivity', () => {
  let checker, bus;

  beforeEach(() => {
    bus = createMockBus();
    checker = new HealthChecker({
      messageBus: bus,
      logger,
      pluginAdapter: null,
    });
  });

  afterEach(() => {
    checker.stop();
  });

  it('记录 agent 活动时间戳 / records agent activity timestamp', () => {
    const before = Date.now();
    checker.recordActivity('agent-001');
    const after = Date.now();

    // 验证内部 _lastActivity 已设置 / Verify internal _lastActivity was set
    const lastActive = checker._lastActivity.get('agent-001');
    expect(lastActive !== undefined).toBe(true);
    expect(lastActive).toBeGreaterThanOrEqual(before);
    expect(lastActive).toBeLessThanOrEqual(after);
  });

  it('多次记录更新时间戳 / subsequent records update timestamp', async () => {
    checker.recordActivity('agent-002');
    const first = checker._lastActivity.get('agent-002');

    // 等待少许时间确保时间戳不同 / Small delay to ensure different timestamp
    await new Promise(resolve => setTimeout(resolve, 10));

    checker.recordActivity('agent-002');
    const second = checker._lastActivity.get('agent-002');

    expect(second).toBeGreaterThanOrEqual(first);
  });

  it('null/undefined agentId 不记录 / null/undefined agentId is ignored', () => {
    checker.recordActivity(null);
    checker.recordActivity(undefined);
    checker.recordActivity('');

    // null 和 undefined 不应记录，空字符串也不应记录 (falsy)
    expect(checker._lastActivity.has(null)).toBe(false);
    expect(checker._lastActivity.has(undefined)).toBe(false);
  });
});

describe('HealthChecker V5.2 — getIdleAgents', () => {
  let checker, bus;

  beforeEach(() => {
    bus = createMockBus();
    checker = new HealthChecker({
      messageBus: bus,
      logger,
      pluginAdapter: null,
    });
  });

  afterEach(() => {
    checker.stop();
  });

  it('初始状态返回空 / returns empty array initially', () => {
    const idle = checker.getIdleAgents();

    expect(idle).toEqual([]);
  });

  it('无在线 agent 时返回空 / returns empty when no online agents', () => {
    // 记录活动但不注册为在线 / Record activity but not registered as online
    checker.recordActivity('agent-x');

    const idle = checker.getIdleAgents();

    expect(idle).toEqual([]);
  });

  it('在线但未超过空闲阈值时不算空闲 / online agent within threshold is not idle', () => {
    // 手动注册 agent 为在线 / Manually register agent as online
    checker._connectionStatus.set('agent-active', 'online');
    checker.recordActivity('agent-active');

    const idle = checker.getIdleAgents();

    expect(idle).toEqual([]);
  });

  it('在线且超过空闲阈值时视为空闲 / online agent exceeding threshold is idle', () => {
    // 手动注册 agent 为在线 / Manually register agent as online
    checker._connectionStatus.set('agent-lazy', 'online');

    // 设置活动时间为远过去（超过 5 分钟）
    // Set activity time to far past (exceeds 5 min threshold)
    checker._lastActivity.set('agent-lazy', Date.now() - 10 * 60 * 1000);

    const idle = checker.getIdleAgents();

    expect(idle).toContain('agent-lazy');
  });

  it('离线 agent 不算空闲 / offline agents are not counted as idle', () => {
    checker._connectionStatus.set('agent-offline', 'offline');
    checker._lastActivity.set('agent-offline', Date.now() - 10 * 60 * 1000);

    const idle = checker.getIdleAgents();

    expect(idle).not.toContain('agent-offline');
  });
});

describe('HealthChecker V5.2 — getScore', () => {
  let checker, bus;

  beforeEach(() => {
    bus = createMockBus();
    checker = new HealthChecker({
      messageBus: bus,
      logger,
      pluginAdapter: null,
    });
  });

  afterEach(() => {
    checker.stop();
  });

  it('初始评分为 100 / initial score is 100', () => {
    const score = checker.getScore();

    expect(score).toBe(100);
  });
});
