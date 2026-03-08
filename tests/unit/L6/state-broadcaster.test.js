/**
 * StateBroadcaster 单元测试 / StateBroadcaster Unit Tests
 *
 * 测试 L6 状态广播器的客户端管理、事件分发和错误处理。
 * Tests L6 state broadcaster client management, event dispatch, and error handling.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { StateBroadcaster } from '../../../src/L6-monitoring/state-broadcaster.js';

// ── 辅助函数 / Helpers ──────────────────────────────────────────────────────

const silentLogger = { info() {}, warn() {}, error() {}, debug() {} };

/** 模拟 MessageBus (支持 topic.* 通配符) / Mock MessageBus with wildcard support */
function createMockBus() {
  const handlers = [];
  return {
    subscribe(topic, handler) {
      const entry = { topic, handler };
      handlers.push(entry);
      return () => { const i = handlers.indexOf(entry); if (i >= 0) handlers.splice(i, 1); };
    },
    /** 触发匹配的 handler / Trigger matching handlers */
    _emit(topic, data) {
      for (const { topic: t, handler: h } of handlers) {
        const prefix = t.replace('.*', '');
        if (topic.startsWith(prefix + '.') || topic === prefix || t === topic) {
          h({ topic, data, timestamp: Date.now() });
        }
      }
    },
    _handlers: handlers,
  };
}

/** 模拟 SSE 客户端 / Mock SSE client */
function createMockClient() {
  const sent = [];
  return { send(data) { sent.push(data); }, _sent: sent };
}

// ── 测试 / Tests ────────────────────────────────────────────────────────────

describe('StateBroadcaster', () => {
  let bus;
  let broadcaster;

  beforeEach(() => {
    bus = createMockBus();
    broadcaster = new StateBroadcaster({ messageBus: bus, logger: silentLogger });
  });

  it('构造函数初始化 / constructor initializes', () => {
    expect(broadcaster.getClientCount()).toBe(0);
    expect(broadcaster.getStats().broadcasting).toBe(false);
  });

  it('start 订阅 MessageBus / start subscribes to bus', () => {
    broadcaster.start();
    expect(broadcaster.getStats().broadcasting).toBe(true);
    expect(bus._handlers.length).toBeGreaterThan(0);
  });

  it('stop 取消订阅 / stop unsubscribes', () => {
    broadcaster.start();
    broadcaster.stop();
    expect(broadcaster.getStats().broadcasting).toBe(false);
    expect(bus._handlers.length).toBe(0);
  });

  it('addClient 注册客户端 / addClient registers client', () => {
    const client = createMockClient();
    broadcaster.addClient(client);
    expect(broadcaster.getClientCount()).toBe(1);
  });

  it('addClient 返回移除函数 / addClient returns removal fn', () => {
    const client = createMockClient();
    const remove = broadcaster.addClient(client);
    expect(broadcaster.getClientCount()).toBe(1);
    remove();
    expect(broadcaster.getClientCount()).toBe(0);
  });

  it('removeClient 移除客户端 / removeClient removes client', () => {
    const client = createMockClient();
    broadcaster.addClient(client);
    broadcaster.removeClient(client);
    expect(broadcaster.getClientCount()).toBe(0);
  });

  it('广播事件给所有客户端 / broadcasts to all clients', () => {
    broadcaster.start();
    const c1 = createMockClient();
    const c2 = createMockClient();
    broadcaster.addClient(c1);
    broadcaster.addClient(c2);

    bus._emit('task.completed', { taskId: 't1' });

    expect(c1._sent.length).toBe(1);
    expect(c2._sent.length).toBe(1);
    expect(c1._sent[0].event).toBe('task.completed');
    expect(c1._sent[0].data).toEqual({ taskId: 't1' });
  });

  it('无客户端时广播不报错 / broadcast with no clients does not throw', () => {
    broadcaster.start();
    expect(() => bus._emit('task.event', {})).not.toThrow();
  });

  it('死亡客户端自动移除 / dead client auto-removed', () => {
    broadcaster.start();
    const bad = { send() { throw new Error('dead'); } };
    const good = createMockClient();
    broadcaster.addClient(bad);
    broadcaster.addClient(good);
    expect(broadcaster.getClientCount()).toBe(2);

    bus._emit('task.test', {});

    expect(broadcaster.getClientCount()).toBe(1);
    expect(good._sent.length).toBe(1);
  });

  it('getStats 返回正确统计 / getStats returns correct stats', () => {
    broadcaster.start();
    const client = createMockClient();
    broadcaster.addClient(client);
    bus._emit('task.a', {});
    bus._emit('agent.b', {});

    const stats = broadcaster.getStats();
    expect(stats.broadcasting).toBe(true);
    expect(stats.clientCount).toBe(1);
    expect(stats.totalBroadcasts).toBe(2);
  });

  it('多个客户端都接收消息 / multiple clients all receive', () => {
    broadcaster.start();
    const clients = Array.from({ length: 5 }, () => createMockClient());
    clients.forEach((c) => broadcaster.addClient(c));

    bus._emit('task.ping', { v: 1 });

    for (const c of clients) {
      expect(c._sent.length).toBe(1);
    }
  });

  it('destroy 停止并清空 / destroy stops and clears', () => {
    broadcaster.start();
    broadcaster.addClient(createMockClient());
    broadcaster.addClient(createMockClient());
    broadcaster.destroy();

    expect(broadcaster.getStats().broadcasting).toBe(false);
    expect(broadcaster.getClientCount()).toBe(0);
  });
});
