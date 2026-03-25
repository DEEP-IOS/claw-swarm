/**
 * SwarmContextEngine — OpenClaw ContextEngine implementation for Claw-Swarm.
 *
 * Replaces before_prompt_build hook as the PRIMARY integration mechanism.
 * Provides full lifecycle control over LLM context:
 *   - ingest: record messages, emit signals to field
 *   - assemble: build swarm-aware context with sensitivity-filtered field,
 *               pheromones, task channels, DAG status, modulation state
 *   - compact: delegate to runtime with swarm state preservation
 *   - afterTurn: feed results back (calibration, reputation, evolution)
 *   - prepareSubagentSpawn: set up child agent context from DAG
 *   - onSubagentEnded: mark DAG node complete, trigger next nodes
 *
 * @module bridge/context/swarm-context-engine
 * @version 9.2.0
 */

const ENGINE_ID = 'claw-swarm';
const ENGINE_NAME = 'Claw-Swarm Signal Field Engine';
const ENGINE_VERSION = '9.2.0';

/**
 * Factory that creates a SwarmContextEngine bound to a SwarmCoreV9 instance.
 *
 * @param {Object} core - SwarmCoreV9 instance
 * @param {Object} [options={}]
 * @returns {Object} ContextEngine interface
 */
export function createSwarmContextEngine(core, options = {}) {
  // Session state tracking
  const _sessionState = new Map();
  // DAG ↔ session mapping for subagent lifecycle
  const _dagSessionMap = new Map();

  /**
   * Get or create session state.
   */
  function getSession(sessionId) {
    if (!_sessionState.has(sessionId)) {
      _sessionState.set(sessionId, {
        messageCount: 0,
        lastIntent: null,
        lastRoute: null,
        dagId: null,
        role: null,
        agentId: null,
        turnCount: 0,
      });
    }
    return _sessionState.get(sessionId);
  }

  /**
   * Build the swarm-aware system prompt addition.
   * This is the KEY method that fixes all 10 broken circuits.
   */
  function buildSwarmContext(sessionId, state) {
    const sections = [];

    // ── 1. Sensitivity-Filtered Field Vector ──────────────────────
    const roleId = state.role || 'implementer';
    // Read both session-scoped AND global-scoped field vectors, merge via max
    const sessionVector = core?.field?.superpose?.(sessionId) ?? {};
    const globalVector = core?.field?.superpose?.('global') ?? {};
    // Also read DAG-scoped field if we're in a DAG
    const dagVector = state.dagId ? (core?.field?.superpose?.(state.dagId) ?? {}) : {};
    // Merge: take the max value across scopes for each dimension
    const rawVector = {};
    const allDims = new Set([
      ...Object.keys(sessionVector),
      ...Object.keys(globalVector),
      ...Object.keys(dagVector),
    ]);
    for (const dim of allDims) {
      rawVector[dim] = Math.max(
        sessionVector[dim] || 0,
        globalVector[dim] || 0,
        dagVector[dim] || 0,
      );
    }

    const sensitivity = core?.intelligence?.roleRegistry?.getSensitivity?.(roleId);

    let fieldContext;
    if (sensitivity && Object.keys(sensitivity).length > 0) {
      // Apply sensitivity filter: multiply raw values by role coefficients
      const filtered = {};
      for (const [dim, rawVal] of Object.entries(rawVector)) {
        const coeff = sensitivity[dim] ?? 0.1;
        const value = typeof rawVal === 'number' ? rawVal * coeff : rawVal;
        // Only include dimensions this role cares about (coeff > 0.2)
        if (coeff > 0.2) {
          filtered[dim] = typeof value === 'number' ? Math.round(value * 1000) / 1000 : value;
        }
      }
      fieldContext = filtered;
    } else {
      fieldContext = rawVector;
    }

    // Check if field is non-trivial (at least one dimension > 0)
    const fieldMagnitude = Object.values(fieldContext).reduce((s, v) => s + (typeof v === 'number' ? v : 0), 0);

    if (Object.keys(fieldContext).length > 0) {
      sections.push(`<signal-field role="${roleId}">${JSON.stringify(fieldContext)}</signal-field>`);
    }

    // When field is empty/all-zeros, inject role baseline so agent has behavioral guidance
    if (fieldMagnitude < 0.01) {
      const roleDef = core?.intelligence?.roleRegistry?.get?.(roleId);
      if (roleDef) {
        sections.push(`<role-context id="${roleId}" model="${roleDef.preferredModel || 'balanced'}">${roleDef.behaviorPrompt || roleDef.description || ''}</role-context>`);
      }
    }

    // ── 2. Nearby Pheromones ──────────────────────────────────────
    const pheromones = core?.communication?.readPheromones?.({ scope: sessionId, limit: 10 }) ?? [];
    const globalPheromones = core?.communication?.readPheromones?.({ scope: 'global', limit: 5 }) ?? [];
    const allPheromones = [...pheromones, ...globalPheromones];

    if (allPheromones.length > 0) {
      const pherSummary = allPheromones.map(p => ({
        type: p.type,
        scope: p.scope,
        intensity: Math.round((p.intensity || 0) * 100) / 100,
        from: p.depositor || p.emitterId,
        message: p.metadata?.message || '',
        age: p.age ? `${Math.round(p.age / 1000)}s` : 'fresh',
      }));
      sections.push(`<pheromones>${JSON.stringify(pherSummary)}</pheromones>`);
    }

    // ── 3. Task Channel Messages ─────────────────────────────────
    const channelInfo = core?.communication?.getActiveChannels?.();
    if (channelInfo?.channels?.length > 0) {
      const relevant = channelInfo.channels.filter(ch =>
        ch.members?.includes?.(state.agentId) || ch.channelId === sessionId
      );
      if (relevant.length > 0) {
        const channelSummary = relevant.map(ch => ({
          id: ch.channelId,
          members: ch.memberCount,
          messages: ch.recentMessages?.slice(-5)?.map(m => ({
            from: m.sender || m.from,
            type: m.type,
            data: typeof m.data === 'object' ? m.data?.content || JSON.stringify(m.data).slice(0, 200) : String(m.data).slice(0, 200),
          })) || [],
        }));
        sections.push(`<task-channels>${JSON.stringify(channelSummary)}</task-channels>`);
      }
    }

    // ── 4. DAG Status ────────────────────────────────────────────
    if (state.dagId) {
      const dagStatus = core?.orchestration?.getDAG?.(state.dagId);
      if (dagStatus) {
        const progress = core?.orchestration?.getProgress?.(state.dagId);
        const dagSummary = {
          dagId: state.dagId,
          status: dagStatus.status || dagStatus.state,
          progress: progress ? `${progress.completedNodes}/${progress.totalNodes}` : 'unknown',
          percentage: progress?.percentage || 0,
          nodes: dagStatus.nodes?.map(n => ({
            id: n.id,
            role: n.role,
            state: n.state,
            task: n.task,
          })) || [],
          blockers: progress?.blockers || [],
        };
        sections.push(`<dag-status>${JSON.stringify(dagSummary)}</dag-status>`);
      }
    }

    // ── 5. Global Modulation State ───────────────────────────────
    const modState = core?.orchestration?.getModulatorState?.();
    if (modState && Object.keys(modState).length > 0) {
      const mode = modState.mode || modState.currentMode || 'balanced';
      sections.push(`<modulation mode="${mode}">${JSON.stringify({
        explorationRate: modState.explorationRate,
        temperature: modState.temperature,
      })}</modulation>`);
    }

    // ── 6. Emotion-Based Model Hints ─────────────────────────────
    if (state.agentId) {
      const emotion = core?.intelligence?.social?.emotion?.getEmotion?.(state.agentId);
      if (emotion) {
        const frustration = emotion.frustration || emotion.stress || 0;
        if (frustration > 0.6) {
          sections.push(`<emotion-alert frustration="${Math.round(frustration * 100) / 100}">Consider upgrading model or simplifying approach</emotion-alert>`);
        }
      }
    }

    // ── 7. Stigmergic Board Entries (Knowledge) ──────────────────
    const boardEntries = core?.communication?.suggestKnowledgeSources?.({
      scope: sessionId,
      readerAgentId: state.agentId || 'system',
      limit: 5,
    }) ?? [];
    if (boardEntries.length > 0) {
      const knowledge = boardEntries.map(e => ({
        key: e.key,
        from: e.writtenBy,
        age: e.age ? `${Math.round(e.age / 1000)}s` : 'fresh',
        value: typeof e.value === 'string' ? e.value.slice(0, 300) : JSON.stringify(e.value).slice(0, 300),
      }));
      sections.push(`<shared-knowledge>${JSON.stringify(knowledge)}</shared-knowledge>`);
    }

    // ── 8. Compliance Warnings ───────────────────────────────────
    const compliancePrompt = core?.quality?.getCompliancePrompt?.(sessionId);
    if (compliancePrompt) {
      sections.push(`<compliance>${compliancePrompt}</compliance>`);
    }

    // ── 9. Immunity Warnings (Failure Vaccination) ───────────────
    const task = state.lastIntent?.description || state.lastIntent?.primary || '';
    if (task) {
      const immunity = core?.quality?.checkImmunity?.(task);
      if (immunity?.preventionPrompts?.length > 0) {
        sections.push(`<immunity-warnings>${immunity.preventionPrompts.join('\n')}</immunity-warnings>`);
      }
    }

    if (sections.length === 0) return '';
    return `<swarm-context engine="${ENGINE_ID}" role="${roleId}">\n${sections.join('\n')}\n</swarm-context>`;
  }

  // ── ContextEngine Interface ─────────────────────────────────────

  const engine = {
    info: {
      id: ENGINE_ID,
      name: ENGINE_NAME,
      version: ENGINE_VERSION,
      ownsCompaction: false, // Delegate compaction to runtime
    },

    /**
     * ingest: Called when a new message is added to the session.
     * Records the message, emits signals to field, classifies intent.
     */
    async ingest(params) {
      const { sessionId, message, isHeartbeat } = params;
      if (isHeartbeat || !message) return { ingested: false };

      const state = getSession(sessionId);
      state.messageCount++;

      // Extract content for signal emission
      const content = message?.content || (typeof message === 'string' ? message : '');
      if (!content) return { ingested: true };

      // Classify intent on user messages and emit field signals.
      // NOTE: DAG creation is handled by getContextInjection() in index-v9.js,
      // which runs before every model turn. This method only emits field signals.
      const isUserMessage = message?.role === 'user' || message?.role === 'human';
      if (isUserMessage && core?.intelligence) {
        const intent = core.intelligence.classifyIntent?.(content) ?? null;
        const scope = core.intelligence.estimateScope?.(content) ?? null;
        state.lastIntent = intent;

        if (intent) {
          const route = core.orchestration?.routeTask?.(intent, scope || {}) ?? null;
          state.lastRoute = route;

          // Emit task signal to field
          core.field?.emit?.({
            dimension: 'task',
            scope: sessionId,
            strength: 0.5,
            emitterId: 'context-engine',
            metadata: { intent: intent.primary, confidence: intent.confidence },
          });

          // Route decision → coordination signal (fixes Broken Circuit #2)
          if (route) {
            core.field?.emit?.({
              dimension: 'coordination',
              scope: sessionId,
              strength: route.system === 2 ? 0.8 : 0.4,
              emitterId: 'context-engine',
              metadata: { system: route.system, complexity: route.complexity },
            });
          }

          core.bus?.publish?.('context-engine.intent.classified', {
            sessionId,
            intent,
            scope,
            route,
            dagId: state.dagId,
          }, 'context-engine');
        }
      }

      return { ingested: true };
    },

    /**
     * assemble: Called before each model run to build context.
     * This is WHERE all 10 broken circuits get fixed.
     */
    async assemble(params) {
      const { sessionId, messages, tokenBudget, model, prompt } = params;

      // NOTE: DAG creation and result injection are handled by
      // getContextInjection() in index-v9.js (runs before every model turn).
      // This method only provides signal field / pheromone / channel context.
      const state = getSession(sessionId);
      state.turnCount++;

      // Build swarm-aware context (field vector, pheromones, channels, etc.)
      const systemPromptAddition = buildSwarmContext(sessionId, state);

      // Return messages as-is (we don't own message ordering)
      // but inject our rich context via systemPromptAddition
      return {
        messages: messages || [],
        estimatedTokens: 0, // Let runtime estimate
        systemPromptAddition,
      };
    },

    /**
     * compact: Delegate to runtime's built-in compaction.
     * We don't own compaction but want to preserve swarm state.
     */
    async compact(params) {
      const { sessionId } = params;
      const state = getSession(sessionId);

      // Snapshot swarm state before compaction
      if (state.dagId) {
        core.store?.put?.('context-engine-state', `pre-compact:${sessionId}`, {
          dagId: state.dagId,
          role: state.role,
          lastIntent: state.lastIntent,
          turnCount: state.turnCount,
          ts: Date.now(),
        });
      }

      // Delegate compaction to runtime
      return { ok: true, compacted: false, reason: 'delegated' };
    },

    /**
     * afterTurn: Called after a run attempt completes.
     * Feeds results back for calibration, reputation, evolution.
     */
    async afterTurn(params) {
      const { sessionId, messages, isHeartbeat } = params;
      if (isHeartbeat) return;

      const state = getSession(sessionId);

      // Extract assistant messages from this turn
      const assistantMessages = (messages || []).filter(m =>
        m?.role === 'assistant' && m?.content
      );
      if (assistantMessages.length === 0) return;

      const lastAssistant = assistantMessages[assistantMessages.length - 1];
      const content = lastAssistant?.content || '';

      // Feed to signal calibrator (fixes Broken Circuit #6 partially)
      core.orchestration?.adaptation?.signalCalibrator?.observe?.({
        sessionId,
        content,
        turnCount: state.turnCount,
        role: state.role,
      });

      // Feed to species evolver (fixes Broken Circuit #7)
      if (state.role) {
        core.orchestration?.adaptation?.speciesEvolver?.recordOutcome?.({
          roleId: state.role,
          success: true, // Assume success if we got a response
          turnCount: state.turnCount,
        });
      }

      // Emit knowledge signal for completed work
      core.field?.emit?.({
        dimension: 'knowledge',
        scope: sessionId,
        strength: 0.4,
        emitterId: 'context-engine',
        metadata: { turnCount: state.turnCount, contentLength: content.length },
      });

      // Deposit path pheromone (agent was here, did work)
      core.communication?.depositPheromone?.({
        type: 'trail',
        scope: sessionId,
        intensity: 0.5,
        metadata: {
          message: `Turn ${state.turnCount} completed by ${state.role || 'agent'}`,
          role: state.role,
        },
        emitterId: state.agentId || 'context-engine',
      });
    },

    /**
     * prepareSubagentSpawn: Called before child session runs.
     * Sets up the child's context from DAG node, applies role-specific sensitivity.
     * Fixes Broken Circuit #3 (pheromone sensing) and #5 (emotion model upgrade).
     */
    async prepareSubagentSpawn(params) {
      const { parentSessionKey, childSessionKey } = params;
      const parentState = _sessionState.get(parentSessionKey) || {};

      // Create child session state
      const childState = getSession(childSessionKey);
      childState.dagId = parentState.dagId;

      // Determine role from DAG if available
      if (parentState.dagId) {
        const dagInfo = core?.orchestration?.getDAG?.(parentState.dagId);
        if (dagInfo?.nodes) {
          // Find next pending node to assign to this child
          const pendingNode = dagInfo.nodes.find(n => n.state === 'PENDING' || n.state === 'READY');
          if (pendingNode) {
            childState.role = pendingNode.role;
            childState.agentId = childSessionKey;
          }
        }
      }

      // Check emotion field → model upgrade hint (fixes Broken Circuit #5)
      const emotionSignal = core?.field?.query?.('emotion', parentSessionKey);
      if (emotionSignal && emotionSignal.length > 0) {
        const avgEmotion = emotionSignal.reduce((sum, s) => sum + (s.strength || 0), 0) / emotionSignal.length;
        if (avgEmotion > 0.6) {
          // High frustration → store hint for model upgrade
          childState._modelUpgradeHint = true;
        }
      }

      return {
        rollback: () => {
          _sessionState.delete(childSessionKey);
        },
      };
    },

    /**
     * onSubagentEnded: Called when a subagent lifecycle ends.
     * Marks DAG node complete, triggers next nodes, records credit.
     * Fixes Broken Circuit #8 (DAG node completion → next spawn).
     */
    async onSubagentEnded(params) {
      const { childSessionKey, reason } = params;
      const state = _sessionState.get(childSessionKey);
      if (!state) return;

      const success = reason === 'completed';
      const dagId = state.dagId;

      if (dagId && core?.orchestration?.dag) {
        const dagEngine = core.orchestration.dag;

        // Find the node assigned to this child
        const dagInfo = core.orchestration.getDAG?.(dagId);
        if (dagInfo?.nodes) {
          const assignedNode = dagInfo.nodes.find(n =>
            n.agentId === childSessionKey || n.state === 'RUNNING'
          );

          if (assignedNode) {
            if (success) {
              // Mark node complete
              dagEngine.completeNode?.(dagId, assignedNode.id, {
                success: true,
                sessionKey: childSessionKey,
              });

              // Shapley credit assignment (fixes Broken Circuit #7 partially)
              core.orchestration?.adaptation?.shapleyCredit?.recordContribution?.({
                dagId,
                nodeId: assignedNode.id,
                roleId: state.role,
                agentId: childSessionKey,
                success: true,
              });

              // Deposit food pheromone (success signal)
              core.communication?.depositPheromone?.({
                type: 'food',
                scope: dagId,
                intensity: 0.7,
                metadata: {
                  message: `Node ${assignedNode.id} completed by ${state.role}`,
                  nodeId: assignedNode.id,
                  role: state.role,
                },
                emitterId: childSessionKey,
              });

              // Emit trust + reputation signals
              core.field?.emit?.({
                dimension: 'trust',
                scope: childSessionKey,
                strength: 0.7,
                emitterId: 'context-engine',
                metadata: { dagId, nodeId: assignedNode.id, success: true },
              });
              core.field?.emit?.({
                dimension: 'reputation',
                scope: childSessionKey,
                strength: 0.6,
                emitterId: 'context-engine',
              });

              // Publish event for DAG advancement
              core.bus?.publish?.('dag.node.completed', {
                dagId,
                nodeId: assignedNode.id,
                role: state.role,
                agentId: childSessionKey,
              }, 'context-engine');

              // Check if next nodes are ready → publish event for spawning
              const readyNodes = dagEngine.getReady?.(dagId) || dagEngine.getReadyNodes?.(dagId) || [];
              if (readyNodes.length > 0) {
                core.bus?.publish?.('dag.nodes.ready', {
                  dagId,
                  nodes: readyNodes.map(n => ({ id: n.id, role: n.role, task: n.taskId })),
                }, 'context-engine');
              }

              // Check if entire DAG is complete → trigger synthesis
              const status = dagEngine.getDAGStatus?.(dagId);
              if (status && status.completed === status.total) {
                core.bus?.publish?.('dag.completed', { dagId }, 'context-engine');
                // Trigger result synthesis
                core.orchestration?.synthesizer?.synthesize?.(dagId);
              }
            } else {
              // Mark node failed
              dagEngine.failNode?.(dagId, assignedNode.id, {
                reason: reason || 'subagent_failed',
                sessionKey: childSessionKey,
              });

              // Deposit alarm pheromone
              core.communication?.depositPheromone?.({
                type: 'alarm',
                scope: dagId,
                intensity: 0.8,
                metadata: {
                  message: `Node ${assignedNode.id} failed (${reason})`,
                  nodeId: assignedNode.id,
                  role: state.role,
                },
                emitterId: childSessionKey,
              });

              // Emit alarm signal
              core.field?.emit?.({
                dimension: 'alarm',
                scope: childSessionKey,
                strength: 0.8,
                emitterId: 'context-engine',
                metadata: { dagId, nodeId: assignedNode.id, reason },
              });

              // Trigger replan (fixes Broken Circuit #6)
              core.orchestration?.replan?.evaluate?.({
                dagId,
                failedNodeId: assignedNode.id,
                reason,
                role: state.role,
              });

              // Emit emotion signal (frustration increases)
              const parentSessionId = _dagSessionMap.get(dagId);
              if (parentSessionId) {
                core.field?.emit?.({
                  dimension: 'emotion',
                  scope: parentSessionId,
                  strength: 0.7,
                  emitterId: 'context-engine',
                  metadata: { frustration: true, failedNode: assignedNode.id },
                });
              }
            }
          }
        }
      }

      // Clean up
      _sessionState.delete(childSessionKey);
    },

    /**
     * dispose: Release resources during shutdown.
     */
    async dispose() {
      _sessionState.clear();
      _dagSessionMap.clear();
    },
  };

  return engine;
}
