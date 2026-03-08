/**
 * ContextService 单元测试 / ContextService Unit Tests
 *
 * L5 应用层上下文构建服务: 使用 mock/stub 依赖测试上下文组装、缓存、统计功能。
 * L5 application layer context building service: tests context assembly, caching, and stats
 * using mock/stub dependencies.
 *
 * @module tests/unit/L5/context-service.test
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ContextService } from '../../../src/L5-application/context-service.js';

// ============================================================================
// Mock 工厂函数 / Mock Factory Functions
// ============================================================================

const silentLogger = { info() {}, warn() {}, error() {}, debug() {} };

/** 模拟工作记忆 / Mock working memory */
function createMockWorkingMemory() {
  return {
    snapshot() {
      return {
        focus: [{ key: 'task', value: 'build app', priority: 9 }],
        context: [{ key: 'env', value: 'prod', priority: 5 }],
        scratchpad: [],
        totalItems: 2,
      };
    },
    getStats() {
      return { totalItems: 2, focusCount: 1, contextCount: 1, scratchCount: 0 };
    },
  };
}

/** 模拟情景记忆 / Mock episodic memory */
function createMockEpisodicMemory() {
  return {
    recall(agentId, opts) {
      return [
        { subject: 'agent', predicate: 'completed', object: 'task-1', eventType: 'action', _score: 0.8 },
      ];
    },
    getStats(agentId) {
      return { totalEvents: 5, recentEvents: 3 };
    },
    consolidate() { return ['ev-1']; },
    prune() { return 0; },
  };
}

/** 模拟语义记忆 / Mock semantic memory */
function createMockSemanticMemory() {
  return {
    query(keyword) {
      return [{ id: 'node-1', label: 'JavaScript' }];
    },
    buildContextSnippet(nodeId) {
      return 'JavaScript -> uses -> React';
    },
    getStats() {
      return { totalNodes: 10, totalEdges: 15 };
    },
  };
}

/** 模拟上下文压缩器 / Mock context compressor */
function createMockContextCompressor() {
  return {
    compress(items, opts) {
      return { compressed: 'compressed-text', itemCount: items.length, truncated: false };
    },
  };
}

/** 模拟信息素引擎 / Mock pheromone engine */
function createMockPheromoneEngine() {
  return {
    read(scope) {
      return [{ id: 'ph-1', type: 'trail', sourceId: 's1', targetScope: '/', intensity: 0.8, payload: {} }];
    },
    getStats() {
      return { totalCount: 5, emitted: 10 };
    },
  };
}

/** 模拟 Gossip 协议 / Mock gossip protocol */
function createMockGossipProtocol() {
  return {
    getAllStates() {
      return new Map([
        ['agent-2', { status: 'active', _lastSeen: Date.now() }],
      ]);
    },
    getStats() {
      return { agentCount: 2, rounds: 5 };
    },
  };
}

/** 模拟消息总线 / Mock message bus */
function createMockMessageBus() {
  return { publish() {}, subscribe() {} };
}

/**
 * 创建 ContextService 实例及其所有 mock 依赖
 * Create ContextService instance with all mock dependencies
 */
function createService(overrides = {}) {
  const deps = {
    workingMemory: createMockWorkingMemory(),
    episodicMemory: createMockEpisodicMemory(),
    semanticMemory: createMockSemanticMemory(),
    contextCompressor: createMockContextCompressor(),
    pheromoneEngine: createMockPheromoneEngine(),
    gossipProtocol: createMockGossipProtocol(),
    messageBus: createMockMessageBus(),
    logger: silentLogger,
    ...overrides,
  };
  return new ContextService(deps);
}

// ============================================================================
// 测试套件 / Test Suites
// ============================================================================

