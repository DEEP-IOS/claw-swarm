/**
 * Orchestration subsystem factory and facade.
 *
 * @module orchestration
 * @version 9.0.0
 */

import { DAGEngine } from './planning/dag-engine.js'
import { ExecutionPlanner } from './planning/execution-planner.js'
import { ReplanEngine } from './planning/replan-engine.js'
import { CriticalPath } from './planning/critical-path.js'
import { ResultSynthesizer } from './planning/result-synthesizer.js'
import { ZoneManager, ZONES } from './planning/zone-manager.js'

import { SpawnAdvisor } from './scheduling/spawn-advisor.js'
import { HierarchicalCoord } from './scheduling/hierarchical-coord.js'
import { ContractNet } from './scheduling/contract-net.js'
import { RoleManager } from './scheduling/role-manager.js'
import { DeadlineTracker } from './scheduling/deadline-tracker.js'
import { ResourceArbiter } from './scheduling/resource-arbiter.js'
import { WorkflowLedger } from './workflow-ledger.js'

import { createAdaptationSystem } from './adaptation/index.js'

function summarizeDAG(dagId, dag, dagEngine) {
  if (!dag) return null
  const nodes = [...dag.nodes.values()].map((node) => ({
    id: node.id,
    task: node.taskId,
    role: node.role,
    state: node.state,
    agentId: node.assignedTo,
    dependsOn: node.dependsOn || [],
    startedAt: node.startedAt,
    completedAt: node.completedAt,
  }))
  const edges = nodes.flatMap((node) => (node.dependsOn || []).map((dependency) => ({
    from: dependency,
    to: node.id,
  })))
  const status = dagEngine.getDAGStatus(dagId)
  return {
    dagId,
    id: dagId,
    status: dag.status,
    state: dag.status,
    createdAt: dag.createdAt,
    summary: `${status.completed}/${status.total} nodes completed`,
    nodes,
    edges,
  }
}

function computeProgress(dagId, dag, dagEngine) {
  if (!dag) return null
  const status = dagEngine.getDAGStatus(dagId)
  const totalNodes = status.total || 0
  const completedNodes = status.completed || 0
  const percentage = totalNodes > 0 ? Math.round((completedNodes / totalNodes) * 100) : 0
  return {
    dagId,
    completedNodes,
    totalNodes,
    percentage,
    state: dag.status,
    blockers: [...dag.nodes.values()]
      .filter((node) => node.state === 'FAILED' || node.state === 'DEAD_LETTER')
      .map((node) => node.id),
  }
}

