import { create } from 'zustand';

interface MetricsSnapshot {
  agents: { spawned: number; completed: number; failed: number; active: number };
  tasks: { created: number; completed: number; failed: number; inProgress: number };
  signals: { emitted: number; currentCount: number };
  quality: { gateEvaluations: number; toolFailures: number; breakerTrips: number; violations: number };
  budget: { totalTokens: number; totalCost: number };
  [key: string]: unknown;
}

interface HealthSnapshot {
  status: string;
  score: number;
  dimensions: Record<string, { value: number; threshold: number; score: number; ok: boolean }>;
  ts: number;
}

interface MetricsState {
  metrics: MetricsSnapshot | null;
  health: HealthSnapshot | null;
  metricsHistory: Array<{ ts: number; metrics: MetricsSnapshot }>;
  updateMetrics: (m: MetricsSnapshot) => void;
  updateHealth: (h: HealthSnapshot) => void;
}

const MAX_HISTORY = 120;

export const useMetricsStore = create<MetricsState>((set) => ({
  metrics: null,
  health: null,
  metricsHistory: [],
  updateMetrics: (metrics) => set((s) => ({
    metrics,
    metricsHistory: [...s.metricsHistory.slice(-(MAX_HISTORY - 1)), { ts: Date.now(), metrics }],
  })),
  updateHealth: (health) => set({ health }),
}));
