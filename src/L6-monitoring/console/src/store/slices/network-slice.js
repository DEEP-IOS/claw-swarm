/**
 * Network Slice / 网络切片
 *
 * 管理网络拓扑边和知识转移记录。
 * Manages network topology edges and knowledge transfer records.
 *
 * @module store/slices/network-slice
 * @author DEEP-IOS
 */

/**
 * @param {Function} set - Zustand set
 * @param {Function} get - Zustand get
 * @returns {Object} Network slice
 */
export const createNetworkSlice = (set, get) => ({
  // ── 网络边 / Network Edges ──
  // [{ source, target, weight, type }]
  edges: [],

  // ── 知识转移记录 / Knowledge Transfer Records ──
  // [{ from, to, content, ts }]
  knowledge: [],

  // ── 更新边 / Update edges ──
  updateEdges: (edges) => set({ edges }),

  // ── 添加/更新单条边 / Add or update single edge ──
  upsertEdge: (edge) => set((s) => {
    const idx = s.edges.findIndex(
      (e) => e.source === edge.source && e.target === edge.target,
    );
    if (idx >= 0) {
      const updated = [...s.edges];
      updated[idx] = { ...updated[idx], ...edge };
      return { edges: updated };
    }
    return { edges: [...s.edges, edge] };
  }),

  // ── 添加知识转移 / Add knowledge transfer ──
  addKnowledgeTransfer: (transfer) => set((s) => ({
    knowledge: [
      { ts: Date.now(), ...transfer },
      ...s.knowledge,
    ].slice(0, 100), // 保留最近 100 条
  })),
});
