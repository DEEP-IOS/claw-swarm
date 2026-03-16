/**
 * PromptBuilder 单元测试
 * @module tests/intelligence/identity/prompt-builder.test
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PromptBuilder } from '../../../src/intelligence/identity/prompt-builder.js'
import { RoleRegistry } from '../../../src/intelligence/identity/role-registry.js'
import { SensitivityFilter } from '../../../src/intelligence/identity/sensitivity-filter.js'
import { SoulDesigner } from '../../../src/intelligence/identity/soul-designer.js'
import { ContextEngine } from '../../../src/intelligence/memory/context-engine.js'
import { SignalStore } from '../../../src/core/field/signal-store.js'
import { EventBus } from '../../../src/core/bus/event-bus.js'

// 禁词正则
const FORBIDDEN_RE = /蜜蜂|bee|scout|employed|onlooker|Claude/i

describe('PromptBuilder', () => {
  let builder, registry, sensitivityFilter, soulDesigner, contextEngine
  let signalStore, eventBus
  let mockHybridRetrieval, mockStigmergicBoard, mockUserProfile

  beforeEach(() => {
    eventBus = new EventBus()
    signalStore = new SignalStore({ eventBus })
    registry = new RoleRegistry({ field: signalStore, eventBus })
    sensitivityFilter = new SensitivityFilter({ signalStore, roleRegistry: registry })
    soulDesigner = new SoulDesigner({ signalStore })
    contextEngine = new ContextEngine({ maxTokens: 128000, reservedTokens: 4000 })

    // Mock HybridRetrieval
    mockHybridRetrieval = {
      searchForPrompt: vi.fn().mockResolvedValue('## 相关历史经验\n1. 测试经验'),
    }

    // Mock StigmergicBoard
    mockStigmergicBoard = {
      search: vi.fn().mockReturnValue([
        { _key: 'finding-1', value: '发现: 代码结构良好' },
      ]),
    }

    // Mock UserProfile
    mockUserProfile = {
      getPreferences: vi.fn().mockReturnValue({
        languagePreferences: { primary: 'zh-CN' },
        communicationStyle: 'technical',
        expertiseLevel: 'advanced',
      }),
    }

    builder = new PromptBuilder({
      roleRegistry: registry,
      sensitivityFilter,
      hybridRetrieval: mockHybridRetrieval,
      stigmergicBoard: mockStigmergicBoard,
      contextEngine,
      soulDesigner,
      userProfile: mockUserProfile,
      field: signalStore,
      capabilityEngine: null,
    })
  })

  const taskCtx = {
    goal: '分析代码结构并提出优化建议',
    scope: 'test-scope',
    sessionId: 'session-1',
    userId: 'user-1',
  }

  it('build 返回非空字符串', async () => {
    const prompt = await builder.build('agent-1', 'researcher', taskCtx)
    expect(typeof prompt).toBe('string')
    expect(prompt.length).toBeGreaterThan(0)
  })

  it('输出包含角色描述 (behaviorPrompt 内容)', async () => {
    const prompt = await builder.build('agent-1', 'researcher', taskCtx)
    expect(prompt).toContain('研究型Agent')
  })

  it('输出包含工具权限', async () => {
    const prompt = await builder.build('agent-1', 'researcher', taskCtx)
    expect(prompt).toContain('可用工具')
    expect(prompt).toContain('grep')
    expect(prompt).toContain('web_search')
  })

  it('输出包含 "当前任务" section', async () => {
    const prompt = await builder.build('agent-1', 'researcher', taskCtx)
    expect(prompt).toContain('当前任务')
    expect(prompt).toContain('分析代码结构')
  })

  it('输出不包含禁词 (蜜蜂/bee/scout/employed/onlooker)', async () => {
    const prompt = await builder.build('agent-1', 'researcher', taskCtx)
    expect(FORBIDDEN_RE.test(prompt)).toBe(false)
  })

  it('输出不包含 "Claude"', async () => {
    const prompt = await builder.build('agent-1', 'researcher', taskCtx)
    expect(prompt).not.toContain('Claude')
  })

  it('hybridRetrieval.searchForPrompt 被调用', async () => {
    await builder.build('agent-1', 'researcher', taskCtx)
    expect(mockHybridRetrieval.searchForPrompt).toHaveBeenCalled()
    const args = mockHybridRetrieval.searchForPrompt.mock.calls[0]
    expect(args[0]).toBe(taskCtx.goal)
  })

  it('stigmergicBoard.search 被调用', async () => {
    await builder.build('agent-1', 'researcher', taskCtx)
    expect(mockStigmergicBoard.search).toHaveBeenCalled()
    const args = mockStigmergicBoard.search.mock.calls[0]
    expect(args[0]).toBe(taskCtx.goal)
    expect(args[1]).toBe('agent-1')
  })

  it('场向量 alarm > 0.5 -> 输出包含 "异常" 或 "排查"', async () => {
    // 发射高 alarm 信号
    signalStore.emit({ dimension: 'alarm', scope: 'test-scope', strength: 0.9, emitterId: 'test' })
    const prompt = await builder.build('agent-1', 'debugger', taskCtx)
    // debugger alarm sensitivity = 0.95, raw ~0.9 => perceived ~0.855 > 0.5
    expect(prompt).toMatch(/异常|排查/)
  })

  it('CRITICAL section 总是出现 (角色身份 + 工具权限)', async () => {
    const prompt = await builder.build('agent-1', 'reviewer', taskCtx)
    expect(prompt).toContain('你的角色')
    expect(prompt).toContain('可用工具')
  })

  it('所有 10 角色都能成功 build', async () => {
    for (const roleId of registry.list()) {
      const prompt = await builder.build(`agent-${roleId}`, roleId, taskCtx)
      expect(typeof prompt).toBe('string')
      expect(prompt.length).toBeGreaterThan(10)
    }
  })

  it('hybridRetrieval 失败不阻塞 build', async () => {
    mockHybridRetrieval.searchForPrompt.mockRejectedValue(new Error('mock error'))
    const prompt = await builder.build('agent-1', 'researcher', taskCtx)
    expect(typeof prompt).toBe('string')
    expect(prompt.length).toBeGreaterThan(0)
  })

  it('stigmergicBoard 失败不阻塞 build', async () => {
    mockStigmergicBoard.search.mockImplementation(() => { throw new Error('board down') })
    const prompt = await builder.build('agent-1', 'researcher', taskCtx)
    expect(typeof prompt).toBe('string')
    expect(prompt.length).toBeGreaterThan(0)
  })

  it('输出包含委派指南 (对有委派的角色)', async () => {
    const prompt = await builder.build('agent-1', 'researcher', taskCtx)
    expect(prompt).toContain('委派')
  })

  it('输出包含反模式提示', async () => {
    const prompt = await builder.build('agent-1', 'implementer', taskCtx)
    expect(prompt).toContain('避免')
  })
})
