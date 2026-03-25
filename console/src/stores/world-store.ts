import { create } from 'zustand';
import type { WorldSnapshot } from '../api/ws-bridge';

// ── Agent lifecycle events ──────────────────────────────────────────────────

export interface AgentEvent {
  type: 'spawned' | 'departed';
  agentId: string;
  role: string;
  parentId?: string | null;
  ts: number;
}

type AgentEventListener = (event: AgentEvent) => void;

const agentEventListeners = new Set<AgentEventListener>();

export function onAgentEvent(listener: AgentEventListener): () => void {
  agentEventListeners.add(listener);
  return () => agentEventListeners.delete(listener);
}

function emitAgentEvent(event: AgentEvent) {
  for (const fn of agentEventListeners) fn(event);
}

// ── Store ───────────────────────────────────────────────────────────────────

interface WorldState {
  snapshot: WorldSnapshot | null;
  history: Array<{ ts: number; snapshot: WorldSnapshot }>;
  connected: boolean;
  frameId: number;
  /** IDs present in the last snapshot (for diff detection) */
  prevAgentIds: Set<string>;
  /** Recent agent events (last 50) */
  agentEvents: AgentEvent[];
  updateSnapshot: (snap: WorldSnapshot) => void;
  setConnected: (v: boolean) => void;
}

const MAX_HISTORY = 200;
const MAX_EVENTS = 50;

export const useWorldStore = create<WorldState>((set, get) => ({
  snapshot: null,
  history: [],
  connected: false,
  frameId: 0,
  prevAgentIds: new Set<string>(),
  agentEvents: [],

  updateSnapshot: (snap) => {
    const state = get();
    const prevIds = state.prevAgentIds;
    const currentAgents = snap.agents ?? [];
    const currentIds = new Set(currentAgents.map(a => a.id));
    const now = Date.now();

    // Detect spawned agents
    const newEvents: AgentEvent[] = [];
    for (const agent of currentAgents) {
      if (!prevIds.has(agent.id)) {
        const evt: AgentEvent = {
          type: 'spawned',
          agentId: agent.id,
          role: agent.role ?? 'implementer',
          parentId: agent.parentId,
          ts: now,
        };
        newEvents.push(evt);
        emitAgentEvent(evt);
      }
    }

    // Detect departed agents
    for (const prevId of prevIds) {
      if (!currentIds.has(prevId)) {
        const evt: AgentEvent = {
          type: 'departed',
          agentId: prevId,
          role: 'unknown',
          ts: now,
        };
        newEvents.push(evt);
        emitAgentEvent(evt);
      }
    }

    set({
      snapshot: snap,
      frameId: snap.frameId,
      prevAgentIds: currentIds,
      history: [...state.history.slice(-(MAX_HISTORY - 1)), { ts: snap.ts, snapshot: snap }],
      agentEvents: [...state.agentEvents, ...newEvents].slice(-MAX_EVENTS),
    });
  },

  setConnected: (connected) => set({ connected }),
}));
