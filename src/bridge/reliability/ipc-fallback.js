/**
 * IpcFallback - provides a last-resort cache and static fallback message
 * when IPC injection to the gateway fails after all retries.
 */
export class IpcFallback {
  constructor(config = {}) {
    this._cache = new Map(); // sessionId -> { result, cachedAt }
    this._staticFallback = config.staticFallback ??
      'The swarm system encountered a temporary issue. Your task has been queued and will be processed shortly.';
    this._maxCacheAge = config.maxCacheAgeMs ?? 5 * 60 * 1000; // 5 minutes
  }

  /**
   * Cache a successful result for a session.
   * @param {string} sessionId
   * @param {*} result
   */
  cacheResult(sessionId, result) {
    this._cache.set(sessionId, { result, cachedAt: Date.now() });
  }

  /**
   * Retrieve a cached result for a session, respecting max age.
   * @param {string} sessionId
   * @returns {*|null}
   */
  getCachedResult(sessionId) {
    const entry = this._cache.get(sessionId);
    if (!entry) return null;

    // Expired cache entries are treated as missing
    if (Date.now() - entry.cachedAt > this._maxCacheAge) {
      this._cache.delete(sessionId);
      return null;
    }

    return entry.result;
  }

  /**
   * Return the static fallback message for when no cache is available.
   */
  getStaticFallback() {
    return this._staticFallback;
  }

  /**
   * Clear cache for a specific session.
   * @param {string} sessionId
   */
  clearSession(sessionId) {
    this._cache.delete(sessionId);
  }

  /**
   * Purge all expired cache entries.
   */
  purgeExpired() {
    const now = Date.now();
    for (const [sessionId, entry] of this._cache) {
      if (now - entry.cachedAt > this._maxCacheAge) {
        this._cache.delete(sessionId);
      }
    }
  }

  /**
   * Return aggregate statistics.
   */
  getStats() {
    return {
      cachedSessions: this._cache.size,
      maxCacheAgeMs: this._maxCacheAge,
    };
  }
}
