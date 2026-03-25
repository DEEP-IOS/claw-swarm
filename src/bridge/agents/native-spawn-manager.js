/**
 * NativeSpawnManager — Replaces SpawnClient with OpenClaw runtime.subagent.
 *
 * Uses the native in-process subagent API instead of HTTP relay:
 *   - runtime.subagent.run() for spawning
 *   - runtime.subagent.waitForRun() for completion
 *   - runtime.subagent.getSessionMessages() for result retrieval
 *   - runtime.subagent.deleteSession() for cleanup
 *   - runtime.system.enqueueSystemEvent() for urgent signals
 *   - runtime.system.requestHeartbeatNow() for wakeup
 *
 * @module bridge/agents/native-spawn-manager
 * @version 9.2.1
 */

export class NativeSpawnManager {
  /**
   * @param {Object} deps
   * @param {Object} deps.runtime - OpenClaw runtime (legacy) OR null
   * @param {Object} deps.hostAdapter - HostAdapter interface (preferred)
   * @param {Object} deps.core - SwarmCoreV9 instance
   * @param {Object} [deps.config={}]
   */
  constructor({ runtime, hostAdapter, core, config = {} }) {
    this._runtime = runtime;
    this._hostAdapter = hostAdapter || null;
    this._core = core;
    this._config = config;

    /** @type {Map<string, Object>} runId -> run record */
    this._activeRuns = new Map();
    /** @type {Map<string, string>} sessionKey -> runId */
    this._sessionToRun = new Map();
    /** @type {Map<string, string>} runId -> dagId:nodeId */
    this._runToDagNode = new Map();

    this._stats = {
      spawned: 0,
      completed: 0,
      failed: 0,
      timeouts: 0,
    };
  }

  /**
   * Check if native subagent API is available.
   */
  isAvailable() {
    if (this._hostAdapter) return this._hostAdapter.canSpawnAgents();
    return !!(this._runtime?.subagent?.run);
  }

