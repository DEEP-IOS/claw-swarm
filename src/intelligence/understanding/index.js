/**
 * Understanding subsystem — 理解子系统入口
 * Bundles IntentClassifier, RequirementClarifier, and ScopeEstimator
 *
 * @module intelligence/understanding
 * @version 9.0.0
 */

import { IntentClassifier } from './intent-classifier.js'
import { RequirementClarifier } from './requirement-clarifier.js'
import { ScopeEstimator } from './scope-estimator.js'

/**
 * Create and wire the understanding subsystem
 * @param {{ field: object, bus: object }} deps
 * @returns {{ intent: IntentClassifier, clarifier: RequirementClarifier, scope: ScopeEstimator, allModules: Function, start: Function, stop: Function }}
 */
export function createUnderstandingSystem(deps) {
  const { field, bus } = deps
  return {
    intent: new IntentClassifier({ field, bus }),
    clarifier: new RequirementClarifier({ field, bus }),
    scope: new ScopeEstimator({ field }),

    allModules() {
      return [this.intent, this.clarifier, this.scope]
    },

    async start() {
      for (const m of this.allModules()) {
        if (m.start) await m.start()
      }
    },

    async stop() {
      for (const m of this.allModules()) {
        if (m.stop) await m.stop()
      }
    },
  }
}

export { IntentClassifier, RequirementClarifier, ScopeEstimator }
