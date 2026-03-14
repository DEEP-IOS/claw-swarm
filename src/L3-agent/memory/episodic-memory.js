/**
 * EpisodicMemory -- 情景记忆服务 / Episodic Memory Service
 *
 * 包装 EpisodicRepository (L1), 在其之上添加:
 * - 多维检索评分: score = importance*0.4 + timeDecay*0.2 + relevance*0.2 + reward*0.2
 * - Ebbinghaus 遗忘曲线集成
 * - 会话分组
 * - 记忆固化: 将工作记忆条目持久化到情景记忆
 *
 * Wraps EpisodicRepository (L1), adding:
 * - Multi-dimensional retrieval scoring
 * - Ebbinghaus forgetting curve integration
 * - Session-based grouping
 * - Memory consolidation: flush working memory items to episodic storage
 *
 * 评分公式 / Scoring formula:
 *   score = importance*0.4 + timeDecay*0.2 + relevance*0.2 + reward*0.2
 *   timeDecay = e^(-ageDays/30) (Ebbinghaus λ=30)
 *
 * Ebbinghaus 遗忘 / Ebbinghaus forgetting:
 *   retention(t) = e^(-t / (lambda * importance))
 *   lambda = 30 days (default)
 *
 * @module L3-agent/memory/episodic-memory
 * @author DEEP-IOS
 */

export class EpisodicMemory {
  /**
   * @param {Object} deps - 依赖注入 / Dependency injection
   * @param {import('../../L1-infrastructure/database/repositories/episodic-repo.js').EpisodicRepository} deps.episodicRepo
   * @param {import('../../L2-communication/message-bus.js').MessageBus} deps.messageBus
   * @param {Object} [deps.logger]
   */
  constructor({ episodicRepo, messageBus, logger }) {
    /** @type {import('../../L1-infrastructure/database/repositories/episodic-repo.js').EpisodicRepository} */
    this._repo = episodicRepo;

    /** @type {import('../../L2-communication/message-bus.js').MessageBus} */
    this._bus = messageBus;

    /** @type {Object} */
    this._logger = logger || console;

    /** @type {import('../hybrid-retrieval.js').HybridRetrieval|null} V6.0 */
    this._hybridRetrieval = null;

    /** @type {import('./semantic-memory.js').SemanticMemory|null} P1-5: 语义记忆引用 / Semantic memory reference */
    this._semanticMemory = null;
  }

  /**
   * V6.0: 注入混合检索 / Inject hybrid retrieval
   * @param {import('../hybrid-retrieval.js').HybridRetrieval} hr
   */
  setHybridRetrieval(hr) {
    this._hybridRetrieval = hr;
  }

  /**
   * P1-5: 注入语义记忆实例 / Inject semantic memory instance
   * @param {import('./semantic-memory.js').SemanticMemory} sm
   */
  setSemanticMemory(sm) {
    this._semanticMemory = sm;
  }

  // ━━━ 记录 / Record ━━━

  /**
   * 记录情景事件 (subject-predicate-object 三元组)
   * Record an episodic event (subject-predicate-object triplet)
   *
   * @param {Object} params
   * @param {string} params.agentId - 代理 ID
   * @param {string} params.eventType - action/observation/decision/error/success
   * @param {string} params.subject - 主语 / Subject
   * @param {string} params.predicate - 谓语 / Predicate
   * @param {string} [params.object] - 宾语 / Object
   * @param {Object} [params.context] - 上下文 / Context JSON
   * @param {number} [params.importance=0.5] - 重要性 (0-1)
   * @param {number} [params.reward] - 奖励信号 / Reward signal
   * @param {string} [params.sessionId] - 会话 ID
   * @returns {string} 事件 ID / Event ID
   */
  record({ agentId, eventType, subject, predicate, object, context, importance = 0.5, reward, sessionId }) {
    const eventId = this._repo.record({
      agentId,
      eventType,
      subject,
      predicate,
      object,
      context,
      importance,
      reward,
      sessionId,
    });

    // 广播记忆事件 / Broadcast memory event
    this._bus.publish('memory.episodic.recorded', {
      eventId,
      agentId,
      eventType,
      subject,
      predicate,
      importance,
    }, { senderId: 'episodic-memory' });

    this._logger.debug?.(`[EpisodicMemory] Recorded event ${eventId} for agent ${agentId}`);
    return eventId;
  }

  // ━━━ 检索 / Recall ━━━

