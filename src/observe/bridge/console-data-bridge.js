/**
 * ConsoleDataBridge 鈥?WebSocket bidirectional data channel for 3D Console
 *
 * Replaces the read-only SSE+REST architecture with a full-duplex WebSocket
 * channel on port 19101. Supports:
 * - WorldSnapshot push at configurable Hz (0/1/5/30)
 * - Event subscription with wildcard matching
 * - 16 RPC methods covering all 7 domains
 * - Tool execution whitelist (swarm_query, swarm_pheromone only)
 *
 * @module observe/bridge/console-data-bridge
 * @version 9.2.0
 */

import { WebSocketServer } from 'ws';

const TOOL_WHITELIST = new Set(['swarm_query', 'swarm_pheromone']);
const MAX_CLIENTS = 4;
const MAX_MESSAGE_SIZE = 1024 * 1024; // 1MB
const DEFAULT_SNAPSHOT_HZ = 5;
const SNAPSHOT_TICK_HZ = 30; // Internal tick rate, delivers per-client at their Hz
const SNAPSHOT_FIELDS_ALL = [
  'agents',
  'pheromones',
  'channels',
  'field',
  'tasks',
  'system',
  'mode',
  'health',
  'budget',
  'breakers',
  'metrics',
  'adaptation',
];
const DESIGN_MODEL = '7 autonomous domains + dual foundation';
const RUNTIME_DOMAIN_IDS = Object.freeze(['communication', 'intelligence', 'orchestration', 'quality', 'observe']);
const ARCHITECTURE_DOMAIN_IDS = Object.freeze(['core', ...RUNTIME_DOMAIN_IDS, 'bridge']);
const RESEARCH_ROLES = new Set(['researcher', 'analyst', 'librarian', 'consultant', 'scout']);
const ROUTE_ROLES = new Set(['planner', 'coordinator', 'architect']);
const IMPLEMENT_ROLES = new Set(['implementer', 'debugger', 'tester', 'coder', 'guard']);
const REVIEW_ROLES = new Set(['reviewer']);
const CAPABILITY_VECTOR_KEYS = Object.freeze([
  'coding',
  'architecture',
  'testing',
  'documentation',
  'security',
  'performance',
  'communication',
  'domain',
]);
const DEFAULT_EMOTION = Object.freeze({
  frustration: 0,
  confidence: 0.5,
  joy: 0.3,
  urgency: 0,
  curiosity: 0.5,
  fatigue: 0,
});

function toCapabilityArray(vector) {
  if (Array.isArray(vector)) {
    return CAPABILITY_VECTOR_KEYS.map((_, index) => vector[index] ?? 0.5);
  }
  return CAPABILITY_VECTOR_KEYS.map((key) => vector?.[key] ?? 0.5);
}

function toEmotionSnapshot(emotion) {
  return {
    frustration: emotion?.frustration ?? DEFAULT_EMOTION.frustration,
    confidence: emotion?.confidence ?? DEFAULT_EMOTION.confidence,
    joy: emotion?.joy ?? DEFAULT_EMOTION.joy,
    urgency: emotion?.urgency ?? DEFAULT_EMOTION.urgency,
    curiosity: emotion?.curiosity ?? DEFAULT_EMOTION.curiosity,
    fatigue: emotion?.fatigue ?? DEFAULT_EMOTION.fatigue,
  };
}

function toReputationScore(entry) {
  if (typeof entry === 'number') return entry;
  if (typeof entry?.score === 'number') return entry.score;
  if (typeof entry?.ratio === 'number') return entry.ratio;
  return 0.5;
}

function getSoulPayload(intelligence, agentId) {
  return intelligence?.getSoul?.(agentId) ?? {
    soul: intelligence?.soulDesigner?.loadSoulInstance?.(agentId) ?? null,
    archetype: intelligence?.soulDesigner?.getAgentArchetype?.(agentId) ?? 'pragmatic',
  };
}

function getAgentPosition(agent) {
  const position = agent?.position ?? agent?.raw?.position ?? agent?.raw?.options?.position;
  if (!position) return null;

  if (Array.isArray(position) && position.length >= 3) {
    const [x, y, z] = position;
    return Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)
      ? { x, y, z }
      : null;
  }

  const x = position?.x;
  const y = position?.y;
  const z = position?.z;
  if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
    return { x, y, z };
  }

  return null;
}