export function createOrchestrationSystem(deps) {
  const {
    field,
    bus,
    store,
    capabilityEngine,
    hybridRetrieval,
    roleRegistry,
    modelCapability,
    artifactRegistry,
    intentClassifier,
    scopeEstimator,
    config,
  } = deps

  const dag = new DAGEngine({ field, bus, store, config: config?.dag })
  const zone = new ZoneManager({ field, store })
  const planner = new ExecutionPlanner({ field, bus, capabilityEngine, hybridRetrieval })
  const replan = new ReplanEngine({ field, bus, dagEngine: dag })
  const criticalPath = new CriticalPath({ field, bus })
  const synthesizer = new ResultSynthesizer({ field, bus, artifactRegistry })
  // SpawnAdvisor receives adaptation modules AFTER creation via late-bind below
  const advisor = new SpawnAdvisor({ field, bus, roleRegistry, modelCapability, config: config?.spawn })
  const hierarchy = new HierarchicalCoord({ field, bus, config: config?.hierarchy })
  const contract = new ContractNet({ field, bus, capabilityEngine })
  const roles = new RoleManager({ field, bus, roleRegistry })
  const deadline = new DeadlineTracker({ field, bus })
  const arbiter = new ResourceArbiter({ field, bus, zoneManager: zone, config: config?.arbiter })
  const workflow = new WorkflowLedger({ bus })

  const adaptation = createAdaptationSystem({
    field,
    bus,
    store,
    roleRegistry,
    capabilityEngine,
    config: config?.adaptation,
  })

  // Late-bind adaptation modules to SpawnAdvisor (created before adaptation to avoid circular deps)
  advisor._speciesEvolver = adaptation.speciesEvolver
  advisor._globalModulator = adaptation.globalModulator
  advisor._budgetTracker = adaptation.budgetTracker

  const allModules = () => [
    workflow,
    dag,
    zone,
    planner,
    replan,
    criticalPath,
    synthesizer,
    advisor,
    hierarchy,
    contract,
    roles,
    deadline,
    arbiter,
    ...adaptation.allModules(),
  ]

  const getAllDAGEntries = () => [...(dag._dags?.entries?.() || [])]
  const domainStores = new Map()

  const getDomainStore = (name) => {
    if (!name || !store) return null
    if (!domainStores.has(name)) {
      domainStores.set(name, {
        async set(key, value) {
          store.put(name, key, value)
          return value
        },
        async get(key) {
          return store.get(name, key)
        },
        async getAll() {
          return store.queryAll(name)
        },
        async delete(key) {
          return store.delete(name, key)
        },
        async has(key) {
          return store.has(name, key)
        },
        async count() {
          return store.count(name)
        },
      })
    }
    return domainStores.get(name)
  }

  return {
    dag,
    zone,
    zoneManager: zone,
    planner,
    replan,
    criticalPath,
    synthesizer,
    advisor,
    hierarchy,
    contract,
    roles,
    deadline,
    arbiter,
    adaptation,
    workflow,

    allModules,

    routeTask: (input, scopeEstimate = {}) => {
      const intentResult = typeof input === 'string'
        ? (intentClassifier?.classify?.(input) || { primary: 'question', confidence: 0.5 })
        : input
      const enrichedScope = scopeEstimator?.estimate?.(intentResult, scopeEstimate) || scopeEstimate
      const riskLevel = enrichedScope.riskLevel || 'low'
      const routed = adaptation.dualProcessRouter.route({
        confidence: intentResult.confidence ?? 0.5,
        riskLevel,
        scope: enrichedScope.scope || scopeEstimate.scope || 'global',
      }, enrichedScope)
      return {
        system: routed.route?.name === 'fast' ? 1 : 2,
        route: routed.route,
        complexity: routed.complexity,
        threshold: routed.threshold,
      }
    },

    createPlan: (intent, scopeEstimate = {}) => {
      const normalizedIntent = typeof intent === 'string'
        ? (intentClassifier?.classify?.(intent) || { primary: 'question', confidence: 0.5, description: intent })
        : { ...intent, description: intent.description || intent.task || '' }
      const estimate = typeof scopeEstimate === 'string'
        ? { scope: scopeEstimate }
        : scopeEstimate
      const routeResult = estimate.routeDecision ?? adaptation.dualProcessRouter.route({
        confidence: normalizedIntent.confidence ?? 0.5,
        riskLevel: estimate.riskLevel || 'medium',
        scope: estimate.scope || 'global',
      }, estimate)
      const nodes = planner.decompose(normalizedIntent, estimate, {})
      const dagId = `dag-${Date.now()}`
      const costEstimate = adaptation.budgetTracker.estimateCost?.({ nodes }) || { totalEstimate: 0 }
      const timeBudgetMs = (estimate.estimatedTimeMinutes || 20) * 60_000
      const tokenBudget = estimate.tokenBudget
        || (costEstimate.totalEstimate > 0 ? Math.round(costEstimate.totalEstimate * 1.15) : undefined)

      dag.createDAG(dagId, nodes, {
        intent: normalizedIntent,
        scopeEstimate: estimate,
        sessionId: estimate.sessionId ?? null,
        route: routeResult,
        timeBudgetMs,
        tokenBudget,
        phaseBudgets: estimate.phaseBudgets,
      })
      return {
        dagId,
        suggestedRole: nodes[0]?.role || 'implementer',
        summary: `${normalizedIntent.primary} plan with ${nodes.length} node(s)`,
        route: routeResult.route,
        complexity: routeResult.complexity,
        threshold: routeResult.threshold,
        timeBudgetMs,
        tokenBudget: tokenBudget ?? null,
        nodes,
      }
    },

    adviseSpawn: (taskScope, requestedRole, taskContext = {}) =>
      advisor.advise(taskScope || 'global', requestedRole, taskContext),

    selectTools: (roleId) => roleRegistry?.getTools?.(roleId) || [],
    getDomainStore,

    getTasks: () => getAllDAGEntries().map(([dagId, dagEntry]) => summarizeDAG(dagId, dagEntry, dag)),
    getDeadLetters: () => dag.getDeadLetterQueue?.() || [],
    getDAG: (dagId) => {
      const dagEntry = dag._dags?.get?.(dagId)
      return summarizeDAG(dagId, dagEntry, dag)
    },
    getProgress: (dagId) => {
      const dagEntry = dag._dags?.get?.(dagId)
      return computeProgress(dagId, dagEntry, dag)
    },
    getCriticalPath: () => criticalPath.analyze?.() || null,
    getModulatorState: () => adaptation.globalModulator.getStats?.() || {},
    getShapleyCredits: () => adaptation.shapleyCredit.getAllCredits?.() || {},
    getSpeciesState: () => adaptation.speciesEvolver.getState?.() || {},
    getCalibration: () => adaptation.signalCalibrator.getWeights?.() || {},
    getBudget: () => adaptation.budgetTracker.getStats?.() || {},
    getBudgetForecast: () => {
      const history = adaptation.budgetForecaster._history || []
      const byTaskType = {}
      for (const entry of history) {
        byTaskType[entry.taskType] = (byTaskType[entry.taskType] || 0) + 1
      }
      return {
        historyCount: history.length,
        lastRecordedAt: history[history.length - 1]?.timestamp || null,
        accuracy: adaptation.budgetForecaster.getAccuracy?.() || {
          meanAbsoluteError: Infinity,
          r2Score: 0,
        },
        byTaskType,
      }
    },
    getDualProcessStats: () => adaptation.dualProcessRouter.getStats?.() || {},
    getRoleDiscovery: () => adaptation.roleDiscovery.getState?.() || {},
    getSkillGovernor: () => adaptation.skillGovernor.getStats?.() || {},
    getCostReport: (dagId) => adaptation.budgetTracker.getCostReport?.(dagId) || {},
    getWorkflowState: () => workflow.getState?.() || null,

    getGovernanceStats: () => ({
      contractNet: contract.getStats?.() || {},
      resourceArbiter: arbiter.getStats?.() || {},
      deadlines: deadline.getStats?.() || {},
      roleManager: roles.getStats?.() || {},
    }),

    getTopology: () => ({
      moduleCount: allModules().length,
      dagCount: dag._dags?.size || 0,
      zones: Object.values(ZONES),
      domains: ['planning', 'scheduling', 'adaptation'],
    }),

    getTopologyGraph: () => {
      const modules = allModules()
      const nodes = modules.map((moduleInstance) => ({
        id: moduleInstance.constructor?.name || 'AnonymousModule',
        type: 'module',
      }))
      const edges = []
      for (const moduleInstance of modules) {
        const from = moduleInstance.constructor?.name || 'AnonymousModule'
        for (const dimension of moduleInstance.constructor?.produces?.() || []) {
          edges.push({ from, to: dimension, type: 'produces' })
        }
        for (const dimension of moduleInstance.constructor?.consumes?.() || []) {
          edges.push({ from: dimension, to: from, type: 'consumes' })
        }
      }
      return { nodes, edges }
    },

    getModuleManifest: () => allModules().map((moduleInstance) => ({
      id: moduleInstance.constructor?.name || 'AnonymousModule',
      produces: moduleInstance.constructor?.produces?.() || [],
      consumes: moduleInstance.constructor?.consumes?.() || [],
      publishes: moduleInstance.constructor?.publishes?.() || [],
      subscribes: moduleInstance.constructor?.subscribes?.() || [],
    })),

    getModuleInfo: (moduleId) => {
      const moduleInstance = allModules().find((entry) => entry.constructor?.name === moduleId)
      if (!moduleInstance) return null
      return {
        id: moduleId,
        produces: moduleInstance.constructor?.produces?.() || [],
        consumes: moduleInstance.constructor?.consumes?.() || [],
        publishes: moduleInstance.constructor?.publishes?.() || [],
        subscribes: moduleInstance.constructor?.subscribes?.() || [],
      }
    },

    getEmergencePatterns: () => ({
      roleDiscovery: adaptation.roleDiscovery.getState?.() || {},
      species: adaptation.speciesEvolver.getState?.() || {},
      shapley: adaptation.shapleyCredit.getAllCredits?.() || {},
    }),

    async start() {
      for (const moduleInstance of [
        workflow,
        dag,
        zone,
        planner,
        replan,
        criticalPath,
        synthesizer,
        advisor,
        hierarchy,
        contract,
        roles,
        deadline,
        arbiter,
      ]) {
        if (moduleInstance.start) await moduleInstance.start()
      }
      await adaptation.start()
    },

    async stop() {
      await adaptation.stop()
      for (const moduleInstance of [
        arbiter,
        deadline,
        roles,
        contract,
        hierarchy,
        advisor,
        synthesizer,
        criticalPath,
        replan,
        planner,
        zone,
        dag,
        workflow,
      ]) {
        if (moduleInstance.stop) await moduleInstance.stop()
      }
    },
  }
}

export { DAGEngine } from './planning/dag-engine.js'
export { ExecutionPlanner } from './planning/execution-planner.js'
export { ReplanEngine } from './planning/replan-engine.js'
export { CriticalPath } from './planning/critical-path.js'
export { ResultSynthesizer } from './planning/result-synthesizer.js'
export { ZoneManager, ZONES } from './planning/zone-manager.js'
export { SpawnAdvisor } from './scheduling/spawn-advisor.js'
export { HierarchicalCoord } from './scheduling/hierarchical-coord.js'
export { ContractNet } from './scheduling/contract-net.js'
export { RoleManager } from './scheduling/role-manager.js'
export { DeadlineTracker } from './scheduling/deadline-tracker.js'
export { ResourceArbiter } from './scheduling/resource-arbiter.js'
export { WorkflowLedger } from './workflow-ledger.js'
