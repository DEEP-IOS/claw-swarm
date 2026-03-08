/**
 * MessageBus 单元测试 / MessageBus Unit Tests
 *
 * 测试消息总线的发布/订阅、通配符、死信队列、历史回放和统计功能。
 * Tests message bus pub/sub, wildcards, DLQ, history replay, and statistics.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { MessageBus } from '../../../src/L2-communication/message-bus.js';

// 静默 logger，避免测试输出噪音 / Silent logger to suppress test noise
const silentLogger = { warn: () => {}, error: () => {}, info: () => {}, debug: () => {} };

describe('MessageBus', () => {
  /** @type {MessageBus} */
  let bus;

  beforeEach(() => {
    bus = new MessageBus({ logger: silentLogger });
  });

  // ━━━ 发布/订阅 / Publish & Subscribe ━━━

  describe('publish / subscribe — 发布与订阅', () => {
    it('should deliver message to subscriber (订阅者应收到消息)', () => {
      const received = [];
      bus.subscribe('task.created', (msg) => received.push(msg));

      const id = bus.publish('task.created', { name: 'alpha' }, { senderId: 'agent-1', correlationId: 'corr-1' });

      expect(received).toHaveLength(1);
      const msg = received[0];
      expect(msg.id).toBe(id);
      expect(msg.topic).toBe('task.created');
      expect(msg.data).toEqual({ name: 'alpha' });
      expect(msg.senderId).toBe('agent-1');
      expect(msg.correlationId).toBe('corr-1');
      expect(msg.timestamp).toBeTypeOf('number');
    });

    it('should deliver to multiple subscribers on same topic (同一 topic 多个订阅者)', () => {
      const a = [], b = [];
      bus.subscribe('event.x', (msg) => a.push(msg));
      bus.subscribe('event.x', (msg) => b.push(msg));

      bus.publish('event.x', { v: 1 });

      expect(a).toHaveLength(1);
      expect(b).toHaveLength(1);
      expect(a[0].id).toBe(b[0].id);
    });

    it('should not deliver to unrelated topic (无关 topic 不应收到消息)', () => {
      const received = [];
      bus.subscribe('task.created', (msg) => received.push(msg));

      bus.publish('task.completed', { done: true });

      expect(received).toHaveLength(0);
    });
  });

  // ━━━ 取消订阅 / Unsubscribe ━━━

  describe('unsubscribe — 取消订阅', () => {
    it('should stop receiving after unsubscribe (取消后不再收到消息)', () => {
      const received = [];
      const unsub = bus.subscribe('ping', (msg) => received.push(msg));

      bus.publish('ping', { seq: 1 });
      expect(received).toHaveLength(1);

      unsub();
      bus.publish('ping', { seq: 2 });
      expect(received).toHaveLength(1);
    });
  });

  // ━━━ 通配符订阅 / Wildcard Subscriptions ━━━

  describe('wildcard — 通配符订阅', () => {
    it('should match sub-topics with topic.* pattern (task.* 匹配 task.created 等)', () => {
      const received = [];
      bus.subscribe('task.*', (msg) => received.push(msg));

      bus.publish('task.created', { a: 1 });
      bus.publish('task.completed', { b: 2 });

      expect(received).toHaveLength(2);
      expect(received[0].topic).toBe('task.created');
      expect(received[1].topic).toBe('task.completed');
    });

    it('should not match unrelated topics (不应匹配无关 topic)', () => {
      const received = [];
      bus.subscribe('task.*', (msg) => received.push(msg));

      bus.publish('agent.status', { ok: true });

      expect(received).toHaveLength(0);
    });

    it('should support unsubscribe for wildcard (通配符也支持取消订阅)', () => {
      const received = [];
      const unsub = bus.subscribe('sys.*', (msg) => received.push(msg));

      bus.publish('sys.boot', {});
      expect(received).toHaveLength(1);

      unsub();
      bus.publish('sys.shutdown', {});
      expect(received).toHaveLength(1);
    });
  });

  // ━━━ 一次性订阅 / Once ━━━

  describe('once — 一次性订阅', () => {
    it('should auto-unsubscribe after first message (收到一次后自动取消)', () => {
      const received = [];
      bus.once('init', (msg) => received.push(msg));

      bus.publish('init', { first: true });
      bus.publish('init', { second: true });

      expect(received).toHaveLength(1);
      expect(received[0].data).toEqual({ first: true });
    });
  });

  // ━━━ 死信队列 / Dead Letter Queue ━━━

  describe('DLQ — 死信队列', () => {
    it('should capture failed messages in DLQ (处理失败的消息进入 DLQ)', () => {
      bus.subscribe('boom', () => { throw new Error('handler error'); });

      bus.publish('boom', { payload: 'kaboom' });

      const dlq = bus.getDLQ();
      expect(dlq).toHaveLength(1);
      expect(dlq[0].topic).toBe('boom');
      expect(dlq[0].error).toBe('handler error');
    });

    it('clearDLQ should empty the queue (clearDLQ 清空队列)', () => {
      bus.subscribe('fail', () => { throw new Error('oops'); });
      bus.publish('fail', {});

      expect(bus.getDLQ()).toHaveLength(1);
      bus.clearDLQ();
      expect(bus.getDLQ()).toHaveLength(0);
    });

    it('retryDLQ should re-publish dead letters (retryDLQ 重新发布死信)', () => {
      let callCount = 0;
      bus.subscribe('flaky', () => {
        callCount++;
        if (callCount === 1) throw new Error('first fail');
      });

      bus.publish('flaky', { attempt: 1 });
      expect(bus.getDLQ()).toHaveLength(1);

      const retried = bus.retryDLQ();
      expect(retried).toBe(1);
      // 第二次不再抛错，DLQ 应为空 / Second attempt succeeds, DLQ should be empty
      expect(bus.getDLQ()).toHaveLength(0);
    });
  });

  // ━━━ 消息历史 / Message History ━━━

  describe('history — 消息历史', () => {
    it('should record history when enabled (启用后记录历史)', () => {
      const hbus = new MessageBus({ logger: silentLogger, enableHistory: true });

      hbus.publish('log.a', { v: 1 });
      hbus.publish('log.b', { v: 2 });
      hbus.publish('log.a', { v: 3 });

      const all = hbus.getHistory();
      expect(all).toHaveLength(3);
    });

    it('should filter history by topic (按 topic 过滤历史)', () => {
      const hbus = new MessageBus({ logger: silentLogger, enableHistory: true });
      hbus.publish('order.placed', {});
      hbus.publish('order.shipped', {});
      hbus.publish('user.login', {});

      const orders = hbus.getHistory({ topic: 'order' });
      expect(orders).toHaveLength(2);
    });

    it('should respect limit and since filters (支持 limit 和 since 过滤)', () => {
      const hbus = new MessageBus({ logger: silentLogger, enableHistory: true });
      const before = Date.now();
      for (let i = 0; i < 5; i++) hbus.publish('t', { i });

      expect(hbus.getHistory({ limit: 2 })).toHaveLength(2);
      expect(hbus.getHistory({ since: before })).toHaveLength(5);
    });
  });

  // ━━━ 统计 / Statistics ━━━

  describe('getStats — 消息统计', () => {
    it('should track published and delivered counts (统计发布和投递数)', () => {
      bus.subscribe('s', () => {});
      bus.publish('s', {});
      bus.publish('s', {});

      const stats = bus.getStats();
      expect(stats.published).toBe(2);
      expect(stats.delivered).toBe(2);
      expect(stats.errors).toBe(0);
    });
  });

  // ━━━ 活跃 Topics / Active Topics ━━━

  describe('getActiveTopics — 活跃主题', () => {
    it('should return subscribed topic names (返回已订阅的 topic 列表)', () => {
      bus.subscribe('alpha', () => {});
      bus.subscribe('beta', () => {});

      const topics = bus.getActiveTopics();
      expect(topics).toContain('alpha');
      expect(topics).toContain('beta');
    });
  });

  // ━━━ 清理 / Cleanup ━━━

  describe('cleanup — 清理与销毁', () => {
    it('removeAllSubscriptions should clear all listeners (移除所有订阅)', () => {
      const received = [];
      bus.subscribe('x', (msg) => received.push(msg));
      bus.subscribe('y.*', (msg) => received.push(msg));

      bus.removeAllSubscriptions();
      bus.publish('x', {});
      bus.publish('y.z', {});

      expect(received).toHaveLength(0);
      expect(bus.getActiveTopics()).toHaveLength(0);
    });

    it('destroy should clear subscriptions, history, and DLQ (销毁总线)', () => {
      const dbus = new MessageBus({ logger: silentLogger, enableHistory: true });
      dbus.subscribe('d', () => { throw new Error('fail'); });
      dbus.publish('d', {});

      dbus.destroy();

      expect(dbus.getHistory()).toHaveLength(0);
      expect(dbus.getDLQ()).toHaveLength(0);
      expect(dbus.getActiveTopics()).toHaveLength(0);
    });
  });
});
