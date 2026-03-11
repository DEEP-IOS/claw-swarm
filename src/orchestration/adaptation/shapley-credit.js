/**
 * ShapleyCredit -- Monte Carlo Shapley 信用分配
 * Monte Carlo Shapley credit attribution for DAG agent contributions
 *
 * DAG 完成后，通过蒙特卡洛采样近似各 Agent 的 Shapley 值，
 * 用于驱动声誉信号和排行榜。
 * After DAG completion, approximate each agent's Shapley value via
 * Monte Carlo sampling, driving reputation signals and leaderboards.
 *
 * 公式 / Formula:
 *   phi_i ~ (1/M) * SUM_{m=1}^{M} [v(S_m union {i}) - v(S_m)]
 *
 * @module orchestration/adaptation/shapley-credit
 * @version 9.0.0
 */

import { ModuleBase } from '../../core/module-base.js'
import { DIM_REPUTATION, DIM_TRAIL } from '../../core/field/types.js'

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_CONFIG = {
  /** Monte Carlo sample count / 蒙特卡洛采样数 */
  samples: 100,
  /** Threshold to use worker-based parallel computation / 并行计算阈值 */
  workerThreshold: 10,
}

// ============================================================================
// ShapleyCredit
// ============================================================================

export class ShapleyCredit extends ModuleBase {
  /** @returns {string[]} */
  static produces() { return [DIM_REPUTATION] }
  /** @returns {string[]} */
  static consumes() { return [DIM_TRAIL] }
  /** @returns {string[]} */
  static publishes() { return ['shapley.computed'] }
  /** @returns {string[]} */
  static subscribes() { return ['dag.completed'] }

  /**
   * @param {Object}  opts
   * @param {Object}  opts.field           - SignalField instance
   * @param {Object}  opts.bus             - EventBus instance
   * @param {Object}  [opts.reputationCRDT] - CRDT for reputation counters
   * @param {Object}  [opts.config]        - optional overrides
   */
  constructor({ field, bus, reputationCRDT, config = {} }) {
    super()
    /** @private */ this._field = field
    /** @private */ this._bus = bus
    /** @private */ this._reputationCRDT = reputationCRDT ?? null
    /** @private */ this._config = { ...DEFAULT_CONFIG, ...config }

    /**
     * Per-DAG Shapley credit maps
     * @private @type {Map<string, Map<string, number>>}
     */
    this._dagCredits = new Map()

    /**
     * Cumulative leaderboard across all DAGs
     * @private @type {Map<string, number>}
     */
    this._leaderboard = new Map()
  }

  // --------------------------------------------------------------------------
  // Lifecycle
  // --------------------------------------------------------------------------

  async start() {
    this._unsub = this._bus?.on?.('dag.completed', (evt) => {
      const { dagId, contributions } = evt?.payload ?? evt ?? {}
      if (dagId && contributions) this.compute(dagId, contributions)
    })
  }

  async stop() {
    if (typeof this._unsub === 'function') this._unsub()
  }

  // --------------------------------------------------------------------------
  // Core: Monte Carlo Shapley
  // --------------------------------------------------------------------------

  /**
   * Compute approximate Shapley values for agents in a completed DAG.
   *
   * @param {string} dagId - DAG identifier
   * @param {Map<string,{quality:number, role?:string}>} agentContributions
   *   Map from agentId to contribution descriptor
   * @returns {Map<string, number>} shapleyValues per agent
   */
  compute(dagId, agentContributions) {
    const agents = [...agentContributions.keys()]
    const n = agents.length
    if (n === 0) return new Map()

    // Accumulate marginal contributions
    const marginals = new Map(agents.map(a => [a, 0]))
    const M = this._config.samples

    for (let m = 0; m < M; m++) {
      const perm = this._shuffle([...agents])
      const coalition = []
      let prevValue = 0

      for (const agent of perm) {
        coalition.push(agent)
        const currentValue = this._evaluateCoalition(coalition, agentContributions)
        marginals.set(agent, marginals.get(agent) + (currentValue - prevValue))
        prevValue = currentValue
      }
    }

    // Average and compute total value for normalization
    const totalValue = this._evaluateCoalition(agents, agentContributions)
    const shapleyValues = new Map()
    let rawSum = 0

    for (const agent of agents) {
      shapleyValues.set(agent, marginals.get(agent) / M)
      rawSum += marginals.get(agent) / M
    }

    // Normalize so sum ~ totalValue
    if (rawSum !== 0 && totalValue !== 0) {
      const scale = totalValue / rawSum
      for (const agent of agents) {
        shapleyValues.set(agent, shapleyValues.get(agent) * scale)
      }
    }

    // Drive reputation via CRDT and emit signals
    for (const [agentId, value] of shapleyValues) {
      if (this._reputationCRDT) {
        if (value > 0) this._reputationCRDT.increment(agentId)
        else if (value < -0.1) this._reputationCRDT.decrement(agentId)
      }

      // Emit DIM_REPUTATION signal into field
      this._field?.emit?.({
        dimension: DIM_REPUTATION,
        scope: agentId,
        strength: Math.min(Math.abs(value), 1),
        emitterId: `shapley:${dagId}`,
        metadata: { dagId, shapleyValue: value },
      })

      // Update cumulative leaderboard
      this._leaderboard.set(
        agentId,
        (this._leaderboard.get(agentId) ?? 0) + value,
      )
    }

    // Store per-DAG credits
    this._dagCredits.set(dagId, shapleyValues)

    // Publish event
    this._bus?.emit?.('shapley.computed', {
      dagId,
      values: Object.fromEntries(shapleyValues),
      totalValue,
    })

    return shapleyValues
  }

  // --------------------------------------------------------------------------
  // Coalition evaluation
  // --------------------------------------------------------------------------

  /**
   * Evaluate the value of a coalition (subset of agents).
   * v(S) = sum(quality_i) + collaborationBonus
   *
   * @param {string[]} coalition - agent IDs in the coalition
   * @param {Map<string,{quality:number}>} contributions
   * @returns {number}
   */
  _evaluateCoalition(coalition, contributions) {
    if (coalition.length === 0) return 0

    let qualitySum = 0
    for (const agentId of coalition) {
      const c = contributions.get(agentId)
      qualitySum += c?.quality ?? 0
    }

    // Collaboration bonus: 0.1 * (n-1) when n > 1
    const n = coalition.length
    const collaborationBonus = n > 1 ? 0.1 * (n - 1) : 0

    return qualitySum + collaborationBonus
  }

  // --------------------------------------------------------------------------
  // Fisher-Yates shuffle
  // --------------------------------------------------------------------------

  /**
   * Shuffle an array in-place using Fisher-Yates algorithm.
   * @param {any[]} arr
   * @returns {any[]} the same array, shuffled
   */
  _shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]]
    }
    return arr
  }

  // --------------------------------------------------------------------------
  // Queries
  // --------------------------------------------------------------------------

  /**
   * Get the cumulative leaderboard sorted by total Shapley value.
   * @param {number} [limit=10] - max entries to return
   * @returns {{ agentId: string, totalValue: number }[]}
   */
  getLeaderboard(limit = 10) {
    return [...this._leaderboard.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([agentId, totalValue]) => ({ agentId, totalValue }))
  }

  /**
   * Get Shapley credit allocation for a specific DAG.
   * @param {string} dagId
   * @returns {Map<string, number>|undefined}
   */
  getDAGCredits(dagId) {
    return this._dagCredits.get(dagId)
  }
}

export default ShapleyCredit
