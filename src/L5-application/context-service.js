/**
 * ContextService -- 上下文构建服务 / Context Building Service
 *
 * V5.0 应用层上下文服务, 为 LLM 提示构建富上下文:
 * - 工作记忆快照 (focus/context/scratch)
 * - 情景记忆回忆 (最近相关事件)
 * - 语义记忆知识图谱片段
 * - 信息素状态摘要
 * - Agent 状态 (来自 Gossip 协议)
 * - 压缩后的紧凑版本 (适配 LLM token 预算)
 *
 * V5.0 application layer context service, builds rich context for LLM prompts by combining:
 * - Working memory snapshot (focus/context/scratch)
 * - Episodic memory recall (recent relevant events)
 * - Semantic memory knowledge graph snippets
 * - Pheromone state summary
 * - Agent states from GossipProtocol
 * - Compressed version for LLM token budget
 *
 * @module L5-application/context-service
 * @author DEEP-IOS
 */

// ============================================================================
// 常量 / Constants
// ============================================================================

/** 默认情景记忆回忆条数 / Default episodic recall limit */
const DEFAULT_EPISODIC_LIMIT = 10;

/** 默认信息素查询范围 / Default pheromone query scope */
const DEFAULT_PHEROMONE_SCOPE = '/';

/** 默认压缩最大条目数 / Default compression max items */
const DEFAULT_COMPRESS_MAX_ITEMS = 25;

/** 默认压缩最大字符数 / Default compression max characters */
const DEFAULT_COMPRESS_MAX_CHARS = 6000;

/** 缓存过期时间 (ms) / Cache TTL (ms) */
const CACHE_TTL_MS = 30000;

// ============================================================================
// ContextService 类 / ContextService Class
// ============================================================================

export class ContextService {
  /**
   * @param {Object} deps - 依赖注入 / Dependency injection
   * @param {import('../L3-agent/memory/working-memory.js').WorkingMemory} deps.workingMemory
   * @param {import('../L3-agent/memory/episodic-memory.js').EpisodicMemory} deps.episodicMemory
   * @param {import('../L3-agent/memory/semantic-memory.js').SemanticMemory} deps.semanticMemory
   * @param {import('../L3-agent/memory/context-compressor.js').ContextCompressor} deps.contextCompressor
   * @param {import('../L2-communication/pheromone-engine.js').PheromoneEngine} deps.pheromoneEngine
   * @param {import('../L2-communication/gossip-protocol.js').GossipProtocol} deps.gossipProtocol
   * @param {import('../L2-communication/message-bus.js').MessageBus} deps.messageBus
   * @param {Object} [deps.logger]
   */
  constructor({
    workingMemory,
    episodicMemory,
    semanticMemory,
    contextCompressor,
    pheromoneEngine,
    gossipProtocol,
    messageBus,
    logger,
  }) {
    /** @type {import('../L3-agent/memory/working-memory.js').WorkingMemory} */
    this._workingMemory = workingMemory;

    /** @type {import('../L3-agent/memory/episodic-memory.js').EpisodicMemory} */
    this._episodicMemory = episodicMemory;

    /** @type {import('../L3-agent/memory/semantic-memory.js').SemanticMemory} */
    this._semanticMemory = semanticMemory;

    /** @type {import('../L3-agent/memory/context-compressor.js').ContextCompressor} */
    this._contextCompressor = contextCompressor;

    /** @type {import('../L2-communication/pheromone-engine.js').PheromoneEngine} */
    this._pheromoneEngine = pheromoneEngine;

    /** @type {import('../L2-communication/gossip-protocol.js').GossipProtocol} */
    this._gossipProtocol = gossipProtocol;

    /** @type {import('../L2-communication/message-bus.js').MessageBus} */
    this._messageBus = messageBus;

    /** @type {Object} */
    this._logger = logger || console;

    /**
     * 上下文缓存: agentId -> { context, timestamp }
     * Context cache: agentId -> { context, timestamp }
     * @type {Map<string, { context: Object, timestamp: number }>}
     */
    this._cache = new Map();
  }

  // ━━━ 主要方法 / Main Methods ━━━

