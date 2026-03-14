/**
 * Task Slice / 任务切片
 *
 * 管理任务列表和 DAG 依赖图。
 * Manages task list and DAG dependency graph.
 *
 * @module store/slices/task-slice
 * @author DEEP-IOS
 */

/**
 * @param {Function} set - Zustand set
 * @param {Function} get - Zustand get
 * @returns {Object} Task slice
 */
export const createTaskSlice = (set, get) => ({
  // ── 任务列表 / Task List ──
  tasks: [],

  // ── DAG 拓扑 / DAG Topology ──
  dag: { edges: [] },

  // ── 更新全部任务 / Update all tasks ──
  updateTasks: (tasks) => set({
    tasks: Array.isArray(tasks) ? tasks : [],
  }),

  // ── 更新单个任务 / Update single task ──
  updateTask: (taskId, patch) => set((s) => ({
    tasks: s.tasks.map((t) =>
      t.id === taskId ? { ...t, ...patch } : t,
    ),
  })),

  // ── 添加任务 / Add task ──
  addTask: (task) => set((s) => ({
    tasks: [...s.tasks, task],
  })),

  // ── 移除任务 / Remove task ──
  removeTask: (taskId) => set((s) => ({
    tasks: s.tasks.filter((t) => t.id !== taskId),
  })),

  // ── 更新 DAG / Update DAG ──
  updateDAG: (dag) => set({ dag }),
});
