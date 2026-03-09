/**
 * EpisodeLearner - Tracks performance episodes and detects trends
 * Uses simple linear regression for trend detection
 */
import ModuleBase from '../../core/module-base.js';
import { DIM_LEARNING, DIM_TRAIL, DIM_REPUTATION } from '../../core/field/types.js';

class EpisodeLearner extends ModuleBase {
  constructor({ field, bus, store }) {
    super({ field, bus, store });
    this._episodes = new Map(); // "roleId::metricName" -> [{metric, ts}]
  }

  static produces() { return [DIM_LEARNING]; }
  static consumes() { return [DIM_TRAIL, DIM_REPUTATION]; }
  static publishes() { return ['learning.trend.detected']; }
  static subscribes() { return ['agent.completed']; }

  _key(roleId, metricName) {
    return `${roleId}::${metricName}`;
  }

  recordEpisode(roleId, metricName, value) {
    const key = this._key(roleId, metricName);
    if (!this._episodes.has(key)) {
      this._episodes.set(key, []);
    }
    const episodes = this._episodes.get(key);
    episodes.push({ metric: value, ts: Date.now() });
    if (episodes.length > 20) {
      episodes.splice(0, episodes.length - 20);
    }

    // Detect trend when we have enough data
    if (episodes.length >= 5) {
      const trend = this._detectTrend(roleId, metricName);
      if (trend.direction !== 'plateau') {
        this.bus?.publish('learning.trend.detected', {
          roleId,
          metricName,
          ...trend
        }, this.constructor.name);
      }
    }

    return { roleId, metricName, value, count: episodes.length };
  }

  _detectTrend(roleId, metricName) {
    const key = this._key(roleId, metricName);
    const episodes = this._episodes.get(key);
    if (!episodes || episodes.length < 5) {
      return { direction: 'insufficient-data', slope: 0, count: episodes?.length || 0 };
    }

    // Simple linear regression on sequential indices
    const n = episodes.length;
    const values = episodes.map(e => e.metric);

    let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
    for (let i = 0; i < n; i++) {
      sumX += i;
      sumY += values[i];
      sumXY += i * values[i];
      sumXX += i * i;
    }

    const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);

    let direction;
    if (slope > 0.05) {
      direction = 'improving';
    } else if (slope < -0.05) {
      direction = 'declining';
    } else {
      direction = 'plateau';
    }

    return { direction, slope, count: n, latestValue: values[n - 1] };
  }

  detectTrend(roleId, metricName) {
    return this._detectTrend(roleId, metricName);
  }

  emitToField(roleId) {
    // Aggregate all metrics for this role
    const metrics = {};
    for (const [key, episodes] of this._episodes) {
      if (key.startsWith(roleId + '::')) {
        const metricName = key.split('::')[1];
        const trend = this._detectTrend(roleId, metricName);
        metrics[metricName] = trend;
      }
    }
    this.field?.emit({
      dimension: DIM_LEARNING,
      scope: roleId,
      strength: Object.keys(metrics).length,
      emitterId: this.constructor.name,
      metadata: { roleId, metrics }
    });
  }

  persist() {
    const data = {};
    for (const [key, episodes] of this._episodes) {
      data[key] = episodes;
    }
    this.store?.put('social', 'episode-learner', data);
  }

  restore() {
    const data = this.store?.get('social', 'episode-learner');
    if (!data) return;
    for (const [key, episodes] of Object.entries(data)) {
      this._episodes.set(key, episodes);
    }
  }

  async start() {
    this.restore();
  }

  async stop() {
    this.persist();
  }
}

export { EpisodeLearner };
export default EpisodeLearner;