  /**
   * Spawn a subagent using runtime.subagent.run().
   *
   * @param {Object} params
   * @param {string} params.sessionKey - Session context for the subagent
   * @param {string} params.message - Task/prompt for the subagent
   * @param {string} [params.role] - Swarm role ID
   * @param {string} [params.model] - LLM model override
   * @param {string} [params.extraSystemPrompt] - Additional system prompt
   * @param {string} [params.dagId] - DAG ID this agent belongs to
   * @param {string} [params.nodeId] - DAG node ID
   * @param {number} [params.timeoutMs] - Execution timeout
   * @returns {Promise<Object>} { runId, sessionKey }
   */
  async spawn(params) {
    if (!this.isAvailable()) {
      throw new Error('NativeSpawnManager: runtime.subagent not available');
    }

    const {
      sessionKey,
      message,
      role,
      model,
      extraSystemPrompt,
      dagId,
      nodeId,
      timeoutMs,
    } = params;

    // Build enriched system prompt with swarm context
    let systemPrompt = extraSystemPrompt || '';
    if (role && this._core?.intelligence) {
      const built = await this._core.intelligence.buildPrompt?.(role, {}, {
        task: message,
        scope: sessionKey,
        dagId,
        nodeId,
      });
      if (built) systemPrompt = built;
    }

    // Check emotion field for model upgrade
    // Filter out swarm-internal tier names (fast/balanced/strong/reasoning) -- only pass real model IDs
    const SWARM_TIERS = new Set(['fast', 'balanced', 'strong', 'reasoning']);
    let effectiveModel = (model && !SWARM_TIERS.has(model)) ? model : undefined;
    if (!effectiveModel && this._core?.field) {
      const emotionSignals = this._core.field.query?.('emotion', sessionKey) || [];
      const avgEmotion = emotionSignals.length > 0
        ? emotionSignals.reduce((s, e) => s + (e.strength || 0), 0) / emotionSignals.length
        : 0;
      if (avgEmotion > 0.6) {
        // High frustration -> use stronger model
        effectiveModel = this._core.intelligence?.modelCapability?.getStrongest?.() || undefined;
      }
    }

    // Consult global modulator for spawn strategy (fixes Broken Circuit #9)
    const modState = this._core?.orchestration?.adaptation?.globalModulator?.getStats?.();
    if (modState?.mode === 'explore' && !effectiveModel) {
      // Exploration mode -> might try different model
      effectiveModel = this._core.intelligence?.modelCapability?.getExperimental?.() || effectiveModel;
    }

    // Use HostAdapter if available, otherwise fall back to direct runtime call
    let result;
    if (this._hostAdapter) {
      result = await this._hostAdapter.spawnAgent({
        sessionKey,
        message,
        model: effectiveModel,
        extraSystemPrompt: systemPrompt,
      });
    } else {
      const idempotencyKey = `swarm-${dagId || 'task'}-${nodeId || 'main'}-${Date.now()}`;
      result = await this._runtime.subagent.run({
        sessionKey,
        message,
        model: effectiveModel,
        extraSystemPrompt: systemPrompt,
        idempotencyKey,
      });
    }

    const runId = result.runId;

    // Generate a stable agentId that LifecycleManager can track
    const agentId = `${role || 'agent'}-${runId}`;

    const record = {
      runId,
      agentId,
      sessionKey,
      role,
      dagId,
      nodeId,
      model: effectiveModel,
      startedAt: Date.now(),
      timeoutMs: timeoutMs || this._config.defaultTimeoutMs || 300000,
    };

    this._activeRuns.set(runId, record);
    this._sessionToRun.set(sessionKey, runId);
    if (dagId && nodeId) {
      this._runToDagNode.set(runId, `${dagId}:${nodeId}`);
    }

    this._stats.spawned++;

    // Register agent with LifecycleManager so lifecycle events fire correctly.
    // This is CRITICAL: without this, markCompleted/markFailed cannot publish
    // agent.lifecycle.completed/failed events, and social modules stay empty.
    const lifecycle = this._core?.intelligence?.lifecycleManager;
    if (lifecycle) {
      try {
        lifecycle.spawn(agentId, role || 'default', { sessionKey, dagId, nodeId, model: effectiveModel });
        lifecycle.markReady(agentId);
      } catch (_) { /* non-fatal: lifecycle may reject duplicate IDs */ }
    }

    // Emit task signal -- sub-agent received a task
    this._core?.field?.emit?.({ dimension: 'task', scope: sessionKey, strength: 0.6, emitterId: 'native-spawn-manager', metadata: { runId, role, dagId, nodeId, event: 'task-received' } });
    if (dagId) {
      this._core?.field?.emit?.({ dimension: 'task', scope: dagId, strength: 0.5, emitterId: 'native-spawn-manager', metadata: { runId, role, nodeId, event: 'agent-spawned' } });
    }

    // Emit coordination signal
    this._core?.field?.emit?.({
      dimension: 'coordination',
      scope: sessionKey,
      strength: 0.6,
      emitterId: 'native-spawn-manager',
      metadata: { runId, agentId, role, dagId, nodeId },
    });

    this._core?.bus?.publish?.('spawn.native.started', {
      runId,
      agentId,
      sessionKey,
      role,
      dagId,
      nodeId,
      model: effectiveModel,
    }, 'native-spawn-manager');

    // Auto-monitor: when this spawn is linked to a DAG, monitor completion in background
    if (dagId && nodeId) {
      this._monitorAndCascade(runId, dagId, nodeId);
    }

    return { runId, sessionKey };
  }