function groupCount(items, keySelector) {
  const counts = {};
  for (const item of items) {
    const key = keySelector(item);
    if (!key) continue;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function countEmotionHotAgents(agentSnapshots = []) {
  return agentSnapshots.filter((agent) => {
    const emotion = agent?.emotion ?? {};
    return (emotion.frustration ?? 0) >= 0.65
      || (emotion.urgency ?? 0) >= 0.8
      || (emotion.confidence ?? 1) <= 0.25;
  }).length;
}

function summarizeRoleSensitivityProfiles(profiles = []) {
  return {
    profileCount: profiles.length,
    profiles: profiles.map((profile) => ({
      roleId: profile.roleId ?? profile.id ?? 'unknown',
      name: profile.name ?? profile.roleId ?? profile.id ?? 'unknown',
      preferredModel: profile.preferredModel ?? 'balanced',
      toolCount: profile.toolCount ?? 0,
      sensitivity: profile.sensitivity ?? {},
      topDimensions: Array.isArray(profile.topDimensions) ? profile.topDimensions : [],
    })),
  };
}

function normalizeTaskStatus(task = {}) {
  const nodes = Array.isArray(task.nodes) ? task.nodes : [];
  const raw = String(task.status ?? task.state ?? '').toUpperCase();
  const nodeStates = new Set(nodes.map((node) => String(node?.state ?? '').toUpperCase()));

  if (raw === 'COMPLETED' || nodeStates.has('COMPLETED') && nodes.length > 0 && nodeStates.size === 1) {
    return 'COMPLETED';
  }
  if (raw === 'FAILED' || raw === 'DEAD_LETTER' || raw === 'CANCELLED'
    || nodeStates.has('FAILED') || nodeStates.has('DEAD_LETTER')) {
    return 'FAILED';
  }
  if (raw === 'EXECUTING' || raw === 'RUNNING' || nodeStates.has('EXECUTING') || nodeStates.has('ASSIGNED')) {
    return 'RUNNING';
  }
  return 'PENDING';
}

function pickPrimaryNode(task = {}) {
  const nodes = Array.isArray(task.nodes) ? task.nodes : [];
  return nodes.find((node) => {
    const state = String(node?.state ?? '').toUpperCase();
    return state === 'EXECUTING' || state === 'ASSIGNED';
  })
    || nodes.find((node) => String(node?.state ?? '').toUpperCase() === 'PENDING')
    || nodes.find((node) => String(node?.state ?? '').toUpperCase() === 'COMPLETED')
    || nodes[0]
    || null;
}

function summarizeNodeCounts(task = {}) {
  const counts = {
    pending: 0,
    running: 0,
    completed: 0,
    failed: 0,
  };

  const nodes = Array.isArray(task.nodes) ? task.nodes : [];
  for (const node of nodes) {
    const state = String(node?.state ?? '').toUpperCase();
    if (state === 'PENDING' || state === 'ASSIGNED') counts.pending += 1;
    else if (state === 'EXECUTING') counts.running += 1;
    else if (state === 'COMPLETED') counts.completed += 1;
    else if (state === 'FAILED' || state === 'DEAD_LETTER') counts.failed += 1;
  }

  return counts;
}

function inferWorkflowPhase({ researchCount, routeCount, implementCount, reviewCount, completedTasks, openBreakers }) {
  if (openBreakers > 0) return 'Guardrails engaged';
  if (reviewCount > 0) return 'Reviewing output';
  if (implementCount > 0) return 'Implementing plan';
  if (researchCount > 0) return 'Researching context';
  if (routeCount > 0) return 'Routing work';
  if (completedTasks > 0) return 'Synthesizing result';
  return 'Standing by';
}

function buildStageState(enabled, active, detail, warning = false) {
  if (!enabled) {
    return { status: 'offline', detail };
  }
  if (warning) {
    return { status: 'warning', detail };
  }
  if (active) {
    return { status: 'active', detail };
  }
  return { status: 'ready', detail };
}

export class ConsoleDataBridge {
  /**
   * @param {Object} deps
   * @param {Object} deps.field  - SignalField/SignalStore instance
   * @param {Object} deps.bus    - EventBus instance
   * @param {Object} deps.store  - DomainStore instance
   * @param {Object} deps.domains - { intelligence, orchestration, quality, communication, bridge }
   * @param {Object} [deps.config]
   */
  constructor({ field, bus, store, domains = {}, metricsCollector, healthChecker, config = {} }) {
    this._field = field;
    this._bus = bus;
    this._store = store;
    this._domains = domains;
    this._metricsCollector = metricsCollector ?? null;
    this._healthChecker = healthChecker ?? null;
    this._port = config.port ?? 19101;
    this._host = config.host ?? '127.0.0.1';
    this._defaultSnapshotHz = config.snapshotHz ?? DEFAULT_SNAPSHOT_HZ;

    /** @type {WebSocketServer|null} */
    this._wss = null;
    /** @type {Map<WebSocket, ClientState>} */
    this._clients = new Map();
    /** @type {number|null} */
    this._tickTimer = null;
    this._frameId = 0;
    this._tickId = 0;
    this._busUnsubscribe = null;
    this._lastSnapshotJson = null;
    this._lastSnapshotTs = 0;
  }

  // 鈹€鈹€鈹€ Lifecycle 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

  async start() {
    if (this._wss) return;

    this._wss = new WebSocketServer({
      port: this._port,
      host: this._host,
      maxPayload: MAX_MESSAGE_SIZE,
    });

    this._wss.on('connection', (ws) => this._onConnect(ws));
    this._wss.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        console.warn(`[ConsoleDataBridge] Port ${this._port} in use, skipping`);
      }
    });

    // Subscribe to all EventBus events for forwarding
    const sub = this._bus?.subscribe || this._bus?.on;
    if (sub) {
      this._busUnsubscribe = sub.call(this._bus, '*', (envelope) => {
        this._broadcastEvent(envelope);
      });
    }

    // Start snapshot tick loop
    this._startSnapshotLoop();

    // Wait for WSS to be listening
    await new Promise((resolve, reject) => {
      this._wss.once('listening', resolve);
      this._wss.once('error', (err) => {
        if (err.code === 'EADDRINUSE') resolve(); // non-fatal
        else reject(err);
      });
    });
  }

  async stop() {
    if (this._tickTimer) {
      clearInterval(this._tickTimer);
      this._tickTimer = null;
    }

    if (this._busUnsubscribe) {
      if (typeof this._busUnsubscribe === 'function') this._busUnsubscribe();
      this._busUnsubscribe = null;
    }

    // Close all client connections
    for (const [ws] of this._clients) {
      try { ws.close(1001, 'server shutting down'); } catch { /**/ }
    }
    this._clients.clear();

    if (this._wss) {
      await new Promise((resolve) => this._wss.close(resolve));
      this._wss = null;
    }
  }

  // 鈹€鈹€鈹€ Connection Management 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

  _onConnect(ws) {
    if (this._clients.size >= MAX_CLIENTS) {
      ws.close(1013, 'max clients reached');
      return;
    }

    /** @type {ClientState} */
    const client = {
      subscriptions: ['*'], // default: receive all events
      scopes: null,
      snapshotHz: this._defaultSnapshotHz,
      snapshotFields: [...SNAPSHOT_FIELDS_ALL],
      lastSnapshotFrame: 0,
    };
    this._clients.set(ws, client);

    ws.on('message', (raw) => this._onMessage(ws, raw));
    ws.on('close', () => this._clients.delete(ws));
    ws.on('error', () => this._clients.delete(ws));

    // Send initial full snapshot
    try {
      const snapshot = this._buildSnapshot(SNAPSHOT_FIELDS_ALL);
      this._safeSend(ws, { type: 'snapshot', snapshot });
    } catch { /**/ }
  }

  _onMessage(ws, raw) {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      this._safeSend(ws, { type: 'error', error: 'Invalid JSON' });
      return;
    }

    const client = this._clients.get(ws);
    if (!client) return;

    switch (msg.type) {
      case 'subscribe':
        client.subscriptions = Array.isArray(msg.topics) ? msg.topics : ['*'];
        client.scopes = Array.isArray(msg.scopes) ? msg.scopes : null;
        break;

      case 'unsubscribe':
        client.subscriptions = [];
        break;

      case 'configure':
        if (typeof msg.snapshotHz === 'number') {
          client.snapshotHz = Math.max(0, Math.min(30, msg.snapshotHz));
        }
        if (Array.isArray(msg.snapshotFields)) {
          client.snapshotFields = msg.snapshotFields.filter(f => SNAPSHOT_FIELDS_ALL.includes(f));
        }
        break;

      case 'rpc':
        this._handleRPC(ws, msg);
        break;

      default:
        this._safeSend(ws, { type: 'error', error: `Unknown message type: ${msg.type}` });
    }
  }

  // 鈹€鈹€鈹€ RPC 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

  async _handleRPC(ws, msg) {
    const { id, method, params = {} } = msg;
    if (!id || !method) {
      this._safeSend(ws, { type: 'error', id, error: 'Missing id or method', code: 'INVALID_PARAMS' });
      return;
    }

    try {
      const result = await this._executeRPC(method, params);
      this._safeSend(ws, { type: 'rpc_result', id, result });
    } catch (err) {
      const code = err.message?.startsWith('FORBIDDEN') ? 'FORBIDDEN'
        : err.message?.startsWith('UNKNOWN_METHOD') ? 'UNKNOWN_METHOD'
        : 'EXECUTION_ERROR';
      this._safeSend(ws, { type: 'error', id, error: err.message, code });
    }
  }

  async _executeRPC(method, params) {
    switch (method) {
      // 鈹€鈹€ Signal Field 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
      case 'field.emit':
        this._field?.emit?.(params);
        return { ok: true };

      case 'field.superpose':
        return { vector: this._field?.superpose?.(params.scope) ?? {} };

      case 'field.query':
        return { signals: this._field?.query?.(params) ?? [] };

      case 'field.stats':
        return this._field?.stats?.() ?? {};

      // 鈹€鈹€ Pheromone 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
      case 'pheromone.deposit': {
        const comm = this._domains.communication;
        const result = await comm?.depositPheromone?.(params);
        return {
          ok: true,
          signalId: result?.id ?? null,
        };
      }

      case 'pheromone.read':
        return {
          trails: await this._domains.communication?.readPheromones?.(params) ?? [],
        };

      case 'pheromone.stats': {
        const state = this._domains.communication?.getPheromoneState?.() ?? {};
        return {
          types: state.types ?? 0,
          trails: state.trailCount ?? (Array.isArray(state.trails) ? state.trails.length : 0),
          byType: state.byType ?? {},
        };
      }

      // 鈹€鈹€ Tool Execute 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
      case 'tool.execute': {
        if (!params.toolName || !TOOL_WHITELIST.has(params.toolName)) {
          throw new Error('FORBIDDEN: only swarm_query and swarm_pheromone allowed');
        }
        const bridge = this._domains.bridge;
        const tool = bridge?.getRegisteredTools?.()?.find?.(t => t.name === params.toolName);
        if (!tool) throw new Error(`Tool not found: ${params.toolName}`);
        return await tool.execute(params.toolCallId ?? 'console-rpc', params.params ?? {});
      }

      // 鈹€鈹€ Agent Queries 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
      case 'agent.list':
        return { agents: this._buildAgentSnapshots() };

      case 'agent.query':
        return {
          agent: this._buildAgentSnapshots().find((agent) => agent.id === params.agentId)
            ?? this._domains.intelligence?.getAgentInfo?.(params.agentId)
            ?? {},
        };

      case 'agents.positions': {
        const positions = (this._domains.intelligence?.getActiveAgents?.() ?? [])
          .map((agent) => {
            const id = agent.agentId ?? agent.id;
            const position = getAgentPosition(agent);
            return position ? { id, ...position } : null;
          })
          .filter(Boolean);
        return { positions };
      }

      case 'soul.get': {
        const intel = this._domains.intelligence;
        return getSoulPayload(intel, params.agentId);
      }

      // 鈹€鈹€ Metrics / Health 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
      case 'metrics.snapshot':
        return { metrics: this._metricsCollector?.getMetrics?.() ?? {} };

      case 'health.check':
        return this._healthChecker?.getHealth?.() ?? {};

      // 鈹€鈹€ Quality 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
      case 'breaker.states':
        return { breakers: this._domains.quality?.getAllBreakerStates?.() ?? {} };

      // 鈹€鈹€ Orchestration 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
      case 'modulator.state':
        return this._domains.orchestration?.getModulatorState?.() ?? {};

      case 'sna.topology':
        return this._domains.intelligence?.getSNA?.() ?? {};

      case 'dag.status':
        return this._domains.orchestration?.getDAG?.(params.dagId) ?? {};

      case 'budget.status':
        return this._domains.orchestration?.getBudget?.() ?? {};

      case 'species.state':
        return this._domains.orchestration?.getSpeciesState?.() ?? {};

      case 'calibration.weights':
        return this._domains.orchestration?.getCalibration?.() ?? {};

      default:
        throw new Error(`UNKNOWN_METHOD: ${method}`);
    }
  }

  // 鈹€鈹€鈹€ Snapshot 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

  _buildAgentSnapshots(now = Date.now()) {
    const intelligence = this._domains.intelligence;
    const agents = intelligence?.getActiveAgents?.() ?? [];
    const emotions = intelligence?.getEmotionalStates?.() ?? {};
    const reputation = intelligence?.getReputation?.() ?? {};
    const capabilities = intelligence?.getCapabilities?.() ?? {};
    const abcRoles = intelligence?.getABCRoles?.()
      ?? intelligence?.abcClassifier?.getAllRoles?.()
      ?? {};

    return agents.map((agent) => {
      const agentId = agent.agentId ?? agent.id;
      const agentInfo = intelligence?.getAgentInfo?.(agentId) ?? {};
      const soulPayload = getSoulPayload(intelligence, agentId);

      return {
        id: agentId,
        role: agentInfo.roleId ?? agentInfo.role ?? agent.roleId ?? agent.role ?? 'implementer',
        state: agentInfo.state ?? agent.state ?? 'idle',
        parentId: agentInfo.parentId ?? agent.parentId ?? agent.options?.parentId ?? null,
        taskId: agentInfo.taskId ?? agent.taskId ?? null,
        sessionId: agentInfo.sessionId ?? agent.sessionId ?? agent.options?.sessionId ?? '',
        spawnedAt: agentInfo.spawnedAt ?? agent.spawnedAt ?? now,
        soul: soulPayload.soul ?? agentInfo.soul ?? null,
        archetype: soulPayload.archetype ?? agentInfo.archetype ?? 'pragmatic',
        emotion: toEmotionSnapshot(emotions[agentId] ?? agentInfo.emotion),
        reputation: toReputationScore(reputation[agentId] ?? agentInfo.reputation),
        capabilities: toCapabilityArray(capabilities[agentId] ?? agentInfo.capabilities),
        abc: abcRoles[agentId] ?? agentInfo.abc ?? intelligence?.abcClassifier?.getRole?.(agentId) ?? 'employed',
      };
    });
  }

  _buildTaskSnapshots() {
    const orchestrationTasks = this._domains.orchestration?.getTasks?.() ?? [];

    return orchestrationTasks.map((task) => {
      const primaryNode = pickPrimaryNode(task);
      const status = normalizeTaskStatus(task);
      const dependencies = Array.from(new Set(
        (Array.isArray(task.nodes) ? task.nodes : [])
          .flatMap((node) => Array.isArray(node?.dependsOn) ? node.dependsOn : [])
          .filter(Boolean)
      ));

      return {
        id: task.id ?? task.dagId ?? `task-${Date.now()}`,
        name: primaryNode?.task ?? task.summary ?? task.id ?? 'workflow',
        status,
        assigneeId: primaryNode?.agentId ?? null,
        priority: primaryNode?.priority ?? 0,
        dependencies,
        dagId: task.dagId ?? task.id ?? '',
        createdAt: task.createdAt ?? Date.now(),
        summary: task.summary ?? '',
        role: primaryNode?.role ?? null,
        nodeCounts: summarizeNodeCounts(task),
      };
    });
  }

  _collectAllModules() {
    const modules = [];

    for (const domainId of RUNTIME_DOMAIN_IDS) {
      const domain = this._domains[domainId];
      if (!domain) continue;

      if (typeof domain.allModules === 'function') {
        const items = domain.allModules();
        if (Array.isArray(items)) {
          modules.push(...items);
          continue;
        }
      }

      if (Array.isArray(domain._modules)) {
        modules.push(...domain._modules);
      } else if (domain._modules && typeof domain._modules === 'object') {
        modules.push(...Object.values(domain._modules));
      }
    }

    return modules;
  }

  _buildSystemSummary({ agents, tasks, health, breakers, mode }) {
    const agentSnapshots = agents ?? this._buildAgentSnapshots();
    const taskSnapshots = tasks ?? this._buildTaskSnapshots();
    const healthSnapshot = health ?? this._healthChecker?.getHealth?.() ?? { score: 0, status: 'unknown', ts: Date.now() };
    const breakerStates = breakers ?? this._domains.quality?.getAllBreakerStates?.() ?? {};
    const modulator = mode ?? this._domains.orchestration?.getModulatorState?.() ?? {};
    const pheromoneState = this._domains.communication?.getPheromoneState?.() ?? { trailCount: 0, activeTypes: [] };
    const channelState = this._domains.communication?.getActiveChannels?.() ?? { count: 0, channels: [] };
    const stigmergyState = this._domains.communication?.getStigmergy?.() ?? { entryCount: 0, entries: [] };
    const complianceStats = this._domains.quality?.getComplianceStats?.() ?? {};
    const budgetState = this._domains.orchestration?.getBudget?.() ?? {
      dagCount: 0,
      dags: [],
      global: { totalSession: 0, spent: 0, remaining: 0, utilization: 0 },
    };
    const adaptationState = this._buildAdaptationSnapshot();
    const bridgeStatus = this._domains.bridge?.getStatus?.() ?? {};
    const bridgeTelemetry = adaptationState.bridge ?? {};
    const interactionTelemetry = bridgeTelemetry.interaction ?? {};
    const notifierTelemetry = interactionTelemetry.notifier ?? {};
    const modelFallbackTelemetry = bridgeTelemetry.modelFallback ?? {};
    const resilienceTelemetry = adaptationState.resilience ?? {};
    const toolResilienceTelemetry = resilienceTelemetry.toolResilience ?? {};
    const circuitBreakerTelemetry = resilienceTelemetry.circuitBreaker ?? {};
    const pipelineBreakerTelemetry = resilienceTelemetry.pipelineBreaker ?? {};
    const failureAnalyzerTelemetry = resilienceTelemetry.failureAnalyzer ?? {};
    const anomalyTelemetry = resilienceTelemetry.anomalyDetector ?? {};
    const vaccinationTelemetry = resilienceTelemetry.failureVaccination ?? {};
    const complianceTelemetry = resilienceTelemetry.complianceMonitor ?? complianceStats;

    const runtimeStatus = {
      communication: !!this._domains.communication,
      intelligence: !!this._domains.intelligence,
      orchestration: !!this._domains.orchestration,
      quality: !!this._domains.quality,
      observe: !!this._domains.observe,
    };
    const domainStatus = {
      core: !!(this._field && this._bus && this._store),
      ...runtimeStatus,
      bridge: !!this._domains.bridge,
    };

    const activeRoles = groupCount(agentSnapshots, (agent) => agent.role);
    const researchCount = Object.entries(activeRoles)
      .filter(([role]) => RESEARCH_ROLES.has(role))
      .reduce((sum, [, count]) => sum + count, 0);
    const routeCount = Object.entries(activeRoles)
      .filter(([role]) => ROUTE_ROLES.has(role))
      .reduce((sum, [, count]) => sum + count, 0);
    const implementCount = Object.entries(activeRoles)
      .filter(([role]) => IMPLEMENT_ROLES.has(role))
      .reduce((sum, [, count]) => sum + count, 0);
    const reviewCount = Object.entries(activeRoles)
      .filter(([role]) => REVIEW_ROLES.has(role))
      .reduce((sum, [, count]) => sum + count, 0);

    const activeTasks = taskSnapshots.filter((task) => task.status === 'RUNNING' || task.status === 'PENDING').length;
    const completedTasks = taskSnapshots.filter((task) => task.status === 'COMPLETED').length;
    const openBreakers = Object.values(breakerStates)
      .filter((breaker) => String(breaker?.state ?? '').toLowerCase() === 'open')
      .length;
    const emotionHotAgents = countEmotionHotAgents(agentSnapshots);
    const complianceViolations = complianceStats.totalViolations ?? 0;
    const runtimeWorkflow = this._domains.orchestration?.getWorkflowState?.() ?? null;
    const inferredPhase = inferWorkflowPhase({
      researchCount,
      routeCount,
      implementCount,
      reviewCount,
      completedTasks,
      openBreakers,
    });
    const inferredWorkflowEvidence = {
      provenance: {
        phase: 'inferred',
        data: 'direct_runtime_telemetry',
      },
      roleCounts: {
        research: researchCount,
        route: routeCount,
        implement: implementCount,
        review: reviewCount,
      },
      taskCounts: {
        active: activeTasks,
        completed: completedTasks,
      },
      sensing: {
        activePheromoneTypes: pheromoneState.activeTypes?.length ?? 0,
        pheromoneTrails: pheromoneState.trailCount ?? 0,
        channelCount: channelState.count ?? 0,
        stigmergyEntries: stigmergyState.entryCount ?? 0,
      },
      escalation: {
        emotionHotAgents,
        complianceViolations,
        openBreakers,
      },
      adaptation: {
        mode: adaptationState.modulator?.mode ?? modulator.mode ?? 'EXPLORE',
        explorationRate: adaptationState.modulator?.explorationRate ?? modulator.explorationRate ?? 0,
        successRate: adaptationState.modulator?.successRate ?? modulator.successRate ?? 0,
      },
    };
    const phase = runtimeWorkflow?.phase ?? inferredPhase;
    const workflowPhaseId = runtimeWorkflow?.phaseId ?? null;
    const workflowEvidence = runtimeWorkflow?.evidence ?? inferredWorkflowEvidence;
    const workflowPhaseSource = runtimeWorkflow?.phaseSource ?? workflowEvidence?.provenance?.phase ?? 'inferred';
    const workflowSummary = runtimeWorkflow?.summary
      ?? `${phase}. ${agentSnapshots.length} active agent(s), ${activeTasks} live plan(s), ${completedTasks} completed, ${openBreakers} breaker(s) open.`;
    const workflowActiveRoles = runtimeWorkflow?.activeRoles ?? activeRoles;
    const workflowStageCounts = runtimeWorkflow?.stageCounts ?? {
      activeAgents: agentSnapshots.length,
      activeTasks,
      completedTasks,
      openBreakers,
    };

    const guardrailWarning = openBreakers > 0 || healthSnapshot.status === 'degraded' || healthSnapshot.status === 'unhealthy';
    const toolList = Array.isArray(bridgeStatus.tools)
      ? bridgeStatus.tools
      : this._domains.bridge?.getRegisteredTools?.()?.map?.((tool) => tool.name) ?? [];
    const moduleCount = this._collectAllModules().length;

    const stages = [
      {
        id: 'understand',
        label: 'Understand',
        ...buildStageState(
          domainStatus.intelligence,
          researchCount > 0,
          researchCount > 0
            ? `${researchCount} research-focused agent(s) reading code and memory`
            : 'Intent, memory, and role systems are online'
        ),
      },
      {
        id: 'route',
        label: 'Route',
        ...buildStageState(
          domainStatus.orchestration,
          routeCount > 0 || activeTasks > 0,
          routeCount > 0 || activeTasks > 0
            ? `${activeTasks} live workflow plan(s) in ${modulator.mode ?? 'EXPLORE'} mode`
            : 'Dual-process router and planner are ready'
        ),
      },
      {
        id: 'sense',
        label: 'Sense',
        ...buildStageState(
          domainStatus.communication,
          pheromoneState.trailCount > 0 || stigmergyState.entryCount > 0,
          pheromoneState.trailCount > 0 || stigmergyState.entryCount > 0
            ? `${pheromoneState.activeTypes?.length ?? 0} active pheromone type(s), ${stigmergyState.entryCount ?? 0} stigmergic note(s)`
            : 'Environment sensing is ready to read field, pheromone, and board state'
        ),
      },
      {
        id: 'communicate',
        label: 'Communicate',
        ...buildStageState(
          domainStatus.communication,
          pheromoneState.trailCount > 0 || channelState.count > 0,
          pheromoneState.trailCount > 0 || channelState.count > 0
            ? `${pheromoneState.trailCount} pheromone trail(s) across ${channelState.count} active channel(s)`
            : 'Field-mediated coordination is ready'
        ),
      },
      {
        id: 'implement',
        label: 'Implement',
        ...buildStageState(
          domainStatus.orchestration,
          implementCount > 0,
          implementCount > 0
            ? `${implementCount} builder/debug/test agent(s) are executing`
            : 'Execution lane is waiting for work'
        ),
      },
      {
        id: 'escalate',
        label: 'Escalate',
        ...buildStageState(
          domainStatus.quality,
          emotionHotAgents > 0 || complianceViolations > 0 || openBreakers > 0,
          emotionHotAgents > 0 || complianceViolations > 0 || openBreakers > 0
            ? `${emotionHotAgents} hot agent(s), ${complianceViolations} compliance violation(s), ${openBreakers} breaker(s) open`
            : 'Emotion escalation, compliance, and circuit breakers are calm'
        ),
      },
      {
        id: 'review',
        label: 'Review',
        ...buildStageState(
          domainStatus.quality,
          reviewCount > 0,
          reviewCount > 0
            ? `${reviewCount} reviewer agent(s) are checking output`
            : 'Quality gates are armed and ready'
        ),
      },
      {
        id: 'adapt',
        label: 'Adapt',
        ...buildStageState(
          domainStatus.orchestration,
          activeTasks > 0,
          `Mode ${modulator.mode ?? 'EXPLORE'}, success ${(modulator.successRate ?? 0).toFixed(2)}, exploration ${(modulator.explorationRate ?? 0).toFixed(2)}`
        ),
      },
      {
        id: 'synthesize',
        label: 'Synthesize',
        ...buildStageState(
          domainStatus.orchestration,
          completedTasks > 0 && researchCount === 0 && implementCount === 0 && reviewCount === 0,
          completedTasks > 0
            ? `${completedTasks} completed workflow plan(s) ready for handoff`
            : 'Result synthesis will activate after completion'
        ),
      },
      {
        id: 'guardrails',
        label: 'Guardrails',
        ...buildStageState(
          domainStatus.quality,
          false,
          guardrailWarning
            ? `${openBreakers} breaker(s) open, health is ${healthSnapshot.status}`
            : `Health ${healthSnapshot.status}, breakers closed`,
          guardrailWarning
        ),
      },
    ].map((stage) => {
      if (workflowPhaseId && stage.id === workflowPhaseId && stage.status !== 'offline') {
        return { ...stage, status: 'active' };
      }
      return stage;
    });

    return {
      architecture: {
        model: DESIGN_MODEL,
        signalDimensions: 12,
        domains: {
          active: Object.values(domainStatus).filter(Boolean).length,
          total: ARCHITECTURE_DOMAIN_IDS.length,
        },
        runtimeSubsystems: {
          active: Object.values(runtimeStatus).filter(Boolean).length,
          total: RUNTIME_DOMAIN_IDS.length,
        },
        foundation: {
          core: domainStatus.core,
          field: !!this._field,
          bus: !!this._bus,
          store: !!this._store,
        },
        domainStatus,
        runtimeStatus,
        moduleCount,
        toolCount: toolList.length,
        bridgeReady: Boolean(bridgeStatus.ready ?? domainStatus.bridge),
        missing: ARCHITECTURE_DOMAIN_IDS.filter((domainId) => !domainStatus[domainId]),
      },
      behavior: {
        sensing: {
          activePheromoneTypes: pheromoneState.activeTypes?.length ?? 0,
          pheromoneTrails: pheromoneState.trailCount ?? 0,
          stigmergyEntries: stigmergyState.entryCount ?? 0,
        },
        communication: {
          trailCount: pheromoneState.trailCount ?? 0,
          activeTypes: pheromoneState.activeTypes ?? [],
          channelCount: channelState.count ?? 0,
          stigmergyEntries: stigmergyState.entryCount ?? 0,
        },
        escalation: {
          emotionHotAgents,
          complianceViolations,
          openBreakers,
        },
        adaptation: {
          mode: adaptationState.modulator?.mode ?? modulator.mode ?? 'EXPLORE',
          successRate: adaptationState.modulator?.successRate ?? 0,
          explorationRate: adaptationState.modulator?.explorationRate ?? 0,
          speciesGeneration: adaptationState.species?.generation ?? 0,
          populationSize: adaptationState.species?.populationSize ?? 0,
          forecastHistory: adaptationState.budgetForecast?.historyCount ?? 0,
        },
        budget: {
          dagCount: budgetState.dagCount ?? 0,
          spent: budgetState.global?.spent ?? 0,
          remaining: budgetState.global?.remaining ?? 0,
          utilization: budgetState.global?.utilization ?? 0,
        },
        compliance: {
          totalViolations: complianceViolations,
          breakerOpenCount: openBreakers,
          healthStatus: healthSnapshot.status ?? 'unknown',
        },
        operator: {
          trackedSessions: notifierTelemetry.trackedSessions ?? 0,
          progressNotifications: notifierTelemetry.progress ?? 0,
          blockedNotifications: notifierTelemetry.blocked ?? 0,
          choiceNotifications: notifierTelemetry.choice ?? 0,
          completionNotifications: notifierTelemetry.complete ?? 0,
          throttledNotifications: notifierTelemetry.throttled ?? 0,
        },
        resilience: {
          validationFailures: toolResilienceTelemetry.validationFailures ?? 0,
          retryCount: toolResilienceTelemetry.retryCount ?? 0,
          successAfterRetry: toolResilienceTelemetry.successAfterRetry ?? 0,
          breakerTrips: circuitBreakerTelemetry.totalTrips ?? 0,
          openBreakers,
          pipelineBreaks: pipelineBreakerTelemetry.totalBroken ?? 0,
          classifiedFailures: failureAnalyzerTelemetry.totalClassified ?? 0,
          anomalyDetections: anomalyTelemetry.totalDetections ?? 0,
          antigenCount: vaccinationTelemetry.totalAntigens ?? 0,
          modelFallbacks: modelFallbackTelemetry.fallbacks ?? 0,
          modelFailures: modelFallbackTelemetry.failures ?? 0,
          complianceEscalations: complianceTelemetry.totalViolations ?? 0,
        },
        observability: {
          bridgeReady: Boolean(bridgeStatus.ready ?? domainStatus.bridge),
          moduleCount,
          toolCount: toolList.length,
          snapshotTs: healthSnapshot.ts ?? Date.now(),
        },
      },
      workflow: {
        phase,
        phaseSource: workflowPhaseSource,
        inferenceNotice: runtimeWorkflow
          ? null
          : 'Workflow phase is inferred from live roles, task states, and breaker conditions because this snapshot did not receive backend workflow-ledger telemetry.',
        summary: workflowSummary,
        activeRoles: workflowActiveRoles,
        stageCounts: workflowStageCounts,
        evidence: workflowEvidence,
        stages,
      },
    };
  }

  _nextSnapshotFrame(now = Date.now()) {
    this._frameId += 1;
    return {
      ts: now,
      frameId: this._frameId,
    };
  }

  _buildAdaptationSnapshot() {
    const bridgeStatus = this._domains.bridge?.getStatus?.() ?? {};
    const roleSensitivityProfiles = this._domains.intelligence?.getRoleSensitivityProfiles?.() ?? [];

    return {
      modulator: this._domains.orchestration?.getModulatorState?.() ?? {},
      calibration: this._domains.orchestration?.getCalibration?.() ?? {},
      species: this._domains.orchestration?.getSpeciesState?.() ?? {},
      budgetForecast: this._domains.orchestration?.getBudgetForecast?.() ?? {},
      dualProcess: this._domains.orchestration?.getDualProcessStats?.() ?? {},
      roleDiscovery: this._domains.orchestration?.getRoleDiscovery?.() ?? {},
      skillGovernor: this._domains.orchestration?.getSkillGovernor?.() ?? {},
      shapley: this._domains.orchestration?.getShapleyCredits?.() ?? {},
      governance: this._domains.orchestration?.getGovernanceStats?.() ?? {},
      roleSensitivity: summarizeRoleSensitivityProfiles(roleSensitivityProfiles),
      resilience: this._domains.quality?.getResilienceStats?.() ?? {},
      bridge: {
        ready: Boolean(bridgeStatus.ready ?? false),
        toolCount: Array.isArray(bridgeStatus.tools) ? bridgeStatus.tools.length : 0,
        tools: Array.isArray(bridgeStatus.tools) ? bridgeStatus.tools : [],
        hooks: bridgeStatus.hooks ?? {},
        sessionBridge: bridgeStatus.sessionBridge ?? {},
        spawnClient: bridgeStatus.spawnClient ?? {},
        modelFallback: bridgeStatus.modelFallback ?? {},
        interaction: bridgeStatus.interaction ?? {},
      },
    };
  }

  _buildSnapshot(fields, frameContext = this._nextSnapshotFrame()) {
    const now = frameContext.ts;
    const snap = {
      ts: frameContext.ts,
      frameId: frameContext.frameId,
    };

    const needsSystem = fields.includes('system');
    const agentSnapshots = fields.includes('agents') || needsSystem
      ? this._buildAgentSnapshots(now)
      : null;
    const taskSnapshots = fields.includes('tasks') || needsSystem
      ? this._buildTaskSnapshots()
      : null;
    const modeSnapshot = fields.includes('mode') || needsSystem
      ? (this._domains.orchestration?.getModulatorState?.() ?? {})
      : null;
    const healthSnapshot = fields.includes('health') || needsSystem
      ? (this._healthChecker?.getHealth?.() ?? { score: 0, status: 'unknown', ts: now })
      : null;
    const breakerSnapshot = fields.includes('breakers') || needsSystem
      ? (this._domains.quality?.getAllBreakerStates?.() ?? {})
      : null;

    if (fields.includes('agents')) {
      snap.agents = agentSnapshots;
    }

    if (fields.includes('pheromones')) {
      const pState = this._domains.communication?.getPheromoneState?.() ?? {};
      snap.pheromones = Array.isArray(pState.trails) ? pState.trails : [];
    }

    if (fields.includes('channels')) {
      const channelState = this._domains.communication?.getActiveChannels?.() ?? { count: 0, channels: [] };
      snap.channels = Array.isArray(channelState.channels) ? channelState.channels : [];
    }

    if (fields.includes('field')) {
      snap.field = this._field?.superpose?.('global') ?? {};
    }

    if (fields.includes('tasks')) {
      snap.tasks = taskSnapshots;
    }

    if (fields.includes('system')) {
      snap.system = this._buildSystemSummary({
        agents: agentSnapshots,
        tasks: taskSnapshots,
        health: healthSnapshot,
        breakers: breakerSnapshot,
        mode: modeSnapshot,
      });
    }

    if (fields.includes('mode')) {
      snap.mode = modeSnapshot?.mode ?? 'EXPLORE';
    }

    if (fields.includes('health')) {
      snap.health = healthSnapshot;
    }

    if (fields.includes('budget')) {
      snap.budget = this._domains.orchestration?.getBudget?.() ?? {
        dagCount: 0,
        dags: [],
        global: { totalSession: 0, spent: 0, remaining: 0, utilization: 0 },
      };
    }

    if (fields.includes('breakers')) {
      snap.breakers = breakerSnapshot;
    }

    if (fields.includes('metrics')) {
      snap.metrics = this._metricsCollector?.getMetrics?.() ?? {};
    }

    if (fields.includes('adaptation')) {
      snap.adaptation = this._buildAdaptationSnapshot();
    }

    return snap;
  }

  // 鈹€鈹€鈹€ Event Broadcasting 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

  _startSnapshotLoop() {
    const intervalMs = Math.round(1000 / SNAPSHOT_TICK_HZ); // ~33ms

    this._tickTimer = setInterval(() => {
      this._tickId += 1;
      if (this._clients.size === 0) return;

      const dueClients = [];

      for (const [ws, client] of this._clients) {
        if (client.snapshotHz <= 0) continue;
        if (ws.readyState !== 1) continue; // OPEN

        const frameInterval = Math.round(SNAPSHOT_TICK_HZ / client.snapshotHz);
        if ((this._tickId % frameInterval) !== 0) continue;
        dueClients.push([ws, client]);
      }

      if (dueClients.length === 0) return;

      const frameContext = this._nextSnapshotFrame();
      const cachedSnapshots = new Map();

      for (const [ws, client] of dueClients) {
        const fieldsKey = [...client.snapshotFields].sort().join(',');
        if (!cachedSnapshots.has(fieldsKey)) {
          cachedSnapshots.set(fieldsKey, this._buildSnapshot(client.snapshotFields, frameContext));
        }

        this._safeSend(ws, { type: 'snapshot', snapshot: cachedSnapshots.get(fieldsKey) });
      }
    }, intervalMs);
  }

  _broadcastEvent(envelope) {
    if (this._clients.size === 0) return;

    const topic = envelope?.topic ?? envelope?.event ?? '';
    const data = envelope?.data ?? envelope?.payload ?? envelope;
    const ts = envelope?.ts ?? Date.now();
    const source = envelope?.source ?? '';

    const msg = { type: 'event', topic, data, ts, source };

    for (const [ws, client] of this._clients) {
      if (ws.readyState !== 1) continue;
      if (!this._matchesSubscription(client, topic, data)) continue;
      this._safeSend(ws, msg);
    }
  }

  _matchesSubscription(client, topic, data) {
    const { subscriptions, scopes } = client;

    // Check topic match
    let topicMatch = false;
    for (const pattern of subscriptions) {
      if (pattern === '*') { topicMatch = true; break; }
      if (pattern === topic) { topicMatch = true; break; }
      if (pattern.endsWith('.*') && topic.startsWith(pattern.slice(0, -1))) { topicMatch = true; break; }
    }
    if (!topicMatch) return false;

    // Check scope filter
    if (scopes && scopes.length > 0) {
      const dataScope = data?.scope ?? data?.agentId ?? '';
      if (dataScope && !scopes.includes(dataScope)) return false;
    }

    return true;
  }

  // 鈹€鈹€鈹€ Utils 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

  _safeSend(ws, msg) {
    try {
      if (ws.readyState === 1) {
        ws.send(JSON.stringify(msg));
      }
    } catch { /**/ }
  }

  // 鈹€鈹€鈹€ Stats 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

  getStats() {
    return {
      port: this._port,
      clients: this._clients.size,
      frameId: this._frameId,
      running: !!this._wss,
    };
  }
}