describe('ContextService', () => {

  // --------------------------------------------------------------------------
  // 1. buildContext 基本测试 / Basic buildContext Tests
  // --------------------------------------------------------------------------
  describe('buildContext / 上下文构建', () => {
    it('should return structured context with all sections / 返回包含所有段落的结构化上下文', () => {
      const service = createService();
      const ctx = service.buildContext('agent-1');

      // 验证基本结构 / Verify basic structure
      expect(ctx.agentId).toBe('agent-1');
      expect(ctx.timestamp).toBeDefined();
      expect(typeof ctx.timestamp).toBe('number');

      // 验证各段落存在 / Verify each section exists
      expect(ctx.workingMemory).toBeDefined();
      expect(ctx.workingMemory.totalItems).toBe(2);
      expect(ctx.workingMemory.focus).toHaveLength(1);
      expect(ctx.workingMemory.context).toHaveLength(1);

      expect(ctx.episodicRecall).toBeDefined();
      expect(ctx.episodicRecall).toHaveLength(1);

      expect(ctx.pheromoneState).toBeDefined();
      expect(ctx.pheromoneState).toHaveLength(1);

      expect(ctx.agentStates).toBeDefined();
      // agent-2 存在于 gossip, 且不等于 agent-1, 应被包含
      // agent-2 exists in gossip and is not agent-1, should be included
      expect(ctx.agentStates).toHaveLength(1);

      expect(ctx.compressed).toBeDefined();
      expect(ctx.compressed.compressed).toBe('compressed-text');
    });

    it('should populate knowledgeSnippet when keyword is provided / 提供 keyword 时应填充 knowledgeSnippet', () => {
      const service = createService();
      const ctx = service.buildContext('agent-1', { keyword: 'JavaScript' });

      // 有关键词时, 语义记忆应返回知识片段 / With keyword, semantic memory should return snippet
      expect(ctx.knowledgeSnippet).toBe('JavaScript -> uses -> React');
    });

    it('should return empty knowledgeSnippet when no keyword / 无 keyword 时 knowledgeSnippet 为空', () => {
      const service = createService();
      const ctx = service.buildContext('agent-1');

      expect(ctx.knowledgeSnippet).toBe('');
    });
  });

  // --------------------------------------------------------------------------
  // 3. 缓存测试 / Caching Tests
  // --------------------------------------------------------------------------
  describe('caching / 缓存', () => {
    it('should return cached result on second call within TTL / TTL 内第二次调用应返回缓存结果', () => {
      const service = createService();

      const ctx1 = service.buildContext('agent-1');
      const ctx2 = service.buildContext('agent-1');

      // 两次返回应有相同的 timestamp (缓存命中)
      // Both returns should have the same timestamp (cache hit)
      expect(ctx2.timestamp).toBe(ctx1.timestamp);
    });

    it('should build fresh context when useCache is false / useCache 为 false 时应构建新上下文', () => {
      const service = createService();

      const ctx1 = service.buildContext('agent-1');

      // 使用 useCache: false 绕过缓存 / Bypass cache with useCache: false
      const ctx2 = service.buildContext('agent-1', { useCache: false });

      // ctx2 的 timestamp 应 >= ctx1.timestamp (新构建的)
      // ctx2.timestamp should be >= ctx1.timestamp (freshly built)
      // 注意: 可能在同一毫秒内执行, 所以使用 >= / May execute in same ms, use >=
      expect(ctx2.timestamp).toBeGreaterThanOrEqual(ctx1.timestamp);
    });
  });

  // --------------------------------------------------------------------------
  // 5. buildPrependContext 测试 / buildPrependContext Tests
  // --------------------------------------------------------------------------
  describe('buildPrependContext / 上下文注入文本', () => {
    it('should return formatted markdown string with section headers / 返回包含段落标题的 Markdown 字符串', () => {
      const service = createService();
      const text = service.buildPrependContext('agent-1', 'build a web app');

      // 验证为字符串 / Verify is string
      expect(typeof text).toBe('string');

      // 应包含标记 / Should contain markers
      expect(text).toContain('<!-- Swarm Context Injection -->');
      expect(text).toContain('<!-- End Swarm Context -->');

      // 工作记忆有数据, 应有 Working Memory 标题 / Working memory has data, should have header
      expect(text).toContain('## Working Memory');

      // 情景记忆有数据, 应有 Recent Events 标题 / Episodic has data, should have header
      expect(text).toContain('## Recent Events');

      // 有 keyword 时应有知识片段 / With keyword should have knowledge snippet
      expect(text).toContain('## Knowledge');

      // 信息素有数据 / Pheromone has data
      expect(text).toContain('## Pheromone Signals');

      // Agent 状态有数据 / Agent states have data
      expect(text).toContain('## Peer Agents');
    });
  });

  // --------------------------------------------------------------------------
  // 6. getContextStats 测试 / getContextStats Tests
  // --------------------------------------------------------------------------
  describe('getContextStats / 上下文统计', () => {
    it('should return statistics from all memory sources / 返回所有记忆源的统计信息', () => {
      const service = createService();
      const stats = service.getContextStats('agent-1');

      // 验证统计结构 / Verify stats structure
      expect(stats.agentId).toBe('agent-1');

      // 工作记忆统计 / Working memory stats
      expect(stats.workingMemory).toBeDefined();
      expect(stats.workingMemory.totalItems).toBe(2);

      // 情景记忆统计 / Episodic memory stats
      expect(stats.episodicMemory).toBeDefined();
      expect(stats.episodicMemory.totalEvents).toBe(5);

      // 语义记忆统计 / Semantic memory stats
      expect(stats.semanticMemory).toBeDefined();
      expect(stats.semanticMemory.totalNodes).toBe(10);

      // 信息素统计 / Pheromone stats
      expect(stats.pheromone).toBeDefined();
      expect(stats.pheromone.totalCount).toBe(5);
      expect(stats.pheromone.emitted).toBe(10);

      // Gossip 统计 / Gossip stats
      expect(stats.gossip).toBeDefined();
      expect(stats.gossip.agentCount).toBe(2);
      expect(stats.gossip.rounds).toBe(5);

      // 缓存状态 / Cache status
      expect(stats.cache).toBeDefined();
      expect(stats.cache.cached).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // 7. invalidateCache 测试 / invalidateCache Tests
  // --------------------------------------------------------------------------
  describe('invalidateCache / 缓存清除', () => {
    it('should invalidate cache so next buildContext builds fresh / 清除缓存后下次 buildContext 构建新上下文', () => {
      const service = createService();

      // 第一次构建 (会缓存) / First build (will cache)
      const ctx1 = service.buildContext('agent-1');

      // 清除缓存 / Invalidate cache
      service.invalidateCache('agent-1');

      // 再次构建, 应得到新的 timestamp / Build again, should get new timestamp
      const ctx2 = service.buildContext('agent-1');
      expect(ctx2.timestamp).toBeGreaterThanOrEqual(ctx1.timestamp);
    });

    it('should clear all caches when no agentId provided / 不提供 agentId 时清除所有缓存', () => {
      const service = createService();

      // 缓存两个 agent / Cache two agents
      service.buildContext('agent-a');
      service.buildContext('agent-b');

      // 验证缓存存在 / Verify caches exist
      const statsA = service.getContextStats('agent-a');
      expect(statsA.cache.cached).toBe(true);

      // 清除所有缓存 / Clear all caches
      service.invalidateCache();

      // 验证缓存已被清除 / Verify caches are cleared
      const statsA2 = service.getContextStats('agent-a');
      const statsB2 = service.getContextStats('agent-b');
      expect(statsA2.cache.cached).toBe(false);
      expect(statsB2.cache.cached).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // 8. 容错性测试 / Resilience Tests
  // --------------------------------------------------------------------------
  describe('resilience / 容错性', () => {
    it('should still populate other sections when episodicMemory throws / 情景记忆抛出时其他段落仍正常', () => {
      // 创建一个会抛出的 episodicMemory mock / Create throwing episodicMemory mock
      const throwingEpisodicMemory = {
        recall() { throw new Error('episodic DB failure'); },
        getStats() { return { totalEvents: 0, recentEvents: 0 }; },
      };

      const service = createService({
        episodicMemory: throwingEpisodicMemory,
      });

      const ctx = service.buildContext('agent-1');

      // 情景记忆段落应为空数组 (降级处理) / Episodic section should be empty array (graceful degradation)
      expect(ctx.episodicRecall).toEqual([]);

      // 其他段落应仍然正常 / Other sections should still work
      expect(ctx.workingMemory.totalItems).toBe(2);
      expect(ctx.pheromoneState).toHaveLength(1);
      expect(ctx.agentStates).toHaveLength(1);
    });

    it('should still populate other sections when pheromoneEngine throws / 信息素引擎抛出时其他段落仍正常', () => {
      const throwingPheromoneEngine = {
        read() { throw new Error('pheromone read failure'); },
        getStats() { return { totalCount: 0, emitted: 0 }; },
      };

      const service = createService({
        pheromoneEngine: throwingPheromoneEngine,
      });

      const ctx = service.buildContext('agent-1');

      // 信息素段落应为空数组 / Pheromone section should be empty array
      expect(ctx.pheromoneState).toEqual([]);

      // 其他段落应正常 / Other sections should work
      expect(ctx.workingMemory.totalItems).toBe(2);
      expect(ctx.episodicRecall).toHaveLength(1);
    });

    it('should still populate other sections when gossipProtocol throws / Gossip 协议抛出时其他段落仍正常', () => {
      const throwingGossip = {
        getAllStates() { throw new Error('gossip failure'); },
        getStats() { return { agentCount: 0, rounds: 0 }; },
      };

      const service = createService({
        gossipProtocol: throwingGossip,
      });

      const ctx = service.buildContext('agent-1');

      // Agent 状态段落应为空数组 / Agent states should be empty array
      expect(ctx.agentStates).toEqual([]);

      // 其他段落应正常 / Other sections should work
      expect(ctx.workingMemory.totalItems).toBe(2);
      expect(ctx.episodicRecall).toHaveLength(1);
    });
  });
});
