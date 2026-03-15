/**
 * SessionBridge - manages session lifecycle and scope mapping.
 * Maps sessions to field scopes and tracks which agents belong to each session.
 */
export class SessionBridge {
  constructor({ field, bus, store, config = {} } = {}) {
    this._field = field;
    this._bus = bus;
    this._store = store;
    this._sessions = new Map(); // sessionId -> { scope, startedAt, agents: Set }
    this._currentScope = null;
    this._config = config;
    this._stats = { started: 0, ended: 0, agentsTracked: 0, agentsRemoved: 0 };
  }

  /**
   * Start a new session with a derived scope identifier.
   * @param {{ id: string }} session
   * @returns {string} scope identifier
   */
  startSession(session) {
    const sessionId = session.id || 'unknown';
    const scope = `sess-${sessionId.slice(-12)}`;

    this._sessions.set(sessionId, {
      scope,
      startedAt: Date.now(),
      agents: new Set(),
    });
    this._currentScope = scope;
    this._stats.started++;

    // Emit task dimension signal if field supports it
    if (this._field?.emit) {
      try {
        this._field.emit('DIM_TASK', { sessionId, scope, event: 'session_start' });
      } catch (_) { /* field emission is best-effort */ }
    }

    this._bus?.publish('session.started', { sessionId, scope });
    return scope;
  }

  /**
   * End a session and clean up its scope.
   * @param {{ id: string }} session
   */
  endSession(session) {
    const entry = this._sessions.get(session.id);
    if (!entry) return;

    this._bus?.publish('session.ended', {
      sessionId: session.id,
      scope: entry.scope,
      durationMs: Date.now() - entry.startedAt,
      agentCount: entry.agents.size,
    });

    this._sessions.delete(session.id);
    this._stats.ended++;

    if (this._currentScope === entry.scope) {
      this._currentScope = null;
    }
  }

  /**
   * Associate an agent with a session.
   */
  trackAgent(sessionId, agentId) {
    const entry = this._sessions.get(sessionId);
    if (!entry) return false;
    entry.agents.add(agentId);
    this._stats.agentsTracked++;
    return true;
  }

  /**
   * Remove an agent from a session.
   */
  removeAgent(sessionId, agentId) {
    const entry = this._sessions.get(sessionId);
    if (!entry) return false;
    const removed = entry.agents.delete(agentId);
    if (removed) this._stats.agentsRemoved++;
    return removed;
  }

  /**
   * Get the scope for a specific session.
   */
  getScope(sessionId) {
    const entry = this._sessions.get(sessionId);
    return entry?.scope ?? null;
  }

  /**
   * Get the current active scope.
   */
  getCurrentScope() {
    return this._currentScope;
  }

  /**
   * List all active sessions with their metadata.
   */
  getActiveSessions() {
    const result = [];
    for (const [id, entry] of this._sessions) {
      result.push({
        sessionId: id,
        scope: entry.scope,
        startedAt: entry.startedAt,
        uptimeMs: Date.now() - entry.startedAt,
        agentCount: entry.agents.size,
        agents: [...entry.agents],
      });
    }
    return result;
  }

  /**
   * Return aggregate statistics.
   */
  getStats() {
    return {
      ...this._stats,
      activeSessions: this._sessions.size,
      currentScope: this._currentScope,
    };
  }
}
