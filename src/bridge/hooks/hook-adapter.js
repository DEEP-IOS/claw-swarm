/**
 * HookAdapter - Maps 16 OpenClaw hooks to V9 domain operations.
 *
 * Each handler delegates to the appropriate domain module(s) with
 * safe optional chaining. Every handler is wrapped in try/catch so
 * a single domain failure never tears down the hook pipeline.
 *
 * @module bridge/hooks/hook-adapter
 * @version 9.0.0
 */

const HOOK_COUNT = 16;

/**
 * Safe wrapper: runs fn inside try/catch, returns fallback on error.
 * @param {Function} fn
 * @param {*} fallback
 * @returns {*}
 */
function safe(fn, fallback = undefined) {
  try {
    const result = fn();
    if (result && typeof result.catch === 'function') {
      return result.catch(() => fallback);
    }
    return result;
  } catch (_) {
    return fallback;
  }
}

export class HookAdapter {
  /**
   * @param {Object} deps
   * @param {Object} deps.core             - SwarmCoreV9 instance
   * @param {Object} deps.quality          - Quality system facade
   * @param {Object} deps.observe          - Observe system facade
   * @param {Object} deps.sessionBridge    - SessionBridge instance
   * @param {Object} deps.modelFallback    - ModelFallback instance
   * @param {Object} deps.spawnClient      - SpawnClient instance
   * @param {Object} [deps.config={}]      - Hook-specific config overrides
   */
  constructor({ core, quality, observe, sessionBridge, modelFallback, spawnClient, bus, field, config = {} }) {
    this._core = core;
    this._quality = quality;
    this._observe = observe;
    this._sessionBridge = sessionBridge;
    this._modelFallback = modelFallback;
    this._spawnClient = spawnClient;
    this._bus = bus || core?.bus;
    this._field = field || core?.field;
    this._config = config;
    this._stats = {
      hooksFired: 0,
      hookErrors: 0,
      blockedToolCalls: 0,
      agentsAdvised: 0,
    };
  }

  // ─── Signal helpers ───────────────────────────────────────────────

  /** Safely publish an event to the EventBus. */
  _publish(topic, data) {
    try { this._bus?.publish?.(topic, data, 'hook-adapter'); } catch (_) { /* non-fatal */ }
  }

  /** Safely emit a signal to the SignalField. */
  _emitSignal(dimension, scope, strength, metadata) {
    try {
      this._field?.emit?.({ dimension, scope: scope || 'global', strength, emitterId: 'hook-adapter', metadata });
    } catch (_) { /* non-fatal */ }
  }

  // ─── Registration ─────────────────────────────────────────────────

  /**
   * Register all 16 hooks with the app instance.
   * Uses safe binding so each handler has its own try/catch.
   * @param {Object} app - OpenClaw app instance with addHook method
   */
  registerHooks(app) {
    if (!app?.addHook) return;

    app.addHook('session_start', this.onSessionStart.bind(this));
    app.addHook('session_end', this.onSessionEnd.bind(this));
    app.addHook('message_created', this.onMessageCreated.bind(this));
    app.addHook('before_agent_start', this.onBeforeAgentStart.bind(this));
    app.addHook('agent_start', this.onAgentStart.bind(this));
    app.addHook('agent_end', this.onAgentEnd.bind(this));
    app.addHook('llm_output', this.onLlmOutput.bind(this));
    app.addHook('before_tool_call', this.onBeforeToolCall.bind(this));
    app.addHook('after_tool_call', this.onAfterToolCall.bind(this));
    app.addHook('prependSystemContext', this.onPrependSystemContext.bind(this));
    app.addHook('before_shutdown', this.onBeforeShutdown.bind(this));
    app.addHook('error', this.onError.bind(this));
    app.addHook('tool_result', this.onToolResult.bind(this));
    app.addHook('agent_message', this.onAgentMessage.bind(this));
    app.addHook('activate', this.onActivate.bind(this));
    app.addHook('deactivate', this.onDeactivate.bind(this));
  }

