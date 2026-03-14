/**
 * SemanticMemory -- 语义记忆服务 / Semantic Memory Service
 *
 * 包装 KnowledgeRepository (L1), 在其之上添加:
 * - 高层知识图谱操作 (概念/关系管理)
 * - 上下文片段生成 (buildContextSnippet - 用于 LLM 上下文注入)
 * - 知识发现 (BFS 遍历, 最短路径)
 * - 知识融合 (merge)
 * - MessageBus 事件集成
 *
 * Wraps KnowledgeRepository (L1), adding:
 * - High-level knowledge graph operations (concept/relation management)
 * - Context snippet generation (buildContextSnippet - for LLM context injection)
 * - Knowledge discovery (BFS traversal, shortest path)
 * - Knowledge merge
 * - MessageBus event integration
 *
 * @module L3-agent/memory/semantic-memory
 * @author DEEP-IOS
 */

export class SemanticMemory {
  /**
   * @param {Object} deps - 依赖注入 / Dependency injection
   * @param {import('../../L1-infrastructure/database/repositories/knowledge-repo.js').KnowledgeRepository} deps.knowledgeRepo
   * @param {import('../../L2-communication/message-bus.js').MessageBus} deps.messageBus
   * @param {Object} [deps.logger]
   */
  constructor({ knowledgeRepo, messageBus, logger }) {
    /** @type {import('../../L1-infrastructure/database/repositories/knowledge-repo.js').KnowledgeRepository} */
    this._repo = knowledgeRepo;

    /** @type {import('../../L2-communication/message-bus.js').MessageBus} */
    this._bus = messageBus;

    /** @type {Object} */
    this._logger = logger || console;

    /** @type {import('../hybrid-retrieval.js').HybridRetrieval|null} V6.0 */
    this._hybridRetrieval = null;
  }

  /**
   * V6.0: 注入混合检索 / Inject hybrid retrieval
   * @param {import('../hybrid-retrieval.js').HybridRetrieval} hr
   */
  setHybridRetrieval(hr) {
    this._hybridRetrieval = hr;
  }

  // ━━━ 概念管理 / Concept Management ━━━

  /**
   * 添加概念节点
   * Add a concept node to the knowledge graph
   *
   * @param {Object} params
   * @param {string} params.label - 节点标签 / Node label
   * @param {string} [params.nodeType='concept'] - concept/entity/skill/pattern/tool
   * @param {Object} [params.properties] - 附加属性 / Additional properties
   * @param {number} [params.importance=0.5] - 重要性 (0-1)
   * @returns {string} 节点 ID / Node ID
   */
  addConcept({ label, nodeType = 'concept', properties, importance = 0.5 }) {
    const nodeId = this._repo.createNode({ nodeType, label, properties, importance });

    this._bus.publish('memory.semantic.concept.added', {
      nodeId,
      label,
      nodeType,
      importance,
    }, { senderId: 'semantic-memory' });

    this._logger.debug?.(`[SemanticMemory] Added concept: ${label} (${nodeId})`);
    return nodeId;
  }

  // ━━━ 关系管理 / Relation Management ━━━

  /**
   * 添加关系边
   * Add a relation edge between two nodes
   *
   * @param {Object} params
   * @param {string} params.sourceId - 源节点 ID
   * @param {string} params.targetId - 目标节点 ID
   * @param {string} params.edgeType - uses/depends_on/related_to/part_of/causes/evolved_from
   * @param {number} [params.weight=1.0] - 边权重
   * @param {Object} [params.properties] - 附加属性
   * @returns {string} 边 ID / Edge ID
   */
  addRelation({ sourceId, targetId, edgeType, weight = 1.0, properties }) {
    const edgeId = this._repo.createEdge({ sourceId, targetId, edgeType, weight, properties });

    this._bus.publish('memory.semantic.relation.added', {
      edgeId,
      sourceId,
      targetId,
      edgeType,
      weight,
    }, { senderId: 'semantic-memory' });

    this._logger.debug?.(`[SemanticMemory] Added relation: ${sourceId} --[${edgeType}]--> ${targetId}`);
    return edgeId;
  }

