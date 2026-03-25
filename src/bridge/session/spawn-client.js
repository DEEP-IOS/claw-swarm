/**
 * SpawnClient - wraps Gateway interaction for spawning sub-agents.
 * Manages agent lifecycle, callbacks, and cancellation.
 */
export class SpawnClient {
  constructor({ config = {} } = {}) {
    this._gatewayHost = config.gatewayHost ?? '127.0.0.1';
    this._gatewayPort = config.gatewayPort ?? 18789;
    this._agents = new Map(); // agentId -> { status, role, model, label, startedAt, callbacks }
    this._spawnCounter = 0;
    this._ipcTimeoutMs = config.ipcTimeoutMs ?? 30000;
    this._stats = { spawned: 0, completed: 0, failed: 0, cancelled: 0 };
    // V8.2 Label Map: maps childSessionKey → { dagId, nodeId, agentId } for DAG feedback
    this._labelMap = new Map();
  }

  /**
   * Spawn a new sub-agent.
   * @param {{ role: string, model?: string, prompt: string, tools?: string[], label?: string, dagId?: string, nodeId?: string, scope?: string }} opts
   * @returns {Promise<string>} agentId
   */
  async spawn({ role, model, prompt, tools, label, dagId, nodeId, scope }) {
    const agentId = `agent-${Date.now()}-${++this._spawnCounter}`;
    // V8.2 pattern: encode dagId:nodeId into label for cross-hook tracing
    const encodedLabel = dagId
      ? `swarm:${dagId}:${agentId}:${nodeId || ''}`.slice(0, 64)
      : (label || `${role}-${agentId.slice(-8)}`).slice(0, 64);
    const safeLabel = encodedLabel;

    this._agents.set(agentId, {
      status: 'running',
      role,
      model: model || 'balanced',
      label: safeLabel,
      prompt,
      tools: tools || [],
      startedAt: Date.now(),
      callbacks: [],
      result: null,
      dagId: dagId || null,
      nodeId: nodeId || null,
      scope: scope || null,
    });
    this._stats.spawned++;

    return agentId;
  }

  /**
   * Register a callback for when an agent finishes.
   * If the agent has already ended, the callback fires immediately.
   */
  onEnded(agentId, callback) {
    const agent = this._agents.get(agentId);
    if (!agent) return false;

    if (agent.status === 'completed' || agent.status === 'failed') {
      // Already ended, fire immediately
      try { callback(agent.result); } catch (_) { /* callback error is non-fatal */ }
      return true;
    }

    agent.callbacks.push(callback);
    return true;
  }

  /**
   * Called when an agent finishes (invoked by the hook system or gateway notification).
   * @param {string} agentId
   * @param {{ success: boolean, output?: any, error?: string }} result
   */
  notifyEnded(agentId, result) {
    const agent = this._agents.get(agentId);
    if (!agent) return;

    agent.status = result.success ? 'completed' : 'failed';
    agent.result = result;
    agent.endedAt = Date.now();

    if (result.success) {
      this._stats.completed++;
    } else {
      this._stats.failed++;
    }

    for (const cb of agent.callbacks) {
      try { cb(result); } catch (_) { /* callback error is non-fatal */ }
    }
    agent.callbacks = [];
  }

  /**
   * Cancel a running agent.
   * @param {string} agentId
   * @returns {Promise<boolean>}
   */
  async cancel(agentId) {
    const agent = this._agents.get(agentId);
    if (!agent || agent.status !== 'running') return false;

    agent.status = 'cancelled';
    agent.endedAt = Date.now();
    this._stats.cancelled++;

    const result = { success: false, error: 'cancelled' };
    agent.result = result;

    for (const cb of agent.callbacks) {
      try { cb(result); } catch (_) { /* callback error is non-fatal */ }
    }
    agent.callbacks = [];

    return true;
  }

  /**
   * Get the status of a specific agent.
   */
  getStatus(agentId) {
    const agent = this._agents.get(agentId);
    if (!agent) return null;
    return {
      agentId,
      status: agent.status,
      role: agent.role,
      model: agent.model,
      label: agent.label,
      dagId: agent.dagId || null,
      nodeId: agent.nodeId || null,
      scope: agent.scope || null,
      startedAt: agent.startedAt,
      endedAt: agent.endedAt || null,
      durationMs: agent.status === 'running'
        ? Date.now() - agent.startedAt
        : (agent.endedAt || Date.now()) - agent.startedAt,
    };
  }

  /**
   * List all agents currently in 'running' status.
   */
  getActiveAgents() {
    const active = [];
    for (const [agentId, agent] of this._agents) {
      if (agent.status === 'running') {
        active.push({
          agentId,
          role: agent.role,
          model: agent.model,
          label: agent.label,
          startedAt: agent.startedAt,
          uptimeMs: Date.now() - agent.startedAt,
        });
      }
    }
    return active;
  }

  /**
   * V8.2 Label Map: register a child session key → agent metadata mapping.
   * Called from subagent_spawned hook to enable DAG feedback on completion.
   */
  mapLabel(childSessionKey, label) {
    if (!childSessionKey || !label) return;
    if (typeof label === 'string' && label.startsWith('swarm:')) {
      const parts = label.split(':');
      this._labelMap.set(childSessionKey, {
        label,
        dagId: parts[1] || null,
        agentId: parts[2] || null,
        nodeId: parts[3] || null,
        _createdAt: Date.now(),
      });
    }
  }

  /**
   * Resolve label metadata for a child session key (consumes the mapping).
   */
  resolveLabel(childSessionKey) {
    const info = this._labelMap.get(childSessionKey);
    if (info) this._labelMap.delete(childSessionKey);
    return info || null;
  }

  /**
   * Find agent by dagId (for DAG status lookups).
   */
  findByDagId(dagId) {
    for (const [agentId, agent] of this._agents) {
      if (agent.dagId === dagId) return { agentId, ...agent };
    }
    return null;
  }

  /**
   * Get the gateway base URL.
   */
  getGatewayUrl() {
    return `http://${this._gatewayHost}:${this._gatewayPort}`;
  }

  /**
   * Return aggregate statistics.
   */
  getStats() {
    return {
      ...this._stats,
      active: this.getActiveAgents().length,
      total: this._agents.size,
    };
  }
}
