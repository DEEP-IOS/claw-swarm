/**
 * TrustDynamics - EMA-based trust score tracking per agent
 * Combines quality signals and success/failure outcomes
 */
import ModuleBase from '../../core/module-base.js';
import { DIM_TRUST, DIM_REPUTATION } from '../../core/field/types.js';

class TrustDynamics extends ModuleBase {
  constructor({ field, bus, store }) {
    super({ field, bus, store });
    this._trustScores = new Map(); // agentId -> {score, consistency, interactions, lastUpdated, lastQuality}
  }

  static produces() { return [DIM_TRUST]; }
  static consumes() { return [DIM_REPUTATION]; }
  static publishes() { return ['trust.updated']; }
  static subscribes() { return ['agent.completed', 'agent.failed', 'quality.evaluated']; }

  _ensureScore(agentId) {
    if (!this._trustScores.has(agentId)) {
      this._trustScores.set(agentId, {
        score: 0.5,
        consistency: 0.5,
        interactions: 0,
        lastUpdated: Date.now(),
        lastQuality: null
      });
    }
    return this._trustScores.get(agentId);
  }

  update(agentId, quality, success) {
    const trust = this._ensureScore(agentId);
    const effectiveQuality = success ? quality : quality * 0.5;

    // EMA: score = 0.8 * old + 0.2 * new
    trust.score = 0.8 * trust.score + 0.2 * effectiveQuality;
    trust.score = Math.max(0, Math.min(1, trust.score));

    // Consistency tracks variance: high consistency = stable performance
    const deviation = Math.abs(effectiveQuality - trust.score);
    trust.consistency = 0.9 * trust.consistency + 0.1 * (1 - deviation);
    trust.consistency = Math.max(0, Math.min(1, trust.consistency));

    trust.interactions++;
    trust.lastUpdated = Date.now();
    trust.lastQuality = quality;

    this.field?.emit({
      dimension: DIM_TRUST,
      scope: agentId,
      strength: trust.score,
      emitterId: this.constructor.name,
      metadata: { agentId, score: trust.score, consistency: trust.consistency, interactions: trust.interactions }
    });

    this.bus?.publish('trust.updated', {
      agentId,
      score: trust.score,
      consistency: trust.consistency,
      interactions: trust.interactions
    }, this.constructor.name);

    return { agentId, ...trust };
  }

  getTrust(agentId) {
    const trust = this._ensureScore(agentId);
    return { agentId, ...trust };
  }

  getReliable(minScore = 0.7, minInteractions = 5) {
    const reliable = [];
    for (const [agentId, trust] of this._trustScores) {
      if (trust.score >= minScore && trust.interactions >= minInteractions) {
        reliable.push({ agentId, ...trust });
      }
    }
    return reliable.sort((a, b) => b.score - a.score);
  }

  persist() {
    const data = {};
    for (const [agentId, trust] of this._trustScores) {
      data[agentId] = { ...trust };
    }
    this.store?.put('social', 'trust-dynamics', data);
  }

  restore() {
    const data = this.store?.get('social', 'trust-dynamics');
    if (!data) return;
    for (const [agentId, trust] of Object.entries(data)) {
      this._trustScores.set(agentId, { ...trust });
    }
  }

  async start() {
    this.restore();
  }

  async stop() {
    this.persist();
  }
}

export { TrustDynamics };
export default TrustDynamics;