  // ─── Lifecycle Hooks ──────────────────────────────────────────────

  /**
   * activate: start all domains in dependency order.
   */
  onActivate() {
    this._stats.hooksFired++;
    return safe(() => {
      this._core?.communication?.start?.();
      this._core?.intelligence?.start?.();
      this._core?.orchestration?.start?.();
      this._core?.quality?.start?.();
      this._core?.observe?.start?.();
    });
  }

  /**
   * deactivate: stop all domains in reverse order.
   */
  onDeactivate() {
    this._stats.hooksFired++;
    return safe(() => {
      this._core?.observe?.stop?.();
      this._core?.quality?.stop?.();
      this._core?.orchestration?.stop?.();
      this._core?.intelligence?.stop?.();
      this._core?.communication?.stop?.();
    });
  }

  // ─── Session Hooks ────────────────────────────────────────────────

  /**
   * session_start: initialise session scope in SessionBridge.
   */
  onSessionStart(session) {
    this._stats.hooksFired++;
    return safe(() => {
      this._sessionBridge?.startSession(session);
      this._publish('session.started', { sessionId: session?.id });
    });
  }

  /**
   * session_end: clean up session state.
   */
  onSessionEnd(session) {
    this._stats.hooksFired++;
    return safe(() => {
      this._sessionBridge?.endSession(session);
      this._publish('session.ended', { sessionId: session?.id });
    });
  }

  // ─── Message Hook ─────────────────────────────────────────────────

  /**
   * message_created: classify intent and estimate scope.
   * Returns { intent } for downstream hooks.
   */
  onMessageCreated(session, message) {
    this._stats.hooksFired++;
    return safe(() => {
      const content = message?.content || '';
      const sessionId = session?.id;
      const intent = this._core?.intelligence?.classifyIntent?.(content) ?? null;
      const scope = this._core?.intelligence?.estimateScope?.(content) ?? null;
      this._publish('message.created', { sessionId, intent, scope });
      this._emitSignal('task_load', sessionId, 0.4, { intent });
      return { intent, scope };
    }, { intent: null, scope: null });
  }

  // ─── Agent Hooks ──────────────────────────────────────────────────

  /**
   * before_agent_start: MOST COMPLEX HOOK
   * 1. SpawnAdvisor decision
   * 2. Immunity check (failure vaccination)
   * 3. Compliance escalation prompt
   * 4. Build dynamic prompt with context
   * 5. Inject prompt into agent
   * 6. Tool permission filtering
   * 7. Model override from advisor
   */
  async onBeforeAgentStart(session, agent) {
    this._stats.hooksFired++;
    this._stats.agentsAdvised++;
    try {
      const sessionId = session?.id;
      const scope = this._sessionBridge?.getScope(sessionId);
      const requestedRole = agent?.requestedRole || agent?.role || 'implementer';

      // 1. SpawnAdvisor: recommend role, model, tool permissions
      const advice = this._core?.orchestration?.advisor?.advise?.(scope, requestedRole)
        ?? this._core?.orchestration?.adviseSpawn?.(scope, requestedRole)
        ?? { role: requestedRole };

      // 2. Immunity check: get prevention prompts from failure vaccination
      const taskDesc = agent?.task || agent?.label || '';
      const immunity = this._quality?.checkImmunity?.(taskDesc)
        ?? { preventionPrompts: [] };

      // 3. Compliance escalation prompt
      const compliancePrompt = this._quality?.getCompliancePrompt?.(sessionId) ?? '';

      // 4. Build dynamic prompt with all context
      const promptCtx = {
        task: taskDesc,
        session: sessionId,
        immunityWarnings: immunity.preventionPrompts || [],
        complianceWarning: compliancePrompt,
        scope,
      };
      const prompt = this._core?.intelligence?.buildPrompt?.(advice.role || requestedRole, {}, promptCtx);

      // 5. Inject prompt
      if (prompt && agent) {
        agent.systemPrompt = prompt;
      }

      // 6. Tool permissions: restrict tools based on advisor recommendation
      if (advice.allowedTools && agent) {
        agent.allowedTools = advice.allowedTools;
      }

      // 7. Model override from advisor
      if (advice.modelOverride && agent) {
        agent.model = advice.modelOverride;
      }
      if (advice.role && agent) {
        agent.role = advice.role;
      }

      this._publish('spawn.advised', { sessionId, role: advice.role || requestedRole, task: taskDesc });
      this._emitSignal('coherence', sessionId, 0.5, { role: advice.role || requestedRole });

      return { advised: true, role: advice.role || requestedRole };
    } catch (err) {
      this._stats.hookErrors++;
      return { advised: false, error: err.message };
    }
  }

