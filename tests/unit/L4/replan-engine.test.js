/**
 * ReplanEngine 单元测试 / ReplanEngine Unit Tests
 *
 * 无需真实数据库, 使用 mock PheromoneEngine 测试重规划引擎。
 * No real DB needed, uses mock PheromoneEngine to test replanning engine.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { ReplanEngine } from '../../../src/L4-orchestration/replan-engine.js';

// 静默 logger / Silent logger
const silentLogger = { info() {}, warn() {}, error() {}, debug() {} };

// Mock MessageBus / 模拟消息总线
const mockBus = { publish() {}, subscribe() {} };

/**
 * 创建 mock PheromoneEngine / Create mock PheromoneEngine
 *
 * @param {number} alarmCount - getAlarmDensity 返回的 ALARM 数量
 * @returns {Object}
 */
function createMockPheromoneEngine(alarmCount = 0) {
  return {
    getAlarmDensity(scope, threshold) {
      return {
        count: alarmCount,
        totalIntensity: alarmCount * 0.5,
        triggered: alarmCount >= threshold,
      };
    },
    getMMASBounds(type) {
      return { mmasMin: 0.05, mmasMax: 1.0 };
    },
  };
}

describe('ReplanEngine', () => {
  let engine;

  beforeEach(() => {
    engine = new ReplanEngine({
      pheromoneEngine: createMockPheromoneEngine(0),
      messageBus: mockBus,
      config: {
        alarmThreshold: 3,
        baseDelayMs: 100,    // 短延迟以加速测试 / Short delay for fast tests
        maxDelayMs: 10000,
        cooldownMs: 200,     // 短冷却期 / Short cooldown
        maxReplans: 10,
      },
      logger: silentLogger,
    });
  });

  // ━━━ 1. shouldReplan 检测 / shouldReplan with mock pheromone engine ━━━
  describe('shouldReplan', () => {
    it('ALARM 密度不足时不应重规划 / should not replan when ALARM density is below threshold', () => {
      // 默认 alarmCount = 0 / Default alarmCount = 0
      const result = engine.shouldReplan('task/test-1');

      expect(result.should).toBe(false);
      expect(result.alarmCount).toBe(0);
    });

    it('ALARM 密度达到阈值时应重规划 / should replan when ALARM density meets threshold', () => {
      // 替换为高密度 mock / Replace with high-density mock
      engine._pheromoneEngine = createMockPheromoneEngine(5);

      const result = engine.shouldReplan('task/test-2');

      expect(result.should).toBe(true);
      expect(result.alarmCount).toBe(5);
      expect(result.density).toBeGreaterThan(0);
    });
  });

  // ━━━ 2. checkAndReplan 触发 / triggers when ALARM density high ━━━
  describe('checkAndReplan triggers', () => {
    it('ALARM 密度高时应执行重规划 / should execute replan when ALARM density is high', () => {
      engine._pheromoneEngine = createMockPheromoneEngine(5);

      const result = engine.checkAndReplan('task-high', 'task/high');

      expect(result.replanned).toBe(true);
      expect(result.reason).toBe('alarm_threshold_met');
      expect(result.cooldownMs).toBeGreaterThan(0);

      // 统计应更新 / Stats should update
      const stats = engine.getStats();
      expect(stats.totalReplans).toBe(1);
      expect(stats.successfulReplans).toBe(1);
    });

    it('ALARM 密度低时不应执行重规划 / should not replan when ALARM density is low', () => {
      engine._pheromoneEngine = createMockPheromoneEngine(1);

      const result = engine.checkAndReplan('task-low', 'task/low');

      expect(result.replanned).toBe(false);
      expect(result.reason).toContain('alarm_below_threshold');
    });
  });

  // ━━━ 3. checkAndReplan 冷却期 / respects cooldown ━━━
  describe('checkAndReplan respects cooldown', () => {
    it('冷却期内不应重复触发 / should not trigger again during cooldown', () => {
      engine._pheromoneEngine = createMockPheromoneEngine(5);

      // 第一次: 应触发 / First: should trigger
      const first = engine.checkAndReplan('task-cool', 'task/cool');
      expect(first.replanned).toBe(true);

      // 第二次: 在冷却期内, 不应触发 / Second: within cooldown, should not trigger
      const second = engine.checkAndReplan('task-cool', 'task/cool');
      expect(second.replanned).toBe(false);
      expect(second.reason).toContain('in_cooldown');
      expect(second.cooldownMs).toBeGreaterThan(0);
    });
  });

  // ━━━ 4. 指数退避 / Exponential backoff ━━━
  describe('exponential backoff', () => {
    it('每次重规划后延迟应翻倍 / delay should double after each replan', async () => {
      engine._pheromoneEngine = createMockPheromoneEngine(5);

      // 第一次重规划 / First replan
      const r1 = engine.checkAndReplan('task-backoff', 'task/backoff');
      expect(r1.replanned).toBe(true);
      const cooldown1 = r1.cooldownMs;

      // 等待冷却期过后 / Wait for cooldown to expire
      await new Promise(resolve => setTimeout(resolve, cooldown1 + 50));

      // 第二次重规划 / Second replan
      const r2 = engine.checkAndReplan('task-backoff', 'task/backoff');
      expect(r2.replanned).toBe(true);
      const cooldown2 = r2.cooldownMs;

      // 第二次冷却应 >= 第一次 (指数退避)
      // Second cooldown should be >= first (exponential backoff)
      expect(cooldown2).toBeGreaterThanOrEqual(cooldown1);
    });

    it('退避延迟不应超过 maxDelayMs / backoff delay should not exceed maxDelayMs', () => {
      // 手动计算: baseDelay * 2^20 远超 maxDelayMs
      // Manual calc: baseDelay * 2^20 far exceeds maxDelayMs
      const computed = engine._computeBackoff(20);
      expect(computed).toBeLessThanOrEqual(10000);
    });
  });

  // ━━━ 5. getCooldownStatus / returns correct remaining time ━━━
  describe('getCooldownStatus', () => {
    it('未重规划的任务应无冷却 / task without replan should have no cooldown', () => {
      const status = engine.getCooldownStatus('task-never');
      expect(status.inCooldown).toBe(false);
      expect(status.remainingMs).toBe(0);
      expect(status.replanCount).toBe(0);
    });

    it('刚重规划的任务应在冷却中 / recently replanned task should be in cooldown', () => {
      engine._pheromoneEngine = createMockPheromoneEngine(5);
      engine.checkAndReplan('task-status', 'task/status');

      const status = engine.getCooldownStatus('task-status');
      expect(status.inCooldown).toBe(true);
      expect(status.remainingMs).toBeGreaterThan(0);
      expect(status.replanCount).toBe(1);
    });
  });

  // ━━━ 6. reset 清除状态 / clears state ━━━
  describe('reset', () => {
    it('应清除指定任务的重规划状态 / should clear replan state for specific task', () => {
      engine._pheromoneEngine = createMockPheromoneEngine(5);
      engine.checkAndReplan('task-reset', 'task/reset');

      // 验证冷却存在 / Verify cooldown exists
      expect(engine.getCooldownStatus('task-reset').inCooldown).toBe(true);

      // 重置 / Reset
      engine.reset('task-reset');

      // 冷却应消失 / Cooldown should be gone
      const status = engine.getCooldownStatus('task-reset');
      expect(status.inCooldown).toBe(false);
      expect(status.replanCount).toBe(0);
    });

    it('resetAll 应清除所有状态 / resetAll should clear all states', () => {
      engine._pheromoneEngine = createMockPheromoneEngine(5);
      engine.checkAndReplan('task-a', 'task/a');
      engine.checkAndReplan('task-b', 'task/b');

      engine.resetAll();

      const stats = engine.getStats();
      expect(stats.totalReplans).toBe(0);
      expect(stats.successfulReplans).toBe(0);
      expect(stats.failedReplans).toBe(0);

      expect(engine.getCooldownStatus('task-a').replanCount).toBe(0);
      expect(engine.getCooldownStatus('task-b').replanCount).toBe(0);
    });
  });
});
