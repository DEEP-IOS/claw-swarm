/**
 * CrossProvider unit tests
 * @module tests/intelligence/identity/cross-provider.test
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { CrossProvider } from '../../../src/intelligence/identity/cross-provider.js'
import { SignalStore } from '../../../src/core/field/signal-store.js'
import { EventBus } from '../../../src/core/bus/event-bus.js'
import { DomainStore } from '../../../src/core/store/domain-store.js'

describe('CrossProvider', () => {
  let cp, signalStore, eventBus, domainStore

  beforeEach(async () => {
    eventBus = new EventBus()
    signalStore = new SignalStore({ eventBus })
    domainStore = new DomainStore({ domain: 'cp-test', snapshotDir: '/tmp/cp-test' })
    cp = new CrossProvider({ signalStore, domainStore, eventBus })
    await cp.start()
  })

  it('assessStage: unknown agent returns introduction', () => {
    const result = cp.assessStage('unknown-agent')
    expect(result.stage).toBe('introduction')
    expect(result.stageIndex).toBe(0)
    expect(result.permissions).toContain('read')
  })

  it('recordInteraction advances stage when trust threshold met', () => {
    // Directly initialize onboarding via internal method since eventBus
    // handler receives envelope (data is nested under .data)
    cp._initOnboarding('a1', 'openai')

    // Need 5+ interactions + trust >= 0.3 for shadowing
    for (let i = 0; i < 6; i++) {
      cp.recordInteraction('a1', { quality: 0.8, reliability: 0.9, speed: 0.7, costEfficiency: 0.6, compatibility: 0.8 })
    }
    // Emit trust signal
    signalStore.emit({ dimension: 'trust', scope: 'a1', strength: 0.5, emitterId: 'test' })

    const result = cp.assessStage('a1')
    expect(result.stageIndex).toBeGreaterThanOrEqual(1)
    expect(result.stage).toBe('shadowing')
  })

  it('generateContextBridge: returns bridge object', () => {
    cp._initOnboarding('b1', 'anthropic')
    const bridge = cp.generateContextBridge('b1', 'openai')
    expect(bridge.agentId).toBe('b1')
    expect(bridge.sourceProvider).toBe('anthropic')
    expect(bridge.targetProvider).toBe('openai')
    expect(bridge.onboardingStage).toBe('introduction')
    expect(bridge.permissions).toContain('read')
  })

  it('generateContextBridge: introduction stage has only read permission', () => {
    cp._initOnboarding('b2', 'google')
    const bridge = cp.generateContextBridge('b2', 'anthropic')
    expect(bridge.permissions).toEqual(['read'])
  })

  it('getProfile: returns 5D profile after interactions', () => {
    cp._initOnboarding('c1', 'test-vendor')
    cp.recordInteraction('c1', { quality: 0.8, reliability: 0.7, speed: 0.9, costEfficiency: 0.6, compatibility: 0.5 })
    const profile = cp.getProfile('test-vendor')
    expect(profile).toBeTruthy()
    expect(typeof profile.quality).toBe('number')
    expect(typeof profile.reliability).toBe('number')
    expect(typeof profile.speed).toBe('number')
    expect(typeof profile.costEfficiency).toBe('number')
    expect(typeof profile.compatibility).toBe('number')
    expect(profile.interactionCount).toBe(1)
  })

  it('getIntegrationStrategy: new provider with insufficient data returns cautious', () => {
    const strategy = cp.getIntegrationStrategy('brand-new-provider')
    expect(strategy.strategy).toBe('cautious')
    expect(strategy.confidence).toBeLessThanOrEqual(0.5)
  })

  it('getIntegrationStrategy: high-scoring provider returns full-integration', () => {
    cp._initOnboarding('d1', 'good-vendor')
    // Need >= 3 interactions for confident recommendation
    for (let i = 0; i < 5; i++) {
      cp.recordInteraction('d1', { quality: 0.95, reliability: 0.95, speed: 0.95, costEfficiency: 0.95, compatibility: 0.95 })
    }
    const strategy = cp.getIntegrationStrategy('good-vendor')
    expect(strategy.strategy).toBe('full-integration')
  })

  it('getProfile: nonexistent provider returns null', () => {
    expect(cp.getProfile('nonexistent')).toBeNull()
  })

  it('recordInteraction: multiple interactions use EMA update', () => {
    cp._initOnboarding('e1', 'ema-vendor')
    cp.recordInteraction('e1', { quality: 1.0 })
    cp.recordInteraction('e1', { quality: 1.0 })
    const profile = cp.getProfile('ema-vendor')
    // EMA with alpha=0.3: initial 0.5 -> 0.3*1+0.7*0.5=0.65 -> 0.3*1+0.7*0.65=0.755
    expect(profile.quality).toBeCloseTo(0.755, 2)
    expect(profile.interactionCount).toBe(2)
  })
})
