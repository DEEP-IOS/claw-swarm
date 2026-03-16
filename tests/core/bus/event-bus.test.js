/**
 * EventBus 单元测试 — 通配符发布/订阅 + 错误隔离
 * @module tests/core/bus/event-bus.test
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventBus } from '../../../src/core/bus/event-bus.js';

describe('EventBus', () => {
  let bus;

  beforeEach(() => {
    bus = new EventBus();
  });

  // ── subscribe + publish ──────────────────────────────────────

  it('handler receives envelope with correct shape', () => {
    const handler = vi.fn();
    bus.subscribe('task.created', handler);
    bus.publish('task.created', { id: 1 }, 'test-src');

    expect(handler).toHaveBeenCalledOnce();
    const env = handler.mock.calls[0][0];
    expect(env.topic).toBe('task.created');
    expect(env.data).toEqual({ id: 1 });
    expect(env.source).toBe('test-src');
    expect(typeof env.ts).toBe('number');
  });

  it('publish with no subscribers does not throw', () => {
    expect(() => bus.publish('orphan.topic', {})).not.toThrow();
  });

  it('multiple handlers on same topic all receive event', () => {
    const h1 = vi.fn();
    const h2 = vi.fn();
    bus.subscribe('evt', h1);
    bus.subscribe('evt', h2);
    bus.publish('evt', 'data');
    expect(h1).toHaveBeenCalledOnce();
    expect(h2).toHaveBeenCalledOnce();
  });

  // ── unsubscribe ──────────────────────────────────────────────

  it('unsubscribe stops handler from receiving events', () => {
    const handler = vi.fn();
    bus.subscribe('evt', handler);
    bus.unsubscribe('evt', handler);
    bus.publish('evt', 'data');
    expect(handler).not.toHaveBeenCalled();
  });

  it('unsubscribe a handler that was never subscribed does not throw', () => {
    expect(() => bus.unsubscribe('evt', () => {})).not.toThrow();
  });

  // ── once ─────────────────────────────────────────────────────

  it('once handler fires exactly once', () => {
    const handler = vi.fn();
    bus.once('signal', handler);
    bus.publish('signal', 'a');
    bus.publish('signal', 'b');
    expect(handler).toHaveBeenCalledOnce();
    expect(handler.mock.calls[0][0].data).toBe('a');
  });

  // ── wildcard ─────────────────────────────────────────────────

  it('wildcard subscribe matches dotted sub-topics', () => {
    const handler = vi.fn();
    bus.subscribe('field.*', handler);
    bus.publish('field.signal.emitted', { v: 1 });
    expect(handler).toHaveBeenCalledOnce();
    expect(handler.mock.calls[0][0].topic).toBe('field.signal.emitted');
  });

  it('wildcard does not match unrelated topics', () => {
    const handler = vi.fn();
    bus.subscribe('field.*', handler);
    bus.publish('store.snapshot', {});
    expect(handler).not.toHaveBeenCalled();
  });

  it('unsubscribe wildcard handler', () => {
    const handler = vi.fn();
    bus.subscribe('agent.*', handler);
    bus.unsubscribe('agent.*', handler);
    bus.publish('agent.started', {});
    expect(handler).not.toHaveBeenCalled();
  });

  // ── error isolation ──────────────────────────────────────────

  it('handler exception does not block other handlers', () => {
    const bad = vi.fn(() => { throw new Error('boom'); });
    const good = vi.fn();
    bus.subscribe('evt', bad);
    bus.subscribe('evt', good);
    bus.publish('evt', 'data');
    expect(good).toHaveBeenCalledOnce();
  });

  it('handler exception emits bus.error event', () => {
    const errorHandler = vi.fn();
    bus.subscribe('bus.error', errorHandler);
    bus.subscribe('evt', () => { throw new Error('oops'); });
    bus.publish('evt', 'data');
    expect(errorHandler).toHaveBeenCalledOnce();
    expect(errorHandler.mock.calls[0][0].data.originalTopic).toBe('evt');
  });

  it('bus.error handler throwing does not cause infinite recursion', () => {
    bus.subscribe('bus.error', () => { throw new Error('meta-boom'); });
    bus.subscribe('evt', () => { throw new Error('trigger'); });
    // Should complete without hanging or throwing
    expect(() => bus.publish('evt', 'data')).not.toThrow();
  });

  // ── listSubscriptions ────────────────────────────────────────

  it('lists both exact and wildcard subscriptions', () => {
    bus.subscribe('task.done', () => {});
    bus.subscribe('task.done', () => {});
    bus.subscribe('agent.*', () => {});

    const subs = bus.listSubscriptions();
    expect(subs['task.done']).toBe(2);
    expect(subs['agent.*']).toBe(1);
  });

  // ── input validation ─────────────────────────────────────────

  it('subscribe throws TypeError for non-function handler', () => {
    expect(() => bus.subscribe('evt', 'not-a-function')).toThrow(TypeError);
    expect(() => bus.subscribe('evt', null)).toThrow(TypeError);
  });

  // ── envelope defaults ────────────────────────────────────────

  it('envelope source defaults to "unknown"', () => {
    const handler = vi.fn();
    bus.subscribe('evt', handler);
    bus.publish('evt', 'data');
    expect(handler.mock.calls[0][0].source).toBe('unknown');
  });
});
