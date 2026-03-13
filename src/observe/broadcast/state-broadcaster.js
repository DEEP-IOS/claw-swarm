/**
 * StateBroadcaster — SSE real-time event push
 * Subscribes to domain events on EventBus, broadcasts to connected SSE clients.
 * Implements rate limiting for high-frequency events (e.g. field.signal.emitted).
 */

/** Topics this broadcaster subscribes to */
const SSE_TOPICS = [
  'agent.spawned', 'agent.completed', 'agent.failed',
  'orchestration.dag.created', 'orchestration.dag.completed', 'orchestration.dag.failed',
  'orchestration.task.started', 'orchestration.task.completed',
  'orchestration.spawn.advised', 'orchestration.replan.triggered',
  'quality.gate.evaluated', 'quality.breaker.opened', 'quality.breaker.closed',
  'quality.failure.classified', 'quality.anomaly.detected', 'quality.compliance.violation',
  'quality.pipeline.broken', 'quality.audit.completed',
  'quality.tool.validation_failed',
  'pheromone.emitted', 'pheromone.decayed',
  'channel.created', 'channel.closed', 'channel.message.posted',
  'field.signal.emitted',
  'system.health.degraded',
  'memory.episodic.recorded', 'memory.retrieval.completed',
];

/**
 * V8 backward-compatible event aliases.
 * When one of these V8 topics arrives, it is re-broadcast under the V9 key.
 */
const EVENT_ALIASES = {
  'agent.state.changed': 'agent.spawned',
  'swarm.agent.spawned': 'agent.spawned',
  'agent.end': 'agent.completed',
  'circuit_breaker.transition': 'quality.breaker.opened',
  'contract.live_cfp.completed': 'orchestration.task.completed',
};

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
    this._stats = { totalBroadcasts: 0, clientsServed: 0, throttled: 0 };
  }

  /**
   * Register an SSE client (raw Node http.ServerResponse).
   * Sets SSE headers, adds to the client set, and auto-removes on close.
   * @param {import('node:http').ServerResponse} response
   * @returns {Function} cleanup function to manually remove this client
   */
  addClient(response) {
    response.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'X-Accel-Buffering': 'no',
    });

    // Send an initial comment so the client knows the connection is alive
    response.write(':ok\n\n');

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
   * Broadcast an event to all connected SSE clients
   * @param {string} topic
   * @param {*} data
   */
  broadcast(topic, data) {
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
   * Subscribe to all SSE_TOPICS (and V8 aliases) on the bus and wire to broadcast
   */
  start() {
    // Subscribe to each V9 topic
    for (const topic of SSE_TOPICS) {
      const handler = (envelope) => {
        this.broadcast(topic, envelope.data);
      };
      this._bus.subscribe(topic, handler);
      this._subscriptions.push({ topic, handler });
    }

    // Subscribe to V8 alias topics and re-broadcast under V9 keys
    for (const [v8Topic, v9Topic] of Object.entries(EVENT_ALIASES)) {
      const handler = (envelope) => {
        this.broadcast(v9Topic, envelope.data);
      };
      this._bus.subscribe(v8Topic, handler);
      this._subscriptions.push({ topic: v8Topic, handler });
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
