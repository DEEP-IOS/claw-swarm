// R8 Bridge - swarm_dispatch tool
// Forward messages to running agents via communication bus/channel

function toolResponse(data) {
  return { content: [{ type: 'text', text: JSON.stringify(data) }] };
}

function errorResponse(error) {
  return toolResponse({ status: 'error', error: String(error) });
}

/**
 * Resolve priority level to numeric value for ordering
 */
function resolvePriority(priority) {
  const levels = { low: 1, normal: 5, high: 8, critical: 10 };
  return levels[priority] || levels.normal;
}

/**
 * createDispatchTool - Factory for the swarm_dispatch tool
 *
 * Forwards messages to running agents via the communication bus.
 * Supports priority levels and message tracking.
 *
 * Dependencies:
 *   core.communication - MessageBus for inter-agent messaging
 *   core.intelligence  - Agent registry for validation
 *   spawnClient        - Direct IPC channel fallback
 */
export function createDispatchTool({ core, quality, sessionBridge, spawnClient }) {
  return {
    name: 'swarm_dispatch',
    description: [
      'Send a direct message to a specific running agent.',
      'Use this for inter-agent communication: relay findings,',
      'ask questions, or provide instructions to a named agent.',
      'Supports priority levels: low, normal, high, critical.',
    ].join('\n'),

    parameters: {
      type: 'object',
      properties: {
        agentId: {
          type: 'string',
          description: 'Target agent ID to receive the message',
        },
        message: {
          type: 'string',
          description: 'Message content to dispatch to the agent',
        },
        priority: {
          type: 'string',
          enum: ['low', 'normal', 'high', 'critical'],
          description: 'Message priority level (default: normal)',
        },
      },
      required: ['agentId', 'message'],
    },

    async execute(toolCallId, params) {
      try {
        const { agentId, message, priority } = params;

        if (!agentId || typeof agentId !== 'string') {
          return errorResponse('agentId is required and must be a string');
        }
        if (!message || typeof message !== 'string' || message.trim().length === 0) {
          return errorResponse('message is required and must be non-empty');
        }

        const priorityLevel = priority || 'normal';
        const numericPriority = resolvePriority(priorityLevel);
        const messageId = `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const scope = sessionBridge?.getCurrentScope?.() ?? 'default';

        // Validate agent exists if registry is available
        const activeAgents = core?.intelligence?.getActiveAgents?.() ?? [];
        const targetAgent = activeAgents.find(a => a.id === agentId);

        if (activeAgents.length > 0 && !targetAgent) {
          return errorResponse(`Agent ${agentId} not found in active agents`);
        }

        // Attempt dispatch via communication bus first
        const envelope = {
          id: messageId,
          from: 'orchestrator',
          to: agentId,
          content: message,
          priority: numericPriority,
          priorityLabel: priorityLevel,
          scope,
          timestamp: Date.now(),
        };

        let delivered = false;
        let channel = 'unknown';

        // Try MessageBus
        if (core?.communication?.send) {
          try {
            await core.communication.send(envelope);
            delivered = true;
            channel = 'message_bus';
          } catch (busErr) {
            // Fall through to IPC fallback
          }
        }

        // Fallback to direct IPC via spawnClient
        if (!delivered && spawnClient?.sendMessage) {
          try {
            await spawnClient.sendMessage(agentId, {
              type: 'dispatch',
              content: message,
              priority: numericPriority,
              messageId,
            });
            delivered = true;
            channel = 'ipc_direct';
          } catch (ipcErr) {
            return errorResponse(
              `Failed to dispatch message to ${agentId}: bus and IPC both failed - ${ipcErr.message}`
            );
          }
        }

        if (!delivered) {
          return errorResponse('No communication channel available (bus and IPC unavailable)');
        }

        // Deposit pheromone trail for dispatch event
        core?.communication?.depositPheromone?.({
          type: 'dispatch',
          scope,
          intensity: numericPriority / 10,
          metadata: { agentId, messageId },
        });

        return toolResponse({
          status: 'dispatched',
          messageId,
          agentId,
          priority: priorityLevel,
          channel,
          timestamp: envelope.timestamp,
        });
      } catch (err) {
        return errorResponse(`swarm_dispatch execution failed: ${err.message}`);
      }
    },
  };
}
