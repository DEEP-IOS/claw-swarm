import { create } from 'zustand';

export interface AgentInfo {
  id: string;
  role: string;
  status: string;
  sessionId?: string;
  spawnedAt?: number;
}

interface AgentState {
  agents: AgentInfo[];
  emotions: Record<string, Record<string, number>>;
  reputation: Record<string, number>;
  events: Array<{ ts: number; topic: string; agentId: string; data?: unknown }>;
  addAgent: (a: AgentInfo) => void;
  removeAgent: (id: string) => void;
  setAgents: (a: AgentInfo[]) => void;
  pushEvent: (topic: string, agentId: string, data?: unknown) => void;
  setEmotions: (e: Record<string, Record<string, number>>) => void;
  setReputation: (r: Record<string, number>) => void;
}

const MAX_EVENTS = 100;

export const useAgentStore = create<AgentState>((set) => ({
  agents: [],
  emotions: {},
  reputation: {},
  events: [],
  addAgent: (a) => set((s) => ({ agents: [...s.agents, a] })),
  removeAgent: (id) => set((s) => ({ agents: s.agents.filter(x => x.id !== id) })),
  setAgents: (agents) => set({ agents }),
  pushEvent: (topic, agentId, data) => set((s) => ({
    events: [...s.events.slice(-(MAX_EVENTS - 1)), { ts: Date.now(), topic, agentId, data }],
  })),
  setEmotions: (emotions) => set({ emotions }),
  setReputation: (reputation) => set({ reputation }),
}));
