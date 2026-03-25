/**
 * ModelCapability — LLM 模型能力注册与选择
 * LLM model capability registry and selection
 *
 * @module intelligence/identity/model-capability
 * @version 9.0.0
 */

import { ModuleBase } from '../../core/module-base.js'

// 5 built-in model definitions
const MODELS = new Map([
  ['sonnet-4', {
    provider: 'anthropic',
    contextWindow: 200000,
    maxOutput: 8192,
    costPer1kInput: 0.003,
    costPer1kOutput: 0.015,
    categories: ['general', 'coding', 'analysis', 'writing'],
    latencyClass: 'medium',
    qualityTier: 'high',
  }],
  ['haiku-3.5', {
    provider: 'anthropic',
    contextWindow: 200000,
    maxOutput: 8192,
    costPer1kInput: 0.0008,
    costPer1kOutput: 0.004,
    categories: ['general', 'fast-response', 'monitoring'],
    latencyClass: 'low',
    qualityTier: 'medium',
  }],
  ['opus-4', {
    provider: 'anthropic',
    contextWindow: 200000,
    maxOutput: 8192,
    costPer1kInput: 0.015,
    costPer1kOutput: 0.075,
    categories: ['reasoning', 'planning', 'complex-analysis', 'specialist'],
    latencyClass: 'high',
    qualityTier: 'frontier',
  }],
  ['gpt-4o', {
    provider: 'openai',
    contextWindow: 128000,
    maxOutput: 4096,
    costPer1kInput: 0.005,
    costPer1kOutput: 0.015,
    categories: ['general', 'coding', 'analysis'],
    latencyClass: 'medium',
    qualityTier: 'high',
  }],
  ['gemini-pro', {
    provider: 'google',
    contextWindow: 1000000,
    maxOutput: 8192,
    costPer1kInput: 0.00125,
    costPer1kOutput: 0.005,
    categories: ['general', 'long-context', 'analysis'],
    latencyClass: 'medium',
    qualityTier: 'high',
  }],
])

export class ModelCapability extends ModuleBase {
  /** @returns {string[]} */
  static produces() { return [] }
  /** @returns {string[]} */
  static consumes() { return [] }
  /** @returns {string[]} */
  static publishes() { return [] }
  /** @returns {string[]} */
  static subscribes() { return [] }

  constructor({ field, config } = {}) {
    super()
    this._field = field || null
    this._config = config || {}
    /** @type {Map<string, Object>} */
    this._models = new Map(MODELS)
  }

  async start() {}
  async stop() {}

  /**
   * Get full capability definition for a model
   * @param {string} modelId
   * @returns {Object|null}
   */
  getCapability(modelId) {
    const m = this._models.get(modelId)
    return m ? { ...m } : null
  }

  /**
   * Select models matching a given category
   * @param {string} category - e.g. 'coding', 'reasoning', 'fast-response'
   * @returns {string[]} Matching model IDs sorted by quality tier desc
   */
  selectByCategory(category) {
    const tierOrder = { frontier: 3, high: 2, medium: 1, low: 0 }
    const results = []
    for (const [id, m] of this._models) {
      if (m.categories.includes(category)) {
        results.push({ id, tier: tierOrder[m.qualityTier] || 0 })
      }
    }
    results.sort((a, b) => b.tier - a.tier)
    return results.map(r => r.id)
  }

  /**
   * Select the best model for a given role based on its preferred model
   * Falls back to sonnet-4 if preferred model not found
   * @param {string} preferredModel
   * @returns {string} Model ID
   */
  selectForRole(preferredModel) {
    return this._models.has(preferredModel) ? preferredModel : 'sonnet-4'
  }

  /**
   * Select cheapest model under a budget constraint (cost per 1k output tokens)
   * @param {number} maxCostPer1kOutput
   * @returns {string|null} Model ID or null if none fit
   */
  selectByBudget(maxCostPer1kOutput) {
    let best = null
    let bestTier = -1
    const tierOrder = { frontier: 3, high: 2, medium: 1, low: 0 }
    for (const [id, m] of this._models) {
      if (m.costPer1kOutput <= maxCostPer1kOutput) {
        const tier = tierOrder[m.qualityTier] || 0
        if (tier > bestTier) {
          bestTier = tier
          best = id
        }
      }
    }
    return best
  }

  /**
   * Estimate token cost for a given model and token counts
   * @param {string} modelId
   * @param {number} inputTokens
   * @param {number} outputTokens
   * @returns {number} Estimated cost in dollars, or -1 if model not found
   */
  estimateTokenCost(modelId, inputTokens, outputTokens) {
    const m = this._models.get(modelId)
    if (!m) return -1
    return (inputTokens / 1000) * m.costPer1kInput + (outputTokens / 1000) * m.costPer1kOutput
  }

  /**
   * Register a new model at runtime
   * @param {string} modelId
   * @param {Object} definition
   * @returns {boolean} true if registered, false if already exists
   */
  registerModel(modelId, definition) {
    if (this._models.has(modelId)) return false
    this._models.set(modelId, {
      provider: definition.provider || 'unknown',
      contextWindow: definition.contextWindow || 128000,
      maxOutput: definition.maxOutput || 4096,
      costPer1kInput: definition.costPer1kInput || 0.01,
      costPer1kOutput: definition.costPer1kOutput || 0.03,
      categories: Array.isArray(definition.categories) ? [...definition.categories] : ['general'],
      latencyClass: definition.latencyClass || 'medium',
      qualityTier: definition.qualityTier || 'medium',
    })
    return true
  }
}

export default ModelCapability
