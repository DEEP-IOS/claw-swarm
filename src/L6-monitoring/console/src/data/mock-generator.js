/**
 * 模拟数据生成器 / Mock Data Generator
 *
 * 开发模式下向 Zustand store 注入丰富的模拟数据,
 * 覆盖所有 9 个 Slice 的字段，包含 5 个场景模拟器。
 *
 * 场景分布:
 *   normal (70%) — 随机状态切换 + 信息素波动 + budget 消耗
 *   alarm (8%)   — alarm 飙升 → breaker OPEN → 红闪 → 恢复
 *   spawning (8%) — 父代理膨胀 → 子代理孵化 → 轨道运动
 *   contractNet (8%) — CFP → 多 agent 竞标 → 授予 → 执行
 *   evolution (6%) — 物种提议 → A/B 测试 → 晋升/淘汰
 *
 * @module console/data/mock-generator
 * @author DEEP-IOS
 */
import useStore from '../store.js';

// ═══════════════════════════════════════════════════════
// 基础 Mock 数据 / Base Mock Data
// ═══════════════════════════════════════════════════════

const MOCK_AGENTS = [
  {
    id: 'arch-001', name: 'Architect Alpha', role: 'architect',
    state: 'ACTIVE', tier: 'senior', abc: 'employed', species: 'alpha',
    reputation: { quality: 0.9, speed: 0.6, reliability: 0.85, creativity: 0.95, cost: 0.7, collaboration: 0.8 },
    capabilities: { coding: 0.7, review: 0.9, design: 0.95, planning: 0.98, testing: 0.5, debug: 0.6, research: 0.8, comms: 0.9 },
    children: ['sub-001'], history: [],
  },
  {
    id: 'code-002', name: 'Coder Beta', role: 'coder',
    state: 'EXECUTING', tier: 'mid', abc: 'employed', species: 'beta',
    reputation: { quality: 0.8, speed: 0.9, reliability: 0.7, creativity: 0.6, cost: 0.5, collaboration: 0.75 },
    capabilities: { coding: 0.95, review: 0.5, design: 0.3, planning: 0.4, testing: 0.7, debug: 0.85, research: 0.4, comms: 0.5 },
    children: [], history: [],
  },
  {
    id: 'code-003', name: 'Coder Gamma', role: 'coder',
    state: 'IDLE', tier: 'junior', abc: 'scout', species: 'gamma',
    reputation: { quality: 0.6, speed: 0.8, reliability: 0.65, creativity: 0.5, cost: 0.9, collaboration: 0.6 },
    capabilities: { coding: 0.7, review: 0.3, design: 0.2, planning: 0.3, testing: 0.6, debug: 0.7, research: 0.5, comms: 0.4 },
    children: [], history: [],
  },
  {
    id: 'rev-004', name: 'Reviewer Delta', role: 'reviewer',
    state: 'ACTIVE', tier: 'senior', abc: 'onlooker', species: 'delta',
    reputation: { quality: 0.95, speed: 0.5, reliability: 0.9, creativity: 0.4, cost: 0.8, collaboration: 0.85 },
    capabilities: { coding: 0.6, review: 0.98, design: 0.4, planning: 0.7, testing: 0.8, debug: 0.5, research: 0.6, comms: 0.7 },
    children: ['sub-002', 'sub-003'], history: [],
  },
  {
    id: 'scout-005', name: 'Scout Epsilon', role: 'scout',
    state: 'EXECUTING', tier: 'mid', abc: 'scout', species: 'epsilon',
    reputation: { quality: 0.7, speed: 0.95, reliability: 0.6, creativity: 0.85, cost: 0.4, collaboration: 0.5 },
    capabilities: { coding: 0.4, review: 0.3, design: 0.5, planning: 0.6, testing: 0.3, debug: 0.4, research: 0.95, comms: 0.8 },
    children: [], history: [],
  },
  {
    id: 'guard-006', name: 'Guard Zeta', role: 'guard',
    state: 'ACTIVE', tier: 'lead', abc: 'employed', species: 'zeta',
    reputation: { quality: 0.85, speed: 0.4, reliability: 0.95, creativity: 0.3, cost: 0.7, collaboration: 0.65 },
    capabilities: { coding: 0.5, review: 0.85, design: 0.2, planning: 0.5, testing: 0.9, debug: 0.7, research: 0.3, comms: 0.6 },
    children: [], history: [],
  },
];

