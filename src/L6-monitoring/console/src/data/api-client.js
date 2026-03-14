/**
 * REST API 客户端 / REST API Client
 *
 * 封装所有 Dashboard REST 调用，统一错误处理和基路径管理。
 * Wraps all Dashboard REST calls with unified error handling and base path management.
 *
 * @module console/data/api-client
 * @author DEEP-IOS
 */

/** API 基路径 (由 Vite 注入或使用默认值) / API base path */
const BASE = () => import.meta.env?.VITE_API_BASE || '';

/**
 * 通用 JSON 请求 / Generic JSON fetch
 * @param {string} path - API 路径
 * @param {Object} [options] - fetch options
 * @returns {Promise<Object>} 响应 JSON
 */
async function fetchJSON(path, options = {}) {
  const resp = await fetch(`${BASE()}${path}`, {
    headers: { 'Accept': 'application/json' },
    ...options,
  });
  if (!resp.ok) {
    throw new Error(`API ${path}: ${resp.status} ${resp.statusText}`);
  }
  return resp.json();
}

/**
 * 安全请求 (不抛出, 返回默认值) / Safe fetch (no throw, returns fallback)
 * @param {string} path - API 路径
 * @param {*} [fallback=null] - 失败时返回的默认值
 * @returns {Promise<*>}
 */
async function safeFetch(path, fallback = null) {
  try {
    return await fetchJSON(path);
  } catch {
    return fallback;
  }
}

// ═══════════════════════════════════════════════════════
// 导出 API / Exported API
// ═══════════════════════════════════════════════════════

export const api = {
  // ── 核心数据 / Core Data ──
  getAgentStates:   () => safeFetch('/api/v1/agent-states', []),
  getDAGStatus:     () => safeFetch('/api/v1/dag-status', { nodes: [] }),
  getMetrics:       () => safeFetch('/api/metrics', {}),

  // ── 调制器 + 断路器 / Modulator + Breaker ──
  getModulator:     () => safeFetch('/api/v1/modulator', {}),
  getBreakerStatus: () => safeFetch('/api/v1/breaker-status', {}),

  // ── V5.6 端点 / V5.6 Endpoints ──
  getShapley:       () => safeFetch('/api/v1/shapley', {}),
  getDualProcess:   () => safeFetch('/api/v1/dual-process', {}),
  getBudgetForecast:() => safeFetch('/api/v1/budget-forecast', {}),
  getQualityAudit:  () => safeFetch('/api/v1/quality-audit', {}),
  getFailureModes:  () => safeFetch('/api/v1/failure-modes', {}),

  // ── V7.0 新端点 / V7.0 New Endpoints ──
  getSignalWeights:   () => safeFetch('/api/v1/signal-weights', { available: false }),
  getPIController:    () => safeFetch('/api/v1/pi-controller', { available: false }),
  getABCRoles:        () => safeFetch('/api/v1/abc-roles', { available: false }),
  getSpeciesConfig:   () => safeFetch('/api/v1/species-config', { available: false }),
  getColdStart:       () => safeFetch('/api/v1/cold-start', { available: false }),
  getBidHistory:      () => safeFetch('/api/v1/bid-history', { available: false }),
  getSpeculations:    () => safeFetch('/api/v1/speculations', { available: false }),
  getDistillation:    () => safeFetch('/api/v1/distillation', { available: false }),
  getBoard:           (scope = 'global', limit = 20) =>
    safeFetch(`/api/v1/board?scope=${scope}&limit=${limit}`, { available: false }),
  getBudgetDegradation: (remaining, phases) =>
    safeFetch(`/api/v1/budget-degradation?remaining=${remaining}&phases=${phases}`, { available: false }),
  getActiveSessions:  () => safeFetch('/api/v1/active-sessions', { available: false }),
  getSessionStatus:   (key) => safeFetch(`/api/v1/session/${encodeURIComponent(key)}/status`, { available: false }),
  getNegativeSelection: () => safeFetch('/api/v1/negative-selection', { available: false }),

  // ── V5.x 诊断端点 / V5.x Diagnostic Endpoints ──
  getTraces:          (limit = 20) => safeFetch(`/api/v1/traces?limit=${limit}`, []),
  getTopology:        () => safeFetch('/api/v1/topology', []),
  getAffinity:        () => safeFetch('/api/v1/task-affinity', []),
  getDeadLetters:     () => safeFetch('/api/v1/dead-letters', []),
};

export default api;