  /**
   * agent_start: begin trace span, track agent in session.
   */
  onAgentStart(session, agent) {
    this._stats.hooksFired++;
    return safe(() => {
      const agentId = agent?.id || 'unknown';
      const sessionId = session?.id;
      this._observe?.startSpan?.(agentId, null, sessionId);
      this._sessionBridge?.trackAgent(sessionId, agentId);
      this._publish('agent.lifecycle.spawned', { agentId, sessionId, role: agent?.role });
      this._emitSignal('task_load', agentId, 0.6, { sessionId, role: agent?.role });
    });
  }

  /**
   * agent_end: end trace span, clean up, quality audit, credit assignment.
   */
  onAgentEnd(session, agent, result) {
    this._stats.hooksFired++;
    return safe(() => {
      const agentId = agent?.id;
      const sessionId = session?.id;
      const success = result?.success !== false;

      // End trace span
      this._observe?.endSpan?.(agentId, { failed: !success });

      // Remove agent from session tracking
      this._sessionBridge?.removeAgent(sessionId, agentId);

      // Notify spawn client
      this._spawnClient?.notifyEnded?.(agentId, result || {});

      // Quality: audit on success, classify failure otherwise
      if (success) {
        this._quality?.auditOutput?.({ agentId, result });
        this._publish('agent.lifecycle.completed', { agentId, sessionId });
        this._emitSignal('trust', agentId, 0.7, { success: true });
        this._emitSignal('quality', agentId, 0.6);
      } else {
        this._quality?.classifyFailure?.({ agentId, error: result?.error });
        this._publish('agent.lifecycle.failed', { agentId, sessionId, error: result?.error });
        this._emitSignal('error_rate', agentId, 0.8, { error: result?.error });
      }
      this._publish('agent.lifecycle.ended', { agentId, sessionId, success });
    });
  }

  // ─── LLM Hook ─────────────────────────────────────────────────────

  /**
   * llm_output: run compliance monitor against generated content.
   */
  onLlmOutput(session, output) {
    this._stats.hooksFired++;
    return safe(() => {
      const sessionId = session?.id;
      const content = output?.content || '';
      this._quality?.checkCompliance?.(sessionId, content, {});
    });
  }

  // ─── Tool Hooks ───────────────────────────────────────────────────

  /**
   * before_tool_call: circuit breaker + tool resilience validation.
   * Returns { blocked: true } to prevent execution if breaker is open or input invalid.
   */
  onBeforeToolCall(session, toolCall) {
    this._stats.hooksFired++;
    return safe(() => {
      const name = toolCall?.name;
      const params = toolCall?.params;

      // Circuit breaker check
      const canExec = this._quality?.canExecuteTool?.(name);
      if (canExec && !canExec.allowed) {
        this._stats.blockedToolCalls++;
        this._publish('quality.breaker.tripped', { toolName: name, reason: canExec.reason });
        this._emitSignal('error_rate', name, 0.7, { breaker: true });
        return { blocked: true, reason: canExec.reason || 'Circuit breaker open' };
      }

      // Tool resilience: schema validation + auto-repair
      const validation = this._quality?.validateTool?.(name, params);
      if (validation && !validation.valid) {
        this._stats.blockedToolCalls++;
        return {
          blocked: true,
          reason: validation.reason || 'Validation failed',
          repairPrompt: validation.repairPrompt,
        };
      }

      return { blocked: false };
    }, { blocked: false });
  }

