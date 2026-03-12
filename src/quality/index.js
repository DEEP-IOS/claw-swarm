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
    evaluateEvidence: (claim, evidences) => evidenceGate.evaluate(claim, evidences),
    appealEvidence: (evalId, newEvidences) => evidenceGate.appeal(evalId, newEvidences),
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

    // --- Dashboard query delegations ---
    getAuditHistory: () => qualityController.getAuditHistory?.() || [],
    getFailureModeDistribution: () => failureAnalyzer.getDistribution?.() || {},
    getComplianceStats: () => complianceMonitor.getStats?.() || {},
    getAllBreakerStates: () => circuitBreaker.getAllStates?.() || {},
    getAntigens: () => failureVaccination.getAntigens?.() || [],

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

      bus.subscribe('agent.completed', onAgentCompleted);
      bus.subscribe('agent.failed', onAgentFailed);
      bus.subscribe('quality.failure.classified', onFailureClassified);

      _subscriptions = [
        { topic: 'agent.completed', handler: onAgentCompleted },
        { topic: 'agent.failed', handler: onAgentFailed },
        { topic: 'quality.failure.classified', handler: onFailureClassified },
      ];
    },

    /**
     * Unsubscribe from bus events, clear timers, and stop modules.
     */
    stop: async () => {
      // Unsubscribe cross-module wiring
      for (const sub of _subscriptions) {
        bus.unsubscribe(sub.topic, sub.handler);
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
