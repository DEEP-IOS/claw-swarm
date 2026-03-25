/**
 * HostAdapter — Abstract interface for host system integration.
 *
 * All OpenClaw-specific dependencies go through this adapter.
 * To port Claw-Swarm to another host (other LLM runtimes, custom runtime, etc.),
 * implement this interface for the new host.
 *
 * @module bridge/integrations/host-adapter
 * @version 9.2.0
 */

/**
 * @typedef {Object} SpawnResult
 * @property {string} runId - Unique run identifier
 * @property {string} sessionKey - Session key for the spawned agent
 */

/**
 * @typedef {Object} CompletionResult
 * @property {'ok'|'error'|'timeout'} status
 * @property {string} [error]
 * @property {Array} [messages] - Agent output messages
 */

/**
 * Create a HostAdapter for OpenClaw.
 *
 * @param {Object} runtime - OpenClaw runtime object (from Plugin SDK)
 * @returns {Object} HostAdapter interface
 */
export function createOpenClawAdapter(runtime) {
  return {
    name: 'openclaw',
    version: runtime?.version || 'unknown',

    /**
     * Check if the host supports agent spawning.
     */
    canSpawnAgents() {
      return !!(runtime?.subagent?.run);
    },

    /**
     * Spawn a new agent.
     * @param {Object} params
     * @param {string} params.sessionKey
     * @param {string} params.message
     * @param {string} [params.model]
     * @param {string} [params.extraSystemPrompt]
     * @returns {Promise<SpawnResult>}
     */
    async spawnAgent({ sessionKey, message, model, extraSystemPrompt }) {
      if (!runtime?.subagent?.run) {
        throw new Error('Host does not support agent spawning');
      }
      const idempotencyKey = `swarm-${sessionKey}-${Date.now()}`;
      return runtime.subagent.run({
        sessionKey,
        message,
        model,
        extraSystemPrompt,
        idempotencyKey,
      });
    },

    /**
     * Wait for a spawned agent to complete.
     * @param {string} runId
     * @param {number} [timeoutMs=300000]
     * @returns {Promise<CompletionResult>}
     */
    async waitForCompletion(runId, timeoutMs = 300000) {
      if (!runtime?.subagent?.waitForRun) {
        throw new Error('Host does not support waitForRun');
      }
      return runtime.subagent.waitForRun({ runId, timeoutMs });
    },

    /**
     * Get messages from a completed agent session.
     * @param {string} sessionKey
     * @param {number} [limit=50]
     * @returns {Promise<Array>}
     */
    async getSessionMessages(sessionKey, limit = 50) {
      if (!runtime?.subagent?.getSessionMessages) return [];
      const result = await runtime.subagent.getSessionMessages({ sessionKey, limit });
      return result?.messages || [];
    },

    /**
     * Send a system event to a running agent (for user interjection).
     * @param {string} text
     * @param {Object} [options]
     * @returns {boolean}
     */
    sendSystemEvent(text, options = {}) {
      if (!runtime?.system?.enqueueSystemEvent) return false;
      runtime.system.enqueueSystemEvent(text, options);
      return true;
    },

    /**
     * Push a message to the user's chat window.
     * @param {string} text
     * @param {Object} [options]
     * @returns {boolean}
     */
    pushToUser(text, options = {}) {
      if (!runtime?.system?.enqueueSystemEvent) return false;
      runtime.system.enqueueSystemEvent(text, options);
      return true;
    },

    /**
     * Request an immediate heartbeat (wake up agent).
     * @param {string} [reason]
     */
    requestHeartbeat(reason) {
      if (runtime?.system?.requestHeartbeatNow) {
        runtime.system.requestHeartbeatNow({ reason: reason || 'swarm-signal' });
      }
    },

    /**
     * Subscribe to runtime events.
     * @param {string} event - 'agentEvent' | 'sessionTranscript'
     * @param {Function} handler
     * @returns {Function} unsubscribe
     */
    onRuntimeEvent(event, handler) {
      if (event === 'agentEvent' && runtime?.events?.onAgentEvent) {
        return runtime.events.onAgentEvent(handler);
      }
      if (event === 'sessionTranscript' && runtime?.events?.onSessionTranscriptUpdate) {
        return runtime.events.onSessionTranscriptUpdate(handler);
      }
      return () => {}; // noop unsubscribe
    },

    /**
     * Delete a session after completion.
     * @param {string} sessionKey
     * @param {boolean} [deleteTranscript=false]
     */
    async cleanupSession(sessionKey, deleteTranscript = false) {
      if (runtime?.subagent?.deleteSession) {
        await runtime.subagent.deleteSession({ sessionKey, deleteTranscript });
      }
    },
  };
}

/**
 * Create a stub HostAdapter for testing or standalone mode.
 * All operations are no-ops or return defaults.
 */
export function createStubAdapter() {
  return {
    name: 'stub',
    version: 'standalone',
    canSpawnAgents: () => false,
    spawnAgent: async () => { throw new Error('Stub adapter cannot spawn agents'); },
    waitForCompletion: async () => ({ status: 'error', error: 'Stub adapter' }),
    getSessionMessages: async () => [],
    sendSystemEvent: () => false,
    pushToUser: () => false,
    requestHeartbeat: () => {},
    onRuntimeEvent: () => () => {},
    cleanupSession: async () => {},
  };
}
