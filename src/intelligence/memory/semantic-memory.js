/**
 * SemanticMemory — 语义知识图谱（三元组存储 + BFS 推理）
 * Semantic knowledge graph with triple storage and BFS-based inference
 *
 * 以 { subject, predicate, object } 三元组存储事实，
 * 通过 DomainStore 持久化，通过 SignalStore 向知识维度发射信号。
 * inferRelated() 使用 BFS 遍历三元组图发现关联实体。
 *
 * Stores facts as { subject, predicate, object } triples, persisted via
 * DomainStore, emitting signals on the knowledge dimension via SignalStore.
 * inferRelated() uses BFS traversal over the triple graph to discover
 * related entities.
 *
 * @module intelligence/memory/semantic-memory
 * @version 9.0.0
 */

import { ModuleBase } from '../../core/module-base.js';
import { DIM_KNOWLEDGE } from '../../core/field/types.js';

const COLLECTION = 'semantic';

// ─── SemanticMemory ─────────────────────────────────────────────────
export class SemanticMemory extends ModuleBase {
  static produces() { return [DIM_KNOWLEDGE]; }
  static consumes() { return []; }
  static publishes() { return []; }
  static subscribes() { return ['memory.episode.recorded']; }

  /**
   * @param {object} opts
   * @param {import('../../core/store/domain-store.js').DomainStore} opts.domainStore
   * @param {import('../../core/field/signal-store.js').SignalStore} opts.field
   * @param {import('../../core/bus/event-bus.js').EventBus} opts.eventBus
   */
  constructor({ domainStore, field, eventBus } = {}) {
    super();
    this._store = domainStore;
    this._field = field;
    this._eventBus = eventBus;

    if (this._eventBus) {
      this._eventBus.subscribe('memory.episode.recorded', (data) => {
        this._onEpisodeRecorded(data);
      });
    }
  }

  /** 生成 fact ID / Generate deterministic fact ID */
  _factId(subject, predicate, object) {
    return 'fact:' + subject + ':' + predicate + ':' + object;
  }

  /**
   * 添加事实三元组 / Add a fact triple
   * @param {string} subject
   * @param {string} predicate
   * @param {string} object
   * @param {number} [confidence=0.8]
   * @param {string} [source]
   * @returns {object} the stored fact
   */
  addFact(subject, predicate, object, confidence = 0.8, source) {
    const factId = this._factId(subject, predicate, object);
    const existing = this._store.get(COLLECTION, factId);

    if (existing) {
      existing.confidence = Math.max(existing.confidence, confidence);
      existing.source = source || existing.source;
      this._store.put(COLLECTION, factId, existing);
      return existing;
    }

    const fact = {
      id: factId,
      subject,
      predicate,
      object,
      confidence,
      source: source || 'unknown',
      recordedAt: Date.now(),
    };

    this._store.put(COLLECTION, factId, fact);

    if (this._field) {
      this._field.emit({
        dimension: DIM_KNOWLEDGE,
        scope: 'global',
        strength: confidence * 0.3,
        emitterId: 'semantic-memory',
        metadata: { factId, subject, predicate },
      });
    }

    return fact;
  }

  /**
   * 查询事实 / Query facts by filters
   */
  queryFacts({ subject, predicate, object, minConfidence } = {}) {
    return this._store.query(COLLECTION, (fact) => {
      if (subject && fact.subject !== subject) return false;
      if (predicate && fact.predicate !== predicate) return false;
      if (object && fact.object !== object) return false;
      if (minConfidence != null && fact.confidence < minConfidence) return false;
      return true;
    });
  }

  /**
   * BFS 推理关联实体 / BFS inference for related entities
   * @param {string} entity
   * @param {number} [maxDepth=2]
   * @returns {Array<{ entity: string, relation: string, depth: number }>}
   */
  inferRelated(entity, maxDepth = 2) {
    const visited = new Set([entity]);
    const results = [];
    let frontier = [{ entity, depth: 0 }];

    while (frontier.length > 0) {
      const nextFrontier = [];
      for (const { entity: current, depth } of frontier) {
        if (depth >= maxDepth) continue;

        const asSubject = this.queryFacts({ subject: current });
        for (const fact of asSubject) {
          if (!visited.has(fact.object)) {
            visited.add(fact.object);
            results.push({ entity: fact.object, relation: fact.predicate, depth: depth + 1 });
            nextFrontier.push({ entity: fact.object, depth: depth + 1 });
          }
        }

        const asObject = this.queryFacts({ object: current });
        for (const fact of asObject) {
          if (!visited.has(fact.subject)) {
            visited.add(fact.subject);
            results.push({ entity: fact.subject, relation: 'inverse:' + fact.predicate, depth: depth + 1 });
            nextFrontier.push({ entity: fact.subject, depth: depth + 1 });
          }
        }
      }
      frontier = nextFrontier;
    }

    return results;
  }

  /**
   * 获取知识图谱 / Get knowledge graph
   * @param {string} [scope]
   * @returns {{ nodes: string[], edges: Array<{ from: string, to: string, label: string }> }}
   */
  getGraph(scope) {
    const allFacts = this._store.query(COLLECTION, () => true);
    const nodeSet = new Set();
    const edges = [];

    for (const fact of allFacts) {
      nodeSet.add(fact.subject);
      nodeSet.add(fact.object);
      edges.push({ from: fact.subject, to: fact.object, label: fact.predicate });
    }

    return { nodes: [...nodeSet], edges };
  }

  /**
   * 删除事实 / Remove a fact
   * @param {string} factId
   * @returns {boolean}
   */
  removeFact(factId) {
    return this._store.delete(COLLECTION, factId);
  }

  /** 统计信息 / Statistics */
  stats() {
    const allFacts = this._store.query(COLLECTION, () => true);
    const subjects = new Set();
    const predicates = new Set();
    let totalConf = 0;

    for (const f of allFacts) {
      subjects.add(f.subject);
      predicates.add(f.predicate);
      totalConf += f.confidence;
    }

    return {
      totalFacts: allFacts.length,
      uniqueSubjects: subjects.size,
      uniquePredicates: predicates.size,
      averageConfidence: allFacts.length > 0 ? +(totalConf / allFacts.length).toFixed(3) : 0,
    };
  }

  /**
   * 事件回调：从 episode 自动提取知识三元组
   * Event handler: auto-extract knowledge triples from recorded episodes
   */
  _onEpisodeRecorded(data) {
    if (!data?.triples) return;
    for (const t of data.triples) {
      if (t.subject && t.predicate && t.object) {
        this.addFact(t.subject, t.predicate, t.object, t.confidence ?? 0.6, 'episode');
      }
    }
  }
}

export default SemanticMemory;