  /**
   * 构建富上下文对象
   * Build rich context object for an agent
   *
   * 整合多来源信息, 返回分段结构化上下文。
   * Aggregates information from multiple sources into a structured context object.
   *
   * @param {string} agentId - 代理 ID / Agent ID
   * @param {Object} [options]
   * @param {string} [options.keyword] - 关键词过滤 (影响情景记忆+语义记忆) / Keyword filter
   * @param {number} [options.episodicLimit=10] - 情景记忆回忆条数 / Episodic recall limit
   * @param {string} [options.pheromoneScope='/'] - 信息素查询范围 / Pheromone query scope
   * @param {boolean} [options.useCache=true] - 是否使用缓存 / Use cache
   * @param {number} [options.maxCompressItems=25] - 压缩最大条目数 / Compress max items
   * @param {number} [options.maxCompressChars=6000] - 压缩最大字符数 / Compress max chars
   * @returns {Object} 结构化上下文 / Structured context
   */
  buildContext(agentId, options = {}) {
    const {
      keyword = null,
      episodicLimit = DEFAULT_EPISODIC_LIMIT,
      pheromoneScope = DEFAULT_PHEROMONE_SCOPE,
      useCache = true,
      maxCompressItems = DEFAULT_COMPRESS_MAX_ITEMS,
      maxCompressChars = DEFAULT_COMPRESS_MAX_CHARS,
    } = options;

    // 检查缓存 / Check cache
    if (useCache) {
      const cached = this._getFromCache(agentId);
      if (cached) {
        this._logger.debug?.(`[ContextService] 缓存命中 / Cache hit for agent ${agentId}`);
        return cached;
      }
    }

    // 1. 工作记忆快照 / Working memory snapshot
    const workingMemorySnapshot = this._buildWorkingMemorySection();

    // 2. 情景记忆回忆 / Episodic memory recall
    const episodicRecall = this._buildEpisodicSection(agentId, keyword, episodicLimit);

    // 3. 语义记忆知识片段 / Semantic memory knowledge snippet
    const knowledgeSnippet = this._buildKnowledgeSection(keyword);

    // 4. 信息素状态 / Pheromone state
    const pheromoneState = this._buildPheromoneSection(pheromoneScope);

    // 5. Agent 状态 / Agent states from gossip
    const agentStates = this._buildAgentStatesSection(agentId);

    // 6. 压缩版本 (适配 LLM token 预算)
    // Compressed version (for LLM token budget)
    const compressed = this._buildCompressedSection(
      workingMemorySnapshot,
      episodicRecall,
      maxCompressItems,
      maxCompressChars,
    );

    const context = {
      agentId,
      timestamp: Date.now(),
      workingMemory: workingMemorySnapshot,
      episodicRecall,
      knowledgeSnippet,
      pheromoneState,
      agentStates,
      compressed,
    };

    // 写入缓存 / Write to cache
    if (useCache) {
      this._cache.set(agentId, { context, timestamp: Date.now() });
    }

    this._logger.debug?.({
      agentId,
      sections: {
        workingMemory: workingMemorySnapshot.totalItems,
        episodic: episodicRecall.length,
        knowledge: knowledgeSnippet ? 1 : 0,
        pheromone: pheromoneState.length,
        agents: agentStates.length,
      },
    }, '上下文构建完成 / Context built');

    return context;
  }

  /**
   * 构建 onPrependContext 钩子的格式化文本
   * Build formatted text for onPrependContext hook
   *
   * 将结构化上下文转换为 LLM 可读的 Markdown 文本块, 适合注入系统提示。
   * Converts structured context into LLM-readable Markdown text block for system prompt injection.
   *
   * @param {string} agentId - 代理 ID / Agent ID
   * @param {string} [taskDescription] - 当前任务描述 / Current task description
   * @returns {string} 格式化的上下文文本 / Formatted context text
   */
  buildPrependContext(agentId, taskDescription) {
    const ctx = this.buildContext(agentId, {
      keyword: taskDescription || null,
      useCache: true,
    });

    const parts = [];

    // 标题 / Header
    parts.push('<!-- Swarm Context Injection -->');

    // 工作记忆 / Working memory
    if (ctx.workingMemory.totalItems > 0) {
      parts.push('## Working Memory');

      if (ctx.workingMemory.focus.length > 0) {
        parts.push('### Focus');
        for (const item of ctx.workingMemory.focus) {
          const val = typeof item.value === 'object' ? JSON.stringify(item.value) : String(item.value);
          const truncated = val.length > 150 ? val.slice(0, 147) + '...' : val;
          parts.push(`- **${item.key}**: ${truncated}`);
        }
      }

      if (ctx.workingMemory.context.length > 0) {
        parts.push('### Context');
        for (const item of ctx.workingMemory.context) {
          const val = typeof item.value === 'object' ? JSON.stringify(item.value) : String(item.value);
          const truncated = val.length > 150 ? val.slice(0, 147) + '...' : val;
          parts.push(`- ${item.key}: ${truncated}`);
        }
      }
    }

    // 情景记忆 / Episodic recall
    if (ctx.episodicRecall.length > 0) {
      parts.push('## Recent Events');
      for (const event of ctx.episodicRecall.slice(0, 5)) {
        const obj = event.object ? ` ${event.object}` : '';
        parts.push(`- [${event.eventType || 'event'}] ${event.subject} ${event.predicate}${obj}`);
      }
    }

    // 知识片段 / Knowledge snippet
    if (ctx.knowledgeSnippet) {
      parts.push('## Knowledge');
      parts.push(ctx.knowledgeSnippet);
    }

    // 信息素状态 / Pheromone state
    if (ctx.pheromoneState.length > 0) {
      parts.push('## Pheromone Signals');
      for (const ph of ctx.pheromoneState.slice(0, 8)) {
        parts.push(`- **${ph.type}** [${ph.targetScope}]: intensity=${ph.intensity.toFixed(2)} (from ${ph.sourceId})`);
      }
    }

    // Agent 状态 / Agent states
    if (ctx.agentStates.length > 0) {
      parts.push('## Peer Agents');
      for (const agent of ctx.agentStates.slice(0, 6)) {
        const statusStr = agent.status || 'unknown';
        const taskStr = agent.currentTask ? ` — ${agent.currentTask}` : '';
        parts.push(`- **${agent.agentId}**: ${statusStr}${taskStr}`);
      }
    }

    parts.push('<!-- End Swarm Context -->');

    return parts.filter(Boolean).join('\n');
  }