const MOCK_SUB_AGENTS = [
  { id: 'sub-001', parentId: 'arch-001', role: 'coder', state: 'EXECUTING', task: 'Auth unit tests' },
  { id: 'sub-002', parentId: 'rev-004', role: 'reviewer', state: 'ACTIVE', task: 'API schema review' },
  { id: 'sub-003', parentId: 'rev-004', role: 'coder', state: 'IDLE', task: 'Integration fix' },
];

const MOCK_TASKS = [
  { id: 'task-001', name: 'Design API v3', phase: 'QUALITY', agent: 'arch-001', priority: 0, evidence: 'PRIMARY', progress: 0.9 },
  { id: 'task-002', name: 'Auth middleware', phase: 'EXECUTE', agent: 'code-002', priority: 1, progress: 0.6 },
  { id: 'task-003', name: 'Integration tests', phase: 'BID', agent: null, priority: 2, progress: 0 },
  { id: 'task-004', name: 'Code review', phase: 'CFP', agent: null, priority: 1, progress: 0 },
  { id: 'task-005', name: 'Deploy staging', phase: 'DONE', agent: 'scout-005', priority: 0, progress: 1.0 },
  { id: 'task-006', name: 'Schema migration', phase: 'EXECUTE', agent: 'code-003', priority: 2, progress: 0.3 },
];

const MOCK_DAG = {
  edges: [
    { source: 'task-001', target: 'task-002' },
    { source: 'task-002', target: 'task-003' },
    { source: 'task-003', target: 'task-005' },
    { source: 'task-004', target: 'task-003' },
  ],
};

const MOCK_NETWORK_EDGES = [
  { source: 'arch-001', target: 'code-002', weight: 0.8, type: 'delegate' },
  { source: 'code-002', target: 'rev-004', weight: 0.6, type: 'review' },
  { source: 'scout-005', target: 'arch-001', weight: 0.4, type: 'report' },
  { source: 'guard-006', target: 'code-003', weight: 0.3, type: 'feedback' },
  { source: 'arch-001', target: 'rev-004', weight: 0.5, type: 'handoff' },
];

const AGENT_STATES = ['EXECUTING', 'ACTIVE', 'IDLE', 'REPORTING'];

// ═══════════════════════════════════════════════════════
// 工具 / Utilities
// ═══════════════════════════════════════════════════════

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const rand = (min, max) => min + Math.random() * (max - min);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
let seqId = 100;
const nextId = () => `mock-${++seqId}`;

// ═══════════════════════════════════════════════════════
// 场景模拟器 / Scenario Simulators
// ═══════════════════════════════════════════════════════

/** 场景队列 — 多步骤场景按顺序执行 / Scenario queue for multi-step sequences */
let scenarioQueue = [];
let scenarioTimer = null;
let showcaseCursor = 0;

/**
 * 推入场景步骤 / Push scenario steps
 * @param {Array<{delay: number, fn: Function}>} steps
 */
function enqueueScenario(steps) {
  scenarioQueue.push(...steps);
  if (!scenarioTimer) drainScenarioQueue();
}

function drainScenarioQueue() {
  if (scenarioQueue.length === 0) { scenarioTimer = null; return; }
  const step = scenarioQueue.shift();
  scenarioTimer = setTimeout(() => {
    step.fn();
    drainScenarioQueue();
  }, step.delay);
}

