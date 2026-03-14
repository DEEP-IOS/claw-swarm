// R8 Bridge - swarm_checkpoint tool
// Create, resolve, and list human-in-the-loop checkpoints

function toolResponse(data) {
  return { content: [{ type: 'text', text: JSON.stringify(data) }] };
}

function errorResponse(error) {
  return toolResponse({ status: 'error', error: String(error) });
}

/**
 * createCheckpointTool - Factory for the swarm_checkpoint tool
 *
 * Manages human-in-the-loop checkpoints where agents pause execution
 * and await user decisions before proceeding.
 *
 * Actions:
 *   create  - Store a checkpoint, return STOP instruction to caller
 *   resolve - Mark checkpoint resolved with user's decision, trigger resume
 *   list    - Return all active (unresolved) checkpoints
 *
 * Dependencies:
 *   core.orchestration - DomainStore for checkpoint persistence
 *   core.communication - Notify agents on resolution
 *   spawnClient        - Resume paused agents
 */
export function createCheckpointTool({ core, quality, sessionBridge, spawnClient }) {
  return {
    name: 'swarm_checkpoint',

    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['create', 'resolve', 'list'],
          description: 'Checkpoint action to perform',
        },
        checkpointId: {
          type: 'string',
          description: 'Checkpoint ID (required for resolve)',
        },
        resolution: {
          type: 'string',
          description: 'User resolution text (required for resolve)',
        },
        agentId: {
          type: 'string',
          description: 'Agent ID that created the checkpoint (for create)',
        },
        reason: {
          type: 'string',
          description: 'Reason the checkpoint was created (for create)',
        },
        options: {
          type: 'array',
          items: { type: 'string' },
          description: 'Suggested options for the user to choose from (for create)',
        },
      },
      required: ['action'],
    },

    async execute(toolCallId, params) {
      try {
        const { action } = params;
        const scope = sessionBridge?.getCurrentScope?.() ?? 'default';
        const store = core?.orchestration?.getDomainStore?.('checkpoints');

        switch (action) {
          case 'create': {
            const checkpointId = `cp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
            const agentId = params.agentId || 'unknown';
            const reason = params.reason || 'Checkpoint requested';
            const options = params.options || [];

            const checkpoint = {
              id: checkpointId,
              agentId,
              reason,
              options,
              scope,
              state: 'pending',
              createdAt: Date.now(),
              resolvedAt: null,
              resolution: null,
            };

            // Persist to DomainStore
            if (store?.set) {
              await store.set(checkpointId, checkpoint);
            }

            // Emit field signal for checkpoint creation
            core?.field?.emit?.('checkpoint.created', {
              checkpointId,
              agentId,
              scope,
              timestamp: checkpoint.createdAt,
            });

            // Track in quality system
            quality?.recordCheckpoint?.(checkpointId, agentId, reason);

            return toolResponse({
              status: 'checkpoint_created',
              checkpointId,
              agentId,
              reason,
              options,
              instruction: 'STOP - Agent must pause and await user resolution',
            });
          }

          case 'resolve': {
            const { checkpointId, resolution } = params;
            if (!checkpointId) {
              return errorResponse('checkpointId is required for resolve action');
            }
            if (!resolution) {
              return errorResponse('resolution is required for resolve action');
            }

            // Retrieve checkpoint
            let checkpoint = store?.get ? await store.get(checkpointId) : null;

            if (!checkpoint) {
              return errorResponse(`Checkpoint ${checkpointId} not found`);
            }

            if (checkpoint.state === 'resolved') {
              return toolResponse({
                status: 'already_resolved',
                checkpointId,
                resolvedAt: checkpoint.resolvedAt,
                resolution: checkpoint.resolution,
              });
            }

            // Update checkpoint state
            checkpoint.state = 'resolved';
            checkpoint.resolution = resolution;
            checkpoint.resolvedAt = Date.now();

            if (store?.set) {
              await store.set(checkpointId, checkpoint);
            }

            // Emit field signal for resolution
            core?.field?.emit?.('checkpoint.resolved', {
              checkpointId,
              agentId: checkpoint.agentId,
              resolution,
              scope,
              timestamp: checkpoint.resolvedAt,
            });

            // Resume the paused agent with the resolution
            let resumed = false;
            if (checkpoint.agentId && checkpoint.agentId !== 'unknown') {
              if (spawnClient?.resume) {
                try {
                  await spawnClient.resume(checkpoint.agentId, {
                    checkpointId,
                    resolution,
                  });
                  resumed = true;
                } catch (resumeErr) {
                  // Agent may have timed out or been cancelled
                }
              }

              // Also notify via communication bus
              core?.communication?.send?.({
                id: `cp-resolve-${Date.now()}`,
                from: 'orchestrator',
                to: checkpoint.agentId,
                content: JSON.stringify({
                  type: 'checkpoint_resolved',
                  checkpointId,
                  resolution,
                }),
                priority: 8,
                timestamp: Date.now(),
              });
            }

            return toolResponse({
              status: 'resolved',
              checkpointId,
              agentId: checkpoint.agentId,
              resolution,
              agentResumed: resumed,
              resolvedAt: checkpoint.resolvedAt,
            });
          }

          case 'list': {
            let checkpoints = [];

            if (store?.getAll) {
              const all = await store.getAll();
              checkpoints = (Array.isArray(all) ? all : Object.values(all || {}))
                .filter(cp => cp.state === 'pending')
                .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
            }

            return toolResponse({
              status: 'ok',
              scope,
              count: checkpoints.length,
              checkpoints: checkpoints.map(cp => ({
                id: cp.id,
                agentId: cp.agentId,
                reason: cp.reason,
                options: cp.options || [],
                createdAt: cp.createdAt,
                age: Date.now() - (cp.createdAt || Date.now()),
              })),
            });
          }

          default:
            return errorResponse(`Unknown checkpoint action: ${action}`);
        }
      } catch (err) {
        return errorResponse(`swarm_checkpoint execution failed: ${err.message}`);
      }
    },
  };
}
