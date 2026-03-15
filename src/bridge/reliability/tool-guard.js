/**
 * ToolGuard - ensures swarm_run is called before any other swarm tools.
 * Blocks tool execution for sessions that have not yet activated the swarm
 * by calling swarm_run.
 */
export class ToolGuard {
  constructor(config = {}) {
    this._enabled = config.enabled !== false;
    this._activatedSessions = new Set(); // Sessions that have called swarm_run
    this._swarmToolPrefixes = config.swarmToolPrefixes ?? ['swarm_'];
    this._stats = { checks: 0, blocked: 0, allowed: 0 };
  }

  /**
   * Record that a session has called swarm_run, activating it for all swarm tools.
   * @param {string} sessionId
   */
  recordSwarmRunCall(sessionId) {
    this._activatedSessions.add(sessionId);
  }

  /**
   * Check whether a tool call should be blocked for a given session.
   * Non-swarm tools are always allowed. Swarm tools require prior swarm_run activation.
   * @param {string} sessionId
   * @param {string} toolName
   * @returns {{ blocked: boolean, reason?: string }}
   */
  shouldBlock(sessionId, toolName) {
    this._stats.checks++;

    if (!this._enabled) {
      this._stats.allowed++;
      return { blocked: false };
    }

    // swarm_ prefixed tools are always allowed (they are part of the activation flow)
    const isSwarmTool = this._swarmToolPrefixes.some(p => toolName.startsWith(p));
    if (isSwarmTool) {
      this._stats.allowed++;
      return { blocked: false };
    }

    // Session already activated
    if (this._activatedSessions.has(sessionId)) {
      this._stats.allowed++;
      return { blocked: false };
    }

    // Not activated yet: block
    this._stats.blocked++;
    return {
      blocked: true,
      reason: 'Must call swarm_run first to activate the swarm',
    };
  }

  /**
   * Clear activation state for a session (e.g., when session ends).
   * @param {string} sessionId
   */
  clearSession(sessionId) {
    this._activatedSessions.delete(sessionId);
  }

  /**
   * Enable or disable the guard.
   */
  setEnabled(enabled) {
    this._enabled = enabled;
  }

  /**
   * Return aggregate statistics.
   */
  getStats() {
    return {
      enabled: this._enabled,
      activatedSessions: this._activatedSessions.size,
      ...this._stats,
    };
  }
}
