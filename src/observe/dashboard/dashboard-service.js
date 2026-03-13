/**
 * DashboardService — 57 V9 REST endpoints + 14 Legacy aliases
 *
 * Uses an internal route registry. When start() is called, it creates
 * a simple HTTP server (or attaches to an external one via config.server).
 * For unit testing, routes can be invoked directly via handleRequest(method, path).
 *
 * Route registry pattern:
 *   _route(method, path, handler) registers a handler
 *   _matchRoute(method, pathname) finds the handler and extracts :params
 *   handleRequest(method, pathname, query) is the public testable API
 */
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

const MIME_TYPES = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json',
};

const FIELD_DIMENSIONS = [
  { id: 'task_load', label: 'Task Load', description: 'Current task queue pressure across the swarm' },
  { id: 'error_rate', label: 'Error Rate', description: 'Rolling error frequency across agents' },
  { id: 'latency', label: 'Latency', description: 'Response time distribution for agent operations' },
  { id: 'throughput', label: 'Throughput', description: 'Messages processed per unit time' },
  { id: 'cost', label: 'Cost', description: 'Token and API cost accumulation rate' },
  { id: 'quality', label: 'Quality', description: 'Output quality scores from audit feedback' },
  { id: 'coherence', label: 'Coherence', description: 'Inter-agent goal alignment measurement' },
  { id: 'trust', label: 'Trust', description: 'Peer trust and reputation signals' },
  { id: 'novelty', label: 'Novelty', description: 'Divergence from established solution patterns' },
  { id: 'urgency', label: 'Urgency', description: 'Time-sensitivity pressure on pending work' },
  { id: 'complexity', label: 'Complexity', description: 'Estimated cognitive load of current tasks' },
  { id: 'resource_pressure', label: 'Resource Pressure', description: 'Memory, context window, and budget saturation' },
];

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export class DashboardService {
  /**
   * @param {object} deps
   * @param {object} deps.field            - SignalField instance
   * @param {object} deps.bus              - EventBus instance
   * @param {object} deps.store            - Persistent store
   * @param {object} deps.metricsCollector - MetricsCollector instance
   * @param {object} deps.stateBroadcaster - StateBroadcaster instance (SSE)
   * @param {object} deps.healthChecker    - HealthChecker instance
   * @param {object} deps.traceCollector   - TraceCollector instance
   * @param {object} deps.domains          - Domain service map
   * @param {object} deps.config           - Configuration overrides
   */
  constructor({
    field,
    bus,
    store,
    metricsCollector,
    stateBroadcaster,
    healthChecker,
    traceCollector,
    domains = {},
    config = {},
  }) {
    this._field = field;
    this._bus = bus;
    this._store = store;
    this._metricsCollector = metricsCollector;
    this._stateBroadcaster = stateBroadcaster;
    this._healthChecker = healthChecker;
    this._traceCollector = traceCollector;
    this._domains = domains; // { intelligence, orchestration, quality, communication, bridge }
    this._port = config.port ?? 19100;
    this._server = null;
    this._sseClients = new Set();
    this._consolePath = config.consolePath ?? join(__dirname, 'console');

    // Route registry: key = "METHOD:/pattern", value = { segments, handler }
    // segments is the split pattern for matching, e.g. ['api','v9','agents',':id']
    this._routes = new Map();

    this._registerRoutes();
  }

  // ---------------------------------------------------------------------------
  // Route registration & matching
  // ---------------------------------------------------------------------------

  /**
   * Register a route handler.
   * @param {string} method - HTTP method (GET, POST, etc.)
   * @param {string} path   - URL pattern, may include :param segments
   * @param {Function} handler - (params, query) => any
   */
  _route(method, path, handler) {
    const segments = path.split('/').filter(Boolean);
    const key = `${method}:${path}`;
    this._routes.set(key, { method, path, segments, handler });
  }

  /**
   * Find a matching route for the given method + pathname.
   * Returns { handler, params } or null.
   */
  _matchRoute(method, pathname) {
    const incoming = pathname.split('/').filter(Boolean);

    for (const [, route] of this._routes) {
      if (route.method !== method) continue;
      if (route.segments.length !== incoming.length) continue;

      const params = {};
      let matched = true;
      for (let i = 0; i < route.segments.length; i++) {
        const seg = route.segments[i];
        if (seg.startsWith(':')) {
          params[seg.slice(1)] = decodeURIComponent(incoming[i]);
        } else if (seg !== incoming[i]) {
          matched = false;
          break;
        }
      }
      if (matched) return { handler: route.handler, params };
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // Public testable API
  // ---------------------------------------------------------------------------

  /**
   * Resolve a request without an HTTP server. Primary entry point for unit tests.
   * @param {string} method   - HTTP method
   * @param {string} pathname - URL path (no query string)
   * @param {object} [query]  - Parsed query parameters
   * @returns {{ status: number, data?: any, message?: string }}
   */
  async handleRequest(method, pathname, query = {}) {
    const match = this._matchRoute(method, pathname);
    if (!match) {
      return { status: 404, message: 'Not found' };
    }
    try {
      const result = await match.handler(match.params, query);
      return { status: 200, data: result };
    } catch (err) {
      return { status: 500, message: err.message };
    }
  }

  // ---------------------------------------------------------------------------
  // HTTP server plumbing
  // ---------------------------------------------------------------------------

  /**
   * Internal HTTP request handler wired to the node:http server.
   */
  _handleHttpRequest(req, res) {
    // CORS preflight
    if (req.method === 'OPTIONS') {
      res.writeHead(204, CORS_HEADERS);
      res.end();
      return;
    }

    const parsed = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);
    const pathname = parsed.pathname;
    const query = Object.fromEntries(parsed.searchParams.entries());

    // --- SSE endpoint ---
    if (pathname === '/api/v9/events') {
      this._handleSSE(req, res);
      return;
    }

    // --- Console static files: /v9/console/* ---
    if (pathname === '/v9/console' || pathname.startsWith('/v9/console/')) {
      this._serveConsoleFile(pathname, res);
      return;
    }

    // --- Legacy console redirect ---
    if (pathname === '/v6/console' || pathname.startsWith('/v6/console')) {
      res.writeHead(301, { ...CORS_HEADERS, Location: pathname.replace('/v6/console', '/v9/console') });
      res.end();
      return;
    }

    // --- API routes ---
    this.handleRequest(req.method, pathname, query).then((result) => {
      const headers = { ...CORS_HEADERS, 'Content-Type': 'application/json' };
      res.writeHead(result.status, headers);
      res.end(JSON.stringify(result.status === 200 ? result.data : { error: result.message }));
    });
  }

  /**
   * SSE endpoint — delegates client management to stateBroadcaster if available.
   */
  _handleSSE(req, res) {
    res.writeHead(200, {
      ...CORS_HEADERS,
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    res.write(':\n\n'); // initial keepalive comment

    if (this._stateBroadcaster?.addClient) {
      this._stateBroadcaster.addClient(res);
    } else {
      // Fallback: track locally so stop() can clean up
      this._sseClients.add(res);
      req.on('close', () => this._sseClients.delete(res));
    }
  }

  /**
   * Serve static console files from the console directory.
   */
  _serveConsoleFile(pathname, res) {
    let relative = pathname.replace(/^\/v9\/console\/?/, '') || 'index.html';
    const filePath = join(this._consolePath, relative);

    if (!existsSync(filePath)) {
      // SPA fallback: serve index.html for unknown paths
      const indexPath = join(this._consolePath, 'index.html');
      if (existsSync(indexPath)) {
        const body = readFileSync(indexPath);
        res.writeHead(200, { ...CORS_HEADERS, 'Content-Type': 'text/html' });
        res.end(body);
        return;
      }
      res.writeHead(404, CORS_HEADERS);
      res.end('Not found');
      return;
    }

    const ext = extname(filePath);
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    const body = readFileSync(filePath);
    res.writeHead(200, { ...CORS_HEADERS, 'Content-Type': contentType });
    res.end(body);
  }

  // ---------------------------------------------------------------------------
  // Route registration — all 57 V9 endpoints + 14 legacy aliases
  // ---------------------------------------------------------------------------

  _registerRoutes() {
    // =======================================================================
    // Field domain (4 endpoints)
    // =======================================================================
    this._route('GET', '/api/v9/field/stats', () =>
      this._field?.stats?.() ?? {},
    );

    this._route('GET', '/api/v9/field/superpose/:scope', (params) =>
      this._field?.superpose?.(params.scope) ?? {},
    );

    this._route('GET', '/api/v9/field/signals', (_params, query) =>
      this._field?.query?.(query) ?? [],
    );

    this._route('GET', '/api/v9/field/dimensions', () =>
      this._getFieldDimensions(),
    );

    // =======================================================================
    // Agents domain (4 endpoints)
    // =======================================================================
    this._route('GET', '/api/v9/agents/active', () =>
      this._domains.intelligence?.getActiveAgents?.() ?? [],
    );

    this._route('GET', '/api/v9/agents/states', () =>
      this._domains.intelligence?.getAllAgentStates?.() ?? {},
    );

    this._route('GET', '/api/v9/agents/capabilities', () =>
      this._domains.intelligence?.getCapabilities?.() ?? {},
    );

    // Parameterized route AFTER static routes so /agents/active etc. match first
    this._route('GET', '/api/v9/agents/:id', (params) =>
      this._domains.intelligence?.getAgentInfo?.(params.id) ?? {},
    );

    // =======================================================================
    // Orchestration domain (4 endpoints)
    // =======================================================================
    this._route('GET', '/api/v9/tasks', () =>
      this._domains.orchestration?.getTasks?.() ?? [],
    );

    this._route('GET', '/api/v9/tasks/dead-letters', () =>
      this._domains.orchestration?.getDeadLetters?.() ?? [],
    );

    this._route('GET', '/api/v9/tasks/critical-path', () =>
      this._domains.orchestration?.getCriticalPath?.() ?? {},
    );

    this._route('GET', '/api/v9/tasks/:dagId', (params) =>
      this._domains.orchestration?.getDAG?.(params.dagId) ?? {},
    );

    // =======================================================================
    // Social domain (5 endpoints)
    // =======================================================================
    this._route('GET', '/api/v9/reputation', () =>
      this._domains.intelligence?.getReputation?.() ?? {},
    );

    this._route('GET', '/api/v9/sna', () =>
      this._domains.intelligence?.getSNA?.() ?? {},
    );

    this._route('GET', '/api/v9/emotional-states', () =>
      this._domains.intelligence?.getEmotionalStates?.() ?? {},
    );

    this._route('GET', '/api/v9/trust', () =>
      this._domains.intelligence?.getTrust?.() ?? {},
    );

    this._route('GET', '/api/v9/cultural-friction', () =>
      this._domains.intelligence?.getCulturalFriction?.() ?? {},
    );

    // =======================================================================
    // Adaptation domain (9 endpoints)
    // =======================================================================
    this._route('GET', '/api/v9/modulator', () =>
      this._domains.orchestration?.getModulatorState?.() ?? {},
    );

    this._route('GET', '/api/v9/shapley', () =>
      this._domains.orchestration?.getShapleyCredits?.() ?? {},
    );

    this._route('GET', '/api/v9/species', () =>
      this._domains.orchestration?.getSpeciesState?.() ?? {},
    );

    this._route('GET', '/api/v9/calibration', () =>
      this._domains.orchestration?.getCalibration?.() ?? {},
    );

    this._route('GET', '/api/v9/budget', () =>
      this._domains.orchestration?.getBudget?.() ?? {},
    );

    this._route('GET', '/api/v9/budget-forecast', () =>
      this._domains.orchestration?.getBudgetForecast?.() ?? {},
    );

    this._route('GET', '/api/v9/dual-process', () =>
      this._domains.orchestration?.getDualProcessStats?.() ?? {},
    );

    this._route('GET', '/api/v9/signal-weights', () =>
      this._getSignalWeights(),
    );

    this._route('GET', '/api/v9/role-discovery', () =>
      this._domains.orchestration?.getRoleDiscovery?.() ?? {},
    );

    // =======================================================================
    // Quality domain (5 endpoints)
    // =======================================================================
    this._route('GET', '/api/v9/quality-audit', () =>
      this._domains.quality?.getAuditHistory?.() ?? [],
    );

    this._route('GET', '/api/v9/failure-modes', () =>
      this._domains.quality?.getFailureModeDistribution?.() ?? {},
    );

    this._route('GET', '/api/v9/compliance', () =>
      this._domains.quality?.getComplianceStats?.() ?? {},
    );

    this._route('GET', '/api/v9/circuit-breakers', () =>
      this._domains.quality?.getAllBreakerStates?.() ?? {},
    );

    this._route('GET', '/api/v9/vaccinations', () =>
      this._domains.quality?.getAntigens?.() ?? [],
    );

    // =======================================================================
    // Communication domain (3 endpoints)
    // =======================================================================
    this._route('GET', '/api/v9/pheromones', () =>
      this._domains.communication?.getPheromoneState?.() ?? {},
    );

    this._route('GET', '/api/v9/channels', () =>
      this._domains.communication?.getActiveChannels?.() ?? [],
    );

    this._route('GET', '/api/v9/stigmergy', () =>
      this._domains.communication?.getStigmergy?.() ?? {},
    );

    // =======================================================================
    // Governance domain (2 endpoints)
    // =======================================================================
    this._route('GET', '/api/v9/governance', () =>
      this._domains.orchestration?.getGovernanceStats?.() ?? {},
    );

    this._route('GET', '/api/v9/emergence', () =>
      this._domains.orchestration?.getEmergencePatterns?.() ?? {},
    );

    // =======================================================================
    // Traces domain (2 endpoints)
    // =======================================================================
    this._route('GET', '/api/v9/traces', (_params, query) =>
      this._traceCollector?.getTraces?.(query) ?? [],
    );

    this._route('GET', '/api/v9/traces/:id', (params) =>
      this._traceCollector?.getTrace?.(params.id) ?? {},
    );

    // =======================================================================
    // System domain (5 endpoints)
    //   Note: /api/v9/events (SSE) is handled in _handleHttpRequest directly
    //   Note: /v9/console/* (static) is handled in _handleHttpRequest directly
    // =======================================================================
    this._route('GET', '/api/v9/metrics', () =>
      this._metricsCollector?.getMetrics?.() ?? {},
    );

    this._route('GET', '/api/v9/health', () =>
      this._healthChecker?.getHealth?.() ?? {},
    );

    this._route('GET', '/api/v9/config', () => ({
      port: this._port,
      consolePath: this._consolePath,
      fieldDimensions: FIELD_DIMENSIONS.length,
      registeredRoutes: this._routes.size,
    }));

    this._route('GET', '/api/v9/bus/stats', () =>
      this._bus?.stats?.() ?? {},
    );

    this._route('GET', '/api/v9/store/stats', () =>
      this._store?.stats?.() ?? {},
    );

    // =======================================================================
    // User-facing domain (3 endpoints)
    // =======================================================================
    this._route('GET', '/api/v9/progress/:dagId', (params) =>
      this._domains.bridge?.getProgress?.(params.dagId) ?? {},
    );

    this._route('GET', '/api/v9/cost-report/:dagId', (params) =>
      this._domains.orchestration?.getCostReport?.(params.dagId) ?? {},
    );

    this._route('GET', '/api/v9/artifacts/:dagId', (params) =>
      this._domains.intelligence?.getArtifacts?.(params.dagId) ?? [],
    );

    // =======================================================================
    // Memory/Identity domain (3 endpoints)
    // =======================================================================
    this._route('GET', '/api/v9/memory/stats', () =>
      this._domains.intelligence?.getMemoryStats?.() ?? {},
    );

    this._route('GET', '/api/v9/identity', () =>
      this._domains.intelligence?.getIdentityMap?.() ?? {},
    );

    this._route('GET', '/api/v9/context-window', () =>
      this._domains.intelligence?.getContextWindowStats?.() ?? {},
    );

    // =======================================================================
    // Bridge domain (2 endpoints)
    // =======================================================================
    this._route('GET', '/api/v9/bridge/status', () =>
      this._domains.bridge?.getStatus?.() ?? {},
    );

    this._route('GET', '/api/v9/bridge/queue', () =>
      this._domains.bridge?.getQueue?.() ?? [],
    );

    // =======================================================================
    // Topology domain (4 endpoints)
    // =======================================================================
    this._route('GET', '/api/v9/topology', () =>
      this._domains.orchestration?.getTopology?.() ?? {},
    );

    this._route('GET', '/api/v9/topology/graph', () =>
      this._domains.orchestration?.getTopologyGraph?.() ?? { nodes: [], edges: [] },
    );

    this._route('GET', '/api/v9/modules', () =>
      this._domains.orchestration?.getModuleManifest?.() ?? [],
    );

    this._route('GET', '/api/v9/modules/:moduleId', (params) =>
      this._domains.orchestration?.getModuleInfo?.(params.moduleId) ?? {},
    );

    // Total V9 endpoints: 57
    //   In registry (55):
    //     Field(4) + Agents(4) + Orchestration(4) + Social(5) + Adaptation(9)
    //     + Quality(5) + Communication(3) + Governance(2) + Traces(2)
    //     + System(5) + UserFacing(3) + Memory/Identity(3) + Bridge(2) + Topology(4)
    //   Outside registry (2): SSE(/api/v9/events) + Console static(/v9/console/*)

    // =======================================================================
    // Legacy aliases (14) — each points to the corresponding V9 handler
    // =======================================================================
    this._registerLegacyAliases();
  }

  /**
   * Register 14 legacy v1 aliases that delegate to their v9 counterparts.
   */
  _registerLegacyAliases() {
    const aliases = [
      ['/api/v1/last-inject',     '/api/v9/metrics'],
      ['/api/v1/subagent-stats',  '/api/v9/metrics'],
      ['/api/v1/governance',      '/api/v9/governance'],
      ['/api/v1/modulator',       '/api/v9/modulator'],
      ['/api/v1/sna',             '/api/v9/sna'],
      ['/api/v1/shapley',         '/api/v9/shapley'],
      ['/api/v1/dual-process',    '/api/v9/dual-process'],
      ['/api/v1/failure-modes',   '/api/v9/failure-modes'],
      ['/api/v1/budget-forecast', '/api/v9/budget-forecast'],
      ['/api/v1/quality-audit',   '/api/v9/quality-audit'],
      ['/api/v1/agent-states',    '/api/v9/agents/states'],
      ['/api/v1/metrics',         '/api/v9/metrics'],
      ['/api/v1/health',          '/api/v9/health'],
      ['/api/v1/compliance',      '/api/v9/compliance'],
    ];

    for (const [legacyPath, v9Path] of aliases) {
      // Find the target handler by iterating stored routes
      const targetKey = `GET:${v9Path}`;
      const target = this._routes.get(targetKey);
      if (target) {
        this._route('GET', legacyPath, target.handler);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Helper data methods
  // ---------------------------------------------------------------------------

  /**
   * Return the 12-dimension field descriptor array.
   */
  _getFieldDimensions() {
    return FIELD_DIMENSIONS;
  }

  /**
   * Return current signal calibration weights from the field or sensible defaults.
   */
  _getSignalWeights() {
    if (this._field?.getWeights) {
      return this._field.getWeights();
    }
    // Default weights — one per dimension
    const weights = {};
    for (const dim of FIELD_DIMENSIONS) {
      weights[dim.id] = 1.0;
    }
    return weights;
  }

  // ---------------------------------------------------------------------------
  // Introspection helpers
  // ---------------------------------------------------------------------------

  /**
   * Return the total number of registered routes (V9 + legacy).
   */
  getRouteCount() {
    return this._routes.size;
  }

  /**
   * Return a sorted list of all registered route paths (for debugging / tests).
   * @returns {string[]} e.g. ['GET:/api/v1/health', 'GET:/api/v9/agents/:id', ...]
   */
  getRegisteredPaths() {
    return [...this._routes.keys()].sort();
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Start the HTTP server on the configured port.
   * @returns {Promise<void>}
   */
  async start() {
    this._server = createServer((req, res) => this._handleHttpRequest(req, res));
    return new Promise((resolve, reject) => {
      this._server.listen(this._port, '127.0.0.1', () => {
        this._bus?.emit?.('dashboard:started', { port: this._port });
        resolve();
      });
      this._server.on('error', reject);
    });
  }

  /**
   * Gracefully stop the HTTP server and close SSE clients.
   * @returns {Promise<void>}
   */
  async stop() {
    // Close all SSE clients tracked locally
    for (const client of this._sseClients) {
      try { client.end(); } catch { /* ignore */ }
    }
    this._sseClients.clear();

    if (!this._server) return;
    return new Promise((resolve) => {
      this._server.close(() => {
        this._bus?.emit?.('dashboard:stopped', { port: this._port });
        this._server = null;
        resolve();
      });
    });
  }
}
