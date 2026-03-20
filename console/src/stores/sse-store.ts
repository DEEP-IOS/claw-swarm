import { create } from 'zustand';

interface SSEState {
  connected: boolean;
  eventCount: number;
  lastEventAt: number;
  reconnectCount: number;
  setConnected: (v: boolean) => void;
  increment: () => void;
}

export const useSSEStore = create<SSEState>((set) => ({
  connected: false,
  eventCount: 0,
  lastEventAt: 0,
  reconnectCount: 0,
  setConnected: (connected) => set((s) => ({
    connected,
    reconnectCount: connected ? s.reconnectCount : s.reconnectCount + 1,
  })),
  increment: () => set((s) => ({
    eventCount: s.eventCount + 1,
    lastEventAt: Date.now(),
  })),
}));
