/**
 * ArtifactRegistry — 产物注册与追踪
 * Registers and tracks artifacts produced during DAG execution.
 *
 * @module intelligence/artifacts/artifact-registry
 * @version 9.0.0
 */

import { ModuleBase } from '../../core/module-base.js';
import { DIM_TRAIL } from '../../core/field/types.js';

// ============================================================================
// 产物类型常量 / Artifact type constants
// ============================================================================

export const ARTIFACT_TYPES = {
  CODE_CHANGE: 'code_change',
  TEST:        'test',
  DOCUMENT:    'document',
  CONFIG:      'config',
  ANALYSIS:    'analysis',
};

// ============================================================================
// ArtifactRegistry
// ============================================================================

let _idCounter = 0;

class ArtifactRegistry extends ModuleBase {
  /**
   * @param {object} deps
   * @param {object} deps.field  - SignalStore
   * @param {object} deps.bus    - EventBus
   * @param {object} deps.store  - DomainStore
   */
  constructor({ field, bus, store }) {
    super();
    this._field = field;
    this._bus   = bus;
    this._store = store;
    /** @type {Map<string, object[]>} dagId → Artifact[] */
    this._artifacts = new Map();
  }

  static produces()    { return [DIM_TRAIL]; }
  static publishes()   { return ['artifact.registered']; }
  static subscribes()  { return ['agent.completed']; }

  // --------------------------------------------------------------------------
  // Core operations
  // --------------------------------------------------------------------------

  /**
   * 注册一个产物 / Register an artifact for a DAG execution.
   * @param {string} dagId
   * @param {object} artifact - {type, path, description, createdBy, quality?}
   * @returns {object} the registered artifact with id and timestamp
   */
  register(dagId, artifact) {
    const id = `art_${++_idCounter}_${Date.now()}`;
    const entry = { id, ...artifact, timestamp: Date.now() };

    if (!this._artifacts.has(dagId)) {
      this._artifacts.set(dagId, []);
    }
    this._artifacts.get(dagId).push(entry);

    this._field.emit({
      dimension: DIM_TRAIL,
      scope:     dagId,
      strength:  0.5,
      emitterId: 'artifact-registry',
      metadata:  { event: 'artifact_created', type: artifact.type, path: artifact.path },
    });

    this._bus.publish('artifact.registered', { dagId, artifact: entry });
    return entry;
  }

  /**
   * 获取某DAG的产物列表 / Get artifacts for a DAG, optionally filtered by type.
   */
  getArtifacts(dagId, type) {
    const list = this._artifacts.get(dagId) || [];
    return type ? list.filter(a => a.type === type) : list;
  }

  /**
   * 跨DAG查询某文件的产物历史 / Get all artifact records for a file path.
   */
  getFileHistory(filePath) {
    const results = [];
    for (const [dagId, arts] of this._artifacts) {
      for (const a of arts) {
        if (a.path === filePath) results.push({ dagId, ...a });
      }
    }
    return results;
  }

  /**
   * 跨DAG查询某agent创建的产物 / Get all artifacts created by a specific agent.
   */
  getByCreator(agentId) {
    const results = [];
    for (const [dagId, arts] of this._artifacts) {
      for (const a of arts) {
        if (a.createdBy === agentId) results.push({ dagId, ...a });
      }
    }
    return results;
  }

  /**
   * 获取某DAG的产物统计 / Get statistics for a DAG's artifacts.
   */
  getStats(dagId) {
    const list = this._artifacts.get(dagId) || [];
    const byType = {};
    let qualitySum = 0;
    let qualityCount = 0;

    for (const a of list) {
      byType[a.type] = (byType[a.type] || 0) + 1;
      if (a.quality != null) { qualitySum += a.quality; qualityCount++; }
    }

    return {
      total:      list.length,
      byType,
      avgQuality: qualityCount > 0 ? qualitySum / qualityCount : null,
    };
  }

  // --------------------------------------------------------------------------
  // Persistence
  // --------------------------------------------------------------------------

  persist() {
    const serialized = {};
    for (const [dagId, arts] of this._artifacts) {
      serialized[dagId] = arts;
    }
    this._store.put('artifacts', 'registry', serialized);
  }

  restore() {
    const data = this._store.get('artifacts', 'registry');
    if (!data) return;
    this._artifacts.clear();
    for (const [dagId, arts] of Object.entries(data)) {
      this._artifacts.set(dagId, arts);
    }
  }
}

export { ArtifactRegistry };
export default ArtifactRegistry;
