/**
 * Metrics Slice / 指标切片
 *
 * 管理全局调制器、双过程路由、质量审计、RED、Shapley、
 * 信号权重、预算、断路器、健康度、PI 控制器和冷启动状态。
 *
 * @module store/slices/metrics-slice
 * @author DEEP-IOS
 */

/**
 * @param {Function} set - Zustand set
 * @param {Function} get - Zustand get
 * @returns {Object} Metrics slice
 */
export const createMetricsSlice = (set, get) => ({
  // ── 全局调制器 / Global Modulator ──
  mode: { m: 'EXPLOIT', turns: 0, f: {} },

  // ── 双过程路由 / Dual-Process Router ──
  dual: { s1: 0, s2: 0, total: 0 },

  // ── 质量审计 / Quality Audit ──
  quality: { passRate: 0, total: 0, entries: [] },

  // ── RED 指标 / RED Metrics (Rate, Error rate, Duration) ──
  red: { rate: 0, errorRate: 0, duration: 0 },

  // ── Shapley 信用 / Shapley Credits ──
  shapley: {},

  // ── 信号权重 / Signal Weights ──
  signals: {},

  // ── 预算 / Budget ──
  budget: { consumed: 0, total: 1, remaining: 0, risk: 'low' },

  // ── 断路器 / Circuit Breaker ──
  breaker: { state: 'CLOSED', failures: 0, threshold: 5 },

  // ── 健康度 / Health Score ──
  health: 100,

  // ── PI 控制器状态 / PI Controller State ──
  piController: { kp: 0, ki: 0, output: 0, integral: 0 },

  // ── 冷启动进度 / Cold Start Progress ──
  coldStart: { mode: 'EXPLORE', completedTasks: 0, threshold: 5, complete: false },

  // ── 竞标统计 / Bid Statistics (V7.2) ──
  bidStats: null,

  // ── O4: 字段漂移 / Field Drift ──
  fieldDrift: null,

  // ── Actions ──
  updateMode: (mode) => set({ mode }),
  updateDual: (dual) => set({ dual }),
  updateQuality: (quality) => set({ quality }),
  updateRed: (red) => set({ red }),
  updateShapley: (data) => {
    // API 返回 { credits: {...}, note, timestamp }，只取 credits 作为 shapley
    // API returns { credits, note, timestamp }, extract credits only
    const credits = data?.credits ?? data;
    set({ shapley: (typeof credits === 'object' && credits !== null && !Array.isArray(credits)) ? credits : {} });
  },
  updateSignals: (signals) => set({ signals }),
  updateBudget: (budget) => set({ budget }),
  updateBreaker: (breaker) => set({ breaker }),
  updateHealth: (health) => set({ health }),
  updatePIController: (piController) => set({ piController }),
  updateColdStart: (coldStart) => set({ coldStart }),
  updateBidStats: (bidStats) => set({ bidStats }),
  updateFieldDrift: (fieldDrift) => set({ fieldDrift }),
});
