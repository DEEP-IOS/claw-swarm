/**
 * CapabilityEngine — 技能范式与能力评估
 * Skill profiles, fuzzy domain matching, and capability assessment
 *
 * @module intelligence/identity/capability-engine
 * @version 9.0.0
 */

import { ModuleBase } from '../../core/module-base.js'
import { DIM_LEARNING } from '../../core/field/types.js'

/**
 * Related domain mapping for fuzzy matching (30+ domains)
 * Each domain maps to an array of related domains with decay factor 0.4
 */
const RELATED_DOMAINS = Object.freeze({
  javascript:  ['typescript', 'nodejs', 'react', 'vue'],
  typescript:  ['javascript', 'nodejs', 'react', 'angular'],
  python:      ['data-science', 'machine-learning', 'django', 'flask'],
  nodejs:      ['javascript', 'typescript', 'express', 'backend'],
  react:       ['javascript', 'typescript', 'frontend', 'css'],
  vue:         ['javascript', 'typescript', 'frontend', 'css'],
  angular:     ['typescript', 'frontend', 'css', 'rxjs'],
  css:         ['frontend', 'html', 'react', 'design'],
  html:        ['css', 'frontend', 'accessibility', 'seo'],
  frontend:    ['css', 'html', 'react', 'vue', 'angular', 'javascript'],
  backend:     ['nodejs', 'python', 'database', 'api-design', 'devops'],
  database:    ['sql', 'nosql', 'backend', 'data-modeling'],
  sql:         ['database', 'data-modeling', 'postgresql', 'mysql'],
  nosql:       ['database', 'mongodb', 'redis', 'backend'],
  'api-design':['backend', 'rest', 'graphql', 'openapi'],
  rest:        ['api-design', 'backend', 'http'],
  graphql:     ['api-design', 'backend', 'frontend'],
  devops:      ['docker', 'kubernetes', 'ci-cd', 'cloud'],
  docker:      ['devops', 'kubernetes', 'containerization'],
  kubernetes:  ['docker', 'devops', 'cloud', 'microservices'],
  cloud:       ['devops', 'aws', 'azure', 'gcp'],
  'ci-cd':     ['devops', 'testing', 'automation'],
  testing:     ['ci-cd', 'quality-assurance', 'automation'],
  security:    ['authentication', 'encryption', 'networking'],
  networking:  ['security', 'http', 'dns', 'cloud'],
  'machine-learning': ['python', 'data-science', 'statistics', 'deep-learning'],
  'data-science':     ['python', 'machine-learning', 'statistics', 'visualization'],
  'deep-learning':    ['machine-learning', 'python', 'gpu-computing'],
  architecture:['design-patterns', 'microservices', 'system-design'],
  'design-patterns':  ['architecture', 'refactoring', 'oop'],
  microservices:      ['architecture', 'kubernetes', 'api-design', 'backend'],
  documentation:      ['writing', 'api-design', 'markdown'],
  writing:     ['documentation', 'communication', 'markdown'],
})

/** Decay factor for related-domain skill transfer */
const RELATED_DECAY = 0.4

export class CapabilityEngine extends ModuleBase {
  /** @returns {string[]} */
  static produces() { return [DIM_LEARNING] }
  /** @returns {string[]} */
  static consumes() { return [] }
  /** @returns {string[]} */
  static publishes() { return ['capability.updated'] }
  /** @returns {string[]} */
  static subscribes() { return [] }

  /**
   * @param {Object} deps
   * @param {Object} deps.signalStore - SignalStore instance
   * @param {Object} deps.domainStore - DomainStore instance
   * @param {Object} deps.eventBus - EventBus instance
   */
  constructor({ signalStore, domainStore, eventBus } = {}) {
    super()
    this._signalStore = signalStore
    this._domainStore = domainStore
    this._eventBus = eventBus
    /** @type {Map<string, Map<string, number>>} agentId -> Map<domain, score> */
    this._profiles = new Map()
  }

  async start() {}
  async stop() {}

  /**
   * Initialize a skill profile for an agent with seed domains
   * @param {string} agentId
   * @param {Object} seeds - { domain: score } initial skill scores (each [0, 1])
   * @returns {Object} The initialized profile as plain object
   */
  initializeProfile(agentId, seeds = {}) {
    const profile = new Map()
    for (const [domain, score] of Object.entries(seeds)) {
      profile.set(domain, Math.max(0, Math.min(1, score)))
    }
    this._profiles.set(agentId, profile)

    // Persist to domainStore
    if (this._domainStore) {
      this._domainStore.put('capability', agentId, Object.fromEntries(profile))
    }

    return Object.fromEntries(profile)
  }