  /**
   * after_tool_call: record success/failure for circuit breaker.
   */
  onAfterToolCall(session, toolCall, result) {
    this._stats.hooksFired++;
    return safe(() => {
      const name = toolCall?.name;
      const success = result?.success !== false;
      if (success) {
        this._quality?.recordToolSuccess?.(name);
      } else {
        this._quality?.recordToolFailure?.(name, result?.error);
      }
      this._publish('tool.executed', { toolName: name, success });
      this._emitSignal('task_load', name, success ? 0.3 : 0.1, { tool: name });
    });
  }

  // ─── Context Hook ─────────────────────────────────────────────────

  /**
   * prependSystemContext: inject field vector context as XML tags.
   * Returns a string to prepend to the system message.
   */
  onPrependSystemContext(session) {
    this._stats.hooksFired++;
    return safe(() => {
      const sessionId = session?.id;
      const scope = this._sessionBridge?.getScope(sessionId);

      // Superpose field vector for current scope
      const vector = this._core?.field?.superpose?.(scope);
      if (!vector) return '';

      return `<swarm-context>${JSON.stringify(vector)}</swarm-context>`;
    }, '');
  }

  // ─── Shutdown Hook ────────────────────────────────────────────────

  /**
   * before_shutdown: snapshot all domain stores for persistence.
   */
  onBeforeShutdown() {
    this._stats.hooksFired++;
    return safe(() => {
      this._core?.store?.snapshot?.();
      this._publish('store.snapshot.completed', { trigger: 'shutdown' });
    });
  }

  // ─── Error Hook ───────────────────────────────────────────────────

  /**
   * error: route to ModelFallback for retry/fallback decisions.
   */
  onError(session, error) {
    this._stats.hooksFired++;
    this._stats.hookErrors++;
    return safe(() => {
      const model = session?.model || 'balanced';
      const role = session?.role || 'default';
      this._publish('quality.anomaly.detected', { type: 'runtime_error', severity: 'high', error: error?.message });
      this._emitSignal('error_rate', 'system', 0.9, { error: error?.message });
      return this._modelFallback?.handleError?.(error, model, role);
    });
  }

  // ─── Result & Message Hooks ───────────────────────────────────────

  /**
   * tool_result: feed to anomaly detector for event tracking.
   */
  onToolResult(session, result) {
    this._stats.hooksFired++;
    return safe(() => {
      const agentId = session?.agentId || session?.id;
      const toolName = result?.toolName || result?.name;
      const success = result?.success !== false;
      this._quality?.recordAgentEvent?.(agentId, {
        type: 'tool_result',
        tool: toolName,
        success,
        ts: Date.now(),
        ...result,
      });
      this._publish('tool.result.recorded', { agentId, toolName, success });
    });
  }

  /**
   * agent_message: post to task channel and working memory.
   */
  onAgentMessage(session, message) {
    this._stats.hooksFired++;
    return safe(() => {
      const sessionId = session?.id;
      const agentId = message?.agentId || session?.agentId;
      const content = message?.content || '';

      // Post to communication channel
      this._core?.communication?.post?.(sessionId, {
        from: agentId,
        content,
        ts: Date.now(),
      });

      // Append to working memory
      this._core?.intelligence?.appendToMemory?.(sessionId, {
        role: 'agent',
        agentId,
        content,
        ts: Date.now(),
      });

      this._publish('channel.message', { channelId: sessionId, from: agentId });
      this._emitSignal('novelty', sessionId, 0.4, { from: agentId });
    });
  }

  // ─── Stats ────────────────────────────────────────────────────────

  /**
   * Returns the number of hooks this adapter registers.
   * @returns {number}
   */
  getRegisteredHookCount() {
    return HOOK_COUNT;
  }

  /**
   * Return aggregate statistics.
   * @returns {Object}
   */
  getStats() {
    return { ...this._stats };
  }
}
