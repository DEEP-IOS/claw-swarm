// R8 Bridge - swarm_pheromone tool
// Stigmergic communication: deposit, read, types, stats

function toolResponse(data) {
  return { content: [{ type: 'text', text: JSON.stringify(data) }] };
}

function errorResponse(error) {
  return toolResponse({ status: 'error', error: String(error) });
}

function extractTrailsFromState(state, type, scope) {
  const trails = Array.isArray(state?.trails) ? state.trails : [];
  return trails.filter((trail) => {
    if (type && trail.type !== type && trail.canonicalType !== type) return false;
    if (scope && trail.scope !== scope) return false;
    return true;
  });
}

function legacySignalToTrail(signal, type) {
  const metadata = signal?.metadata || {};
  return {
    id: signal?.id,
    type: metadata.aliasType || metadata.pheromoneType || type,
    canonicalType: metadata.pheromoneType || type,
    scope: signal?.scope,
    intensity: signal?._actualStrength ?? signal?.strength ?? 0,
    message: metadata.message || '',
    depositor: signal?.emitterId,
    depositedAt: signal?.emitTime,
    age: Math.max(0, Date.now() - (signal?.emitTime || Date.now())),
  };
}

const LEGACY_TYPE_ALIASES = Object.freeze({
  progress: 'trail',
  dependency: 'trail',
  success: 'food',
  warning: 'alarm',
  failure: 'alarm',
  conflict: 'alarm',
  collaboration: 'recruit',
  dispatch: 'recruit',
  checkpoint: 'queen',
  discovery: 'dance',
});

const CANONICAL_TYPE_FALLBACK = Object.freeze({
  trail:   { lambda: 0.008, description: 'Path / progress trails', fieldDim: 'trail', minBound: 0.01, maxBound: 1.0 },
  alarm:   { lambda: 0.15,  description: 'Alarm / anomaly signals', fieldDim: 'alarm', minBound: 0.01, maxBound: 1.0 },
  recruit: { lambda: 0.03,  description: 'Recruitment / assistance requests', fieldDim: 'coordination', minBound: 0.01, maxBound: 1.0 },
  queen:   { lambda: 0.005, description: 'Global directive signals', fieldDim: 'coordination', minBound: 0.01, maxBound: 1.0 },
  dance:   { lambda: 0.02,  description: 'Knowledge discovery signals', fieldDim: 'knowledge', minBound: 0.01, maxBound: 1.0 },
  food:    { lambda: 0.006, description: 'High-quality outcome markers', fieldDim: 'trail', minBound: 0.01, maxBound: 1.0 },
});

function getCanonicalTypeDetails(communication) {
  const registry = communication?.typeRegistry;
  const canonicalTypes = registry?.list?.() ?? Object.keys(CANONICAL_TYPE_FALLBACK);

  return canonicalTypes.map((name) => {
    const info = registry?.get?.(name) ?? CANONICAL_TYPE_FALLBACK[name] ?? {};
    const aliases = Object.entries(LEGACY_TYPE_ALIASES)
      .filter(([, canonical]) => canonical === name)
      .map(([alias]) => alias);

    return {
      name,
      decay: info.lambda ?? info.decay ?? 0.05,
      description: info.description ?? '',
      fieldDim: info.fieldDim ?? null,
      minBound: info.minBound ?? null,
      maxBound: info.maxBound ?? null,
      aliases,
    };
  });
}

function resolvePheromoneType(type, communication) {
  const registry = communication?.typeRegistry;
  const canonicalTypes = new Set(registry?.list?.() ?? Object.keys(CANONICAL_TYPE_FALLBACK));

  if (canonicalTypes.has(type)) {
    return { requestedType: type, canonicalType: type };
  }

  const canonicalType = LEGACY_TYPE_ALIASES[type];
  if (canonicalType && canonicalTypes.has(canonicalType)) {
    return { requestedType: type, canonicalType };
  }

  const supported = [...canonicalTypes].join(', ');
  return {
    error: `Unsupported pheromone type "${type}". Supported canonical types: ${supported}`,
  };
}

async function depositTrail(communication, trail) {
  if (communication?.depositPheromone) {
    return communication.depositPheromone(trail);
  }

  const metadata = { ...(trail.metadata || {}) };
  if (trail.message) metadata.message = trail.message;

  if (communication?.pheromone?.deposit) {
    return communication.pheromone.deposit(
      trail.type,
      trail.scope,
      trail.intensity,
      metadata,
      trail.depositor || 'bridge',
    );
  }

  if (communication?.deposit) {
    return communication.deposit(
      trail.type,
      trail.scope,
      trail.intensity,
      metadata,
      trail.depositor || 'bridge',
    );
  }

  return null;
}