  /**
   * Background monitor: wait for run completion, update DAG, trigger cascade.
   *
   * Also publishes agent.lifecycle.completed/failed events so that social
   * intelligence modules (emotion, reputation, SNA, trust) receive data.
   * This is the PRIMARY emission path when plugin hooks never fire (hooks: 0).
   *
   * @private
   */
  async _monitorAndCascade(runId, dagId, nodeId) {
    // Snapshot record BEFORE waitForCompletion (which deletes it from _activeRuns)
    const savedRecord = this._activeRuns.get(runId) || {};
    const agentId = savedRecord.agentId || `${savedRecord.role || 'agent'}-${runId}`;

    try {
      const completion = await this.waitForCompletion(runId, 300000);
      const success = completion.status === 'ok';

      // Emit agent.lifecycle.completed/failed via LifecycleManager.
      // LifecycleManager.markCompleted/markFailed internally publishes these
      // events on the EventBus, which triggers the cross-wiring in index-v9.js
      // that feeds emotion, reputation, SNA, and trust modules.
      const lifecycle = this._core?.intelligence?.lifecycleManager;
      if (lifecycle) {
        try {
          if (success) {
            lifecycle.markCompleted(agentId, {
              output: completion.messages?.slice(-1)?.[0]?.content || '',
              dagId,
              nodeId,
            });
          } else {
            lifecycle.markFailed(agentId, completion.error || 'subagent_failed');
          }
        } catch (_) { /* non-fatal: agent may not be registered */ }
      }

      // Always publish directly with FULL payload so every cross-wiring
      // listener gets the fields it needs (dagId, parentId, nodeId, roleId).
      // LifecycleManager's publish omits dagId/parentId — which breaks SNA (#4).
      // When LifecycleManager already published, cross-wiring handlers are
      // separate function instances so both deliveries correctly reach them.
      {
        const eventTopic = success ? 'agent.lifecycle.completed' : 'agent.lifecycle.failed';
        this._core?.bus?.publish?.(eventTopic, {
          agentId,
          roleId: savedRecord.role || null,
          dagId,
          nodeId,
          parentId: `orchestrator-${dagId}`,
          ...(success
            ? { result: { output: completion.messages?.slice(-1)?.[0]?.content || '' } }
            : { error: completion.error || 'subagent_failed' }),
        }, 'native-spawn-manager');
      }

      // Field emissions: populate the 12D signal field so readers get real data
      if (success) {
        this._core?.field?.emit?.({ dimension: 'trail', scope: dagId, strength: 0.6, emitterId: 'native-spawn-manager', metadata: { runId, role: savedRecord.role, nodeId, event: 'agent-completed' } });
        this._core?.field?.emit?.({ dimension: 'knowledge', scope: dagId, strength: 0.5, emitterId: 'native-spawn-manager', metadata: { runId, role: savedRecord.role, nodeId, event: 'output-produced' } });
        this._core?.field?.emit?.({ dimension: 'trust', scope: savedRecord.sessionKey || runId, strength: 0.6, emitterId: 'native-spawn-manager', metadata: { dagId, nodeId, success: true } });
        this._core?.field?.emit?.({ dimension: 'learning', scope: dagId, strength: 0.4, emitterId: 'native-spawn-manager', metadata: { role: savedRecord.role, nodeId, event: 'experience-gained' } });
      } else {
        this._core?.field?.emit?.({ dimension: 'alarm', scope: dagId, strength: 0.7, emitterId: 'native-spawn-manager', metadata: { runId, role: savedRecord.role, nodeId, error: completion.error, event: 'agent-failed' } });
        this._core?.field?.emit?.({ dimension: 'emotion', scope: dagId, strength: 0.6, emitterId: 'native-spawn-manager', metadata: { runId, role: savedRecord.role, nodeId, frustration: true } });
      }

      const dagEngine = this._core?.orchestration?.dag;

      if (dagEngine) {
        try {
          if (success) {
            dagEngine.completeNode(dagId, nodeId, {
              success: true,
              output: completion.messages?.slice(-1)?.[0]?.content || '',
            });
          } else {
            dagEngine.failNode(dagId, nodeId, {
              reason: completion.error || 'subagent_failed',
            });
          }

          // Cascade: trigger next ready nodes
          const readyNodes = dagEngine.getReady?.(dagId) || [];
          if (readyNodes.length > 0) {
            this._core?.bus?.publish?.('dag.nodes.ready', { dagId, nodes: readyNodes }, 'native-spawn-manager');
          }

          // Check if DAG is fully complete
          const status = dagEngine.getDAGStatus?.(dagId);
          if (status && status.completed === status.total) {
            this._core?.bus?.publish?.('dag.completed', { dagId }, 'native-spawn-manager');
          }
        } catch (dagErr) {
          this._core?.bus?.publish?.('spawn.native.error', {
            dagId, nodeId, error: dagErr?.message,
          }, 'native-spawn-manager');
        }
      }
    } catch (err) {
      this._core?.field?.emit?.({ dimension: 'alarm', scope: dagId, strength: 0.8, emitterId: 'native-spawn-manager', metadata: { runId, nodeId, error: err?.message, event: 'monitor-error' } });
      this._core?.bus?.publish?.('spawn.native.error', {
        dagId, nodeId, error: err?.message,
      }, 'native-spawn-manager');
    }
  }

