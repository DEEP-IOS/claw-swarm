/**
 * SwarmMemoryTool -- 记忆系统工具 / Swarm Memory Tool
 *
 * V5.0 L5 应用层工具: 访问和管理代理记忆系统 (工作记忆、情景记忆、语义记忆)。
 * V5.0 L5 Application Layer tool: Access and manage agent memory systems
 * (working memory, episodic memory, semantic memory).
 *
 * 记忆层级 / Memory hierarchy:
 * - WorkingMemory:  三层注意力缓存 (focus/context/scratchpad)
 *                   3-layer attention cache
 * - EpisodicMemory: 情景事件记录与检索 (subject-predicate-object 三元组)
 *                   Episodic event recording & recall (SPO triplets)
 * - SemanticMemory: 知识图谱 (概念节点 + 关系边 + BFS 发现)
 *                   Knowledge graph (concept nodes + relation edges + BFS discovery)
 *
 * 动作 / Actions:
 * - record:    记录情景事件 / Record an episodic event
 * - recall:    检索情景记忆 / Recall from episodic memory
 * - knowledge: 查询/添加/连接知识图谱 / Query/add/connect knowledge graph
 * - working:   工作记忆操作 / Working memory operations
 * - stats:     记忆统计 / Memory statistics
 *
 * @module L5-application/tools/swarm-memory-tool
 * @author DEEP-IOS
 */

// ============================================================================
// 常量 / Constants
// ============================================================================

const TOOL_NAME = 'swarm_memory';
const TOOL_DESCRIPTION = 'Access and manage agent memory systems (working, episodic, semantic)';

/** 默认回忆数量上限 / Default recall limit */
const DEFAULT_RECALL_LIMIT = 10;

/** 默认 BFS 跳数 / Default BFS hops */
const DEFAULT_BFS_HOPS = 3;

// ============================================================================
// JSON Schema 定义 / JSON Schema Definition
// ============================================================================

const inputSchema = {
  type: 'object',
  properties: {
    action: {
      type: 'string',
      enum: ['record', 'recall', 'knowledge', 'working', 'stats'],
      description: '操作类型 / Action type',
    },
    agentId: {
      type: 'string',
      description: '代理 ID / Agent ID',
    },
    // record 参数 / record params
    eventType: {
      type: 'string',
      enum: ['action', 'observation', 'decision', 'error', 'success'],
      description: '事件类型 / Event type (for record action)',
    },
    subject: {
      type: 'string',
      description: '主语 / Subject (for record action)',
    },
    predicate: {
      type: 'string',
      description: '谓语 / Predicate (for record action)',
    },
    object: {
      type: 'string',
      description: '宾语 / Object (for record action, optional)',
    },
    importance: {
      type: 'number',
      description: '重要性 0-1 / Importance 0-1 (optional)',
    },
    // recall 参数 / recall params
    keyword: {
      type: 'string',
      description: '搜索关键词 / Search keyword (for recall action)',
    },
    limit: {
      type: 'number',
      description: '返回数量上限 / Return limit (optional)',
    },
    // knowledge 参数 / knowledge params
    subaction: {
      type: 'string',
      enum: ['query', 'add', 'connect'],
      description: '知识子操作 / Knowledge sub-action: query, add, or connect',
    },
    startNodeId: {
      type: 'string',
      description: '起始节点 ID (query 子操作) / Start node ID (for query sub-action)',
    },
    hops: {
      type: 'number',
      description: 'BFS 跳数 (query 子操作) / BFS hops (for query sub-action)',
    },
    nodeType: {
      type: 'string',
      description: '节点类型 (add 子操作) / Node type (for add sub-action)',
    },
    label: {
      type: 'string',
      description: '节点标签 (add 子操作) / Node label (for add sub-action)',
    },
    properties: {
      type: 'object',
      description: '节点属性 (add 子操作) / Node properties (for add sub-action)',
    },
    sourceId: {
      type: 'string',
      description: '源节点 ID (connect 子操作) / Source node ID (for connect sub-action)',
    },
    targetId: {
      type: 'string',
      description: '目标节点 ID (connect 子操作) / Target node ID (for connect sub-action)',
    },
    edgeType: {
      type: 'string',
      description: '边类型 (connect 子操作) / Edge type (for connect sub-action)',
    },
    weight: {
      type: 'number',
      description: '边权重 (connect 子操作) / Edge weight (for connect sub-action)',
    },
    // working 参数 / working params
    key: {
      type: 'string',
      description: '工作记忆键 / Working memory key',
    },
    value: {
      description: '工作记忆值 / Working memory value',
    },
    layer: {
      type: 'string',
      enum: ['focus', 'context', 'scratchpad'],
      description: '工作记忆层 / Working memory layer',
    },
    priority: {
      type: 'number',
      description: '优先级 0-10 / Priority 0-10',
    },
  },
  required: ['action'],
};

// ============================================================================
// 工厂函数 / Factory Function
// ============================================================================

/**
 * 创建记忆系统工具
 * Create the memory system tool
 *
 * @param {Object} deps
 * @param {Object} deps.engines - 引擎实例集合 / Engine instances
 * @param {Object} deps.logger - 日志器 / Logger
 * @returns {{ name: string, description: string, inputSchema: Object, handler: Function }}
 */
