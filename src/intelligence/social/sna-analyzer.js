/**
 * SNAAnalyzer - Social Network Analysis for agent collaboration patterns
 * Tracks collaboration edges, computes centrality, identifies strong/weak pairs
 */
import ModuleBase from '../../core/module-base.js';
import { DIM_SNA, DIM_TRAIL } from '../../core/field/types.js';

class SNAAnalyzer extends ModuleBase {
  constructor({ field, bus }) {
    super();
    this.field = field;
    this.bus = bus;
    this._edges = new Map(); // "agentA::agentB" -> {weight, successes, failures}
  }

  static produces() { return [DIM_SNA]; }
  static consumes() { return [DIM_TRAIL]; }
  static publishes() { return ['sna.updated']; }
  static subscribes() { return ['agent.completed']; }

  _normalizeKey(agentA, agentB) {
    return [agentA, agentB].sort().join('::');
  }

  recordCollaboration(agentA, agentB, outcome) {
    const key = this._normalizeKey(agentA, agentB);
    if (!this._edges.has(key)) {
      this._edges.set(key, { weight: 0, successes: 0, failures: 0 });
    }
    const edge = this._edges.get(key);
    edge.weight++;
    if (outcome) {
      edge.successes++;
    } else {
      edge.failures++;
    }
    this.field?.emit({
      dimension: DIM_SNA,
      scope: key,
      strength: edge.weight,
      emitterId: this.constructor.name,
      metadata: { agentA, agentB, outcome, weight: edge.weight }
    });
    this.bus?.publish('sna.updated', { agentA, agentB, edge }, this.constructor.name);
    return edge;
  }

  computeCentrality() {
    const degree = new Map();
    for (const key of this._edges.keys()) {
      const [a, b] = key.split('::');
      const edge = this._edges.get(key);
      degree.set(a, (degree.get(a) || 0) + edge.weight);
      degree.set(b, (degree.get(b) || 0) + edge.weight);
    }
    return degree;
  }

  getStrongPairs(minWeight = 3, minSuccessRate = 0.6) {
    return this._filterPairs(
      (edge) => edge.weight >= minWeight && (edge.successes / edge.weight) >= minSuccessRate
    ).sort((a, b) => b.edge.weight - a.edge.weight);
  }

  getWeakPairs(minWeight = 3, maxSuccessRate = 0.4) {
    return this._filterPairs(
      (edge) => edge.weight >= minWeight && (edge.successes / edge.weight) <= maxSuccessRate
    );
  }

  _filterPairs(predicate) {
    const results = [];
    for (const [key, edge] of this._edges) {
      if (predicate(edge)) {
        const [agentA, agentB] = key.split('::');
        results.push({ agentA, agentB, edge, successRate: edge.successes / edge.weight });
      }
    }
    return results;
  }

  getCollaborators(agentId) {
    const collaborators = [];
    for (const [key, edge] of this._edges) {
      const [a, b] = key.split('::');
      if (a === agentId) collaborators.push({ agentId: b, edge });
      else if (b === agentId) collaborators.push({ agentId: a, edge });
    }
    return collaborators;
  }

  getMetrics() {
    const centrality = Object.fromEntries(this.computeCentrality());
    const edges = Array.from(this._edges.entries()).map(([key, edge]) => {
      const [agentA, agentB] = key.split('::');
      return {
        id: key,
        agentA,
        agentB,
        weight: edge.weight,
        successes: edge.successes,
        failures: edge.failures,
        successRate: edge.weight > 0 ? edge.successes / edge.weight : 0,
      };
    });

    const nodeIds = new Set();
    for (const edge of edges) {
      nodeIds.add(edge.agentA);
      nodeIds.add(edge.agentB);
    }

    return {
      nodeCount: nodeIds.size,
      edgeCount: edges.length,
      nodes: [...nodeIds].map((id) => ({ id, centrality: centrality[id] || 0 })),
      edges,
      centrality,
      strongPairs: this.getStrongPairs(),
      weakPairs: this.getWeakPairs(),
    };
  }

  toFieldSignal() {
    const strongPairs = this.getStrongPairs();
    const weakPairs = this.getWeakPairs();
    const centrality = this.computeCentrality();
    let centralAgent = null;
    let maxDegree = 0;
    for (const [agent, degree] of centrality) {
      if (degree > maxDegree) { maxDegree = degree; centralAgent = agent; }
    }
    this.field?.emit({
      dimension: DIM_SNA,
      scope: 'network-summary',
      strength: strongPairs.length,
      emitterId: this.constructor.name,
      metadata: { strongPairs, weakPairs, centralAgent, centrality: Object.fromEntries(centrality) }
    });
  }
}

export { SNAAnalyzer };
export default SNAAnalyzer;