  /**
   * Wait for a spawned agent to complete.
   *
   * @param {string} runId
   * @param {number} [timeoutMs]
   * @returns {Promise<Object>} { status, error?, messages? }
   */
  async waitForCompletion(runId, timeoutMs) {
    const record = this._activeRuns.get(runId);
    const timeout = timeoutMs || record?.timeoutMs || 300000;

    let result;
    if (this._hostAdapter) {
      result = await this._hostAdapter.waitForCompletion(runId, timeout);
    } else if (this._runtime?.subagent?.waitForRun) {
      result = await this._runtime.subagent.waitForRun({ runId, timeoutMs: timeout });
    } else {
      throw new Error('No host adapter or runtime available for waitForCompletion');
    }

    if (result.status === 'ok') {
      this._stats.completed++;
    } else if (result.status === 'timeout') {
      this._stats.timeouts++;
    } else {
      this._stats.failed++;
    }

    // Retrieve session messages for the result -- prefer HostAdapter, fall back to runtime
    let messages = [];
    if (record?.sessionKey) {
      try {
        if (this._hostAdapter?.getSessionMessages) {
          messages = await this._hostAdapter.getSessionMessages(record.sessionKey, 50);
        } else if (this._runtime?.subagent?.getSessionMessages) {
          const sessResult = await this._runtime.subagent.getSessionMessages({
            sessionKey: record.sessionKey,
            limit: 50,
          });
          messages = sessResult?.messages || [];
        }
      } catch (_) { /* non-fatal */ }
    }

    // Clean up active run tracking
    this._activeRuns.delete(runId);
    if (record?.sessionKey) {
      this._sessionToRun.delete(record.sessionKey);
    }
    this._runToDagNode.delete(runId);

    this._core?.bus?.publish?.('spawn.native.completed', {
      runId,
      agentId: record?.agentId || `${record?.role || 'agent'}-${runId}`,
      sessionKey: record?.sessionKey,
      status: result.status,
      role: record?.role,
      dagId: record?.dagId,
      nodeId: record?.nodeId,
      output: messages?.slice(-1)?.[0]?.content || '',
      messages,
    }, 'native-spawn-manager');

    return {
      status: result.status,
      error: result.error,
      messages,
      role: record?.role,
      dagId: record?.dagId,
      nodeId: record?.nodeId,
    };
  }

  /**
   * Spawn all ready DAG nodes in parallel.
   * Fixes Broken Circuit #8 (DAG node completion -> next spawn).
   *
   * @param {string} dagId
   * @returns {Promise<Array>} Array of { runId, nodeId, role }
   */
  async spawnReadyNodes(dagId) {
    const dagEngine = this._core?.orchestration?.dag;
    if (!dagEngine) return [];

    // Use the DAG engine's own getReady() which handles dependency checking
    let readyNodes;
    try {
      readyNodes = dagEngine.getReady?.(dagId) || [];
    } catch (_) {
      return [];
    }

    const results = [];
    const zoneManager = this._core?.orchestration?.zoneManager || this._core?.orchestration?.zone;
    const arbiter = this._core?.orchestration?.arbiter;

    for (const node of readyNodes) {
      try {
        // Zone check: if node scope files are in a locked zone, skip this node
        if (zoneManager && arbiter) {
          const nodeScope = node.scope || node.task || '';
          if (typeof nodeScope === 'string' && nodeScope) {
            const zone = zoneManager.identifyZone(nodeScope);
            if (zone !== 'unknown') {
              const lockGranularity = zoneManager.getZoneLockGranularity(zone);
              const lockKey = lockGranularity === 'file' ? nodeScope : zone;
              const isLocked = arbiter.isLocked?.(lockKey);
              if (isLocked) {
                this._core?.bus?.publish?.('spawn.zone.skipped', {
                  dagId, nodeId: node.id, zone, lockKey,
                  reason: `Zone ${zone} is locked (${lockGranularity} granularity)`,
                }, 'native-spawn-manager');
                continue; // Skip this node, it will be retried on next dag.nodes.ready
              }
            }
          }
        }

        const sessionKey = `${dagId}:${node.id}:${Date.now()}`;

        // Build rich task message with context from completed predecessor nodes
        let taskMessage = node.task || node.taskId || `Execute ${node.role} task: ${node.id}`;
        const dagInfo = this._core?.orchestration?.getDAG?.(dagId);
        if (dagInfo?.nodes) {
          const predecessorOutputs = (node.dependsOn || [])
            .map(depId => {
              const dep = dagInfo.nodes.find(n => n.id === depId);
              if (dep?.state === 'COMPLETED' && dep?.result) {
                const output = typeof dep.result === 'string' ? dep.result
                  : dep.result?.output || JSON.stringify(dep.result).slice(0, 500);
                return `[${dep.role || dep.id}]: ${output}`;
              }
              return null;
            })
            .filter(Boolean);

          if (predecessorOutputs.length > 0) {
            taskMessage = `${taskMessage}\n\nPredecessor outputs:\n${predecessorOutputs.join('\n\n')}`;
          }
        }

        // Transition: PENDING -> SPAWNING -> ASSIGNED -> EXECUTING
        try {
          dagEngine.spawnNode?.(dagId, node.id);
          dagEngine.assignNode(dagId, node.id, sessionKey);
          dagEngine.startNode(dagId, node.id);
        } catch (_) { /* state transition best-effort */ }

        const spawnResult = await this.spawn({
          sessionKey,
          message: taskMessage,
          role: node.role,
          dagId,
          nodeId: node.id,
        });

        results.push({
          runId: spawnResult.runId,
          nodeId: node.id,
          role: node.role,
          sessionKey,
        });
      } catch (err) {
        this._core?.bus?.publish?.('spawn.native.error', {
          dagId,
          nodeId: node.id,
          error: err.message,
        }, 'native-spawn-manager');
      }
    }

    return results;
  }

