/**
 * EvidenceGate V6.2 单元测试 / EvidenceGate V6.2 Unit Tests
 *
 * 测试 DualProcessRouter 集成:
 * Tests DualProcessRouter integration:
 * - setDualProcessRouter 方法
 * - getAdaptiveMinScore 自适应阈值
 * - evaluateClaim 自适应评估
 * - getClaimScoreForQuality 归一化分数
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EvidenceGate } from '../../../src/L3-agent/evidence-gate.js';

// ── 模拟依赖 / Mock Dependencies ──

function createMockBus() {
  const events = [];
  return {
    publish(topic, data) { events.push({ topic, data }); },
    subscribe: vi.fn(() => () => {}),
    events,
  };
}

function createMockRouter() {
  return {
    route: vi.fn((ctx) =>
      ctx?.forceSystem2
        ? { system: 2, decision: 'SYSTEM_2' }
        : { system: 1, decision: 'SYSTEM_1' },
    ),
  };
}

const logger = { info() {}, warn() {}, error() {}, debug() {} };

// ── Tests ──

describe('EvidenceGate V6.2 — DualProcessRouter Integration', () => {
  let gate;
  let mockBus;
  let dualProcessRouter;

  beforeEach(() => {
    mockBus = createMockBus();
    dualProcessRouter = createMockRouter();
    gate = new EvidenceGate({
      messageBus: mockBus,
      logger,
    });
  });

  // ━━━ 1. setDualProcessRouter ━━━

  it('should have setDualProcessRouter method', () => {
    expect(typeof gate.setDualProcessRouter).toBe('function');
    gate.setDualProcessRouter(dualProcessRouter);
    expect(gate._dualProcessRouter).toBe(dualProcessRouter);
  });

  // ━━━ 2. getAdaptiveMinScore ━━━

  it('should have getAdaptiveMinScore method', () => {
    expect(typeof gate.getAdaptiveMinScore).toBe('function');
  });

  it('getAdaptiveMinScore should return 0.6 for System 2', () => {
    gate.setDualProcessRouter(dualProcessRouter);
    const score = gate.getAdaptiveMinScore({ forceSystem2: true });
    expect(score).toBe(0.6);
  });

  it('getAdaptiveMinScore should return 0.2 for System 1', () => {
    gate.setDualProcessRouter(dualProcessRouter);
    const score = gate.getAdaptiveMinScore({ forceSystem2: false });
    expect(score).toBe(0.2);
  });

  it('getAdaptiveMinScore should return default when no router', () => {
    // 无路由器时使用默认 minScore (0.3)
    const score = gate.getAdaptiveMinScore({});
    expect(score).toBe(0.3);
  });

  // ━━━ 3. evaluateClaim 自适应评估 ━━━

  it('evaluateClaim should use adaptive score when router set', () => {
    gate.setDualProcessRouter(dualProcessRouter);

    // 注册一个得分 ~0.4 的 claim (PRIMARY weight=1.0 * reliability=0.4 = 0.4)
    // Register a claim scoring ~0.4
    const { claimId } = gate.registerClaim({
      agentId: 'D1',
      content: 'Moderate evidence claim',
      evidences: [
        { tier: 'PRIMARY', source: 'api:test', reliability: 0.4 },
      ],
    });

    // System 1 路由 (阈值 0.2): 0.4 > 0.2 → 应通过
    // System 1 route (threshold 0.2): 0.4 > 0.2 → should pass
    const result = gate.evaluateClaim(claimId);
    expect(result.meetsStandard).toBe(true);
  });

  // ━━━ 4. getClaimScoreForQuality ━━━

  it('should have getClaimScoreForQuality method', () => {
    expect(typeof gate.getClaimScoreForQuality).toBe('function');
  });

  it('getClaimScoreForQuality should return normalized score', () => {
    const { claimId } = gate.registerClaim({
      agentId: 'D1',
      content: 'Quality claim',
      evidences: [
        { tier: 'PRIMARY', source: 'api:data', reliability: 0.9 },
      ],
    });

    const score = gate.getClaimScoreForQuality(claimId);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
    // PRIMARY weight=1.0 * reliability=0.9 = 0.9
    expect(score).toBe(0.9);

    // 不存在的 claim 返回 null / Non-existent claim returns null
    expect(gate.getClaimScoreForQuality('nonexistent')).toBeNull();
  });
});
