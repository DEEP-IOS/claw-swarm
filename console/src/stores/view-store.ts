import { create } from 'zustand';

export type ViewId = 'hive' | 'pipeline' | 'cognition' | 'ecology' | 'network'
  | 'control' | 'field' | 'system' | 'adaptation' | 'communication';

interface ViewState {
  currentView: ViewId;
  previousView: ViewId | null;
  transitioning: boolean;
  setView: (v: ViewId) => void;
  setTransitioning: (v: boolean) => void;
}

export const useViewStore = create<ViewState>((set) => ({
  currentView: 'hive',
  previousView: null,
  transitioning: false,
  setView: (view) => set((s) => ({
    previousView: s.currentView,
    currentView: view,
    transitioning: true,
  })),
  setTransitioning: (transitioning) => set({ transitioning }),
}));
