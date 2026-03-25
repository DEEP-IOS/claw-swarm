/**
 * StateBroadcaster — SSE real-time event push
 * Subscribes to domain events on EventBus, broadcasts to connected SSE clients.
 * Implements rate limiting for high-frequency events (e.g. field.signal.emitted).
 */

/**
 * Verbosity levels for broadcast filtering.
 * - 'verbose': emit ALL events including debug/trace
 * - 'normal':  emit lifecycle + progress + errors (default)
 * - 'quiet':   emit only errors + completion
 */
const VERBOSITY_LEVELS = Object.freeze({
  verbose: 'verbose',
  normal:  'normal',
  quiet:   'quiet',
});

/**
 * Topics classified by verbosity tier.
 * quiet:   only critical events (errors, completion, violations)
 * normal:  lifecycle + progress + quiet events
 * verbose: everything including field signals and debug
 */
const QUIET_TOPICS = new Set([
  'agent.lifecycle.completed', 'agent.lifecycle.failed', 'agent.lifecycle.ended',
  'quality.gate.failed', 'quality.breaker.tripped', 'quality.anomaly.detected',
  'quality.compliance.violation', 'quality.compliance.terminated',
  'dag.completed', 'dag.dlq.added',
  'session.ended',
]);

const NORMAL_TOPICS = new Set([
  // All quiet topics are included in normal via the filter logic
  'agent.lifecycle.spawned', 'agent.lifecycle.ready',
  'task.created', 'task.completed', 'dag.state.changed',
  'dag.phase.ready', 'dag.phase.started', 'dag.phase.completed', 'dag.phase.failed',
  'spawn.advised', 'reputation.updated',
  'quality.gate.passed', 'auto.quality.gate', 'auto.shapley.credit',
  'channel.created', 'channel.closed',
  'session.started', 'tool.executed', 'tool.result.recorded', 'user.notification',
  'observe.health.snapshot', 'workflow.phase.changed',
  'store.snapshot.completed', 'store.restore.completed',
  'message.created',
]);

/**
 * Topics this broadcaster subscribes to.
 * Aligned with EventCatalog (src/core/bus/event-catalog.js) standard names.
 */
const SSE_TOPICS = [
  // Field
  'field.signal.emitted', 'field.gc.completed', 'field.emergency_gc',
  'field.snapshot', 'field.stats.snapshot',
  // Store
  'store.snapshot.completed', 'store.restore.completed',
  // Communication
  'channel.created', 'channel.closed', 'channel.message',
  'pheromone.deposited', 'pheromone.evaporated', 'stigmergy.updated',
  // Intelligence
  'agent.lifecycle.spawned', 'agent.lifecycle.ready',
  'agent.lifecycle.completed', 'agent.lifecycle.failed', 'agent.lifecycle.ended',
  'memory.episode.recorded', 'memory.consolidated',
  // Orchestration
  'task.created', 'task.completed', 'dag.state.changed',
  'spawn.advised', 'reputation.updated',
  // Quality
  'quality.gate.passed', 'quality.gate.failed',
  'quality.breaker.tripped', 'quality.anomaly.detected', 'quality.compliance.violation', 'quality.compliance.terminated',
  'auto.quality.gate', 'auto.shapley.credit',
  // Observe
  'observe.metrics.collected', 'observe.health.snapshot', 'workflow.phase.changed',
  // Bridge (non-catalog but useful for SSE)
  'session.started', 'session.ended', 'message.created',
  'tool.executed', 'tool.result.recorded', 'user.notification',
];

/**
 * V8 backward-compatible event aliases.
 * When one of these V8 topics arrives, it is re-broadcast under the V9 key.
 */
/**
 * Legacy event aliases: V8 topic names → V9 canonical names.
 * Ensures backward compatibility during transition.
 */

export class StateBroadcaster {
  /**
   * @param {Object} opts
   * @param {import('../../core/bus/event-bus.js').EventBus} opts.bus
   * @param {Object} [opts.config]
   * @param {number} [opts.config.maxEventsPerSecond=10]
   */
  constructor({ bus, config = {} }) {
    this._bus = bus;
    /** @type {Set<import('node:http').ServerResponse>} */
    this._clients = new Set();
    /** @type {Array<{ topic: string, handler: Function }>} */
    this._subscriptions = [];
    this._maxEventsPerSecond = config.maxEventsPerSecond ?? 10;
    /** @type {Map<string, { count: number, resetAt: number }>} */
    this._throttleWindow = new Map();
    /** @type {'verbose'|'normal'|'quiet'} */
    this._verbosity = config.verbosity ?? VERBOSITY_LEVELS.normal;
    this._stats = { totalBroadcasts: 0, clientsServed: 0, throttled: 0, filtered: 0 };
  }

