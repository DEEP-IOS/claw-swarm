// R8 Bridge - swarm_query tool
// Unified query interface with 16 scopes via scope parameter

import { ALL_DIMENSIONS } from '../../core/field/types.js';

function toolResponse(data) {
  return { content: [{ type: 'text', text: JSON.stringify(data) }] };
}

function errorResponse(error) {
  return toolResponse({ status: 'error', error: String(error) });
}

function normalizeBudgetStats(rawBudget = {}) {
  const dags = Array.isArray(rawBudget.dags) ? rawBudget.dags : [];
  const globalSource = rawBudget.global || {};
  const spent = globalSource.spent ?? rawBudget.spent ?? rawBudget.used ?? 0;
  const totalSession = globalSource.totalSession ?? rawBudget.totalSession ?? rawBudget.limit ?? 0;
  const remaining = globalSource.remaining ?? Math.max(0, totalSession - spent);
  const utilization = globalSource.utilization ?? (totalSession > 0 ? spent / totalSession : 0);

  return {
    dagCount: rawBudget.dagCount ?? dags.length,
    dags,
    global: {
      totalSession,
      spent,
      remaining,
      utilization,
    },
  };
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
    const budget = normalizeBudgetStats(core?.orchestration?.getBudget?.() ?? {});

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
      budget: budget.global,
      budgetDagCount: budget.dagCount,
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
   * tasks: List orchestration task/DAG summaries
   */
  async tasks({ core }) {
    const tasks = core?.orchestration?.getTasks?.() ?? [];

    return toolResponse({
      scope: 'tasks',
      count: tasks.length,
      tasks: tasks.map(task => ({
        id: task.id ?? task.dagId,
        dagId: task.dagId ?? task.id,
        state: task.state ?? task.status ?? 'unknown',
        summary: task.summary ?? '',
        nodeCount: Array.isArray(task.nodes) ? task.nodes.length : 0,
        edgeCount: Array.isArray(task.edges) ? task.edges.length : 0,
        createdAt: task.createdAt ?? null,
      })),
    });
  },

  /**
   * health: Observe-domain health status
   */
  async health({ core }) {
    const health = core?.observe?.getHealth?.() ?? { status: 'unknown', score: 0 };

    return toolResponse({
      scope: 'health',
      ...health,
    });
  },

  /**
   * budget: Budget tracker state — reads real token data from BudgetTracker
   */
  async budget({ core }) {
    // Prefer direct BudgetTracker access for real spend data
    const tracker = core?.orchestration?.adaptation?.budgetTracker;
    if (tracker) {
      const stats = tracker.getStats?.() ?? {};
      const global = tracker.getGlobalBudget?.() ?? {};
      return toolResponse({
        scope: 'budget',
        dagCount: stats.dagCount ?? 0,
        dags: (stats.dags || []).map(d => ({
          dagId: d.dagId,
          totalBudget: d.totalBudget,
          spent: d.spent,
          remaining: d.remaining,
          utilization: d.utilization,
          overrun: d.overrun,
        })),
        global: {
          totalSession: global.totalSession ?? 0,
          spent: global.spent ?? 0,
          remaining: global.remaining ?? 0,
          utilization: global.utilization ?? 0,
        },
      });
    }

    // Fallback: facade getBudget()
    const budget = normalizeBudgetStats(core?.orchestration?.getBudget?.() ?? {});
    return toolResponse({
      scope: 'budget',
      dagCount: budget.dagCount,
      dags: budget.dags,
      global: budget.global,
    });
  },

  /**
   * species: Evolution/adaptation state
   */
  async species({ core }) {
    const species = core?.orchestration?.getSpeciesState?.() ?? {};

    return toolResponse({
      scope: 'species',
      ...species,
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
   * channels: Active communication channels and recent messages
   */
  async channels({ core }) {
    const state = core?.communication?.getActiveChannels?.() ?? { count: 0, channels: [] };

    return toolResponse({
      scope: 'channels',
      count: state.count || 0,
      channels: state.channels || [],
    });
  },

  /**
   * stigmergy: Stigmergic board entries
   */
  async stigmergy({ core }) {
    const state = core?.communication?.getStigmergy?.() ?? { scope: 'all', entryCount: 0, entries: [] };

    return toolResponse({
      scope: 'stigmergy',
      boardScope: state.scope || 'all',
      count: state.entryCount || 0,
      entries: state.entries || [],
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

    const prog = core?.bridge?.getProgress?.(dagId)
      ?? core?.orchestration?.getProgress?.(dagId)
      ?? quality?.getPipelineProgress?.(dagId);
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
    const budget = normalizeBudgetStats(core?.orchestration?.getBudget?.() ?? {});

    return toolResponse({
      scope: 'cost',
      totalSpent: budget.global.spent,
      totalSession: budget.global.totalSession,
      remaining: budget.global.remaining,
      utilization: budget.global.utilization,
      dagCount: budget.dagCount,
      dags: budget.dags,
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

    // Get formal artifacts from intelligence layer
    const arts = core?.intelligence?.getArtifacts?.(dagId) ?? [];

    // Also get actual sub-agent outputs from DAG nodes
    const dagInfo = core?.orchestration?.getDAG?.(dagId);
    const nodeOutputs = (dagInfo?.nodes || [])
      .filter(n => n.state === 'COMPLETED' && n.result)
      .map(n => {
        const output = typeof n.result === 'string' ? n.result
          : n.result?.output || JSON.stringify(n.result).slice(0, 2000);
        return {
          nodeId: n.id,
          role: n.role,
          output,
          completedAt: n.completedAt,
        };
      });

    return toolResponse({
      scope: 'artifacts',
      dagId,
      artifactCount: arts.length,
      nodeOutputCount: nodeOutputs.length,
      artifacts: arts.map(a => ({
        id: a.id, type: a.type, name: a.name, path: a.path,
        size: a.size, createdAt: a.createdAt, producedBy: a.producedBy,
      })),
      nodeOutputs,
    });
  },

  /**
   * field: Superposition of all 12 signal dimensions
   */
  async field({ core }) {
    const superposition = core?.field?.superpose?.('all') ?? {};

    const dimensions = {};
    for (const dim of ALL_DIMENSIONS) {
      dimensions[dim] = superposition[dim] ?? 0;
    }

    return toolResponse({
      scope: 'field',
      dimensions,
      dimensionsCount: ALL_DIMENSIONS.length,
      supportedDimensions: ALL_DIMENSIONS,
      totalSignals: superposition.totalSignals || 0,
    });
  },
};

/**
 * createQueryTool - Factory for the swarm_query tool
 *
 * Provides a unified query interface with 16 sub-commands:
 * status, plan, agents, tasks, health, budget, species,
 * pheromones, channels, stigmergy, reputation, memory,
 * progress, cost, artifacts, field
 */
// Rate limit state to prevent model tool-calling loops
let _queryCallCount = 0;
let _queryFirstCall = Date.now();

export function createQueryTool({ core, quality, sessionBridge, spawnClient }) {
  return {
    name: 'swarm_query',
    description: [
      'Query swarm system state. Returns real-time information about agents,',
      'tasks, budget, health, signals, and more.',
      '',
      'Scopes:',
      '  status — Overall swarm status (active agents, mode, DAGs)',
      '  plan — View DAG execution plan for a task',
      '  agents — List active agents and their roles',
      '  tasks — Current task queue and progress',
      '  health — System health metrics',
      '  budget — Token/cost usage and limits',
      '  progress — Task completion percentage and ETA',
      '  cost — Detailed cost breakdown per DAG',
      '  species — Agent species/roles configuration',
      '  pheromones — Active pheromone trails',
      '  channels — Communication channel status',
      '  stigmergy — Shared knowledge board',
      '  reputation — Agent reputation scores',
      '  memory — Episodic memory search',
      '  artifacts — Task output artifacts',
      '  field — Signal field state (12 dimensions)',
    ].join('\n'),

    parameters: {
      type: 'object',
      properties: {
        scope: {
          type: 'string',
          enum: [
            'status', 'plan', 'agents', 'tasks', 'health', 'budget',
            'species', 'pheromones', 'channels', 'stigmergy',
            'reputation', 'memory', 'progress', 'cost', 'artifacts', 'field',
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
        // Rate limit: prevent model tool-calling loops (kimi k2p5 issue)
        _queryCallCount++;
        if (_queryCallCount > 3 && (Date.now() - _queryFirstCall) < 30000) {
          return toolResponse({
            scope: params.scope,
            rateLimited: true,
            message: '查询频率过高，请等待后重试。不要重复调用此工具。',
          });
        }
        if (_queryCallCount === 1) _queryFirstCall = Date.now();
        if ((Date.now() - _queryFirstCall) > 30000) { _queryCallCount = 1; _queryFirstCall = Date.now(); }

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
