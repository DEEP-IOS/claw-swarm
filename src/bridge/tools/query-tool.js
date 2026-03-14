// R8 Bridge - swarm_query tool
// Unified query interface with 10 sub-commands via scope parameter

function toolResponse(data) {
  return { content: [{ type: 'text', text: JSON.stringify(data) }] };
}

function errorResponse(error) {
  return toolResponse({ status: 'error', error: String(error) });
}

/**
 * Query handlers - one per scope value
 */
const queryHandlers = {
  /**
   * status: Overview of active agents and field summary
   */
  async status({ core, quality }) {
    const agents = core?.intelligence?.getActiveAgents?.() ?? [];
    const fieldSummary = core?.field?.superpose?.('status') ?? { dimensions: 0 };
    const pipelines = quality?.getActivePipelines?.() ?? [];
    const budget = core?.orchestration?.getBudget?.() ?? { used: 0, limit: 0 };

    return toolResponse({
      scope: 'status',
      activeAgents: agents.length,
      agents: agents.map(a => ({
        id: a.id,
        role: a.role,
        state: a.state,
        elapsed: a.elapsed,
      })),
      activePipelines: pipelines.length,
      budget: { used: budget.used, limit: budget.limit },
      field: fieldSummary,
      timestamp: Date.now(),
    });
  },

  /**
   * plan: Retrieve a specific DAG plan by ID
   */
  async plan({ core }, params) {
    const dagId = params.dagId;
    if (!dagId) {
      return errorResponse('dagId is required for plan scope');
    }

    const dag = core?.orchestration?.getDAG?.(dagId);
    if (!dag) {
      return toolResponse({ scope: 'plan', dagId, found: false });
    }

    return toolResponse({
      scope: 'plan',
      dagId,
      found: true,
      nodes: dag.nodes || [],
      edges: dag.edges || [],
      state: dag.state || 'unknown',
      createdAt: dag.createdAt,
      summary: dag.summary || '',
    });
  },

  /**
   * agents: List all active agents with details
   */
  async agents({ core }) {
    const agentList = core?.intelligence?.getActiveAgents?.() ?? [];

    return toolResponse({
      scope: 'agents',
      count: agentList.length,
      agents: agentList.map(a => ({
        id: a.id,
        role: a.role,
        model: a.model,
        state: a.state,
        dagId: a.dagId,
        startedAt: a.startedAt,
        elapsed: a.elapsed,
        tokensUsed: a.tokensUsed || 0,
      })),
    });
  },

  /**
   * pheromones: Current pheromone state in the communication field
   */
  async pheromones({ core }) {
    const state = core?.communication?.getPheromoneState?.() ?? {
      trails: [],
      activeTypes: [],
      totalDeposits: 0,
    };

    return toolResponse({
      scope: 'pheromones',
      activeTypes: state.activeTypes || [],
      totalDeposits: state.totalDeposits || 0,
      trails: (state.trails || []).slice(0, 50).map(t => ({
        type: t.type,
        scope: t.scope,
        intensity: t.intensity,
        age: t.age,
        depositor: t.depositor,
      })),
    });
  },

  /**
   * reputation: Agent reputation scores and history
   */
  async reputation({ core }) {
    const rep = core?.intelligence?.getReputation?.() ?? {
      agents: [],
      globalScore: 0,
    };

    return toolResponse({
      scope: 'reputation',
      globalScore: rep.globalScore || 0,
      agents: (rep.agents || []).map(a => ({
        id: a.id,
        role: a.role,
        score: a.score,
        tasksCompleted: a.tasksCompleted,
        failureRate: a.failureRate,
      })),
    });
  },

  /**
   * memory: Search through stored memory entries
   */
  async memory({ core }, params) {
    const query = params.query;
    if (!query) {
      return errorResponse('query parameter is required for memory scope');
    }

    const results = core?.intelligence?.searchMemory?.(query) ?? [];

    return toolResponse({
      scope: 'memory',
      query,
      count: results.length,
      entries: results.slice(0, 20).map(r => ({
        id: r.id,
        type: r.type,
        content: r.content,
        relevance: r.relevance,
        createdAt: r.createdAt,
        source: r.source,
      })),
    });
  },

  /**
   * progress: Pipeline/DAG progress tracking
   */
  async progress({ core, quality }, params) {
    const dagId = params.dagId;
    if (!dagId) {
      return errorResponse('dagId is required for progress scope');
    }

    const prog = core?.orchestration?.getProgress?.(dagId) ?? quality?.getPipelineProgress?.(dagId);
    if (!prog) {
      return toolResponse({ scope: 'progress', dagId, found: false });
    }

    return toolResponse({
      scope: 'progress',
      dagId,
      found: true,
      completedNodes: prog.completedNodes || 0,
      totalNodes: prog.totalNodes || 0,
      percentage: prog.percentage || 0,
      state: prog.state || 'unknown',
      elapsed: prog.elapsed || 0,
      remainingBudget: prog.remainingBudget,
      blockers: prog.blockers || [],
    });
  },

  /**
   * cost: Budget and token usage information
   */
  async cost({ core }) {
    const budget = core?.orchestration?.getBudget?.() ?? {
      used: 0,
      limit: 0,
      byModel: {},
      byRole: {},
    };

    return toolResponse({
      scope: 'cost',
      totalUsed: budget.used || 0,
      limit: budget.limit || 0,
      remaining: (budget.limit || 0) - (budget.used || 0),
      byModel: budget.byModel || {},
      byRole: budget.byRole || {},
      currency: budget.currency || 'tokens',
    });
  },

  /**
   * artifacts: List artifacts produced by a DAG
   */
  async artifacts({ core }, params) {
    const dagId = params.dagId;
    if (!dagId) {
      return errorResponse('dagId is required for artifacts scope');
    }

    const arts = core?.intelligence?.getArtifacts?.(dagId) ?? [];

    return toolResponse({
      scope: 'artifacts',
      dagId,
      count: arts.length,
      artifacts: arts.map(a => ({
        id: a.id,
        type: a.type,
        name: a.name,
        path: a.path,
        size: a.size,
        createdAt: a.createdAt,
        producedBy: a.producedBy,
      })),
    });
  },

  /**
   * field: Superposition of all 12 signal dimensions
   */
  async field({ core }) {
    const superposition = core?.field?.superpose?.('all') ?? {
      dimensions: {},
      coherence: 0,
      lastUpdate: 0,
    };

    const dimensionNames = [
      'urgency', 'complexity', 'risk', 'progress',
      'quality', 'cost', 'collaboration', 'knowledge',
      'innovation', 'stability', 'momentum', 'entropy',
    ];

    const dimensions = {};
    for (const dim of dimensionNames) {
      dimensions[dim] = superposition.dimensions?.[dim] ?? {
        value: 0,
        confidence: 0,
        contributors: 0,
      };
    }

    return toolResponse({
      scope: 'field',
      dimensions,
      coherence: superposition.coherence || 0,
      lastUpdate: superposition.lastUpdate || 0,
      totalSignals: superposition.totalSignals || 0,
    });
  },
};

