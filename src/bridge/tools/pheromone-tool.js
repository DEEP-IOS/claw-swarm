// R8 Bridge - swarm_pheromone tool
// Stigmergic communication: deposit, read, types, stats

function toolResponse(data) {
  return { content: [{ type: 'text', text: JSON.stringify(data) }] };
}

function errorResponse(error) {
  return toolResponse({ status: 'error', error: String(error) });
}

/**
 * Known pheromone types and their default decay rates
 */
const PHEROMONE_TYPES = {
  progress:      { decay: 0.05, description: 'Task progress signals' },
  warning:       { decay: 0.1,  description: 'Risk or issue warnings' },
  success:       { decay: 0.03, description: 'Successful completion markers' },
  failure:       { decay: 0.15, description: 'Failure indicators' },
  discovery:     { decay: 0.02, description: 'New information found' },
  dependency:    { decay: 0.01, description: 'Dependency relationships' },
  collaboration: { decay: 0.04, description: 'Collaboration opportunities' },
  conflict:      { decay: 0.08, description: 'Resource or zone conflicts' },
  dispatch:      { decay: 0.1,  description: 'Message dispatch trails' },
  checkpoint:    { decay: 0.02, description: 'Checkpoint markers' },
};

/**
 * createPheromoneTool - Factory for the swarm_pheromone tool
 *
 * Provides stigmergic communication via pheromone trails.
 * Agents deposit signals that others can read, enabling
 * indirect coordination without direct messaging.
 *
 * Actions:
 *   deposit - Leave a pheromone trail at a scope
 *   read    - Read active pheromone trails at a scope
 *   types   - List all known pheromone types
 *   stats   - Get pheromone system statistics
 *
 * Dependencies:
 *   core.communication - PheromoneGrid for deposit/read
 *   core.field         - Signal emission for pheromone events
 */
export function createPheromoneTool({ core, quality, sessionBridge, spawnClient }) {
  return {
    name: 'swarm_pheromone',

    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['deposit', 'read', 'types', 'stats'],
          description: 'Pheromone action to perform',
        },
        type: {
          type: 'string',
          description: 'Pheromone type (e.g., progress, warning, success, failure)',
        },
        scope: {
          type: 'string',
          description: 'Scope/location for the pheromone trail',
        },
        intensity: {
          type: 'number',
          description: 'Signal intensity from 0.0 to 1.0 (default: 0.5)',
        },
        metadata: {
          type: 'object',
          additionalProperties: true,
          description: 'Additional metadata to attach to the pheromone',
        },
        message: {
          type: 'string',
          description: 'Human-readable message for the pheromone trail',
        },
      },
      required: ['action'],
    },

    async execute(toolCallId, params) {
      try {
        const { action } = params;
        const sessionScope = sessionBridge?.getCurrentScope?.() ?? 'default';
        const pheromone = core?.communication?.pheromone || core?.communication;

        switch (action) {
          case 'deposit': {
            const { type, scope, intensity, metadata, message } = params;
            if (!type) {
              return errorResponse('type is required for deposit action');
            }

            const trailScope = scope || sessionScope;
            const trailIntensity = typeof intensity === 'number'
              ? Math.max(0, Math.min(1, intensity))
              : 0.5;

            const trailId = `ph-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
            const typeInfo = PHEROMONE_TYPES[type] || { decay: 0.05, description: 'Custom type' };

            const trail = {
              id: trailId,
              type,
              scope: trailScope,
              intensity: trailIntensity,
              decay: typeInfo.decay,
              metadata: metadata || {},
              message: message || '',
              depositor: 'bridge',
              depositedAt: Date.now(),
            };

            if (pheromone?.deposit) {
              await pheromone.deposit(trail);
            } else if (core?.communication?.depositPheromone) {
              await core.communication.depositPheromone(trail);
            }

            // Emit field signal
            core?.field?.emit?.('pheromone.deposited', {
              trailId,
              type,
              scope: trailScope,
              intensity: trailIntensity,
              timestamp: trail.depositedAt,
            });

            return toolResponse({
              status: 'deposited',
              trailId,
              type,
              scope: trailScope,
              intensity: trailIntensity,
              decay: typeInfo.decay,
            });
          }

          case 'read': {
            const { type, scope } = params;
            const readScope = scope || sessionScope;
            let trails = [];

            if (pheromone?.read) {
              trails = await pheromone.read({ type, scope: readScope });
            } else if (core?.communication?.readPheromones) {
              trails = await core.communication.readPheromones({ type, scope: readScope });
            } else if (core?.communication?.getPheromoneState) {
              const state = core.communication.getPheromoneState();
              trails = (state?.trails || []).filter(t => {
                if (type && t.type !== type) return false;
                if (readScope && t.scope !== readScope) return false;
                return true;
              });
            }

            return toolResponse({
              status: 'ok',
              action: 'read',
              scope: readScope,
              typeFilter: type || 'all',
              count: trails.length,
              trails: (Array.isArray(trails) ? trails : []).slice(0, 50).map(t => ({
                id: t.id,
                type: t.type,
                scope: t.scope,
                intensity: t.intensity,
                message: t.message || '',
                depositor: t.depositor,
                depositedAt: t.depositedAt,
                age: Date.now() - (t.depositedAt || Date.now()),
              })),
            });
          }

          case 'types': {
            const types = Object.entries(PHEROMONE_TYPES).map(([name, info]) => ({
              name,
              decay: info.decay,
              description: info.description,
            }));

            return toolResponse({
              status: 'ok',
              action: 'types',
              count: types.length,
              types,
            });
          }

          case 'stats': {
            let stats = {
              totalActive: 0,
              byType: {},
              averageIntensity: 0,
              oldestTrail: null,
            };

            if (pheromone?.getStats) {
              stats = await pheromone.getStats({ scope: sessionScope });
            } else if (core?.communication?.getPheromoneState) {
              const state = core.communication.getPheromoneState();
              const trails = state?.trails || [];
              const byType = {};
              let totalIntensity = 0;

              for (const t of trails) {
                byType[t.type] = (byType[t.type] || 0) + 1;
                totalIntensity += t.intensity || 0;
              }

              stats = {
                totalActive: trails.length,
                byType,
                averageIntensity: trails.length > 0 ? totalIntensity / trails.length : 0,
                oldestTrail: trails.length > 0
                  ? Math.min(...trails.map(t => t.depositedAt || Date.now()))
                  : null,
              };
            }

            return toolResponse({
              status: 'ok',
              action: 'stats',
              scope: sessionScope,
              totalActive: stats.totalActive || 0,
              byType: stats.byType || {},
              averageIntensity: stats.averageIntensity || 0,
              oldestTrail: stats.oldestTrail,
            });
          }

          default:
            return errorResponse(`Unknown pheromone action: ${action}`);
        }
      } catch (err) {
        return errorResponse(`swarm_pheromone execution failed: ${err.message}`);
      }
    },
  };
}
