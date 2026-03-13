/**
 * Observe domain — factory + re-exports
 * Creates and wires all observe-domain modules (metrics, health, traces,
 * broadcast, dashboard) and exposes a unified facade.
 */

import { MetricsCollector } from './metrics/metrics-collector.js';
import { DashboardService } from './dashboard/dashboard-service.js';
import { HealthChecker } from './health/health-checker.js';
import { TraceCollector } from './health/trace-collector.js';
import { StateBroadcaster } from './broadcast/state-broadcaster.js';

/**
 * Create the entire Observe subsystem.
 *
 * @param {Object} opts
 * @param {import('../core/field/signal-field.js').SignalField} opts.field
 * @param {import('../core/bus/event-bus.js').EventBus} opts.bus
 * @param {import('../core/store/domain-store.js').DomainStore} opts.store
 * @param {Object} [opts.domains] - references to other domain facades
 * @param {Object} [opts.config]
 * @returns {Object} observe-domain facade
 */
export function createObserveSystem({ field, bus, store, domains = {}, config = {} }) {
  const metricsCollector = new MetricsCollector({ bus, field, config: config.metrics });
  const traceCollector = new TraceCollector({ store, config: config.traces });
  const stateBroadcaster = new StateBroadcaster({ bus, config: config.broadcast });
  const healthChecker = new HealthChecker({ field, bus, metricsCollector, config: config.health });
  const dashboardService = new DashboardService({
    field, bus, store,
    metricsCollector, stateBroadcaster, healthChecker, traceCollector,
    domains, config: config.dashboard,
  });

  return {
    // ── Metrics ────────────────────────────────────────────────
    getMetrics: () => metricsCollector.getMetrics(),
    getHookStats: () => metricsCollector.getHookStats(),

    // ── Health ─────────────────────────────────────────────────
    getHealth: () => healthChecker.getHealth(),
    getHealthHistory: (limit) => healthChecker.getHistory(limit),

    // ── Traces ─────────────────────────────────────────────────
    startSpan: (...args) => traceCollector.startSpan(...args),
    endSpan: (...args) => traceCollector.endSpan(...args),
    addSpanEvent: (...args) => traceCollector.addEvent(...args),
    getTrace: (id) => traceCollector.getTrace(id),
    getTraces: (filter) => traceCollector.getTraces(filter),

    // ── Dashboard ──────────────────────────────────────────────
    getDashboardPort: () => config.dashboard?.port ?? 19100,
    handleRequest: (...args) => dashboardService.handleRequest(...args),
    getRouteCount: () => dashboardService.getRouteCount(),

    // ── Broadcast ──────────────────────────────────────────────
    getClientCount: () => stateBroadcaster.getClientCount(),

    // ── Internal module references ─────────────────────────────
    _modules: { metricsCollector, dashboardService, healthChecker, traceCollector, stateBroadcaster },
    allModules: () => [metricsCollector, dashboardService, healthChecker, traceCollector, stateBroadcaster],

    // ── Lifecycle ──────────────────────────────────────────────
    async start() {
      metricsCollector.start();
      stateBroadcaster.start();
      healthChecker.start();
      traceCollector.start();
      await dashboardService.start();
    },

    async stop() {
      await dashboardService.stop();
      healthChecker.stop();
      traceCollector.stop();
      stateBroadcaster.stop();
      metricsCollector.stop();
    },
  };
}

// ── Re-exports ──────────────────────────────────────────────────
export { MetricsCollector } from './metrics/metrics-collector.js';
export { DashboardService } from './dashboard/dashboard-service.js';
export { HealthChecker } from './health/health-checker.js';
export { TraceCollector } from './health/trace-collector.js';
export { StateBroadcaster } from './broadcast/state-broadcaster.js';