  /**
   * 多维评分检索情景记忆
   * Recall episodic memories with multi-dimensional scoring
   *
   * score = importance*0.4 + timeDecay*0.2 + relevance*0.2 + reward*0.2
   *
   * @param {string} agentId
   * @param {Object} [options]
   * @param {string} [options.eventType] - 按事件类型过滤
   * @param {string} [options.keyword] - 在 subject/predicate/object 中搜索
   * @param {number} [options.limit=10] - 返回数量上限
   * @param {number} [options.minImportance=0] - 最低重要性
   * @returns {Array<Object>} 按综合评分降序排列的事件 / Events sorted by score desc
   */
  recall(agentId, { eventType, keyword, limit = 10, minImportance = 0 } = {}) {
    // 从 repo 获取宽松候选集 (多取一些用于重排序)
    // Fetch a wider candidate set from repo (fetch more for re-ranking)
    const candidates = this._repo.recall(agentId, {
      eventType,
      keyword,
      limit: Math.max(limit * 3, 50),
      minImportance,
    });

    const now = Date.now();
    const scored = candidates.map((event) => {
      const score = this._computeScore(event, keyword, now);
      return { ...event, _score: score };
    });

    // 按综合评分降序排列 / Sort by composite score descending
    scored.sort((a, b) => b._score - a._score);
    return scored.slice(0, limit);
  }

  /**
   * V6.3: 跨 Agent 多维评分检索情景记忆
   * Cross-agent episodic memory recall with multi-dimensional scoring
   *
   * 与 recall() 相同的评分逻辑 (importance×0.4 + timeDecay×0.2 + relevance×0.2 + reward×0.2),
   * 但移除 agentId 过滤, 用于蜂群级别的全局记忆查询。
   * 返回结果包含 agentId 字段用于来源归属。
   *
   * Same scoring logic as recall(), but without agentId filter.
   * Used for swarm-level global memory queries.
   * Results include agentId field for source attribution.
   *
   * @param {Object} [options]
   * @param {string} [options.eventType] - 按事件类型过滤
   * @param {string} [options.keyword] - 在 subject/predicate/object 中搜索
   * @param {number} [options.limit=10] - 返回数量上限
   * @param {number} [options.minImportance=0] - 最低重要性
   * @returns {Array<Object>} 按综合评分降序排列的事件 (含 agentId) / Events sorted by score desc (with agentId)
   */
  recallAll({ eventType, keyword, limit = 10, minImportance = 0 } = {}) {
    // 从 repo 获取宽松候选集 (多取一些用于重排序)
    // Fetch a wider candidate set from repo (fetch more for re-ranking)
    const candidates = this._repo.recallAll({
      eventType,
      keyword,
      limit: Math.max(limit * 3, 50),
      minImportance,
    });

    const now = Date.now();
    const scored = candidates.map((event) => {
      const score = this._computeScore(event, keyword, now);
      return { ...event, _score: score };
    });

    // 按综合评分降序排列 / Sort by composite score descending
    scored.sort((a, b) => b._score - a._score);
    return scored.slice(0, limit);
  }

  /**
   * V6.0: 混合检索召回 / Hybrid retrieval recall
   *
   * 优先使用向量+混合检索, fallback 到标准 recall。
   * Prefer vector+hybrid retrieval, fallback to standard recall.
   *
   * @param {string} agentId
   * @param {Object} options
   * @param {string} options.query - 自然语言查询 / Natural language query
   * @param {number} [options.limit=10]
   * @param {string[]} [options.contextNodeIds] - 上下文节点
   * @returns {Promise<Array<Object>>}
   */
  async hybridRecall(agentId, { query, limit = 10, contextNodeIds = [] } = {}) {
    if (!this._hybridRetrieval || !query) {
      // fallback 到标准召回 / Fallback to standard recall
      return this.recall(agentId, { keyword: query, limit });
    }

    try {
      const results = await this._hybridRetrieval.search({
        query,
        contextNodeIds,
        topK: limit * 3,
        finalK: limit,
        filter: { sourceTable: 'memories' },
      });
      return results;
    } catch (err) {
      this._logger.debug?.(`[EpisodicMemory] Hybrid recall failed, fallback: ${err.message}`);
      return this.recall(agentId, { keyword: query, limit });
    }
  }

  // ━━━ 时间线 / Timeline ━━━

