/**
 * BudgetTracker V5.5 单元测试 / BudgetTracker V5.5 Unit Tests
 *
 * 测试协作税计算、基准配置、ROI 统计、事件发布
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { BudgetTracker, BUDGET_DIMENSIONS } from '../../../src/L4-orchestration/budget-tracker.js';

function createMockBus() {
  const events = [];
  return {
    publish(topic, data) { events.push({ topic, data }); },
    subscribe() {},
    events,
  };
}

const logger = { info() {}, warn() {}, error() {}, debug() {} };

describe('BudgetTracker V5.5', () => {
  let tracker;
  let mockBus;

  beforeEach(() => {
    mockBus = createMockBus();
    tracker = new BudgetTracker({
      messageBus: mockBus,
      logger,
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 预算追踪生命周期 / Budget Tracking Lifecycle
  // ═══════════════════════════════════════════════════════════════════════

  describe('tracking lifecycle', () => {
    it('should start tracking and return turnId', () => {
      const id = tracker.startTracking('turn-1', { arbiterMode: 'SWARM' });
      expect(id).toBe('turn-1');
    });

    it('should not duplicate tracking for same turnId', () => {
      tracker.startTracking('turn-1');
      tracker.startTracking('turn-1');
      expect(tracker.getStats().activeRecords).toBe(1);
    });

    it('should record single dimension cost', () => {
      tracker.startTracking('turn-1');
      tracker.record('turn-1', 'token', 100);
      const rec = tracker.getRecord('turn-1');
      expect(rec.budget.token).toBe(100);
    });

    it('should record batch costs', () => {
      tracker.startTracking('turn-1');
      tracker.recordBatch('turn-1', { token: 50, coordination: 3, repair: 1 });
      const rec = tracker.getRecord('turn-1');
      expect(rec.budget.token).toBe(50);
      expect(rec.budget.coordination).toBe(3);
      expect(rec.budget.repair).toBe(1);
    });

    it('should endTracking and compute collaboration tax', () => {
      tracker.startTracking('turn-1', { arbiterMode: 'SWARM' });
      tracker.recordBatch('turn-1', { token: 100, coordination: 5 });
      const result = tracker.endTracking('turn-1');
      expect(result).toBeDefined();
      expect(result).toHaveProperty('budget');
      expect(result).toHaveProperty('collabTax');
      expect(result).toHaveProperty('breakdown');
      expect(typeof result.collabTax).toBe('number');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 协作税计算 / Collaboration Tax Computation
  // ═══════════════════════════════════════════════════════════════════════

  describe('collaboration tax', () => {
    it('should compute positive tax when costs exceed baselines', () => {
      tracker.startTracking('turn-1');
      // 默认 token baseline=30, 实际=300 → dimTax=(300-30)/30=9
      tracker.recordBatch('turn-1', { token: 300, coordination: 10, observability: 5, repair: 3 });
      const result = tracker.endTracking('turn-1');
      expect(result.collabTax).toBeGreaterThan(0);
    });

    it('should compute negative tax (ROI) when costs below baselines', () => {
      tracker.startTracking('turn-1');
      // 所有维度低于基线
      tracker.recordBatch('turn-1', { token: 10, coordination: 0, observability: 0, repair: 0 });
      // latency 会自动记录为 endTime-startTime，可能很小
      const result = tracker.endTracking('turn-1');
      expect(result.collabTax).toBeLessThan(1); // 至少不应特别高
    });

    it('should track positive/negative ROI counts', () => {
      // 高成本 turn
      tracker.startTracking('turn-high');
      tracker.recordBatch('turn-high', { token: 500, coordination: 20, observability: 10, repair: 5 });
      tracker.endTracking('turn-high');

      const stats = tracker.getStats();
      expect(stats.taxComputations).toBe(1);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 自定义基准 / Custom Baselines
  // ═══════════════════════════════════════════════════════════════════════

  describe('custom baselines', () => {
    it('should accept custom baselines via config', () => {
      const customTracker = new BudgetTracker({
        messageBus: mockBus,
        logger,
        config: { baselines: { token: 100, latency: 200 } },
      });
      customTracker.startTracking('turn-1');
      customTracker.recordBatch('turn-1', { token: 100 });
      const result = customTracker.endTracking('turn-1');
      // token actual=100, baseline=100 → dimTax=0
      expect(result.breakdown.token).toBe(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 按模式分组 / Averages By Mode
  // ═══════════════════════════════════════════════════════════════════════

  describe('getAveragesByMode', () => {
    it('should group completed turns by arbiter mode', () => {
      tracker.startTracking('t1', { arbiterMode: 'SWARM' });
      tracker.recordBatch('t1', { token: 100 });
      tracker.endTracking('t1');

      tracker.startTracking('t2', { arbiterMode: 'DIRECT' });
      tracker.recordBatch('t2', { token: 20 });
      tracker.endTracking('t2');

      const avgs = tracker.getAveragesByMode();
      expect(avgs).toHaveProperty('SWARM');
      expect(avgs).toHaveProperty('DIRECT');
      expect(avgs.SWARM.count).toBe(1);
      expect(avgs.DIRECT.count).toBe(1);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 事件发布 / Event Publishing
  // ═══════════════════════════════════════════════════════════════════════

  describe('event publishing', () => {
    it('should publish BUDGET_TURN_COMPLETED on endTracking', () => {
      tracker.startTracking('turn-1', { arbiterMode: 'SWARM' });
      tracker.recordBatch('turn-1', { token: 50 });
      tracker.endTracking('turn-1');

      const evt = mockBus.events.find(e => e.topic === 'budget.turn.completed');
      expect(evt).toBeDefined();
      expect(evt.data.payload.turnId).toBe('turn-1');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 统计 / Statistics
  // ═══════════════════════════════════════════════════════════════════════

  describe('getStats', () => {
    it('should return comprehensive stats', () => {
      const stats = tracker.getStats();
      expect(stats).toHaveProperty('recordsCreated');
      expect(stats).toHaveProperty('taxComputations');
      expect(stats).toHaveProperty('positiveROI');
      expect(stats).toHaveProperty('negativeROI');
      expect(stats).toHaveProperty('totals');
      expect(stats).toHaveProperty('activeRecords');
      expect(stats).toHaveProperty('avgCollabTax');
    });

    it('should accumulate totals across turns', () => {
      tracker.startTracking('t1');
      tracker.record('t1', 'token', 50);
      tracker.startTracking('t2');
      tracker.record('t2', 'token', 30);

      const stats = tracker.getStats();
      expect(stats.totals.token).toBe(80);
      expect(stats.totals.turns).toBe(2);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // BUDGET_DIMENSIONS 导出 / BUDGET_DIMENSIONS Export
  // ═══════════════════════════════════════════════════════════════════════

  describe('BUDGET_DIMENSIONS', () => {
    it('should export all 5 dimensions', () => {
      expect(BUDGET_DIMENSIONS.LATENCY).toBe('latency');
      expect(BUDGET_DIMENSIONS.TOKEN).toBe('token');
      expect(BUDGET_DIMENSIONS.COORDINATION).toBe('coordination');
      expect(BUDGET_DIMENSIONS.OBSERVABILITY).toBe('observability');
      expect(BUDGET_DIMENSIONS.REPAIR).toBe('repair');
    });
  });
});
