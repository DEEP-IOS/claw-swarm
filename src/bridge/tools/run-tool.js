// R8 Bridge - swarm_run tool
// Main task execution tool with DualProcessRouter, SpawnAdvisor, and ImmunitySystem integration

function toolResponse(data) {
  return { content: [{ type: 'text', text: JSON.stringify(data) }] };
}

function errorResponse(error) {
  return toolResponse({ status: 'error', error: String(error) });
}

/**
 * Handle cancel request - terminate a running agent
 */
async function handleCancel(agentId, spawnClient) {
  if (!spawnClient?.cancel) {
    return errorResponse('SpawnClient not available or cancel not supported');
  }
  try {
    const result = await spawnClient.cancel(agentId);
    return toolResponse({
      status: 'cancelled',
      agentId,
      detail: result?.detail || 'Agent cancellation requested',
    });
  } catch (err) {
    return errorResponse(`Cancel failed for ${agentId}: ${err.message}`);
  }
}

/**
 * Handle resume request - resume a paused/checkpointed agent
 */
async function handleResume(agentId, spawnClient) {
  if (!spawnClient?.resume) {
    return errorResponse('SpawnClient not available or resume not supported');
  }
  try {
    const result = await spawnClient.resume(agentId);
    return toolResponse({
      status: 'resumed',
      agentId,
      detail: result?.detail || 'Agent resume requested',
    });
  } catch (err) {
    return errorResponse(`Resume failed for ${agentId}: ${err.message}`);
  }
}

/**
 * Build the full execution prompt from role, task context, and immunity warnings
 */
function buildFallbackPrompt(role, task, plan, immunityWarnings) {
  const lines = [`You are a ${role} agent.`, `Task: ${task}`];
  if (plan) {
    lines.push(`Plan context: ${plan}`);
  }
  if (immunityWarnings && immunityWarnings.length > 0) {
    lines.push('--- Immunity Warnings ---');
    for (const w of immunityWarnings) {
      lines.push(`- ${w}`);
    }
  }
  return lines.join('\n');
}

/**
 * Truncate label to 64 chars (gateway limit)
 */
function safeLabel(text) {
  if (!text) return 'swarm-task';
  return text.length <= 64 ? text : text.slice(0, 64);
}

/**
 * createRunTool - Factory for the swarm_run tool
 *
 * Dependencies:
 *   core.orchestration  - DualProcessRouter, PlanEngine, SpawnAdvisor
 *   core.intelligence   - IntentClassifier, PromptArchitect
 *   quality             - ImmunitySystem, PipelineTracker
 *   sessionBridge       - ScopeManager for current scope
 *   spawnClient         - Agent spawn/cancel/resume via IPC
 */
export function createRunTool({ core, quality, sessionBridge, spawnClient }) {
  return {
    name: 'swarm_run',

    parameters: {
      type: 'object',
      properties: {
        task: {
          type: 'string',
          description: 'Task description to execute',
        },
        role: {
          type: 'string',
          description: 'Specify agent role (optional, auto-selected if omitted)',
        },
        model: {
          type: 'string',
          description: 'Specify LLM model (optional, uses balanced default)',
        },
        background: {
          type: 'boolean',
          description: 'Run task in background without blocking',
        },
        cancel: {
          type: 'string',
          description: 'Cancel a running agent by its ID',
        },
        resume: {
          type: 'string',
          description: 'Resume a paused agent by its ID',
        },
      },
      required: ['task'],
    },

    async execute(toolCallId, params) {
      try {
        // Cancel flow
        if (params.cancel) {
          return handleCancel(params.cancel, spawnClient);
        }

        // Resume flow
        if (params.resume) {
          return handleResume(params.resume, spawnClient);
        }

        const task = params.task;
        if (!task || typeof task !== 'string' || task.trim().length === 0) {
          return errorResponse('Task description is required and must be non-empty');
        }

        // Resolve current scope from session
        const scope = sessionBridge?.getCurrentScope?.() ?? 'default';

        // --- DualProcessRouter: System 1 (fast) vs System 2 (deliberate) ---
        const routing = core?.orchestration?.routeTask?.(task);
        if (routing?.system === 1 && !params.role) {
          return toolResponse({
            status: 'direct_reply',
            answer: routing.answer,
            confidence: routing.confidence,
            system: 1,
          });
        }

        // --- System 2: Full pipeline ---

        // 1. Intent classification
        const intent = core?.intelligence?.classifyIntent?.(task) ?? {
          type: 'unknown',
          confidence: 0.5,
          keywords: [],
        };

        // 2. Plan creation via DAG engine
        const plan = core?.orchestration?.createPlan?.(intent, scope) ?? {
          dagId: `dag-${Date.now()}`,
          suggestedRole: 'implementer',
          summary: '',
          timeBudgetMs: 300000,
        };

        // 3. SpawnAdvisor: determine best role and reasoning
        const targetRole = params.role || plan.suggestedRole || 'implementer';
        const advice = core?.orchestration?.adviseSpawn?.(scope, targetRole) ?? {
          role: targetRole,
          reason: 'default assignment',
          parallelism: 1,
        };

        // 4. ImmunitySystem: check for known failure patterns
        const immunity = quality?.checkImmunity?.(task) ?? {
          immune: false,
          preventionPrompts: [],
          riskScore: 0,
        };

        // 5. PromptArchitect: build execution prompt
        const promptContext = {
          task,
          plan: plan.summary || '',
          immunityWarnings: immunity.preventionPrompts || [],
          scope,
          intent: intent.type,
        };

        const prompt = core?.intelligence?.buildPrompt?.(advice.role, { task }, promptContext)
          ?? buildFallbackPrompt(advice.role, task, plan.summary, immunity.preventionPrompts);

        // 6. Determine tools for spawned agent
        const agentTools = core?.orchestration?.selectTools?.(advice.role, intent) ?? [];

        // 7. Spawn the agent
        if (!spawnClient?.spawn) {
          return errorResponse('SpawnClient not available - cannot dispatch agent');
        }

        const spawnOpts = {
          role: advice.role,
          model: params.model || 'balanced',
          prompt,
          tools: agentTools,
          label: safeLabel(task),
          background: params.background || false,
          dagId: plan.dagId,
          scope,
        };

        const agentId = await spawnClient.spawn(spawnOpts);

        if (!agentId) {
          return errorResponse('Spawn returned no agent ID');
        }

        // 8. Start pipeline tracking for quality monitoring
        quality?.startPipelineTracking?.(plan.dagId, plan.timeBudgetMs || 300000);

        // 9. Record in field + bus
        core?.field?.emit?.({
          dimension: 'task_load',
          scope: scope || agentId,
          strength: 0.6,
          emitterId: 'run-tool',
          metadata: { role: advice.role, dagId: plan.dagId },
        });
        core?.bus?.publish?.('task.created', {
          taskId: plan.dagId,
          agentId,
          role: advice.role,
          type: intent?.type || 'unknown',
        }, 'run-tool');

        return toolResponse({
          status: 'dispatched',
          agentId,
          role: advice.role,
          reason: advice.reason,
          dagId: plan.dagId,
          intent: intent.type,
          confidence: intent.confidence,
          background: spawnOpts.background,
          immuneWarnings: immunity.preventionPrompts.length,
        });
      } catch (err) {
        return errorResponse(`swarm_run execution failed: ${err.message}`);
      }
    },
  };
}