// ── 场景: alarm (断路器告警) ──
function triggerAlarmScenario() {
  const s = () => useStore.getState();
  enqueueScenario([
    { delay: 0, fn: () => {
      s().updatePheromones({ ...s().pheromones, alarm: 0.85, danger: 0.7 });
      s().addNotification({ type: 'warning', title: 'Alarm Rising', titleZh: '警报升高', body: 'Pheromone alarm spike detected' });
    }},
    { delay: 800, fn: () => {
      s().updateBreaker({ state: 'OPEN', failures: 5, threshold: 5 });
      s().addNotification({ type: 'error', title: 'Circuit Breaker OPEN', titleZh: '断路器打开', body: 'Failure threshold exceeded' });
      s().updateHealth(clamp(s().health - 25, 0, 100));
    }},
    { delay: 2000, fn: () => {
      s().updatePheromones({ ...s().pheromones, alarm: 0.5, danger: 0.3 });
    }},
    { delay: 2000, fn: () => {
      s().updateBreaker({ state: 'HALF_OPEN', failures: 3, threshold: 5 });
      s().addNotification({ type: 'info', title: 'Breaker Half-Open', titleZh: '断路器半开', body: 'Testing recovery...' });
    }},
    { delay: 1500, fn: () => {
      s().updateBreaker({ state: 'CLOSED', failures: 0, threshold: 5 });
      s().updatePheromones({ ...s().pheromones, alarm: 0.1, danger: 0.0 });
      s().updateHealth(clamp(s().health + 15, 0, 100));
      s().addNotification({ type: 'success', title: 'Recovery Complete', titleZh: '恢复完成', body: 'Breaker closed' });
    }},
  ]);
}

// ── 场景: spawning (子代理孵化) ──
function triggerSpawningScenario() {
  const s = () => useStore.getState();
  const parentId = pick(['arch-001', 'code-002', 'rev-004']);
  const subId = nextId();
  const taskName = pick(['Unit test generation', 'API documentation', 'Bug bisect', 'Schema validation']);

  enqueueScenario([
    { delay: 0, fn: () => {
      s().updateAgent(parentId, { state: 'EXECUTING' });
      s().addNotification({ type: 'info', title: 'Spawning Sub-agent', titleZh: '正在孵化子代理', body: `Parent: ${parentId}`, agentId: parentId });
    }},
    { delay: 600, fn: () => {
      s().addSubAgent({ id: subId, parentId, role: 'worker', state: 'ACTIVE', task: taskName });
      s().addNotification({ type: 'success', title: 'Sub-agent Born', titleZh: '子代理孵化完成', body: `${subId} → ${taskName}`, agentId: parentId });
    }},
    { delay: 4000, fn: () => {
      s().updateSubAgent(subId, { state: 'EXECUTING', progress: 0.5 });
    }},
    { delay: 3000, fn: () => {
      s().updateSubAgent(subId, { state: 'DONE', progress: 1.0 });
      s().addNotification({ type: 'success', title: 'Sub-agent Done', titleZh: '子代理完成', body: subId });
    }},
    { delay: 1000, fn: () => {
      s().removeSubAgent(subId);
    }},
  ]);
}

