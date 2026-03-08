/**
 * KnowledgeRepository — 知识图谱数据访问 / Knowledge Graph Data Access
 *
 * 管理 knowledge_nodes + knowledge_edges 表, 提供:
 * - 节点/边 CRUD
 * - BFS N-hop 遍历
 * - 最短路径查询
 * - 知识融合 (merge)
 *
 * Manages knowledge_nodes + knowledge_edges tables, providing:
 * - Node/Edge CRUD
 * - BFS N-hop traversal
 * - Shortest path query
 * - Knowledge merge
 *
 * @module L1-infrastructure/database/repositories/knowledge-repo
 * @author DEEP-IOS
 */

export class KnowledgeRepository {
  /**
   * @param {import('../database-manager.js').DatabaseManager} dbManager
   */
  constructor(dbManager) {
    this.db = dbManager;
  }

  // ━━━ 节点 CRUD / Node CRUD ━━━

  /**
   * 创建知识节点
   * Create knowledge node
   *
   * @param {Object} params
   * @param {string} [params.id]
   * @param {string} params.nodeType - concept/entity/skill/pattern/tool
   * @param {string} params.label
   * @param {Object} [params.properties]
   * @param {number} [params.importance=0.5]
   * @returns {string} node ID
   */
  createNode({ id, nodeType, label, properties, importance = 0.5 }) {
    const nodeId = id || this.db.generateId('kn');
    const now = Date.now();
    const stmt = this.db.prepare('kn_create', `
      INSERT INTO knowledge_nodes (id, node_type, label, properties, importance, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(nodeId, nodeType, label, properties ? JSON.stringify(properties) : null, importance, now, now);
    return nodeId;
  }

  /**
   * 获取节点
   * Get node by ID
   */
  getNode(id) {
    const row = this.db.get('SELECT * FROM knowledge_nodes WHERE id = ?', id);
    return row ? this._parseNode(row) : null;
  }

  /**
   * 按标签搜索节点
   * Search nodes by label (LIKE)
   */
  searchNodes(labelPattern, nodeType = null, limit = 20) {
    if (nodeType) {
      return this.db.all(
        'SELECT * FROM knowledge_nodes WHERE label LIKE ? AND node_type = ? ORDER BY importance DESC LIMIT ?',
        `%${labelPattern}%`, nodeType, limit,
      ).map(r => this._parseNode(r));
    }
    return this.db.all(
      'SELECT * FROM knowledge_nodes WHERE label LIKE ? ORDER BY importance DESC LIMIT ?',
      `%${labelPattern}%`, limit,
    ).map(r => this._parseNode(r));
  }

  /**
   * 更新节点
   * Update node
   */
  updateNode(id, updates) {
    const sets = [];
    const values = [];

    if (updates.label !== undefined) { sets.push('label = ?'); values.push(updates.label); }
    if (updates.nodeType !== undefined) { sets.push('node_type = ?'); values.push(updates.nodeType); }
    if (updates.properties !== undefined) { sets.push('properties = ?'); values.push(JSON.stringify(updates.properties)); }
    if (updates.importance !== undefined) { sets.push('importance = ?'); values.push(updates.importance); }

    if (sets.length === 0) return;
    sets.push('updated_at = ?');
    values.push(Date.now());
    values.push(id);

    this.db.run(`UPDATE knowledge_nodes SET ${sets.join(', ')} WHERE id = ?`, ...values);
  }

  /**
   * 删除节点及其所有边
   * Delete node and all its edges
   */
  deleteNode(id) {
    this.db.transaction(() => {
      this.db.run('DELETE FROM knowledge_edges WHERE source_id = ? OR target_id = ?', id, id);
      this.db.run('DELETE FROM knowledge_nodes WHERE id = ?', id);
    });
  }

  // ━━━ 边 CRUD / Edge CRUD ━━━

  /**
   * 创建边
   * Create edge
   *
   * @param {Object} params
   * @param {string} params.sourceId
   * @param {string} params.targetId
   * @param {string} params.edgeType - uses/depends_on/related_to/part_of/causes/evolved_from
   * @param {number} [params.weight=1.0]
   * @param {Object} [params.properties]
   * @returns {string} edge ID
   */
  createEdge({ id, sourceId, targetId, edgeType, weight = 1.0, properties }) {
    const edgeId = id || this.db.generateId('ke');
    const stmt = this.db.prepare('ke_create', `
      INSERT INTO knowledge_edges (id, source_id, target_id, edge_type, weight, properties, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(edgeId, sourceId, targetId, edgeType, weight, properties ? JSON.stringify(properties) : null, Date.now());
    return edgeId;
  }

  /**
   * 获取节点的出边
   * Get outgoing edges of a node
   */
  getOutEdges(nodeId, edgeType = null) {
    if (edgeType) {
      return this.db.all(
        'SELECT * FROM knowledge_edges WHERE source_id = ? AND edge_type = ?', nodeId, edgeType,
      ).map(r => this._parseEdge(r));
    }
    return this.db.all(
      'SELECT * FROM knowledge_edges WHERE source_id = ?', nodeId,
    ).map(r => this._parseEdge(r));
  }

  /**
   * 获取节点的入边
   * Get incoming edges of a node
   */
  getInEdges(nodeId, edgeType = null) {
    if (edgeType) {
      return this.db.all(
        'SELECT * FROM knowledge_edges WHERE target_id = ? AND edge_type = ?', nodeId, edgeType,
      ).map(r => this._parseEdge(r));
    }
    return this.db.all(
      'SELECT * FROM knowledge_edges WHERE target_id = ?', nodeId,
    ).map(r => this._parseEdge(r));
  }

  /**
   * 删除边
   * Delete edge
   */
  deleteEdge(id) {
    this.db.run('DELETE FROM knowledge_edges WHERE id = ?', id);
  }

  /**
   * 更新边权重
   * Update edge weight
   */
  updateEdgeWeight(id, weight) {
    this.db.run('UPDATE knowledge_edges SET weight = ? WHERE id = ?', weight, id);
  }

  // ━━━ 图遍历 / Graph Traversal ━━━

  /**
   * BFS N-hop 遍历: 从起始节点出发, 获取 N 跳内的所有节点
   * BFS N-hop traversal: from start node, get all nodes within N hops
   *
   * @param {string} startNodeId - 起始节点 / Start node
   * @param {number} [maxHops=3] - 最大跳数 / Max hops
   * @param {Object} [options]
   * @param {string} [options.edgeType] - 限定边类型 / Filter by edge type
   * @param {number} [options.minImportance=0] - 最小重要性 / Min importance
   * @returns {Array<{node: Object, depth: number, path: string[]}>}
   */
  bfsTraverse(startNodeId, maxHops = 3, { edgeType, minImportance = 0 } = {}) {
    const visited = new Set();
    const results = [];
    let queue = [{ nodeId: startNodeId, depth: 0, path: [startNodeId] }];

    while (queue.length > 0) {
      const nextQueue = [];

      for (const { nodeId, depth, path } of queue) {
        if (visited.has(nodeId)) continue;
        visited.add(nodeId);

        const node = this.getNode(nodeId);
        if (!node) continue;

        // 跳过低重要性节点 (起始节点除外) / Skip low importance nodes (except start)
        if (depth > 0 && node.importance < minImportance) continue;

        results.push({ node, depth, path });

        // 继续扩展 / Continue expanding
        if (depth < maxHops) {
          const edges = this.getOutEdges(nodeId, edgeType);
          for (const edge of edges) {
            if (!visited.has(edge.targetId)) {
              nextQueue.push({
                nodeId: edge.targetId,
                depth: depth + 1,
                path: [...path, edge.targetId],
              });
            }
          }

          // 也遍历入边 (双向图) / Also traverse incoming edges (bidirectional)
          const inEdges = this.getInEdges(nodeId, edgeType);
          for (const edge of inEdges) {
            if (!visited.has(edge.sourceId)) {
              nextQueue.push({
                nodeId: edge.sourceId,
                depth: depth + 1,
                path: [...path, edge.sourceId],
              });
            }
          }
        }
      }

      queue = nextQueue;
    }

    return results;
  }

  /**
   * BFS 最短路径
   * BFS shortest path between two nodes
   *
   * @param {string} fromId
   * @param {string} toId
   * @param {number} [maxDepth=10]
   * @returns {string[] | null} 路径节点 ID 列表, 或 null / Path node IDs, or null
   */
  shortestPath(fromId, toId, maxDepth = 10) {
    if (fromId === toId) return [fromId];

    const visited = new Set();
    let queue = [{ nodeId: fromId, path: [fromId] }];

    for (let depth = 0; depth < maxDepth; depth++) {
      const nextQueue = [];

      for (const { nodeId, path } of queue) {
        if (visited.has(nodeId)) continue;
        visited.add(nodeId);

        // 检查出边 / Check outgoing edges
        const outEdges = this.getOutEdges(nodeId);
        for (const edge of outEdges) {
          const newPath = [...path, edge.targetId];
          if (edge.targetId === toId) return newPath;
          if (!visited.has(edge.targetId)) {
            nextQueue.push({ nodeId: edge.targetId, path: newPath });
          }
        }

        // 检查入边 / Check incoming edges
        const inEdges = this.getInEdges(nodeId);
        for (const edge of inEdges) {
          const newPath = [...path, edge.sourceId];
          if (edge.sourceId === toId) return newPath;
          if (!visited.has(edge.sourceId)) {
            nextQueue.push({ nodeId: edge.sourceId, path: newPath });
          }
        }
      }

      queue = nextQueue;
      if (queue.length === 0) break;
    }

    return null; // 不可达 / Unreachable
  }

  /**
   * 知识融合: 将 nodeB 合并到 nodeA, 重定向所有边
   * Knowledge merge: merge nodeB into nodeA, redirect all edges
   *
   * @param {string} nodeAId - 保留节点 / Keep this node
   * @param {string} nodeBId - 合并掉的节点 / Merge this node away
   */
  mergeNodes(nodeAId, nodeBId) {
    this.db.transaction(() => {
      // 重定向 nodeB 的出边 → nodeA / Redirect nodeB outgoing edges → nodeA
      this.db.run(
        'UPDATE knowledge_edges SET source_id = ? WHERE source_id = ?',
        nodeAId, nodeBId,
      );

      // 重定向 nodeB 的入边 → nodeA / Redirect nodeB incoming edges → nodeA
      this.db.run(
        'UPDATE knowledge_edges SET target_id = ? WHERE target_id = ?',
        nodeAId, nodeBId,
      );

      // 删除自环 / Delete self-loops
      this.db.run(
        'DELETE FROM knowledge_edges WHERE source_id = ? AND target_id = ?',
        nodeAId, nodeAId,
      );

      // 删除 nodeB / Delete nodeB
      this.db.run('DELETE FROM knowledge_nodes WHERE id = ?', nodeBId);

      // 更新 nodeA 的时间戳 / Update nodeA timestamp
      this.db.run(
        'UPDATE knowledge_nodes SET updated_at = ? WHERE id = ?',
        Date.now(), nodeAId,
      );
    });
  }

  /**
   * 获取节点数量
   * Get node count
   */
  countNodes() {
    const row = this.db.get('SELECT COUNT(*) as count FROM knowledge_nodes');
    return row ? row.count : 0;
  }

  /**
   * 获取边数量
   * Get edge count
   */
  countEdges() {
    const row = this.db.get('SELECT COUNT(*) as count FROM knowledge_edges');
    return row ? row.count : 0;
  }

  // ━━━ 内部方法 / Internal Methods ━━━

  _parseNode(row) {
    return {
      id: row.id,
      nodeType: row.node_type,
      label: row.label,
      properties: row.properties ? JSON.parse(row.properties) : null,
      importance: row.importance,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  _parseEdge(row) {
    return {
      id: row.id,
      sourceId: row.source_id,
      targetId: row.target_id,
      edgeType: row.edge_type,
      weight: row.weight,
      properties: row.properties ? JSON.parse(row.properties) : null,
      createdAt: row.created_at,
    };
  }
}
