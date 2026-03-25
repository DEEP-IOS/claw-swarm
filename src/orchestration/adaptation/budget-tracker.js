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
 * Subscribes: dag.created, dag.phase.completed, dag.completed
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
  static subscribes()  { return ['dag.created', 'dag.phase.completed', 'dag.completed'] }

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

    this._unsubscribers = []
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
  allocateBudget(dagId, totalBudget, phases, metadata = {}) {
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

    this._budgets.set(dagId, {
      totalBudget: budget,
      spent: 0,
      phases: phaseAlloc,
      metadata: { ...metadata },
    })
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
    const report = this.getCostReport(dagId)
    if (!report) return null

    this._bus?.publish?.('budget.report.generated', {
      dagId,
      report,
      timestamp: Date.now(),
    })

    return report
  }

  /**
   * Get the current cost report for a DAG without emitting an event.
   *
   * @param {string} dagId
   * @returns {Object | null}
   */
  getCostReport(dagId) {
    const record = this._budgets.get(dagId)
    if (!record) return null

    const utilization = record.spent / record.totalBudget
    return {
      dagId,
      totalBudget:  record.totalBudget,
      spent:        record.spent,
      remaining:    Math.max(0, record.totalBudget - record.spent),
      utilization:  Math.round(utilization * 10000) / 10000,
      phases:       { ...record.phases },
      metadata:     { ...(record.metadata ?? {}) },
      overrun:      utilization > 1.0,
      timestamp:    Date.now(),
    }
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

  /**
   * Get aggregate budget tracker stats for dashboards/facades.
   * @returns {{ dagCount: number, dags: Array<Object>, global: Object }}
   */
  getStats() {
    const dags = [...this._budgets.entries()].map(([dagId]) => this.getCostReport(dagId))
      .filter(Boolean)
    return {
      dagCount: dags.length,
      dags,
      global: this.getGlobalBudget(),
    }
  }

  // --------------------------------------------------------------------------
  // Lifecycle
  // --------------------------------------------------------------------------

  async start() {
    const listen = this._bus?.on?.bind(this._bus)
    if (!listen) return

    this._unsubscribers.push(
      listen('dag.created', (payload) => this._onDagCreated(payload)),
      listen('dag.phase.completed', (payload) => this._onDagPhaseCompleted(payload)),
      listen('dag.completed', (payload) => this._onDagCompleted(payload)),
    )
  }

  async stop()  {
    for (const unsubscribe of this._unsubscribers.splice(0)) {
      unsubscribe?.()
    }
  }

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

  _onDagCreated(payload) {
    const dagId = payload?.dagId
    if (!dagId || this._budgets.has(dagId)) return

    const explicitBudget = payload?.tokenBudget
      ?? payload?.metadata?.tokenBudget

    const estimated = this.estimateCost({
      nodes: Array.isArray(payload?.nodes)
        ? payload.nodes.map((node) => ({
          id: node.id,
          role: node.role,
          model: node.model,
          prompt: node.taskId,
        }))
        : [],
    })

    const tokenBudget = explicitBudget
      ?? (estimated.totalEstimate > 0 ? Math.round(estimated.totalEstimate * 1.15) : this._config.defaultBudgetPerDAG)

    this.allocateBudget(
      dagId,
      tokenBudget,
      payload?.phaseBudgets ?? payload?.metadata?.phaseBudgets,
      {
        route: payload?.route ?? payload?.metadata?.route ?? null,
        intent: payload?.intent ?? payload?.metadata?.intent ?? null,
        timeBudgetMs: payload?.timeBudgetMs ?? payload?.metadata?.timeBudgetMs ?? null,
        estimatedTokens: estimated.totalEstimate || null,
      },
    )
  }

  _onDagPhaseCompleted(payload) {
    const dagId = payload?.dagId
    const nodeId = payload?.nodeId
    if (!dagId || !nodeId || !this._budgets.has(dagId)) return

    const actualTokens = this._extractActualTokens(payload?.result)
    if (typeof actualTokens === 'number' && actualTokens > 0) {
      this.recordSpend(dagId, nodeId, actualTokens)
    } else {
      // Fallback: estimate tokens from role + model when result lacks usage data.
      // Without this, budgets show spent=0 after real task execution.
      const role = payload?.role || 'default'
      const model = payload?.result?.model || 'balanced'
      const baseCost = MODEL_COSTS[model] || MODEL_COSTS.balanced
      const roleFactor = ROLE_COST_FACTOR[role] || 1.0
      this.recordSpend(dagId, nodeId, Math.round(baseCost * roleFactor))
    }
  }

  _onDagCompleted(payload) {
    const dagId = payload?.dagId
    if (!dagId || !this._budgets.has(dagId)) return
    this.generateCostReport(dagId)
  }

  _extractActualTokens(result) {
    if (!result || typeof result !== 'object') return null

    const direct = [
      result.tokensUsed,
      result.totalTokens,
      result.tokenCount,
      result.usage?.total,
      result.usage?.totalTokens,
      result.usage?.total_tokens,
      result.tokenUsage?.total,
      result.tokenUsage?.totalTokens,
      result.tokenUsage?.total_tokens,
    ]

    for (const value of direct) {
      if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
        return value
      }
    }

    const prompt = result.usage?.promptTokens
      ?? result.usage?.prompt_tokens
      ?? result.tokenUsage?.promptTokens
      ?? result.tokenUsage?.prompt_tokens
    const completion = result.usage?.completionTokens
      ?? result.usage?.completion_tokens
      ?? result.tokenUsage?.completionTokens
      ?? result.tokenUsage?.completion_tokens

    if (typeof prompt === 'number' && typeof completion === 'number') {
      return prompt + completion
    }

    return null
  }
}
