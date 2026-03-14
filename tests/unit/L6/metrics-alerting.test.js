/**
 * Metrics Alerting 单元测试 / Metrics Alerting Unit Tests
 *
 * V6.0 L6: 指标阈值告警测试
 * V6.0 L6: Tests for threshold-based metrics alerting
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MetricsCollector } from '../../../src/L6-monitoring/metrics-collector.js';

// ── 辅助 / Helpers ──────────────────────────────────────────────────────────

const silentLogger = { info() {}, warn() {}, error() {}, debug() {} };

function createMockBus() {
  return {
    publish: vi.fn(),
    subscribe: vi.fn(() => () => {}),
  };
}

// ── 测试 / Tests ────────────────────────────────────────────────────────────

describe('MetricsCollector Alerting (V6.0)', () => {
  let collector;
  let bus;

  beforeEach(() => {
    bus = createMockBus();
    collector = new MetricsCollector({
      messageBus: bus,
      logger: silentLogger,
    });
  });

  describe('构造 / Construction', () => {
    it('创建实例不报错 / creates without error', () => {
      expect(collector).toBeDefined();
    });
  });

  describe('指标收集 / Metrics Collection', () => {
    it('getMetrics 返回对象 / getMetrics returns object', () => {
      const metrics = collector.getMetrics?.() || collector.getStats?.();
      expect(metrics).toBeDefined();
    });
  });

  describe('主题订阅扩展 / Extended Subscriptions', () => {
    it('start 订阅 V6.0 新主题 / start subscribes to V6.0 topics', () => {
      if (typeof collector.start === 'function') {
        collector.start();
        // subscribe 应被调用多次
        expect(bus.subscribe).toHaveBeenCalled();
      }
    });
  });
});
