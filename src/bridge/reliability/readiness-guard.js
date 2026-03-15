/**
 * ReadinessGuard - gates operations until the swarm core is fully initialized.
 * Returns structured status for callers to decide whether to proceed or wait.
 */
export class ReadinessGuard {
  constructor(config = {}) {
    this._ready = false;
    this._readyAt = null;
    this._timeoutMs = config.timeoutMs ?? 30000;
    this._startedAt = Date.now();
    this._reason = null;
  }

  /**
   * Mark the system as ready (or not).
   * @param {boolean} ready
   * @param {string} [reason] - optional reason for the state change
   */
  setReady(ready = true, reason) {
    this._ready = ready;
    this._reason = reason || null;
    if (ready && !this._readyAt) {
      this._readyAt = Date.now();
    } else if (!ready) {
      this._readyAt = null;
    }
  }

  /**
   * Whether the system is currently ready.
   */
  isReady() {
    return this._ready;
  }

  /**
   * Check readiness with timeout awareness.
   * @returns {{ ready: boolean, error?: string, message?: string }}
   */
  check() {
    if (this._ready) {
      return { ready: true };
    }

    const elapsed = Date.now() - this._startedAt;
    if (elapsed > this._timeoutMs) {
      return {
        ready: false,
        error: 'startup_timeout',
        message: `Swarm core did not become ready within ${this._timeoutMs}ms`,
        elapsedMs: elapsed,
      };
    }

    return {
      ready: false,
      message: this._reason || 'Swarm core initializing...',
      elapsedMs: elapsed,
      remainingMs: this._timeoutMs - elapsed,
    };
  }

  /**
   * Return aggregate statistics.
   */
  getStats() {
    return {
      ready: this._ready,
      readyAt: this._readyAt,
      startedAt: this._startedAt,
      uptimeMs: this._readyAt ? Date.now() - this._readyAt : 0,
      timeoutMs: this._timeoutMs,
    };
  }
}