// ── 场景: contractNet (合同网竞标) ──
function triggerContractNetScenario() {
  const s = () => useStore.getState();
  const taskId = nextId();
  const taskName = pick(['Refactor auth module', 'Optimize query planner', 'Add caching layer', 'Write E2E tests']);
  const bidders = ['code-002', 'code-003', 'scout-005'];

  enqueueScenario([
    // CFP 发布
    { delay: 0, fn: () => {
      s().addTask({ id: taskId, name: taskName, phase: 'CFP', agent: null, priority: 1, progress: 0 });
      s().addNotification({ type: 'info', title: 'CFP Issued', titleZh: 'CFP 发布', body: taskName, taskId });
    }},
    // BID 竞标
    { delay: 1000, fn: () => {
      s().updateTask(taskId, { phase: 'BID' });
      for (const b of bidders) {
        const score = rand(0.5, 0.95);
        s().addBid({ agent: b, model: pick(['sonnet', 'haiku', 'opus']), bid: score, awarded: false, task: taskId });
      }
      s().addNotification({ type: 'info', title: 'Bids Received', titleZh: '收到竞标', body: `${bidders.length} bids for ${taskName}` });
    }},
    // AWARD 授予
    { delay: 1200, fn: () => {
      const winner = pick(bidders);
      s().updateTask(taskId, { phase: 'EXECUTE', agent: winner });
      s().updateAgent(winner, { state: 'EXECUTING' });
      // 标记获胜 bid
      const bids = s().bidHistory;
      const winBid = bids.find((b) => b.agent === winner && b.task === taskId);
      if (winBid) {
        s().updateBidHistory(
          bids.map((b) => b === winBid ? { ...b, awarded: true } : b),
        );
      }
      s().addNotification({ type: 'success', title: 'Task Awarded', titleZh: '任务授予', body: `${winner} → ${taskName}`, agentId: winner, taskId });
    }},
    // EXECUTE 完成
    { delay: 3000, fn: () => {
      s().updateTask(taskId, { phase: 'QUALITY', progress: 0.95 });
    }},
    // QUALITY → DONE
    { delay: 1500, fn: () => {
      s().updateTask(taskId, { phase: 'DONE', progress: 1.0 });
      s().addNotification({ type: 'success', title: 'Quality Passed', titleZh: '质量门通过', body: taskName, taskId });
    }},
  ]);
}

// ── 场景: evolution (物种进化) ──
function triggerEvolutionScenario() {
  const s = () => useStore.getState();
  const speciesName = pick(['omega', 'sigma', 'theta', 'lambda']);

  enqueueScenario([
    { delay: 0, fn: () => {
      s().addNotification({ type: 'evolution', title: 'Species Proposed', titleZh: '物种提议', body: `New species: ${speciesName}` });
    }},
    { delay: 2000, fn: () => {
      s().addNotification({ type: 'info', title: 'A/B Trial Running', titleZh: 'A/B 试验中', body: `Testing ${speciesName} vs baseline` });
    }},
    { delay: 3000, fn: () => {
      const promoted = Math.random() > 0.3;
      if (promoted) {
        s().addNotification({ type: 'success', title: 'Species Promoted', titleZh: '物种晋升', body: `${speciesName} outperformed baseline` });
      } else {
        s().addNotification({ type: 'warning', title: 'Species Culled', titleZh: '物种淘汰', body: `${speciesName} underperformed, removed` });
      }
    }},
  ]);
}

// ═══════════════════════════════════════════════════════
// 常规更新 / Normal Update Tick
// ═══════════════════════════════════════════════════════