  // ━━━ 查询 / Query ━━━

  /**
   * 按标签查询知识节点
   * Query knowledge nodes by label
   *
   * @param {string} label - 搜索模式 (LIKE) / Search pattern (LIKE match)
   * @param {Object} [options]
   * @param {string} [options.nodeType] - 按节点类型过滤
   * @param {number} [options.limit=20] - 返回数量上限
   * @returns {Array<Object>} 匹配的节点 / Matching nodes
   */
  query(label, { nodeType, limit = 20 } = {}) {
    return this._repo.searchNodes(label, nodeType, limit);
  }

  /**
   * V6.0: 混合语义查询 / Hybrid semantic query
   *
   * 向量预筛选 + BFS 精排。Fallback 到标准 query。
   * Vector pre-filtering + BFS re-ranking. Fallback to standard query.
   *
   * @param {string} queryText - 自然语言查询
   * @param {Object} [options]
   * @param {string[]} [options.contextNodeIds] - 上下文节点
   * @param {number} [options.limit=20]
   * @returns {Promise<Array<Object>>}
   */
  async hybridQuery(queryText, { contextNodeIds = [], limit = 20 } = {}) {
    if (!this._hybridRetrieval || !queryText) {
      return this.query(queryText, { limit });
    }

    try {
      const results = await this._hybridRetrieval.search({
        query: queryText,
        contextNodeIds,
        topK: limit * 2,
        finalK: limit,
        filter: { sourceTable: 'knowledge_nodes' },
      });
      return results;
    } catch (err) {
      this._logger.debug?.(`[SemanticMemory] Hybrid query failed, fallback: ${err.message}`);
      return this.query(queryText, { limit });
    }
  }

  // ━━━ 知识发现 / Knowledge Discovery ━━━

  /**
   * 获取与指定节点相关的知识 (BFS N-hop 遍历)
   * Get related knowledge via BFS N-hop traversal
   *
   * @param {string} nodeId - 起始节点 ID
   * @param {Object} [options]
   * @param {number} [options.maxHops=3] - 最大跳数
   * @param {string} [options.edgeType] - 限定边类型
   * @param {number} [options.minImportance=0] - 最小重要性
   * @returns {Array<{node: Object, depth: number, path: string[]}>}
   */
  getRelated(nodeId, { maxHops = 3, edgeType, minImportance = 0 } = {}) {
    return this._repo.bfsTraverse(nodeId, maxHops, { edgeType, minImportance });
  }

  /**
   * 查找两个节点之间的最短路径
   * Find shortest path between two nodes
   *
   * @param {string} fromId - 起始节点 ID
   * @param {string} toId - 目标节点 ID
   * @returns {string[]|null} 路径节点 ID 列表, 或 null 不可达 / Path node IDs, or null
   */
  findPath(fromId, toId) {
    return this._repo.shortestPath(fromId, toId);
  }

  // ━━━ 知识融合 / Knowledge Merge ━━━

  /**
   * 合并两个节点: 将 mergeNodeId 的所有边重定向到 keepNodeId, 然后删除 mergeNodeId
   * Merge two nodes: redirect all edges of mergeNodeId to keepNodeId, then delete mergeNodeId
   *
   * @param {string} keepNodeId - 保留的节点 / Node to keep
   * @param {string} mergeNodeId - 被合并删除的节点 / Node to merge away
   */
  merge(keepNodeId, mergeNodeId) {
    // 先获取节点信息用于广播 / Get node info for broadcasting
    const keepNode = this._repo.getNode(keepNodeId);
    const mergeNode = this._repo.getNode(mergeNodeId);

    if (!keepNode || !mergeNode) {
      this._logger.warn?.(`[SemanticMemory] Merge failed: node not found (keep=${keepNodeId}, merge=${mergeNodeId})`);
      return;
    }

    this._repo.mergeNodes(keepNodeId, mergeNodeId);

    this._bus.publish('memory.semantic.merged', {
      keepNodeId,
      mergeNodeId,
      keepLabel: keepNode.label,
      mergeLabel: mergeNode.label,
    }, { senderId: 'semantic-memory' });

    this._logger.info?.(`[SemanticMemory] Merged "${mergeNode.label}" into "${keepNode.label}"`);
  }

