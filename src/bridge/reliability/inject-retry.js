/**
 * InjectRetry - retries result injection with exponential backoff.
 * Falls back to IPC cache when all retries are exhausted.
 */
export class InjectRetry {
  constructor({ ipcFallback, config = {} } = {}) {
    this._ipcFallback = ipcFallback || null;
    this._maxRetries = config.maxRetries ?? 3;
    this._baseDelay = config.baseDelay ?? 500;
    this._maxDelay = config.maxDelay ?? 4000;
    this._stats = { attempts: 0, successes: 0, failures: 0, cacheHits: 0 };
  }

  /**
   * Attempt to inject a result with retries and fallback.
   * @param {string} sessionId
   * @param {*} result - the result to inject
   * @param {(sessionId: string, result: any) => Promise<void>} injectFn - the injection function
   * @returns {Promise<{ success: boolean, attempt?: number, fromCache?: boolean, fallback?: string }>}
   */
  async injectWithRetry(sessionId, result, injectFn) {
    for (let attempt = 1; attempt <= this._maxRetries; attempt++) {
      try {
        this._stats.attempts++;
        await injectFn(sessionId, result);
        this._stats.successes++;

        // Cache the successful result for future fallback
        if (this._ipcFallback) {
          this._ipcFallback.cacheResult(sessionId, result);
        }

        return { success: true, attempt };
      } catch (err) {
        // Last attempt: skip the delay
        if (attempt < this._maxRetries) {
          const delay = Math.min(
            this._baseDelay * Math.pow(2, attempt - 1),
            this._maxDelay
          );
          await new Promise(r => setTimeout(r, delay));
        }
      }
    }

    // All retries exhausted
    this._stats.failures++;

    // Try IPC fallback cache
    if (this._ipcFallback) {
      const cached = this._ipcFallback.getCachedResult(sessionId);
      if (cached) {
        this._stats.cacheHits++;
        return { success: true, fromCache: true };
      }
      return { success: false, fallback: this._ipcFallback.getStaticFallback() };
    }

    return { success: false };
  }

  /**
   * Return aggregate statistics.
   */
  getStats() {
    return { ...this._stats };
  }
}
