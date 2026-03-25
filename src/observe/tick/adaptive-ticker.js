/**
 * AdaptiveTicker — Periodic state broadcast for real-time SSE push.
 *
 * Collects metrics, health, and field snapshots at a configurable interval
 * and publishes them to the EventBus, which StateBroadcaster then relays
 * to connected SSE clients.
 *
 * Default: 5s interval. Adjusts to 2s when anomalies are detected.
 *
 * @module observe/tick/adaptive-ticker
 * @version 9.1.0
 */

import { ModuleBase } from '../../core/module-base.js';

const DEFAULT_INTERVAL_MS = 5000;
const FAST_INTERVAL_MS = 2000;
const FIELD_STATS_INTERVAL_MS = 30000;

export class AdaptiveTicker extends ModuleBase {
  static produces() { return []; }
  static consumes() { return []; }
  static publishes() { return ['observe.metrics.collected', 'observe.health.snapshot', 'field.snapshot', 'field.stats.snapshot']; }
  static subscribes() { return ['quality.anomaly.detected']; }

  /**
   * @param {Object} deps
   * @param {Object} deps.field - SignalField instance
   * @param {Object} deps.bus - EventBus instance
   * @param {Object} deps.metricsCollector - MetricsCollector instance
   * @param {Object} deps.healthChecker - HealthChecker instance
   * @param {Object} [deps.config]
   */
  constructor({ field, bus, metricsCollector, healthChecker, config = {} }) {
    super();
    this._field = field;
    this._bus = bus;
    this._metricsCollector = metricsCollector;
    this._healthChecker = healthChecker;
    this._intervalMs = config.intervalMs ?? DEFAULT_INTERVAL_MS;
    this._timer = null;
    this._anomalyActive = false;
    this._tickCount = 0;
    this._lastFieldStatsAt = 0;
  }

  async start() {
    // Subscribe to anomaly events for adaptive interval
    const subFn = this._bus?.subscribe || this._bus?.on;
    if (typeof subFn === 'function') {
      this._anomalySub = subFn.call(this._bus, 'quality.anomaly.detected', () => {
        this._anomalyActive = true;
        // Auto-reset after 60s
        setTimeout(() => { this._anomalyActive = false; }, 60000);
      });
    }

    this._timer = setInterval(() => this._tick(), this._currentInterval());
  }

  async stop() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
    if (typeof this._anomalySub === 'function') {
      this._anomalySub();
    }
  }

  _currentInterval() {
    return this._anomalyActive ? FAST_INTERVAL_MS : this._intervalMs;
  }

  _tick() {
    this._tickCount++;
    const now = Date.now();
    const publish = (topic, data) => {
      try { this._bus?.publish?.(topic, data, 'adaptive-ticker'); } catch (_) { /* */ }
    };

    // 1. Metrics snapshot
    try {
      const metrics = this._metricsCollector?.getMetrics?.() ?? {};
      publish('observe.metrics.collected', { timestamp: now, metrics });
    } catch (_) { /* */ }

    // 2. Health snapshot
    try {
      const health = this._healthChecker?.getHealth?.() ?? {};
      publish('observe.health.snapshot', { timestamp: now, health });
    } catch (_) { /* */ }

    // 3. Field vector snapshot (global scope)
    try {
      const vector = this._field?.superpose?.('global') ?? {};
      publish('field.snapshot', { timestamp: now, vector });
    } catch (_) { /* */ }

    // 4. Field stats (every 30s)
    if (now - this._lastFieldStatsAt >= FIELD_STATS_INTERVAL_MS) {
      try {
        const stats = this._field?.stats?.() ?? {};
        publish('field.stats.snapshot', { timestamp: now, stats });
        this._lastFieldStatsAt = now;
      } catch (_) { /* */ }
    }

    // 5. Adaptive interval: if anomaly cleared, reset to normal speed
    if (!this._anomalyActive && this._timer) {
      clearInterval(this._timer);
      this._timer = setInterval(() => this._tick(), this._currentInterval());
    }
  }

  /** Return tick statistics. */
  getStats() {
    return {
      tickCount: this._tickCount,
      intervalMs: this._currentInterval(),
      anomalyActive: this._anomalyActive,
    };
  }
}

export default AdaptiveTicker;
