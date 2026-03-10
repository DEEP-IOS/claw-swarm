/**
 * MetricsCollector 单元测试 / MetricsCollector Unit Tests
 *
 * 测试 L6 指标收集器的 RED 指标、蜂群指标和时间序列。
 * Tests L6 metrics collector RED metrics, swarm metrics, and time series.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { MetricsCollector } from '../../../src/L6-monitoring/metrics-collector.js';

// ── 辅助函数 / Helpers ──────────────────────────────────────────────────────

const silentLogger = { info() {}, warn() {}, error() {}, debug() {} };

/** 模拟 MessageBus / Mock MessageBus */
function createMockBus() {
  const subs = [];
  return {
    subscribe(topic, handler) {
      const entry = { topic, handler };
      subs.push(entry);
      return () => { const i = subs.indexOf(entry); if (i >= 0) subs.splice(i, 1); };
    },
    /** 触发匹配订阅 / Trigger matching subscriptions */
    _emit(topic, data = {}) {
      for (const s of subs) {
        const pattern = s.topic.replace('.*', '');
        if (topic.startsWith(pattern) || s.topic === topic) {
          s.handler({ topic, data, timestamp: Date.now() });
        }
      }
    },
    _subs: subs,
  };
}

// ── 测试 / Tests ────────────────────────────────────────────────────────────

