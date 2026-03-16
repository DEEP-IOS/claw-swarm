/**
 * WorkingMemory — 代理短期工作记忆 单元测试
 * @module tests/intelligence/memory/working-memory
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { WorkingMemory } from '../../../src/intelligence/memory/working-memory.js';
import { EventBus } from '../../../src/core/bus/event-bus.js';

describe('WorkingMemory', () => {
  let eventBus;
  let wm;

  beforeEach(() => {
    eventBus = new EventBus();
    wm = new WorkingMemory({ eventBus, defaultCapacity: 15 });
  });

  it('should create buffer and push/getAll', () => {
    wm.create('a1');
    wm.push('a1', { type: 'msg', content: 'hello' });
    wm.push('a1', { type: 'msg', content: 'world' });
    const all = wm.getAll('a1');
    expect(all).toHaveLength(2);
    expect(all[0].content).toBe('hello');
    expect(all[1].content).toBe('world');
  });

  it('RingBuffer FIFO: capacity=5, push 8 items -> keeps last 5', () => {
    wm.create('a1', 5);
    for (let i = 0; i < 8; i++) {
      wm.push('a1', { type: 'msg', content: `item-${i}` });
    }
    const all = wm.getAll('a1');
    expect(all).toHaveLength(5);
    expect(all[0].content).toBe('item-3');
    expect(all[4].content).toBe('item-7');
  });

  it('getRecent(3) returns last 3 entries', () => {
    wm.create('a1', 10);
    for (let i = 0; i < 6; i++) {
      wm.push('a1', { type: 'msg', content: `item-${i}` });
    }
    const recent = wm.getRecent('a1', 3);
    expect(recent).toHaveLength(3);
    expect(recent[0].content).toBe('item-3');
    expect(recent[2].content).toBe('item-5');
  });

  it('different capacities (5/15/30) correctly applied', () => {
    wm.create('c5', 5);
    wm.create('c15', 15);
    wm.create('c30', 30);
    for (let i = 0; i < 35; i++) {
      wm.push('c5', { type: 'msg', content: `${i}` });
      wm.push('c15', { type: 'msg', content: `${i}` });
      wm.push('c30', { type: 'msg', content: `${i}` });
    }
    expect(wm.getAll('c5')).toHaveLength(5);
    expect(wm.getAll('c15')).toHaveLength(15);
    expect(wm.getAll('c30')).toHaveLength(30);
  });

  it('uses defaultCapacity when capacity not specified', () => {
    wm.create('a1');
    for (let i = 0; i < 20; i++) {
      wm.push('a1', { type: 'msg', content: `${i}` });
    }
    expect(wm.getAll('a1')).toHaveLength(15);
  });

  it('clear() empties the buffer', () => {
    wm.create('a1');
    wm.push('a1', { type: 'msg', content: 'x' });
    wm.push('a1', { type: 'msg', content: 'y' });
    expect(wm.getAll('a1')).toHaveLength(2);
    wm.clear('a1');
    expect(wm.getAll('a1')).toHaveLength(0);
  });

  it('destroy() removes buffer entirely', () => {
    wm.create('a1');
    wm.push('a1', { type: 'msg', content: 'x' });
    wm.destroy('a1');
    expect(wm.getAll('a1')).toEqual([]);
  });

  it('push on non-existent buffer is a no-op', () => {
    wm.push('nonexistent', { type: 'msg', content: 'x' });
    expect(wm.getAll('nonexistent')).toEqual([]);
  });

  it('getRecent on non-existent buffer returns empty', () => {
    expect(wm.getRecent('nonexistent', 5)).toEqual([]);
  });

  it('push auto-adds timestamp when ts is not provided', () => {
    wm.create('a1');
    const before = Date.now();
    wm.push('a1', { type: 'msg', content: 'x' });
    const after = Date.now();
    const entry = wm.getAll('a1')[0];
    expect(entry.ts).toBeGreaterThanOrEqual(before);
    expect(entry.ts).toBeLessThanOrEqual(after);
  });

  it('push preserves explicit timestamp', () => {
    wm.create('a1');
    wm.push('a1', { type: 'msg', content: 'x', ts: 12345 });
    expect(wm.getAll('a1')[0].ts).toBe(12345);
  });

  it('EventBus subscription is registered on construction', () => {
    // Verify EventBus subscriptions exist for lifecycle events
    const subs = eventBus.listSubscriptions();
    expect(subs['agent.lifecycle.spawned']).toBeGreaterThanOrEqual(1);
    expect(subs['agent.lifecycle.ended']).toBeGreaterThanOrEqual(1);
  });
});
