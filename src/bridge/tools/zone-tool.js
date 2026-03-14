// R8 Bridge - swarm_zone tool
// File/resource zone management: detect, lock, unlock, list

function toolResponse(data) {
  return { content: [{ type: 'text', text: JSON.stringify(data) }] };
}

function errorResponse(error) {
  return toolResponse({ status: 'error', error: String(error) });
}

/**
 * createZoneTool - Factory for the swarm_zone tool
 *
 * Manages exclusive access zones for files and resources.
 * Prevents concurrent agents from conflicting on the same
 * files by providing distributed locking.
 *
 * Actions:
 *   detect - Detect which zone a path belongs to
 *   lock   - Acquire exclusive lock on a zone/path
 *   unlock - Release a previously acquired lock
 *   list   - List all active zone locks
 *
 * Dependencies:
 *   core.orchestration - ZoneManager for lock coordination
 *   core.field         - Signal emission for zone events
 */
export function createZoneTool({ core, quality, sessionBridge, spawnClient }) {
  return {
    name: 'swarm_zone',

    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['detect', 'lock', 'unlock', 'list'],
          description: 'Zone action to perform',
        },
        path: {
          type: 'string',
          description: 'File or directory path (for detect/lock/unlock)',
        },
        agentId: {
          type: 'string',
          description: 'Agent requesting the lock (for lock/unlock)',
        },
        reason: {
          type: 'string',
          description: 'Reason for acquiring the lock (for lock)',
        },
        force: {
          type: 'boolean',
          description: 'Force unlock even if held by another agent (for unlock)',
        },
      },
      required: ['action'],
    },

    async execute(toolCallId, params) {
      try {
        const { action } = params;
        const scope = sessionBridge?.getCurrentScope?.() ?? 'default';
        const zoneManager = core?.orchestration?.zoneManager;

        switch (action) {
          case 'detect': {
            const { path } = params;
            if (!path) {
              return errorResponse('path is required for detect action');
            }

            let zone = null;
            if (zoneManager?.detect) {
              zone = await zoneManager.detect(path);
            } else if (zoneManager?.getZoneForPath) {
              zone = await zoneManager.getZoneForPath(path);
            }

            if (!zone) {
              // Fallback: derive zone from path structure
              const parts = path.replace(/\\/g, '/').split('/').filter(Boolean);
              const zoneId = parts.length >= 2
                ? `zone-${parts.slice(0, 2).join('-')}`
                : `zone-${parts[0] || 'root'}`;

              zone = {
                id: zoneId,
                path,
                locked: false,
                lockedBy: null,
                derived: true,
              };
            }

            return toolResponse({
              status: 'ok',
              action: 'detect',
              path,
              zone: {
                id: zone.id,
                locked: zone.locked || false,
                lockedBy: zone.lockedBy || null,
                lockedAt: zone.lockedAt || null,
                reason: zone.reason || null,
              },
            });
          }

          case 'lock': {
            const { path, agentId, reason } = params;
            if (!path) {
              return errorResponse('path is required for lock action');
            }

            const lockId = `lock-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
            const lockRequest = {
              id: lockId,
              path,
              agentId: agentId || 'bridge',
              reason: reason || 'Exclusive access requested',
              scope,
              requestedAt: Date.now(),
            };

            let result;
            if (zoneManager?.lock) {
              result = await zoneManager.lock(lockRequest);
            } else if (zoneManager?.acquireLock) {
              result = await zoneManager.acquireLock(lockRequest);
            } else {
              // Fallback: optimistic lock
              result = {
                granted: true,
                lockId,
                warning: 'ZoneManager not available, lock is advisory only',
              };
            }

            if (result?.granted) {
              // Emit field signal
              core?.field?.emit?.('zone.locked', {
                lockId: result.lockId || lockId,
                path,
                agentId: lockRequest.agentId,
                scope,
                timestamp: Date.now(),
              });

              return toolResponse({
                status: 'locked',
                lockId: result.lockId || lockId,
                path,
                agentId: lockRequest.agentId,
                reason: lockRequest.reason,
                warning: result.warning || null,
              });
            }

            return toolResponse({
              status: 'denied',
              path,
              heldBy: result?.heldBy || 'unknown',
              heldSince: result?.heldSince || null,
              reason: result?.denyReason || 'Zone is already locked by another agent',
            });
          }

          case 'unlock': {
            const { path, agentId, force } = params;
            if (!path) {
              return errorResponse('path is required for unlock action');
            }

            const unlockRequest = {
              path,
              agentId: agentId || 'bridge',
              force: force || false,
              scope,
            };

            let result;
            if (zoneManager?.unlock) {
              result = await zoneManager.unlock(unlockRequest);
            } else if (zoneManager?.releaseLock) {
              result = await zoneManager.releaseLock(unlockRequest);
            } else {
              result = {
                released: true,
                warning: 'ZoneManager not available, unlock is advisory only',
              };
            }

            if (result?.released) {
              // Emit field signal
              core?.field?.emit?.('zone.unlocked', {
                path,
                agentId: unlockRequest.agentId,
                forced: unlockRequest.force,
                scope,
                timestamp: Date.now(),
              });

              return toolResponse({
                status: 'unlocked',
                path,
                agentId: unlockRequest.agentId,
                forced: unlockRequest.force,
                warning: result.warning || null,
              });
            }

            return toolResponse({
              status: 'unlock_failed',
              path,
              reason: result?.reason || 'Unable to release lock',
              heldBy: result?.heldBy || 'unknown',
            });
          }

          case 'list': {
            let locks = [];

            if (zoneManager?.listLocks) {
              locks = await zoneManager.listLocks({ scope });
            } else if (zoneManager?.getActiveLocks) {
              locks = await zoneManager.getActiveLocks({ scope });
            }

            return toolResponse({
              status: 'ok',
              action: 'list',
              scope,
              count: locks.length,
              locks: (Array.isArray(locks) ? locks : []).map(l => ({
                lockId: l.lockId || l.id,
                path: l.path,
                agentId: l.agentId,
                reason: l.reason || '',
                lockedAt: l.lockedAt || l.requestedAt,
                age: Date.now() - (l.lockedAt || l.requestedAt || Date.now()),
              })),
            });
          }

          default:
            return errorResponse(`Unknown zone action: ${action}`);
        }
      } catch (err) {
        return errorResponse(`swarm_zone execution failed: ${err.message}`);
      }
    },
  };
}
