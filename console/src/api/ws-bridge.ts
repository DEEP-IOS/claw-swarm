/**
 * WSBridge — WebSocket bidirectional client for ConsoleDataBridge
 * Replaces SSE for 3D Console with snapshot push + RPC + event subscription
 */

import { nanoid } from 'nanoid';

type EventHandler = (data: unknown, topic: string) => void;

interface PendingRPC {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export interface WorldSnapshot {
  ts: number;
  frameId: number;
  agents: AgentSnapshot[];
  pheromones: PheromoneSnapshot[];
  channels?: ChannelSnapshot[];
  field: Record<string, number>;
  tasks: TaskSnapshot[];
  system?: SystemSnapshot;
  adaptation?: AdaptationSnapshot;
  mode: string;
  health: HealthSnapshot;
  budget: BudgetSnapshot;
  breakers: Record<string, { state: string; failures: number; lastAt: number }>;
  metrics?: MetricsSnapshot;
}

export interface AgentSnapshot {
  id: string;
  role: string;
  state: string;
  parentId: string | null;
  taskId: string | null;
  sessionId: string;
  spawnedAt: number;
  soul: string | null;
  emotion: {
    frustration: number; confidence: number; joy: number;
    urgency: number; curiosity: number; fatigue: number;
  };
  reputation: number;
  capabilities: number[];
  abc: string;
}

export interface PheromoneSnapshot {
  id: string;
  type: string;
  canonicalType?: string;
  scope: string;
  intensity: number;
  emitterId: string;
  depositedAt: number;
  metadata?: Record<string, unknown>;
  position?: { x: number; y: number; z: number };
}

export interface ChannelSnapshot {
  channelId: string;
  memberCount: number;
  messageCount: number;
  createdAt?: number;
  closedAt?: number | null;
  closed?: boolean;
  members?: Array<string | { agentId?: string; id?: string; role?: string }>;
  recentMessages?: Array<{ type?: string; data?: Record<string, unknown> }>;
}

export interface TaskSnapshot {
  id: string;
  name: string;
  status: string;
  assigneeId: string | null;
  priority: number;
  dependencies: string[];
  dagId: string;
  createdAt: number;
  summary?: string;
  role?: string | null;
  nodeCounts?: {
    pending: number;
    running: number;
    completed: number;
    failed: number;
  };
}

export interface SystemSnapshot {
  architecture: {
    model: string;
    signalDimensions: number;
    domains: { active: number; total: number };
    runtimeSubsystems: { active: number; total: number };
    foundation: { core: boolean; field: boolean; bus: boolean; store: boolean };
    domainStatus: Record<string, boolean>;
    runtimeStatus: Record<string, boolean>;
    moduleCount: number;
    toolCount: number;
    bridgeReady: boolean;
    missing: string[];
  };
  workflow: {
    phase: string;
    phaseSource?: string;
    inferenceNotice?: string;
    summary: string;
    activeRoles: Record<string, number>;
    stageCounts: {
      activeAgents: number;
      activeTasks: number;
      completedTasks: number;
      openBreakers: number;
    };
    evidence?: {
      provenance?: {
        phase?: string;
        data?: string;
      };
      roleCounts?: {
        research?: number;
        route?: number;
        implement?: number;
        review?: number;
      };
      taskCounts?: {
        active?: number;
        completed?: number;
      };
      sensing?: {
        activePheromoneTypes?: number;
        pheromoneTrails?: number;
        channelCount?: number;
        stigmergyEntries?: number;
      };
      escalation?: {
        emotionHotAgents?: number;
        complianceViolations?: number;
        openBreakers?: number;
      };
      adaptation?: {
        mode?: string;
        explorationRate?: number;
        successRate?: number;
      };
    };
    stages: Array<{
      id: string;
      label: string;
      status: 'active' | 'ready' | 'offline' | 'warning';
      detail: string;
    }>;
  };
  behavior?: {
    sensing: {
      activePheromoneTypes: number;
      pheromoneTrails: number;
      stigmergyEntries: number;
    };
    communication: {
      trailCount: number;
      activeTypes: string[];
      channelCount: number;
      stigmergyEntries: number;
    };
    escalation: {
      emotionHotAgents: number;
      complianceViolations: number;
      openBreakers: number;
    };
    adaptation: {
      mode: string;
      successRate: number;
      explorationRate: number;
      speciesGeneration: number;
      populationSize: number;
      forecastHistory: number;
    };
    budget: {
      dagCount: number;
      spent: number;
      remaining: number;
      utilization: number;
    };
    compliance: {
      totalViolations: number;
      breakerOpenCount: number;
      healthStatus: string;
    };
    operator?: {
      trackedSessions: number;
      progressNotifications: number;
      blockedNotifications: number;
      choiceNotifications: number;
      completionNotifications: number;
      throttledNotifications: number;
    };
    resilience?: {
      validationFailures: number;
      retryCount: number;
      successAfterRetry: number;
      breakerTrips: number;
      openBreakers: number;
      pipelineBreaks: number;
      classifiedFailures: number;
      anomalyDetections: number;
      antigenCount: number;
      modelFallbacks: number;
      modelFailures: number;
      complianceEscalations: number;
    };
    observability: {
      bridgeReady: boolean;
      moduleCount: number;
      toolCount: number;
      snapshotTs: number;
    };
  };
}

export interface HealthSnapshot {
  score: number;
  status: string;
  ts: number;
  dimensions?: Record<string, {
    value?: number;
    threshold?: number;
    score: number;
    ok: boolean;
  }>;
}

export interface BudgetSnapshot {
  dagCount: number;
  dags: Array<{
    dagId: string;
    totalBudget: number;
    spent: number;
    remaining: number;
    utilization: number;
    overrun: boolean;
    timestamp: number;
  }>;
  global: {
    totalSession: number;
    spent: number;
    remaining: number;
    utilization: number;
  };
}

export interface AdaptationSnapshot {
  modulator: {
    mode?: string;
    explorationRate?: number;
    successRate?: number;
    modeChanges?: number;
    historySize?: number;
  };
  calibration: Record<string, number>;
  species: {
    generation?: number;
    completedDAGs?: number;
    populationSize?: number;
    population?: Array<{
      id: string;
      roleId: string;
      preferredModel?: string;
      fitness: number;
      generation?: number;
      taskCount?: number;
    }>;
  };
  budgetForecast: {
    historyCount?: number;
    lastRecordedAt?: number | null;
    accuracy?: {
      meanAbsoluteError?: number;
      r2Score?: number;
    };
    byTaskType?: Record<string, number>;
  };
  dualProcess?: {
    system1Count?: number;
    system2Count?: number;
    threshold?: number;
    overrideCount?: number;
  };
  roleDiscovery?: {
    pendingCount?: number;
    discoveries?: Array<{
      name?: string;
      confidence?: number;
      observations?: number;
      tools?: string[];
    }>;
  };
  skillGovernor?: {
    roleCount?: number;
    totalSkills?: number;
    perRole?: Record<string, number>;
    topSkills?: Array<{
      roleId: string;
      skillName: string;
      masteryLevel: number;
      usageCount: number;
    }>;
  };
  shapley?: {
    dagCount?: number;
    leaderboard?: Array<{
      agentId: string;
      totalValue: number;
    }>;
    dags?: Record<string, Record<string, number>>;
  };
  governance?: {
    contractNet?: Record<string, unknown>;
    resourceArbiter?: Record<string, unknown>;
    deadlines?: Record<string, unknown>;
    roleManager?: Record<string, unknown>;
  };
  roleSensitivity?: {
    profileCount?: number;
    profiles?: Array<{
      roleId: string;
      name: string;
      preferredModel?: string;
      toolCount?: number;
      sensitivity?: Record<string, number>;
      topDimensions?: Array<{
        dimension: string;
        value: number;
      }>;
    }>;
  };
  resilience?: {
    toolResilience?: Record<string, number>;
    circuitBreaker?: Record<string, unknown>;
    pipelineBreaker?: Record<string, number>;
    failureVaccination?: Record<string, unknown>;
    failureAnalyzer?: Record<string, unknown>;
    anomalyDetector?: Record<string, unknown>;
    complianceMonitor?: Record<string, unknown>;
    evidenceGate?: Record<string, unknown>;
    qualityController?: Record<string, unknown>;
  };
  bridge?: {
    ready?: boolean;
    toolCount?: number;
    tools?: string[];
    hooks?: Record<string, unknown>;
    sessionBridge?: Record<string, unknown>;
    spawnClient?: Record<string, unknown>;
    modelFallback?: Record<string, unknown>;
    interaction?: {
      progress?: Record<string, number>;
      notifier?: Record<string, number>;
      failures?: Record<string, number>;
    };
  };
}

export interface MetricsSnapshot {
  agents?: { active?: number; completed?: number; failed?: number };
  tasks?: { created?: number; completed?: number; failed?: number; inProgress?: number };
  quality?: {
    gateEvaluations?: number;
    gatePassRate?: number;
    gatePassed?: number;
    breakerTrips?: number;
    anomalies?: number;
    violations?: number;
    pipelineBreaks?: number;
  };
  channels?: { created?: number; messages?: number; active?: number };
  errors?: { total?: number; byClass?: Record<string, number> };
}

function getDefaultBridgeUrl() {
  const explicitUrl = typeof window !== 'undefined'
    ? new URLSearchParams(window.location.search).get('ws')
    : null;

  if (explicitUrl) {
    return explicitUrl;
  }

  if (typeof window === 'undefined') {
    return 'ws://127.0.0.1:19101';
  }

  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
  const host = window.location.hostname || '127.0.0.1';
  return `${protocol}://${host}:19101`;
}

class WSBridge {
  private ws: WebSocket | null = null;
  private pendingRPC = new Map<string, PendingRPC>();
  private eventHandlers = new Map<string, Set<EventHandler>>();
  private snapshotHandler: ((snap: WorldSnapshot) => void) | null = null;
  private reconnectDelay = 1000;
  private maxReconnectDelay = 30000;
  private url = '';
  private _connected = false;
  private _subscriptions: string[] = ['*'];
  private _scopes: string[] | null = null;
  private _snapshotHz = 5;
  private _snapshotFields: string[] = [];
  private _onStatusChange?: (c: boolean) => void;
  private _reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private _intentionalClose = false;

