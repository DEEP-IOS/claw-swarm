/**
 * BudgetTracker -- DAG-level token budget allocation, spend tracking, and overrun detection
 *
 * Tracks per-DAG budgets with CJK-aware token estimation, model cost tables,
 * and role cost factors. Emits warnings at configurable thresholds and suggests
 * model downgrades when budgets run low.
 *
 * Produces:  DIM_TASK       (budget overrun signals)
 * Consumes:  DIM_LEARNING   (learning efficiency for cost adjustment)
 * Publishes: budget.warning, budget.exceeded, budget.report.generated
 * Subscribes: agent.completed, dag.created
 *
 * @module orchestration/adaptation/budget-tracker
 * @version 9.0.0
 * @author DEEP-IOS
 */

import { ModuleBase } from '../../core/module-base.js'
import { DIM_TASK, DIM_LEARNING } from '../../core/field/types.js'

// ============================================================================
// Constants
// ============================================================================

/** Base token cost per model tier */
const MODEL_COSTS = Object.freeze({
  fast:      500,
  balanced:  2000,
  strong:    5000,
  reasoning: 10000,
})

/** Role-based cost multiplier */
const ROLE_COST_FACTOR = Object.freeze({
  researcher:  0.8,
  analyst:     1.0,
  planner:     0.7,
  implementer: 1.5,
  debugger:    1.3,
  tester:      1.0,
  reviewer:    0.6,
  consultant:  1.0,
  coordinator: 0.5,
  librarian:   0.6,
})

/** CJK Unicode range test */
const CJK_RE = /[\u4e00-\u9fff\u3400-\u4dbf\u3000-\u303f\uff00-\uffef]/

// ============================================================================
// BudgetTracker
// ============================================================================

export class BudgetTracker extends ModuleBase {

  static produces()    { return [DIM_TASK] }
  static consumes()    { return [DIM_LEARNING] }
  static publishes()   { return ['budget.warning', 'budget.exceeded', 'budget.report.generated'] }
  static subscribes()  { return ['agent.completed', 'dag.created'] }

  /**
   * @param {Object} deps
   * @param {Object} deps.field  - Signal field
   * @param {Object} deps.bus    - Event bus
   * @param {Object} [deps.config]
   * @param {number} [deps.config.defaultBudgetPerDAG=100000]
   * @param {number} [deps.config.warningThreshold=0.8]
   * @param {number} [deps.config.globalSessionBudget=500000]
   */
  constructor({ field, bus, config = {}, ...rest } = {}) {
    super()
    this._field  = field
    this._bus    = bus
    this._config = {
      defaultBudgetPerDAG:  config.defaultBudgetPerDAG  ?? 100000,
      warningThreshold:     config.warningThreshold     ?? 0.8,
      globalSessionBudget:  config.globalSessionBudget  ?? 500000,
    }

    /** @type {Map<string, { totalBudget: number, spent: number, phases: Object }>} */
    this._budgets = new Map()

    /** @type {{ totalSession: number, spent: number }} */
    this._globalBudget = {
      totalSession: this._config.globalSessionBudget,
      spent:        0,
    }
  }

  // --------------------------------------------------------------------------
  // Core API
  // --------------------------------------------------------------------------

  /**
   * Estimate token cost for a DAG plan.
   *
   * CJK-aware: CJK characters ~ 2 tokens each, ASCII words ~ 1.3 tokens each.
   *
   * @param {Object} dagPlan - { nodes: [{ role, model, prompt }] }
   * @returns {{ totalEstimate: number, perNode: Object[], confidence: number }}
   */
  estimateCost(dagPlan) {
    if (!dagPlan?.nodes?.length) {
      return { totalEstimate: 0, perNode: [], confidence: 0 }
    }

    const perNode = []
    let totalEstimate = 0

    for (const node of dagPlan.nodes) {
      const baseCost   = MODEL_COSTS[node.model] || MODEL_COSTS.balanced
      const roleFactor = ROLE_COST_FACTOR[node.role] || 1.0

      // CJK-aware token estimation for prompt content
      let promptTokens = 0
      if (node.prompt) {
        promptTokens = this._estimateTokens(node.prompt)
      }

      const nodeCost = Math.round(baseCost * roleFactor + promptTokens)
      perNode.push({ nodeId: node.id || node.role, estimatedTokens: nodeCost })
      totalEstimate += nodeCost
    }

    const confidence = dagPlan.nodes.length >= 3 ? 0.7 : 0.5
    return { totalEstimate, perNode, confidence }
  }

  /**
   * Allocate a budget for a DAG execution.
   *
   * @param {string} dagId
   * @param {number} [totalBudget] - defaults to config.defaultBudgetPerDAG
   * @param {Object} [phases] - optional phase allocation map { phaseName: fraction }
   */
  allocateBudget(dagId, totalBudget, phases) {
    const budget = totalBudget || this._config.defaultBudgetPerDAG

    const phaseAlloc = {}
    if (phases && typeof phases === 'object') {
      for (const [name, fraction] of Object.entries(phases)) {
        phaseAlloc[name] = { allocated: Math.round(budget * fraction), spent: 0 }
      }
    } else {
      // Default even split: plan 20%, execute 60%, review 20%
      phaseAlloc.plan    = { allocated: Math.round(budget * 0.2), spent: 0 }
      phaseAlloc.execute = { allocated: Math.round(budget * 0.6), spent: 0 }
      phaseAlloc.review  = { allocated: Math.round(budget * 0.2), spent: 0 }
    }

    this._budgets.set(dagId, { totalBudget: budget, spent: 0, phases: phaseAlloc })
  }