async function readTrails(communication, query) {
  const resolvedType = query.type ? resolvePheromoneType(query.type, communication) : null;
  if (query.type && resolvedType?.error) {
    return [];
  }

  const requestedType = resolvedType?.requestedType ?? query.type;
  const canonicalType = resolvedType?.canonicalType ?? query.type;

  if (communication?.readPheromones) {
    return communication.readPheromones({
      ...query,
      type: requestedType,
      canonicalType,
    });
  }

  if (communication?.pheromone?.read && canonicalType) {
    return communication.pheromone
      .read(canonicalType, query.scope)
      .map((signal) => legacySignalToTrail(signal, canonicalType))
      .filter((trail) => {
        if (!requestedType) return true;
        return trail.type === requestedType || trail.canonicalType === requestedType;
      });
  }

  return extractTrailsFromState(communication?.getPheromoneState?.(query.scope), requestedType || canonicalType, query.scope);
}

function buildStatsFromTrails(trails) {
  const byType = {};
  let totalIntensity = 0;

  for (const trail of trails) {
    byType[trail.type] = (byType[trail.type] || 0) + 1;
    totalIntensity += trail.intensity || 0;
  }

  return {
    totalActive: trails.length,
    byType,
    averageIntensity: trails.length > 0 ? totalIntensity / trails.length : 0,
    oldestTrail: trails.length > 0
      ? Math.min(...trails.map(t => t.depositedAt || Date.now()))
      : null,
  };
}

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
    description: [
      'Pheromone-based indirect communication between agents.',
      'Deposit or read signal trails to coordinate without direct messaging.',
      '',
      'Types: trail (progress), food (success), alarm (warning),',
      '  queen (checkpoint), recruit (collaboration), dance (discovery).',
      '',
      'Actions:',
      '  deposit — Leave a pheromone signal',
      '  read — Read pheromones at a scope/location',
      '  types — List available pheromone types',
      '  stats — Pheromone grid statistics',
    ].join('\n'),

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
          description: 'Canonical pheromone type or supported legacy alias',
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
        const communication = core?.communication;

        switch (action) {
          case 'deposit': {
            const { type, scope, intensity, metadata, message } = params;
            if (!type) {
              return errorResponse('type is required for deposit action');
            }

            const resolvedType = resolvePheromoneType(type, communication);
            if (resolvedType?.error) {
              return errorResponse(resolvedType.error);
            }

            const trailScope = scope || sessionScope;
            const trailIntensity = typeof intensity === 'number'
              ? Math.max(0, Math.min(1, intensity))
              : 0.5;

            const trailId = `ph-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
            const typeInfo = communication?.typeRegistry?.get?.(resolvedType.canonicalType)
              ?? CANONICAL_TYPE_FALLBACK[resolvedType.canonicalType]
              ?? { lambda: 0.05, description: 'Canonical pheromone type' };

            const trail = {
              id: trailId,
              type: resolvedType.requestedType,
              canonicalType: resolvedType.canonicalType,
              scope: trailScope,
              intensity: trailIntensity,
              decay: typeInfo.lambda ?? typeInfo.decay ?? 0.05,
              metadata: metadata || {},
              message: message || '',
              depositor: 'bridge',
              depositedAt: Date.now(),
            };

            await depositTrail(communication, trail);

            core?.bus?.publish?.('pheromone.deposited', {
              trailId,
              type,
              scope: trailScope,
              intensity: trailIntensity,
              timestamp: trail.depositedAt,
            }, 'swarm-pheromone');

            return toolResponse({
              status: 'deposited',
              trailId,
              type: resolvedType.requestedType,
              canonicalType: resolvedType.canonicalType,
              scope: trailScope,
              intensity: trailIntensity,
              decay: typeInfo.lambda ?? typeInfo.decay ?? 0.05,
            });
          }

          case 'read': {
            const { type, scope } = params;
            const readScope = scope || sessionScope;
            const trails = await readTrails(communication, { type, scope: readScope });

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
            const types = getCanonicalTypeDetails(communication);

            return toolResponse({
              status: 'ok',
              action: 'types',
              count: types.length,
              types,
            });
          }

          case 'stats': {
            const state = communication?.getPheromoneState?.(sessionScope);
            const stats = Array.isArray(state?.trails)
              ? buildStatsFromTrails(state.trails)
              : buildStatsFromTrails(await readTrails(communication, { scope: sessionScope }));

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
