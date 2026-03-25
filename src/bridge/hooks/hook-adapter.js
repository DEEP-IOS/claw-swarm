/**
 * HookAdapter — Maps 25 OpenClaw hooks to V9 domain operations.
 *
 * ══════════════════════════════════════════════════════════════════
 * ARCHITECTURAL SPLIT: Control Hooks vs Data Hooks
 * ══════════════════════════════════════════════════════════════════
 *
 * Category A — "Control Hooks" (MUST use Plugin API)
 *   These hooks return values that BLOCK or ALTER execution flow.
 *   They are the only hooks that genuinely require the Plugin API
 *   hook mechanism because their return values are consumed by
 *   OpenClaw's run loop.
 *
 *   - before_tool_call     → returns { blocked: true } to prevent tool execution
 *   - before_model_resolve → returns { model: string } to override model selection
 *   - llm_output           → returns compliance result, can terminate sessions
 *   - before_agent_start   → returns role/model/tool overrides for agent config
 *   - before_prompt_build  → returns { prependSystemContext } for prompt injection
 *   - inbound_claim        → returns { claimed: true } to intercept messages
 *   - subagent_spawning    → returns enhanced spawn params
 *   - subagent_delivery_target → returns target routing override
 *
 * Category B — "Data Hooks" (redundant with EventBus / T0 path)
 *   These hooks only collect information or emit signals. If OpenClaw
 *   stops calling them, the same data flows through:
 *     1. The T0 getContextInjection() path (primary)
 *     2. EventBus subscriptions in index-v9.js cross-wiring
 *     3. HostAdapter runtime event subscriptions
 *
 *   - session_start / session_end     → data also flows via HostAdapter.onRuntimeEvent
 *   - message_received                → T0 path handles intent classification
 *   - subagent_spawned / agent_end    → NativeSpawnManager publishes same events
 *   - subagent_ended                  → NativeSpawnManager._monitorAndCascade handles this
 *   - after_tool_call / tool_result_persist → circuit breaker tracks via EventBus
 *   - gateway_start / gateway_stop    → handled by index.js service lifecycle
 *   - llm_input                       → signal calibrator can observe via EventBus
 *   - before/after_compaction         → EventBus compaction events
 *   - message_sending / message_sent  → EventBus message events
 *   - before_message_write            → EventBus enrichment
 *   - sessions_yield                  → EventBus yield events
 *
 * DESIGN PRINCIPLE: If ALL Plugin API hooks stopped firing tomorrow,
 * the system STILL works because Category B data flows through T0
 * and EventBus. Only Category A hooks are irreplaceable.
 * ══════════════════════════════════════════════════════════════════
 *
 * @module bridge/hooks/hook-adapter
 * @version 9.2.0
 */