  // ━━━ 上下文片段生成 / Context Snippet Generation ━━━

  /**
   * 构建 LLM 上下文片段: 从指定节点出发 BFS 遍历, 格式化为可读文本
   * Build LLM context snippet: BFS from a node, format into readable text
   *
   * 输出格式示例 / Output format example:
   * ```
   * [Knowledge: "React"]
   *   -> uses: "JSX", "Virtual DOM"
   *   -> depends_on: "JavaScript"
   *   -> related_to: "Vue.js"
   * ```
   *
   * @param {string} nodeId - 起始节点 ID
   * @param {Object} [options]
   * @param {number} [options.maxHops=2] - BFS 最大跳数
   * @param {number} [options.maxItems=10] - 最多包含的节点数
   * @returns {string} 格式化的上下文文本 / Formatted context text
   */
  buildContextSnippet(nodeId, { maxHops = 2, maxItems = 10 } = {}) {
    const rootNode = this._repo.getNode(nodeId);
    if (!rootNode) return '';

    // BFS 获取相关节点 / BFS to get related nodes
    const bfsResults = this._repo.bfsTraverse(nodeId, maxHops, {});
    if (bfsResults.length === 0) return '';

    // 构建邻接映射: nodeId -> { edgeType -> [targetLabel] }
    // Build adjacency map: nodeId -> { edgeType -> [targetLabel] }
    const adjacency = new Map();

    // 收集所有涉及的节点 ID (去重, 限制数量)
    // Collect involved node IDs (deduplicate, limit count)
    const involvedIds = new Set();
    for (let i = 0; i < Math.min(bfsResults.length, maxItems); i++) {
      involvedIds.add(bfsResults[i].node.id);
    }

    // 为根节点收集出边 / Collect outgoing edges for root node
    for (const nid of involvedIds) {
      const outEdges = this._repo.getOutEdges(nid);
      for (const edge of outEdges) {
        if (!involvedIds.has(edge.targetId)) continue;
        const targetNode = this._repo.getNode(edge.targetId);
        if (!targetNode) continue;

        if (!adjacency.has(nid)) adjacency.set(nid, new Map());
        const edgeMap = adjacency.get(nid);
        if (!edgeMap.has(edge.edgeType)) edgeMap.set(edge.edgeType, []);
        edgeMap.get(edge.edgeType).push(targetNode.label);
      }
    }

    // 格式化输出 / Format output
    const lines = [];

    // 根节点标题 / Root node header
    lines.push(`[Knowledge: "${rootNode.label}"]`);

    // 根节点的直接关系 / Root node direct relations
    const rootAdj = adjacency.get(nodeId);
    if (rootAdj) {
      for (const [edgeType, labels] of rootAdj) {
        const labelStr = labels.map((l) => `"${l}"`).join(', ');
        lines.push(`  -> ${edgeType}: ${labelStr}`);
      }
    }

    // 非根节点的关系 (深层节点) / Non-root node relations (deeper nodes)
    for (const [nid, edgeMap] of adjacency) {
      if (nid === nodeId) continue; // 根节点已处理 / Root already processed
      const node = this._repo.getNode(nid);
      if (!node) continue;

      lines.push(`[Knowledge: "${node.label}"]`);
      for (const [edgeType, labels] of edgeMap) {
        const labelStr = labels.map((l) => `"${l}"`).join(', ');
        lines.push(`  -> ${edgeType}: ${labelStr}`);
      }
    }

    return lines.join('\n');
  }

  // ━━━ 统计 / Statistics ━━━

  /**
   * 获取语义记忆统计
   * Get semantic memory statistics
   *
   * @returns {{ nodeCount: number, edgeCount: number }}
   */
  getStats() {
    return {
      nodeCount: this._repo.countNodes(),
      edgeCount: this._repo.countEdges(),
    };
  }
}
