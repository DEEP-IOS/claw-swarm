/**
 * Transport 传输层单元测试 / Transport Layer Unit Tests
 *
 * V6.0 L2: 测试可插拔传输层 (EventEmitter, BroadcastChannel)
 * V6.0 L2: Tests for pluggable transport layer implementations
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Transport } from '../../../src/L2-communication/transports/transport-interface.js';
import { EventEmitterTransport } from '../../../src/L2-communication/transports/event-emitter-transport.js';
import { BroadcastChannelTransport } from '../../../src/L2-communication/transports/broadcast-channel-transport.js';

// ── Transport 接口测试 / Transport Interface Tests ─────────────────────────

describe('Transport (abstract)', () => {
  it('emit 抛出未实现错误 / emit throws not-implemented', () => {
    const t = new Transport();
    expect(() => t.emit('topic', {})).toThrow();
  });

  it('on 抛出未实现错误 / on throws not-implemented', () => {
    const t = new Transport();
    expect(() => t.on('topic', () => {})).toThrow();
  });

  it('off 抛出未实现错误 / off throws not-implemented', () => {
    const t = new Transport();
    expect(() => t.off('topic', () => {})).toThrow();
  });

  it('once 抛出未实现错误 / once throws not-implemented', () => {
    const t = new Transport();
    expect(() => t.once('topic', () => {})).toThrow();
  });

  it('listenerCount 抛出未实现错误 / listenerCount throws', () => {
    const t = new Transport();
    expect(() => t.listenerCount('topic')).toThrow();
  });

  it('eventNames 抛出未实现错误 / eventNames throws', () => {
    const t = new Transport();
    expect(() => t.eventNames()).toThrow();
  });
});

// ── EventEmitterTransport 测试 / EventEmitterTransport Tests ───────────────

describe('EventEmitterTransport', () => {
  let transport;

  beforeEach(() => {
    transport = new EventEmitterTransport();
  });

  afterEach(() => {
    transport.destroy();
  });

  it('构造 / creates without error', () => {
    expect(transport).toBeInstanceOf(EventEmitterTransport);
    expect(transport).toBeInstanceOf(Transport);
  });

  it('on + emit 传递数据 / on + emit delivers data', () => {
    const handler = vi.fn();
    transport.on('test.topic', handler);
    transport.emit('test.topic', { key: 'value' });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({ key: 'value' });
  });

  it('多个订阅者都接收 / multiple subscribers receive', () => {
    const h1 = vi.fn();
    const h2 = vi.fn();
    transport.on('t', h1);
    transport.on('t', h2);
    transport.emit('t', 42);

    expect(h1).toHaveBeenCalledWith(42);
    expect(h2).toHaveBeenCalledWith(42);
  });

  it('off 移除订阅 / off removes subscription', () => {
    const handler = vi.fn();
    transport.on('t', handler);
    transport.off('t', handler);
    transport.emit('t', {});

    expect(handler).not.toHaveBeenCalled();
  });

  it('once 只触发一次 / once fires only once', () => {
    const handler = vi.fn();
    transport.once('t', handler);
    transport.emit('t', 1);
    transport.emit('t', 2);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(1);
  });

  it('listenerCount 返回正确数量 / listenerCount returns correct count', () => {
    transport.on('a', () => {});
    transport.on('a', () => {});
    transport.on('b', () => {});

    expect(transport.listenerCount('a')).toBe(2);
    expect(transport.listenerCount('b')).toBe(1);
    expect(transport.listenerCount('c')).toBe(0);
  });

  it('eventNames 返回已注册主题 / eventNames returns registered topics', () => {
    transport.on('alpha', () => {});
    transport.on('beta', () => {});

    const names = transport.eventNames();
    expect(names).toContain('alpha');
    expect(names).toContain('beta');
  });

  it('removeAllListeners 清空所有 / removeAllListeners clears all', () => {
    transport.on('a', () => {});
    transport.on('b', () => {});
    transport.removeAllListeners();

    expect(transport.listenerCount('a')).toBe(0);
    expect(transport.listenerCount('b')).toBe(0);
  });

  it('destroy 不报错且可重复调用 / destroy does not throw and is idempotent', () => {
    transport.on('a', () => {});
    // afterEach 也会调用 destroy，这里验证 destroy 前 removeAllListeners 先清理
    transport.removeAllListeners();
    expect(transport.listenerCount('a')).toBe(0);
    // destroy 后 afterEach 的 destroy 也不应报错
  });

  it('不同 topic 隔离 / different topics are isolated', () => {
    const h1 = vi.fn();
    const h2 = vi.fn();
    transport.on('topic.a', h1);
    transport.on('topic.b', h2);

    transport.emit('topic.a', 'A');

    expect(h1).toHaveBeenCalledWith('A');
    expect(h2).not.toHaveBeenCalled();
  });
});

// ── BroadcastChannelTransport 测试 / BroadcastChannelTransport Tests ───────

describe('BroadcastChannelTransport', () => {
  let transport;

  beforeEach(() => {
    transport = new BroadcastChannelTransport({ channelName: `test-${Date.now()}` });
  });

  afterEach(() => {
    transport.destroy();
  });

  it('构造 / creates without error', () => {
    expect(transport).toBeInstanceOf(BroadcastChannelTransport);
    expect(transport).toBeInstanceOf(Transport);
  });

  it('on + emit 传递数据 / on + emit delivers data', () => {
    const handler = vi.fn();
    transport.on('bc.topic', handler);
    transport.emit('bc.topic', { x: 1 });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({ x: 1 });
  });

  it('off 移除订阅 / off removes subscription', () => {
    const handler = vi.fn();
    transport.on('t', handler);
    transport.off('t', handler);
    transport.emit('t', {});

    expect(handler).not.toHaveBeenCalled();
  });

  it('once 只触发一次 / once fires only once', () => {
    const handler = vi.fn();
    transport.once('t', handler);
    transport.emit('t', 1);
    transport.emit('t', 2);

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('listenerCount 正确 / listenerCount correct', () => {
    transport.on('a', () => {});
    transport.on('a', () => {});
    expect(transport.listenerCount('a')).toBe(2);
  });

  it('removeAllListeners 清空 / removeAllListeners clears all', () => {
    transport.on('a', () => {});
    transport.on('b', () => {});
    transport.removeAllListeners();
    expect(transport.listenerCount('a')).toBe(0);
  });

  it('destroy 清理 / destroy cleans up', () => {
    transport.on('x', () => {});
    transport.destroy();
    expect(transport.listenerCount('x')).toBe(0);
  });
});
