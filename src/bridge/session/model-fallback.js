/**
 * ModelFallback - handles model error recovery with retry and fallback chains.
 * Retries on transient errors (429/503/529/timeout), falls back through
 * configured model chains when retries are exhausted.
 */
export class ModelFallback {
  constructor(config = {}) {
    this._fallbackChains = config.chains ?? {
      strong: ['balanced', 'fast'],
      balanced: ['fast'],
      reasoning: ['strong', 'balanced'],
      fast: [],
    };
    this._attempts = new Map(); // "model:roleId" -> { count, lastAttemptAt }
    this._maxRetries = config.maxRetries ?? 3;
    this._maxDelay = config.maxDelay ?? 16000;
    this._stats = { attempts: 0, successes: 0, failures: 0, fallbacks: 0 };
  }

  /**
   * Determine retry/fallback strategy for a model error.
   * @param {Error & { status?: number, code?: string }} error
   * @param {string} currentModel - model tier key (e.g. 'strong', 'balanced')
   * @param {string} roleId - agent role identifier
   * @returns {{ retry: boolean, newModel?: string, delay?: number, attempt?: number, reason?: string, error?: Error }}
   */
  handleError(error, currentModel, roleId) {
    const retryableStatuses = [429, 503, 529];
    const retryable = retryableStatuses.includes(error.status) || error.code === 'TIMEOUT';

    if (!retryable) {
      this._stats.failures++;
      return { retry: false, error };
    }

    const key = `${currentModel}:${roleId || 'default'}`;
    const att = this._attempts.get(key) || { count: 0, lastAttemptAt: 0 };
    att.count++;
    att.lastAttemptAt = Date.now();
    this._attempts.set(key, att);
    this._stats.attempts++;

    // Still have retries left on current model
    if (att.count <= this._maxRetries) {
      const delay = Math.min(1000 * Math.pow(2, att.count - 1), this._maxDelay);
      return { retry: true, newModel: currentModel, delay, attempt: att.count };
    }

    // Retries exhausted: try fallback chain
    const chain = this._fallbackChains[currentModel] || [];
    if (chain.length > 0) {
      this._stats.fallbacks++;
      // Reset attempt counter for the new model
      const newKey = `${chain[0]}:${roleId || 'default'}`;
      this._attempts.set(newKey, { count: 0, lastAttemptAt: Date.now() });
      return { retry: true, newModel: chain[0], delay: 1000, attempt: 1 };
    }

    this._stats.failures++;
    return { retry: false, reason: 'no_fallback' };
  }

  /**
   * Record a successful model call (resets attempt counters).
   */
  recordSuccess(model, roleId) {
    const key = `${model}:${roleId || 'default'}`;
    this._attempts.delete(key);
    this._stats.successes++;
  }

  /**
   * Override the fallback chain configuration.
   */
  configureFallbackChain(chain) {
    if (chain && typeof chain === 'object') {
      Object.assign(this._fallbackChains, chain);
    }
  }

  /**
   * Reset failure counters for a specific model (or all models).
   */
  resetFailures(model) {
    if (model) {
      for (const key of this._attempts.keys()) {
        if (key.startsWith(`${model}:`)) this._attempts.delete(key);
      }
    } else {
      this._attempts.clear();
    }
  }

  /**
   * Return aggregate statistics.
   */
  getStats() {
    return {
      ...this._stats,
      pendingRetries: this._attempts.size,
      chains: { ...this._fallbackChains },
    };
  }
}
