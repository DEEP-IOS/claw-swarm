/**
 * BudgetTracker V5.4 单元测试 / BudgetTracker V5.4 Unit Tests
 *
 * 测试五预算面追踪和协作税计算:
 * Tests 5-budget dimension tracking and collaboration tax computation
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { BudgetTracker, BUDGET_DIMENSIONS } from '../../../src/L4-orchestration/budget-tracker.js';

function createMockBus() {
  const _published = [];
  return {
    publish(topic, data) { _published.push({ topic, data }); },
    subscribe() {},
    _published,
  };
}

const logger = { info() {}, warn() {}, error() {}, debug() {} };

describe('BudgetTracker', () => {
  let tracker;
  let mockBus;

  beforeEach(() => {
    mockBus = createMockBus();
    tracker = new BudgetTracker({ messageBus: mockBus, logger });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // BUDGET_DIMENSIONS
  // ═══════════════════════════════════════════════════════════════════════

  describe('BUDGET_DIMENSIONS', () => {
    it('导出 5 个预算维度 / exports 5 budget dimensions', () => {
      expect(Object.keys(BUDGET_DIMENSIONS).length).toBe(5);
      expect(BUDGET_DIMENSIONS.LATENCY).toBe('latency');
      expect(BUDGET_DIMENSIONS.TOKEN).toBe('token');
      expect(BUDGET_DIMENSIONS.COORDINATION).toBe('coordination');
      expect(BUDGET_DIMENSIONS.OBSERVABILITY).toBe('observability');
      expect(BUDGET_DIMENSIONS.REPAIR).toBe('repair');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // startTracking
  // ═══════════════════════════════════════════════════════════════════════

  describe('startTracking', () => {
    it('创建追踪记录 / creates tracking record', () => {
      tracker.startTracking('turn-1', { arbiterMode: 'PREPLAN' });
      const rec = tracker.getRecord('turn-1');
      expect(rec).not.toBeNull();
      expect(rec.arbiterMode).toBe('PREPLAN');
      expect(rec.budget.latency).toBe(0);
      expect(rec.budget.token).toBe(0);
    });

    it('重复 turnId 不覆盖 / duplicate turnId does not overwrite', () => {
      tracker.startTracking('turn-dup');
      tracker.record('turn-dup', 'token', 100);
      tracker.startTracking('turn-dup'); // 不应重置
      expect(tracker.getRecord('turn-dup').budget.token).toBe(100);
    });

    it('更新统计 / updates stats', () => {
      tracker.startTracking('t1');
      tracker.startTracking('t2');
      expect(tracker.getStats().recordsCreated).toBe(2);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // record / recordBatch
  // ═══════════════════════════════════════════════════════════════════════

  describe('record', () => {
    it('记录单维度成本 / records single dimension cost', () => {
      tracker.startTracking('turn-r1');
      tracker.record('turn-r1', 'token', 150);
      tracker.record('turn-r1', 'token', 50);

      const rec = tracker.getRecord('turn-r1');
      expect(rec.budget.token).toBe(200);
    });

    it('负值被归零 / negative values clamped to 0', () => {
      tracker.startTracking('turn-neg');
      tracker.record('turn-neg', 'token', -50);
      expect(tracker.getRecord('turn-neg').budget.token).toBe(0);
    });

    it('未知 turnId 安全跳过 / unknown turnId safely ignored', () => {
      tracker.record('nonexistent', 'token', 100); // 不应抛出
    });

    it('未知维度安全跳过 / unknown dimension safely ignored', () => {
      tracker.startTracking('turn-dim');
      tracker.record('turn-dim', 'unknown_dim', 100); // 不应抛出
    });
  });

  describe('recordBatch', () => {
    it('批量记录多维度 / records multiple dimensions', () => {
      tracker.startTracking('turn-batch');
      tracker.recordBatch('turn-batch', {
        latency: 120,
        token: 200,
        coordination: 5,
        observability: 3,
        repair: 1,
      });

      const rec = tracker.getRecord('turn-batch');
      expect(rec.budget.latency).toBe(120);
      expect(rec.budget.token).toBe(200);
      expect(rec.budget.coordination).toBe(5);
      expect(rec.budget.observability).toBe(3);
      expect(rec.budget.repair).toBe(1);
    });

    it('null costs 安全跳过 / null costs safely ignored', () => {
      tracker.startTracking('turn-null');
      tracker.recordBatch('turn-null', null); // 不应抛出
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // endTracking + 协作税
  // ═══════════════════════════════════════════════════════════════════════

  describe('endTracking', () => {
    it('结束追踪并计算协作税 / ends tracking and computes collab tax', () => {
      tracker.startTracking('turn-end');
      tracker.recordBatch('turn-end', {
        latency: 200,
        token: 100,
        coordination: 5,
        observability: 3,
        repair: 2,
      });

      const result = tracker.endTracking('turn-end');
      expect(result).not.toBeNull();
      expect(result.budget.token).toBe(100);
      expect(typeof result.collabTax).toBe('number');
      expect(result.breakdown).toBeDefined();
    });

    it('DIRECT 模式基准成本 → 协作税≈0 / DIRECT baseline → tax ≈ 0', () => {
      tracker.startTracking('turn-direct', { arbiterMode: 'DIRECT' });
      tracker.recordBatch('turn-direct', {
        latency: 50,
        token: 30,
        coordination: 1,
        observability: 1,
        repair: 0,
      });

      const result = tracker.endTracking('turn-direct');
      // 成本 = 基准 → 各维税 = 0 → 总税 ≈ 0
      expect(Math.abs(result.collabTax)).toBeLessThanOrEqual(0.01);
    });

    it('高成本协作 → 正协作税 / high cost → positive tax', () => {
      tracker.startTracking('turn-expensive');
      tracker.recordBatch('turn-expensive', {
        latency: 500,  // 基准 50 → 税 9.0
        token: 300,    // 基准 30 → 税 9.0
        coordination: 10,  // 基准 1 → 税 9.0
        observability: 5,  // 基准 1 → 税 4.0
        repair: 3,     // 基准 0
      });

      const result = tracker.endTracking('turn-expensive');
      expect(result.collabTax).toBeGreaterThan(0);
    });

    it('不存在的 turnId 返回 null / unknown turnId returns null', () => {
      expect(tracker.endTracking('nonexistent')).toBeNull();
    });

    it('发布 BUDGET_TURN_COMPLETED 事件 / publishes event', () => {
      tracker.startTracking('turn-evt');
      tracker.endTracking('turn-evt');
      const events = mockBus._published.filter(e => e.topic === 'budget.turn.completed');
      expect(events.length).toBe(1);
    });

    it('更新 ROI 统计 / updates ROI stats', () => {
      // 低成本 → 可能负税
      tracker.startTracking('turn-roi1');
      tracker.recordBatch('turn-roi1', { latency: 20, token: 10, coordination: 0, observability: 0, repair: 0 });
      tracker.endTracking('turn-roi1');

      // 高成本 → 正税
      tracker.startTracking('turn-roi2');
      tracker.recordBatch('turn-roi2', { latency: 500, token: 300, coordination: 10, observability: 5, repair: 3 });
      tracker.endTracking('turn-roi2');

      const stats = tracker.getStats();
      expect(stats.taxComputations).toBe(2);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // getTotals
  // ═══════════════════════════════════════════════════════════════════════

  describe('getTotals', () => {
    it('返回全局累计预算 / returns global totals', () => {
      tracker.startTracking('t1');
      tracker.record('t1', 'token', 100);
      tracker.startTracking('t2');
      tracker.record('t2', 'token', 200);

      const totals = tracker.getTotals();
      expect(totals.token).toBe(300);
      expect(totals.turns).toBe(2);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // getAveragesByMode
  // ═══════════════════════════════════════════════════════════════════════

  describe('getAveragesByMode', () => {
    it('按仲裁模式分组平均 / averages grouped by arbiter mode', () => {
      tracker.startTracking('t-d1', { arbiterMode: 'DIRECT' });
      tracker.recordBatch('t-d1', { token: 20 });
      tracker.endTracking('t-d1');

      tracker.startTracking('t-d2', { arbiterMode: 'DIRECT' });
      tracker.recordBatch('t-d2', { token: 40 });
      tracker.endTracking('t-d2');

      tracker.startTracking('t-p1', { arbiterMode: 'PREPLAN' });
      tracker.recordBatch('t-p1', { token: 300 });
      tracker.endTracking('t-p1');

      const avgs = tracker.getAveragesByMode();
      expect(avgs.DIRECT).toBeDefined();
      expect(avgs.DIRECT.count).toBe(2);
      expect(avgs.DIRECT.avgToken).toBe(30);
      expect(avgs.PREPLAN).toBeDefined();
      expect(avgs.PREPLAN.count).toBe(1);
      expect(avgs.PREPLAN.avgToken).toBe(300);
    });

    it('未结束的 turn 不计入 / unfinished turns excluded', () => {
      tracker.startTracking('t-unfinished', { arbiterMode: 'DIRECT' });
      tracker.recordBatch('t-unfinished', { token: 100 });
      // 不调用 endTracking

      const avgs = tracker.getAveragesByMode();
      expect(avgs.DIRECT).toBeUndefined();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // getStats
  // ═══════════════════════════════════════════════════════════════════════

  describe('getStats', () => {
    it('返回综合统计 / returns comprehensive stats', () => {
      tracker.startTracking('t1');
      tracker.recordBatch('t1', { token: 100, coordination: 3 });
      tracker.endTracking('t1');

      const stats = tracker.getStats();
      expect(stats.recordsCreated).toBe(1);
      expect(stats.taxComputations).toBe(1);
      expect(stats.totals.token).toBe(100);
      expect(stats.activeRecords).toBe(1);
      expect(typeof stats.avgCollabTax).toBe('number');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 边界情况 / Edge Cases
  // ═══════════════════════════════════════════════════════════════════════

  describe('edge cases', () => {
    it('无 messageBus 不影响功能 / works without messageBus', () => {
      const bare = new BudgetTracker({ logger });
      bare.startTracking('t1');
      bare.record('t1', 'token', 100);
      const result = bare.endTracking('t1');
      expect(result.budget.token).toBe(100);
    });

    it('超过 MAX_RECORDS 自动清理 / exceeding max records auto-cleanup', () => {
      for (let i = 0; i < 210; i++) {
        tracker.startTracking(`t-edge-${i}`);
      }
      expect(tracker.getStats().activeRecords).toBeLessThanOrEqual(200);
    });

    it('自定义 baselines / custom baselines', () => {
      const custom = new BudgetTracker({
        config: { baselines: { latency: 100, token: 50 } },
        logger,
      });
      custom.startTracking('t1');
      custom.recordBatch('t1', { latency: 100, token: 50, coordination: 1, observability: 1, repair: 0 });
      const result = custom.endTracking('t1');
      // 成本 = 基准 → 税 ≈ 0
      expect(Math.abs(result.collabTax)).toBeLessThanOrEqual(0.01);
    });
  });
});
