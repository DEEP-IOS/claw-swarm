/**
 * Orchestration subsystem -- 编排层入口与工厂函数
 * Barrel export and factory for all orchestration modules.
 * Wires planning (DAG, execution planner, replan, critical path, synthesizer,
 * zone manager) and scheduling (spawn advisor, hierarchical coord, contract
 * net, role manager, deadline tracker, resource arbiter) into a single facade.
 *
 * @module orchestration
 * @version 9.0.0
 */

// -- Planning modules --------------------------------------------------------
import { DAGEngine } from './planning/dag-engine.js'
import { ExecutionPlanner } from './planning/execution-planner.js'
import { ReplanEngine } from './planning/replan-engine.js'
import { CriticalPath } from './planning/critical-path.js'
import { ResultSynthesizer } from './planning/result-synthesizer.js'
import { ZoneManager } from './planning/zone-manager.js'

// -- Scheduling modules ------------------------------------------------------
import { SpawnAdvisor } from './scheduling/spawn-advisor.js'
import { HierarchicalCoord } from './scheduling/hierarchical-coord.js'
import { ContractNet } from './scheduling/contract-net.js'
import { RoleManager } from './scheduling/role-manager.js'
import { DeadlineTracker } from './scheduling/deadline-tracker.js'
import { ResourceArbiter } from './scheduling/resource-arbiter.js'

// -- Adaptation subsystem ----------------------------------------------------
import { createAdaptationSystem } from './adaptation/index.js'

// ============================================================================
// Factory
// ============================================================================

/**
 * 创建完整编排子系统 / Create the orchestration subsystem with all modules wired.
 *
 * @param {object} deps
 * @param {object} deps.field             - SignalField / SignalStore 实例
 * @param {object} deps.bus               - EventBus 实例
 * @param {object} deps.store             - 持久化存储
 * @param {object} [deps.capabilityEngine]  - 能力引擎
 * @param {object} [deps.hybridRetrieval]   - 混合检索引擎
 * @param {object} [deps.roleRegistry]      - 角色注册表
 * @param {object} [deps.modelCapability]   - 模型能力描述
 * @param {object} [deps.artifactRegistry]  - 产物注册表
 * @param {object} [deps.config]            - 子系统配置 { dag, spawn, hierarchy, arbiter }
 * @returns {object} orchestration subsystem facade
 */
export function createOrchestrationSystem(deps) {
  const {
    field, bus, store, capabilityEngine, hybridRetrieval,
    roleRegistry, modelCapability, artifactRegistry, config,
  } = deps

  const dag          = new DAGEngine({ field, bus, store, config: config?.dag })
  const zone         = new ZoneManager({ field, store })
  const planner      = new ExecutionPlanner({ field, bus, capabilityEngine, hybridRetrieval })
  const replan       = new ReplanEngine({ field, bus, dagEngine: dag })
  const criticalPath = new CriticalPath({ field, bus })
  const synthesizer  = new ResultSynthesizer({ field, bus, artifactRegistry })
  const advisor      = new SpawnAdvisor({ field, bus, roleRegistry, modelCapability, config: config?.spawn })
  const hierarchy    = new HierarchicalCoord({ field, bus, config: config?.hierarchy })
  const contract     = new ContractNet({ field, bus, capabilityEngine })
  const roles        = new RoleManager({ field, bus, roleRegistry })
  const deadline     = new DeadlineTracker({ field, bus })
  const arbiter      = new ResourceArbiter({ field, bus, zoneManager: zone, config: config?.arbiter })

  // ── Adaptation subsystem (10 modules) ──────────────────────────
  const adaptation = createAdaptationSystem({
    field, bus, store, roleRegistry, capabilityEngine,
    config: config?.adaptation,
  })

  return {
    dag, planner, replan, criticalPath, synthesizer, zone,
    advisor, hierarchy, contract, roles, deadline, arbiter,
    adaptation,

    /**
     * 返回所有模块实例列表（含 adaptation，用于生命周期管理和耦合验证）
     * @returns {import('../../core/module-base.js').ModuleBase[]}
     */
    allModules() {
      return [
        dag, zone, planner, replan, criticalPath, synthesizer,
        advisor, hierarchy, contract, roles, deadline, arbiter,
        ...adaptation.allModules(),
      ]
    },

    // ── Dashboard query delegations ──────────────────────────────

    getTasks: () => dag.getAllDAGStatus?.() || [],
    getDeadLetters: () => dag.getDeadLetters?.() || [],
    getDAG: (dagId) => dag.getDAGStatus?.(dagId) || null,
    getCriticalPath: () => criticalPath.analyze?.() || null,
    getModulatorState: () => adaptation.globalModulator.getStats?.() || {},
    getShapleyCredits: () => adaptation.shapleyCredit.getAllCredits?.() || {},
    getSpeciesState: () => adaptation.speciesEvolver.getState?.() || {},
    getCalibration: () => adaptation.signalCalibrator.getWeights?.() || {},
    getBudget: () => adaptation.budgetTracker.getStats?.() || {},
    getBudgetForecast: () => adaptation.budgetForecaster.forecast?.() || {},
    getDualProcessStats: () => adaptation.dualProcessRouter.getStats?.() || {},
    getRoleDiscovery: () => adaptation.roleDiscovery.getState?.() || {},
    getSkillGovernor: () => adaptation.skillGovernor.getStats?.() || {},
    getCostReport: (dagId) => adaptation.budgetTracker.getCostReport?.(dagId) || {},

    /**
     * 启动所有模块 (planning + scheduling + adaptation)
     * @returns {Promise<void>}
     */
    async start() {
      for (const m of [dag, zone, planner, replan, criticalPath, synthesizer,
                        advisor, hierarchy, contract, roles, deadline, arbiter]) {
        if (m.start) await m.start()
      }
      await adaptation.start()
    },

    /**
     * 停止所有模块 (reverse order)
     * @returns {Promise<void>}
     */
    async stop() {
      await adaptation.stop()
      for (const m of [arbiter, deadline, roles, contract, hierarchy, advisor,
                        synthesizer, criticalPath, replan, planner, zone, dag]) {
        if (m.stop) await m.stop()
      }
    },
  }
}

// ============================================================================
// Re-exports — 所有模块类的具名导出
// ============================================================================

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
