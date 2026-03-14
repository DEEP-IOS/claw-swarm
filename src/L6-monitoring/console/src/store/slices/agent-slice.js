/**
 * Agent Slice / Agent 切片
 *
 * 管理蜂群 Agent 和子代理状态。
 * Manages swarm Agent and sub-agent state.
 *
 * @module store/slices/agent-slice
 * @author DEEP-IOS
 */

/**
 * @param {Function} set - Zustand set
 * @param {Function} get - Zustand get
 * @returns {Object} Agent slice
 */
export const createAgentSlice = (set, get) => ({
  // ── Agent 列表 / Agent List ──
  agents: [],
  subAgents: [],

  // ── 更新全部 Agent / Update all agents ──
  updateAgents: (agents) => set({
    agents: Array.isArray(agents)
      ? agents
      : (agents && typeof agents === 'object' ? Object.values(agents) : []),
  }),

  // ── 更新单个 Agent (合并) / Update single agent (merge) ──
  updateAgent: (agentId, patch) => set((s) => ({
    agents: s.agents.map((a) =>
      a.id === agentId ? { ...a, ...patch } : a,
    ),
  })),

  // ── 添加子代理 (V7.2: 去重) / Add sub-agent (V7.2: deduplicate) ──
  addSubAgent: (sub) => set((s) => {
    const exists = s.subAgents.findIndex(a => a.id === sub.id);
    if (exists >= 0) {
      // 已存在 → 更新 / Exists → update
      const updated = [...s.subAgents];
      updated[exists] = { ...updated[exists], ...sub };
      return { subAgents: updated };
    }
    return { subAgents: [...s.subAgents, sub] };
  }),

  // ── 移除子代理 / Remove sub-agent ──
  removeSubAgent: (subId) => set((s) => ({
    subAgents: s.subAgents.filter((a) => a.id !== subId),
  })),

  // ── 更新子代理 / Update sub-agent ──
  updateSubAgent: (subId, patch) => set((s) => ({
    subAgents: s.subAgents.map((a) =>
      a.id === subId ? { ...a, ...patch } : a,
    ),
  })),
});