  /**
   * 获取上下文统计信息
   * Get context statistics for an agent
   *
   * 轻量级查询, 不构建完整上下文。
   * Lightweight query without building full context.
   *
   * @param {string} agentId
   * @returns {Object} 统计信息 / Statistics
   */
  getContextStats(agentId) {
    // 工作记忆统计 / Working memory stats
    const wmStats = this._workingMemory.getStats();

    // 情景记忆统计 / Episodic memory stats
    const epStats = this._episodicMemory.getStats(agentId);

    // 语义记忆统计 / Semantic memory stats
    const smStats = this._semanticMemory.getStats();

    // 信息素统计 / Pheromone stats
    const phStats = this._pheromoneEngine.getStats();

    // Gossip 统计 / Gossip stats
    const gossipStats = this._gossipProtocol.getStats();

    // 缓存状态 / Cache status
    const cached = this._cache.has(agentId);
    const cacheAge = cached
      ? Date.now() - this._cache.get(agentId).timestamp
      : null;

    return {
      agentId,
      workingMemory: wmStats,
      episodicMemory: epStats,
      semanticMemory: smStats,
      pheromone: {
        totalCount: phStats.totalCount,
        emitted: phStats.emitted,
      },
      gossip: {
        agentCount: gossipStats.agentCount,
        rounds: gossipStats.rounds,
      },
      cache: {
        cached,
        ageMs: cacheAge,
      },
    };
  }

  /**
   * 清除缓存
   * Invalidate cache for an agent (or all)
   *
   * @param {string} [agentId] - 指定 agent, 不传则清除所有 / Specific agent, or clear all
   */
  invalidateCache(agentId) {
    if (agentId) {
      this._cache.delete(agentId);
      this._logger.debug?.(`[ContextService] 缓存已清除 / Cache invalidated for agent ${agentId}`);
    } else {
      this._cache.clear();
      this._logger.debug?.('[ContextService] 所有缓存已清除 / All caches invalidated');
    }
  }

  // ━━━ 内部段落构建器 / Internal Section Builders ━━━

  /**
   * 构建工作记忆段落
   * Build working memory section
   *
   * @returns {{ focus: Array, context: Array, scratchpad: Array, totalItems: number }}
   * @private
   */
  _buildWorkingMemorySection() {
    try {
      return this._workingMemory.snapshot();
    } catch (err) {
      this._logger.warn?.(`[ContextService] 工作记忆读取失败 / Working memory read failed: ${err.message}`);
      return { focus: [], context: [], scratchpad: [], totalItems: 0 };
    }
  }

  /**
   * 构建情景记忆段落
   * Build episodic memory section
   *
   * @param {string} agentId
   * @param {string | null} keyword
   * @param {number} limit
   * @returns {Array<Object>}
   * @private
   */
  _buildEpisodicSection(agentId, keyword, limit) {
    try {
      return this._episodicMemory.recall(agentId, {
        keyword: keyword || undefined,
        limit,
      });
    } catch (err) {
      this._logger.warn?.(`[ContextService] 情景记忆回忆失败 / Episodic recall failed: ${err.message}`);
      return [];
    }
  }