function normalTick() {
  const s = useStore.getState();

  // ── Agent 状态随机切换 / Random agent state toggle ──
  const updated = s.agents.map((a) => ({
    ...a,
    state: Math.random() < 0.15 ? pick(AGENT_STATES) : a.state,
  }));
  s.updateAgents(updated);

  // ── 信息素衰减 + 噪声 / Pheromone decay + noise ──
  const pheros = { ...s.pheromones };
  for (const key of Object.keys(pheros)) {
    pheros[key] = clamp(pheros[key] + (Math.random() - 0.55) * 0.1, 0, 1);
  }
  s.updatePheromones(pheros);

  // ── RED 指标波动 / RED metric fluctuation ──
  s.updateRed({
    rate: Math.max(0, s.red.rate + (Math.random() - 0.5) * 0.5),
    errorRate: clamp(s.red.errorRate + (Math.random() - 0.5) * 0.02, 0, 1),
    duration: Math.max(100, s.red.duration + (Math.random() - 0.5) * 200),
  });

  // ── 健康度微调 / Health score drift ──
  s.updateHealth(clamp(Math.round(s.health + (Math.random() - 0.48) * 3), 0, 100));

  // ── 预算消耗 / Budget consumption tick ──
  const newConsumed = Math.min(s.budget.total, s.budget.consumed + Math.floor(Math.random() * 500));
  const remaining = s.budget.total - newConsumed;
  const budgetRatio = remaining / s.budget.total;
  const risk = budgetRatio < 0.2 ? 'high' : budgetRatio < 0.4 ? 'medium' : 'low';
  s.updateBudget({ ...s.budget, consumed: newConsumed, remaining, risk });

  // ── Shapley 微调 / Shapley drift ──
  const sh = { ...s.shapley };
  for (const k of Object.keys(sh)) {
    sh[k] = clamp(sh[k] + (Math.random() - 0.5) * 0.03, 0, 1);
  }
  s.updateShapley(sh);

  // ── 信号权重微调 / Signal weight drift ──
  const sig = { ...s.signals };
  for (const k of Object.keys(sig)) {
    sig[k] = clamp(sig[k] + (Math.random() - 0.5) * 0.02, 0, 1);
  }
  s.updateSignals(sig);

  // ── PI 控制器波动 / PI controller oscillation ──
  s.updatePIController({
    kp: s.piController.kp,
    ki: s.piController.ki,
    output: clamp(s.piController.output + (Math.random() - 0.5) * 0.05, -1, 1),
    integral: s.piController.integral + s.piController.output * 0.01,
  });

  // ── 双过程计数器 / Dual-process counter ──
  if (Math.random() < 0.3) {
    const isS1 = Math.random() < 0.65;
    s.updateDual({
      s1: s.dual.s1 + (isS1 ? 1 : 0),
      s2: s.dual.s2 + (isS1 ? 0 : 1),
      total: s.dual.total + 1,
    });
  }

  // ── 任务进度 / Task progress tick ──
  const tasks = s.tasks.map((t) => {
    if (t.phase === 'EXECUTE' && t.progress < 1.0) {
      return { ...t, progress: clamp(t.progress + rand(0.02, 0.08), 0, 1) };
    }
    return t;
  });
  s.updateTasks(tasks);

  // ── 偶尔通知 / Occasional notification (8% chance) ──
  if (Math.random() < 0.08) {
    const messages = [
      { type: 'info', title: 'Task Completed', titleZh: '任务完成', body: 'Phase 2 finished' },
      { type: 'warning', title: 'Pheromone Spike', titleZh: '信息素飙升', body: 'Alarm level rising' },
      { type: 'info', title: 'Agent Spawned', titleZh: '代理产生', body: 'New scout deployed' },
      { type: 'success', title: 'Quality Gate', titleZh: '质量门', body: 'Review pass rate updated' },
      { type: 'warning', title: 'Budget Alert', titleZh: '预算警报', body: 'Token consumption increasing' },
    ];
    s.addNotification(pick(messages));
  }
}

// ═══════════════════════════════════════════════════════
// 场景调度器 / Scenario Dispatcher
// ═══════════════════════════════════════════════════════

function dispatchScenario(mode = 'normal') {
  if (mode === 'showcase') {
    const cycle = [
      triggerContractNetScenario,
      triggerSpawningScenario,
      triggerAlarmScenario,
      triggerEvolutionScenario,
    ];
    cycle[showcaseCursor % cycle.length]();
    showcaseCursor += 1;
    return;
  }

  if (mode === 'alarm') {
    triggerAlarmScenario();
    return;
  }

  if (mode === 'spawning') {
    triggerSpawningScenario();
    return;
  }

  if (mode === 'contract-net') {
    triggerContractNetScenario();
    return;
  }

  if (mode === 'evolution') {
    triggerEvolutionScenario();
    return;
  }

  const r = Math.random();
  if (r < 0.70) {
    // normal — 只做常规 tick
    return;
  } else if (r < 0.78) {
    triggerAlarmScenario();
  } else if (r < 0.86) {
    triggerSpawningScenario();
  } else if (r < 0.94) {
    triggerContractNetScenario();
  } else {
    triggerEvolutionScenario();
  }
}

// ═══════════════════════════════════════════════════════
// 公共 API / Public API
// ═══════════════════════════════════════════════════════

let intervalId = null;

/**
 * 启动模拟数据流 / Start mock data stream
 * @param {{ mode?: 'normal'|'showcase'|'alarm'|'spawning'|'contract-net'|'evolution', tickMs?: number }} [options]
 */
