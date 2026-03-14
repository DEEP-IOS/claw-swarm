// R8 Bridge - swarm_spawn tool
// Direct agent spawn bypassing SpawnAdvisor for explicit control

function toolResponse(data) {
  return { content: [{ type: 'text', text: JSON.stringify(data) }] };
}

function errorResponse(error) {
  return toolResponse({ status: 'error', error: String(error) });
}

/**
 * Known roles and their default tool sets
 */
const ROLE_DEFAULTS = {
  implementer:   { tools: ['file_read', 'file_write', 'bash'], description: 'Code implementation' },
  reviewer:      { tools: ['file_read', 'bash'], description: 'Code review and analysis' },
  researcher:    { tools: ['file_read', 'web_search'], description: 'Information gathering' },
  planner:       { tools: ['file_read'], description: 'Task planning and decomposition' },
  tester:        { tools: ['file_read', 'bash'], description: 'Testing and validation' },
  debugger:      { tools: ['file_read', 'file_write', 'bash'], description: 'Bug diagnosis and fixing' },
  documenter:    { tools: ['file_read', 'file_write'], description: 'Documentation writing' },
  architect:     { tools: ['file_read'], description: 'Architecture design and decisions' },
};

/**
 * Truncate label to 64 chars (gateway limit)
 */
function safeLabel(text) {
  if (!text) return 'swarm-spawn';
  return text.length <= 64 ? text : text.slice(0, 64);
}

/**
 * createSpawnTool - Factory for the swarm_spawn tool
 *
 * Provides direct agent spawning that bypasses the SpawnAdvisor
 * and DualProcessRouter. Use when you need explicit control over
 * role, model, and tools for the spawned agent.
 *
 * Unlike swarm_run, this tool:
 *   - Skips intent classification
 *   - Skips DAG plan creation
 *   - Skips SpawnAdvisor role selection
 *   - Skips ImmunitySystem checks
 *   - Directly spawns with provided parameters
 *
 * Dependencies:
 *   spawnClient        - Agent spawn via IPC
 *   core.intelligence  - PromptArchitect for prompt building
 *   core.field         - Signal emission for spawn events
 */
export function createSpawnTool({ core, quality, sessionBridge, spawnClient }) {
  return {
    name: 'swarm_spawn',

    parameters: {
      type: 'object',
      properties: {
        role: {
          type: 'string',
          description: 'Agent role (e.g., implementer, reviewer, researcher, tester)',
        },
        model: {
          type: 'string',
          description: 'LLM model to use (e.g., fast, balanced, strong)',
        },
        task: {
          type: 'string',
          description: 'Task description for the agent',
        },
        tools: {
          type: 'array',
          items: { type: 'string' },
          description: 'Explicit tool list (overrides role defaults)',
        },
        prompt: {
          type: 'string',
          description: 'Custom prompt (overrides auto-generated prompt)',
        },
        context: {
          type: 'object',
          additionalProperties: true,
          description: 'Additional context to include in the prompt',
        },
        background: {
          type: 'boolean',
          description: 'Run in background without blocking (default: false)',
        },
      },
      required: ['role', 'model', 'task'],
    },

    async execute(toolCallId, params) {
      try {
        const { role, model, task, tools, prompt, context, background } = params;

        if (!role || typeof role !== 'string') {
          return errorResponse('role is required and must be a string');
        }
        if (!model || typeof model !== 'string') {
          return errorResponse('model is required and must be a string');
        }
        if (!task || typeof task !== 'string' || task.trim().length === 0) {
          return errorResponse('task is required and must be non-empty');
        }

        if (!spawnClient?.spawn) {
          return errorResponse('SpawnClient not available - cannot spawn agent');
        }

        const scope = sessionBridge?.getCurrentScope?.() ?? 'default';
        const roleDefaults = ROLE_DEFAULTS[role] || { tools: [], description: role };

        // Determine tools: explicit > role defaults
        const agentTools = tools || roleDefaults.tools;

        // Build prompt: explicit > PromptArchitect > fallback
        let agentPrompt;
        if (prompt) {
          agentPrompt = prompt;
        } else if (core?.intelligence?.buildPrompt) {
          const promptContext = {
            task,
            scope,
            roleDescription: roleDefaults.description,
            ...(context || {}),
          };
          agentPrompt = core.intelligence.buildPrompt(role, { task }, promptContext);
        } else {
          // Fallback prompt construction
          const lines = [
            `You are a ${role} agent.`,
            `Role description: ${roleDefaults.description}`,
            `Task: ${task}`,
          ];
          if (context) {
            lines.push(`Context: ${JSON.stringify(context)}`);
          }
          agentPrompt = lines.join('\n');
        }

        // Spawn the agent directly
        const spawnOpts = {
          role,
          model,
          prompt: agentPrompt,
          tools: agentTools,
          label: safeLabel(task),
          background: background || false,
          scope,
          direct: true, // Flag indicating direct spawn (no advisor)
        };

        const agentId = await spawnClient.spawn(spawnOpts);

        if (!agentId) {
          return errorResponse('Spawn returned no agent ID');
        }

        // Emit field signal
        core?.field?.emit?.('agent.spawned', {
          agentId,
          role,
          model,
          scope,
          direct: true,
          timestamp: Date.now(),
        });

        return toolResponse({
          status: 'spawned',
          agentId,
          role,
          model,
          tools: agentTools,
          background: spawnOpts.background,
          direct: true,
          label: spawnOpts.label,
        });
      } catch (err) {
        return errorResponse(`swarm_spawn execution failed: ${err.message}`);
      }
    },
  };
}