  /**
   * 构建语义记忆知识片段
   * Build semantic memory knowledge snippet
   *
   * 搜索与关键词相关的概念, 然后构建 BFS 上下文片段。
   * Search for keyword-related concepts, then build BFS context snippet.
   *
   * @param {string | null} keyword
   * @returns {string} 格式化的知识片段 / Formatted knowledge snippet
   * @private
   */
  _buildKnowledgeSection(keyword) {
    if (!keyword) return '';

    try {
      // 搜索与关键词匹配的概念节点 / Search for matching concept nodes
      const nodes = this._semanticMemory.query(keyword, { limit: 3 });
      if (!nodes || nodes.length === 0) return '';

      // 从第一个匹配节点生成上下文片段
      // Generate context snippet from first matching node
      const snippet = this._semanticMemory.buildContextSnippet(nodes[0].id, {
        maxHops: 2,
        maxItems: 8,
      });

      return snippet;
    } catch (err) {
      this._logger.warn?.(`[ContextService] 语义记忆查询失败 / Semantic query failed: ${err.message}`);
      return '';
    }
  }

  /**
   * 构建信息素状态段落
   * Build pheromone state section
   *
   * @param {string} scope
   * @returns {Array<Object>}
   * @private
   */
  _buildPheromoneSection(scope) {
    try {
      const pheromones = this._pheromoneEngine.read(scope, { minIntensity: 0.05 });

      // 按强度降序排列, 限制返回数量 / Sort by intensity desc, limit count
      return pheromones
        .sort((a, b) => b.intensity - a.intensity)
        .slice(0, 20)
        .map((ph) => ({
          id: ph.id,
          type: ph.type,
          sourceId: ph.sourceId,
          targetScope: ph.targetScope,
          intensity: ph.intensity,
          payload: ph.payload,
        }));
    } catch (err) {
      this._logger.warn?.(`[ContextService] 信息素读取失败 / Pheromone read failed: ${err.message}`);
      return [];
    }
  }

  /**
   * 构建 Agent 状态段落
   * Build agent states section from gossip protocol
   *
   * @param {string} currentAgentId - 当前 agent, 排除自身 / Current agent, exclude self
   * @returns {Array<Object>}
   * @private
   */
  _buildAgentStatesSection(currentAgentId) {
    try {
      const allStates = this._gossipProtocol.getAllStates();
      const result = [];

      for (const [agentId, state] of allStates) {
        // 排除当前 agent 自身 / Exclude current agent
        if (agentId === currentAgentId) continue;

        result.push({
          agentId,
          status: state.status || state.state || 'unknown',
          currentTask: state.currentTask || state.task || null,
          tier: state.tier || null,
          lastSeen: state._lastSeen || null,
        });
      }

      // 按最近活跃排序 / Sort by most recently seen
      result.sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0));
      return result;
    } catch (err) {
      this._logger.warn?.(`[ContextService] Gossip 状态读取失败 / Gossip state read failed: ${err.message}`);
      return [];
    }
  }

  /**
   * 构建压缩版本 (适配 LLM token 预算)
   * Build compressed version for LLM token budget
   *
   * 收集工作记忆和情景记忆的条目, 通过 ContextCompressor 压缩为紧凑文本。
   * Collects items from working memory and episodic memory,
   * compresses into compact text via ContextCompressor.
   *
   * @param {{ focus: Array, context: Array, scratchpad: Array }} wmSnapshot
   * @param {Array<Object>} episodicItems
   * @param {number} maxItems
   * @param {number} maxChars
   * @returns {{ compressed: string, itemCount: number, truncated: boolean }}
   * @private
   */
  _buildCompressedSection(wmSnapshot, episodicItems, maxItems, maxChars) {
    try {
      // 合并所有可压缩的条目 / Merge all compressible items
      const allItems = [
        ...wmSnapshot.focus,
        ...wmSnapshot.context,
        ...wmSnapshot.scratchpad,
        ...episodicItems,
      ];

      return this._contextCompressor.compress(allItems, {
        maxItems,
        maxChars,
      });
    } catch (err) {
      this._logger.warn?.(`[ContextService] 上下文压缩失败 / Context compression failed: ${err.message}`);
      return { compressed: '', itemCount: 0, truncated: false };
    }
  }

  // ━━━ 缓存管理 / Cache Management ━━━

  /**
   * 从缓存获取 (检查 TTL)
   * Get from cache (check TTL)
   *
   * @param {string} agentId
   * @returns {Object | null}
   * @private
   */
  _getFromCache(agentId) {
    const entry = this._cache.get(agentId);
    if (!entry) return null;

    // 检查 TTL / Check TTL
    if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
      this._cache.delete(agentId);
      return null;
    }

    return entry.context;
  }
}
