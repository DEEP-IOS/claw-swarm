/**
 * GovernanceMetrics V6.2 单元测试 / GovernanceMetrics V6.2 Unit Tests
 *
 * 测试 Holling 韧性指标方法:
 * Tests Holling resilience metric methods:
 * - circuitBreaker 构造函数注入
 * - computeResilience() 三维韧性指标
 * - 断路器状态转换追踪
 * - 恢复时间计算
 * - 最大并发故障追踪
 * - getGovernanceSummary 韧性字段
 * - 韧性缓冲上限
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GovernanceMetrics } from '../../../src/L4-orchestration/governance-metrics.js';

// ── 模拟依赖 / Mock Dependencies ──

const logger = { info() {}, warn() {}, error() {}, debug() {} };

function createDeps(overrides = {}) {
  return {
    swarmAdvisor: { getTurnState: vi.fn(), getStats: vi.fn(() => ({ totalTurns: 10 })) },
    globalModulator: { getMode: vi.fn(() => 'EXPLOIT'), getStability: vi.fn(() => 8), getStats: vi.fn(() => ({ switchStability: 5 })) },
    budgetTracker: { getStats: vi.fn(() => ({})) },
    observabilityCore: { getTimeline: vi.fn(() => []) },
    messageBus: { publish: vi.fn(), subscribe: vi.fn(() => () => {}) },
    db: { get: vi.fn(() => null) },
    logger,
    ...overrides,
  };
}

// ── Tests ──

describe('GovernanceMetrics V6.2 — Holling Resilience', () => {
  let gm;
  let deps;

  beforeEach(() => {
    deps = createDeps();
    gm = new GovernanceMetrics(deps);
  });

  // ━━━ 1. circuitBreaker 构造函数注入 ━━━

  it('should accept circuitBreaker in constructor', () => {
    const circuitBreaker = {};
    const gm2 = new GovernanceMetrics(createDeps({ circuitBreaker }));
    expect(gm2._circuitBreaker).toBe(circuitBreaker);
  });

  // ━━━ 2. computeResilience 三维指标 ━━━

  describe('computeResilience', () => {
    it('should return three dimensions', () => {
      const result = gm.computeResilience();
      expect(result).toHaveProperty('recoveryTime');
      expect(result).toHaveProperty('resistance');
      expect(result).toHaveProperty('ecologicalResilience');
    });

    it('should return defaults when no data', () => {
      const result = gm.computeResilience();
      expect(result.recoveryTime).toBe(0);
      expect(result.resistance).toBe(1.0);
      expect(result.ecologicalResilience).toBe(0);
    });
  });

  // ━━━ 3. 断路器状态转换追踪 ━━━

  it('should track breaker transitions in resilience buffer', () => {
    gm._recordBreakerTransition({
      payload: { from: 'CLOSED', to: 'OPEN', toolId: 'tool-1' },
    });
    gm._recordBreakerTransition({
      payload: { from: 'OPEN', to: 'HALF_OPEN', toolId: 'tool-1' },
    });

    expect(gm._resilienceBuffer).toHaveLength(2);
    expect(gm._resilienceBuffer[0].from).toBe('CLOSED');
    expect(gm._resilienceBuffer[0].to).toBe('OPEN');
    expect(gm._resilienceBuffer[0].toolId).toBe('tool-1');
    expect(gm._resilienceBuffer[1].to).toBe('HALF_OPEN');
  });

  // ━━━ 4. 恢复时间计算 ━━━

  it('should compute recovery time from OPEN→CLOSED transitions', () => {
    const now = Date.now();

    // 手动构建 OPEN → CLOSED 事件对, 间隔 1000ms
    // Manually build OPEN → CLOSED event pair with 1000ms interval
    gm._resilienceBuffer.push(
      { from: 'CLOSED', to: 'OPEN', toolId: 'tool-A', timestamp: now },
      { from: 'OPEN', to: 'CLOSED', toolId: 'tool-A', timestamp: now + 1000 },
    );

    const result = gm.computeResilience();
    expect(result.recoveryTime).toBe(1000);
  });

  // ━━━ 5. 最大并发故障追踪 ━━━

  it('should track max concurrent faults', () => {
    // 同时打开两个断路器 / Open two breakers simultaneously
    gm._recordBreakerTransition({
      payload: { from: 'CLOSED', to: 'OPEN', toolId: 'tool-X' },
    });
    gm._recordBreakerTransition({
      payload: { from: 'CLOSED', to: 'OPEN', toolId: 'tool-Y' },
    });
    expect(gm._maxConcurrentFaults).toBe(2);

    // 关闭一个后, 最大值应保持 / After closing one, max should persist
    gm._recordBreakerTransition({
      payload: { from: 'OPEN', to: 'CLOSED', toolId: 'tool-X' },
    });
    expect(gm._maxConcurrentFaults).toBe(2);
    expect(gm._openBreakers.size).toBe(1);

    const result = gm.computeResilience();
    expect(result.ecologicalResilience).toBe(2);
  });

  // ━━━ 6. getGovernanceSummary 韧性字段 ━━━

  it('getGovernanceSummary should include resilience', () => {
    const summary = gm.getGovernanceSummary();
    expect(summary).toHaveProperty('resilience');
    expect(summary.resilience).toHaveProperty('recoveryTime');
    expect(summary.resilience).toHaveProperty('resistance');
    expect(summary.resilience).toHaveProperty('ecologicalResilience');
  });

  // ━━━ 7. 韧性缓冲上限 ━━━

  it('resilience buffer should cap at 100 entries', () => {
    for (let i = 0; i < 120; i++) {
      gm._recordBreakerTransition({
        payload: { from: 'CLOSED', to: 'OPEN', toolId: `tool-${i}` },
      });
    }
    expect(gm._resilienceBuffer.length).toBeLessThanOrEqual(100);
  });
});