export function startMockData(options = {}) {
  const mode = options.mode || 'normal';
  const tickMs = Math.max(600, options.tickMs || (mode === 'showcase' ? 900 : 2000));
  const s = useStore.getState();

  // 确保重复调用时不会叠加定时器 / Avoid stacked timers on repeated calls
  stopMockData();
  showcaseCursor = 0;

  // ── 初始填充所有 Slice / Initial population of all slices ──

  // Agent slice
  const seededAgents = MOCK_AGENTS.map((agent, idx) => (
    mode === 'showcase'
      ? {
          ...agent,
          state: ['EXECUTING', 'REPORTING', 'ACTIVE', 'EXECUTING', 'ACTIVE', 'REPORTING'][idx] || 'ACTIVE',
          taskId: MOCK_TASKS[idx % MOCK_TASKS.length]?.id || null,
        }
      : agent
  ));
  s.updateAgents(seededAgents);

  // Sub-agent slice
  for (const sub of MOCK_SUB_AGENTS) s.addSubAgent(sub);

  // Task slice
  s.updateTasks(MOCK_TASKS);
  s.updateDAG(MOCK_DAG);

  // Pheromone slice
  s.updatePheromones(
    mode === 'showcase'
      ? { trail: 0.72, alarm: 0.22, recruit: 0.68, dance: 0.52, queen: 0.28, food: 0.64, danger: 0.18 }
      : { trail: 0.6, alarm: 0.1, recruit: 0.3, dance: 0.2, queen: 0.05, food: 0.4, danger: 0.0 },
  );

  // Network slice
  s.updateEdges(MOCK_NETWORK_EDGES);

  // Metrics slice
  s.updateMode({ m: mode === 'showcase' ? 'EXPLORE' : 'EXPLOIT', turns: 42, f: {} });
  s.updateDual(mode === 'showcase' ? { s1: 21, s2: 15, total: 36 } : { s1: 15, s2: 8, total: 23 });
  s.updateQuality({ passRate: 0.87, total: 34, entries: [] });
  s.updateRed({ rate: 4.2, errorRate: 0.05, duration: 1230 });
  s.updateHealth(mode === 'showcase' ? 88 : 92);
  s.updateBudget(
    mode === 'showcase'
      ? { consumed: 68000, total: 100000, remaining: 32000, risk: 'medium' }
      : { consumed: 45000, total: 100000, remaining: 55000, risk: 'low' },
  );
  s.updateBreaker({ state: 'CLOSED', failures: 1, threshold: 5 });
  s.updateShapley({
    'arch-001': 0.32, 'code-002': 0.28, 'rev-004': 0.22,
    'scout-005': 0.12, 'guard-006': 0.06,
  });
  s.updateSignals({
    quality: 0.30, speed: 0.18, cost: 0.15, history: 0.12,
    affinity: 0.10, novelty: 0.08, model: 0.07,
  });
  s.updatePIController({ kp: 0.1, ki: 0.01, output: 0.35, integral: 2.1 });
  s.updateColdStart({ mode: 'EXPLORE', completedTasks: 3, threshold: 5, complete: false });

  // Bid slice
  s.updateBidHistory([
    { agent: 'code-002', model: 'sonnet', bid: 0.82, awarded: true, task: 'task-002', ts: Date.now() - 60000 },
    { agent: 'code-003', model: 'haiku', bid: 0.71, awarded: false, task: 'task-002', ts: Date.now() - 60000 },
    { agent: 'scout-005', model: 'sonnet', bid: 0.65, awarded: false, task: 'task-002', ts: Date.now() - 58000 },
  ]);

  // Connection
  s.setConnected(true);

  // ── 周期更新 / Periodic updates (every 2 seconds) ──
  intervalId = setInterval(() => {
    normalTick();
    dispatchScenario(mode);
  }, tickMs);
}

/**
 * 停止模拟数据流 / Stop mock data stream
 */
export function stopMockData() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
  if (scenarioTimer) {
    clearTimeout(scenarioTimer);
    scenarioTimer = null;
  }
  scenarioQueue = [];
}