  get connected() { return this._connected; }

  connect(url = getDefaultBridgeUrl(), onStatusChange?: (c: boolean) => void) {
    this.url = url;
    this._onStatusChange = onStatusChange;
    this._intentionalClose = false;
    this._doConnect();
  }

  private _doConnect() {
    try {
      this.ws = new WebSocket(this.url);

      this.ws.onopen = () => {
        this._connected = true;
        this.reconnectDelay = 1000;
        this._onStatusChange?.(true);

        // Re-subscribe after reconnect
        if (this._subscriptions.length > 0) {
          this._send({ id: nanoid(8), type: 'subscribe', topics: this._subscriptions, scopes: this._scopes });
        }
        if (this._snapshotHz > 0 || this._snapshotFields.length > 0) {
          this._send({ id: nanoid(8), type: 'configure', snapshotHz: this._snapshotHz, snapshotFields: this._snapshotFields.length > 0 ? this._snapshotFields : undefined });
        }
      };

      this.ws.onmessage = (e) => this._onMessage(e);

      this.ws.onerror = () => {};

      this.ws.onclose = () => {
        this._connected = false;
        this._onStatusChange?.(false);
        this.ws = null;

        if (!this._intentionalClose) {
          this._reconnectTimer = setTimeout(() => {
            this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay);
            this._doConnect();
          }, this.reconnectDelay);
        }
      };
    } catch {
      // Connection failed, retry
      if (!this._intentionalClose) {
        this._reconnectTimer = setTimeout(() => this._doConnect(), this.reconnectDelay);
      }
    }
  }

