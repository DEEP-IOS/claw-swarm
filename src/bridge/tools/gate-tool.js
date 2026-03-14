// R8 Bridge - swarm_gate tool
// Evidence-based gating with evaluate, appeal, and history actions

function toolResponse(data) {
  return { content: [{ type: 'text', text: JSON.stringify(data) }] };
}

function errorResponse(error) {
  return toolResponse({ status: 'error', error: String(error) });
}

/**
 * createGateTool - Factory for the swarm_gate tool
 *
 * Implements evidence-based quality gates where claims are evaluated
 * against provided evidence. Supports appeals for rejected evaluations.
 *
 * Actions:
 *   evaluate - Submit a claim with evidence for quality gate evaluation
 *   appeal   - Appeal a previous evaluation with additional evidence
 *   history  - View past gate evaluations for a scope
 *
 * Dependencies:
 *   quality - EvidenceGate for claim evaluation and appeals
 *   core.field - Signal emission for gate events
 */
export function createGateTool({ core, quality, sessionBridge, spawnClient }) {
  return {
    name: 'swarm_gate',

    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['evaluate', 'appeal', 'history'],
          description: 'Gate action to perform',
        },
        claim: {
          type: 'object',
          properties: {
            type: {
              type: 'string',
              description: 'Claim type (e.g., task_complete, quality_met, test_passed)',
            },
            description: {
              type: 'string',
              description: 'Description of what is being claimed',
            },
            agentId: {
              type: 'string',
              description: 'Agent making the claim',
            },
            dagId: {
              type: 'string',
              description: 'Associated DAG ID',
            },
          },
          description: 'The claim to evaluate (for evaluate action)',
        },
        evidences: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              type: {
                type: 'string',
                description: 'Evidence type (test_result, code_review, metric, user_feedback)',
              },
              content: {
                type: 'string',
                description: 'Evidence content or reference',
              },
              weight: {
                type: 'number',
                description: 'Evidence weight (0.0 to 1.0)',
              },
            },
          },
          description: 'Array of evidence items supporting the claim',
        },
        evaluationId: {
          type: 'string',
          description: 'Previous evaluation ID (for appeal action)',
        },
        limit: {
          type: 'number',
          description: 'Max number of history entries to return (default: 20)',
        },
      },
      required: ['action'],
    },

    async execute(toolCallId, params) {
      try {
        const { action } = params;
        const scope = sessionBridge?.getCurrentScope?.() ?? 'default';

        switch (action) {
          case 'evaluate': {
            const { claim, evidences } = params;
            if (!claim) {
              return errorResponse('claim is required for evaluate action');
            }
            if (!evidences || !Array.isArray(evidences) || evidences.length === 0) {
              return errorResponse('At least one evidence item is required for evaluate action');
            }

            const evaluationId = `eval-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

            // Normalize evidence weights
            const normalizedEvidences = evidences.map(e => ({
              type: e.type || 'generic',
              content: e.content || '',
              weight: typeof e.weight === 'number' ? Math.max(0, Math.min(1, e.weight)) : 0.5,
            }));

            // Delegate to quality EvidenceGate
            let result;
            if (quality?.evaluateEvidence) {
              result = await quality.evaluateEvidence({
                id: evaluationId,
                claim,
                evidences: normalizedEvidences,
                scope,
                timestamp: Date.now(),
              });
            } else {
              // Fallback: compute weighted score
              const totalWeight = normalizedEvidences.reduce((sum, e) => sum + e.weight, 0);
              const avgWeight = totalWeight / normalizedEvidences.length;
              const passed = avgWeight >= 0.6;

              result = {
                evaluationId,
                passed,
                score: avgWeight,
                threshold: 0.6,
                reasoning: passed
                  ? `Evidence score ${avgWeight.toFixed(2)} meets threshold`
                  : `Evidence score ${avgWeight.toFixed(2)} below threshold 0.6`,
                gaps: passed ? [] : ['Insufficient evidence weight'],
              };
            }

            // Emit field signal
            core?.field?.emit?.('gate.evaluated', {
              evaluationId,
              passed: result.passed,
              score: result.score,
              claimType: claim.type,
              scope,
              timestamp: Date.now(),
            });

            return toolResponse({
              status: 'evaluated',
              evaluationId: result.evaluationId || evaluationId,
              passed: result.passed,
              score: result.score,
              threshold: result.threshold,
              reasoning: result.reasoning,
              gaps: result.gaps || [],
              evidenceCount: normalizedEvidences.length,
            });
          }

          case 'appeal': {
            const { evaluationId, evidences } = params;
            if (!evaluationId) {
              return errorResponse('evaluationId is required for appeal action');
            }
            if (!evidences || !Array.isArray(evidences) || evidences.length === 0) {
              return errorResponse('Additional evidence is required for appeal');
            }

            const appealId = `appeal-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
            const normalizedEvidences = evidences.map(e => ({
              type: e.type || 'generic',
              content: e.content || '',
              weight: typeof e.weight === 'number' ? Math.max(0, Math.min(1, e.weight)) : 0.5,
            }));

            let result;
            if (quality?.appealEvidence) {
              result = await quality.appealEvidence({
                appealId,
                originalEvaluationId: evaluationId,
                additionalEvidences: normalizedEvidences,
                scope,
                timestamp: Date.now(),
              });
            } else {
              // Fallback: slightly lower threshold for appeals
              const totalWeight = normalizedEvidences.reduce((sum, e) => sum + e.weight, 0);
              const avgWeight = totalWeight / normalizedEvidences.length;
              const passed = avgWeight >= 0.5;

              result = {
                appealId,
                passed,
                score: avgWeight,
                threshold: 0.5,
                reasoning: passed
                  ? `Appeal evidence score ${avgWeight.toFixed(2)} meets appeal threshold`
                  : `Appeal evidence score ${avgWeight.toFixed(2)} below appeal threshold 0.5`,
              };
            }

            // Emit field signal
            core?.field?.emit?.('gate.appealed', {
              appealId,
              originalEvaluationId: evaluationId,
              passed: result.passed,
              scope,
              timestamp: Date.now(),
            });

            return toolResponse({
              status: 'appeal_processed',
              appealId: result.appealId || appealId,
              originalEvaluationId: evaluationId,
              passed: result.passed,
              score: result.score,
              threshold: result.threshold,
              reasoning: result.reasoning,
            });
          }

          case 'history': {
            const limit = params.limit || 20;

            let history = [];
            if (quality?.getGateHistory) {
              history = await quality.getGateHistory({ scope, limit });
            }

            return toolResponse({
              status: 'ok',
              scope,
              count: history.length,
              evaluations: (Array.isArray(history) ? history : []).slice(0, limit).map(h => ({
                evaluationId: h.evaluationId || h.id,
                claimType: h.claimType || h.claim?.type,
                passed: h.passed,
                score: h.score,
                timestamp: h.timestamp,
                appealCount: h.appealCount || 0,
              })),
            });
          }

          default:
            return errorResponse(`Unknown gate action: ${action}`);
        }
      } catch (err) {
        return errorResponse(`swarm_gate execution failed: ${err.message}`);
      }
    },
  };
}
