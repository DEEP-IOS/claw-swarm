/**
 * Claw-Swarm V9 — OpenClaw Plugin Entry Point
 *
 * Wires SwarmCoreV9 (domains + field + store) to the OpenClaw plugin API
 * through HookAdapter and tool registrations.
 *
 * Called unconditionally from index.js — V9 is the sole active engine.
 *
 * @module index-v9
 * @version 9.0.0
 * @author DEEP-IOS
 */

import { SwarmCoreV9 } from './swarm-core-v9.js';
import { HookAdapter } from './bridge/hooks/hook-adapter.js';
import { SessionBridge } from './bridge/session/session-bridge.js';
import { ModelFallback } from './bridge/session/model-fallback.js';
import { SpawnClient } from './bridge/session/spawn-client.js';
import { ReadinessGuard } from './bridge/reliability/readiness-guard.js';
import { IpcFallback } from './bridge/reliability/ipc-fallback.js';
import { InjectRetry } from './bridge/reliability/inject-retry.js';
import { ComplianceHook } from './bridge/reliability/compliance-hook.js';
import { ProgressTracker } from './bridge/interaction/progress-tracker.js';
import { TaskPresenter } from './bridge/interaction/task-presenter.js';
import { UserNotifier } from './bridge/interaction/user-notifier.js';
import { SubagentFailureMessage } from './bridge/interaction/subagent-failure-message.js';
import { NativeSpawnManager } from './bridge/agents/native-spawn-manager.js';
import { ChatBridge } from './observe/bridge/chat-bridge.js';
import { StagnationDetector } from './orchestration/adaptation/stagnation-detector.js';
import { SpawnCeiling } from './orchestration/adaptation/spawn-ceiling.js';

// ─── Safe tool import helper ────────────────────────────────────────────────

/**
 * Attempt to dynamically import a tool factory.
 * Returns null if the module does not exist yet.
 * @param {string} specifier
 * @returns {Promise<Function|null>}
 */
async function tryToolImport(specifier, exportName) {
  try {
    const mod = await import(specifier);
    return mod[exportName] || null;
  } catch (err) {
    if (err.code === 'ERR_MODULE_NOT_FOUND' || err.code === 'MODULE_NOT_FOUND') {
      return null;
    }
    throw err;
  }
}

// ─── Singleton ──────────────────────────────────────────────────────────────

let _instance = null;

function createBridgeFacade({
  core,
  sessionBridge,
  spawnClient,
  readinessGuard,
  modelFallback,
  hookAdapterRef,
  registeredTools,
  interaction,
}) {
  return {
    getRegisteredTools: () => [...registeredTools],
    getProgress: (dagId) => {
      const runtimeProgress = core?.orchestration?.getProgress?.(dagId) ?? null;
      const steps = interaction?.progressTracker?.getSteps?.(dagId) ?? [];
      const estimate = interaction?.progressTracker?.getEstimate?.(dagId) ?? null;
      const progressSummary = interaction?.taskPresenter?.formatProgress?.(steps, estimate)
        ?? (steps.length > 0 ? interaction?.progressTracker?.getSummary?.(dagId) : 'No progress yet.');

      return {
        dagId,
        found: Boolean(runtimeProgress || steps.length > 0),
        ...(runtimeProgress || {}),
        stepCount: steps.length,
        steps,
        estimate,
        progressSummary,
        sessionId: sessionBridge?.getSessionForDag?.(dagId) ?? null,
      };
    },
    modelFallback,
    getModelFallback: () => modelFallback,
    getStatus: () => ({
      ready: readinessGuard?.isReady?.() ?? core?.isReady?.() ?? false,
      hooks: hookAdapterRef.current?.getStats?.() ?? {},
      tools: registeredTools.map((tool) => tool.name),
      sessionBridge: sessionBridge?.getStats?.() ?? {},
      spawnClient: spawnClient?.getStats?.() ?? {},
      nativeSpawnManager: core?._nativeSpawnManager?.getStats?.() ?? {},
      modelFallback: modelFallback?.getStats?.() ?? {},
      interaction: {
        progress: interaction?.progressTracker?.getStats?.() ?? {},
        notifier: interaction?.userNotifier?.getStats?.() ?? {},
        failures: interaction?.subagentFailureMessage?.getStats?.() ?? {},
      },
    }),
    getQueue: () => [],
  };
}

// ─── activate / deactivate ──────────────────────────────────────────────────

/**
 * Plugin activate — called by OpenClaw when the plugin is loaded.
 *
 * 1. Create SwarmCoreV9 with dual foundation
 * 2. Create bridge modules (session, model fallback, spawn)
 * 3. Register all 16 hooks via HookAdapter
 * 4. Register all tools (existing + new)
 * 5. Start the core
 * 6. Mark ready
 *
 * @param {Object} app - OpenClaw app instance
 * @returns {Promise<Object>} instance reference
 */
