/**
 * VectorIndex — HNSW 近似最近邻索引（小规模退化为暴力搜索）
 * Approximate nearest-neighbor index using HNSW; degrades to brute-force
 * when vector count is below 1000.
 *
 * 实现分层可导航小世界图（Hierarchical Navigable Small World）：
 *   - 多层图结构，每层连接 M 个最近邻
 *   - 插入时随机分配层级 l = floor(-ln(rand) * mL)
 *   - 搜索时从最高层贪婪下降，layer 0 用 efSearch 精细搜索
 *
 * Implements the Hierarchical Navigable Small World graph:
 *   - Multi-layer graph, each layer connects M nearest neighbors
 *   - Insert assigns random level l = floor(-ln(rand) * mL)
 *   - Search greedily descends from top layer, then fine-searches layer 0
 *
 * @module intelligence/memory/vector-index
 * @version 9.0.0
 */

import { ModuleBase } from '../../core/module-base.js';

// ─── 内联余弦相似度 / Inline cosine similarity ─────────────────────
function cosine(a, b) {
  let dot = 0, nA = 0, nB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]; nA += a[i] * a[i]; nB += b[i] * b[i];
  }
  if (nA === 0 || nB === 0) return 0;
  return dot / (Math.sqrt(nA) * Math.sqrt(nB));
}

const HNSW_THRESHOLD = 1000;

export class VectorIndex extends ModuleBase {
  static produces() { return []; }
  static consumes() { return []; }
  static publishes() { return []; }
  static subscribes() { return []; }

  constructor({ dimensions = 384, maxCapacity = 50000, efConstruction = 200, M = 16 } = {}) {
    super();
    this._dimensions = dimensions;
    this._maxCapacity = maxCapacity;
    this._efConstruction = efConstruction;
    this._M = M;
    this._mL = 1 / Math.log(M);
    this._vectors = new Map();
    this._graph = new Map();
    this._insertOrder = [];
    this._maxLayer = 0;
    this._entryPoint = null;
  }

  _randomLevel() {
    return Math.floor(-Math.log(Math.random()) * this._mL);
  }

  _searchLayer(query, entryId, ef, layer) {
    const visited = new Set([entryId]);
    const entryScore = cosine(query, this._vectors.get(entryId));
    let candidates = [{ id: entryId, score: entryScore }];
    let results = [{ id: entryId, score: entryScore }];
    while (candidates.length > 0) {
      candidates.sort((a, b) => a.score - b.score);
      const current = candidates.pop();
      const worstResult = results.reduce((w, r) => r.score < w.score ? r : w, results[0]);
      if (current.score < worstResult.score && results.length >= ef) break;
      const neighbors = this._graph.get(current.id)?.[layer];
      if (!neighbors) continue;
      for (const neighborId of neighbors) {
        if (visited.has(neighborId)) continue;
        visited.add(neighborId);
        const vec = this._vectors.get(neighborId);
        if (!vec) continue;
        const score = cosine(query, vec);
        const worstR = results.reduce((w, r) => r.score < w.score ? r : w, results[0]);
        if (results.length < ef || score > worstR.score) {
          candidates.push({ id: neighborId, score });
          results.push({ id: neighborId, score });
          if (results.length > ef) {
            results.sort((a, b) => b.score - a.score);
            results = results.slice(0, ef);
          }
        }
      }
    }
    results.sort((a, b) => b.score - a.score);
    return results;
  }