describe('MetricsCollector', () => {
  let bus;
  let collector;

  beforeEach(() => {
    bus = createMockBus();
    collector = new MetricsCollector({ messageBus: bus, logger: silentLogger });
  });

  it('构造函数初始化 / constructor initializes', () => {
    const stats = collector.getStats();
    expect(stats.running).toBe(false);
    expect(stats.totalRequests).toBe(0);
  });

  it('start 订阅主题 / start subscribes to topics', () => {
    collector.start();
    expect(collector.getStats().running).toBe(true);
    // V5.7: 从 18 个扩展到 19 个主题 (V5.7 +symbiosis.*)
    expect(bus._subs.length).toBe(19);
  });

  it('stop 取消所有订阅 / stop unsubscribes all', () => {
    collector.start();
    collector.stop();
    expect(collector.getStats().running).toBe(false);
    expect(bus._subs.length).toBe(0);
  });

  it('recordMetric 手动记录 / recordMetric manual recording', () => {
    collector.recordMetric('custom', 42, { duration: 100 });
    const snap = collector.getSnapshot();
    expect(snap.red.rate).toBe(1);
    expect(snap.red.avgDuration).toBe(100);
  });

  it('task 事件计数 / task event counting', () => {
    collector.start();
    bus._emit('task.completed', { taskId: 't1' });
    bus._emit('task.failed', { taskId: 't2' });
    bus._emit('task.started', { taskId: 't3' });

    const snap = collector.getSnapshot();
    expect(snap.red.rate).toBe(3);
    expect(snap.swarm.tasksCompleted).toBe(1);
    expect(snap.swarm.tasksFailed).toBe(1);
  });

  it('agent 事件计数 / agent event counting', () => {
    collector.start();
    bus._emit('agent.start', {});
    bus._emit('agent.end', {});

    expect(collector.getSnapshot().swarm.agentEvents).toBe(2);
  });

  it('pheromone 事件计数 / pheromone event counting', () => {
    collector.start();
    bus._emit('pheromone.emitted', {});

    expect(collector.getSnapshot().swarm.pheromoneEvents).toBe(1);
  });

  it('quality 事件计数 / quality event counting', () => {
    collector.start();
    bus._emit('quality.evaluated', {});

    expect(collector.getSnapshot().swarm.qualityEvents).toBe(1);
  });

  it('memory 事件计数 / memory event counting', () => {
    collector.start();
    bus._emit('memory.consolidated', {});

    expect(collector.getSnapshot().swarm.memoryEvents).toBe(1);
  });

  it('error rate 计算 / error rate calculation', () => {
    collector.recordMetric('a', 1, { error: true });
    collector.recordMetric('b', 1, {});
    collector.recordMetric('c', 1, {});
    collector.recordMetric('d', 1, { error: true });

    const snap = collector.getSnapshot();
    expect(snap.red.errorRate).toBe(0.5);
  });

  it('getTimeSeries 返回数据点 / getTimeSeries returns points', () => {
    collector.recordMetric('cpu', 75);
    collector.recordMetric('cpu', 80);

    const series = collector.getTimeSeries('cpu');
    expect(series.length).toBe(2);
    expect(series[0].value).toBe(75);
    expect(series[1].value).toBe(80);
  });

  it('getTimeSeries 带窗口过滤 / getTimeSeries with window filter', () => {
    const series = collector.getTimeSeries('nonexistent', 60000);
    expect(series).toEqual([]);
  });

  it('reset 清零 / reset clears all', () => {
    collector.recordMetric('a', 1);
    collector.recordMetric('b', 2);
    collector.reset();

    const snap = collector.getSnapshot();
    expect(snap.red.rate).toBe(0);
    expect(snap.red.errorRate).toBe(0);
  });

  it('destroy 停止并重置 / destroy stops and resets', () => {
    collector.start();
    collector.recordMetric('x', 1);
    collector.destroy();

    expect(collector.getStats().running).toBe(false);
    expect(collector.getStats().totalRequests).toBe(0);
  });

  it('duration 记录 / duration recording from messages', () => {
    collector.start();
    bus._emit('task.completed', { duration: 200 });
    bus._emit('task.completed', { duration: 400 });

    const snap = collector.getSnapshot();
    expect(snap.red.avgDuration).toBe(300);
  });

  // ── 状态跟踪测试 / State tracking tests ──────────────────────────

  it('agent 状态跟踪: 注册/更新/离线 / agent state tracking', () => {
    collector.start();
    bus._emit('agent.registered', { agentId: 'a1', persona: 'scout-bee', tier: 'mid' });
    bus._emit('agent.registered', { agentId: 'a2', persona: 'worker-bee' });

    let snap = collector.getSnapshot();
    expect(snap.agents).toHaveLength(2);
    expect(snap.agents.find(a => a.id === 'a1').persona).toBe('scout-bee');
    expect(snap.agents.find(a => a.id === 'a1').status).toBe('active');

    // Agent goes offline
    bus._emit('agent.end', { agentId: 'a1' });
    snap = collector.getSnapshot();
    expect(snap.agents.find(a => a.id === 'a1').status).toBe('offline');

    // Agent a2 still active
    expect(snap.agents.find(a => a.id === 'a2').status).toBe('active');
  });

  it('quality 评估历史 / quality evaluation history', () => {
    collector.start();
    bus._emit('quality.evaluated', { agentId: 'a1', score: 0.85, passed: true });
    bus._emit('quality.evaluated', { agentId: 'a2', score: 0.45, passed: false });

    const snap = collector.getSnapshot();
    expect(snap.qualityEvals).toHaveLength(2);
    expect(snap.qualityEvals[0].score).toBe(0.85);
    expect(snap.qualityEvals[1].passed).toBe(false);
  });

  it('信息素类型计数 / pheromone counts by type', () => {
    collector.start();
    bus._emit('pheromone.emitted', { type: 'trail' });
    bus._emit('pheromone.emitted', { type: 'trail' });
    bus._emit('pheromone.emitted', { type: 'alarm' });

    const snap = collector.getSnapshot();
    expect(snap.pheromonesByType.trail).toBe(2);
    expect(snap.pheromonesByType.alarm).toBe(1);
  });

  it('最近任务列表 / recent tasks list', () => {
    collector.start();
    bus._emit('task.completed', { taskId: 't1', description: 'auth refactor' });
    bus._emit('task.failed', { taskId: 't2', description: 'db migration' });

    const snap = collector.getSnapshot();
    expect(snap.recentTasks).toHaveLength(2);
    expect(snap.recentTasks[0].status).toBe('completed');
    expect(snap.recentTasks[1].status).toBe('failed');
  });

  it('最近记忆操作 / recent memory ops', () => {
    collector.start();
    bus._emit('memory.record', { action: 'record', layer: 'episodic', agentId: 'a1' });
    bus._emit('memory.query', { action: 'query', layer: 'semantic' });

    const snap = collector.getSnapshot();
    expect(snap.recentMemoryOps).toHaveLength(2);
    expect(snap.recentMemoryOps[0].layer).toBe('episodic');
  });

  it('状态跟踪上限 / state tracking cap at 50', () => {
    collector.start();
    for (let i = 0; i < 60; i++) {
      bus._emit('quality.evaluated', { agentId: `a${i}`, score: 0.5, passed: true });
    }

    // Internal array capped at 50
    const snap = collector.getSnapshot();
    // getSnapshot returns slice(-20) of the 50
    expect(snap.qualityEvals.length).toBeLessThanOrEqual(20);
  });

  it('reset 清除状态跟踪 / reset clears state tracking', () => {
    collector.start();
    bus._emit('agent.registered', { agentId: 'a1' });
    bus._emit('quality.evaluated', { score: 0.8, passed: true });
    bus._emit('pheromone.emitted', { type: 'trail' });
    bus._emit('task.completed', { taskId: 't1' });
    bus._emit('memory.record', { action: 'record' });

    collector.reset();
    const snap = collector.getSnapshot();
    expect(snap.agents).toHaveLength(0);
    expect(snap.qualityEvals).toHaveLength(0);
    expect(snap.recentTasks).toHaveLength(0);
    expect(snap.recentMemoryOps).toHaveLength(0);
    expect(Object.keys(snap.pheromonesByType)).toHaveLength(0);
  });
});