export function createMemoryTool({ engines, logger }) {
  const {
    workingMemory,
    episodicMemory,
    semanticMemory,
  } = engines;

  /**
   * 记录情景事件 / Record an episodic event
   *
   * @param {Object} input
   * @returns {Object}
   */
  async function handleRecord(input) {
    const { agentId, eventType, subject, predicate, object, importance = 0.5 } = input;

    if (!agentId) return { success: false, error: 'agentId 不能为空 / agentId is required' };
    if (!eventType) return { success: false, error: 'eventType 不能为空 / eventType is required' };
    if (!subject) return { success: false, error: 'subject 不能为空 / subject is required' };
    if (!predicate) return { success: false, error: 'predicate 不能为空 / predicate is required' };

    if (!episodicMemory) {
      return { success: false, error: 'episodicMemory 不可用 / episodicMemory not available' };
    }

    try {
      const eventId = episodicMemory.record({
        agentId,
        eventType,
        subject,
        predicate,
        object: object || null,
        importance: Math.max(0, Math.min(1, importance)),
      });

      logger.debug?.(
        `[SwarmMemoryTool] 情景事件已记录 / Episodic event recorded: ${eventId} (${subject} ${predicate})`
      );

      return {
        success: true,
        data: { eventId, eventType, subject, predicate },
        message: `情景事件已记录 / Episodic event recorded: ${eventId}`,
      };
    } catch (err) {
      return { success: false, error: `记录失败 / Record failed: ${err.message}` };
    }
  }

  /**
   * 检索情景记忆 / Recall from episodic memory
   *
   * @param {Object} input
   * @returns {Object}
   */
  async function handleRecall(input) {
    const { agentId, keyword, limit = DEFAULT_RECALL_LIMIT } = input;

    if (!agentId) return { success: false, error: 'agentId 不能为空 / agentId is required' };

    if (!episodicMemory) {
      return { success: false, error: 'episodicMemory 不可用 / episodicMemory not available' };
    }

    try {
      const events = episodicMemory.recall(agentId, { keyword, limit });

      return {
        success: true,
        data: events.map(e => ({
          id: e.id,
          eventType: e.event_type || e.eventType,
          subject: e.subject,
          predicate: e.predicate,
          object: e.object,
          importance: e.importance,
          timestamp: e.timestamp,
          score: e._score,
        })),
        count: events.length,
      };
    } catch (err) {
      return { success: false, error: `检索失败 / Recall failed: ${err.message}` };
    }
  }

  /**
   * 知识图谱操作 / Knowledge graph operations
   *
   * 子操作 / Sub-actions:
   * - query:   BFS 发现 / BFS discovery
   * - add:     添加节点 / Add node
   * - connect: 添加边 / Add edge
   *
   * @param {Object} input
   * @returns {Object}
   */
  async function handleKnowledge(input) {
    const { subaction } = input;

    if (!subaction) {
      return { success: false, error: 'subaction 不能为空 / subaction is required (query, add, connect)' };
    }

    if (!semanticMemory) {
      return { success: false, error: 'semanticMemory 不可用 / semanticMemory not available' };
    }

    try {
      switch (subaction) {
        case 'query': {
          // BFS 发现 / BFS discovery
          const { startNodeId, hops = DEFAULT_BFS_HOPS } = input;
          if (!startNodeId) {
            return { success: false, error: 'startNodeId 不能为空 / startNodeId is required for query' };
          }

          const related = semanticMemory.getRelated(startNodeId, { maxHops: hops });

          return {
            success: true,
            data: related.map(r => ({
              nodeId: r.node.id,
              label: r.node.label,
              nodeType: r.node.nodeType || r.node.node_type,
              depth: r.depth,
              path: r.path,
            })),
            count: related.length,
          };
        }

        case 'add': {
          // 添加概念节点 / Add concept node
          const { nodeType = 'concept', label: nodeLabel, properties: nodeProps, importance: nodeImportance = 0.5 } = input;
          if (!nodeLabel) {
            return { success: false, error: 'label 不能为空 / label is required for add' };
          }

          const nodeId = semanticMemory.addConcept({
            label: nodeLabel,
            nodeType,
            properties: nodeProps,
            importance: nodeImportance,
          });

          logger.debug?.(`[SwarmMemoryTool] 知识节点已添加 / Knowledge node added: ${nodeId} (${nodeLabel})`);

          return {
            success: true,
            data: { nodeId, label: nodeLabel, nodeType },
            message: `知识节点已添加 / Knowledge node added: ${nodeLabel}`,
          };
        }

        case 'connect': {
          // 添加关系边 / Add relation edge
          const { sourceId: edgeSrc, targetId: edgeTgt, edgeType, weight: edgeWeight = 1.0 } = input;
          if (!edgeSrc) return { success: false, error: 'sourceId 不能为空 / sourceId is required for connect' };
          if (!edgeTgt) return { success: false, error: 'targetId 不能为空 / targetId is required for connect' };
          if (!edgeType) return { success: false, error: 'edgeType 不能为空 / edgeType is required for connect' };

          const edgeId = semanticMemory.addRelation({
            sourceId: edgeSrc,
            targetId: edgeTgt,
            edgeType,
            weight: edgeWeight,
          });

          logger.debug?.(
            `[SwarmMemoryTool] 知识边已添加 / Knowledge edge added: ${edgeSrc} --[${edgeType}]--> ${edgeTgt}`
          );

          return {
            success: true,
            data: { edgeId, sourceId: edgeSrc, targetId: edgeTgt, edgeType },
            message: `知识边已添加 / Knowledge edge added: ${edgeType}`,
          };
        }

        default:
          return {
            success: false,
            error: `未知子操作 / Unknown subaction: ${subaction}. 支持 / Supported: query, add, connect`,
          };
      }
    } catch (err) {
      return { success: false, error: `知识操作失败 / Knowledge operation failed: ${err.message}` };
    }
  }

  /**
   * 工作记忆操作 / Working memory operations
   *
   * 子操作 / Sub-actions via input fields:
   * - get:      获取记忆条目 / Get memory entry (by key)
   * - set:      写入记忆条目 / Set memory entry (key + value)
   * - snapshot: 获取三层快照 / Get 3-layer snapshot
   *
   * @param {Object} input
   * @returns {Object}
   */
  async function handleWorking(input) {
    const { subaction, agentId, key, value, layer, priority } = input;

    if (!workingMemory) {
      return { success: false, error: 'workingMemory 不可用 / workingMemory not available' };
    }

    // 默认子操作为 snapshot / Default subaction is snapshot
    const op = subaction || (key && value !== undefined ? 'set' : key ? 'get' : 'snapshot');

    try {
      switch (op) {
        case 'get': {
          if (!key) return { success: false, error: 'key 不能为空 / key is required for get' };

          const val = workingMemory.get(key);

          return {
            success: true,
            data: {
              key,
              value: val,
              found: val !== null,
            },
          };
        }

        case 'set': {
          if (!key) return { success: false, error: 'key 不能为空 / key is required for set' };

          const options = {};
          if (layer) options.layer = layer;
          if (priority !== undefined) options.priority = priority;

          const entry = workingMemory.put(key, value, options);

          logger.debug?.(`[SwarmMemoryTool] 工作记忆已写入 / Working memory set: ${key} → layer=${entry.layer}`);

          return {
            success: true,
            data: {
              key: entry.key,
              layer: entry.layer,
              priority: entry.priority,
            },
            message: `工作记忆已写入 / Working memory set: ${key}`,
          };
        }

        case 'snapshot': {
          const snapshot = workingMemory.snapshot();

          return {
            success: true,
            data: {
              focus: snapshot.focus.map(e => ({ key: e.key, priority: e.priority, layer: e.layer })),
              context: snapshot.context.map(e => ({ key: e.key, priority: e.priority, layer: e.layer })),
              scratchpad: snapshot.scratchpad.map(e => ({ key: e.key, priority: e.priority, layer: e.layer })),
              totalItems: snapshot.totalItems,
            },
          };
        }

        default:
          return {
            success: false,
            error: `未知工作记忆操作 / Unknown working memory operation: ${op}. 支持 / Supported: get, set, snapshot`,
          };
      }
    } catch (err) {
      return { success: false, error: `工作记忆操作失败 / Working memory operation failed: ${err.message}` };
    }
  }

  /**
   * 记忆统计 / Memory statistics
   *
   * @param {Object} input
   * @returns {Object}
   */
  async function handleStats(input) {
    const { agentId } = input;

    try {
      const data = {};

      // 工作记忆统计 / Working memory stats
      if (workingMemory) {
        data.workingMemory = workingMemory.getStats();
      }

      // 情景记忆统计 / Episodic memory stats
      if (episodicMemory) {
        data.episodicMemory = episodicMemory.getStats(agentId);
      }

      // 语义记忆统计 / Semantic memory stats
      if (semanticMemory) {
        data.semanticMemory = semanticMemory.getStats();
      }

      return { success: true, data };
    } catch (err) {
      return { success: false, error: `统计查询失败 / Stats query failed: ${err.message}` };
    }
  }

  // ━━━ 主处理函数 / Main Handler ━━━

  async function handler(input) {
    try {
      const { action } = input;

      switch (action) {
        case 'record':
          return await handleRecord(input);
        case 'recall':
          return await handleRecall(input);
        case 'knowledge':
          return await handleKnowledge(input);
        case 'working':
          return await handleWorking(input);
        case 'stats':
          return await handleStats(input);
        default:
          return {
            success: false,
            error: `未知操作 / Unknown action: ${action}. 支持 / Supported: record, recall, knowledge, working, stats`,
          };
      }
    } catch (err) {
      logger.error?.(`[SwarmMemoryTool] 未捕获错误 / Uncaught error: ${err.message}`);
      return { success: false, error: err.message };
    }
  }

  return {
    name: TOOL_NAME,
    description: TOOL_DESCRIPTION,
    inputSchema,
    handler,
  };
}
