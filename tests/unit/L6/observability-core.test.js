/**
 * ObservabilityCore V5.4 单元测试 / ObservabilityCore V5.4 Unit Tests
 *
 * 测试四类观测数据收集: 决策/执行/修复/策略
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { ObservabilityCore, OBS_CATEGORIES } from '../../../src/L6-monitoring/observability-core.js';

function createMockBus() {
  const _subs = {};
  return {
    publish(topic, data) {
      if (_subs[topic]) {
        for (const cb of _subs[topic]) cb(data);
      }
    },
    subscribe(topic, cb) {
      if (!_subs[topic]) _subs[topic] = [];
      _subs[topic].push(cb);
    },
    _subs,
  };
}

const logger = { info() {}, warn() {}, error() {}, debug() {} };

describe('ObservabilityCore', () => {
  let obs;
  let mockBus;

  beforeEach(() => {
    mockBus = createMockBus();
    obs = new ObservabilityCore({ messageBus: mockBus, logger });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // OBS_CATEGORIES
  // ═══════════════════════════════════════════════════════════════════════

  describe('OBS_CATEGORIES', () => {
    it('导出四类观测类别 / exports 4 observation categories', () => {
      expect(OBS_CATEGORIES.DECISION).toBe('decision');
      expect(OBS_CATEGORIES.EXECUTION).toBe('execution');
      expect(OBS_CATEGORIES.REPAIR).toBe('repair');
      expect(OBS_CATEGORIES.STRATEGY).toBe('strategy');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // observe (手动记录)
  // ═══════════════════════════════════════════════════════════════════════

  describe('observe', () => {
    it('手动记录观测事件 / manually records observation', () => {
      obs.observe('decision', 'arbiter.mode.selected', { mode: 'PREPLAN' }, 'turn-1');

      const recent = obs.getRecent({ category: 'decision' });
      expect(recent.length).toBe(1);
      expect(recent[0].eventType).toBe('arbiter.mode.selected');
      expect(recent[0].data.mode).toBe('PREPLAN');
      expect(recent[0].turnId).toBe('turn-1');
    });

    it('无效类别被忽略 / invalid category ignored', () => {
      obs.observe('invalid_cat', 'test', {});
      expect(obs.getStats().totalEvents).toBe(0);
    });

    it('支持大写类别名 / accepts uppercase category name', () => {
      obs.observe('DECISION', 'test', {});
      expect(obs.getStats().counts.decision).toBe(1);
    });

    it('更新分类计数 / updates category counts', () => {
      obs.observe('decision', 'e1', {});
      obs.observe('decision', 'e2', {});
      obs.observe('execution', 'e3', {});
      obs.observe('repair', 'e4', {});
      obs.observe('strategy', 'e5', {});

      const stats = obs.getStats();
      expect(stats.counts.decision).toBe(2);
      expect(stats.counts.execution).toBe(1);
      expect(stats.counts.repair).toBe(1);
      expect(stats.counts.strategy).toBe(1);
      expect(stats.totalEvents).toBe(5);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // start (事件订阅)
  // ═══════════════════════════════════════════════════════════════════════

  describe('start', () => {
    it('订阅 MessageBus 事件 / subscribes to MessageBus events', () => {
      obs.start();
      expect(obs.getStats().subscribed).toBe(true);

      // 验证订阅了多个事件
      const topicCount = Object.keys(mockBus._subs).length;
      expect(topicCount).toBeGreaterThan(5);
    });

    it('重复 start 不重复订阅 / duplicate start does not re-subscribe', () => {
      obs.start();
      const count1 = Object.keys(mockBus._subs).length;
      obs.start();
      const count2 = Object.keys(mockBus._subs).length;
      expect(count1).toBe(count2);
    });

    it('自动归类 SWARM_ADVISORY_INJECTED → decision', () => {
      obs.start();
      mockBus.publish('swarm.advisory.injected', {
        payload: { turnId: 'turn-1', stimulus: 0.7, arbiterMode: 'PREPLAN' },
      });

      const recent = obs.getRecent({ category: 'decision' });
      expect(recent.length).toBe(1);
    });

    it('自动归类 TASK_COMPLETED → execution', () => {
      obs.start();
      mockBus.publish('task.completed', {
        payload: { taskId: 'task-1', duration: 500 },
      });

      const recent = obs.getRecent({ category: 'execution' });
      expect(recent.length).toBe(1);
    });

    it('自动归类 TOOL_FAILURE → repair', () => {
      obs.start();
      mockBus.publish('tool.failure', {
        payload: { toolName: 'Bash', error: 'timeout' },
      });

      const recent = obs.getRecent({ category: 'repair' });
      expect(recent.length).toBe(1);
    });

    it('自动归类 THRESHOLD_ADJUSTED → strategy', () => {
      obs.start();
      mockBus.publish('threshold.adjusted', {
        payload: { oldThreshold: 0.5, newThreshold: 0.45 },
      });

      const recent = obs.getRecent({ category: 'strategy' });
      expect(recent.length).toBe(1);
    });

    it('无 messageBus 时 start 安全跳过 / no messageBus safely skipped', () => {
      const bareObs = new ObservabilityCore({ logger });
      bareObs.start();
      expect(bareObs.getStats().subscribed).toBe(false);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // getRecent
  // ═══════════════════════════════════════════════════════════════════════

  describe('getRecent', () => {
    it('默认返回最近事件 / returns recent events by default', () => {
      obs.observe('decision', 'e1', {});
      obs.observe('execution', 'e2', {});
      obs.observe('repair', 'e3', {});

      const recent = obs.getRecent();
      expect(recent.length).toBe(3);
    });

    it('按类别过滤 / filters by category', () => {
      obs.observe('decision', 'e1', {});
      obs.observe('execution', 'e2', {});
      obs.observe('decision', 'e3', {});

      const decisions = obs.getRecent({ category: 'decision' });
      expect(decisions.length).toBe(2);
    });

    it('按 turnId 过滤 / filters by turnId', () => {
      obs.observe('decision', 'e1', {}, 'turn-1');
      obs.observe('decision', 'e2', {}, 'turn-2');
      obs.observe('execution', 'e3', {}, 'turn-1');

      const turn1Events = obs.getRecent({ turnId: 'turn-1' });
      expect(turn1Events.length).toBe(2);
    });

    it('限制返回数量 / respects limit', () => {
      for (let i = 0; i < 20; i++) {
        obs.observe('decision', `e${i}`, {});
      }
      const limited = obs.getRecent({ limit: 5 });
      expect(limited.length).toBe(5);
    });

    it('按时间倒序 / sorted by time descending', () => {
      obs.observe('decision', 'first', {});
      obs.observe('decision', 'second', {});

      const recent = obs.getRecent();
      expect(recent[0].timestamp).toBeGreaterThanOrEqual(recent[1].timestamp);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // getTurnTimeline
  // ═══════════════════════════════════════════════════════════════════════

  describe('getTurnTimeline', () => {
    it('返回 turn 的完整时间线 / returns complete turn timeline', () => {
      obs.observe('decision', 'arbiter_mode', {}, 'turn-tl');
      obs.observe('execution', 'tool_call', {}, 'turn-tl');
      obs.observe('repair', 'retry', {}, 'turn-tl');
      obs.observe('strategy', 'threshold_adjust', {}, 'turn-tl');
      obs.observe('decision', 'other_turn', {}, 'turn-other');

      const timeline = obs.getTurnTimeline('turn-tl');
      expect(timeline.length).toBe(4);
      // 按时间正序
      expect(timeline[0].timestamp).toBeLessThanOrEqual(timeline[3].timestamp);
    });

    it('不存在的 turnId 返回空数组 / unknown turnId returns empty', () => {
      expect(obs.getTurnTimeline('nonexistent')).toEqual([]);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // getSummary
  // ═══════════════════════════════════════════════════════════════════════

  describe('getSummary', () => {
    it('返回四类摘要 / returns 4-category summary', () => {
      obs.observe('decision', 'mode_select', {});
      obs.observe('execution', 'task_done', {});
      obs.observe('repair', 'retry', {});
      obs.observe('strategy', 'adjust', {});

      const summary = obs.getSummary();
      expect(summary.decision.count).toBe(1);
      expect(summary.execution.count).toBe(1);
      expect(summary.repair.count).toBe(1);
      expect(summary.strategy.count).toBe(1);
      expect(summary.decision.lastEvent).toBe('mode_select');
    });

    it('无事件时全部为 0 / zero counts when no events', () => {
      const summary = obs.getSummary();
      for (const cat of Object.values(OBS_CATEGORIES)) {
        expect(summary[cat].count).toBe(0);
        expect(summary[cat].lastEvent).toBeNull();
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // getStats
  // ═══════════════════════════════════════════════════════════════════════

  describe('getStats', () => {
    it('返回综合统计 / returns comprehensive stats', () => {
      obs.observe('decision', 'e1', {});
      obs.observe('decision', 'e2', {});

      const stats = obs.getStats();
      expect(stats.totalEvents).toBe(2);
      expect(stats.counts.decision).toBe(2);
      expect(stats.bufferSize).toBe(2);
      expect(stats.bufferCapacity).toBe(500);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 环形缓冲区 / Ring Buffer
  // ═══════════════════════════════════════════════════════════════════════

  describe('ring buffer', () => {
    it('超过容量自动循环覆盖 / overflows wrap around', () => {
      for (let i = 0; i < 510; i++) {
        obs.observe('decision', `event-${i}`, {});
      }
      expect(obs.getStats().bufferSize).toBe(500);
      // 最新的事件应该在
      const recent = obs.getRecent({ limit: 1 });
      expect(recent[0].eventType).toBe('event-509');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 边界情况 / Edge Cases
  // ═══════════════════════════════════════════════════════════════════════

  describe('edge cases', () => {
    it('无 messageBus 仍可手动观测 / manual observe works without bus', () => {
      const bare = new ObservabilityCore({ logger });
      bare.observe('decision', 'test', { key: 'value' });
      expect(bare.getRecent().length).toBe(1);
    });

    it('stop 后不再自动收集 / stop prevents auto collection', () => {
      obs.start();
      obs.stop();
      expect(obs.getStats().subscribed).toBe(false);
    });
  });
});
