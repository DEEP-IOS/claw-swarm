/**
 * PheromoneResponseMatrix 单元测试 / PheromoneResponseMatrix Unit Tests
 *
 * 测试 L2 信息素响应矩阵的压力计算、生命周期和升级检查。
 * Tests L2 pheromone response matrix pressure computation, lifecycle, and escalation.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PheromoneResponseMatrix } from '../../../src/L2-communication/pheromone-response-matrix.js';

// ── 辅助函数 / Helpers ──────────────────────────────────────────────────────

const silentLogger = { info() {}, warn() {}, error() {}, debug() {} };

/** 模拟 MessageBus / Mock MessageBus */
function createMockBus() {
  const published = [];
  const subscriptions = [];
  return {
    publish(topic, data) { published.push({ topic, data }); },
    subscribe(topic, handler) {
      subscriptions.push({ topic, handler });
      return () => {};
    },
    _published: published,
    _subscriptions: subscriptions,
  };
}

/** 模拟 PheromoneEngine / Mock PheromoneEngine */
function createMockPheromoneEngine(pheromones = []) {
  return {
    getAll() { return pheromones; },
    read(scope) { return pheromones.filter(p => p.targetScope === scope); },
    buildSnapshot() { return { count: pheromones.length, pheromones }; },
  };
}

// ── 测试 / Tests ────────────────────────────────────────────────────────────

describe('PheromoneResponseMatrix', () => {
  let messageBus, pheromoneEngine, matrix;

  beforeEach(() => {
    messageBus = createMockBus();
    pheromoneEngine = createMockPheromoneEngine();
    matrix = new PheromoneResponseMatrix({
      messageBus,
      pheromoneEngine,
      logger: silentLogger,
      config: {},
    });
  });

  // ━━━ 1. 构造函数 / Constructor ━━━
  describe('constructor', () => {
    it('应创建实例并使用默认值 / should create instance with defaults', () => {
      expect(matrix).toBeTruthy();
      expect(typeof matrix._computePressure).toBe('function');
      expect(typeof matrix.start).toBe('function');
      expect(typeof matrix.stop).toBe('function');
    });

    it('无配置时应使用默认参数 / should use default config when none provided', () => {
      const m = new PheromoneResponseMatrix({
        messageBus,
        pheromoneEngine,
        logger: silentLogger,
      });
      expect(m).toBeTruthy();
    });
  });

  // ━━━ 2. _computePressure 计算 / _computePressure Computation ━━━
  describe('_computePressure', () => {
    it('base=0.5, age=10 应返回正确值 / should return correct value', () => {
      // P = base * (1 + k * ln(1 + age)), k defaults to 0.3
      // P = 0.5 * (1 + 0.3 * ln(11))
      const expected = 0.5 * (1 + 0.3 * Math.log(1 + 10));
      const result = matrix._computePressure(0.5, 10);

      expect(typeof result).toBe('number');
      expect(Math.abs(result - expected)).toBeLessThan(1e-6);
    });

    it('age=0 时应返回基础强度 / should return base intensity when age is 0', () => {
      // P = base * (1 + k * ln(1 + 0)) = base * (1 + 0) = base
      const result = matrix._computePressure(0.8, 0);
      expect(Math.abs(result - 0.8)).toBeLessThan(1e-6);
    });

    it('使用实例 k=0.3 / should use instance k=0.3', () => {
      const result = matrix._computePressure(1.0, 5);
      const expected = 1.0 * (1 + 0.3 * Math.log(1 + 5));
      expect(Math.abs(result - expected)).toBeLessThan(1e-6);
    });

    it('压力随 age 增长而增加 / pressure should increase with age', () => {
      const p1 = matrix._computePressure(0.5, 1);
      const p5 = matrix._computePressure(0.5, 5);
      const p30 = matrix._computePressure(0.5, 30);

      expect(p5).toBeGreaterThan(p1);
      expect(p30).toBeGreaterThan(p5);
    });
  });

  // ━━━ 3. 生命周期 / Lifecycle ━━━
  describe('start / stop lifecycle', () => {
    it('start() 应成功启动 / should start successfully', () => {
      expect(() => matrix.start()).not.toThrow();
      // 清理 / Cleanup
      matrix.stop();
    });

    it('stop() 应成功停止 / should stop successfully', () => {
      matrix.start();
      expect(() => matrix.stop()).not.toThrow();
    });

    it('多次 stop() 不应抛出异常 / multiple stop() calls should not throw', () => {
      matrix.start();
      matrix.stop();
      expect(() => matrix.stop()).not.toThrow();
    });
  });

  // ━━━ 4. autoEscalate / Auto Escalate ━━━
  describe('autoEscalate', () => {
    it('无 pending 任务时不应发布事件 / should not publish when no pending tasks', () => {
      const result = matrix.autoEscalate();
      expect(result.scanned).toBe(0);
      expect(result.escalated).toBe(0);
      expect(messageBus._published.length).toBe(0);
    });

    it('高压力任务应触发升级 / high-pressure tasks should trigger escalation', () => {
      // 用 emitPheromone mock 重建引擎 / Rebuild engine with emitPheromone mock
      const emittedPheromones = [];
      const mockEngine = {
        ...createMockPheromoneEngine(),
        emitPheromone(p) { emittedPheromones.push(p); },
      };
      const m = new PheromoneResponseMatrix({
        messageBus,
        pheromoneEngine: mockEngine,
        logger: silentLogger,
        config: { escalationThreshold: 0.1 }, // 极低阈值确保触发 / very low threshold to ensure trigger
      });

      // 注册任务并手动设置为过去时间以模拟老化 / Register task with old timestamp to simulate aging
      m.registerPendingTask('task-1', 'zone/x', 0.9);
      // 手动将 createdAt 调到 60 分钟前 / Manually set createdAt to 60 minutes ago
      m._pendingTasks.get('task-1').createdAt = Date.now() - 60 * 60_000;

      const result = m.autoEscalate();
      // 高压力应触发升级 / High pressure should trigger escalation
      expect(result.scanned).toBe(1);
      expect(result.escalated).toBe(1);
    });
  });
});
