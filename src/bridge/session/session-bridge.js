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
    this._currentSessionId = null;
    this._agentSessions = new Map(); // agentId -> sessionId
    this._dagSessions = new Map(); // dagId -> sessionId
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
    this._currentSessionId = sessionId;
    this._stats.started++;

    // Emit task dimension signal if field supports it
    if (this._field?.emit) {
      try {
        this._field.emit({
          dimension: 'task',
          scope,
          strength: 0.4,
          emitterId: 'session-bridge',
          metadata: { sessionId, event: 'session_start' },
        });
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

    for (const agentId of entry.agents) {
      this._agentSessions.delete(agentId);
    }

    for (const [dagId, sessionId] of [...this._dagSessions.entries()]) {
      if (sessionId === session.id) {
        this._dagSessions.delete(dagId);
      }
    }

    this._sessions.delete(session.id);
    this._stats.ended++;

    if (this._currentScope === entry.scope) {
      this._currentScope = null;
    }
    if (this._currentSessionId === session.id) {
      this._currentSessionId = null;
    }
  }

  /**
   * Associate an agent with a session.
   */
  trackAgent(sessionId, agentId) {
    const entry = this._sessions.get(sessionId);
    if (!entry) return false;
    entry.agents.add(agentId);
    this._agentSessions.set(agentId, sessionId);
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
    if (removed) {
      this._agentSessions.delete(agentId);
      this._stats.agentsRemoved++;
    }
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
   * Get the tracked agent IDs for a session.
   */
  getAgents(sessionId) {
    const entry = this._sessions.get(sessionId);
    return entry ? [...entry.agents] : [];
  }

  /**
   * Get the current active scope.
   */
  getCurrentScope() {
    return this._currentScope;
  }

  /**
   * Get the current active session ID.
   */
  getCurrentSessionId() {
    return this._currentSessionId;
  }

  /**
   * Associate a DAG with the session that initiated it.
   */
  linkDag(sessionId, dagId) {
    if (!sessionId || !dagId || !this._sessions.has(sessionId)) return false;
    this._dagSessions.set(dagId, sessionId);
    return true;
  }

  /**
   * Remove a DAG-to-session mapping.
   */
  unlinkDag(dagId) {
    return this._dagSessions.delete(dagId);
  }

  /**
   * Resolve which session owns a DAG.
   */
  getSessionForDag(dagId) {
    return this._dagSessions.get(dagId) ?? null;
  }

  /**
   * Resolve which session currently owns an agent.
   */
  getSessionForAgent(agentId) {
    return this._agentSessions.get(agentId) ?? null;
  }

  /**
   * List all DAG IDs linked to a session.
   */
  getDagsForSession(sessionId) {
    const dags = [];
    for (const [dagId, linkedSessionId] of this._dagSessions.entries()) {
      if (linkedSessionId === sessionId) dags.push(dagId);
    }
    return dags;
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
      currentSessionId: this._currentSessionId,
      linkedDags: this._dagSessions.size,
    };
  }
}
