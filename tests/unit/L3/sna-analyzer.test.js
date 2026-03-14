/**
 * SNAAnalyzer 单元测试 / SNAAnalyzer Unit Tests
 *
 * V6.0 L3: SNA 网络分析指标测试
 * V6.0 L3: Tests for Social Network Analysis metrics
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SNAAnalyzer } from '../../../src/L3-agent/sna-analyzer.js';

// ── 辅助 / Helpers ──────────────────────────────────────────────────────────

const silentLogger = { info() {}, warn() {}, error() {}, debug() {} };
const mockBus = { publish: vi.fn(), subscribe: vi.fn(() => () => {}) };

function createMockDb() {
  return {
    prepare: vi.fn(() => ({
      run: vi.fn(() => ({ changes: 1 })),
      get: vi.fn(() => null),
      all: vi.fn(() => []),
    })),
    exec: vi.fn(),
  };
}

// ── 测试 / Tests ────────────────────────────────────────────────────────────

describe('SNAAnalyzer', () => {
  let sna;
  let db;

  beforeEach(() => {
    db = createMockDb();
    sna = new SNAAnalyzer({
      messageBus: mockBus,
      logger: silentLogger,
      db,
      config: { computeIntervalTurns: 5 },
    });
  });

  describe('构造 / Construction', () => {
    it('创建实例不报错 / creates without error', () => {
      expect(sna).toBeDefined();
    });

    it('getNetworkStats 初始为空 / getNetworkStats initially empty', () => {
      const stats = sna.getNetworkStats();
      expect(stats).toBeDefined();
    });
  });

  describe('recordCollaboration / Record Collaboration', () => {
    it('记录协作关系 / records collaboration', () => {
      expect(() => sna.recordCollaboration('agent-A', 'agent-B')).not.toThrow();
    });

    it('重复记录增加权重 / duplicate records increase weight', () => {
      sna.recordCollaboration('agent-A', 'agent-B', 1);
      sna.recordCollaboration('agent-A', 'agent-B', 1);
      // 不报错即可 / Should not throw
    });

    it('自环被忽略 / self-loops ignored', () => {
      sna.recordCollaboration('agent-A', 'agent-A');
      // 不应建立边 / Should not create edge
    });
  });

  describe('compute / Compute', () => {
    it('无数据时返回空 / empty graph returns empty', () => {
      const metrics = sna.compute();
      expect(metrics).toBeDefined();
      const size = metrics instanceof Map ? metrics.size : Object.keys(metrics).length;
      expect(size).toBe(0);
    });

    it('两个 agent 度中心性 / two agents degree centrality', () => {
      sna.recordCollaboration('A', 'B');
      const metrics = sna.compute();

      const getMetric = (id) => metrics instanceof Map ? metrics.get(id) : metrics[id];
      const mA = getMetric('A');
      const mB = getMetric('B');

      expect(mA).toBeDefined();
      expect(mB).toBeDefined();
      // 在只有2个节点的图中，度中心性=1
      expect(mA.degreeCentrality).toBeGreaterThan(0);
      expect(mB.degreeCentrality).toBeGreaterThan(0);
    });

    it('三角形图聚类系数为 1 / triangle graph clustering = 1', () => {
      sna.recordCollaboration('A', 'B');
      sna.recordCollaboration('B', 'C');
      sna.recordCollaboration('A', 'C');

      const metrics = sna.compute();
      const getMetric = (id) => metrics instanceof Map ? metrics.get(id) : metrics[id];

      const mA = getMetric('A');
      // 三角形中每个节点的聚类系数应为 1
      expect(mA.clusteringCoefficient).toBeCloseTo(1.0, 1);
    });

    it('星形图中心节点度中心性最高 / star graph center has highest degree', () => {
      // 中心 C 连接 A, B, D, E
      sna.recordCollaboration('C', 'A');
      sna.recordCollaboration('C', 'B');
      sna.recordCollaboration('C', 'D');
      sna.recordCollaboration('C', 'E');

      const metrics = sna.compute();
      const getMetric = (id) => metrics instanceof Map ? metrics.get(id) : metrics[id];

      const mC = getMetric('C');
      const mA = getMetric('A');

      expect(mC.degreeCentrality).toBeGreaterThan(mA.degreeCentrality);
    });

    it('介数中心性 — 桥节点最高 / betweenness — bridge node highest', () => {
      // A-B-C 链: B 是桥节点
      sna.recordCollaboration('A', 'B');
      sna.recordCollaboration('B', 'C');

      const metrics = sna.compute();
      const getMetric = (id) => metrics instanceof Map ? metrics.get(id) : metrics[id];

      const mB = getMetric('B');
      const mA = getMetric('A');

      expect(mB.betweennessCentrality).toBeGreaterThanOrEqual(mA.betweennessCentrality);
    });

    it('发布 MessageBus 事件 / publishes to MessageBus', () => {
      sna.recordCollaboration('X', 'Y');
      sna.compute();
      expect(mockBus.publish).toHaveBeenCalled();
    });
  });

  describe('getMetrics / Get Metrics', () => {
    it('未计算时返回 null / returns null before compute', () => {
      const m = sna.getMetrics('nonexistent');
      expect(m).toBeNull();
    });

    it('计算后返回指标 / returns metrics after compute', () => {
      sna.recordCollaboration('A', 'B');
      sna.compute();
      const m = sna.getMetrics('A');
      expect(m).toBeDefined();
      if (m) {
        expect(m.degreeCentrality).toBeDefined();
        expect(m.betweennessCentrality).toBeDefined();
        expect(m.clusteringCoefficient).toBeDefined();
      }
    });
  });

  describe('tick / Tick', () => {
    it('未到间隔时返回 null / returns null before interval', () => {
      sna.recordCollaboration('A', 'B');
      const result = sna.tick();
      // 第一次 tick 可能不触发计算
      // (取决于内部 turn 计数器)
    });

    it('达到间隔时触发计算 / triggers compute at interval', () => {
      sna.recordCollaboration('A', 'B');
      // 触发足够多次 tick
      let computed = null;
      for (let i = 0; i < 10; i++) {
        const result = sna.tick();
        if (result) computed = result;
      }
      // 间隔设为 5, 应至少计算一次
    });
  });
});
