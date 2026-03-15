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
  }

  /**
   * Spawn a new sub-agent.
   * @param {{ role: string, model?: string, prompt: string, tools?: string[], label?: string }} opts
   * @returns {Promise<string>} agentId
   */
  async spawn({ role, model, prompt, tools, label }) {
    const agentId = `agent-${Date.now()}-${++this._spawnCounter}`;
    // Gateway label limit: 64 characters
    const safeLabel = (label || `${role}-${agentId.slice(-8)}`).slice(0, 64);

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
