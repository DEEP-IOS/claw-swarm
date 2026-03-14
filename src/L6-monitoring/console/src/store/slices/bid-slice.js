/**
 * Bid Slice / 竞标切片
 *
 * 管理 ContractNet 竞标历史和推测执行状态。
 * Manages ContractNet bid history and speculative execution state.
 *
 * @module store/slices/bid-slice
 * @author DEEP-IOS
 */

/**
 * @param {Function} set - Zustand set
 * @param {Function} get - Zustand get
 * @returns {Object} Bid slice
 */
export const createBidSlice = (set, get) => ({
  // ── 竞标历史 / Bid History ──
  // [{ agent, model, bid, awarded, task, ts }]
  bidHistory: [],

  // ── 推测执行 / Speculative Execution ──
  // [{ id, parentTask, status, startedAt, ts }]
  speculations: [],

  // ── 更新竞标历史 / Update bid history ──
  updateBidHistory: (bidHistory) => set({ bidHistory }),

  // ── 添加竞标记录 / Add bid record ──
  addBid: (bid) => set((s) => ({
    bidHistory: [
      { ts: Date.now(), ...bid },
      ...s.bidHistory,
    ].slice(0, 200), // 保留最近 200 条
  })),

  // ── 更新推测执行 / Update speculations ──
  updateSpeculations: (speculations) => set({ speculations }),

  // ── 添加推测 / Add speculation ──
  // V7.2 P5.3: 限制 speculations 上限 100 条 / Cap speculations at 100
  addSpeculation: (spec) => set((s) => ({
    speculations: [...s.speculations, { ts: Date.now(), ...spec }].slice(-100),
  })),

  // ── 更新推测状态 / Update speculation status ──
  updateSpeculationStatus: (specId, status) => set((s) => ({
    speculations: s.speculations.map((sp) =>
      sp.id === specId ? { ...sp, status } : sp,
    ),
  })),

  // ── 移除推测 / Remove speculation ──
  removeSpeculation: (specId) => set((s) => ({
    speculations: s.speculations.filter((sp) => sp.id !== specId),
  })),
});
