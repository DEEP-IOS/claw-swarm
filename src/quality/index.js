/**
 * Quality System Factory - Creates and wires all quality domain modules
 *
 * Instantiates the 9 quality modules (gate, resilience, analysis) and
 * returns a unified facade with delegating methods for each subsystem.
 * The facade also exposes a start()/stop() lifecycle for bus subscriptions
 * and timer cleanup.
 *
 * @module quality/index
 * @version 9.0.0
 */
import { EvidenceGate } from './gate/evidence-gate.js';
import { QualityController } from './gate/quality-controller.js';
import { ToolResilience } from './resilience/tool-resilience.js';
import { CircuitBreaker } from './resilience/circuit-breaker.js';
import { FailureVaccination } from './resilience/failure-vaccination.js';
import { PipelineBreaker } from './resilience/pipeline-breaker.js';
import { FailureAnalyzer } from './analysis/failure-analyzer.js';
import { AnomalyDetector } from './analysis/anomaly-detector.js';
import { ComplianceMonitor } from './analysis/compliance-monitor.js';

/**
 * Create the complete quality system with all 9 modules wired together.
 *
 * @param {Object} deps
 * @param {Object} deps.field          - Signal field instance
 * @param {Object} deps.bus            - EventBus instance
 * @param {Object} deps.store          - DomainStore instance
 * @param {Object} [deps.reputationCRDT] - ReputationCRDT for quality controller feedback
 * @param {Object} [deps.config={}]    - Per-module config overrides
 * @returns {Object} Quality system facade
 */
