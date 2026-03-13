/**
 * MetricsCollector - aggregate metrics from all domain events.
 * Subscribes to 27+ bus topics, updates internal counters.
 * Read-only observer: does not emit signals or modify domain state.
 */

const SUBSCRIPTIONS = [
  // Core / Field
  'field.signal.emitted',
  'field.gc.completed',
  'store.snapshot.completed',
  // Communication
  'pheromone.emitted',
  'pheromone.decayed',
  'channel.created',
  'channel.message.posted',
  'channel.closed',
  'stigmergy.updated',
  // Intelligence
  'agent.spawned',
  'agent.completed',
  'agent.failed',
  'memory.episodic.recorded',
  'memory.retrieval.completed',
  'identity.role.resolved',
  'identity.prompt.built',
  // Orchestration
  'orchestration.dag.created',
  'orchestration.dag.completed',
  'orchestration.dag.failed',
  'orchestration.task.started',
  'orchestration.task.completed',
  'orchestration.spawn.advised',
  'orchestration.replan.triggered',
  // Quality
  'quality.gate.evaluated',
  'quality.tool.validation_failed',
  'quality.breaker.opened',
  'quality.breaker.closed',
  'quality.failure.classified',
  'quality.anomaly.detected',
  'quality.compliance.violation',
  'quality.pipeline.broken',
  'quality.audit.completed',
];

function createEmptyMetrics() {
  return {
    agents: { spawned: 0, completed: 0, failed: 0, active: 0 },
    tasks: { created: 0, completed: 0, failed: 0, inProgress: 0 },
    signals: { emitted: 0, gcRemoved: 0, currentCount: 0, byDimension: {} },
    pheromones: { emitted: 0, decayed: 0, byType: {} },
    quality: {
      gateEvaluations: 0, gatePassRate: 0, gatePassed: 0,
      toolFailures: 0, breakerTrips: 0, anomalies: 0,
      violations: 0, pipelineBreaks: 0, audits: 0,
    },
    budget: { totalTokens: 0, totalCost: 0, byRole: {} },
    channels: { created: 0, messages: 0, active: 0 },
    memory: { episodesRecorded: 0, retrievals: 0 },
    errors: { total: 0, byClass: {} },
    performance: {
      avgAgentDurationMs: 0, _agentDurationSum: 0, _agentDurationCount: 0,
      avgTaskDurationMs: 0, _taskDurationSum: 0, _taskDurationCount: 0,
    },
    hooks: { byName: {} },
    startedAt: Date.now(),
    lastUpdatedAt: Date.now(),
  };
}

export class MetricsCollector {
  constructor({ bus, field, config = {} }) {
    this._bus = bus;
    this._field = field;
    this._config = config;
    this._subscriptions = [];
    this._metrics = createEmptyMetrics();
    this._handlers = this._buildHandlerMap();
  }

  /** Subscribe to all domain topics and begin collecting. */
  start() {
    if (this._subscriptions.length > 0) return; // already running
    for (const topic of SUBSCRIPTIONS) {
      const handler = this._handlers[topic];
      if (!handler) continue;
      const wrapped = (payload) => {
        handler(payload);
        this._metrics.lastUpdatedAt = Date.now();
      };
      const subFn = this._bus.subscribe || this._bus.on;
      if (typeof subFn === 'function') {
        const unsub = subFn.call(this._bus, topic, wrapped);
        this._subscriptions.push(typeof unsub === 'function' ? unsub : () => {
          const unsubFn = this._bus.unsubscribe || this._bus.off;
          if (typeof unsubFn === 'function') unsubFn.call(this._bus, topic, wrapped);
        });
      }
    }
  }

  /** Unsubscribe all listeners. */
  stop() {
    for (const unsub of this._subscriptions) unsub();
    this._subscriptions = [];
  }

  /** Return a deep-copy snapshot of all metrics. */
  getMetrics() {
    const copy = JSON.parse(JSON.stringify(this._metrics));
    // Strip internal accumulator fields from the public snapshot
    delete copy.performance._agentDurationSum;
    delete copy.performance._agentDurationCount;
    delete copy.performance._taskDurationSum;
    delete copy.performance._taskDurationCount;
    return copy;
  }

  /** Shortcut: hook invocation stats. */
  getHookStats() {
    return JSON.parse(JSON.stringify(this._metrics.hooks));
  }

  /** Shortcut: signal stats. */
  getSignalStats() {
    return JSON.parse(JSON.stringify(this._metrics.signals));
  }

  /** Reset all counters to zero, preserving startedAt. */
  reset() {
    const { startedAt } = this._metrics;
    this._metrics = createEmptyMetrics();
    this._metrics.startedAt = startedAt;
  }

  // ------------------------------------------------------------------
  // Internal: build a topic -> handler mapping
  // ------------------------------------------------------------------

