import { describe, it, expect, beforeEach } from 'vitest';
import { ModelFallback } from '../../../src/bridge/session/model-fallback.js';

describe('ModelFallback', () => {
  let fb;

  beforeEach(() => {
    fb = new ModelFallback();
  });

  it('constructor sets default chains and maxRetries', () => {
    const stats = fb.getStats();
    expect(stats.chains.strong).toEqual(['balanced', 'fast']);
    expect(stats.chains.balanced).toEqual(['fast']);
    expect(stats.chains.fast).toEqual([]);
    expect(stats.attempts).toBe(0);
  });

  it('non-retryable error returns retry:false immediately', () => {
    const result = fb.handleError({ status: 400 }, 'strong', 'r1');
    expect(result.retry).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('429 error triggers retry on same model', () => {
    const result = fb.handleError({ status: 429 }, 'strong', 'r1');
    expect(result.retry).toBe(true);
    expect(result.newModel).toBe('strong');
    expect(result.attempt).toBe(1);
    expect(result.delay).toBe(1000); // 1000 * 2^0
  });

  it('503 error triggers retry with backoff delay', () => {
    const r1 = fb.handleError({ status: 503 }, 'balanced', 'r1');
    expect(r1.retry).toBe(true);
    expect(r1.delay).toBe(1000);

    const r2 = fb.handleError({ status: 503 }, 'balanced', 'r1');
    expect(r2.delay).toBe(2000); // 1000 * 2^1

    const r3 = fb.handleError({ status: 503 }, 'balanced', 'r1');
    expect(r3.delay).toBe(4000); // 1000 * 2^2
  });

  it('exhausted retries trigger fallback chain: strong -> balanced', () => {
    // Exhaust 3 retries on strong
    fb.handleError({ status: 429 }, 'strong', 'r1');
    fb.handleError({ status: 429 }, 'strong', 'r1');
    fb.handleError({ status: 429 }, 'strong', 'r1');
    // 4th attempt exceeds maxRetries, triggers fallback
    const result = fb.handleError({ status: 429 }, 'strong', 'r1');
    expect(result.retry).toBe(true);
    expect(result.newModel).toBe('balanced');
  });

  it('fallback chain for fast (empty) returns retry:false', () => {
    // Exhaust fast retries
    for (let i = 0; i < 3; i++) {
      fb.handleError({ status: 429 }, 'fast', 'r1');
    }
    const result = fb.handleError({ status: 429 }, 'fast', 'r1');
    expect(result.retry).toBe(false);
    expect(result.reason).toBe('no_fallback');
  });

  it('resetFailures restores attempt counters', () => {
    fb.handleError({ status: 429 }, 'strong', 'r1');
    fb.handleError({ status: 429 }, 'strong', 'r1');
    fb.resetFailures('strong');

    // After reset, attempt count should be back to 1
    const result = fb.handleError({ status: 429 }, 'strong', 'r1');
    expect(result.attempt).toBe(1);
    expect(result.newModel).toBe('strong');
  });

  it('resetFailures with no arg clears all models', () => {
    fb.handleError({ status: 429 }, 'strong', 'r1');
    fb.handleError({ status: 429 }, 'balanced', 'r2');
    fb.resetFailures();
    expect(fb.getStats().pendingRetries).toBe(0);
  });

  it('exponential backoff follows 1000, 2000, 4000 pattern', () => {
    const delays = [];
    for (let i = 0; i < 3; i++) {
      const r = fb.handleError({ status: 429 }, 'strong', 'exp');
      delays.push(r.delay);
    }
    expect(delays).toEqual([1000, 2000, 4000]);
  });

  it('fallback chain order: strong -> balanced -> fast', () => {
    const stats = fb.getStats();
    expect(stats.chains.strong[0]).toBe('balanced');
    expect(stats.chains.strong[1]).toBe('fast');
    expect(stats.chains.balanced[0]).toBe('fast');
  });

  it('recordSuccess resets attempt counter for model', () => {
    fb.handleError({ status: 429 }, 'strong', 'r1');
    fb.handleError({ status: 429 }, 'strong', 'r1');
    fb.recordSuccess('strong', 'r1');

    const result = fb.handleError({ status: 429 }, 'strong', 'r1');
    expect(result.attempt).toBe(1);
    expect(fb.getStats().successes).toBe(1);
  });
});
