/**
 * core.js — Dashboard SSE + Data Bus + Shared Utilities
 * 仪表盘 SSE + 数据总线 + 共享工具函数
 * V7.0 modular dashboard core / 模块化仪表盘核心
 */

// ═══ Constants / 常量 ═══
export const TWO_PI = Math.PI * 2;
export const PERSONA_COLORS = {
  'scout-bee': '#3B82F6', 'worker-bee': '#10B981', 'guard-bee': '#EF4444',
  'queen-messenger': '#8B5CF6', 'default': '#F5A623',
};
export const PERSONA_ICONS = {
  'scout-bee': '\uD83D\uDD2D', 'worker-bee': '\u2699\uFE0F',
  'guard-bee': '\uD83D\uDEE1\uFE0F', 'queen-messenger': '\uD83D\uDC51', 'default': '\uD83D\uDC1D',
};
export const PHEROMONE_COLORS = {
  trail: '#F5A623', alarm: '#EF4444', recruit: '#3B82F6',
  territory: '#8B5CF6', queen: '#8B5CF6', dance: '#10B981',
};

// ═══ Utility Functions ═══
export const $ = s => document.querySelector(s);
export const $$ = s => document.querySelectorAll(s);
export function lerp(a, b, t) { return a + (b - a) * t; }
export function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
export function hexToRgba(hex, a) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${a})`;
}
export function shortId(id) {
  if (!id) return '?';
  return id.length > 16 ? id.slice(0, 14) + '\u2026' : id;
}
export function fmtTime(ts) {
  const d = ts ? new Date(ts) : new Date();
  return d.toTimeString().slice(0, 8);
}
export function fmtDuration(ms) {
  if (!ms && ms !== 0) return '--';
  if (ms < 1000) return ms + 'ms';
  return (ms / 1000).toFixed(1) + 's';
}
export function fmtPct(v) { return (v * 100).toFixed(1) + '%'; }
export function personaColor(p) { return PERSONA_COLORS[p] || PERSONA_COLORS['default']; }
export function personaIcon(p) { return PERSONA_ICONS[p] || PERSONA_ICONS['default']; }

// ═══ Data Bus (Simple Event Emitter) ═══
class DataBus {
  constructor() { this._listeners = new Map(); }

  on(topic, fn) {
    if (!this._listeners.has(topic)) this._listeners.set(topic, new Set());
    this._listeners.get(topic).add(fn);
    return () => this._listeners.get(topic)?.delete(fn);
  }

  emit(topic, data) {
    // Exact match
    const exact = this._listeners.get(topic);
    if (exact) for (const fn of exact) { try { fn(data); } catch (e) { console.error(e); } }

    // Wildcard match: 'agent.*' matches 'agent.registered'
    for (const [pattern, fns] of this._listeners) {
      if (pattern.endsWith('.*')) {
        const prefix = pattern.slice(0, -1);
        if (topic.startsWith(prefix) && topic !== pattern) {
          for (const fn of fns) { try { fn(data, topic); } catch (e) { console.error(e); } }
        }
      }
    }
  }
}

export const dataBus = new DataBus();

// ═══ Global State ═══
export const state = {
  agents: new Map(),
  tasks: new Map(),
  recentTasks: [],
  pheromonesByType: { trail: 0, alarm: 0, recruit: 0, territory: 0, dance: 0 },
  swarm: { tasksCompleted: 0, tasksFailed: 0, pheromoneEvents: 0, memoryEvents: 0 },
  red: { rate: 0, errorRate: 0, avgDuration: 0 },
  activeView: 'hive',
  selectedAgentId: null,
  selectedTaskId: null,
  logEntries: [],
  logCollapsed: false,
  sseConnected: false,
  sseRetryDelay: 1000,
  // V5.5
  breakerStatus: {},
  governance: null,
  modulatorMode: 'RELIABLE',
  convergence: null,
  // V6.0
  v6: {
    workerPool: null,
    sna: null,
    shapley: null,
    dualProcess: null,
    failureModes: null,
    budgetForecast: null,
    qualityAudit: null,
    agentStates: null,
    vectorStats: null,
    ipcStats: null,
    traceAnalysis: null,
  },
};

// ═══ SSE Connection ═══
let evtSource = null;
const SSE_MAX_DELAY = 30000;

export function connectSSE(basePath) {
  if (evtSource) { evtSource.close(); evtSource = null; }

  setConnectionState('connecting');
  evtSource = new EventSource((basePath || '') + '/events');

  evtSource.onopen = () => {
    state.sseConnected = true;
    state.sseRetryDelay = 1000;
    setConnectionState('live');
  };

  evtSource.onerror = () => {
    state.sseConnected = false;
    setConnectionState('offline');
    evtSource.close();
    evtSource = null;
    setTimeout(() => connectSSE(basePath), state.sseRetryDelay);
    state.sseRetryDelay = Math.min(state.sseRetryDelay * 2, SSE_MAX_DELAY);
  };

  evtSource.onmessage = (e) => {
    try {
      const msg = JSON.parse(e.data);
      if (msg.topic === 'batch' && Array.isArray(msg.data)) {
        for (const evt of msg.data) {
          dataBus.emit(evt.event || evt.topic || 'unknown', evt.data || evt);
        }
      } else {
        dataBus.emit(msg.topic || '', msg.data || msg);
      }
    } catch (_) {}
  };
}

function setConnectionState(s) {
  const badge = $('#connBadge');
  const text = $('#connText');
  if (!badge || !text) return;
  badge.className = 'conn-badge conn-' + s;
  text.textContent = s === 'live' ? 'LIVE' : s === 'offline' ? 'OFFLINE' : 'CONNECTING';
}

// ═══ REST Fetcher ═══
export async function fetchAPI(path) {
  try {
    const resp = await fetch(path);
    if (!resp.ok) return null;
    return await resp.json();
  } catch { return null; }
}

// ═══ Metrics Polling ═══
let pollTimer = null;

export function startMetricsPolling(basePath, intervalMs = 5000) {
  async function poll() {
    const data = await fetchAPI((basePath || '') + '/api/metrics');
    if (data) dataBus.emit('metrics.snapshot', data);
  }
  poll();
  pollTimer = setInterval(poll, intervalMs);
}

export function stopMetricsPolling() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
}