export async function activate(app) {
  const config = app?.getConfig?.() ?? {};
  const bus = app?.getMessageBus?.();

  // ── Create core ─────────────────────────────────────────────────
  const core = new SwarmCoreV9(config, bus);

  // ── Create bridge modules ───────────────────────────────────────
  const sessionBridge = new SessionBridge({
    field: core.field,
    bus: core.bus,
    store: core.store,
  });
  const modelFallback = new ModelFallback(config.modelFallback || {});
  const spawnClient = new SpawnClient(config.spawnClient || {});
  const readinessGuard = new ReadinessGuard(config.readinessGuard || {});
  const ipcFallback = new IpcFallback(config.ipcFallback || {});
  const injectRetry = new InjectRetry({ ipcFallback, config: config.injectRetry || {} });
  const complianceHook = new ComplianceHook({ quality: null, config: config.compliance || {} });
  const interaction = {
    progressTracker: new ProgressTracker({ bus: core.bus, config: config.bridge?.progress || {} }),
    taskPresenter: new TaskPresenter(config.bridge?.presentation || {}),
    userNotifier: new UserNotifier({ bus: core.bus, config: config.bridge?.notifications || {} }),
    subagentFailureMessage: new SubagentFailureMessage(),
  };
  const registeredTools = [];
  const hookAdapterRef = { current: null };
  const bridgeFacade = createBridgeFacade({
    core,
    sessionBridge,
    spawnClient,
    readinessGuard,
    modelFallback,
    hookAdapterRef,
    registeredTools,
    interaction,
  });
  core.setBridge(bridgeFacade);

  // ── Register hooks ──────────────────────────────────────────────
  const hookAdapter = new HookAdapter({
    core,
    quality: core.quality,
    observe: core.observe,
    sessionBridge,
    modelFallback,
    spawnClient,
    interaction,
    config: config.hooks || {},
  });
  hookAdapterRef.current = hookAdapter;
  hookAdapter.registerHooks(app);

  // ── Import tool factories ───────────────────────────────────────
  // All tools restored — patcher removed OpenClaw tool deny lists
  // T0 getContextInjection auto-detects complex tasks; tools are explicit entry points
  const toolFactories = await Promise.all([
    tryToolImport('./bridge/tools/run-tool.js', 'createRunTool'),
    tryToolImport('./bridge/tools/query-tool.js', 'createQueryTool'),
    tryToolImport('./bridge/tools/dispatch-tool.js', 'createDispatchTool'),
    tryToolImport('./bridge/tools/checkpoint-tool.js', 'createCheckpointTool'),
    tryToolImport('./bridge/tools/gate-tool.js', 'createGateTool'),
    tryToolImport('./bridge/tools/memory-tool.js', 'createMemoryTool'),
    tryToolImport('./bridge/tools/pheromone-tool.js', 'createPheromoneTool'),
    tryToolImport('./bridge/tools/plan-tool.js', 'createPlanTool'),
    tryToolImport('./bridge/tools/zone-tool.js', 'createZoneTool'),
    tryToolImport('./bridge/tools/spawn-tool.js', 'createSpawnTool'),
    tryToolImport('./bridge/tools/cron-tool.js', 'createCronTool'),
  ]);

  // ── Create and register tools ───────────────────────────────────
  const deps = { core, quality: core.quality, sessionBridge, spawnClient };

  for (const factory of toolFactories) {
    if (typeof factory === 'function') {
      try {
        const tool = factory(deps);
        if (tool) {
          // Ensure both parameters and input_schema are present for cross-API compatibility
          if (tool.parameters && !tool.input_schema) {
            tool.input_schema = tool.parameters;
          } else if (tool.input_schema && !tool.parameters) {
            tool.parameters = tool.input_schema;
          }
          app?.registerTool?.(tool);
          registeredTools.push(tool);
        }
      } catch (e) {
        // Tool creation failure is non-fatal; log and continue
        console.error(`[Claw-Swarm] Tool creation failed:`, e?.message, e?.stack?.split?.('\n')?.slice(0, 3)?.join('\n'));
      }
    }
  }

  // ── Start the core ──────────────────────────────────────────────
  await core.start();

  // ── Wire failure classification → immunity learning ─────────────
  // Note: quality.start() already wires quality.failure.classified → failureVaccination.learn()
  // internally (quality/index.js line 214-226), so no additional wiring is needed here.

  // ══════════════════════════════════════════════════════════════════
  // ██  Domain Cross-Wiring  ██
  //
  // Connects EventBus events between domains that are otherwise
  // decoupled.  Each listener is defensive (optional-chained) so
  // missing subsystems never throw.
  // ══════════════════════════════════════════════════════════════════

  // ── 2. Agent Lifecycle → Emotional State ──────────────────────────
  core.bus?.on?.('agent.lifecycle.completed', (data) => {
    core.intelligence?.social?.emotion?.recordOutcome?.(data.agentId, true);
  });
  core.bus?.on?.('agent.lifecycle.failed', (data) => {
    core.intelligence?.social?.emotion?.recordOutcome?.(data.agentId, false);
  });

  // ── 3. Agent Lifecycle → Reputation ───────────────────────────────
  core.bus?.on?.('agent.lifecycle.completed', (data) => {
    core.intelligence?.social?.reputation?.increment?.(data.agentId || data.roleId);
  });
  core.bus?.on?.('agent.lifecycle.failed', (data) => {
    core.intelligence?.social?.reputation?.decrement?.(data.agentId || data.roleId);
  });

  // ── 4. Agent Lifecycle → SNA (Social Network) ────────────────────
  // SNAAnalyzer.recordCollaboration(agentA, agentB, outcome) — record collaboration
  // between this agent and the orchestrator (parent) for the DAG
  core.bus?.on?.('agent.lifecycle.completed', (data) => {
    const dagId = data.dagId || data.result?.dagId;
    if (dagId && data.agentId) {
      const parentId = data.parentId || `orchestrator-${dagId}`;
      core.intelligence?.social?.sna?.recordCollaboration?.(data.agentId, parentId, true);
    }
  });

  // ── 5. Agent Lifecycle → Trust ────────────────────────────────────
  // TrustDynamics.update(agentId, quality, success) — use quality=1.0 for success, 0.0 for failure
  core.bus?.on?.('agent.lifecycle.completed', (data) => {
    core.intelligence?.social?.trust?.update?.(data.agentId, 1.0, true);
  });
  core.bus?.on?.('agent.lifecycle.failed', (data) => {
    core.intelligence?.social?.trust?.update?.(data.agentId, 0.0, false);
  });

  // ── 6. DAG Completion → Shapley Credit ─────────────────────────
  // ShapleyCredit.compute(dagId, agentContributions) is called per-DAG, not per-node.
  // ShapleyCredit's own start() already subscribes to dag.completed for this purpose.
  // Here we provide a supplementary path that builds the contributions map from DAG info.
  core.bus?.on?.('dag.completed', (data) => {
    if (!data.dagId) return;
    const dagInfo = core.orchestration?.getDAG?.(data.dagId);
    if (!dagInfo?.nodes) return;
    const contributions = new Map();
    for (const node of dagInfo.nodes) {
      if (node.state === 'COMPLETED' && node.agentId) {
        contributions.set(node.agentId, {
          quality: 1.0,
          role: node.role || node.id,
        });
      }
    }
    if (contributions.size > 0) {
      core.orchestration?.adaptation?.shapleyCredit?.compute?.(data.dagId, contributions);
    }
  });

  // ── 7. DAG Completion → Species Evolution ────────────────────────
  // SpeciesEvolver has evolve() for triggering evolution and evaluateFitness(speciesId)
  // for individual fitness. On DAG completion, trigger a global evolution step.
  // SpeciesEvolver's own start() already subscribes to dag.completed, so this is
  // supplementary — it ensures evolution runs even if the internal handler missed it.
  core.bus?.on?.('dag.completed', () => {
    try {
      core.orchestration?.adaptation?.speciesEvolver?.evolve?.();
    } catch { /* non-fatal */ }
  });

  // ── 7b. Node Completion → Species taskCount + Budget spend ─────
  // SpeciesEvolver.recordOutcome() increments taskCount for the best species
  // of the completing node's role. Without this wiring, taskCount stays 0.
  // BudgetTracker also needs token spend recorded per node; when the result
  // lacks explicit token counts we estimate from role + model heuristics.
  core.bus?.on?.('dag.phase.completed', (data) => {
    // Species taskCount
    if (data?.role) {
      core.orchestration?.adaptation?.speciesEvolver?.recordOutcome?.({
        roleId: data.role,
        success: true,
      });
    }
    // Budget spend fallback: when _extractActualTokens returns null, record
    // an estimated spend so budgetTracker.spent is never stuck at 0.
    if (data?.dagId && data?.nodeId) {
      const bt = core.orchestration?.adaptation?.budgetTracker;
      if (bt && bt._budgets?.has?.(data.dagId)) {
        const record = bt._budgets.get(data.dagId);
        const alreadyHasSpend = record.spent > 0;
        const extractedTokens = bt._extractActualTokens?.(data.result);
        if (extractedTokens == null && !alreadyHasSpend) {
          // Estimate: role-based cost heuristic (same logic as estimateCost)
          const MODEL_COSTS = { fast: 500, balanced: 2000, strong: 5000, reasoning: 10000 };
          const ROLE_FACTORS = { researcher: 0.8, analyst: 1.0, planner: 0.7, implementer: 1.5, debugger: 1.3, tester: 1.0, reviewer: 0.6, consultant: 1.0, coordinator: 0.5, librarian: 0.6 };
          const model = data.result?.model || 'balanced';
          const baseCost = MODEL_COSTS[model] || MODEL_COSTS.balanced;
          const roleFactor = ROLE_FACTORS[data.role] || 1.0;
          bt.recordSpend(data.dagId, data.nodeId, Math.round(baseCost * roleFactor));
        }
      }
    }
  });

  // ── 7c. Node Failure → Species recordOutcome(failure) ──────────
  core.bus?.on?.('dag.phase.failed', (data) => {
    if (data?.role) {
      core.orchestration?.adaptation?.speciesEvolver?.recordOutcome?.({
        roleId: data.role,
        success: false,
      });
    }
  });

  // ── 8. Quality Anomaly → Alarm Signal ────────────────────────────
  core.bus?.on?.('quality.anomaly.detected', (data) => {
    core.field?.emit?.({
      dimension: 'alarm', scope: data.agentId || 'global',
      strength: 0.7, emitterId: 'quality-wiring',
      metadata: { anomaly: data.metric, zscore: data.zscore },
    });
  });

  // ── 9. Quality Breaker Trip → Pheromone Alarm ────────────────────
  core.bus?.on?.('quality.breaker.tripped', (data) => {
    core.communication?.depositPheromone?.({
      type: 'alarm', scope: data.component || 'global',
      intensity: 0.9, emitterId: 'quality-wiring',
      metadata: { breaker: data.breakerName, reason: data.reason },
    });
  });

  // ── 9b. DAG Created → Communication Channel ─────────────────────
  // Create a dedicated communication channel for each DAG so agents
  // within the same DAG can exchange messages.  Without this, 0 channels
  // exist at runtime despite the communication facade being fully wired.
  core.bus?.on?.('dag.created', (data) => {
    if (!data?.dagId) return;
    try {
      const members = (data.nodes || [])
        .map(n => n.agentId || n.id)
        .filter(Boolean)
        .map(id => ({ agentId: id, role: 'member' }));
      core.communication?.createChannel?.(data.dagId, { members });
    } catch { /* non-fatal: channel may already exist */ }
  });

  // ── 10. Stagnation → Exploration Mode ────────────────────────────
  // GlobalModulator has recordOutcome(success, taskType) which updates EMA and
  // calls updateMode() to potentially switch to EXPLORE. Recording failures
  // drives the success rate below 0.4, triggering EXPLORE mode.
  core.bus?.on?.('stagnation.detected', (data) => {
    core.orchestration?.adaptation?.globalModulator?.recordOutcome?.(false, 'stagnation');
    core.field?.emit?.({
      dimension: 'learning', scope: 'global',
      strength: 0.8, emitterId: 'stagnation-wiring',
    });
  });

  // ── 11. Budget Warning → Signal ──────────────────────────────────
  core.bus?.on?.('budget.warning', (data) => {
    core.field?.emit?.({
      dimension: 'coordination', scope: data.dagId || 'global',
      strength: 0.6, emitterId: 'budget-wiring',
      metadata: { usage: data.usagePercent },
    });
  });

  // ── 12. Spawn Native Started → Capability Tracking + Metrics ────
  // CapabilityEngine.updateSkill(agentId, domain, observedScore) — initialize the agent's
  // skill profile for its role when spawned (observedScore=0.5 as starting baseline).
  // Also emit agent.spawned as a safety net: LifecycleManager.spawn() may fail
  // silently (caught on line 170 of NativeSpawnManager), leaving MetricsCollector
  // with agents.spawned=0. This ensures the event always fires.
  core.bus?.on?.('spawn.native.started', (data) => {
    if (data.role && data.agentId) {
      core.intelligence?.capabilityEngine?.updateSkill?.(data.agentId, data.role, 0.5);
    }
    // Safety net: ensure agent.spawned fires for MetricsCollector
    core.bus?.publish?.('agent.spawned', {
      agentId: data.agentId || data.runId,
      roleId: data.role,
      dagId: data.dagId,
      nodeId: data.nodeId,
    }, 'spawn-metrics-wiring');
  });

  // ── 13. Agent Completion → ABC Classification ──────────────────────
  core.bus?.on?.('agent.lifecycle.completed', (data) => {
    if (!data?.agentId) return;
    const agentId = data.agentId;
    const metrics = {
      successRate: data.successRate ?? 1.0,
      explorationCount: data.explorationCount ?? 0,
      totalTasks: data.totalTasks ?? 1,
    };
    const role = core.intelligence?.abcClassifier?.classify?.(agentId, metrics);
    if (role) {
      core.bus?.publish?.('intelligence.abc.classified', {
        agentId,
        abcRole: role,
        metrics,
      }, 'abc-wiring');
    }
  });

  // ── 14. Model Call Failure → ModelFallback Suggestion ──────────────
  core.bus?.on?.('runtime.agent.event', (event) => {
    if (event?.type !== 'error' && event?.status !== 'error') return;
    const currentModel = event?.model || event?.modelTier || 'balanced';
    const roleId = event?.roleId || event?.role || 'default';
    const suggestion = modelFallback.handleError(
      { status: event?.statusCode || event?.code, code: event?.errorCode },
      currentModel,
      roleId,
    );
    if (suggestion?.retry && suggestion?.newModel) {
      core.bus?.publish?.('model.fallback.suggested', {
        originalModel: currentModel,
        suggestedModel: suggestion.newModel,
        delay: suggestion.delay,
        attempt: suggestion.attempt,
        roleId,
        agentId: event?.agentId,
      }, 'model-fallback-wiring');
    }
  });

  // ── 15. Episodic Memory → Best Practice Recording ────────────────
  core.bus?.on?.('dag.completed', (data) => {
    const dagInfo = core.orchestration?.getDAG?.(data.dagId);
    if (dagInfo) {
      const nodeCount = dagInfo.nodes?.length || 0;
      const completedCount = dagInfo.nodes?.filter(n => n.state === 'COMPLETED').length || 0;
      const successRate = nodeCount > 0 ? completedCount / nodeCount : 0;
      core.intelligence?.episodicMemory?.record?.({
        id: `ep-dag-${data.dagId}-${Date.now()}`,
        taskId: data.dagId,
        role: 'orchestrator',
        goal: `DAG ${data.dagId} completion`,
        actions: [`Completed ${completedCount}/${nodeCount} nodes`],
        outcome: successRate >= 0.8 ? 'success' : successRate >= 0.5 ? 'partial' : 'failure',
        quality: successRate,
        sessionId: data.sessionId || data.dagId,
        tags: ['dag_completion'],
        lessons: [],
      });
    }
  });

  // ══════════════════════════════════════════════════════════════════

  // ── 14. Agent-to-Agent Visible Communication (Behavior Guide Ch1/Ch8) ──
  // When a sub-agent completes a DAG node, publish its output as visible
  // inter-agent communication: "[role → 编排者] content"
  core.bus?.on?.('spawn.native.completed', (data) => {
    if (data.role && data.output) {
      const roleEmoji = {
        analyst: '\u{1F50D}', planner: '\u{1F4CB}', implementer: '\u{2699}\uFE0F',
        debugger: '\u{1F527}', tester: '\u{1F9EA}', reviewer: '\u{1F440}',
        researcher: '\u{1F4DA}', coordinator: '\u{1F4E1}', consultant: '\u{1F4AC}',
      };
      const emoji = roleEmoji[data.role] || '\u{1F41D}';
      core.bus?.publish?.('channel.message', {
        from: `${emoji} ${data.role}`,
        to: '\u7F16\u6392\u8005',
        content: (data.output || '').slice(0, 500),
        dagId: data.dagId,
        nodeId: data.nodeId,
      }, 'agent-communication');
    }
  });

  // ── 15. Progress Percentage Push (Behavior Guide Ch8) ──────────────
  // When DAG nodes change state, calculate and publish progress percentage
  core.bus?.on?.('dag.node.status', (data) => {
    if (!data.dagId) return;
    try {
      const status = core.orchestration?.dag?.getDAGStatus?.(data.dagId);
      if (status) {
        const percentage = Math.round((status.completed / status.total) * 100);
        core.bus?.publish?.('user.notification', {
          type: 'progress',
          dagId: data.dagId,
          percentage,
          message: `\u8702\u7FA4\u8FDB\u5EA6: ${status.completed}/${status.total} (${percentage}%)`,
          completed: status.completed,
          total: status.total,
        }, 'progress-tracker');
      }
    } catch { /* non-fatal */ }
  });

  // ── 16. Budget/Token Tracking (Behavior Guide /swarm budget) ───────
  // When sub-agents complete, estimate and record their token usage
  // into BudgetTracker so /swarm budget shows real data
  core.bus?.on?.('spawn.native.completed', (data) => {
    if (data.dagId && data.nodeId && data.messages?.length > 0) {
      const totalChars = data.messages.reduce((sum, m) => sum + (m?.content?.length || 0), 0);
      const estimatedTokens = Math.ceil(totalChars / 3.5);
      core.orchestration?.adaptation?.budgetTracker?.recordSpend?.(
        data.dagId, data.nodeId, estimatedTokens
      );
    }
  });

  // ── 17. spawn.native.completed -> Social Modules (safety net) ────────
  // When plugin hooks never fire (hooks: 0), NativeSpawnManager is the sole
  // completion path. The primary path is _monitorAndCascade calling
  // LifecycleManager.markCompleted/markFailed which publishes
  // agent.lifecycle.completed/failed events caught by cross-wiring above.
  // This listener is a SAFETY NET: if the lifecycle event did not reach
  // social modules (e.g. agent was not registered), we call them directly.
  core.bus?.on?.('spawn.native.completed', (data) => {
    const agentId = data.agentId || data.runId;
    if (!agentId) return;
    const success = data.status === 'ok';

    // Only act if the module has no data for this agent yet (avoid double-count)
    const existingEmotion = core.intelligence?.social?.emotion?.getEmotion?.(agentId);
    if (!existingEmotion || existingEmotion.historyLength === 0) {
      core.intelligence?.social?.emotion?.recordOutcome?.(agentId, success);
    }

    const existingRep = core.intelligence?.social?.reputation?.getScore?.(agentId);
    if (!existingRep || existingRep.total === 0) {
      if (success) {
        core.intelligence?.social?.reputation?.increment?.(agentId);
      } else {
        core.intelligence?.social?.reputation?.decrement?.(agentId);
      }
    }

    const existingTrust = core.intelligence?.social?.trust?.getTrust?.(agentId);
    if (!existingTrust || existingTrust.interactions === 0) {
      core.intelligence?.social?.trust?.update?.(agentId, success ? 1.0 : 0.0, success);
    }

    // SNA: record collaboration between agent and orchestrator
    if (data.dagId) {
      const parentId = `orchestrator-${data.dagId}`;
      core.intelligence?.social?.sna?.recordCollaboration?.(agentId, parentId, success);
    }
  });

  // ── T0: Register swarm core on globalThis for direct OpenClaw integration ──
  // OpenClaw's run loop calls globalThis[Symbol.for('claw-swarm.core')].getContextInjection()
  // before every model turn. This is the PRIMARY orchestration hook.
  const SWARM_KEY = Symbol.for('claw-swarm.core');
  const swarmGlobal = {
    // Dedup state: prevents concurrent DAG creation for the same session
    _hasActiveDag: false,
    _lastDagId: null,
    _activeSessions: new Set(),

    /**
     * Called before every model turn by OpenClaw's run loop.
     * Two responsibilities:
     *   1. Inject completed DAG results so the model can present them
     *   2. Classify intent and create a DAG for complex (System-2) tasks
     */
    getContextInjection: async ({ sessionId, userMessage, turnNumber }) => {
      // ── Phase 1: Inject completed DAG results ──
      if (swarmGlobal._lastDagId && !swarmGlobal._hasActiveDag) {
        const results = swarmGlobal.getDAGResults(swarmGlobal._lastDagId);
        if (results.length > 0) {
          const dagId = swarmGlobal._lastDagId;
          swarmGlobal._lastDagId = null; // Only inject once
          const resultText = results.map(r => `### ${r.role}\n${r.output}`).join('\n\n---\n\n');
          return `以下是蜂群多Agent系统协作完成的分析结果。请基于这些结果为用户整合一份完整报告：\n\n${resultText}`;
        }
      }

      // ── Phase 2: Intent classification → DAG creation for complex tasks ──
      if (!userMessage || swarmGlobal._hasActiveDag) return null;
      if (swarmGlobal._activeSessions.has(sessionId)) return null;

      swarmGlobal._activeSessions.add(sessionId);
      swarmGlobal._hasActiveDag = true;

      try {
        // Extract clean text from userMessage (may contain metadata prefix from OpenClaw)
        let cleanMessage = userMessage;
        if (typeof cleanMessage === 'string') {
          // Strip "Sender (untrusted metadata):\n```json\n{...}\n```\n\n" prefix if present
          const metaEnd = cleanMessage.indexOf('```\n\n');
          if (metaEnd !== -1 && cleanMessage.startsWith('Sender')) {
            cleanMessage = cleanMessage.slice(metaEnd + 5).trim();
          }
        }

        const intent = core.intelligence?.classifyIntent?.(cleanMessage);
        if (!intent) { swarmGlobal._hasActiveDag = false; return null; }
        // Attach original user message as description so DAG nodes get real task content
        intent.description = intent.description || cleanMessage;

        // Emit task signal so the field is populated from the first interaction
        core.field?.emit?.({
          dimension: 'task', scope: sessionId, strength: 0.6,
          emitterId: 't0-context-injection',
          metadata: { intent: intent.primary, confidence: intent.confidence, turn: turnNumber },
        });

        const scope = core.intelligence?.estimateScope?.(userMessage) ?? null;
        const route = core.orchestration?.routeTask?.(intent, scope || {});

        // Emit coordination signal when routing to System 2 (multi-agent)
        if (route) {
          core.field?.emit?.({
            dimension: 'coordination', scope: sessionId,
            strength: route.system === 2 ? 0.8 : 0.3,
            emitterId: 't0-context-injection',
            metadata: { system: route.system, complexity: route.complexity },
          });
        }

        if (route?.system === 2) {
          const plan = core.orchestration?.createPlan?.(intent, {
            ...(scope || {}),
            routeDecision: route,
            sessionId,
          });
          if (plan?.dagId) {
            swarmGlobal._lastDagId = plan.dagId;
            // Publish ready nodes — NativeSpawnManager listens on dag.nodes.ready
            const dagEngine = core.orchestration?.dag;
            const readyNodes = dagEngine?.getReady?.(plan.dagId) || [];
            if (readyNodes.length > 0) {
              core.bus?.publish?.('dag.nodes.ready', { dagId: plan.dagId, nodes: readyNodes }, 't0-core');
            }
            // Return null — model responds normally while DAG runs in background
            return null;
          }
        }

        swarmGlobal._hasActiveDag = false;
      } catch {
        swarmGlobal._hasActiveDag = false;
      }
      return null;
    },

    /** Collect completed node outputs from a DAG for result injection. */
    getDAGResults: (dagId) => {
      try {
        const dagInfo = core.orchestration?.getDAG?.(dagId);
        return (dagInfo?.nodes || [])
          .filter(n => n.state === 'COMPLETED' && n.result)
          .map(n => ({
            role: n.role || n.id,
            output: typeof n.result === 'string' ? n.result : n.result?.output || '',
          }));
      } catch { return []; }
    },
  };
  globalThis[SWARM_KEY] = swarmGlobal;

  // ── Update bridge refs that depend on initialized domains ───────
  // quality and observe are null at HookAdapter construction time
  // because core.initialize() runs inside core.start(). Patch them now.
  hookAdapter._quality = core.quality;
  hookAdapter._observe = core.observe;
  complianceHook._quality = core.quality; // Wire compliance to initialized quality domain

  // ── HostAdapter: THE abstraction layer between Swarm (OS) and OpenClaw (Hardware) ──
  // ALL OpenClaw-specific APIs go through HostAdapter. Direct runtime.* calls are
  // ONLY acceptable as last-resort fallbacks when HostAdapter is unavailable.
  const runtime = app?.runtime;
  let hostAdapter = null;
  try {
    const { createOpenClawAdapter } = await import('./bridge/integrations/host-adapter.js');
    hostAdapter = createOpenClawAdapter(runtime);
  } catch { /* host-adapter not available, fall back to direct runtime */ }

  // Expose hostAdapter on globalThis so T0 injection (pi-embedded.js) can push
  // results directly without going through Plugin API
  swarmGlobal.hostAdapter = hostAdapter;
  swarmGlobal.pushToUser = (text, options) => hostAdapter?.pushToUser?.(text, options) || false;
  swarmGlobal.sendSystemEvent = (text, options) => hostAdapter?.sendSystemEvent?.(text, options) || false;

  // ── Runtime Events → EventBus (through HostAdapter, not direct runtime calls) ──
  const runtimeUnsubs = [];
  if (hostAdapter) {
    // T0 path: HostAdapter abstracts the runtime event subscription
    runtimeUnsubs.push(
      hostAdapter.onRuntimeEvent('agentEvent', (event) => {
        core.bus?.publish?.('runtime.agent.event', event, 'host-adapter');
      })
    );
    runtimeUnsubs.push(
      hostAdapter.onRuntimeEvent('sessionTranscript', (update) => {
        core.bus?.publish?.('runtime.session.transcript', update, 'host-adapter');
      })
    );
  } else if (runtime?.events) {
    // Fallback: direct runtime event subscription (legacy path)
    if (typeof runtime.events.onAgentEvent === 'function') {
      runtimeUnsubs.push(
        runtime.events.onAgentEvent((event) => {
          core.bus?.publish?.('runtime.agent.event', event, 'god-runtime');
        })
      );
    }
    if (typeof runtime.events.onSessionTranscriptUpdate === 'function') {
      runtimeUnsubs.push(
        runtime.events.onSessionTranscriptUpdate((update) => {
          core.bus?.publish?.('runtime.session.transcript', update, 'god-runtime');
        })
      );
    }
  }

  let nativeSpawnManager = null;
  if (hostAdapter?.canSpawnAgents?.() || runtime?.subagent?.run) {
    nativeSpawnManager = new NativeSpawnManager({
      runtime,
      hostAdapter,
      core,
      config: config.nativeSpawn || {},
    });

    // DAG 事件循环: 当节点就绪时自动 spawn (sole spawn path)
    core.bus?.on?.('dag.nodes.ready', async (payload) => {
      if (!nativeSpawnManager?.isAvailable?.()) return;
      const dagId = payload?.dagId;
      if (!dagId) return;
      try {
        await nativeSpawnManager.spawnReadyNodes(dagId);
      } catch (_) { /* non-fatal */ }
    });

    // DAG 完成后: 综合结果 + 推送到用户聊天
    core.bus?.on?.('dag.completed', async (payload) => {
      const dagId = payload?.dagId;
      if (!dagId) return;
      // Reset global dedup flag so new tasks can create DAGs
      try { swarmGlobal._hasActiveDag = false; } catch {}
      // 触发结果综合
      try {
        await core.orchestration?.synthesizer?.synthesize?.(dagId);
      } catch (_) { /* non-fatal */ }

      // 直接推送到用户聊天 — T0 path through HostAdapter, Plugin API fallback
      if (hostAdapter?.pushToUser || runtime?.system?.enqueueSystemEvent) {
        try {
          const dagInfo = core.orchestration?.getDAG?.(dagId);
          const outputs = dagInfo?.nodes
            ?.filter(n => n.state === 'COMPLETED' && n.result)
            ?.map(n => {
              const out = typeof n.result === 'string' ? n.result
                : n.result?.output || JSON.stringify(n.result).slice(0, 500);
              return `### ${n.role || n.id}\n${out}`;
            }) || [];
          const report = `## ✅ 蜂群任务完成 (DAG: ${dagId.slice(-8)})\n\n${outputs.join('\n\n---\n\n')}`;
          if (hostAdapter?.pushToUser) hostAdapter.pushToUser(report, { dagId });
          else await runtime.system.enqueueSystemEvent(report, { dagId });
        } catch (_) { /* non-fatal */ }
      }
    });

    // synthesis.completed → 推送到聊天 (T0 HostAdapter preferred, runtime fallback)
    core.bus?.on?.('synthesis.completed', async (payload) => {
      if (!hostAdapter?.pushToUser && !runtime?.system?.enqueueSystemEvent) return;
      const summary = payload?.summary;
      const mergedTexts = payload?.mergedResult?.texts || [];
      if (summary || mergedTexts.length > 0) {
        try {
          const content = mergedTexts.map(t => typeof t === 'string' ? t : t?.content || '').join('\n\n');
          const reportText = `📋 综合报告: ${summary || '完成'}\n\n${content.slice(0, 3000)}`;
          if (hostAdapter?.pushToUser) hostAdapter.pushToUser(reportText, { dagId: payload?.dagId });
          else await runtime?.system?.enqueueSystemEvent?.(reportText, { dagId: payload?.dagId });
        } catch (_) { /* non-fatal */ }
      }
    });
  }

  // ── NativeSpawnManager fallback: warn when runtime.subagent is unavailable ──
  if (!nativeSpawnManager) {
    core.bus?.on?.('dag.nodes.ready', async (payload) => {
      const dagId = payload?.dagId;
      if (!dagId) return;
      core.bus?.publish?.('spawn.fallback.warning', {
        dagId,
        message: 'runtime.subagent not available, DAG will not auto-spawn',
      }, 'v9-fallback');
    });
  }

  // ── ChatBridge: EventBus → 用户聊天窗口 ─────────────────────
  // ChatBridge uses dual delivery: T0 HostAdapter.pushToUser() preferred,
  // Plugin API interactiveHandler as fallback
  const chatBridge = new ChatBridge({
    bus: core.bus,
    hostAdapter,
    config: config.chatBridge || {},
  });

  // 绑定 interactiveHandler BEFORE start — otherwise the handler is never set
  try {
    app.registerInteractiveHandler?.((message) => {
      // 用户从聊天窗口发来的消息 → 注入蜂群
      if (message?.text) {
        chatBridge.interject(message.dagId || 'global', message.text);
      }
    });
  } catch { /* registerInteractiveHandler may not be available */ }

  chatBridge.start();

  // 监听 verbosity 变更
  core.bus?.on?.('swarm.verbosity', (data) => {
    if (data?.level) chatBridge.setVerbosity(data.level);
  });

  // ── ChatBridge interject → NativeSpawnManager.sendSystemEvent ──
  core.bus?.on?.('user.interjection', (payload) => {
    if (!nativeSpawnManager || !payload?.dagId) return;
    const activeRuns = nativeSpawnManager.getActiveRuns();
    for (const run of activeRuns) {
      if (run.dagId === payload.dagId && run.sessionKey) {
        nativeSpawnManager.sendSystemEvent(run.sessionKey, payload.message || 'User interjection');
      }
    }
  });

  // ── StagnationDetector: 停滞检测 ──────────────────────────
  const stagnationDetector = new StagnationDetector({
    bus: core.bus,
    config: config.stagnation || {},
  });
  stagnationDetector.start();

  // 定期检查所有 agent 的停滞状态
  const stagnationInterval = setInterval(() => stagnationDetector.checkAll(), 15000);
  stagnationInterval.unref?.();

  // ── SpawnCeiling: fork bomb 防护 ──────────────────────────
  const spawnCeiling = new SpawnCeiling({
    bus: core.bus,
    config: config.spawnCeiling || {},
  });
  spawnCeiling.start();

  readinessGuard.setReady(true, 'V9 core started');

  // ── Store singleton ─────────────────────────────────────────────
  _instance = {
    core,
    hookAdapter,
    hostAdapter,
    sessionBridge,
    spawnClient,
    nativeSpawnManager,
    readinessGuard,
    modelFallback,
    bridgeFacade,
    interaction,
    chatBridge,
    stagnationDetector,
    spawnCeiling,
    injectRetry,
    ipcFallback,
    complianceHook,
    registeredTools: registeredTools.map((tool) => tool.name),
    runtime,
    _runtimeUnsubs: runtimeUnsubs,
    _stagnationInterval: stagnationInterval,
  };

  return _instance;
}

/**
 * Plugin deactivate — called by OpenClaw when the plugin is unloaded.
 * Stops the core and clears the singleton.
 *
 * @param {Object} app - OpenClaw app instance (unused)
 */
export async function deactivate(app) {
  if (!_instance) return;

  _instance.readinessGuard.setReady(false, 'V9 core stopping');

  // 清理新模块
  try { _instance.chatBridge?.stop(); } catch { /* ignore */ }
  try { _instance.stagnationDetector?.stop(); } catch { /* ignore */ }
  try { _instance.spawnCeiling?.stop(); } catch { /* ignore */ }
  if (_instance._stagnationInterval) clearInterval(_instance._stagnationInterval);

  // 清理 God Runtime 事件监听
  for (const unsub of (_instance._runtimeUnsubs || [])) {
    try { unsub?.(); } catch (_) { /* ignore */ }
  }

  try {
    await _instance.core.stop();
  } catch (_) {
    // Stop errors are non-fatal during deactivate
  }

  _instance = null;
}

/**
 * Get the current singleton instance (for testing/inspection).
 * @returns {Object|null}
 */
export function getInstance() {
  return _instance;
}
