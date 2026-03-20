/** REST API client for Dashboard endpoints on port 19100 */

const BASE = '/api/v9';

async function get<T = unknown>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`GET ${path}: ${res.status}`);
  return res.json() as Promise<T>;
}

// ── Field ───────────────────────────────────────────────────
export const fieldApi = {
  stats:       () => get('/field/stats'),
  dimensions:  () => get('/field/dimensions'),
  signals:     (limit = 100) => get(`/field/signals?limit=${limit}`),
  superpose:   (scope = 'global') => get(`/field/superpose/${scope}`),
  weights:     () => get('/signal-weights'),
};

// ── Agents ──────────────────────────────────────────────────
export const agentApi = {
  active:       () => get('/agents/active'),
  states:       () => get('/agents/states'),
  capabilities: () => get('/agents/capabilities'),
  byId:         (id: string) => get(`/agents/${id}`),
};

// ── Social ──────────────────────────────────────────────────
export const socialApi = {
  reputation:      () => get('/reputation'),
  sna:             () => get('/sna'),
  emotionalStates: () => get('/emotional-states'),
  trust:           () => get('/trust'),
  culturalFriction:() => get('/cultural-friction'),
};

// ── Tasks / Orchestration ───────────────────────────────────
export const orchestrationApi = {
  tasks:        () => get('/tasks'),
  deadLetters:  () => get('/tasks/dead-letters'),
  criticalPath: () => get('/tasks/critical-path'),
  dag:          (id: string) => get(`/tasks/${id}`),
  dualProcess:  () => get('/dual-process'),
  budget:       () => get('/budget'),
  budgetForecast: () => get('/budget-forecast'),
};

// ── Adaptation ──────────────────────────────────────────────
export const adaptationApi = {
  modulator:     () => get('/modulator'),
  shapley:       () => get('/shapley'),
  species:       () => get('/species'),
  calibration:   () => get('/calibration'),
  roleDiscovery: () => get('/role-discovery'),
};

// ── Quality ─────────────────────────────────────────────────
export const qualityApi = {
  audit:          () => get('/quality-audit'),
  failureModes:   () => get('/failure-modes'),
  compliance:     () => get('/compliance'),
  circuitBreakers:() => get('/circuit-breakers'),
  vaccinations:   () => get('/vaccinations'),
};

// ── Communication ───────────────────────────────────────────
export const communicationApi = {
  pheromones: () => get('/pheromones'),
  channels:   () => get('/channels'),
  stigmergy:  () => get('/stigmergy'),
};

// ── System / Observe ────────────────────────────────────────
export const systemApi = {
  health:  () => get('/health'),
  metrics: () => get('/metrics'),
  traces:  () => get('/traces'),
  modules: () => get('/modules'),
};