  _buildHandlerMap() {
    const m = this._metrics;
    return {
      // --- Intelligence / Agents ---
      'agent.spawned': () => { m.agents.spawned++; m.agents.active++; },
      'agent.completed': (p) => {
        m.agents.completed++;
        m.agents.active = Math.max(0, m.agents.active - 1);
        if (p?.durationMs != null) {
          m.performance._agentDurationSum += p.durationMs;
          m.performance._agentDurationCount++;
          m.performance.avgAgentDurationMs =
            m.performance._agentDurationSum / m.performance._agentDurationCount;
        }
      },
      'agent.failed': (p) => {
        m.agents.failed++;
        m.agents.active = Math.max(0, m.agents.active - 1);
        m.errors.total++;
        const cls = p?.errorClass ?? 'unknown';
        m.errors.byClass[cls] = (m.errors.byClass[cls] ?? 0) + 1;
      },

      // --- Orchestration ---
      'orchestration.dag.created': () => { m.tasks.created++; },
      'orchestration.dag.completed': () => { /* dag-level completion, no counter change */ },
      'orchestration.dag.failed': () => { m.tasks.failed++; },
      'orchestration.task.started': () => { m.tasks.inProgress++; },
      'orchestration.task.completed': (p) => {
        m.tasks.completed++;
        m.tasks.inProgress = Math.max(0, m.tasks.inProgress - 1);
        if (p?.durationMs != null) {
          m.performance._taskDurationSum += p.durationMs;
          m.performance._taskDurationCount++;
          m.performance.avgTaskDurationMs =
            m.performance._taskDurationSum / m.performance._taskDurationCount;
        }
      },
      'orchestration.spawn.advised': () => { /* advisory only */ },
      'orchestration.replan.triggered': () => { /* tracked via dag events */ },

      // --- Quality ---
      'quality.gate.evaluated': (p) => {
        m.quality.gateEvaluations++;
        if (p?.passed) m.quality.gatePassed++;
        m.quality.gatePassRate =
          m.quality.gateEvaluations > 0
            ? m.quality.gatePassed / m.quality.gateEvaluations
            : 0;
      },
      'quality.tool.validation_failed': () => { m.quality.toolFailures++; },
      'quality.breaker.opened': () => { m.quality.breakerTrips++; },
      'quality.breaker.closed': () => { /* trip counter stays, breaker recovered */ },
      'quality.failure.classified': (p) => {
        m.errors.total++;
        const cls = p?.classification ?? 'unclassified';
        m.errors.byClass[cls] = (m.errors.byClass[cls] ?? 0) + 1;
      },
      'quality.anomaly.detected': () => { m.quality.anomalies++; },
      'quality.compliance.violation': () => { m.quality.violations++; },
      'quality.pipeline.broken': () => { m.quality.pipelineBreaks++; },
      'quality.audit.completed': () => { m.quality.audits++; },

      // --- Field / Signals ---
      'field.signal.emitted': (p) => {
        m.signals.emitted++;
        const dim = p?.dimension ?? 'unknown';
        m.signals.byDimension[dim] = (m.signals.byDimension[dim] ?? 0) + 1;
        if (this._field?.getSignalCount) {
          m.signals.currentCount = this._field.getSignalCount();
        }
      },
      'field.gc.completed': (p) => {
        const removed = p?.removedCount ?? p?.count ?? 0;
        m.signals.gcRemoved += removed;
        if (this._field?.getSignalCount) {
          m.signals.currentCount = this._field.getSignalCount();
        }
      },
      'store.snapshot.completed': () => { /* informational, no counter */ },

      // --- Communication ---
      'pheromone.emitted': (p) => {
        m.pheromones.emitted++;
        const type = p?.type ?? 'unknown';
        m.pheromones.byType[type] = (m.pheromones.byType[type] ?? 0) + 1;
      },
      'pheromone.decayed': () => { m.pheromones.decayed++; },
      'channel.created': () => { m.channels.created++; m.channels.active++; },
      'channel.message.posted': () => { m.channels.messages++; },
      'channel.closed': () => { m.channels.active = Math.max(0, m.channels.active - 1); },
      'stigmergy.updated': () => { /* tracked via pheromone events */ },

      // --- Memory ---
      'memory.episodic.recorded': () => { m.memory.episodesRecorded++; },
      'memory.retrieval.completed': () => { m.memory.retrievals++; },

      // --- Identity (informational, tracked in hooks) ---
      'identity.role.resolved': () => {
        m.hooks.byName['identity.role.resolved'] =
          (m.hooks.byName['identity.role.resolved'] ?? 0) + 1;
      },
      'identity.prompt.built': () => {
        m.hooks.byName['identity.prompt.built'] =
          (m.hooks.byName['identity.prompt.built'] ?? 0) + 1;
      },
    };
  }
}
