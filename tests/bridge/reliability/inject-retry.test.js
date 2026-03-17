import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { InjectRetry } from '../../../src/bridge/reliability/inject-retry.js';

describe('InjectRetry', () => {
  let mockFallback;

  beforeEach(() => {
    vi.useFakeTimers();
    mockFallback = {
      cacheResult: vi.fn(),
      getCachedResult: vi.fn(),
      getStaticFallback: vi.fn(() => 'static-fallback-msg'),
    };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('first success returns immediately without retry', async () => {
    const ir = new InjectRetry();
    const injectFn = vi.fn().mockResolvedValue(undefined);
    const promise = ir.injectWithRetry('s1', { data: 1 }, injectFn);
    const result = await promise;
    expect(result.success).toBe(true);
    expect(result.attempt).toBe(1);
    expect(injectFn).toHaveBeenCalledTimes(1);
  });

  it('first failure then retry success', async () => {
    const ir = new InjectRetry();
    const injectFn = vi.fn()
      .mockRejectedValueOnce(new Error('fail'))
      .mockResolvedValueOnce(undefined);

    const promise = ir.injectWithRetry('s1', { data: 1 }, injectFn);
    // Advance past the 500ms delay (baseDelay * 2^0)
    await vi.advanceTimersByTimeAsync(500);
    const result = await promise;
    expect(result.success).toBe(true);
    expect(result.attempt).toBe(2);
    expect(injectFn).toHaveBeenCalledTimes(2);
  });

  it('all 3 retries fail returns success:false', async () => {
    const ir = new InjectRetry();
    const injectFn = vi.fn().mockRejectedValue(new Error('fail'));

    const promise = ir.injectWithRetry('s1', { data: 1 }, injectFn);
    // Advance through delay 1: 500ms, delay 2: 1000ms (no delay after last attempt)
    await vi.advanceTimersByTimeAsync(500);
    await vi.advanceTimersByTimeAsync(1000);
    const result = await promise;
    expect(result.success).toBe(false);
    expect(injectFn).toHaveBeenCalledTimes(3);
    expect(ir.getStats().failures).toBe(1);
  });

  it('backoff delays: 500ms then 1000ms', async () => {
    const ir = new InjectRetry();
    const injectFn = vi.fn().mockRejectedValue(new Error('fail'));

    const promise = ir.injectWithRetry('s1', {}, injectFn);
    // After first failure, wait 500ms
    expect(injectFn).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(500);
    expect(injectFn).toHaveBeenCalledTimes(2);
    // After second failure, wait 1000ms
    await vi.advanceTimersByTimeAsync(1000);
    expect(injectFn).toHaveBeenCalledTimes(3);
    await promise;
  });

  it('ipcFallback.cacheResult called on success', async () => {
    const ir = new InjectRetry({ ipcFallback: mockFallback });
    const injectFn = vi.fn().mockResolvedValue(undefined);
    await ir.injectWithRetry('s1', { x: 42 }, injectFn);
    expect(mockFallback.cacheResult).toHaveBeenCalledWith('s1', { x: 42 });
  });

  it('ipcFallback cache hit after all retries fail', async () => {
    mockFallback.getCachedResult.mockReturnValue({ cached: true });
    const ir = new InjectRetry({ ipcFallback: mockFallback });
    const injectFn = vi.fn().mockRejectedValue(new Error('fail'));

    const promise = ir.injectWithRetry('s1', {}, injectFn);
    await vi.advanceTimersByTimeAsync(500);
    await vi.advanceTimersByTimeAsync(1000);
    const result = await promise;
    expect(result.success).toBe(true);
    expect(result.fromCache).toBe(true);
    expect(ir.getStats().cacheHits).toBe(1);
  });

  it('ipcFallback static fallback when no cache', async () => {
    mockFallback.getCachedResult.mockReturnValue(null);
    const ir = new InjectRetry({ ipcFallback: mockFallback });
    const injectFn = vi.fn().mockRejectedValue(new Error('fail'));

    const promise = ir.injectWithRetry('s1', {}, injectFn);
    await vi.advanceTimersByTimeAsync(500);
    await vi.advanceTimersByTimeAsync(1000);
    const result = await promise;
    expect(result.success).toBe(false);
    expect(result.fallback).toBe('static-fallback-msg');
  });

  it('no ipcFallback returns plain success:false', async () => {
    const ir = new InjectRetry(); // no fallback
    const injectFn = vi.fn().mockRejectedValue(new Error('fail'));

    const promise = ir.injectWithRetry('s1', {}, injectFn);
    await vi.advanceTimersByTimeAsync(500);
    await vi.advanceTimersByTimeAsync(1000);
    const result = await promise;
    expect(result.success).toBe(false);
    expect(result.fallback).toBeUndefined();
    expect(result.fromCache).toBeUndefined();
  });

  it('stats track attempts and successes correctly', async () => {
    const ir = new InjectRetry();
    const injectFn = vi.fn()
      .mockRejectedValueOnce(new Error('fail'))
      .mockResolvedValueOnce(undefined);

    const promise = ir.injectWithRetry('s1', {}, injectFn);
    await vi.advanceTimersByTimeAsync(500);
    await promise;

    const stats = ir.getStats();
    expect(stats.attempts).toBe(2);
    expect(stats.successes).toBe(1);
    expect(stats.failures).toBe(0);
  });
});
