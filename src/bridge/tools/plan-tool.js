// R8 Bridge - swarm_plan tool
// DAG plan management: view, modify, validate, cancel

function toolResponse(data) {
  return { content: [{ type: 'text', text: JSON.stringify(data) }] };
}

function errorResponse(error) {
  return toolResponse({ status: 'error', error: String(error) });
}

/**
 * createPlanTool - Factory for the swarm_plan tool
 *
 * Manages DAG-based execution plans. Plans are directed acyclic graphs
 * of tasks with dependencies, time budgets, and assigned roles.
 *
 * Actions:
 *   view     - View details of an existing plan/DAG
 *   modify   - Modify plan nodes, edges, or parameters
 *   validate - Validate plan structure (cycle detection, missing deps)
 *   cancel   - Cancel an active plan and its running agents
 *
 * Dependencies:
 *   core.orchestration - PlanEngine for DAG operations
 *   core.field         - Signal emission for plan events
 *   spawnClient        - Cancel spawned agents on plan cancellation
 */
export function createPlanTool({ core, quality, sessionBridge, spawnClient }) {
  return {
    name: 'swarm_plan',
    description: [
      'View or modify an execution plan (DAG).',
      '',
      'Actions:',
      '  view — Show the current DAG structure and node states',
      '  modify — Add/remove/reorder nodes in the DAG',
      '  validate — Check DAG for cycles, missing deps, etc.',
      '  cancel — Cancel an active DAG and all its agents',
    ].join('\n'),

    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['view', 'modify', 'validate', 'cancel'],
          description: 'Plan action to perform',
        },
        dagId: {
          type: 'string',
          description: 'DAG/Plan ID (required for all actions)',
        },
        modifications: {
          type: 'object',
          properties: {
            addNodes: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  task: { type: 'string' },
                  role: { type: 'string' },
                  dependsOn: { type: 'array', items: { type: 'string' } },
                },
              },
              description: 'Nodes to add to the plan',
            },
            removeNodes: {
              type: 'array',
              items: { type: 'string' },
              description: 'Node IDs to remove from the plan',
            },
            updateTimeBudget: {
              type: 'number',
              description: 'New time budget in milliseconds',
            },
            updatePriority: {
              type: 'number',
              description: 'New priority level (1-10)',
            },
          },
          description: 'Modifications to apply (for modify action)',
        },
      },
      required: ['action'],
    },

    async execute(toolCallId, params) {
      try {
        const { action, dagId } = params;
        const scope = sessionBridge?.getCurrentScope?.() ?? 'default';

        if (!dagId) {
          return errorResponse('dagId is required for all plan actions');
        }

        const planning = core?.orchestration;

        switch (action) {
          case 'view': {
            const dag = planning?.getDAG?.(dagId);
            if (!dag) {
              return toolResponse({ status: 'not_found', dagId });
            }

            const progress = planning?.getProgress?.(dagId) ?? {};

            return toolResponse({
              status: 'ok',
              action: 'view',
              dagId,
              state: dag.state || 'unknown',
              summary: dag.summary || '',
              nodes: (dag.nodes || []).map(n => ({
                id: n.id,
                task: n.task,
                role: n.role,
                state: n.state || 'pending',
                agentId: n.agentId,
                dependsOn: n.dependsOn || [],
              })),
              edges: dag.edges || [],
              timeBudgetMs: dag.timeBudgetMs,
              createdAt: dag.createdAt,
              completedNodes: progress.completedNodes || 0,
              totalNodes: progress.totalNodes || (dag.nodes || []).length,
              percentage: progress.percentage || 0,
            });
          }

          case 'modify': {
            const { modifications } = params;
            if (!modifications) {
              return errorResponse('modifications object is required for modify action');
            }

            const dag = planning?.getDAG?.(dagId);
            if (!dag) {
              return toolResponse({ status: 'not_found', dagId });
            }

            const changes = [];

            // Apply modifications via orchestration engine
            if (planning?.modifyDAG) {
              const result = await planning.modifyDAG(dagId, modifications);
              return toolResponse({
                status: 'modified',
                dagId,
                changes: result.changes || [],
                warnings: result.warnings || [],
                newNodeCount: result.nodeCount,
              });
            }

            // Fallback: describe intended modifications
            if (modifications.addNodes && modifications.addNodes.length > 0) {
              changes.push(`Would add ${modifications.addNodes.length} node(s)`);
            }
            if (modifications.removeNodes && modifications.removeNodes.length > 0) {
              changes.push(`Would remove ${modifications.removeNodes.length} node(s)`);
            }
            if (modifications.updateTimeBudget !== undefined) {
              changes.push(`Would update time budget to ${modifications.updateTimeBudget}ms`);
            }
            if (modifications.updatePriority !== undefined) {
              changes.push(`Would update priority to ${modifications.updatePriority}`);
            }

            core?.bus?.publish?.('plan.modified', {
              dagId,
              changes,
              scope,
              timestamp: Date.now(),
            }, 'swarm-plan');

            return toolResponse({
              status: 'modified',
              dagId,
              changes,
              warnings: ['Orchestration engine not available, modifications queued'],
            });
          }

          case 'validate': {
            let validation;

            if (planning?.validateDAG) {
              validation = await planning.validateDAG(dagId);
            } else {
              const dag = planning?.getDAG?.(dagId);
              if (!dag) {
                return toolResponse({ status: 'not_found', dagId });
              }

              // Fallback: basic structural validation
              const nodes = dag.nodes || [];
              const nodeIds = new Set(nodes.map(n => n.id));
              const issues = [];

              // Check for missing dependencies
              for (const node of nodes) {
                for (const dep of (node.dependsOn || [])) {
                  if (!nodeIds.has(dep)) {
                    issues.push({
                      type: 'missing_dependency',
                      nodeId: node.id,
                      missingDep: dep,
                    });
                  }
                }
              }

              // Check for duplicate IDs
              const seen = new Set();
              for (const node of nodes) {
                if (seen.has(node.id)) {
                  issues.push({ type: 'duplicate_id', nodeId: node.id });
                }
                seen.add(node.id);
              }

              // Basic cycle detection via topological sort attempt
              const inDegree = {};
              const adj = {};
              for (const node of nodes) {
                inDegree[node.id] = 0;
                adj[node.id] = [];
              }
              for (const node of nodes) {
                for (const dep of (node.dependsOn || [])) {
                  if (nodeIds.has(dep)) {
                    adj[dep].push(node.id);
                    inDegree[node.id] = (inDegree[node.id] || 0) + 1;
                  }
                }
              }
              const queue = Object.keys(inDegree).filter(id => inDegree[id] === 0);
              let sorted = 0;
              while (queue.length > 0) {
                const curr = queue.shift();
                sorted++;
                for (const next of (adj[curr] || [])) {
                  inDegree[next]--;
                  if (inDegree[next] === 0) queue.push(next);
                }
              }
              if (sorted < nodes.length) {
                issues.push({ type: 'cycle_detected', detail: 'DAG contains a cycle' });
              }

              validation = {
                valid: issues.length === 0,
                issues,
                nodeCount: nodes.length,
                edgeCount: nodes.reduce((sum, n) => sum + (n.dependsOn || []).length, 0),
              };
            }

            return toolResponse({
              status: 'ok',
              action: 'validate',
              dagId,
              valid: validation.valid,
              issues: validation.issues || [],
              nodeCount: validation.nodeCount,
              edgeCount: validation.edgeCount,
            });
          }

          case 'cancel': {
            const dag = planning?.getDAG?.(dagId);
            if (!dag) {
              return toolResponse({ status: 'not_found', dagId });
            }

            // Cancel all running agents in this plan
            const cancelledAgents = [];
            const nodes = dag.nodes || [];

            for (const node of nodes) {
              if (node.agentId && (node.state === 'running' || node.state === 'pending')) {
                if (spawnClient?.cancel) {
                  try {
                    await spawnClient.cancel(node.agentId);
                    cancelledAgents.push(node.agentId);
                  } catch (_) {
                    // Agent may have already completed
                  }
                }
              }
            }

            // Cancel the plan itself
            if (planning?.cancelDAG) {
              await planning.cancelDAG(dagId);
            }

            // Stop pipeline tracking
            quality?.stopPipelineTracking?.(dagId);

            core?.bus?.publish?.('plan.cancelled', {
              dagId,
              cancelledAgents,
              scope,
              timestamp: Date.now(),
            }, 'swarm-plan');

            return toolResponse({
              status: 'cancelled',
              dagId,
              cancelledAgents,
              cancelledAgentCount: cancelledAgents.length,
            });
          }

          default:
            return errorResponse(`Unknown plan action: ${action}`);
        }
      } catch (err) {
        return errorResponse(`swarm_plan execution failed: ${err.message}`);
      }
    },
  };
}
