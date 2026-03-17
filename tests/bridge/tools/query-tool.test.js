import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createQueryTool } from '../../../src/bridge/tools/query-tool.js';

// ─── Helpers ──────────────────────────────────────────────────────────

function parse(resp) {
  return JSON.parse(resp.content[0].text);
}

function makeDeps() {
  return {
    core: {
      intelligence: {
        getActiveAgents: vi.fn(() => [
          { id: 'a1', role: 'impl', state: 'running', elapsed: 5000, model: 'balanced', dagId: 'd1', startedAt: 0, tokensUsed: 100 },
        ]),
        getReputation: vi.fn(() => ({ globalScore: 0.8, agents: [{ id: 'a1', role: 'impl', score: 0.9, tasksCompleted: 5, failureRate: 0.1 }] })),
        searchMemory: vi.fn(() => [{ id: 'm1', type: 'fact', content: 'test', relevance: 0.95, createdAt: 0, source: 'bridge' }]),
        getArtifacts: vi.fn(() => [{ id: 'art1', type: 'file', name: 'out.js', path: '/out.js', size: 123, createdAt: 0, producedBy: 'a1' }]),
      },
      orchestration: {
        getDAG: vi.fn(() => ({
          nodes: [{ id: 'n1' }],
          edges: [],
          state: 'running',
          createdAt: 0,
          summary: 'plan',
        })),
        getBudget: vi.fn(() => ({ used: 100, limit: 1000, byModel: { balanced: 100 }, byRole: { impl: 100 }, currency: 'tokens' })),
        getProgress: vi.fn(() => ({ completedNodes: 1, totalNodes: 2, percentage: 50, state: 'running', elapsed: 3000, remainingBudget: 900, blockers: [] })),
      },
      communication: {
        getPheromoneState: vi.fn(() => ({
          trails: [{ type: 'progress', scope: 's', intensity: 0.5, age: 1000, depositor: 'a1' }],
          activeTypes: ['progress'],
          totalDeposits: 1,
        })),
      },
      field: {
        superpose: vi.fn(() => ({
          dimensions: { urgency: { value: 0.5, confidence: 0.8, contributors: 2 } },
          coherence: 0.7,
          lastUpdate: Date.now(),
          totalSignals: 10,
        })),
      },
    },
    quality: {
      getActivePipelines: vi.fn(() => [{ id: 'p1' }]),
      getPipelineProgress: vi.fn(() => null),
    },
    sessionBridge: {},
    spawnClient: {},
  };
}

// ─── Tests ────────────────────────────────────────────────────────────

describe('createQueryTool (swarm_query)', () => {
  let deps;
  let tool;

  beforeEach(() => {
    deps = makeDeps();
    tool = createQueryTool(deps);
  });

  describe('tool structure', () => {
    it('returns object with correct name', () => {
      expect(tool.name).toBe('swarm_query');
    });

    it('parameters has scope as required', () => {
      expect(tool.parameters.type).toBe('object');
      expect(tool.parameters.required).toContain('scope');
    });

    it('scope enum lists 10 values', () => {
      expect(tool.parameters.properties.scope.enum).toHaveLength(10);
    });
  });

  // ── 10 scope handlers ───────────────────────────────────────────────

  describe('scope: status', () => {
    it('returns activeAgents count and field summary', async () => {
      const data = parse(await tool.execute('q1', { scope: 'status' }));
      expect(data.scope).toBe('status');
      expect(data.activeAgents).toBe(1);
      expect(data.field).toBeDefined();
    });
  });

  describe('scope: plan', () => {
    it('returns plan details when dagId is provided', async () => {
      const data = parse(await tool.execute('q2', { scope: 'plan', dagId: 'd1' }));
      expect(data.scope).toBe('plan');
      expect(data.found).toBe(true);
    });

    it('returns error when dagId is missing', async () => {
      const data = parse(await tool.execute('q3', { scope: 'plan' }));
      expect(data.status).toBe('error');
    });
  });

  describe('scope: agents', () => {
    it('returns agent list with details', async () => {
      const data = parse(await tool.execute('q4', { scope: 'agents' }));
      expect(data.scope).toBe('agents');
      expect(data.count).toBe(1);
      expect(data.agents[0].id).toBe('a1');
    });
  });

  describe('scope: pheromones', () => {
    it('returns pheromone trails', async () => {
      const data = parse(await tool.execute('q5', { scope: 'pheromones' }));
      expect(data.scope).toBe('pheromones');
      expect(data.totalDeposits).toBe(1);
    });
  });

  describe('scope: reputation', () => {
    it('returns global score and agent scores', async () => {
      const data = parse(await tool.execute('q6', { scope: 'reputation' }));
      expect(data.scope).toBe('reputation');
      expect(data.globalScore).toBe(0.8);
    });
  });

  describe('scope: memory', () => {
    it('returns memory search results', async () => {
      const data = parse(await tool.execute('q7', { scope: 'memory', query: 'test' }));
      expect(data.scope).toBe('memory');
      expect(data.count).toBe(1);
    });

    it('returns error when query is missing', async () => {
      const data = parse(await tool.execute('q8', { scope: 'memory' }));
      expect(data.status).toBe('error');
    });
  });

  describe('scope: progress', () => {
    it('returns progress data for a dagId', async () => {
      const data = parse(await tool.execute('q9', { scope: 'progress', dagId: 'd1' }));
      expect(data.scope).toBe('progress');
      expect(data.percentage).toBe(50);
    });
  });

  describe('scope: cost', () => {
    it('returns budget information', async () => {
      const data = parse(await tool.execute('q10', { scope: 'cost' }));
      expect(data.scope).toBe('cost');
      expect(data.totalUsed).toBe(100);
      expect(data.remaining).toBe(900);
    });
  });

  describe('scope: artifacts', () => {
    it('returns artifact list for dagId', async () => {
      const data = parse(await tool.execute('q11', { scope: 'artifacts', dagId: 'd1' }));
      expect(data.scope).toBe('artifacts');
      expect(data.count).toBe(1);
    });
  });

  describe('scope: field', () => {
    it('returns 12-dimension field superposition', async () => {
      const data = parse(await tool.execute('q12', { scope: 'field' }));
      expect(data.scope).toBe('field');
      expect(data.dimensions).toBeDefined();
      expect(data.coherence).toBe(0.7);
    });
  });

  // ── Error cases ─────────────────────────────────────────────────────

  describe('error handling', () => {
    it('returns error for unknown scope', async () => {
      const data = parse(await tool.execute('q13', { scope: 'nonexistent' }));
      expect(data.status).toBe('error');
      expect(data.error).toContain('Unknown query scope');
    });
  });
});
