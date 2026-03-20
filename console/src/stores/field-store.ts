import { create } from 'zustand';

export interface FieldVector {
  [dim: string]: number;
}

interface FieldState {
  vector: FieldVector;
  vectorHistory: Array<{ ts: number; vector: FieldVector }>;
  stats: Record<string, unknown>;
  weights: Record<string, number>;
  updateVector: (v: FieldVector) => void;
  updateStats: (s: Record<string, unknown>) => void;
  updateWeights: (w: Record<string, number>) => void;
}

const MAX_HISTORY = 200;

export const useFieldStore = create<FieldState>((set) => ({
  vector: {},
  vectorHistory: [],
  stats: {},
  weights: {},
  updateVector: (v) => set((s) => ({
    vector: v,
    vectorHistory: [...s.vectorHistory.slice(-(MAX_HISTORY - 1)), { ts: Date.now(), vector: v }],
  })),
  updateStats: (stats) => set({ stats }),
  updateWeights: (weights) => set({ weights }),
}));