const HOOK_COUNT = 25;

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
  constructor({ core, quality, observe, sessionBridge, modelFallback, spawnClient, interaction = {}, bus, field, config = {} }) {
    this._core = core;
    this._quality = quality || { auditOutput: () => {}, classifyFailure: () => {}, checkImmunity: () => ({ preventionPrompts: [] }) };
    this._observe = observe || { startSpan: () => {}, endSpan: () => {} };
    this._sessionBridge = sessionBridge;
    this._modelFallback = modelFallback;
    this._spawnClient = spawnClient;
    this._interaction = interaction;
    this._taskPresenter = interaction?.taskPresenter ?? null;
    this._userNotifier = interaction?.userNotifier ?? null;
    this._progressTracker = interaction?.progressTracker ?? null;
    this._subagentFailureMessage = interaction?.subagentFailureMessage ?? null;
    this._bus = bus || core?.bus;
    this._field = field || core?.field;
    this._config = config;
    this._stats = {
      hooksFired: 0,
      hookErrors: 0,
      blockedToolCalls: 0,
      agentsAdvised: 0,
    };
    this._terminatedSessions = new Map();
    this._runtimeUnsubscribers = [];

    this._bindRuntimeEventListeners();
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

  _bindRuntimeEventListeners() {
    const listen = this._bus?.on?.bind(this._bus);
    if (!listen) return;

    this._runtimeUnsubscribers.push(
      listen('dag.phase.completed', (payload) => this._onDagPhaseCompleted(payload)),
      listen('synthesis.completed', (payload) => this._onSynthesisCompleted(payload)),
      listen('quality.failure.classified', (payload) => this._onFailureClassified(payload)),
      listen('session.ended', (payload) => this._onTrackedSessionEnded(payload)),
    );
  }

  _onDagPhaseCompleted(payload) {
    const dagId = payload?.dagId;
    if (!dagId || !this._progressTracker) return;

    const role = payload?.role ? ` by ${payload.role}` : '';
    const description = payload?.nodeId
      ? `Phase ${payload.nodeId} completed${role}`
      : `Phase completed${role}`;

    this._progressTracker.recordStep(dagId, {
      agentId: payload?.agentId ?? null,
      tool: payload?.role ? `phase:${payload.role}` : null,
      description,
      filesChanged: [],
    });

    if (!this._progressTracker.shouldNotify(dagId)) return;

    const sessionId = this._sessionBridge?.getSessionForDag?.(dagId);
    if (!sessionId || !this._userNotifier) return;

    const steps = this._progressTracker.getSteps(dagId);
    const estimate = this._progressTracker.getEstimate(dagId);
    const message = this._taskPresenter?.formatProgress?.(steps, estimate)
      ?? this._progressTracker.getSummary(dagId);

    this._userNotifier.notifyProgress(sessionId, message);
  }

  _onSynthesisCompleted(payload) {
    const dagId = payload?.dagId;
    if (!dagId) return;

    const sessionId = this._sessionBridge?.getSessionForDag?.(dagId);
    if (!sessionId || !this._userNotifier) return;

    const mergedResult = payload?.mergedResult ?? null;
    const filesChanged = Array.isArray(mergedResult?.files)
      ? mergedResult.files.map((file) => ({
          path: file?.path,
          action: file?.action || 'modified',
        }))
      : [];
    const output = Array.isArray(mergedResult?.texts) ? mergedResult.texts.join('\n\n') : '';
    const summary = payload?.summary
      || output.split('\n')[0]
      || `DAG ${dagId} completed`;
    const confidence = typeof payload?.avgQuality === 'number'
      ? payload.avgQuality
      : mergedResult?.avgQuality;

    const presentation = this._taskPresenter?.formatCompletion?.({
      summary,
      filesChanged,
      confidence,
      output,
    }) ?? {
      summary,
      filesChanged: filesChanged.map((file) => file.path).filter(Boolean),
      potentialImpact: {},
      nextSteps: [],
      confidence: typeof confidence === 'number' ? confidence : 0.8,
    };

    this._userNotifier.notifyComplete(sessionId, {
      dagId,
      ...presentation,
      conflictCount: payload?.conflictCount ?? 0,
      deduplicatedCount: payload?.deduplicatedCount ?? 0,
      artifacts: payload?.artifacts ?? [],
    });
  }

  _onFailureClassified(payload) {
    const failureContext = payload?.failureContext ?? {};
    const sessionId = failureContext.sessionId
      ?? this._sessionBridge?.getSessionForAgent?.(failureContext.agentId)
      ?? null;

    if (!sessionId || !this._userNotifier) return;

    const generated = this._subagentFailureMessage?.generate?.(failureContext, payload) ?? null;
    const formatted = this._taskPresenter?.formatFailure?.(failureContext.error, payload) ?? null;
    const reason = generated?.message
      ?? formatted?.reason
      ?? `Agent ${failureContext.agentId || 'unknown'} failed.`;
    const suggestion = generated?.suggestion ?? formatted?.suggestion ?? payload?.suggestedStrategy;

    this._userNotifier.notifyBlocked(
      sessionId,
      reason,
      suggestion ? [suggestion] : [],
    );
  }

  _onTrackedSessionEnded(payload) {
    const sessionId = payload?.sessionId;
    if (!sessionId) return;

    this._userNotifier?.clearSession?.(sessionId);

    const dagIds = this._sessionBridge?.getDagsForSession?.(sessionId) ?? [];
    for (const dagId of dagIds) {
      this._progressTracker?.cleanup?.(dagId);
      this._sessionBridge?.unlinkDag?.(dagId);
    }
  }

  // ─── Registration ─────────────────────────────────────────────────

  /**
   * Register all 14 hooks with the app instance.
   * Uses safe binding so each handler has its own try/catch.
   *
   * Hook name mapping (V9.2 — corrected to official PLUGIN_HOOK_NAMES):
   *   message_created  → message_received
   *   agent_start      → subagent_spawned  (before_agent_start already registered)
   *   prependSystemContext → before_prompt_build (returns { prependSystemContext })
   *   before_shutdown  → (merged into gateway_stop)
   *   tool_result      → tool_result_persist
   *   activate         → gateway_start
   *   deactivate       → (merged into gateway_stop)
   *   error / agent_message → removed (no standard hook; handled via EventBus)
   *
   * @param {Object} app - OpenClaw app instance with addHook method
   */
  registerHooks(app) {
    if (!app?.addHook) return;

    // Session lifecycle (standard)
    app.addHook('session_start', this.onSessionStart.bind(this));
    app.addHook('session_end', this.onSessionEnd.bind(this));

    // Message (was: message_created → now: message_received)
    app.addHook('message_received', this.onMessageCreated.bind(this));

    // Agent lifecycle (standard)
    app.addHook('before_agent_start', this.onBeforeAgentStart.bind(this));
    app.addHook('agent_end', this.onAgentEnd.bind(this));

    // Subagent (was: agent_start → now: subagent_spawned for post-spawn tracking)
    app.addHook('subagent_spawned', this.onAgentStart.bind(this));

    // LLM observation (standard)
    app.addHook('llm_output', this.onLlmOutput.bind(this));

    // Tool lifecycle (standard)
    app.addHook('before_tool_call', this.onBeforeToolCall.bind(this));
    app.addHook('after_tool_call', this.onAfterToolCall.bind(this));

    // Tool result persistence (was: tool_result → now: tool_result_persist)
    app.addHook('tool_result_persist', this.onToolResult.bind(this));

    // Context injection (was: prependSystemContext → now: before_prompt_build)
    app.addHook('before_prompt_build', this.onPrependSystemContext.bind(this));

    // Gateway lifecycle (was: activate/deactivate/before_shutdown → now: gateway_start/gateway_stop)
    app.addHook('gateway_start', this.onActivate.bind(this));
    app.addHook('gateway_stop', this.onGatewayStop.bind(this));

    // Model resolution: dual-process router + budget-aware model selection
    app.addHook('before_model_resolve', this.onBeforeModelResolve.bind(this));

    // LLM input observation: feed signal calibrator with input/output pairs
    app.addHook('llm_input', this.onLlmInput.bind(this));

    // Subagent lifecycle: enhance spawn params / handle completion
    app.addHook('subagent_spawning', this.onSubagentSpawning.bind(this));
    app.addHook('subagent_ended', this.onSubagentEnded.bind(this));

    // Compaction lifecycle: protect swarm context during compaction
    app.addHook('before_compaction', this.onBeforeCompaction.bind(this));
    app.addHook('after_compaction', this.onAfterCompaction.bind(this));

    // Inbound message interception
    app.addHook('inbound_claim', this.onInboundClaim.bind(this));

    // Outbound message control
    app.addHook('message_sending', this.onMessageSending.bind(this));
    app.addHook('message_sent', this.onMessageSent.bind(this));

    // Subagent delivery control
    app.addHook('subagent_delivery_target', this.onSubagentDeliveryTarget.bind(this));

    // Message enrichment
    app.addHook('before_message_write', this.onBeforeMessageWrite.bind(this));

    // Session yield (cooperative multitasking)
    app.addHook('sessions_yield', this.onSessionsYield.bind(this));
  }

  // ─── Lifecycle Hooks ──────────────────────────────────────────────

  /**
   * gateway_start: start all domains in dependency order.
   * (Previously registered as 'activate' which is not a valid hook name.)
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
   * gateway_stop: snapshot stores + stop all domains in reverse order.
   * Merges the old 'deactivate' + 'before_shutdown' handlers into one
   * since both map to the standard 'gateway_stop' hook.
   */
  onGatewayStop() {
    this._stats.hooksFired++;
    return safe(() => {
      // Snapshot first (was: before_shutdown)
      this._core?.store?.snapshot?.();
      this._publish('store.snapshot.completed', { trigger: 'shutdown' });

      // Then stop domains in reverse order (was: deactivate)
      this._core?.observe?.stop?.();
      this._core?.quality?.stop?.();
      this._core?.orchestration?.stop?.();
      this._core?.intelligence?.stop?.();
      this._core?.communication?.stop?.();

      // Cleanup runtime event listeners
      for (const unsub of this._runtimeUnsubscribers) {
        try { unsub?.(); } catch (_) { /* ignore */ }
      }
      this._runtimeUnsubscribers.length = 0;
    });
  }

  // ─── Session Hooks ────────────────────────────────────────────────

  /**
   * session_start: initialise session scope in SessionBridge.
   */
  onSessionStart(session) {
    this._stats.hooksFired++;
    return safe(() => {
      if (session?.id) {
        this._terminatedSessions.delete(session.id);
      }
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
      if (session?.id) {
        this._terminatedSessions.delete(session.id);
      }
      this._sessionBridge?.endSession(session);
      this._publish('session.ended', { sessionId: session?.id });
    });
  }

  // ─── Message Hook ─────────────────────────────────────────────────

  /**
   * message_created: classify intent, estimate scope, route the work,
   * and pre-build a plan for slow-path tasks when orchestration requests it.
   */
  onMessageCreated(session, message) {
    this._stats.hooksFired++;
    return safe(() => {
      const content = message?.content || '';
      const sessionId = session?.id;
      const intent = this._core?.intelligence?.classifyIntent?.(content) ?? null;
      const scope = this._core?.intelligence?.estimateScope?.(content) ?? null;
      const route = intent
        ? (this._core?.orchestration?.routeTask?.(intent, scope || {}) ?? null)
        : null;
      const plan = route?.system === 2 && intent
        ? (this._core?.orchestration?.createPlan?.(intent, { ...(scope || {}), routeDecision: route }) ?? null)
        : null;

      this._publish('message.created', { sessionId, intent, scope, route, plan });
      this._emitSignal('task', sessionId, 0.4, { intent });
      return { intent, scope, route, plan };
    }, { intent: null, scope: null, route: null, plan: null });
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
      const terminated = sessionId ? this._terminatedSessions.get(sessionId) : null;
      if (terminated) {
        if (agent) {
          agent.allowedTools = [];
          agent.systemPrompt = 'Task terminated due to repeated compliance violations. Do not continue execution.';
        }
        return {
          advised: false,
          blocked: true,
          reason: terminated.reason,
        };
      }

      const scope = this._sessionBridge?.getScope(sessionId);
      const requestedRole = agent?.requestedRole || agent?.role || 'implementer';

      // 1. SpawnAdvisor: recommend role, model, tool permissions
      //    Skip advise() if no active DAG exists for this session — avoids circular
      //    dependency where advise() needs a DAG that hasn't been created yet.
      const dagIds = this._sessionBridge?.getDagsForSession?.(sessionId) ?? [];
      const hasActiveDag = dagIds.some((dagId) => {
        const dag = this._core?.orchestration?.dag?.getDAG?.(dagId) || this._core?.orchestration?.getDAG?.(dagId);
        return dag && dag.nodes?.some((n) => n.state === 'PENDING' || n.state === 'RUNNING');
      });
      const advice = hasActiveDag
        ? (this._core?.orchestration?.advisor?.advise?.(scope, requestedRole)
            ?? this._core?.orchestration?.adviseSpawn?.(scope, requestedRole)
            ?? { role: requestedRole })
        : { role: requestedRole };

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
      const prompt = await this._core?.intelligence?.buildPrompt?.(advice.role || requestedRole, {}, promptCtx);

      // 5. Inject prompt
      if (prompt && agent) {
        agent.systemPrompt = prompt;
      }

      // 6. Tool permissions: restrict tools based on advisor recommendation
      if (advice.allowedTools && agent) {
        agent.allowedTools = advice.allowedTools;
      }

      // 7. Model override from advisor
      if ((advice.modelOverride || advice.model) && agent) {
        agent.model = advice.modelOverride || advice.model;
      }
      if (advice.role && agent) {
        agent.role = advice.role;
      }

      this._publish('spawn.advised', { sessionId, role: advice.role || requestedRole, task: taskDesc });
      this._emitSignal('coordination', sessionId, 0.5, { role: advice.role || requestedRole });

      return { advised: true, role: advice.role || requestedRole };
    } catch (err) {
      this._stats.hookErrors++;
      return { advised: false, error: err.message };
    }
  }

  /**
   * subagent_spawned: begin trace span, track agent in session.
   * (Previously registered as 'agent_start' which is not a valid hook name.)
   *
   * Hook payload: { parentSession, childSession, agent }
   * We accept both the new object-style and legacy (session, agent) positional args.
   */
  onAgentStart(sessionOrPayload, agentArg) {
    this._stats.hooksFired++;
    return safe(() => {
      // Handle both payload shapes
      const agent = agentArg ?? sessionOrPayload?.agent;
      const session = agentArg ? sessionOrPayload : (sessionOrPayload?.childSession ?? sessionOrPayload?.parentSession);
      const agentId = agent?.id || 'unknown';
      const sessionId = session?.id;
      const label = agent?.label || sessionOrPayload?.label;

      // V8.2 Label Map: register child session → agent metadata for DAG feedback
      if (label && this._spawnClient?.mapLabel) {
        this._spawnClient.mapLabel(sessionId, label);
      }

      this._observe?.startSpan?.(agentId, null, sessionId);
      this._sessionBridge?.trackAgent(sessionId, agentId);
      this._publish('agent.lifecycle.spawned', { agentId, sessionId, role: agent?.role, label });
      this._emitSignal('task', agentId, 0.6, { sessionId, role: agent?.role });
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

      // Resolve dagId/nodeId: check SpawnClient first (has DAG metadata), then agent object
      const spawnInfo = this._spawnClient?.getStatus?.(agentId);
      const dagId = spawnInfo?.dagId ?? agent?.dagId ?? null;
      const nodeId = spawnInfo?.nodeId ?? agent?.nodeId ?? null;
      const roleId = spawnInfo?.role ?? agent?.role ?? null;

      // End trace span
      this._observe?.endSpan?.(agentId, { failed: !success });

      // Remove agent from session tracking
      this._sessionBridge?.removeAgent(sessionId, agentId);

      // Notify spawn client
      this._spawnClient?.notifyEnded?.(agentId, result || {});

      // ── DAG Node Status Update (Critical Feedback Loop) ──────────
      if (dagId && nodeId) {
        const dag = this._core?.orchestration?.dag;
        if (success) {
          dag?.completeNode?.(dagId, nodeId, {
            success: true,
            agentId,
            sessionId,
            output: result?.output || result?.content,
          });
        } else {
          dag?.failNode?.(dagId, nodeId, {
            reason: result?.error || 'agent_failed',
            agentId,
          });
        }
        this._publish('dag.node.status', { dagId, nodeId, status: success ? 'completed' : 'failed', agentId });
      } else if (dagId) {
        // dagId exists but nodeId missing — try to find the node by agentId
        const dagInfo = this._core?.orchestration?.dag?.getDAG?.(dagId) || this._core?.orchestration?.getDAG?.(dagId);
        if (dagInfo?.nodes) {
          const node = dagInfo.nodes.find(n => n.agentId === agentId || n.state === 'RUNNING');
          if (node) {
            const dag = this._core?.orchestration?.dag;
            if (success) {
              dag?.completeNode?.(dagId, node.id, { success: true, agentId, output: result?.output });
            } else {
              dag?.failNode?.(dagId, node.id, { reason: result?.error || 'agent_failed', agentId });
            }
            this._publish('dag.node.status', { dagId, nodeId: node.id, status: success ? 'completed' : 'failed', agentId });
          }
        }
      }

      // Quality: audit on success, classify failure otherwise
      if (success) {
        this._quality?.auditOutput?.({ agentId, result });
        this._publish('agent.lifecycle.completed', {
          agentId,
          sessionId,
          roleId,
          taskId: agent?.taskId ?? null,
          task: agent?.task ?? agent?.label ?? null,
          dagId,
          result,
        });
        this._emitSignal('trust', agentId, 0.7, { success: true });
        this._emitSignal('reputation', agentId, 0.6);
      } else {
        this._quality?.classifyFailure?.({
          agentId,
          sessionId,
          dagId,
          error: result?.error,
          toolName: result?.toolName ?? null,
          taskDescription: agent?.task || agent?.label || '',
          lastOutput: result?.output || result?.content || '',
        });
        this._publish('agent.lifecycle.failed', {
          agentId,
          sessionId,
          roleId,
          taskId: agent?.taskId ?? null,
          task: agent?.task ?? agent?.label ?? null,
          dagId,
          error: result?.error,
          result,
        });
        this._emitSignal('alarm', agentId, 0.8, { error: result?.error });
      }
      this._publish('agent.lifecycle.ended', { agentId, sessionId, success, dagId });
    });
  }

  // ─── LLM Hook ─────────────────────────────────────────────────────

  /**
   * llm_output: run compliance monitor against generated content.
   */
  onLlmOutput(session, output) {
    this._stats.hooksFired++;
    return safe(async () => {
      const sessionId = session?.id;
      const content = output?.content || '';
      const compliance = this._quality?.checkCompliance?.(sessionId, content, {}) ?? { compliant: true };

      if (!sessionId || !compliance?.shouldTerminate) {
        return compliance;
      }

      const agentIds = this._sessionBridge?.getAgents?.(sessionId) ?? [];
      const cancelledAgentIds = [];
      for (const agentId of agentIds) {
        const cancelled = await this._spawnClient?.cancel?.(agentId);
        if (cancelled) {
          cancelledAgentIds.push(agentId);
        }
      }

      const reason = `Session ${sessionId} terminated after repeated compliance violations`;
      this._terminatedSessions.set(sessionId, {
        reason,
        escalationLevel: compliance.escalationLevel ?? 3,
        violations: compliance.violations ?? [],
        cancelledAgentIds,
        ts: Date.now(),
      });
      this._userNotifier?.notifyBlocked?.(
        sessionId,
        reason,
        ['Revise request and retry', 'Start a new session'],
      );
      this._publish('quality.compliance.terminated', {
        sessionId,
        escalationLevel: compliance.escalationLevel ?? 3,
        violations: compliance.violations ?? [],
        cancelledAgentIds,
      });

      return {
        ...compliance,
        terminated: true,
        cancelledAgentIds,
      };
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
      const sessionId = session?.id;
      const terminated = sessionId ? this._terminatedSessions.get(sessionId) : null;
      if (terminated) {
        this._stats.blockedToolCalls++;
        return {
          blocked: true,
          reason: terminated.reason,
        };
      }

      const name = toolCall?.name;
      const params = toolCall?.params;

      // Circuit breaker check
      const canExec = this._quality?.canExecuteTool?.(name);
      if (canExec && !canExec.allowed) {
        this._stats.blockedToolCalls++;
        this._publish('quality.breaker.tripped', { toolName: name, reason: canExec.reason });
        this._emitSignal('alarm', name, 0.7, { breaker: true });
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
      this._emitSignal(success ? 'task' : 'alarm', name, success ? 0.3 : 0.1, { tool: name });
    });
  }

  // ─── Context Hook ─────────────────────────────────────────────────

  /**
   * before_prompt_build: inject field vector context as XML tags.
   * Returns { prependSystemContext: string } for the hook contract.
   * (Previously registered as 'prependSystemContext' which is not a valid hook name.)
   */
  onPrependSystemContext(session) {
    this._stats.hooksFired++;
    return safe(() => {
      const sessionId = session?.id;
      const scope = this._sessionBridge?.getScope(sessionId);

      // Superpose field vector for current scope
      const vector = this._core?.field?.superpose?.(scope);
      if (!vector) return {};

      return {
        prependSystemContext: `<swarm-context>${JSON.stringify(vector)}</swarm-context>`,
      };
    }, {});
  }

  // ─── Error Handling (via EventBus, not hook) ─────────────────────

  /**
   * Handle runtime errors — called internally via EventBus, not via hook
   * registration since there is no standard 'error' hook in OpenClaw.
   * Call this.onError(session, error) from your error event listener.
   */
  onError(session, error) {
    this._stats.hooksFired++;
    this._stats.hookErrors++;
    return safe(() => {
      const model = session?.model || 'balanced';
      const role = session?.role || 'default';
      this._publish('quality.anomaly.detected', { type: 'runtime_error', severity: 'high', error: error?.message });
      this._emitSignal('alarm', 'system', 0.9, { error: error?.message });
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
      this._emitSignal('knowledge', sessionId, 0.4, { from: agentId });
    });
  }

  // ─── Model Resolution Hook ──────────────────────────────────────

  /**
   * before_model_resolve: apply dual-process routing + budget-aware model selection.
   * Returns { model: string } to override the default model, or {} to keep default.
   */
  onBeforeModelResolve(session, params) {
    this._stats.hooksFired++;
    return safe(() => {
      const sessionId = session?.id;
      const scope = this._sessionBridge?.getScope(sessionId);

      // SpawnAdvisor gives model recommendation based on field vector
      const advice = this._core?.orchestration?.advisor?.advise?.(scope, params?.role || 'implementer', {
        dagId: params?.dagId,
      });
      if (advice?.model) {
        return { model: advice.model };
      }

      // Budget-aware fallback
      const budgetSuggestion = this._core?.orchestration?.adaptation?.budgetTracker?.suggestModel?.(params?.dagId);
      if (budgetSuggestion?.model) {
        return { model: budgetSuggestion.model };
      }

      return {};
    }, {});
  }

  // ─── LLM Input Hook ───────────────────────────────────────────────

  /**
   * llm_input: feed signal calibrator with observation data for MI-based weight tuning.
   */
  onLlmInput(session, input) {
    this._stats.hooksFired++;
    return safe(() => {
      const sessionId = session?.id;
      const scope = this._sessionBridge?.getScope(sessionId);

      // Feed signal calibrator: it computes mutual information between dimensions and outcomes
      this._core?.orchestration?.adaptation?.signalCalibrator?.observe?.({
        scope,
        input: input?.content || input?.messages?.[0]?.content || '',
        timestamp: Date.now(),
      });
    });
  }

  // ─── Subagent Lifecycle Hooks ─────────────────────────────────────

  /**
   * subagent_spawning: enhance spawn parameters with swarm context before subagent creation.
   */
  onSubagentSpawning(session, spawnParams) {
    this._stats.hooksFired++;
    return safe(() => {
      const sessionId = session?.id;
      const scope = this._sessionBridge?.getScope(sessionId);
      const role = spawnParams?.role || 'implementer';

      // Get spawn advice with full field vector scoring
      const advice = this._core?.orchestration?.advisor?.advise?.(scope, role, {
        dagId: spawnParams?.dagId,
      });
      if (!advice) return spawnParams;

      // Enhance spawn params with advisor recommendations
      return {
        ...spawnParams,
        model: advice.model || spawnParams?.model,
        role: advice.role || role,
        priority: advice.priority,
        companions: advice.companions,
        constraints: advice.constraints,
      };
    }, spawnParams);
  }

  /**
   * subagent_ended: handle subagent completion — DAG node update, credit assignment, replan.
   * This is the hook fallback path for ContextEngine.onSubagentEnded().
   */
  onSubagentEnded(session, result) {
    this._stats.hooksFired++;
    return safe(() => {
      const sessionId = session?.id;
      const childKey = result?.childSessionKey || result?.targetSessionKey || sessionId;
      const agentId = result?.agentId || childKey;
      const success = result?.reason === 'completed' || result?.success !== false;

      // V8.2 Label Resolution: resolve dagId/nodeId from label map first
      const labelInfo = this._spawnClient?.resolveLabel?.(childKey);
      const dagId = labelInfo?.dagId || result?.dagId || null;
      const nodeId = labelInfo?.nodeId || result?.nodeId || null;

      // Also check SpawnClient agent records as fallback
      const spawnInfo = agentId ? this._spawnClient?.getStatus?.(agentId) : null;
      const resolvedDagId = dagId || spawnInfo?.dagId || null;
      const resolvedNodeId = nodeId || spawnInfo?.nodeId || null;

      // Update DAG node state (V8.2 pattern: precise path → fallback scan)
      const dag = this._core?.orchestration?.dag;
      if (resolvedDagId && resolvedNodeId && dag) {
        if (success) {
          dag.completeNode?.(resolvedDagId, resolvedNodeId, {
            success: true, agentId, output: result?.output || result?.result,
          });
        } else {
          dag.failNode?.(resolvedDagId, resolvedNodeId, {
            reason: result?.error || 'subagent failed', agentId,
          });
        }
        // Cascade: spawn next ready nodes (V8.2 claimReadyNodes pattern)
        const readyNodes = dag.getReady?.(resolvedDagId) || dag.getReadyNodes?.(resolvedDagId) || [];
        if (readyNodes.length > 0) {
          this._publish('dag.nodes.ready', {
            dagId: resolvedDagId,
            nodes: readyNodes.map(n => ({ id: n.id, role: n.role, task: n.taskId || n.task })),
          });
        }
        // Check full DAG completion
        const status = dag.getDAGStatus?.(resolvedDagId);
        if (status && status.completed === status.total) {
          this._publish('dag.completed', { dagId: resolvedDagId });
          this._core?.orchestration?.synthesizer?.synthesize?.(resolvedDagId);
        }
      } else if (resolvedDagId && dag) {
        // Fallback: scan DAG nodes for matching running agent
        const dagInfo = dag.getDAG?.(resolvedDagId);
        if (dagInfo?.nodes) {
          const node = dagInfo.nodes.find(n =>
            n.agentId === agentId || n.state === 'RUNNING' || n.state === 'EXECUTING'
          );
          if (node) {
            if (success) {
              dag.completeNode?.(resolvedDagId, node.id, { success: true, agentId });
            } else {
              dag.failNode?.(resolvedDagId, node.id, { reason: result?.error || 'agent_failed' });
            }
          }
        }
      }

      // Shapley credit assignment
      if (success && agentId) {
        this._core?.orchestration?.adaptation?.shapleyCredit?.recordContribution?.({
          agentId,
          dagId,
          nodeId,
          success: true,
        });
      }

      // Species evolver feedback
      this._core?.orchestration?.adaptation?.speciesEvolver?.recordOutcome?.({
        roleId: result?.role,
        success,
        metrics: result?.metrics,
      });

      // Deposit pheromone based on outcome
      if (success) {
        this._core?.communication?.depositPheromone?.({
          type: 'food',
          scope: sessionId,
          intensity: 0.7,
          depositor: agentId || 'system',
          metadata: { dagId, nodeId, reason: 'subagent completed' },
        });
      } else {
        this._core?.communication?.depositPheromone?.({
          type: 'alarm',
          scope: sessionId,
          intensity: 0.8,
          depositor: agentId || 'system',
          metadata: { dagId, nodeId, error: result?.error },
        });
      }

      this._publish('subagent.ended', { sessionId, agentId, success, dagId, nodeId });
    });
  }

  // ─── Compaction Hooks ──────────────────────────────────────────

  /**
   * before_compaction: snapshot swarm state before context compaction.
   * Preserves critical field data that would be lost during compaction.
   */
  onBeforeCompaction(session) {
    this._stats.hooksFired++;
    return safe(() => {
      const sessionId = session?.id;
      const scope = this._sessionBridge?.getScope(sessionId);

      // Snapshot current field vector before compaction erases context
      const vector = this._core?.field?.superpose?.(scope);
      if (vector) {
        this._core?.store?.put?.('compaction-snapshots', sessionId, {
          vector,
          ts: Date.now(),
        });
      }

      this._publish('compaction.before', { sessionId });
      return { preserveSwarmContext: true };
    }, {});
  }

  /**
   * after_compaction: restore swarm state markers after compaction.
   */
  onAfterCompaction(session) {
    this._stats.hooksFired++;
    return safe(() => {
      const sessionId = session?.id;
      this._publish('compaction.after', { sessionId });
      // Emit a learning signal to indicate context was compacted
      this._emitSignal('learning', sessionId, 0.3, { event: 'compaction' });
    });
  }

  // ─── Inbound Message Hook ────────────────────────────────────

  /**
   * inbound_claim: intercept inbound messages for swarm routing.
   * Returns { claimed: true } to prevent default processing.
   */
  onInboundClaim(session, message) {
    this._stats.hooksFired++;
    return safe(() => {
      const content = message?.content || '';
      const sessionId = session?.id;

      // Check if message is a swarm coordination signal (internal protocol)
      if (content.startsWith('<swarm-signal>') || content.startsWith('{"swarm":')) {
        this._publish('inbound.swarm_signal', { sessionId, content });
        this._emitSignal('coordination', sessionId, 0.5, { type: 'inbound_signal' });
        return { claimed: true, handler: 'swarm-coordinator' };
      }

      return { claimed: false };
    }, { claimed: false });
  }

  // ─── Outbound Message Hooks ──────────────────────────────────

  /**
   * message_sending: enrich outbound messages with swarm metadata.
   */
  onMessageSending(session, message) {
    this._stats.hooksFired++;
    return safe(() => {
      const sessionId = session?.id;
      // Deposit trail pheromone on outbound messages
      this._core?.communication?.depositPheromone?.({
        type: 'trail',
        scope: sessionId,
        intensity: 0.3,
        depositor: 'hook-adapter',
        metadata: { event: 'message_sending' },
      });
      return message; // pass through
    }, message);
  }

  /**
   * message_sent: feed signal calibrator with sent message data.
   */
  onMessageSent(session, message) {
    this._stats.hooksFired++;
    return safe(() => {
      const sessionId = session?.id;
      this._emitSignal('knowledge', sessionId, 0.2, { event: 'message_sent' });
      this._publish('message.sent', { sessionId });
    });
  }

  // ─── Subagent Delivery Hook ──────────────────────────────────

  /**
   * subagent_delivery_target: control which subagent receives a task.
   * Uses spawn advisor and pheromone ranking to select optimal target.
   */
  onSubagentDeliveryTarget(session, params) {
    this._stats.hooksFired++;
    return safe(() => {
      const sessionId = session?.id;
      const scope = this._sessionBridge?.getScope(sessionId);

      // Use pheromone-based scope ranking to suggest best target
      const ranked = this._core?.communication?.rankScopes?.({
        strategy: 'resource_tilt',
        scope,
      });
      if (ranked && ranked.length > 0) {
        return { suggestedTarget: ranked[0].scope };
      }

      return {}; // no override
    }, {});
  }

  // ─── Message Write Hook ──────────────────────────────────────

  /**
   * before_message_write: annotate messages with swarm context tags.
   */
  onBeforeMessageWrite(session, message) {
    this._stats.hooksFired++;
    return safe(() => {
      // Add swarm role annotation if agent has a role
      const sessionId = session?.id;
      const agentId = message?.agentId || session?.agentId;
      if (agentId && message) {
        const roleInfo = this._sessionBridge?.getAgentRole?.(agentId);
        if (roleInfo) {
          message._swarmRole = roleInfo;
        }
      }
      return message;
    }, message);
  }

  // ─── Sessions Yield Hook ─────────────────────────────────────

  /**
   * sessions_yield: cooperative multitasking — allow swarm to yield control
   * between agents for collaborative workflows.
   */
  onSessionsYield(session, params) {
    this._stats.hooksFired++;
    return safe(() => {
      const sessionId = session?.id;
      const yieldTo = params?.targetSession || params?.yieldTo;

      if (yieldTo) {
        // Emit coordination signal for the yield
        this._emitSignal('coordination', sessionId, 0.7, {
          event: 'yield',
          target: yieldTo,
        });
        // Deposit dance pheromone to signal collaboration
        this._core?.communication?.depositPheromone?.({
          type: 'dance',
          scope: sessionId,
          intensity: 0.6,
          depositor: 'hook-adapter',
          metadata: { yieldTo, reason: params?.reason },
        });
      }

      this._publish('session.yield', { sessionId, yieldTo });
      return { allowed: true };
    }, { allowed: true });
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