  add(id, vector) {
    if (this._vectors.size >= this._maxCapacity && !this._vectors.has(id)) {
      const oldId = this._insertOrder.shift();
      if (oldId) this.remove(oldId);
    }
    const isNew = !this._vectors.has(id);
    this._vectors.set(id, vector);
    if (isNew) this._insertOrder.push(id);
    if (this._vectors.size < HNSW_THRESHOLD) return;
    if (!this._entryPoint) {
      const allIds = [...this._vectors.keys()];
      this._entryPoint = allIds[0];
      for (const eid of allIds) {
        if (!this._graph.has(eid)) this._graph.set(eid, [new Set()]);
      }
      for (const eid of allIds) {
        const v = this._vectors.get(eid);
        const scored = allIds.filter((o) => o !== eid)
          .map((o) => ({ id: o, score: cosine(v, this._vectors.get(o)) }))
          .sort((a, b) => b.score - a.score).slice(0, this._M);
        const ls = this._graph.get(eid)[0];
        for (const s of scored) ls.add(s.id);
      }
    }
    const l = this._randomLevel();
    const layers = [];
    for (let i = 0; i <= l; i++) layers.push(new Set());
    this._graph.set(id, layers);
    let ep = this._entryPoint;
    for (let lc = this._maxLayer; lc > l; lc--) {
      const res = this._searchLayer(vector, ep, 1, lc);
      if (res.length > 0) ep = res[0].id;
    }
    for (let lc = Math.min(l, this._maxLayer); lc >= 0; lc--) {
      const neighbors = this._searchLayer(vector, ep, this._efConstruction, lc);
      const selected = neighbors.slice(0, this._M);
      while (this._graph.get(id).length <= lc) this._graph.get(id).push(new Set());
      for (const n of selected) {
        this._graph.get(id)[lc].add(n.id);
        const nLayers = this._graph.get(n.id);
        if (nLayers) {
          while (nLayers.length <= lc) nLayers.push(new Set());
          nLayers[lc].add(id);
          if (nLayers[lc].size > this._M * 2) {
            const nVec = this._vectors.get(n.id);
            const sc = [...nLayers[lc]]
              .map((nid) => ({ id: nid, score: this._vectors.has(nid) ? cosine(nVec, this._vectors.get(nid)) : -1 }))
              .sort((a, b) => b.score - a.score).slice(0, this._M);
            nLayers[lc] = new Set(sc.map((s) => s.id));
          }
        }
      }
      if (selected.length > 0) ep = selected[0].id;
    }
    if (l > this._maxLayer) { this._maxLayer = l; this._entryPoint = id; }
  }

  search(queryVector, topK = 10, efSearch = 50) {
    if (this._vectors.size === 0) return [];
    if (this._vectors.size < HNSW_THRESHOLD || !this._entryPoint)
      return this._bruteForceSearch(queryVector, topK);
    let ep = this._entryPoint;
    for (let lc = this._maxLayer; lc > 0; lc--) {
      const res = this._searchLayer(queryVector, ep, 1, lc);
      if (res.length > 0) ep = res[0].id;
    }
    const results = this._searchLayer(queryVector, ep, efSearch, 0);
    return results.slice(0, topK);
  }

  _bruteForceSearch(queryVector, topK) {
    const scored = [];
    for (const [id, vec] of this._vectors)
      scored.push({ id, score: cosine(queryVector, vec) });
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK);
  }

  remove(id) {
    if (!this._vectors.has(id)) return false;
    this._vectors.delete(id);
    const layers = this._graph.get(id);
    if (layers) {
      for (const layer of layers)
        for (const nid of layer) {
          const nL = this._graph.get(nid);
          if (nL) for (const ns of nL) ns.delete(id);
        }
    }
    this._graph.delete(id);
    if (this._entryPoint === id) {
      this._entryPoint = this._vectors.size > 0
        ? this._vectors.keys().next().value : null;
      this._maxLayer = 0;
      if (this._entryPoint && this._graph.has(this._entryPoint))
        this._maxLayer = this._graph.get(this._entryPoint).length - 1;
    }
    const idx = this._insertOrder.indexOf(id);
    if (idx >= 0) this._insertOrder.splice(idx, 1);
    return true;
  }

  has(id) { return this._vectors.has(id); }
  size() { return this._vectors.size; }

  clear() {
    this._vectors.clear();
    this._graph.clear();
    this._insertOrder = [];
    this._maxLayer = 0;
    this._entryPoint = null;
  }

  stats() {
    let totalConnections = 0;
    const layerCount = this._maxLayer + 1;
    for (const layers of this._graph.values())
      for (const layer of layers) totalConnections += layer.size;
    const graphNodes = this._graph.size || 1;
    return {
      vectorCount: this._vectors.size,
      layerCount,
      averageConnections: +(totalConnections / graphNodes).toFixed(2),
      memoryEstimateBytes: this._vectors.size * this._dimensions * 4 + totalConnections * 64,
    };
  }
}

export default VectorIndex;