  /**
   * Send urgent system event to a running agent.
   *
   * @param {string} sessionKey
   * @param {string} text
   */
  sendSystemEvent(sessionKey, text) {
    if (this._hostAdapter) {
      return this._hostAdapter.sendSystemEvent(text, { sessionKey });
    }
    if (this._runtime?.system?.enqueueSystemEvent) {
      return this._runtime.system.enqueueSystemEvent(text, { sessionKey });
    }
    return false;
  }

  /**
   * Request immediate heartbeat for urgent signal delivery.
   * Prefers HostAdapter (T0 direct control), falls back to runtime.
   *
   * @param {string} [sessionKey]
   * @param {string} [reason]
   */
  requestHeartbeat(sessionKey, reason) {
    if (this._hostAdapter?.requestHeartbeat) {
      this._hostAdapter.requestHeartbeat(reason || 'swarm-signal');
    } else if (this._runtime?.system?.requestHeartbeatNow) {
      this._runtime.system.requestHeartbeatNow({
        reason: reason || 'swarm-signal',
        sessionKey,
      });
    }
  }

  /**
   * Clean up a session after completion.
   * Prefers HostAdapter (T0 direct control), falls back to runtime.
   *
   * @param {string} sessionKey
   * @param {boolean} [deleteTranscript=false]
   */
  async cleanup(sessionKey, deleteTranscript = false) {
    try {
      if (this._hostAdapter?.cleanupSession) {
        await this._hostAdapter.cleanupSession(sessionKey, deleteTranscript);
      } else if (this._runtime?.subagent?.deleteSession) {
        await this._runtime.subagent.deleteSession({ sessionKey, deleteTranscript });
      }
    } catch (_) { /* non-fatal */ }
    this._sessionToRun.delete(sessionKey);
  }

  /**
   * Cancel a running agent.
   */
  async cancel(runId) {
    const record = this._activeRuns.get(runId);
    if (!record) return false;

    // Send termination event
    if (record.sessionKey) {
      this.sendSystemEvent(record.sessionKey, 'TERMINATE: Task cancelled by swarm orchestrator.');
    }

    this._activeRuns.delete(runId);
    this._sessionToRun.delete(record.sessionKey);
    this._runToDagNode.delete(runId);
    this._stats.failed++;

    return true;
  }

  getStats() {
    return {
      ...this._stats,
      activeRuns: this._activeRuns.size,
      available: this.isAvailable(),
    };
  }

  getActiveRuns() {
    return [...this._activeRuns.values()];
  }
}
