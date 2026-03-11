/**
 * SkillGovernor -- Agent skill inventory and mastery tracking
 *
 * Maintains a per-role skill inventory with sigmoid-based mastery levels.
 * Recommends relevant skills for a given task by keyword matching weighted
 * by mastery, and integrates with CapabilityEngine for success-rate data.
 *
 * Produces:  DIM_KNOWLEDGE  (skill mastery updates)
 * Consumes:  DIM_LEARNING, DIM_TRAIL  (learning signals, path history)
 * Publishes: skill.recommendation.generated
 * Subscribes: agent.completed
 *
 * @module orchestration/adaptation/skill-governor
 * @version 9.0.0
 * @author DEEP-IOS
 */

import { ModuleBase } from '../../core/module-base.js'
import { DIM_KNOWLEDGE, DIM_LEARNING, DIM_TRAIL } from '../../core/field/types.js'

// ============================================================================
// SkillGovernor
// ============================================================================

export class SkillGovernor extends ModuleBase {

  static produces()    { return [DIM_KNOWLEDGE] }
  static consumes()    { return [DIM_LEARNING, DIM_TRAIL] }
  static publishes()   { return ['skill.recommendation.generated'] }
  static subscribes()  { return ['agent.completed'] }

  /**
   * @param {Object} deps
   * @param {Object} deps.field            - Signal field
   * @param {Object} deps.bus              - Event bus
   * @param {Object} [deps.store]          - Persistence store
   * @param {Object} [deps.capabilityEngine] - Optional capability engine for success rates
   */
  constructor({ field, bus, store, capabilityEngine, ...rest } = {}) {
    super()
    this._field            = field
    this._bus              = bus
    this._store            = store || null
    this._capabilityEngine = capabilityEngine || null

    /** @type {Map<string, Map<string, { usageCount: number, lastUsed: number, masteryLevel: number }>>} */
    this._skillInventory = new Map()
  }

  // --------------------------------------------------------------------------
  // Core API
  // --------------------------------------------------------------------------

  /**
   * Record a skill usage for a role and update mastery level.
   *
   * masteryLevel = sigmoid(usageCount * 0.1 * successRate)
   * sigmoid(x) = 1 / (1 + exp(-x))
   *
   * @param {string} roleId
   * @param {string} skillName
   * @param {boolean} success - Whether this usage was successful
   */
  recordUsage(roleId, skillName, success) {
    if (!this._skillInventory.has(roleId)) {
      this._skillInventory.set(roleId, new Map())
    }
    const roleSkills = this._skillInventory.get(roleId)

    if (!roleSkills.has(skillName)) {
      roleSkills.set(skillName, { usageCount: 0, lastUsed: 0, masteryLevel: 0 })
    }
    const entry = roleSkills.get(skillName)

    entry.usageCount++
    entry.lastUsed = Date.now()

    // Determine success rate from capabilityEngine if available
    let successRate = 0.5
    if (this._capabilityEngine) {
      successRate = this._capabilityEngine.getSkillScore?.(roleId, skillName) ?? 0.5
    }

    // sigmoid(usageCount * 0.1 * successRate)
    const x = entry.usageCount * 0.1 * successRate
    entry.masteryLevel = 1 / (1 + Math.exp(-x))

    // Emit knowledge signal
    this._field?.emit?.({
      dimension: DIM_KNOWLEDGE,
      scope:     `skill:${roleId}:${skillName}`,
      strength:  entry.masteryLevel,
      emitterId: 'skill-governor',
      metadata:  { roleId, skillName, usageCount: entry.usageCount, success },
    })
  }

  /**
   * Recommend top-K skills for a task, filtered by mastery > 0.3
   * and ranked by relevance * mastery.
   *
   * Relevance is computed by keyword overlap between skillName and taskDescription.
   *
   * @param {string} roleId
   * @param {string} taskDescription
   * @param {number} [topK=5]
   * @returns {Array<{ skillName: string, masteryLevel: number, relevance: number, score: number }>}
   */
  recommend(roleId, taskDescription, topK = 5) {
    const roleSkills = this._skillInventory.get(roleId)
    if (!roleSkills || roleSkills.size === 0) return []

    const taskWords = this._tokenize(taskDescription)
    const candidates = []

    for (const [skillName, entry] of roleSkills) {
      if (entry.masteryLevel <= 0.3) continue

      const skillWords = this._tokenize(skillName)
      const overlap = skillWords.filter(w => taskWords.includes(w)).length
      const relevance = skillWords.length > 0 ? overlap / skillWords.length : 0
      if (relevance <= 0) continue

      const score = relevance * entry.masteryLevel
      candidates.push({ skillName, masteryLevel: entry.masteryLevel, relevance, score })
    }

    candidates.sort((a, b) => b.score - a.score)
    const results = candidates.slice(0, topK)

    if (results.length > 0) {
      this._bus?.publish?.('skill.recommendation.generated', {
        roleId,
        taskDescription,
        recommendations: results,
        timestamp: Date.now(),
      })
    }

    return results
  }

  /**
   * Get the full skill inventory for a role.
   * @param {string} roleId
   * @returns {Map<string, { usageCount: number, lastUsed: number, masteryLevel: number }> | null}
   */
  getInventory(roleId) {
    return this._skillInventory.get(roleId) || null
  }

  /**
   * Get mastery level for a specific skill.
   * @param {string} roleId
   * @param {string} skillName
   * @returns {number} mastery level (0-1), or 0 if not found
   */
  getMastery(roleId, skillName) {
    const roleSkills = this._skillInventory.get(roleId)
    if (!roleSkills) return 0
    const entry = roleSkills.get(skillName)
    return entry ? entry.masteryLevel : 0
  }

  // --------------------------------------------------------------------------
  // Lifecycle
  // --------------------------------------------------------------------------

  async start() {
    await this.restore()
  }

  async stop() {
    await this.persist()
  }

  /**
   * Persist skill inventory to store.
   */
  async persist() {
    if (!this._store) return
    const serialized = {}
    for (const [roleId, skills] of this._skillInventory) {
      serialized[roleId] = Object.fromEntries(skills)
    }
    await this._store.set?.('skill-governor:inventory', serialized)
  }

  /**
   * Restore skill inventory from store.
   */
  async restore() {
    if (!this._store) return
    const data = await this._store.get?.('skill-governor:inventory')
    if (!data || typeof data !== 'object') return
    for (const [roleId, skills] of Object.entries(data)) {
      const map = new Map()
      for (const [name, entry] of Object.entries(skills)) {
        map.set(name, { ...entry })
      }
      this._skillInventory.set(roleId, map)
    }
  }

  // --------------------------------------------------------------------------
  // Internal
  // --------------------------------------------------------------------------

  /**
   * Tokenize a string into lowercase words for keyword matching.
   * @param {string} text
   * @returns {string[]}
   * @private
   */
  _tokenize(text) {
    if (!text) return []
    return text.toLowerCase().split(/[\s\-_.,;:!?/\\|]+/).filter(w => w.length > 1)
  }
}