  subscribe(topics: string[], scopes?: string[]) {
    this._subscriptions = topics;
    this._scopes = scopes ?? null;
    this._send({ id: nanoid(8), type: 'subscribe', topics, scopes });
  }

  async rpc<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T> {
    const id = nanoid(8);
    const timeout = method === 'tool.execute' ? 30000 : 10000;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRPC.delete(id);
        reject(new Error(`RPC timeout: ${method}`));
      }, timeout);
      this.pendingRPC.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
      this._send({ id, type: 'rpc', method, params });
    });
  }

  configure(snapshotHz: number, snapshotFields?: string[]) {
    this._snapshotHz = snapshotHz;
    if (snapshotFields) this._snapshotFields = snapshotFields;
    this._send({ id: nanoid(8), type: 'configure', snapshotHz, snapshotFields });
  }

  onSnapshot(handler: (snap: WorldSnapshot) => void) {
    this.snapshotHandler = handler;
  }

  onEvent(pattern: string, handler: EventHandler): () => void {
    if (!this.eventHandlers.has(pattern)) this.eventHandlers.set(pattern, new Set());
    this.eventHandlers.get(pattern)!.add(handler);
    return () => { this.eventHandlers.get(pattern)?.delete(handler); };
  }

  disconnect() {
    this._intentionalClose = true;
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
    this.ws?.close();
    this.ws = null;
    this._connected = false;
  }

  private _send(msg: Record<string, unknown>) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  private _onMessage(e: MessageEvent) {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(e.data as string);
    } catch { return; }

    switch (msg.type) {
      case 'snapshot':
        this.snapshotHandler?.(msg.snapshot as WorldSnapshot);
        break;

      case 'event':
        this._dispatchEvent(msg.topic as string, msg.data);
        break;

      case 'rpc_result': {
        const pending = this.pendingRPC.get(msg.id as string);
        if (pending) {
          clearTimeout(pending.timer);
          pending.resolve(msg.result);
          this.pendingRPC.delete(msg.id as string);
        }
        break;
      }

      case 'error': {
        const errPending = this.pendingRPC.get(msg.id as string);
        if (errPending) {
          clearTimeout(errPending.timer);
          errPending.reject(new Error(msg.error as string));
          this.pendingRPC.delete(msg.id as string);
        }
        break;
      }
    }
  }

  private _dispatchEvent(topic: string, data: unknown) {
    for (const [pattern, handlers] of this.eventHandlers) {
      if (pattern === '*' || pattern === topic || (pattern.endsWith('.*') && topic.startsWith(pattern.slice(0, -1)))) {
        for (const h of handlers) {
          try { h(data, topic); } catch { /**/ }
        }
      }
    }
  }
}

export const wsBridge = new WSBridge();
