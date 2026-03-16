/**
 * TaskChannel 单元测试 -- join/leave 生命周期、消息收发、FIFO 淘汰、事件发布、信号场写入
 * @module tests/communication/channel/task-channel.test
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TaskChannel } from '../../../src/communication/channel/task-channel.js';

describe('TaskChannel', () => {
  let field, eventBus, ch;

  beforeEach(() => {
    field = { emit: vi.fn() };
    eventBus = { publish: vi.fn() };
    ch = new TaskChannel({ channelId: 'ch-1', field, eventBus, maxMembers: 3, maxMessages: 3 });
  });

  // ── join / leave lifecycle ───────────────────────────────────

  it('join then getMembers returns the member', () => {
    ch.join('a1', 'researcher');
    const members = ch.getMembers();
    expect(members).toHaveLength(1);
    expect(members[0].agentId).toBe('a1');
    expect(members[0].role).toBe('researcher');
    expect(typeof members[0].joinedAt).toBe('number');
  });

  it('leave removes the member', () => {
    ch.join('a1');
    ch.join('a2');
    ch.leave('a1');
    const ids = ch.getMembers().map(m => m.agentId);
    expect(ids).toEqual(['a2']);
  });

  it('first join publishes channel.created event', () => {
    ch.join('a1');
    expect(eventBus.publish).toHaveBeenCalledWith(
      'channel.created',
      expect.objectContaining({ channelId: 'ch-1', createdBy: 'a1' }),
    );
  });

  it('second join does NOT re-publish channel.created', () => {
    ch.join('a1');
    eventBus.publish.mockClear();
    ch.join('a2');
    const createdCalls = eventBus.publish.mock.calls.filter(c => c[0] === 'channel.created');
    expect(createdCalls).toHaveLength(0);
  });

  // ── maxMembers ───────────────────────────────────────────────

  it('rejects join when channel is full', () => {
    ch.join('a1');
    ch.join('a2');
    ch.join('a3');
    expect(() => ch.join('a4')).toThrow(/full/);
  });

  // ── close ────────────────────────────────────────────────────

  it('close sets isClosed and post throws', () => {
    ch.join('a1');
    ch.close();
    expect(ch.isClosed()).toBe(true);
    expect(() => ch.post('a1', { type: 'finding', data: 'x' })).toThrow(/closed/i);
  });

  it('join after close throws', () => {
    ch.join('a1');
    ch.close();
    expect(() => ch.join('a2')).toThrow(/closed/i);
  });

  it('close publishes channel.closed and emits field signal', () => {
    ch.join('a1');
    eventBus.publish.mockClear();
    field.emit.mockClear();
    ch.close();
    expect(eventBus.publish).toHaveBeenCalledWith(
      'channel.closed',
      expect.objectContaining({ channelId: 'ch-1' }),
    );
    expect(field.emit).toHaveBeenCalledWith(
      expect.objectContaining({ dimension: 'coordination', metadata: { action: 'closed' } }),
    );
  });

  // ── post ─────────────────────────────────────────────────────

  it('post stores message and publishes channel.message', () => {
    ch.join('a1');
    ch.post('a1', { type: 'finding', data: { key: 42 } });
    const msgs = ch.getMessages();
    expect(msgs).toHaveLength(1);
    expect(msgs[0].type).toBe('finding');
    expect(msgs[0].from).toBe('a1');
    expect(eventBus.publish).toHaveBeenCalledWith(
      'channel.message',
      expect.objectContaining({ channelId: 'ch-1', from: 'a1' }),
    );
  });

  it('post emits field coordination signal', () => {
    ch.join('a1');
    field.emit.mockClear();
    ch.post('a1', { type: 'progress', data: 'step1' });
    expect(field.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        dimension: 'coordination',
        scope: 'ch-1',
        emitterId: 'a1',
        metadata: { action: 'message' },
      }),
    );
  });

  it('non-member post throws', () => {
    ch.join('a1');
    expect(() => ch.post('outsider', { type: 'finding', data: 'x' })).toThrow(/Not a member/);
  });

  it('invalid message type throws', () => {
    ch.join('a1');
    expect(() => ch.post('a1', { type: 'invalid', data: 'x' })).toThrow(/Invalid message type/);
    expect(() => ch.post('a1', null)).toThrow();
  });

  // ── maxMessages FIFO ─────────────────────────────────────────

  it('FIFO eviction when exceeding maxMessages', () => {
    ch.join('a1');
    ch.post('a1', { type: 'finding', data: 'm1' });
    ch.post('a1', { type: 'finding', data: 'm2' });
    ch.post('a1', { type: 'finding', data: 'm3' });
    ch.post('a1', { type: 'finding', data: 'm4' });
    const msgs = ch.getMessages();
    expect(msgs).toHaveLength(3);
    expect(msgs[0].data).toBe('m2');
    expect(msgs[2].data).toBe('m4');
  });

  // ── getMessages filters ──────────────────────────────────────

  it('getMessages filters by type', () => {
    ch.join('a1');
    ch.post('a1', { type: 'finding', data: 'f1' });
    ch.post('a1', { type: 'error', data: 'e1' });
    ch.post('a1', { type: 'finding', data: 'f2' });
    const findings = ch.getMessages({ type: 'finding' });
    expect(findings).toHaveLength(2);
    expect(findings.every(m => m.type === 'finding')).toBe(true);
  });

  it('getMessages filters by limit (returns latest)', () => {
    ch.join('a1');
    ch.post('a1', { type: 'finding', data: 'a' });
    ch.post('a1', { type: 'finding', data: 'b' });
    ch.post('a1', { type: 'finding', data: 'c' });
    const latest2 = ch.getMessages({ limit: 2 });
    expect(latest2).toHaveLength(2);
    expect(latest2[0].data).toBe('b');
    expect(latest2[1].data).toBe('c');
  });

  it('getMessages filters by since', () => {
    ch.join('a1');
    ch.post('a1', { type: 'finding', data: 'old' });
    const threshold = Date.now() + 1;
    // Manually push a message with future ts to test since filter
    ch._messages.push({ from: 'a1', type: 'finding', data: 'new', ts: threshold + 100 });
    const recent = ch.getMessages({ since: threshold });
    expect(recent).toHaveLength(1);
    expect(recent[0].data).toBe('new');
  });

  // ── auto-close on last leave ─────────────────────────────────

  it('leaving last member auto-closes channel', () => {
    ch.join('a1');
    ch.leave('a1');
    expect(ch.isClosed()).toBe(true);
  });

  // ── stats ────────────────────────────────────────────────────

  it('stats returns correct values', () => {
    ch.join('a1');
    ch.post('a1', { type: 'decision', data: 'd1' });
    const s = ch.stats();
    expect(s.channelId).toBe('ch-1');
    expect(s.memberCount).toBe(1);
    expect(s.messageCount).toBe(1);
    expect(s.closed).toBe(false);
    expect(typeof s.createdAt).toBe('number');
    expect(s.closedAt).toBeNull();
  });
});