  /**
   * 获取代理的事件时间线 (按时间正序)
   * Get agent's event timeline (chronological order)
   *
   * @param {string} agentId
   * @param {Object} [options]
   * @param {number} [options.limit=20] - 返回数量上限
   * @param {number} [options.since] - 起始时间戳 / Since timestamp
   * @returns {Array<Object>}
   */
  getTimeline(agentId, { limit = 20, since } = {}) {
    const events = this._repo.getRecent(agentId, limit * 2);

    let result = events;
    if (since) {
      result = result.filter((e) => e.timestamp >= since);
    }

    // repo 返回的是 DESC, 按 timestamp ASC + id ASC 重排为正序
    // repo returns DESC, re-sort to chronological (timestamp ASC, id ASC for stable tie-breaking)
    result.sort((a, b) => {
      const td = Number(a.timestamp) - Number(b.timestamp);
      if (td !== 0) return td;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
    return result.slice(0, limit);
  }

  // ━━━ 会话查询 / Session Query ━━━

  /**
   * 按会话 ID 获取事件
   * Get events by session ID
   *
   * @param {string} sessionId
   * @returns {Array<Object>}
   */
  getBySession(sessionId) {
    return this._repo.getBySession(sessionId);
  }

  // ━━━ 固化 / Consolidation ━━━

  /**
   * 将工作记忆条目固化到情景记忆
   * Consolidate working memory items to episodic storage
   *
   * 遍历工作记忆条目, 将每一项记录为一个 "consolidation" 类型的情景事件。
   * Iterates working memory items and records each as a "consolidation" episodic event.
   *
   * @param {string} agentId
   * @param {Array<Object>} workingMemoryItems - 来自 WorkingMemory 的条目
   * @returns {string[]} 新创建的事件 ID 列表 / Array of newly created event IDs
   */
  consolidate(agentId, workingMemoryItems) {
    if (!workingMemoryItems || workingMemoryItems.length === 0) return [];

    const eventIds = [];
    for (const item of workingMemoryItems) {
      const eventId = this._repo.record({
        agentId,
        eventType: 'observation',
        subject: agentId,
        predicate: 'consolidated',
        object: item.key,
        context: {
          value: item.value,
          layer: item.layer,
          accessCount: item.accessCount,
          originalPriority: item.priority,
        },
        importance: item.importance || 0.5,
        sessionId: null,
      });
      eventIds.push(eventId);
    }

    // 广播固化事件 / Broadcast consolidation event
    this._bus.publish('memory.episodic.consolidated', {
      agentId,
      count: eventIds.length,
    }, { senderId: 'episodic-memory' });

    this._logger.info?.(`[EpisodicMemory] Consolidated ${eventIds.length} items for agent ${agentId}`);
    return eventIds;
  }

  // ━━━ 遗忘清理 / Forgetting & Pruning ━━━

  /**
   * Ebbinghaus 遗忘曲线清理: 委托给 repo.prune()
   * Prune via Ebbinghaus forgetting curve: delegates to repo.prune()
   *
   * retention(t) = e^(-t / (lambda * importance))
   * 当 retention < retentionThreshold 时删除
   * Delete when retention < retentionThreshold
   *
   * @param {Object} [options]
   * @param {number} [options.lambdaDays=30] - 遗忘衰减常数 (天) / Decay constant in days
   * @param {number} [options.retentionThreshold=0.1] - 保留阈值 / Retention threshold
   * @returns {number} 删除数量 / Number of events pruned
   */
  prune({ lambdaDays = 30, retentionThreshold = 0.1 } = {}) {
    const count = this._repo.prune(lambdaDays, retentionThreshold);

    if (count > 0) {
      this._bus.publish('memory.episodic.pruned', { count }, { senderId: 'episodic-memory' });
      this._logger.info?.(`[EpisodicMemory] Pruned ${count} forgotten events`);
    }

    return count;
  }

  // ━━━ 情景→语义固化 / Episodic→Semantic Consolidation (P1-5) ━━━

  /**
   * P1-5: 从情景记忆中提取高频模式并注入语义记忆
   * Extract recurring patterns from episodic memory and inject into semantic memory
   *
   * 1. 查询指定代理的全部情景事件
   *    Query all episodic events for the given agent
   * 2. 统计 predicate::object 对的频率
   *    Count frequency of predicate::object pairs
   * 3. 过滤出现次数 >= minOccurrences 的模式
   *    Filter pairs with count >= minOccurrences
   * 4. 如果提供了 semanticMemory, 将模式作为概念节点注入语义图
   *    If semanticMemory provided, inject patterns as concept nodes into semantic graph
   *
   * @param {string} agentId - 代理 ID / Agent ID
   * @param {Object} [options]
   * @param {number} [options.minOccurrences=3] - 最低出现次数阈值 / Minimum occurrence threshold
   * @param {import('./semantic-memory.js').SemanticMemory} [options.semanticMemory] - 语义记忆实例 (可选覆盖) / Semantic memory instance (optional override)
   * @returns {{ patterns: Array<{predicate: string, object: string, occurrences: number}>, injected: number }}
   */
  extractPatterns(agentId, { minOccurrences = 3, semanticMemory } = {}) {
    // 确定语义记忆目标: 参数优先, 否则用注入的实例
    // Resolve semantic memory target: parameter takes precedence, then injected instance
    const sm = semanticMemory || this._semanticMemory;

    // 1. 查询该代理的全部情景事件 / Query all episodic events for this agent
    const allEvents = this._repo.recall(agentId, { limit: 100000 });

    // 2. 统计 predicate::object 对的频率 / Count predicate::object pair frequencies
    /** @type {Map<string, {predicate: string, object: string, count: number}>} */
    const freqMap = new Map();
    for (const event of allEvents) {
      if (!event.predicate) continue;
      const obj = event.object || '';
      const key = `${event.predicate}::${obj}`;
      if (freqMap.has(key)) {
        freqMap.get(key).count++;
      } else {
        freqMap.set(key, { predicate: event.predicate, object: obj, count: 1 });
      }
    }

    // 3. 过滤达到阈值的模式 / Filter patterns meeting threshold
    const patterns = [];
    for (const entry of freqMap.values()) {
      if (entry.count >= minOccurrences) {
        patterns.push({
          predicate: entry.predicate,
          object: entry.object,
          occurrences: entry.count,
        });
      }
    }

    // 按出现次数降序排列 / Sort by occurrences descending
    patterns.sort((a, b) => b.occurrences - a.occurrences);

    // 4. 注入语义记忆 / Inject into semantic memory
    let injected = 0;
    if (sm) {
      for (const p of patterns) {
        try {
          sm.addConcept({
            label: `pattern:${p.predicate}:${p.object}`,
            nodeType: 'extracted_pattern',
            properties: {
              predicate: p.predicate,
              object: p.object,
              occurrences: p.occurrences,
              agentId,
              extractedAt: Date.now(),
            },
            importance: Math.min(1, p.occurrences / 10),
          });
          injected++;
        } catch (err) {
          this._logger.warn?.(`[EpisodicMemory] Failed to inject pattern ${p.predicate}::${p.object}: ${err.message}`);
        }
      }
    }

    // 5. 广播模式提取事件 / Publish pattern extraction event
    this._bus.publish('memory.pattern.extracted', {
      agentId,
      totalEvents: allEvents.length,
      patternsFound: patterns.length,
      injected,
    }, { senderId: 'episodic-memory' });

    this._logger.info?.(`[EpisodicMemory] Extracted ${patterns.length} patterns (${injected} injected) from ${allEvents.length} events for agent ${agentId}`);
    return { patterns, injected };
  }

  // ━━━ 统计 / Statistics ━━━

  /**
   * 获取情景记忆统计
   * Get episodic memory statistics
   *
   * @param {string} [agentId] - 可选: 限定到特定代理
   * @returns {{ totalEvents: number, recentEvents: number }}
   */
  getStats(agentId) {
    const total = this._repo.count(agentId);

    // 最近 24 小时的事件数 / Events in the last 24 hours
    let recentCount = 0;
    if (agentId) {
      const recent = this._repo.getRecent(agentId, 1000);
      const oneDayAgo = Date.now() - 86400000;
      recentCount = recent.filter((e) => e.timestamp >= oneDayAgo).length;
    }

    return {
      totalEvents: total,
      recentEvents: recentCount,
    };
  }

  // ━━━ 内部方法 / Internal Methods ━━━

  /**
   * 计算多维综合评分
   * Compute multi-dimensional composite score
   *
   * score = importance*0.4 + timeDecay*0.2 + relevance*0.2 + reward*0.2
   *
   * @private
   * @param {Object} event - 情景事件
   * @param {string|null} keyword - 搜索关键词 (用于相关性评分)
   * @param {number} now - 当前时间戳
   * @returns {number}
   */
  _computeScore(event, keyword, now) {
    // 重要性分量 / Importance component
    const importanceScore = event.importance || 0;

    // 时间衰减分量: Ebbinghaus 遗忘曲线 e^(-t/λ), λ=30天
    // Time decay component: Ebbinghaus forgetting curve e^(-t/λ), λ=30 days
    const ageDays = (now - event.timestamp) / 86400000;
    const timeDecayScore = Math.exp(-ageDays / 30);

    // 相关性分量: 基于关键词匹配
    // Relevance component: keyword match
    let relevanceScore = 0.5; // 默认中等相关 / Default moderate relevance
    if (keyword) {
      const kw = keyword.toLowerCase();
      const fields = [event.subject, event.predicate, event.object].filter(Boolean);
      let matches = 0;
      for (const f of fields) {
        if (f.toLowerCase().includes(kw)) matches++;
      }
      relevanceScore = fields.length > 0 ? matches / fields.length : 0;
    }

    // 奖励分量: 归一化到 [0, 1]
    // Reward component: normalize to [0, 1]
    const rawReward = event.reward || 0;
    const rewardScore = Math.max(0, Math.min(1, (rawReward + 1) / 2)); // 假设 reward 在 [-1, 1]

    // 加权求和 / Weighted sum
    return (
      importanceScore * 0.4 +
      timeDecayScore * 0.2 +
      relevanceScore * 0.2 +
      rewardScore * 0.2
    );
  }
}
