/**
 * Interaction Store - UI interaction state (hover, selection, depth, inspector)
 *
 * Manages the 3-depth UI model:
 *   Depth 1: World overview (default)
 *   Depth 2: Detail inspector panel (click agent)
 *   Depth 3: Deep data overlay (double-click radar, shift+click compare)
 */

import { create } from 'zustand';

export interface InteractionState {
  uiDepth: 1 | 2 | 3;
  selectedAgentId: string | null;
  hoveredAgentId: string | null;
  compareAgentId: string | null;
  inspectorOpen: boolean;
  selectAgent: (id: string | null) => void;
  hoverAgent: (id: string | null) => void;
  closeInspector: () => void;
  closeDeepPanel: () => void;
  setUiDepth: (depth: 1 | 2 | 3) => void;
  toggleCompare: (id: string) => void;
}

export const useInteractionStore = create<InteractionState>((set, get) => ({
  uiDepth: 1,
  selectedAgentId: null,
  hoveredAgentId: null,
  compareAgentId: null,
  inspectorOpen: false,

  selectAgent: (id) => {
    if (id === null) {
      set({ selectedAgentId: null, inspectorOpen: false, uiDepth: 1, compareAgentId: null });
      return;
    }

    set({ selectedAgentId: id, inspectorOpen: true, uiDepth: 2, compareAgentId: null });
  },

  hoverAgent: (id) => set({ hoveredAgentId: id }),

  closeInspector: () =>
    set({
      selectedAgentId: null,
      inspectorOpen: false,
      uiDepth: 1,
      compareAgentId: null,
    }),

  closeDeepPanel: () =>
    set((state) => ({
      uiDepth: state.selectedAgentId ? 2 : 1,
      compareAgentId: null,
    })),

  setUiDepth: (uiDepth) => set({ uiDepth }),

  toggleCompare: (id) => {
    const state = get();

    if (state.compareAgentId === id) {
      set({ compareAgentId: null, uiDepth: 2 });
      return;
    }

    if (state.selectedAgentId && id !== state.selectedAgentId) {
      set({ compareAgentId: id, uiDepth: 3 });
    }
  },
}));
