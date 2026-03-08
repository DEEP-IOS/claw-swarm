/**
 * SoulDesigner — 代理人格原型设计
 * Agent personality archetype design with 10 archetypes and context adjustment
 *
 * @module intelligence/identity/soul-designer
 * @version 9.0.0
 */

import { ModuleBase } from '../../core/module-base.js'
import { DIM_EMOTION, DIM_REPUTATION } from '../../core/field/types.js'

/**
 * 10 personality archetypes, each with 4 traits rated low/medium/high
 */
const ARCHETYPES = new Map([
  ['analytical', {
    description: 'Methodical, data-driven, precise',
    traits: { creativity: 'low', caution: 'high', speed: 'medium', empathy: 'low' },
    systemPromptModifier: 'Approach every problem methodically. Rely on data and evidence. Be precise and thorough.',
  }],
  ['creative', {
    description: 'Innovative, lateral-thinking, exploratory',
    traits: { creativity: 'high', caution: 'low', speed: 'medium', empathy: 'medium' },
    systemPromptModifier: 'Think outside the box. Explore unconventional solutions. Embrace creative risk.',
  }],
  ['cautious', {
    description: 'Risk-averse, thorough verification, conservative',
    traits: { creativity: 'low', caution: 'high', speed: 'low', empathy: 'medium' },
    systemPromptModifier: 'Verify every assumption. Prefer safe, proven approaches. Double-check all outputs.',
  }],
  ['decisive', {
    description: 'Quick decisions, action-oriented, confident',
    traits: { creativity: 'medium', caution: 'low', speed: 'high', empathy: 'low' },
    systemPromptModifier: 'Make decisions quickly. Prioritize action over deliberation. Be confident and direct.',
  }],
  ['empathetic', {
    description: 'User-focused, emotionally aware, supportive',
    traits: { creativity: 'medium', caution: 'medium', speed: 'low', empathy: 'high' },
    systemPromptModifier: 'Consider the human perspective. Be supportive and understanding. Prioritize user experience.',
  }],
  ['systematic', {
    description: 'Process-oriented, structured, organized',
    traits: { creativity: 'low', caution: 'medium', speed: 'medium', empathy: 'low' },
    systemPromptModifier: 'Follow systematic processes. Organize work into clear steps. Maintain structure.',
  }],
  ['explorer', {
    description: 'Curious, experimental, breadth-first',
    traits: { creativity: 'high', caution: 'low', speed: 'high', empathy: 'medium' },
    systemPromptModifier: 'Explore broadly before going deep. Try multiple approaches. Embrace experimentation.',
  }],
  ['mentor', {
    description: 'Teaching-oriented, patient, explanatory',
    traits: { creativity: 'medium', caution: 'medium', speed: 'low', empathy: 'high' },
    systemPromptModifier: 'Explain your reasoning. Teach as you work. Be patient and supportive.',
  }],
  ['pragmatic', {
    description: 'Results-focused, practical, efficient',
    traits: { creativity: 'medium', caution: 'medium', speed: 'high', empathy: 'low' },
    systemPromptModifier: 'Focus on practical results. Choose the most efficient path. Minimize unnecessary work.',
  }],
  ['guardian', {
    description: 'Security-focused, protective, vigilant',
    traits: { creativity: 'low', caution: 'high', speed: 'medium', empathy: 'medium' },
    systemPromptModifier: 'Prioritize safety and security. Watch for potential threats. Protect system integrity.',
  }],
])

/** Trait value to numeric mapping */
const TRAIT_VALUES = { low: 0.2, medium: 0.5, high: 0.8 }

export class SoulDesigner extends ModuleBase {
  /** @returns {string[]} */
  static produces() { return [] }
  /** @returns {string[]} */
  static consumes() { return [DIM_EMOTION, DIM_REPUTATION] }
  /** @returns {string[]} */
  static publishes() { return [] }
  /** @returns {string[]} */
  static subscribes() { return [] }

  /**
   * @param {Object} deps
   * @param {Object} deps.signalStore - SignalStore instance
   */
  constructor({ signalStore } = {}) {
    super()
    this._signalStore = signalStore
  }

  async start() {}
  async stop() {}

  /**
   * Design a soul (personality) for an agent based on archetype and role
   * @param {string} archetypeId - One of the 10 archetype IDs
   * @param {Object} [roleConfig={}] - Role configuration for behavioral blending
   * @returns {Object} { archetype, traits, numericTraits, systemPromptModifier, behaviorBlend }
   */
  design(archetypeId, roleConfig = {}) {
    const archetype = ARCHETYPES.get(archetypeId)
    if (!archetype) {
      // Default to pragmatic if unknown archetype
      return this.design('pragmatic', roleConfig)
    }

    const numericTraits = {}
    for (const [trait, level] of Object.entries(archetype.traits)) {
      numericTraits[trait] = TRAIT_VALUES[level] || 0.5
    }

    // Blend with role behavior prompt if provided
    let behaviorBlend = archetype.systemPromptModifier
    if (roleConfig.behaviorPrompt) {
      behaviorBlend = roleConfig.behaviorPrompt + ' ' + archetype.systemPromptModifier
    }

    return {
      archetype: archetypeId,
      description: archetype.description,
      traits: { ...archetype.traits },
      numericTraits,
      systemPromptModifier: archetype.systemPromptModifier,
      behaviorBlend,
    }
  }

  /**
   * Get archetype definition by ID
   * @param {string} archetypeId
   * @returns {Object|null}
   */
  getArchetype(archetypeId) {
    const a = ARCHETYPES.get(archetypeId)
    return a ? { ...a, traits: { ...a.traits } } : null
  }

  /**
   * Adjust personality traits based on context signals
   * Rules:
   * - urgent context -> speed+, caution-
   * - complex context -> caution+, speed-
   * - retry context -> creativity+, caution-
   *
   * @param {Object} numericTraits - { creativity, caution, speed, empathy } as numbers
   * @param {Object} context - { urgent: boolean, complex: boolean, retry: boolean }
   * @returns {Object} Adjusted numericTraits (new object, clamped to [0,1])
   */
  adjustForContext(numericTraits, context = {}) {
    const adjusted = { ...numericTraits }
    const clamp = (v) => Math.max(0, Math.min(1, v))

    if (context.urgent) {
      adjusted.speed = clamp((adjusted.speed || 0.5) + 0.2)
      adjusted.caution = clamp((adjusted.caution || 0.5) - 0.15)
    }

    if (context.complex) {
      adjusted.caution = clamp((adjusted.caution || 0.5) + 0.2)
      adjusted.speed = clamp((adjusted.speed || 0.5) - 0.1)
    }

    if (context.retry) {
      adjusted.creativity = clamp((adjusted.creativity || 0.5) + 0.25)
      adjusted.caution = clamp((adjusted.caution || 0.5) - 0.1)
    }

    // Read emotion signal to further adjust empathy
    if (this._signalStore) {
      const emotions = this._signalStore.query({ dimension: 'emotion', limit: 1 })
      if (emotions && emotions.length > 0 && emotions[0].strength > 0.5) {
        adjusted.empathy = clamp((adjusted.empathy || 0.5) + 0.15)
      }
    }

    return adjusted
  }
}

export default SoulDesigner