  /**
   * Register an SSE client (raw Node http.ServerResponse).
   * Sets SSE headers, adds to the client set, and auto-removes on close.
   * @param {import('node:http').ServerResponse} response
   * @returns {Function} cleanup function to manually remove this client
   */
  addClient(response) {
    // SSE headers are already set by DashboardService._handleSSE()
    // Only write headers if not yet sent (standalone usage)
    if (!response.headersSent) {
      response.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
        'X-Accel-Buffering': 'no',
      });
      response.write(':ok\n\n');
    }

    this._clients.add(response);
    this._stats.clientsServed++;

    const onClose = () => {
      this._clients.delete(response);
    };
    response.on('close', onClose);

    return () => {
      response.removeListener('close', onClose);
      this._clients.delete(response);
    };
  }

  /**
   * Remove a client from the broadcast set
   * @param {import('node:http').ServerResponse} response
   */
  removeClient(response) {
    this._clients.delete(response);
  }

  /**
   * Set verbosity level for broadcast filtering.
   * - 'verbose': emit ALL events including debug/trace
   * - 'normal':  emit lifecycle + progress + errors
   * - 'quiet':   emit only errors + completion
   *
   * @param {'verbose'|'normal'|'quiet'} level
   * @throws {Error} if level is not a valid verbosity value
   */
  setVerbosity(level) {
    if (!VERBOSITY_LEVELS[level]) {
      throw new Error(`Invalid verbosity level "${level}". Use: verbose, normal, quiet`);
    }
    this._verbosity = level;
  }

  /**
   * Get current verbosity level.
   * @returns {'verbose'|'normal'|'quiet'}
   */
  getVerbosity() {
    return this._verbosity;
  }

  /**
   * Check if a topic should be filtered based on current verbosity level.
   * @param {string} topic
   * @returns {boolean} true if the event should be dropped
   * @private
   */
  _shouldFilter(topic) {
    if (this._verbosity === VERBOSITY_LEVELS.verbose) return false;
    if (this._verbosity === VERBOSITY_LEVELS.quiet) {
      return !QUIET_TOPICS.has(topic);
    }
    // normal: allow quiet + normal topics
    return !QUIET_TOPICS.has(topic) && !NORMAL_TOPICS.has(topic);
  }

  /**
   * Broadcast an event to all connected SSE clients
   * @param {string} topic
   * @param {*} data
   */
  broadcast(topic, data) {
    if (this._shouldFilter(topic)) {
      this._stats.filtered++;
      return;
    }
    if (this._shouldThrottle(topic)) {
      this._stats.throttled++;
      return;
    }

    const event = { topic, data, ts: Date.now() };
    const payload = `data: ${JSON.stringify(event)}\n\n`;

    for (const client of this._clients) {
      try {
        client.write(payload);
      } catch {
        this._clients.delete(client);
      }
    }
    this._stats.totalBroadcasts++;
  }

  /**
   * Rate-limit check — only throttles field.signal.* events
   * @param {string} topic
   * @returns {boolean} true if the event should be dropped
   * @private
   */
  _shouldThrottle(topic) {
    if (!topic.startsWith('field.signal')) return false;

    const now = Date.now();
    let window = this._throttleWindow.get(topic);
    if (!window || now > window.resetAt) {
      window = { count: 0, resetAt: now + 1000 };
      this._throttleWindow.set(topic, window);
    }
    window.count++;
    return window.count > this._maxEventsPerSecond;
  }

  /**
   * Subscribe to canonical SSE topics on the bus and wire to broadcast.
   * Historical topic names are bridged by EventBus aliases.
   */
  start() {
    for (const topic of SSE_TOPICS) {
      const handler = (envelope) => {
        this.broadcast(topic, envelope.data);
      };
      this._bus.subscribe(topic, handler);
      this._subscriptions.push({ topic, handler });
    }
  }

  /**
   * Unsubscribe all bus listeners and close all SSE client connections
   */
  stop() {
    for (const { topic, handler } of this._subscriptions) {
      this._bus.unsubscribe(topic, handler);
    }
    this._subscriptions.length = 0;

    for (const client of this._clients) {
      try {
        client.end();
      } catch {
        /* ignore — client may already be closed */
      }
    }
    this._clients.clear();
    this._throttleWindow.clear();
  }

  /** @returns {number} current number of connected SSE clients */
  getClientCount() {
    return this._clients.size;
  }

  /**
   * @returns {{ totalBroadcasts: number, clientsServed: number, throttled: number, activeClients: number }}
   */
  getStats() {
    return { ...this._stats, activeClients: this._clients.size };
  }
}
