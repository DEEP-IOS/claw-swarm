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
      cancelDAG: vi.fn(() => ({ cancelled: 1, alreadyDone: 0 })),
      createDAG: () => ({ success: true, rootId: 'phase-1' }),
      claimReadyNodes: () => [],
      transitionState: () => {},
      completeNode: () => {},
      failNode: () => {},
      getNode: () => null,
    },
    relayClient: {
      _parentSessionKey: 'agent:main:stress',
      listActiveSessions: vi.fn(async () => ({ sessions: [] })),
      endSession: vi.fn(async () => ({ status: 'ended', deleted: true })),
      getRelayModel: () => undefined,
      spawnAndMonitor: async () => ({ status: 'spawned', childSessionKey: 'agent:mpu-d3:subagent:x', runId: 'run-x' }),
    },
    ...overrides,
  };
}

function makeTool(engines) {
  return createRunTool({ engines, logger: silentLogger });
}

describe('stress: release reliability matrix', () => {
  it('concurrency: 32 parallel cancel requests remain stable', async () => {
    const sessions = Array.from({ length: 32 }).map((_, i) => ({
      key: `agent:mpu-d3:subagent:${i}`,
      label: `swarm:task-par-${i}:mpu-d3:dag-par:phase-${i}`,
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

    const tool = makeTool(engines);
    const started = Date.now();
    const results = await Promise.all(
      Array.from({ length: 32 }).map((_, i) => tool.handler({ mode: 'cancel', taskId: `task-par-${i}` }))
    );
    const elapsed = Date.now() - started;

    expect(results.every((r) => r.success === true)).toBe(true);
    expect(results.every((r) => r.sessionsEnded === 1)).toBe(true);
    expect(elapsed).toBeLessThan(5000);
  });

  it('long-stability: 200 sequential cancel cycles do not degrade', async () => {
    const engines = createEngines({
      relayClient: {
        _parentSessionKey: 'agent:main:stress',
        listActiveSessions: vi.fn(async () => ({ sessions: [] })),
        endSession: vi.fn(async () => ({ status: 'ended', deleted: true })),
        getRelayModel: () => undefined,
        spawnAndMonitor: async () => ({ status: 'spawned', childSessionKey: 'agent:mpu-d3:subagent:x', runId: 'run-x' }),
      },
    });

    const tool = makeTool(engines);

    for (let i = 0; i < 200; i += 1) {
      const res = await tool.handler({ mode: 'cancel', dagId: `dag-long-${i}` });
      expect(res.success).toBe(true);
      expect(res.cancelled).toBe(true);
    }
  });

  it('resource ceiling: scans 1000 sessions and terminates only matched subset', async () => {
    const sessions = Array.from({ length: 1000 }).map((_, i) => {
      const isTarget = i % 40 === 0;
      return {
        key: `agent:mpu-d2:subagent:${i}`,
        label: isTarget
          ? `swarm:task-cap-${i}:mpu-d2:dag-ceiling:phase-${i}`
          : `swarm:task-other-${i}:mpu-d2:dag-other:phase-${i}`,
        spawnedBy: 'agent:main:stress',
      };
    });

    const engines = createEngines({
      relayClient: {
        _parentSessionKey: 'agent:main:stress',
        listActiveSessions: vi.fn(async () => ({ sessions })),
        endSession: vi.fn(async () => ({ status: 'ended', deleted: true })),
        getRelayModel: () => undefined,
        spawnAndMonitor: async () => ({ status: 'spawned', childSessionKey: 'agent:mpu-d3:subagent:x', runId: 'run-x' }),
      },
    });

    const tool = makeTool(engines);
    const started = Date.now();
    const res = await tool.handler({ mode: 'cancel', dagId: 'dag-ceiling' });
    const elapsed = Date.now() - started;

    expect(res.success).toBe(true);
    expect(res.sessionsMatched).toBe(25);
    expect(res.sessionsEnded).toBe(25);
    expect(engines.relayClient.endSession).toHaveBeenCalledTimes(25);
    expect(elapsed).toBeLessThan(8000);
  });
});