export function createQualitySystem({ field, bus, store, reputationCRDT, config = {} }) {
  // ─── Module Instantiation ────────────────────────────────────────

  const evidenceGate = new EvidenceGate({
    field, bus, store,
    config: config.evidenceGate || {},
  });

  const qualityController = new QualityController({
    field, bus, store, reputationCRDT,
    config: config.qualityController || {},
  });

  const toolResilience = new ToolResilience({
    field, bus,
    config: config.toolResilience || {},
  });

  const circuitBreaker = new CircuitBreaker({
    field, bus,
    config: config.circuitBreaker || {},
  });

  const failureVaccination = new FailureVaccination({
    field, bus, store,
    config: config.failureVaccination || {},
  });

  const pipelineBreaker = new PipelineBreaker({
    field, bus,
    config: config.pipelineBreaker || {},
  });

  const failureAnalyzer = new FailureAnalyzer({
    field, bus, store,
    config: config.failureAnalyzer || {},
  });

  const anomalyDetector = new AnomalyDetector({
    field, bus,
    config: config.anomalyDetector || {},
  });

  const complianceMonitor = new ComplianceMonitor({
    field, bus,
    config: config.complianceMonitor || {},
  });

  // ─── Module Array (for coupling verification) ────────────────────

  const _modules = [
    evidenceGate, qualityController,
    toolResilience, circuitBreaker, failureVaccination, pipelineBreaker,
    failureAnalyzer, anomalyDetector, complianceMonitor,
  ];

  // ─── Bus Subscription Handles ────────────────────────────────────

  let _subscriptions = [];

  // ─── Facade ──────────────────────────────────────────────────────

  return {
    // --- Gate methods ---
    evaluateEvidence: (claimOrObj, evidences) => {
      // Support both (claim, evidences) and ({ claim, evidences }) signatures (gate-tool passes single object)
      if (claimOrObj && typeof claimOrObj === 'object' && claimOrObj.claim && !evidences) {
        return evidenceGate.evaluate(claimOrObj.claim, claimOrObj.evidences || []);
      }
      return evidenceGate.evaluate(claimOrObj, evidences);
    },
    appealEvidence: (evalIdOrObj, newEvidences) => {
      // Support both (evalId, evidences) and ({ originalEvaluationId, additionalEvidences }) signatures
      if (typeof evalIdOrObj === 'object' && evalIdOrObj !== null) {
        const id = evalIdOrObj.originalEvaluationId || evalIdOrObj.evaluationId || evalIdOrObj.id;
        const evidences = evalIdOrObj.additionalEvidences || evalIdOrObj.evidences || newEvidences || [];
        return evidenceGate.appeal(id, evidences);
      }
      return evidenceGate.appeal(evalIdOrObj, newEvidences);
    },
    auditOutput: (output) => qualityController.evaluateOutput(output),

    // --- Resilience methods ---
    validateTool: (name, params) => toolResilience.validateAndRepair(name, params),
    registerToolSchemas: (defs) => toolResilience.registerToolSchemas(defs),
    canExecuteTool: (name) => circuitBreaker.canExecute(name),
    recordToolSuccess: (name) => {
      circuitBreaker.recordSuccess(name);
      toolResilience.recordSuccess(name);
    },
    recordToolFailure: (name, err) => {
      circuitBreaker.recordFailure(name);
      toolResilience.recordFailure(name, err);
    },
    checkImmunity: (desc) => failureVaccination.checkImmunity(desc),
    startPipelineTracking: (dagId, budget) => pipelineBreaker.startTracking(dagId, budget),
    stopPipelineTracking: (dagId) => pipelineBreaker.stopTracking(dagId),

    // --- Analysis methods ---
    classifyFailure: (ctx) => failureAnalyzer.classify(ctx),
    detectAnomaly: (agentId) => anomalyDetector.detect(agentId),
    recordAgentEvent: (agentId, event) => anomalyDetector.recordEvent(agentId, event),
    checkCompliance: (sid, output, ctx) => complianceMonitor.check(sid, output, ctx),
    getCompliancePrompt: (sid) => complianceMonitor.getEscalationPrompt(sid),

    // --- Gate history (used by gate-tool 'history' action) ---
    getGateHistory: ({ scope, limit } = {}) => {
      if (!store) return [];
      const records = store.query?.('quality', (value, key) => {
        if (!key.startsWith('gate-')) return false;
        if (scope && value?.claim?.scope && value.claim.scope !== scope) return false;
        return true;
      }) || [];
      records.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
      return records.slice(0, limit || 50);
    },

    // --- Dashboard query delegations ---
    getAuditHistory: () => qualityController.getAuditHistory?.() || [],
    getFailureModeDistribution: () => failureAnalyzer.getClassDistribution?.() || {},
    getComplianceStats: () => complianceMonitor.getStats?.() || {},
    getAllBreakerStates: () => circuitBreaker.getAllStates?.() || {},
    getAntigens: () => failureVaccination.getAntigens?.() || [],
    getResilienceStats: () => ({
      toolResilience: toolResilience.getStats?.() || {},
      circuitBreaker: circuitBreaker.getStats?.() || {},
      pipelineBreaker: pipelineBreaker.getStats?.() || {},
      failureVaccination: failureVaccination.getStats?.() || {},
      failureAnalyzer: failureAnalyzer.getStats?.() || {},
      anomalyDetector: anomalyDetector.getStats?.() || {},
      complianceMonitor: complianceMonitor.getStats?.() || {},
      evidenceGate: evidenceGate.getStats?.() || {},
      qualityController: qualityController.getStats?.() || {},
    }),

    // --- Module access ---
    _modules,
    allModules: () => [..._modules],

    // --- Lifecycle ---

    /**
     * Subscribe to bus events and wire cross-module interactions.
     * Call this after all modules are constructed.
     */
    start: async () => {
      // Start individual module lifecycles
      for (const mod of _modules) {
        if (typeof mod.start === 'function') {
          await mod.start();
        }
      }

      const subscribe = (topic, handler) => {
        if (typeof bus.on === 'function') {
          return bus.on(topic, handler);
        }
        if (typeof bus.subscribe === 'function') {
          bus.subscribe(topic, handler);
          return () => bus.unsubscribe?.(topic, handler);
        }
        return () => {};
      };

      // Wire cross-module bus subscriptions
      const onAgentCompleted = (envelope) => {
        qualityController._onAgentCompleted(envelope);
      };

      const onAgentFailed = (envelope) => {
        const data = envelope?.data || envelope;
        failureAnalyzer._onFailure(data);
        if (data && data.agentId) {
          anomalyDetector.recordEvent(data.agentId, {
            type: 'failure',
            error: data.error || data.message || '',
            timestamp: Date.now(),
          });
        }
      };

      const onFailureClassified = (envelope) => {
        const data = envelope?.data || envelope;
        if (data) {
          failureVaccination.learn({
            error: data.failureContext?.error || '',
            taskDescription: data.failureContext?.taskDescription || '',
            severity: data.severity,
            preventionPrompt: data.suggestedStrategy
              ? `Recovery strategy: ${data.suggestedStrategy}. Avoid repeating: ${data.class}`
              : undefined,
          });
        }
      };

      const onDagCreated = (envelope) => {
        const data = envelope?.data || envelope;
        const budgetMs = data?.timeBudgetMs ?? data?.metadata?.timeBudgetMs ?? data?.deadlineMs ?? data?.metadata?.deadlineMs;
        if (data?.dagId && typeof budgetMs === 'number' && budgetMs > 0) {
          pipelineBreaker.startTracking(data.dagId, budgetMs);
        }
      };

      const onDagCompleted = (envelope) => {
        const data = envelope?.data || envelope;
        if (data?.dagId) {
          pipelineBreaker.stopTracking(data.dagId);
        }
      };

      _subscriptions = [
        subscribe('agent.lifecycle.completed', onAgentCompleted),
        subscribe('agent.lifecycle.failed', onAgentFailed),
        subscribe('quality.failure.classified', onFailureClassified),
        subscribe('dag.created', onDagCreated),
        subscribe('dag.completed', onDagCompleted),
      ];

    },

    /**
     * Unsubscribe from bus events, clear timers, and stop modules.
     */
    stop: async () => {
      // Unsubscribe cross-module wiring
      for (const unsubscribe of _subscriptions) {
        unsubscribe?.();
      }
      _subscriptions = [];

      // Clear pipeline timers
      pipelineBreaker._clearAllTimers();

      // Stop individual module lifecycles
      for (const mod of _modules) {
        if (typeof mod.stop === 'function') {
          await mod.stop();
        }
      }
    },
  };
}

// ─── Re-exports ──────────────────────────────────────────────────────

export { EvidenceGate } from './gate/evidence-gate.js';
export { QualityController } from './gate/quality-controller.js';
export { ToolResilience } from './resilience/tool-resilience.js';
export { CircuitBreaker } from './resilience/circuit-breaker.js';
export { FailureVaccination } from './resilience/failure-vaccination.js';
export { PipelineBreaker } from './resilience/pipeline-breaker.js';
export { FailureAnalyzer } from './analysis/failure-analyzer.js';
export { AnomalyDetector } from './analysis/anomaly-detector.js';
export { ComplianceMonitor } from './analysis/compliance-monitor.js';
