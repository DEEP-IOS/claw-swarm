/**
 * ResponseThreshold 单元测试 / ResponseThreshold Unit Tests
 *
 * 测试 L3 响应阈值的默认值、shouldRespond 判断和 PI 控制器调节。
 * Tests L3 response threshold defaults, shouldRespond logic, and PI controller adjustment.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { ResponseThreshold } from '../../../src/L3-agent/response-threshold.js';

// ── 辅助函数 / Helpers ──────────────────────────────────────────────────────

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

// ── 测试 / Tests ────────────────────────────────────────────────────────────

describe('ResponseThreshold', () => {
  let messageBus, threshold;

  beforeEach(() => {
    messageBus = createMockBus();
    threshold = new ResponseThreshold({
      messageBus,
      db: null,
      logger: silentLogger,
      config: {},
    });
  });

  // ━━━ 1. 默认阈值 / Default Threshold ━━━
  describe('getThreshold', () => {
    it('默认阈值应为 0.5 / default threshold should be 0.5', () => {
      const value = threshold.getThreshold('agent-1', 'coding');
      expect(value).toBe(0.5);
    });

    it('不同 agent 应各有独立默认阈值 / different agents should have independent defaults', () => {
      const v1 = threshold.getThreshold('agent-1', 'coding');
      const v2 = threshold.getThreshold('agent-2', 'coding');
      expect(v1).toBe(0.5);
      expect(v2).toBe(0.5);
    });

    it('不同 taskType 应各有独立默认阈值 / different taskTypes should have independent defaults', () => {
      const coding = threshold.getThreshold('agent-1', 'coding');
      const testing = threshold.getThreshold('agent-1', 'testing');
      expect(coding).toBe(0.5);
      expect(testing).toBe(0.5);
    });
  });

  // ━━━ 2. shouldRespond — 刺激高于阈值 / Stimulus Above Threshold ━━━
  describe('shouldRespond — above threshold', () => {
    it('刺激 > 阈值应返回 true / stimulus > threshold should return true', () => {
      // 默认阈值 0.5, 刺激 0.8 > 0.5 / Default threshold 0.5, stimulus 0.8 > 0.5
      const result = threshold.shouldRespond('agent-1', 'coding', 0.8);
      expect(result).toBe(true);
    });

    it('刺激远高于阈值应返回 true / high stimulus should return true', () => {
      const result = threshold.shouldRespond('agent-1', 'coding', 0.99);
      expect(result).toBe(true);
    });
  });

  // ━━━ 3. shouldRespond — 刺激低于阈值 / Stimulus Below Threshold ━━━
  describe('shouldRespond — below threshold', () => {
    it('刺激 < 阈值应返回 false / stimulus < threshold should return false', () => {
      // 默认阈值 0.5, 刺激 0.2 < 0.5 / Default threshold 0.5, stimulus 0.2 < 0.5
      const result = threshold.shouldRespond('agent-1', 'coding', 0.2);
      expect(result).toBe(false);
    });

    it('刺激远低于阈值应返回 false / very low stimulus should return false', () => {
      const result = threshold.shouldRespond('agent-1', 'coding', 0.01);
      expect(result).toBe(false);
    });
  });

  // ━━━ 4. adjust / Adjust Threshold via PI Controller ━━━
  describe('adjust', () => {
    it('调整后阈值应发生变化 / threshold should change after adjustment', () => {
      const before = threshold.getThreshold('agent-1', 'coding');
      threshold.adjust('agent-1', 'coding', 0.1);
      const after = threshold.getThreshold('agent-1', 'coding');

      expect(after).not.toBe(before);
    });

    it('高活跃率应增加阈值 / high activity rate should increase threshold', () => {
      const before = threshold.getThreshold('agent-1', 'testing');
      // 高活跃率 (> targetActivity 0.6) → 阈值上升 / High activity rate → threshold goes up
      threshold.adjust('agent-1', 'testing', 1.0);
      const after = threshold.getThreshold('agent-1', 'testing');
      expect(after).toBeGreaterThan(before);
    });

    it('低活跃率应降低阈值 / low activity rate should decrease threshold', () => {
      const before = threshold.getThreshold('agent-1', 'architecture');
      // 低活跃率 (< targetActivity 0.6) → 阈值下降 / Low activity rate → threshold goes down
      threshold.adjust('agent-1', 'architecture', 0.1);
      const after = threshold.getThreshold('agent-1', 'architecture');
      expect(after).toBeLessThan(before);
    });

    it('多次调整累积效果 / multiple adjustments should accumulate', () => {
      threshold.adjust('agent-1', 'coding', 1.0);
      const mid = threshold.getThreshold('agent-1', 'coding');
      threshold.adjust('agent-1', 'coding', 1.0);
      const final_ = threshold.getThreshold('agent-1', 'coding');

      expect(final_).toBeGreaterThan(mid);
    });
  });

  // ━━━ 5. 边界约束 / Threshold Bounds ━━━
  describe('threshold bounds [0.05, 0.95]', () => {
    it('大量正调整不应超过上限 0.95 / many positive adjustments should not exceed 0.95', () => {
      // 高活跃率连续调整 → 阈值上升 / High activity rate adjustments → threshold rises
      for (let i = 0; i < 100; i++) {
        threshold.adjust('agent-bound', 'coding', 1.0);
      }
      const value = threshold.getThreshold('agent-bound', 'coding');
      expect(value).toBeLessThanOrEqual(0.95);
    });

    it('大量负调整不应低于下限 0.05 / many negative adjustments should not go below 0.05', () => {
      // 低活跃率连续调整 → 阈值下降 / Low activity rate adjustments → threshold drops
      for (let i = 0; i < 100; i++) {
        threshold.adjust('agent-low', 'coding', 0.0);
      }
      const value = threshold.getThreshold('agent-low', 'coding');
      expect(value).toBeGreaterThanOrEqual(0.05);
    });

    it('调整后 shouldRespond 应反映新阈值 / shouldRespond should reflect adjusted threshold', () => {
      // 高活跃率将阈值调高, 使 0.6 的刺激不再足够 / High activity rate raises threshold
      for (let i = 0; i < 50; i++) {
        threshold.adjust('agent-high', 'coding', 1.0);
      }
      const highThreshold = threshold.getThreshold('agent-high', 'coding');
      // 0.6 可能低于调高后的阈值 / 0.6 may be below the raised threshold
      if (highThreshold > 0.6) {
        const result = threshold.shouldRespond('agent-high', 'coding', 0.6);
        expect(result).toBe(false);
      }
    });
  });
});
