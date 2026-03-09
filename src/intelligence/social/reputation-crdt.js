/**
 * ReputationCRDT - PN-Counter based reputation tracking
 * Conflict-free replicated data type for distributed reputation scores
 */
import ModuleBase from '../../core/module-base.js';
import { DIM_REPUTATION } from '../../core/field/types.js';

class ReputationCRDT extends ModuleBase {
  constructor({ field, bus, store }) {
    super({ field, bus, store });
    this._counters = new Map(); // agentId -> {positive, negative}
  }

  static produces() { return [DIM_REPUTATION]; }
  static consumes() { return []; }
  static publishes() { return ['reputation.updated']; }
  static subscribes() { return []; }

  _ensureCounter(agentId) {
    if (!this._counters.has(agentId)) {
      this._counters.set(agentId, { positive: 0, negative: 0 });
    }
    return this._counters.get(agentId);
  }

  increment(agentId) {
    const counter = this._ensureCounter(agentId);
    counter.positive++;
    const score = this.getScore(agentId);
    this.field?.emit({
      dimension: DIM_REPUTATION,
      scope: agentId,
      strength: score.ratio,
      emitterId: this.constructor.name,
      metadata: { agentId, net: score.net }
    });
    this.bus?.publish('reputation.updated', { agentId, action: 'increment', score }, this.constructor.name);
    return score;
  }

  decrement(agentId) {
    const counter = this._ensureCounter(agentId);
    counter.negative++;
    const score = this.getScore(agentId);
    this.field?.emit({
      dimension: DIM_REPUTATION,
      scope: agentId,
      strength: score.ratio,
      emitterId: this.constructor.name,
      metadata: { agentId, net: score.net }
    });
    this.bus?.publish('reputation.updated', { agentId, action: 'decrement', score }, this.constructor.name);
    return score;
  }

  merge(remote) {
    const { agentId, positive, negative } = remote;
    const counter = this._ensureCounter(agentId);
    counter.positive = Math.max(counter.positive, positive);
    counter.negative = Math.max(counter.negative, negative);
    return this.getScore(agentId);
  }

  getScore(agentId) {
    const counter = this._ensureCounter(agentId);
    const { positive, negative } = counter;
    const total = positive + negative;
    return {
      agentId,
      positive,
      negative,
      net: positive - negative,
      total,
      ratio: total === 0 ? 0.5 : positive / total,
      lastUpdated: Date.now()
    };
  }

  getTop(n, minTotal = 3) {
    return this._ranked(minTotal).sort((a, b) => b.net - a.net).slice(0, n);
  }

  getBottom(n, minTotal = 3) {
    return this._ranked(minTotal).sort((a, b) => a.net - b.net).slice(0, n);
  }

  _ranked(minTotal) {
    const results = [];
    for (const agentId of this._counters.keys()) {
      const score = this.getScore(agentId);
      if (score.total >= minTotal) results.push(score);
    }
    return results;
  }

  exportAll() {
    const data = {};
    for (const [agentId, counter] of this._counters) {
      data[agentId] = { positive: counter.positive, negative: counter.negative };
    }
    return data;
  }

  importAll(data) {
    if (!data) return;
    for (const [agentId, counter] of Object.entries(data)) {
      this._counters.set(agentId, { positive: counter.positive, negative: counter.negative });
    }
  }

  persist() {
    this.store?.put('social', 'reputation-crdt', this.exportAll());
  }

  restore() {
    const data = this.store?.get('social', 'reputation-crdt');
    if (data) this.importAll(data);
  }

  async start() {
    this.restore();
  }

  async stop() {
    this.persist();
  }
}

export { ReputationCRDT };
export default ReputationCRDT;