  /**
   * Record actual token spend for a node within a DAG.
   *
   * Emits budget.warning at warningThreshold, budget.exceeded at 100%.
   *
   * @param {string} dagId
   * @param {string} nodeId
   * @param {number} actualTokens
   */
  recordSpend(dagId, nodeId, actualTokens) {
    const record = this._budgets.get(dagId)
    if (!record) return

    record.spent += actualTokens
    this._globalBudget.spent += actualTokens

    const utilization = record.spent / record.totalBudget

    if (utilization > 1.0) {
      this._bus?.publish?.('budget.exceeded', {
        dagId, nodeId, spent: record.spent,
        totalBudget: record.totalBudget, utilization,
        timestamp: Date.now(),
      })
      // Emit DIM_TASK overrun signal
      this._field?.emit?.({
        dimension: DIM_TASK,
        scope:     `budget:${dagId}`,
        strength:  Math.min(1.0, utilization - 1.0),
        emitterId: 'budget-tracker',
        metadata:  { dagId, overrun: true, utilization },
      })
    } else if (utilization > this._config.warningThreshold) {
      this._bus?.publish?.('budget.warning', {
        dagId, nodeId, spent: record.spent,
        totalBudget: record.totalBudget, utilization,
        timestamp: Date.now(),
      })
    }
  }

  /**
   * Check whether a DAG has overrun its budget.
   *
   * @param {string} dagId
   * @returns {{ overrun: boolean, utilization: number, suggestion?: string } | null}
   */
  checkOverrun(dagId) {
    const record = this._budgets.get(dagId)
    if (!record) return null

    const utilization = record.spent / record.totalBudget
    const overrun     = utilization > 1.0

    const result = { overrun, utilization: Math.round(utilization * 10000) / 10000 }

    if (utilization > 0.9) {
      result.suggestion = 'Switch to fast model and reduce agent count'
    } else if (utilization > 0.7) {
      result.suggestion = 'Consider switching to fast model'
    }

    return result
  }

  /**
   * Generate a cost report for a DAG.
   *
   * @param {string} dagId
   * @returns {Object | null}
   */
  generateCostReport(dagId) {
    const record = this._budgets.get(dagId)
    if (!record) return null

    const utilization = record.spent / record.totalBudget
    const report = {
      dagId,
      totalBudget:  record.totalBudget,
      spent:        record.spent,
      remaining:    Math.max(0, record.totalBudget - record.spent),
      utilization:  Math.round(utilization * 10000) / 10000,
      phases:       { ...record.phases },
      overrun:      utilization > 1.0,
      timestamp:    Date.now(),
    }

    this._bus?.publish?.('budget.report.generated', {
      dagId,
      report,
      timestamp: Date.now(),
    })

    return report
  }

  /**
   * Suggest a model tier based on budget utilization.
   *
   * >70% utilization -> 'fast'
   * >90% utilization -> 'fast' + reduceAgents
   *
   * @param {string} dagId
   * @returns {{ model: string, reduceAgents?: boolean } | null}
   */
  suggestModel(dagId) {
    const record = this._budgets.get(dagId)
    if (!record) return null

    const utilization = record.spent / record.totalBudget

    if (utilization > 0.9) {
      return { model: 'fast', reduceAgents: true }
    } else if (utilization > 0.7) {
      return { model: 'fast' }
    }

    return null
  }

  /**
   * Get the global session budget status.
   * @returns {{ totalSession: number, spent: number, remaining: number, utilization: number }}
   */
  getGlobalBudget() {
    const remaining   = Math.max(0, this._globalBudget.totalSession - this._globalBudget.spent)
    const utilization = this._globalBudget.totalSession > 0
      ? this._globalBudget.spent / this._globalBudget.totalSession
      : 0
    return {
      totalSession: this._globalBudget.totalSession,
      spent:        this._globalBudget.spent,
      remaining,
      utilization:  Math.round(utilization * 10000) / 10000,
    }
  }

  // --------------------------------------------------------------------------
  // Lifecycle
  // --------------------------------------------------------------------------

  async start() {}
  async stop()  {}

  // --------------------------------------------------------------------------
  // Internal
  // --------------------------------------------------------------------------

  /**
   * CJK-aware token estimation.
   * CJK characters ~ 2 tokens each, ASCII words ~ 1.3 tokens each.
   *
   * @param {string} text
   * @returns {number}
   * @private
   */
  _estimateTokens(text) {
    if (!text) return 0

    let tokens = 0
    for (const char of text) {
      if (CJK_RE.test(char)) {
        tokens += 2
      } else if (/\s/.test(char)) {
        // whitespace delimits ASCII words; counted below
      } else {
        // Accumulate for ASCII word counting
      }
    }

    // Count ASCII words (non-CJK sequences split by whitespace)
    const asciiWords = text.replace(/[\u4e00-\u9fff\u3400-\u4dbf\u3000-\u303f\uff00-\uffef]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 0)
    tokens += Math.round(asciiWords.length * 1.3)

    return tokens
  }
}
