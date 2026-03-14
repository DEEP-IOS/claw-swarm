/**
 * Pheromone Slice / 信息素切片
 *
 * 管理 7 种信息素浓度和方向性轨迹。
 * Manages 7 pheromone concentrations and directional trails.
 *
 * @module store/slices/pheromone-slice
 * @author DEEP-IOS
 */

/**
 * @param {Function} set - Zustand set
 * @param {Function} get - Zustand get
 * @returns {Object} Pheromone slice
 */
export const createPheromoneSlice = (set, get) => ({
  // ── 7 种信息素浓度 / 7 Pheromone Concentrations ──
  pheromones: {
    trail: 0, alarm: 0, recruit: 0,
    dance: 0, queen: 0, food: 0, danger: 0,
  },

  // ── 方向性轨迹 / Directional Trails ──
  // [{ agentId, points: [{x,y}], intensity, color }]
  trails: [],

  // ── 更新信息素浓度 / Update pheromone concentrations ──
  updatePheromones: (pheromones) => set({ pheromones }),

  // ── 更新单个信息素 / Update single pheromone ──
  updatePheromone: (type, intensity) => set((s) => ({
    pheromones: { ...s.pheromones, [type]: Math.max(0, Math.min(1, intensity)) },
  })),

  // ── 更新轨迹 / Update trails ──
  updateTrails: (trails) => set({ trails }),

  // ── 添加轨迹点 / Add trail point ──
  addTrailPoint: (agentId, point) => set((s) => {
    const existing = s.trails.find((t) => t.agentId === agentId);
    if (existing) {
      // 保留最近 60 帧 / Keep last 60 frames
      const pts = [...existing.points, point].slice(-60);
      return {
        trails: s.trails.map((t) =>
          t.agentId === agentId ? { ...t, points: pts } : t,
        ),
      };
    }
    return {
      trails: [...s.trails, { agentId, points: [point], intensity: 1.0 }],
    };
  }),
});
