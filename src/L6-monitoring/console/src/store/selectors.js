/**
 * Zustand 派生选择器 / Zustand Derived Selectors
 *
 * 提供常用的派生数据查询，避免组件直接操作 store 结构。
 * Provides commonly-used derived data queries to decouple components from store shape.
 *
 * @module store/selectors
 * @author DEEP-IOS
 */

// ═══════════════════════════════════════════════════════
// Agent 选择器 / Agent Selectors
// ═══════════════════════════════════════════════════════

/** 按 ID 获取 Agent / Get agent by ID */
export const selectAgentById = (id) => (s) =>
  s.agents.find((a) => a.id === id) || null;

/** 活跃 Agent (非 IDLE 非 RETIRED) / Active agents */
export const selectActiveAgents = (s) =>
  s.agents.filter((a) => a.state !== 'IDLE' && a.state !== 'RETIRED');

/** 按角色分组 / Group by role */
export const selectAgentsByRole = (s) => {
  const map = {};
  for (const a of s.agents) {
    (map[a.role] || (map[a.role] = [])).push(a);
  }
  return map;
};

/** 按 ABC 角色分组 / Group by ABC role */
export const selectAgentsByABC = (s) => {
  const map = { employed: [], onlooker: [], scout: [] };
  for (const a of s.agents) {
    const abc = a.abc || 'employed';
    (map[abc] || (map[abc] = [])).push(a);
  }
  return map;
};

/** 选中的 Agent / Selected agent */
export const selectSelectedAgent = (s) =>
  s.selectedAgentId ? s.agents.find((a) => a.id === s.selectedAgentId) : null;

/** 对比的 Agent / Compare agent */
export const selectCompareAgent = (s) =>
  s.compareAgentId ? s.agents.find((a) => a.id === s.compareAgentId) : null;

/** 子代理列表 (按父 ID) / Sub-agents by parent ID */
export const selectSubAgentsByParent = (parentId) => (s) =>
  s.subAgents.filter((a) => a.parentId === parentId);

// ═══════════════════════════════════════════════════════
// Task 选择器 / Task Selectors
// ═══════════════════════════════════════════════════════

/** 按 ID 获取任务 / Get task by ID */
export const selectTaskById = (id) => (s) =>
  s.tasks.find((t) => t.id === id) || null;

/** 按阶段分组 / Group tasks by phase */
export const selectTasksByPhase = (s) => {
  const phases = { CFP: [], BID: [], EXECUTE: [], QUALITY: [], DONE: [] };
  for (const t of s.tasks) {
    const phase = t.phase || 'CFP';
    (phases[phase] || (phases[phase] = [])).push(t);
  }
  return phases;
};

/** 选中的任务 / Selected task */
export const selectSelectedTask = (s) =>
  s.selectedTaskId ? s.tasks.find((t) => t.id === s.selectedTaskId) : null;

/** Agent 当前任务 / Agent's current task */
export const selectAgentCurrentTask = (agentId) => (s) =>
  s.tasks.find((t) => t.agent === agentId && t.phase !== 'DONE') || null;

// ═══════════════════════════════════════════════════════
// Metrics 选择器 / Metrics Selectors
// ═══════════════════════════════════════════════════════

/** 预算使用百分比 / Budget usage percentage */
export const selectBudgetPercent = (s) =>
  s.budget.total > 0 ? s.budget.consumed / s.budget.total : 0;

/** 双过程 S1 比率 / Dual-process S1 ratio */
export const selectS1Ratio = (s) =>
  s.dual.total > 0 ? s.dual.s1 / s.dual.total : 0;

/** 断路器是否开启 / Circuit breaker is open */
export const selectBreakerOpen = (s) => s.breaker.state === 'OPEN';

/** 是否冷启动中 / Is cold starting */
export const selectIsColdStart = (s) => !s.coldStart.complete;

/** Shapley 排名 (降序) / Shapley ranking (descending) */
export const selectShapleyRanking = (s) =>
  Object.entries(s.shapley)
    .sort(([, a], [, b]) => b - a)
    .map(([agentId, credit]) => ({ agentId, credit }));

// ═══════════════════════════════════════════════════════
// Pheromone 选择器 / Pheromone Selectors
// ═══════════════════════════════════════════════════════

/** 主导信息素 / Dominant pheromone type */
export const selectDominantPheromone = (s) => {
  let max = 0;
  let type = 'trail';
  for (const [k, v] of Object.entries(s.pheromones)) {
    if (v > max) { max = v; type = k; }
  }
  return { type, intensity: max };
};

/** 信息素总强度 / Total pheromone intensity */
export const selectTotalPheromoneIntensity = (s) =>
  Object.values(s.pheromones).reduce((sum, v) => sum + v, 0);

// ═══════════════════════════════════════════════════════
// Network 选择器 / Network Selectors
// ═══════════════════════════════════════════════════════

/** Agent 的所有边 / All edges for an agent */
export const selectEdgesForAgent = (agentId) => (s) =>
  s.edges.filter((e) => e.source === agentId || e.target === agentId);

/** 边的邻居 / Edge neighbors for agent */
export const selectNeighbors = (agentId) => (s) => {
  const neighbors = new Set();
  for (const e of s.edges) {
    if (e.source === agentId) neighbors.add(e.target);
    if (e.target === agentId) neighbors.add(e.source);
  }
  return [...neighbors];
};

// ═══════════════════════════════════════════════════════
// Connection / UI 选择器
// ═══════════════════════════════════════════════════════

/** 数据新鲜度级别 / Data freshness level */
export const selectFreshnessLevel = (s) => {
  if (!s.sseConnected) return 'disconnected';
  if (!s.lastEventTime) return 'stale';
  const age = Date.now() - s.lastEventTime;
  if (age < 3000) return 'live';       // <3s
  if (age < 15000) return 'recent';    // <15s
  return 'stale';                       // >15s
};
