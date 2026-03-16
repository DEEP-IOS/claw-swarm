/**
 * ChannelManager 单元测试 -- 通道创建/获取/关闭、重复检测、上限清理、agent 结束自动 leave
 * @module tests/communication/channel/channel-manager.test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ChannelManager } from '../../../src/communication/channel/channel-manager.js';

describe('ChannelManager', () => {
  let field, eventBus, mgr;
  /** 保存 subscribe 注册的 handlers，以便模拟事件触发 */
  const handlers = {};

  beforeEach(() => {
    field = { emit: vi.fn() };
    eventBus = {
      publish: vi.fn(),
      subscribe: vi.fn((topic, handler) => {
        if (!handlers[topic]) handlers[topic] = [];
        handlers[topic].push(handler);
      }),
      unsubscribe: vi.fn(),
    };
    mgr = new ChannelManager({ field, eventBus, maxChannels: 3 });
  });

  afterEach(() => {
    for (const k of Object.keys(handlers)) delete handlers[k];
  });

  // ── create + get ─────────────────────────────────────────────

  it('create returns a TaskChannel and get retrieves it', () => {
    const ch = mgr.create('ch-a');
    expect(ch).toBeDefined();
    expect(mgr.get('ch-a')).toBe(ch);
  });

  it('create duplicate active channel throws', () => {
    mgr.create('ch-a');
    expect(() => mgr.create('ch-a')).toThrow(/already exists/);
  });

  it('create duplicate channelId after close is allowed', () => {
    const ch1 = mgr.create('ch-a');
    ch1.join('a1');
    mgr.close('ch-a');
    const ch2 = mgr.create('ch-a');
    expect(ch2).toBeDefined();
    expect(ch2).not.toBe(ch1);
  });

  // ── close ────────────────────────────────────────────────────

  it('close removes channel from get', () => {
    mgr.create('ch-a');
    mgr.close('ch-a');
    expect(mgr.get('ch-a')).toBeUndefined();
  });

  it('close non-existent channel does not throw', () => {
    expect(() => mgr.close('no-such')).not.toThrow();
  });

  // ── listActive ───────────────────────────────────────────────

  it('listActive returns only open channels', () => {
    mgr.create('ch-a');
    mgr.create('ch-b');
    mgr.close('ch-a');
    const active = mgr.listActive();
    expect(active).toEqual(['ch-b']);
  });

  // ── maxChannels + cleanup ────────────────────────────────────

  it('maxChannels triggers cleanup then allows creation', () => {
    const c1 = mgr.create('ch-1');
    mgr.create('ch-2');
    mgr.create('ch-3');
    // close ch-1 without removing from map (it stays in map as closed)
    c1.join('a1');
    c1.close();
    // Now 2 active + 1 closed in map. cleanup should remove the closed one, freeing a slot.
    const c4 = mgr.create('ch-4');
    expect(c4).toBeDefined();
  });

  it('maxChannels throws when all channels are active', () => {
    mgr.create('ch-1');
    mgr.create('ch-2');
    mgr.create('ch-3');
    expect(() => mgr.create('ch-4')).toThrow(/Max channels/);
  });

  // ── agent.lifecycle.ended auto-leave ─────────────────────────

  it('agent ended event triggers auto-leave from all channels', () => {
    const chA = mgr.create('ch-a');
    const chB = mgr.create('ch-b');
    chA.join('agent-1');
    chA.join('agent-2');
    chB.join('agent-1');

    // Simulate agent.lifecycle.ended for agent-1
    const agentEndedHandlers = handlers['agent.lifecycle.ended'] || [];
    expect(agentEndedHandlers.length).toBeGreaterThan(0);

    // EventBus wraps data in envelope: { topic, ts, source, data }
    agentEndedHandlers[0]({ agentId: 'agent-1' });

    expect(chA.getMembers().map(m => m.agentId)).toEqual(['agent-2']);
    expect(chB.getMembers()).toHaveLength(0);
    // chB should auto-close because last member left
    expect(chB.isClosed()).toBe(true);
  });

  // ── stats ────────────────────────────────────────────────────

  it('stats aggregates correctly', () => {
    const chA = mgr.create('ch-a');
    chA.join('a1');
    chA.post('a1', { type: 'finding', data: 'x' });
    chA.post('a1', { type: 'finding', data: 'y' });
    mgr.create('ch-b');

    const s = mgr.stats();
    expect(s.activeChannels).toBe(2);
    expect(s.closedChannels).toBe(0);
    expect(s.totalMessages).toBe(2);
  });

  // ── stop ─────────────────────────────────────────────────────

  it('stop closes all channels', async () => {
    const chA = mgr.create('ch-a');
    const chB = mgr.create('ch-b');
    chA.join('a1');
    chB.join('a2');
    await mgr.stop();
    expect(chA.isClosed()).toBe(true);
    expect(chB.isClosed()).toBe(true);
  });
});
