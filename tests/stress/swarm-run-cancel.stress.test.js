import { describe, it, expect, vi } from 'vitest';
import { createRunTool } from '../../src/L5-application/tools/swarm-run-tool.js';

const silentLogger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

function createEngines(overrides = {}) {
  return {
    executionPlanner: {
      planExecution: () => ({ roles: [{ role: 'developer', confidence: 0.9 }], fallback: false }),
      generatePlan: () => ({ id: 'plan-stress', phases: [{ order: 1, roleName: 'developer', description: 'Build' }] }),
      savePlan: () => {},
      getPlanById: () => null,
    },
    roleManager: { recommendRoles: () => ['developer'] },
    agentRepo: { createAgent: () => {}, incrementTaskCount: () => {}, listByCapabilities: () => [] },
    taskRepo: { createTask: () => {}, updateTaskStatus: () => {}, listTasks: () => [] },
    pheromoneEngine: { emitPheromone: () => {} },
    contractNet: null,
    skillGovernor: null,
    dualProcessRouter: null,
    speculativeExecutor: null,
    dagEngine: {
      cancelDAG: vi.fn(() => ({ cancelled: 3, alreadyDone: 0 })),
      createDAG: () => ({ success: true, rootId: 'phase-1' }),
      claimReadyNodes: () => [],
      transitionState: () => {},
      completeNode: () => {},
      failNode: () => {},
      getNode: () => null,
    },
    relayClient: {
      _parentSessionKey: 'agent:main:stress',
      listActiveSessions: vi.fn(() => ({ sessions: [] })),
      endSession: vi.fn(async () => ({ status: 'ended', deleted: true })),
      getRelayModel: () => undefined,
      spawnAndMonitor: async () => ({ status: 'spawned', childSessionKey: 'agent:mpu-d3:subagent:x', runId: 'run-x' }),
    },
    ...overrides,
  };
}

describe('stress: swarm_run cancel path', () => {
  it('terminates large matched subagent set within bounded time', async () => {
    const sessions = Array.from({ length: 240 }).map((_, i) => ({
      key: `agent:mpu-d3:subagent:${i}`,
      label: `swarm:task-stress:mpu-d3:dag-stress:phase-${i}`,
      spawnedBy: 'agent:main:stress',
    }));

    const engines = createEngines({
      relayClient: {
        _parentSessionKey: 'agent:main:stress',
        listActiveSessions: vi.fn(async () => ({ sessions })),
        endSession: vi.fn(async () => ({ status: 'ended', deleted: true })),
        getRelayModel: () => undefined,
        spawnAndMonitor: async () => ({ status: 'spawned', childSessionKey: 'agent:mpu-d3:subagent:x', runId: 'run-x' }),
      },
    });

    const tool = createRunTool({ engines, logger: silentLogger });

    const started = Date.now();
    const res = await tool.handler({ mode: 'cancel', taskId: 'task-stress' });
    const elapsed = Date.now() - started;

    expect(res.success).toBe(true);
    expect(res.cancelled).toBe(true);
    expect(res.sessionsMatched).toBe(240);
    expect(res.sessionsEnded).toBe(240);
    expect(elapsed).toBeLessThan(6000);
  });

  it('fails gate when sessions are matched but termination fails', async () => {
    const sessions = [
      {
        key: 'agent:mpu-d2:subagent:dead',
        label: 'swarm:task-fail:mpu-d2:dag-fail:phase-1',
        spawnedBy: 'agent:main:stress',
      },
    ];

    const engines = createEngines({
      relayClient: {
        _parentSessionKey: 'agent:main:stress',
        listActiveSessions: vi.fn(async () => ({ sessions })),
        endSession: vi.fn(async () => ({ status: 'end_failed', error: 'permission denied' })),
        getRelayModel: () => undefined,
        spawnAndMonitor: async () => ({ status: 'spawned', childSessionKey: 'agent:mpu-d3:subagent:x', runId: 'run-x' }),
      },
    });

    const tool = createRunTool({ engines, logger: silentLogger });

    const res = await tool.handler({ mode: 'cancel', taskId: 'task-fail' });
    expect(res.success).toBe(false);
    expect(res.cancelled).toBe(false);
    expect(res.sessionsMatched).toBe(1);
    expect(res.sessionsEnded).toBe(0);
    expect(Array.isArray(res.sessionEndErrors)).toBe(true);
  });
});
