// R8 Bridge - swarm_run tool
// Main task execution tool with DualProcessRouter, SpawnAdvisor, and ImmunitySystem integration

function toolResponse(data) {
  return { content: [{ type: 'text', text: JSON.stringify(data) }] };
}

function errorResponse(error) {
  return toolResponse({ status: 'error', error: String(error) });
}

function buildClarificationRequest(task, intent, questions = []) {
  const suggested = intent?.suggestedClarification
    || questions[0]?.question
    || 'Please clarify the task requirements before execution.';
  const choices = [intent?.primary, ...(intent?.ambiguity || [])]
    .filter(Boolean)
    .map((value) => ({ label: value, value }));

  return {
    status: 'needs_clarification',
    requiresUserInput: true,
    task,
    intent: intent?.primary || 'unknown',
    confidence: intent?.confidence ?? 0,
    ambiguity: intent?.ambiguity || [],
    suggestedClarification: suggested,
    clarificationQuestions: questions,
    choices,
  };
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

function containsCJK(text) {
  return /[\u3400-\u9fff]/.test(text);
}

function formatNumber(value) {
  if (Number.isInteger(value)) {
    return String(value);
  }
  return value.toFixed(6).replace(/\.?0+$/, '');
}

function tryEvaluateExpression(task) {
  const match = String(task)
    .replace(/[，。！？]/g, ' ')
    .match(/(-?\d[\d\s()+\-*/.]*[+\-*/][\d\s()+\-*/.]*)/);

  if (!match?.[1]) {
    return null;
  }

  const expression = match[1].replace(/\s+/g, '');
  if (
    expression.length > 48
    || !/^[0-9+\-*/().]+$/.test(expression)
    || expression.includes('**')
    || expression.includes('//')
  ) {
    return null;
  }

  try {
    const result = Function(`"use strict"; return (${expression});`)();
    if (!Number.isFinite(result)) {
      return null;
    }
    return `${expression} = ${formatNumber(result)}`;
  } catch {
    return null;
  }
}

function buildFastReply(task, intent) {
  const source = String(task || '').trim();
  const lower = source.toLowerCase();
  const cjk = containsCJK(source);

  if (!source) {
    return null;
  }

  if (/(how are you|how's it going|today going|今天过得怎么样|最近怎么样|还好吗)/i.test(lower)) {
    return cjk
      ? '我状态良好，随时可以继续处理代码、架构或排障。'
      : 'I am doing well and ready to help with code, architecture, or debugging.';
  }

  if (/^(hi|hello|hey|yo|你好|嗨|哈喽|早上好|下午好|晚上好)[!,. ]*$/i.test(source)) {
    return cjk
      ? '你好，我在。把要分析、实现或修复的内容丢给我就行。'
      : 'Hello. I am here and ready to dig into implementation, architecture, or debugging.';
  }

  const expressionAnswer = tryEvaluateExpression(source);
  if (expressionAnswer) {
    return expressionAnswer;
  }

  if (intent?.primary === 'question' && /(what is|explain|什么是|解释一下)/i.test(lower)) {
    return null;
  }

  return null;
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
// Module-level dedup shared across all instances
const _globalDedup = { dagId: null, createdAt: 0 };

export function createRunTool({ core, quality, sessionBridge, spawnClient }) {

  return {
    name: 'swarm_run',
    description: [
      'Execute a complex task with full swarm orchestration.',
      'Automatically decomposes the task into a DAG, spawns specialized agents,',
      'coordinates their work, and returns consolidated results.',
      '',
      'Use this for any multi-step task that benefits from agent collaboration:',
      '  - Research & analysis (news, papers, market data)',
      '  - Content creation (articles, reports, social media)',
      '  - Code development (implement, test, review)',
      '  - Business operations (customer support, data analysis)',
      '',
      'Parameters:',
      '  task (required) — Natural language task description',
      '  role — Force a specific agent role (default: auto-selected)',
      '  model — LLM tier: "fast", "balanced", "strong", "reasoning"',
      '  background — Run without blocking (default: false)',
      '  cancel — Cancel a running agent by ID',
      '  resume — Resume a paused agent by ID',
    ].join('\n'),

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
      anyOf: [
        { required: ['task'] },
        { required: ['cancel'] },
        { required: ['resume'] },
      ],
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

        // Hard dedup: check BOTH tool-level AND T0-level dedup
        // T0 getContextInjection may have already created a DAG
        const swarmCore = globalThis[Symbol.for('claw-swarm.core')];
        if (swarmCore?._hasActiveDag || swarmCore?._lastDagId) {
          const dagId = swarmCore._lastDagId || 'unknown';
          return toolResponse({
            status: 'completed',
            dagId,
            result: `蜂群系统已自动为此任务创建 DAG (${typeof dagId === 'string' ? dagId.slice(-8) : dagId})。任务正在后台执行中。`,
          });
        }
        if (_globalDedup.dagId && (Date.now() - _globalDedup.createdAt) < 600000) {
          return toolResponse({
            status: 'completed',
            dagId: _globalDedup.dagId,
            result: `蜂群任务已在执行中 (DAG: ${_globalDedup.dagId.slice(-8)})。请直接向用户展示任务进展。`,
          });
        }

        // Resolve current scope from session
        const scope = sessionBridge?.getCurrentScope?.() ?? 'default';
        const sessionId = sessionBridge?.getCurrentSessionId?.() ?? null;

        // 1. Intent classification
        const intent = core?.intelligence?.classifyIntent?.(task) ?? {
          primary: 'question',
          confidence: 0.5,
        };
        const scopeEstimate = core?.intelligence?.estimateScope?.(intent, { scope, sessionId }) ?? {};

        const needsClarification = core?.intelligence?.isIntentAmbiguous?.(intent)
          ?? (intent.confidence < 0.7 && Array.isArray(intent.ambiguity) && intent.ambiguity.length > 0);
        if (needsClarification) {
          const questions = core?.intelligence?.generateClarificationQuestions?.(intent, scopeEstimate) ?? [];
          const clarification = buildClarificationRequest(task, intent, questions);

          core?.bus?.publish?.('user.notification', {
            sessionId,
            type: 'choice',
            question: clarification.suggestedClarification,
            choices: clarification.choices,
            clarificationQuestions: clarification.clarificationQuestions,
            ts: Date.now(),
          }, 'run-tool');

          return toolResponse(clarification);
        }

        // 2. Route through the real orchestration facade
        const routing = core?.orchestration?.routeTask?.(intent, { ...scopeEstimate, scope, sessionId }) ?? null;
        const fastReply = (!params.role && routing?.system === 1)
          ? (routing.answer ?? buildFastReply(task, intent))
          : null;

        if (fastReply) {
          return toolResponse({
            status: 'direct_reply',
            answer: fastReply,
            confidence: routing?.confidence ?? intent.confidence,
            system: 1,
          });
        }

        const executionSystem = routing?.system === 1 && !fastReply
          ? 2
          : (routing?.system ?? 2);

        // 3. Plan creation via DAG engine
        const plan = core?.orchestration?.createPlan?.(intent, { ...scopeEstimate, scope, sessionId }) ?? {
          dagId: `dag-${Date.now()}`,
          suggestedRole: 'implementer',
          summary: '',
          timeBudgetMs: 300000,
        };
        if (sessionId && plan?.dagId) {
          sessionBridge?.linkDag?.(sessionId, plan.dagId);
        }
        // Track active DAG for dedup
        _globalDedup.dagId = plan.dagId;
        _globalDedup.createdAt = Date.now();

        // 4. SpawnAdvisor: determine best role and reasoning
        const targetRole = params.role || plan.suggestedRole || 'implementer';
        const advice = core?.orchestration?.adviseSpawn?.(scope, targetRole, { intent, routing, scopeEstimate }) ?? {
          role: targetRole,
          reason: 'default assignment',
          parallelism: 1,
        };

        // 5. ImmunitySystem: check for known failure patterns
        const immunity = quality?.checkImmunity?.(task) ?? {
          immune: false,
          preventionPrompts: [],
          riskScore: 0,
        };

        // 6. PromptArchitect: build execution prompt
        const promptContext = {
          task,
          plan: plan.summary || '',
          immunityWarnings: immunity.preventionPrompts || [],
          scope,
          intent: intent.primary,
        };

        const prompt = await core?.intelligence?.buildPrompt?.(advice.role, { task }, promptContext)
          ?? buildFallbackPrompt(advice.role, task, plan.summary, immunity.preventionPrompts);

        // 7. Determine tools for spawned agent
        const agentTools = core?.orchestration?.selectTools?.(advice.role, intent) ?? [];

        // 8. Spawn the agent
        if (!spawnClient?.spawn) {
          return errorResponse('SpawnClient not available - cannot dispatch agent');
        }

        // Resolve the first ready/pending node in the DAG for this spawn
        const dagEngine = core?.orchestration?.dag;
        let nodeId = null;
        if (dagEngine) {
          try {
            // Method is getReady() not getReadyNodes()
            const readyNodes = dagEngine.getReady?.(plan.dagId) || [];
            if (readyNodes.length > 0) {
              nodeId = readyNodes[0].id;
              // State machine: PENDING → ASSIGNED → EXECUTING
              dagEngine.assignNode(plan.dagId, nodeId, `pre-spawn-${Date.now()}`);
              dagEngine.startNode(plan.dagId, nodeId);
            }
          } catch (dagErr) {
            // Logged but non-fatal — spawn continues without DAG tracking
            console.error(`[Claw-Swarm] DAG node transition: ${dagErr?.message}`);
          }
        }

        const spawnOpts = {
          role: advice.role,
          model: params.model || 'balanced',
          prompt,
          tools: agentTools,
          label: safeLabel(task),
          background: params.background || false,
          dagId: plan.dagId,
          nodeId,
          scope,
        };

        const agentId = await spawnClient.spawn(spawnOpts);

        if (!agentId) {
          return errorResponse('Spawn returned no agent ID');
        }

        // 9. Start pipeline tracking for quality monitoring
        quality?.startPipelineTracking?.(plan.dagId, plan.timeBudgetMs || 300000);

        // 10. Record in field + bus
        core?.field?.emit?.({
          dimension: 'task',
          scope: scope || agentId,
          strength: 0.6,
          emitterId: 'run-tool',
          metadata: { role: advice.role, dagId: plan.dagId, sessionId },
        });
        core?.bus?.publish?.('task.created', {
          taskId: plan.dagId,
          agentId,
          role: advice.role,
          type: intent?.type || 'unknown',
        }, 'run-tool');

        // Synchronous wait: block until DAG completes, then return full results
        // This prevents model from calling swarm_run again (it's blocked during wait)
        const dagWaiter = core?.orchestration?.dag;
        const maxWaitMs = 300000; // 5 min max
        const pollMs = 5000;
        const startWait = Date.now();

        while (Date.now() - startWait < maxWaitMs) {
          await new Promise(r => setTimeout(r, pollMs));
          try {
            const status = dagWaiter?.getDAGStatus?.(plan.dagId);
            if (!status) break;
            if (status.completed + status.failed + (status.deadLetter || 0) >= status.total) {
              // All nodes done — collect results
              const dagInfo = core?.orchestration?.getDAG?.(plan.dagId);
              const outputs = (dagInfo?.nodes || [])
                .filter(n => n.state === 'COMPLETED' && n.result)
                .map(n => {
                  const out = typeof n.result === 'string' ? n.result
                    : n.result?.output || JSON.stringify(n.result).slice(0, 1000);
                  return `### ${n.role || n.id}\n${out}`;
                });

              const resultText = [
                `🐝 蜂群任务完成！`,
                `📋 DAG: ${plan.dagId.slice(-8)} | ${status.completed}/${status.total} 节点成功`,
                ``,
                ...outputs,
              ].join('\n\n');

              return { content: [{ type: 'text', text: resultText }] };
            }
          } catch { break; }
        }

        // Timeout: return partial results
        const dagInfo = core?.orchestration?.getDAG?.(plan.dagId);
        const partialOutputs = (dagInfo?.nodes || [])
          .filter(n => n.state === 'COMPLETED' && n.result)
          .map(n => {
            const out = typeof n.result === 'string' ? n.result
              : n.result?.output || '';
            return `### ${n.role || n.id}\n${out}`;
          });

        return { content: [{ type: 'text', text: `⏱ 蜂群任务部分完成（超时）\n\n${partialOutputs.join('\n\n') || '暂无输出'}` }] };
      } catch (err) {
        return errorResponse(`swarm_run execution failed: ${err.message}`);
      }
    },
  };
}