/**
 * createQueryTool - Factory for the swarm_query tool
 *
 * Provides a unified query interface with 10 sub-commands:
 * status, plan, agents, pheromones, reputation, memory,
 * progress, cost, artifacts, field
 */
export function createQueryTool({ core, quality, sessionBridge, spawnClient }) {
  return {
    name: 'swarm_query',

    parameters: {
      type: 'object',
      properties: {
        scope: {
          type: 'string',
          enum: [
            'status', 'plan', 'agents', 'pheromones', 'reputation',
            'memory', 'progress', 'cost', 'artifacts', 'field',
          ],
          description: 'Query scope determining what information to retrieve',
        },
        dagId: {
          type: 'string',
          description: 'DAG ID for plan, progress, cost, and artifacts queries',
        },
        query: {
          type: 'string',
          description: 'Search query string for memory scope',
        },
      },
      required: ['scope'],
    },

    async execute(toolCallId, params) {
      try {
        const handler = queryHandlers[params.scope];
        if (!handler) {
          return errorResponse(`Unknown query scope: ${params.scope}`);
        }

        return await handler({ core, quality, sessionBridge, spawnClient }, params);
      } catch (err) {
        return errorResponse(`swarm_query[${params.scope}] failed: ${err.message}`);
      }
    },
  };
}
