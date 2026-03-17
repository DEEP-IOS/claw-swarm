import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SessionBridge } from '../../../src/bridge/session/session-bridge.js';

describe('SessionBridge', () => {
  let bridge;
  let mockField;
  let mockBus;

  beforeEach(() => {
    mockField = { emit: vi.fn() };
    mockBus = { publish: vi.fn() };
    bridge = new SessionBridge({ field: mockField, bus: mockBus, store: {} });
  });

  it('constructor initializes with empty state', () => {
    expect(bridge._sessions.size).toBe(0);
    expect(bridge._currentScope).toBeNull();
    expect(bridge._stats.started).toBe(0);
    expect(bridge._stats.ended).toBe(0);
  });

  it('startSession creates scope sess-{id.slice(-12)}', () => {
    const scope = bridge.startSession({ id: 'abc-123456789012' });
    expect(scope).toBe('sess-123456789012');
  });

  it('startSession returns scope string and stores session', () => {
    const scope = bridge.startSession({ id: 'session-001' });
    expect(typeof scope).toBe('string');
    expect(scope).toMatch(/^sess-/);
    expect(bridge._sessions.has('session-001')).toBe(true);
  });

  it('startSession emits DIM_TASK on field and publishes bus event', () => {
    bridge.startSession({ id: 'evt-test-99' });
    expect(mockField.emit).toHaveBeenCalledWith('DIM_TASK', expect.objectContaining({
      sessionId: 'evt-test-99',
      event: 'session_start',
    }));
    expect(mockBus.publish).toHaveBeenCalledWith('session.started', expect.objectContaining({
      sessionId: 'evt-test-99',
    }));
  });

  it('endSession cleans up resources and publishes event', () => {
    bridge.startSession({ id: 's1' });
    bridge.endSession({ id: 's1' });
    expect(bridge._sessions.has('s1')).toBe(false);
    expect(bridge._currentScope).toBeNull();
    expect(bridge._stats.ended).toBe(1);
    expect(mockBus.publish).toHaveBeenCalledWith('session.ended', expect.objectContaining({
      sessionId: 's1',
    }));
  });

  it('endSession with unknown ID does not crash', () => {
    expect(() => bridge.endSession({ id: 'nonexistent' })).not.toThrow();
    expect(bridge._stats.ended).toBe(0);
  });

  it('getScope returns correct scope for existing session', () => {
    bridge.startSession({ id: 'lookup-test-abcdef123456' });
    expect(bridge.getScope('lookup-test-abcdef123456')).toBe('sess-abcdef123456');
  });

  it('getScope returns null for unknown session', () => {
    expect(bridge.getScope('does-not-exist')).toBeNull();
  });

  it('manages multiple concurrent sessions independently', () => {
    const s1 = bridge.startSession({ id: 'multi-aaa' });
    const s2 = bridge.startSession({ id: 'multi-bbb' });
    expect(s1).not.toBe(s2);
    expect(bridge._sessions.size).toBe(2);
    expect(bridge.getScope('multi-aaa')).toBe(s1);
    expect(bridge.getScope('multi-bbb')).toBe(s2);

    bridge.endSession({ id: 'multi-aaa' });
    expect(bridge._sessions.size).toBe(1);
    expect(bridge.getScope('multi-aaa')).toBeNull();
    expect(bridge.getScope('multi-bbb')).toBe(s2);
  });

  it('scope mapping is consistent with id slice', () => {
    const ids = ['abcdef-111111111111', 'xyzxyz-222222222222', 'short'];
    for (const id of ids) {
      const scope = bridge.startSession({ id });
      expect(scope).toBe(`sess-${id.slice(-12)}`);
    }
  });

  it('trackAgent and removeAgent update session agents set', () => {
    bridge.startSession({ id: 'track-sess' });
    expect(bridge.trackAgent('track-sess', 'a1')).toBe(true);
    expect(bridge.trackAgent('track-sess', 'a2')).toBe(true);
    expect(bridge.trackAgent('no-sess', 'a3')).toBe(false);

    const sessions = bridge.getActiveSessions();
    expect(sessions[0].agentCount).toBe(2);

    expect(bridge.removeAgent('track-sess', 'a1')).toBe(true);
    expect(bridge.removeAgent('track-sess', 'a99')).toBe(false);
  });
});
