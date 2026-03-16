/**
 * R2 Identity + Memory integration test
 * @module tests/intelligence/integration.test
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// --- R0 Core ---
import { SignalStore } from '../../src/core/field/signal-store.js'
import { EventBus } from '../../src/core/bus/event-bus.js'
import { DomainStore } from '../../src/core/store/domain-store.js'

// --- R1 Communication ---
import { StigmergicBoard } from '../../src/communication/stigmergy/stigmergic-board.js'

// --- R2 Identity ---
import { RoleRegistry } from '../../src/intelligence/identity/role-registry.js'
import { SensitivityFilter } from '../../src/intelligence/identity/sensitivity-filter.js'
import { PromptBuilder } from '../../src/intelligence/identity/prompt-builder.js'
import { SoulDesigner } from '../../src/intelligence/identity/soul-designer.js'
import { LifecycleManager } from '../../src/intelligence/identity/lifecycle-manager.js'
import { CapabilityEngine } from '../../src/intelligence/identity/capability-engine.js'
import { ContextEngine } from '../../src/intelligence/memory/context-engine.js'

// --- R2 Memory ---
import { EmbeddingEngine } from '../../src/intelligence/memory/embedding-engine.js'
import { VectorIndex } from '../../src/intelligence/memory/vector-index.js'
import { EpisodicMemory } from '../../src/intelligence/memory/episodic-memory.js'
import { HybridRetrieval } from '../../src/intelligence/memory/hybrid-retrieval.js'
import { SemanticMemory } from '../../src/intelligence/memory/semantic-memory.js'

const FORBIDDEN_RE = /蜜蜂|bee|scout|employed|onlooker|Claude/i
const ALL_12_DIMS = [
  'trail', 'alarm', 'reputation', 'task', 'knowledge', 'coordination',
  'emotion', 'trust', 'sna', 'learning', 'calibration', 'species',
]

describe('R2 Integration', () => {
  let eventBus, signalStore, domainStore
  let registry, sensitivityFilter, soulDesigner, contextEngine
  let lifecycleManager, capabilityEngine
  let embeddingEngine, vectorIndex, episodicMemory, semanticMemory
  let hybridRetrieval, stigmergicBoard

  beforeEach(() => {
    eventBus = new EventBus()
    signalStore = new SignalStore({ eventBus })
    domainStore = new DomainStore({ domain: 'integration-test', snapshotDir: '/tmp/int-test' })

    registry = new RoleRegistry({ field: signalStore, eventBus })
    sensitivityFilter = new SensitivityFilter({ signalStore, roleRegistry: registry })
    soulDesigner = new SoulDesigner({ signalStore })
    contextEngine = new ContextEngine({ maxTokens: 128000 })
    lifecycleManager = new LifecycleManager({ signalStore, domainStore, eventBus })
    capabilityEngine = new CapabilityEngine({ signalStore, domainStore, eventBus })

    embeddingEngine = new EmbeddingEngine({ mode: 'mock' })
    vectorIndex = new VectorIndex({ dimensions: 384 })
    episodicMemory = new EpisodicMemory({
      domainStore, field: signalStore, eventBus,
      embeddingEngine, vectorIndex,
    })
    semanticMemory = new SemanticMemory({ domainStore, field: signalStore, eventBus })
    stigmergicBoard = new StigmergicBoard({ domainStore, field: signalStore, eventBus })
    hybridRetrieval = new HybridRetrieval({
      episodicMemory, semanticMemory, vectorIndex,
      embeddingEngine, field: signalStore,
    })
  })

  // ---- Test 1: Agent lifecycle full flow ----

  it('Agent lifecycle full flow + EventBus events', () => {
    const spawned = vi.fn()
    const active = vi.fn()
    const completed = vi.fn()
    const ended = vi.fn()
    eventBus.subscribe('agent.lifecycle.spawned', spawned)
    eventBus.subscribe('agent.lifecycle.active', active)
    eventBus.subscribe('agent.lifecycle.completed', completed)
    eventBus.subscribe('agent.lifecycle.ended', ended)

    lifecycleManager.spawn('int-a1', 'researcher')
    expect(lifecycleManager.getState('int-a1').state).toBe('spawning')

    lifecycleManager.markReady('int-a1')
    expect(lifecycleManager.getState('int-a1').state).toBe('active')

    lifecycleManager.markCompleted('int-a1', { summary: 'found 3 files' })
    expect(lifecycleManager.getState('int-a1').state).toBe('completing')

    lifecycleManager.markEnded('int-a1')
    expect(lifecycleManager.getState('int-a1').state).toBe('ended')

    expect(spawned).toHaveBeenCalledTimes(1)
    expect(active).toHaveBeenCalledTimes(1)
    expect(completed).toHaveBeenCalledTimes(1)
    expect(ended).toHaveBeenCalledTimes(1)
  })

  // ---- Test 2: PromptBuilder full chain ----

  it('PromptBuilder full chain: build returns role desc + tools', async () => {
    const mockHR = {
      searchForPrompt: vi.fn().mockResolvedValue('## history\n1. prior analysis'),
    }

    const builder = new PromptBuilder({
      roleRegistry: registry,
      sensitivityFilter,
      hybridRetrieval: mockHR,
      stigmergicBoard,
      contextEngine,
      soulDesigner,
      userProfile: null,
      field: signalStore,
      capabilityEngine,
    })

    stigmergicBoard.write('helper', 'finding-1', 'code structure is solid')

    const prompt = await builder.build('agent-1', 'researcher', {
      goal: 'analyze code structure',
      scope: 'test-scope',
      sessionId: 's1',
    })

    expect(typeof prompt).toBe('string')
    expect(prompt.length).toBeGreaterThan(50)
    expect(prompt).toContain('研究型Agent')
    expect(prompt).toContain('可用工具')
    expect(mockHR.searchForPrompt).toHaveBeenCalled()
  })

  // ---- Test 3: Memory pipeline ----

  it('EpisodicMemory: record then query finds it', async () => {
    await episodicMemory.record({
      id: 'ep-1',
      taskId: 'task-1',
      role: 'researcher',
      goal: 'search JavaScript performance optimization',
      actions: ['grep performance', 'read benchmark.js'],
      outcome: 'success',
      quality: 0.85,
      sessionId: 'sess-1',
      tags: ['performance', 'javascript'],
      lessons: ['Use Web Worker for better performance'],
    })

    const results = await episodicMemory.query('JavaScript performance', { topK: 3 })
    expect(results.length).toBeGreaterThanOrEqual(1)
    expect(results[0].goal).toContain('JavaScript')
  })

  // ---- Test 4: 10 roles full check ----

  it('10 roles: complete 12-dim sensitivity, non-empty tools, non-empty prompt, no forbidden words', () => {
    const roles = registry.list()
    expect(roles).toHaveLength(10)
    for (const roleId of roles) {
      const role = registry.get(roleId)
      const sensitivity = registry.getSensitivity(roleId)
      expect(Object.keys(sensitivity)).toHaveLength(12)
      for (const dim of ALL_12_DIMS) {
        expect(typeof sensitivity[dim]).toBe('number')
        expect(sensitivity[dim]).toBeGreaterThanOrEqual(0)
        expect(sensitivity[dim]).toBeLessThanOrEqual(1)
      }
      expect(Array.isArray(role.tools)).toBe(true)
      expect(role.tools.length).toBeGreaterThan(0)
      expect(role.behaviorPrompt.length).toBeGreaterThan(0)
      expect(FORBIDDEN_RE.test(role.behaviorPrompt)).toBe(false)
    }
  })

  // ---- Test 5: prompt forbidden word check ----

  it('All 10 roles build prompts with no forbidden words', async () => {
    const mockHR = { searchForPrompt: vi.fn().mockResolvedValue('') }
    const builder = new PromptBuilder({
      roleRegistry: registry, sensitivityFilter,
      hybridRetrieval: mockHR, stigmergicBoard, contextEngine,
      soulDesigner, userProfile: null, field: signalStore, capabilityEngine: null,
    })
    for (const roleId of registry.list()) {
      const prompt = await builder.build('agent-' + roleId, roleId, {
        goal: 'execute test task', scope: 'forbidden-check', sessionId: 's-check',
      })
      expect(FORBIDDEN_RE.test(prompt)).toBe(false)
    }
  })

  // ---- Test 6: SensitivityFilter multi-role perception ----

  it('SensitivityFilter: researcher vs implementer see different field under same scope', () => {
    signalStore.emit({ dimension: 'knowledge', scope: 'shared', strength: 0.8, emitterId: 'test' })
    signalStore.emit({ dimension: 'task', scope: 'shared', strength: 0.7, emitterId: 'test' })
    const result = sensitivityFilter.comparePerceptions('shared', ['researcher', 'implementer'])
    expect(result.researcher.knowledge).toBeGreaterThan(result.implementer.knowledge)
    expect(result.implementer.task).toBeGreaterThan(result.researcher.task)
  })

  // ---- Test 7: HybridRetrieval 6-dim scoring ----

  it('HybridRetrieval: search returns results with score and breakdown', async () => {
    await episodicMemory.record({
      id: 'hr-1', taskId: 't1', role: 'researcher',
      goal: 'React component performance optimization', actions: ['profiling', 'memo'], outcome: 'success',
      quality: 0.95, sessionId: 'hr-s1', lessons: ['useMemo reduces re-renders'],
    })
    await episodicMemory.record({
      id: 'hr-2', taskId: 't2', role: 'researcher',
      goal: 'React routing config', actions: ['read docs'], outcome: 'partial',
      quality: 0.4, sessionId: 'hr-s1', lessons: ['needs more research'],
    })
    const results = await hybridRetrieval.search('React performance', { topK: 5 })
    expect(results.length).toBeGreaterThanOrEqual(1)
    for (const r of results) {
      expect(typeof r.score).toBe('number')
      expect(r.breakdown).toBeTruthy()
    }
  })

  // ---- Test 8: LifecycleManager FSM strictness ----

  it('LifecycleManager FSM: all illegal transitions throw Error', () => {
    lifecycleManager.spawn('fsm-1', 'tester')
    expect(() => lifecycleManager.spawn('fsm-1', 'tester')).toThrow()

    lifecycleManager.spawn('fsm-2', 'analyst')
    expect(() => lifecycleManager.markCompleted('fsm-2')).toThrow()

    lifecycleManager.spawn('fsm-3', 'planner')
    expect(() => lifecycleManager.markEnded('fsm-3')).toThrow()

    lifecycleManager.spawn('fsm-4', 'reviewer')
    lifecycleManager.markFailed('fsm-4', 'err')
    lifecycleManager.markEnded('fsm-4')
    expect(() => lifecycleManager.markReady('fsm-4')).toThrow()
    expect(() => lifecycleManager.markFailed('fsm-4', 'again')).toThrow()

    lifecycleManager.spawn('fsm-5', 'debugger')
    lifecycleManager.markReady('fsm-5')
    expect(() => lifecycleManager.markEnded('fsm-5')).toThrow()
  })
})
