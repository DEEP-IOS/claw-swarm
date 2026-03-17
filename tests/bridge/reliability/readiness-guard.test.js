import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ReadinessGuard } from '../../../src/bridge/reliability/readiness-guard.js';

describe('ReadinessGuard', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('initial state is not ready', () => {
    const guard = new ReadinessGuard();
    expect(guard.isReady()).toBe(false);
    expect(guard.check().ready).toBe(false);
  });

  it('setReady(true) transitions to ready', () => {
    const guard = new ReadinessGuard();
    guard.setReady(true);
    expect(guard.isReady()).toBe(true);
    expect(guard.check().ready).toBe(true);
  });

  it('setReady(false) reverts to not ready', () => {
    const guard = new ReadinessGuard();
    guard.setReady(true);
    guard.setReady(false);
    expect(guard.isReady()).toBe(false);
    expect(guard.check().ready).toBe(false);
  });

  it('check() returns not_ready info when not ready within timeout', () => {
    const guard = new ReadinessGuard({ timeoutMs: 5000 });
    const result = guard.check();
    expect(result.ready).toBe(false);
    expect(result.message).toContain('initializing');
    expect(result.remainingMs).toBeDefined();
  });

  it('check() returns startup_timeout error after timeout elapses', () => {
    const guard = new ReadinessGuard({ timeoutMs: 5000 });
    vi.advanceTimersByTime(6000);
    const result = guard.check();
    expect(result.ready).toBe(false);
    expect(result.error).toBe('startup_timeout');
    expect(result.message).toContain('5000ms');
  });

  it('check() passes normally when ready', () => {
    const guard = new ReadinessGuard();
    guard.setReady(true);
    const result = guard.check();
    expect(result).toEqual({ ready: true });
  });

  it('isReady() returns current boolean state', () => {
    const guard = new ReadinessGuard();
    expect(guard.isReady()).toBe(false);
    guard.setReady(true);
    expect(guard.isReady()).toBe(true);
    guard.setReady(false);
    expect(guard.isReady()).toBe(false);
  });

  it('30s default timeout is respected', () => {
    const guard = new ReadinessGuard(); // default 30000ms
    vi.advanceTimersByTime(29000);
    const beforeTimeout = guard.check();
    expect(beforeTimeout.ready).toBe(false);
    expect(beforeTimeout.error).toBeUndefined();

    vi.advanceTimersByTime(2000); // total 31000ms
    const afterTimeout = guard.check();
    expect(afterTimeout.error).toBe('startup_timeout');
  });

  it('getStats reflects readyAt timestamp', () => {
    const guard = new ReadinessGuard();
    expect(guard.getStats().readyAt).toBeNull();
    guard.setReady(true);
    expect(guard.getStats().readyAt).not.toBeNull();
    guard.setReady(false);
    expect(guard.getStats().readyAt).toBeNull();
  });
});
