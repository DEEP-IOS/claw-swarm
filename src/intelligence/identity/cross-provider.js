/**
 * CrossProvider — 跨供应商集成与入职协议
 * Cross-provider integration with 4-stage onboarding protocol
 *
 * @module intelligence/identity/cross-provider
 * @version 9.0.0
 */

import { ModuleBase } from '../../core/module-base.js'
import { DIM_TRUST } from '../../core/field/types.js'

/**
 * 4-stage onboarding protocol
 * introduction -> shadowing -> collaboration -> autonomy
 */
const ONBOARDING_STAGES = Object.freeze([
  {
    name: 'introduction',
    description: 'Initial discovery and capability assessment',
    requiredInteractions: 0,
    trustThreshold: 0.0,
    permissions: ['read'],
  },
  {
    name: 'shadowing',
    description: 'Observing experienced agents and learning patterns',
    requiredInteractions: 5,
    trustThreshold: 0.3,
    permissions: ['read', 'suggest'],
  },
  {
    name: 'collaboration',
    description: 'Working alongside other agents with supervision',
    requiredInteractions: 15,
    trustThreshold: 0.6,
    permissions: ['read', 'suggest', 'execute_supervised'],
  },
  {
    name: 'autonomy',
    description: 'Full autonomous operation within role boundaries',
    requiredInteractions: 30,
    trustThreshold: 0.8,
    permissions: ['read', 'suggest', 'execute_supervised', 'execute_autonomous'],
  },
])

export class CrossProvider extends ModuleBase {
  /** @returns {string[]} */
  static produces() { return [] }
  /** @returns {string[]} */
  static consumes() { return [DIM_TRUST] }
  /** @returns {string[]} */
  static publishes() { return ['provider.stage.advanced'] }
  /** @returns {string[]} */
  static subscribes() { return ['agent.lifecycle.spawned'] }

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
    /** @type {Map<string, Object>} vendorId -> profile (5D) */
    this._vendorProfiles = new Map()
    /** @type {Map<string, Object>} agentId -> onboarding state */
    this._onboardingState = new Map()
  }

  async start() {
    if (this._eventBus) {
      this._eventBus.subscribe('agent.lifecycle.spawned', (data) => {
        this._initOnboarding(data.agentId, data.provider || 'default')
      })
    }
  }

  async stop() {
    if (this._eventBus) {
      this._eventBus.unsubscribe('agent.lifecycle.spawned')
    }
  }

  /**
   * Initialize onboarding for a new agent
   * @private
   */
  _initOnboarding(agentId, provider) {
    this._onboardingState.set(agentId, {
      provider,
      stageIndex: 0,
      interactionCount: 0,
      startedAt: Date.now(),
    })
  }

  /**
   * Assess current onboarding stage for an agent, potentially advancing
   * @param {string} agentId
   * @returns {Object} { stage: string, permissions: string[], stageIndex: number }
   */
  assessStage(agentId) {
    const state = this._onboardingState.get(agentId)
    if (!state) {
      return { stage: ONBOARDING_STAGES[0].name, permissions: [...ONBOARDING_STAGES[0].permissions], stageIndex: 0 }
    }

    // Check if agent can advance to next stage
    let advanced = false
    while (state.stageIndex < ONBOARDING_STAGES.length - 1) {
      const next = ONBOARDING_STAGES[state.stageIndex + 1]
      // Read trust signal for this agent
      let trustLevel = 0
      if (this._signalStore) {
        const signals = this._signalStore.query({ scope: agentId, dimension: 'trust', limit: 1 })
        if (signals && signals.length > 0) {
          trustLevel = signals[0].strength || 0
        }
      }
      if (state.interactionCount >= next.requiredInteractions && trustLevel >= next.trustThreshold) {
        state.stageIndex++
        advanced = true
      } else {
        break
      }
    }

    if (advanced && this._eventBus) {
      this._eventBus.publish('provider.stage.advanced', {
        agentId,
        stage: ONBOARDING_STAGES[state.stageIndex].name,
        stageIndex: state.stageIndex,
      })
    }

    const current = ONBOARDING_STAGES[state.stageIndex]
    return {
      stage: current.name,
      permissions: [...current.permissions],
      stageIndex: state.stageIndex,
    }
  }

  /**
   * Generate a context bridge object for cross-provider communication
   * @param {string} agentId
   * @param {string} targetProvider
   * @returns {Object} Context bridge data
   */
  generateContextBridge(agentId, targetProvider) {
    const state = this._onboardingState.get(agentId) || { stageIndex: 0, interactionCount: 0 }
    const stage = ONBOARDING_STAGES[state.stageIndex]
    const profile = this._vendorProfiles.get(targetProvider)

    return {
      agentId,
      sourceProvider: state.provider || 'unknown',
      targetProvider,
      onboardingStage: stage.name,
      permissions: [...stage.permissions],
      vendorProfile: profile ? { ...profile } : null,
      bridgeCreatedAt: Date.now(),
    }
  }

  /**
   * Record an interaction for onboarding progress and update vendor profile
   * Uses exponential moving average for 5D profile updates
   * @param {string} agentId
   * @param {Object} metrics - { quality, reliability, speed, costEfficiency, compatibility } each [0,1]
   */
  recordInteraction(agentId, metrics = {}) {
    const state = this._onboardingState.get(agentId)
    if (state) {
      state.interactionCount++
    }

    // Update vendor profile with EMA (alpha = 0.3)
    const provider = state ? state.provider : 'default'
    const alpha = 0.3
    const dims = ['quality', 'reliability', 'speed', 'costEfficiency', 'compatibility']

    let profile = this._vendorProfiles.get(provider)
    if (!profile) {
      profile = { quality: 0.5, reliability: 0.5, speed: 0.5, costEfficiency: 0.5, compatibility: 0.5, interactionCount: 0 }
      this._vendorProfiles.set(provider, profile)
    }

    for (const dim of dims) {
      if (typeof metrics[dim] === 'number') {
        const clamped = Math.max(0, Math.min(1, metrics[dim]))
        profile[dim] = alpha * clamped + (1 - alpha) * profile[dim]
      }
    }
    profile.interactionCount++
  }

  /**
   * Get the 5D vendor profile for a provider
   * @param {string} provider
   * @returns {Object|null} { quality, reliability, speed, costEfficiency, compatibility, interactionCount }
   */
  getProfile(provider) {
    const p = this._vendorProfiles.get(provider)
    return p ? { ...p } : null
  }

  /**
   * Get integration strategy recommendation based on vendor profile
   * @param {string} provider
   * @returns {Object} { strategy: string, confidence: number, reasoning: string }
   */
  getIntegrationStrategy(provider) {
    const profile = this._vendorProfiles.get(provider)
    if (!profile || profile.interactionCount < 3) {
      return {
        strategy: 'cautious',
        confidence: 0.3,
        reasoning: 'Insufficient interaction data for confident recommendation',
      }
    }

    const avg = (profile.quality + profile.reliability + profile.speed + profile.costEfficiency + profile.compatibility) / 5

    if (avg >= 0.75) {
      return { strategy: 'full-integration', confidence: Math.min(0.95, avg), reasoning: 'High overall vendor performance across all dimensions' }
    } else if (avg >= 0.5) {
      return { strategy: 'selective-integration', confidence: avg, reasoning: 'Moderate vendor performance; integrate for strengths only' }
    } else {
      return { strategy: 'minimal-integration', confidence: 1 - avg, reasoning: 'Low vendor performance; limit to non-critical tasks' }
    }
  }
}

export default CrossProvider