  /**
   * Update a skill score for an agent using EMA
   * Also propagates to related domains with decay factor
   * @param {string} agentId
   * @param {string} domain
   * @param {number} observedScore - Observed performance [0, 1]
   * @param {number} [alpha=0.3] - EMA smoothing factor
   * @returns {boolean} true if updated
   */
  updateSkill(agentId, domain, observedScore, alpha = 0.3) {
    let profile = this._profiles.get(agentId)
    if (!profile) {
      profile = new Map()
      this._profiles.set(agentId, profile)
    }

    const clamped = Math.max(0, Math.min(1, observedScore))
    const current = profile.get(domain) || 0.5
    const updated = alpha * clamped + (1 - alpha) * current
    profile.set(domain, updated)

    // Propagate to related domains with decay
    const related = RELATED_DOMAINS[domain]
    if (related) {
      for (const rel of related) {
        const relCurrent = profile.get(rel) || 0.5
        const relUpdated = alpha * RELATED_DECAY * clamped + (1 - alpha * RELATED_DECAY) * relCurrent
        profile.set(rel, relUpdated)
      }
    }

    // Emit learning signal
    if (this._signalStore) {
      this._signalStore.emit({
        dimension: DIM_LEARNING,
        scope: agentId,
        strength: Math.abs(updated - current),
        emitterId: 'capability-engine',
        metadata: { domain, oldScore: current, newScore: updated },
      })
    }

    if (this._eventBus) {
      this._eventBus.publish('capability.updated', { agentId, domain, score: updated })
    }

    // Persist
    if (this._domainStore) {
      this._domainStore.put('capability', agentId, Object.fromEntries(profile))
    }

    return true
  }

  /**
   * Get the capability score for an agent in a specific domain
   * Uses fuzzy matching: if exact domain not found, checks related domains
   * @param {string} agentId
   * @param {string} domain
   * @returns {number} Score [0, 1], defaults to 0.3 if completely unknown
   */
  getCapabilityScore(agentId, domain) {
    const profile = this._profiles.get(agentId)
    if (!profile) return 0.3

    // Exact match
    if (profile.has(domain)) return profile.get(domain)

    // Fuzzy match: check if any related domain is known
    const related = RELATED_DOMAINS[domain]
    if (related) {
      let maxRelated = 0
      for (const rel of related) {
        if (profile.has(rel)) {
          maxRelated = Math.max(maxRelated, profile.get(rel) * RELATED_DECAY)
        }
      }
      if (maxRelated > 0) return maxRelated
    }

    return 0.3 // baseline for unknown domains
  }

  /**
   * Get the full skill profile for an agent
   * @param {string} agentId
   * @returns {Object|null} { domain: score } or null
   */
  getSkillProfile(agentId) {
    const profile = this._profiles.get(agentId)
    return profile ? Object.fromEntries(profile) : null
  }

  /**
   * Get top N skills for an agent sorted by score descending
   * @param {string} agentId
   * @param {number} [n=5]
   * @returns {Array<{domain: string, score: number}>}
   */
  getTopSkills(agentId, n = 5) {
    const profile = this._profiles.get(agentId)
    if (!profile) return []

    return Array.from(profile.entries())
      .map(([domain, score]) => ({ domain, score }))
      .sort((a, b) => b.score - a.score)
      .slice(0, n)
  }

  /**
   * Get domains where the agent scores below a threshold (weaknesses)
   * @param {string} agentId
   * @param {number} [threshold=0.4]
   * @returns {Array<{domain: string, score: number}>}
   */
  getWeaknesses(agentId, threshold = 0.4) {
    const profile = this._profiles.get(agentId)
    if (!profile) return []

    return Array.from(profile.entries())
      .filter(([, score]) => score < threshold)
      .map(([domain, score]) => ({ domain, score }))
      .sort((a, b) => a.score - b.score)
  }
  /**
   * Record a task execution for a role, boosting the role's skill score.
   * Called by cross-wiring in index-v9.js on spawn.native.started events.
   * @param {string} roleId - The role that executed the task
   * @param {string} taskId - The task identifier
   * @returns {boolean}
   */
  recordTask(roleId, taskId) {
    return this.updateSkill(roleId, taskId, 0.7)
  }

  /**
   * Get a standardized 8D capability vector for 3D Console visualization
   * @param {string} agentId
   * @returns {Object} { coding, architecture, testing, documentation, security, performance, communication, domain }
   */
  getVector8D(agentId) {
    const profile = this._profiles.get(agentId)
    if (!profile) {
      return { coding: 0.5, architecture: 0.5, testing: 0.5, documentation: 0.5, security: 0.5, performance: 0.5, communication: 0.5, domain: 0.5 }
    }

    const get = (keys) => {
      for (const k of keys) {
        if (profile.has(k)) return profile.get(k)
      }
      return 0.5
    }

    return {
      coding: get(['javascript', 'typescript', 'python', 'coding']),
      architecture: get(['architecture', 'design-patterns', 'system-design']),
      testing: get(['testing', 'quality-assurance', 'ci-cd']),
      documentation: get(['documentation', 'writing', 'markdown']),
      security: get(['security', 'authentication', 'encryption']),
      performance: get(['performance', 'optimization', 'profiling']),
      communication: get(['communication', 'writing', 'documentation']),
      domain: get(['domain', 'backend', 'frontend']),
    }
  }
}

export default CapabilityEngine
