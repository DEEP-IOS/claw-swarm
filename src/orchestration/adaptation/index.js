/**
 * Adaptation System -- Factory and facade for the R5 adaptation layer
 *
 * Instantiates all 10 adaptation modules and exposes a unified interface
 * for lifecycle management (start/stop) and module access.
 *
 * @module orchestration/adaptation/index
 * @version 9.0.0
 * @author DEEP-IOS
 */

import { DualProcessRouter }  from './dual-process-router.js'
import { GlobalModulator }    from './global-modulator.js'
import { ResponseThreshold }  from './response-threshold.js'
import { SignalCalibrator }   from './signal-calibrator.js'
import { ShapleyCredit }      from './shapley-credit.js'
import { SpeciesEvolver }     from './species-evolver.js'
import { RoleDiscovery }      from './role-discovery.js'
import { SkillGovernor }      from './skill-governor.js'
import { BudgetTracker }      from './budget-tracker.js'
import { BudgetForecaster }   from './budget-forecaster.js'

const ADAPTATION_STATE_COLLECTION = 'adaptation-state'

function createAdaptationBus(bus) {
  if (!bus) return null

  return {
    publish: (...args) => bus.publish?.(...args) ?? bus.emit?.(...args),
    emit: (...args) => bus.emit?.(...args) ?? bus.publish?.(...args),
    subscribe: (...args) => bus.subscribe?.(...args),
    unsubscribe: (...args) => bus.unsubscribe?.(...args),
    on(topic, handler) {
      if (typeof bus.on === 'function') {
        return bus.on(topic, handler)
      }
      if (typeof bus.subscribe === 'function') {
        const wrapped = (envelope) => handler(envelope?.data ?? envelope)
        bus.subscribe(topic, wrapped)
        return () => bus.unsubscribe?.(topic, wrapped)
      }
      return () => {}
    },
  }
}

function createAdaptationStore(store) {
  if (!store) return null

  return {
    put: (...args) => store.put?.(...args),
    query: (...args) => store.query?.(...args) ?? [],
    queryAll: (...args) => store.queryAll?.(...args) ?? [],
    count: (...args) => store.count?.(...args) ?? 0,
    has(collectionOrKey, maybeKey) {
      if (maybeKey === undefined) {
        return store.has?.(ADAPTATION_STATE_COLLECTION, collectionOrKey) ?? false
      }
      return store.has?.(collectionOrKey, maybeKey) ?? false
    },
    delete(collectionOrKey, maybeKey) {
      if (maybeKey === undefined) {
        return store.delete?.(ADAPTATION_STATE_COLLECTION, collectionOrKey) ?? false
      }
      return store.delete?.(collectionOrKey, maybeKey) ?? false
    },
    get(collectionOrKey, maybeKey) {
      if (maybeKey === undefined) {
        return store.get?.(ADAPTATION_STATE_COLLECTION, collectionOrKey)
      }
      return store.get?.(collectionOrKey, maybeKey)
    },
    set(key, value) {
      store.put?.(ADAPTATION_STATE_COLLECTION, key, value)
      return value
    },
  }
}

/**
 * Create the full adaptation system with all 10 modules.
 *
 * @param {Object} deps
 * @param {Object} deps.field            - Signal field
 * @param {Object} deps.bus              - Event bus
 * @param {Object} [deps.store]          - Persistence store
 * @param {Object} [deps.roleRegistry]   - Role registry
 * @param {Object} [deps.capabilityEngine] - Capability engine
 * @param {Object} [deps.reputationCRDT] - Reputation CRDT
 * @param {Object} [deps.config]         - Configuration overrides
 * @returns {{ allModules: () => Object[], start: () => Promise<void>, stop: () => Promise<void>, dualProcessRouter: DualProcessRouter, globalModulator: GlobalModulator, responseThreshold: ResponseThreshold, signalCalibrator: SignalCalibrator, shapleyCredit: ShapleyCredit, speciesEvolver: SpeciesEvolver, roleDiscovery: RoleDiscovery, skillGovernor: SkillGovernor, budgetTracker: BudgetTracker, budgetForecaster: BudgetForecaster }}
 */
export function createAdaptationSystem(deps) {
  const { field, bus, store, roleRegistry, capabilityEngine, reputationCRDT, config = {} } = deps
  const adaptationBus = createAdaptationBus(bus)
  const adaptationStore = createAdaptationStore(store)

  const dualProcessRouter = new DualProcessRouter({ field, bus: adaptationBus, store: adaptationStore, config: config.dualProcess })
  const globalModulator   = new GlobalModulator({ field, bus: adaptationBus, store: adaptationStore, config: config.modulator })
  const responseThreshold = new ResponseThreshold({ field, bus: adaptationBus, store: adaptationStore, config: config.threshold })
  const signalCalibrator  = new SignalCalibrator({ field, bus: adaptationBus, store: adaptationStore, config: config.calibrator })
  const shapleyCredit     = new ShapleyCredit({ field, bus: adaptationBus, reputationCRDT, config: config.shapley })
  const speciesEvolver    = new SpeciesEvolver({ field, bus: adaptationBus, store: adaptationStore, roleRegistry, config: config.species })
  const roleDiscovery     = new RoleDiscovery({ field, bus: adaptationBus, store: adaptationStore, roleRegistry, reputationCRDT, config: config.discovery })
  const skillGovernor     = new SkillGovernor({ field, bus: adaptationBus, store: adaptationStore, capabilityEngine })
  const budgetTracker     = new BudgetTracker({ field, bus: adaptationBus, config: config.budget })
  const budgetForecaster  = new BudgetForecaster({ field, bus: adaptationBus, store: adaptationStore })

  const modules = [
    dualProcessRouter, globalModulator, responseThreshold, signalCalibrator,
    shapleyCredit, speciesEvolver, roleDiscovery,
    skillGovernor, budgetTracker, budgetForecaster,
  ]

  return {
    // Direct access to each module
    dualProcessRouter,
    globalModulator,
    responseThreshold,
    signalCalibrator,
    shapleyCredit,
    speciesEvolver,
    roleDiscovery,
    skillGovernor,
    budgetTracker,
    budgetForecaster,

    /** @returns {Object[]} All 10 adaptation modules */
    allModules() { return [...modules] },

    /** Start all modules in order */
    async start() {
      for (const m of modules) {
        await m.start()
      }
    },

    /** Stop all modules in reverse order */
    async stop() {
      for (let i = modules.length - 1; i >= 0; i--) {
        await modules[i].stop()
      }
    },
  }
}

// Re-export all module classes
export { DualProcessRouter }  from './dual-process-router.js'
export { GlobalModulator }    from './global-modulator.js'
export { ResponseThreshold }  from './response-threshold.js'
export { SignalCalibrator }   from './signal-calibrator.js'
export { ShapleyCredit }      from './shapley-credit.js'
export { SpeciesEvolver }     from './species-evolver.js'
export { RoleDiscovery }      from './role-discovery.js'
export { SkillGovernor }      from './skill-governor.js'
export { BudgetTracker }      from './budget-tracker.js'
export { BudgetForecaster }   from './budget-forecaster.js'
