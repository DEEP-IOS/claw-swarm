/**
 * SSE 实时事件客户端 / SSE Real-time Event Client
 *
 * 连接到 Dashboard Service 的 /events 端点,
 * 将事件分发到 Zustand store 的 9 个 Slice。
 *
 * 事件路由覆盖:
 *   agent.*, task.*, pheromone.*, breaker.*, modulator.*,
 *   budget.*, system.*, cfp.*, bid.*, award.*, reputation.*,
 *   quality.*, species.*, abc.*, communication.*, knowledge.*,
 *   pi_controller.*, session.*, negative_selection.*
 *
 * @module console/sse-client
 * @author DEEP-IOS
 */
import useStore from './store.js';

const MAX_RETRY_DELAY = 30000;

/** @type {EventSource|null} */
let eventSource = null;
let retryDelay = 1000;

// O3: SSE 重连可观测性 / SSE reconnection observability
let _reconnectCount = 0;
let _lastDataLoadTime = 0;

// V7.2: 防抖计时器 / Debounce timers for high-frequency fetches
let _agentDebounce = null;
let _taskDebounce = null;
let _redPollTimer = null;

/** 防抖 fetchAndUpdate / Debounced fetchAndUpdate */
function debouncedFetch(timerRef, path, updater, delay = 300) {
  if (timerRef.current) clearTimeout(timerRef.current);
  timerRef.current = setTimeout(() => {
    timerRef.current = null;
    fetchAndUpdate(path, updater);
  }, delay);
}
const _agentTimer = { current: null };
const _taskTimer = { current: null };

/**
 * 将 SSE 事件分发到 Zustand store
 * Dispatch SSE events to Zustand store
 *
 * @param {string} topic - 事件主题
 * @param {Object} data - 事件数据
 */
function dispatchToStore(topic, data) {
  const s = useStore.getState();

  // Replay mode freezes live state updates from SSE.
  if (s.replayActive) {
    s.batchUpdate({ lastEventTime: Date.now() });
    return;
  }

  switch (topic) {
    // ═══════════════════════════════════════════════
    // Agent 事件 / Agent Events
    // ═══════════════════════════════════════════════
    case 'agent.registered':
    case 'agent.online':
    case 'agent.offline':
    case 'agent.end':
    case 'agent.state.changed': // backend V6.0+ actual event name
      // V7.2: 防抖 300ms 合并高频状态变化 / Debounce 300ms to merge rapid state changes
      debouncedFetch(_agentTimer, '/api/v1/agent-states', (d) => {
        const states = d?.states || {};
        const arr = Array.isArray(states)
          ? states
          : Object.entries(states).map(([id, info]) => ({
              id,
              ...(typeof info === 'object' && info !== null ? info : { state: info }),
            }));
        useStore.getState().updateAgents(arr);
      });
      break;

    case 'agent.model_selected':
      if (data?.agentId) {
        s.updateAgent(data.agentId, { model: data.model, state: data.state });
      }
      if (data?.bid) {
        s.addBid({
          agent: data.agentId, model: data.model,
          bid: data.bid, awarded: true, task: data.taskId,
        });
      }
      break;

    case 'agent.role_changed':
      if (data?.agentId) {
        s.updateAgent(data.agentId, { role: data.newRole });
      }
      break;

    // ═══════════════════════════════════════════════
    // Task 事件 / Task Events
    // ═══════════════════════════════════════════════
    case 'task.created':
    case 'task.completed':
    case 'task.failed':
    case 'task.assigned':
      // V7.2: 防抖 300ms / Debounce 300ms
      debouncedFetch(_taskTimer, '/api/v1/dag-status', (d) => {
        const nodes = [];
        if (Array.isArray(d?.dags)) {
          for (const dag of d.dags) {
            if (Array.isArray(dag?.nodes)) nodes.push(...dag.nodes);
          }
        } else if (Array.isArray(d?.nodes)) {
          nodes.push(...d.nodes);
        }
        if (nodes.length > 0) useStore.getState().updateTasks(nodes);
      });
      // 任务完成 → 构建协作边 / Task completed → build collaboration edge
      if (topic === 'task.completed' && data?.agentId && data?.parentAgentId && data.agentId !== data.parentAgentId) {
        s.upsertEdge({ source: data.parentAgentId, target: data.agentId, weight: 1, type: 'delegate' });
      }
      break;

    case 'task.phase_changed':
      if (data?.taskId) {
        s.updateTask(data.taskId, { phase: data.newPhase });
      }
      break;

    // ═══════════════════════════════════════════════
    // Pheromone 事件 / Pheromone Events
    // ═══════════════════════════════════════════════
    case 'pheromone.deposited':
    case 'pheromone.decayed':
    case 'pheromone.emitted': {
      // V7.2: 兼容后端字段名 pheromoneType / Compatible with backend field name
      const phType = data?.type || data?.pheromoneType;
      if (phType && data?.intensity !== undefined) {
        s.updatePheromone(phType, data.intensity);
      }
      break;
    }

    case 'pheromone.decayPass':
      if (data?.concentrations) {
        s.updatePheromones(data.concentrations);
      }
      break;

    // ═══════════════════════════════════════════════
    // 断路器 / Circuit Breaker
    // ═══════════════════════════════════════════════
    case 'breaker.transition':
    case 'circuit_breaker.transition': // backend EventTopics.CIRCUIT_BREAKER_TRANSITION
      s.updateBreaker({
        state: data?.newState || 'CLOSED',
        failures: data?.failureCount || 0,
        threshold: data?.threshold || 5,
      });
      if (data?.newState === 'OPEN') {
        s.addNotification({ type: 'error', title: 'Circuit Breaker OPEN', titleZh: '断路器打开', body: data?.reason || '' });
      }
      break;

    // ═══════════════════════════════════════════════
    // 全局调制器 / Global Modulator
    // ═══════════════════════════════════════════════
    case 'modulator.mode.switched':
    case 'modulator.mode_changed':
      s.updateMode({ m: data?.mode || 'EXPLOIT', turns: data?.turns || 0, f: data?.factors || {} });
      s.addNotification({
        type: 'info',
        title: `Mode: ${data?.mode || 'EXPLOIT'}`,
        titleZh: `模式切换: ${data?.mode || 'EXPLOIT'}`,
        body: `Turn ${data?.turns || 0}`,
      });
      // V7.2 B1.10: 模式切换时刷新冷启动进度 / Refresh cold start on mode switch
      fetchAndUpdate('/api/v1/cold-start', (d) => {
        if (d?.coldStart) useStore.getState().updateColdStart(d.coldStart);
      });
      break;

    // ═══════════════════════════════════════════════
    // 预算 / Budget
    // ═══════════════════════════════════════════════
    case 'budget.turn.completed':
    case 'budget.exhaustion.warning':
      fetchAndUpdate('/api/v1/budget-forecast', 'updateBudget');
      break;

    case 'budget.degradation.applied':
    case 'budget.degradation':
      fetchAndUpdate('/api/v1/budget-forecast', 'updateBudget');
      s.addNotification({
        type: 'warning',
        title: 'Budget Degradation',
        titleZh: '预算降级',
        body: data?.reason || data?.action || '',
      });
      break;

    // ═══════════════════════════════════════════════
    // 系统 / System
    // ═══════════════════════════════════════════════
    case 'system.health':
      if (data?.score !== undefined) s.updateHealth(data.score);
      break;

    case 'system.error':
    case 'system.danger':
      s.addNotification({ type: 'error', title: data?.message || 'System Error', titleZh: '系统错误', body: '' });
      break;

    // ═══════════════════════════════════════════════
    // ContractNet / 合同网
    // ═══════════════════════════════════════════════
    case 'cfp.issued':
    case 'contract.cfp.created':          // backend contract-net.js actual name
    case 'contract.live_cfp.completed':   // backend contract-net.js actual name
      s.addNotification({
        type: 'info',
        title: 'CFP Issued',
        titleZh: 'CFP 发布',
        body: data?.taskId || data?.cfpId || '',
        agentId: data?.issuerId,
        taskId: data?.taskId,
      });
      break;

    case 'bid.submitted':
    case 'contract.bid.submitted':        // backend contract-net.js actual name
      s.addBid({
        agent: data?.agentId, model: data?.model,
        bid: data?.score || data?.bid, awarded: false, task: data?.taskId,
      });
      break;

    case 'award.given':
    case 'contract.awarded':              // backend contract-net.js actual name
      if (data?.taskId) s.updateTask(data.taskId, { agent: data.agentId, phase: 'EXECUTE' });
      if (data?.agentId) s.updateAgent(data.agentId, { state: 'EXECUTING' });
      s.addNotification({
        type: 'success',
        title: 'Task Awarded',
        titleZh: '任务授予',
        body: `${data?.agentId} → ${data?.taskId}`,
        agentId: data?.agentId,
        taskId: data?.taskId,
      });
      break;

    // ═══════════════════════════════════════════════
    // 声誉 / Reputation
    // ═══════════════════════════════════════════════
    case 'reputation.updated':
      if (data?.agentId) {
        if (data.reputation) {
          // 完整对象更新 / Full object update
          s.updateAgent(data.agentId, { reputation: data.reputation });
        } else if (data.dimension && data.newScore !== undefined) {
          // 逐维度累积 (映射: competence→quality, innovation→creativity 等)
          // Per-dimension accumulation (mapped field names)
          const dimMap = { competence: 'quality', centrality: 'speed', reliability: 'reliability',
            innovation: 'creativity', influence: 'cost', collaboration: 'collaboration' };
          const frontendDim = dimMap[data.dimension] || data.dimension;
          const cur = s.agents.find(a => a.id === data.agentId)?.reputation || {};
          const val = typeof data.newScore === 'number' ? (data.newScore > 1 ? data.newScore / 100 : data.newScore) : 0;
          s.updateAgent(data.agentId, { reputation: { ...cur, [frontendDim]: val } });
        }
      }
      break;

    // 能力更新 / Capability updated
    case 'capability.updated': {
      if (data?.agentId && data?.dimension) {
        const capMap = { coding: 'coding', architecture: 'design', testing: 'testing',
          documentation: 'research', security: 'debug', performance: 'planning',
          communication: 'comms', domain: 'review' };
        const frontendDim = capMap[data.dimension] || data.dimension;
        const cur = s.agents.find(a => a.id === data.agentId)?.capabilities || {};
        const val = typeof data.score === 'number' ? (data.score > 1 ? data.score / 100 : data.score) : 0;
        s.updateAgent(data.agentId, { capabilities: { ...cur, [frontendDim]: val } });
      }
      break;
    }

    // ═══════════════════════════════════════════════
    // 质量门 / Quality Gate
    // ═══════════════════════════════════════════════
    case 'quality.gate_passed':
      if (data?.taskId) s.updateTask(data.taskId, { phase: 'DONE', evidence: data?.evidenceLevel });
      s.addNotification({
        type: 'success',
        title: 'Quality Gate Passed',
        titleZh: '质量门通过',
        body: data?.taskId || '',
        taskId: data?.taskId,
      });
      break;

    case 'quality.gate_failed':
      if (data?.taskId) s.updateTask(data.taskId, { qualityFailed: true });
      s.addNotification({
        type: 'error',
        title: 'Quality Gate Failed',
        titleZh: '质量门失败',
        body: data?.reason || data?.taskId || '',
        taskId: data?.taskId,
      });
      break;

    case 'quality.evaluation.completed': // backend quality-controller.js actual name
    case 'auto.quality.gate': {          // backend swarm-core.js auto-hook
      const passed = data?.passed !== undefined ? data.passed : (data?.verdict === 'PASS');
      if (passed) {
        if (data?.taskId) s.updateTask(data.taskId, { phase: 'DONE', evidence: data?.evidenceLevel });
        s.addNotification({
          type: 'success',
          title: 'Quality Gate Passed',
          titleZh: '质量门通过',
          body: data?.taskId || '',
          taskId: data?.taskId,
        });
      } else {
        if (data?.taskId) s.updateTask(data.taskId, { qualityFailed: true });
        s.addNotification({
          type: 'error',
          title: 'Quality Gate Failed',
          titleZh: '质量门失败',
          body: data?.reason || data?.taskId || '',
          taskId: data?.taskId,
        });
      }
      break;
    }

    // ═══════════════════════════════════════════════
    // 物种进化 / Species Evolution
    // ═══════════════════════════════════════════════
    case 'species.evolved':
    case 'species.proposed':
    case 'species.culled':
    case 'species.promoted':    // backend species-evolver.js actual names
    case 'species.gep.evolved':
    case 'species.abc.evolved':
    case 'species.retired': {
      const isCulled = topic === 'species.culled' || topic === 'species.retired';
      const titleZhMap = {
        'species.evolved': '进化', 'species.proposed': '提议',
        'species.culled': '淘汰', 'species.promoted': '晋升',
        'species.gep.evolved': 'GEP进化', 'species.abc.evolved': 'ABC进化',
        'species.retired': '退役',
      };
      s.addNotification({
        type: 'evolution',
        title: `Species ${topic.split('.').slice(1).join('.')}`,
        titleZh: `物种${titleZhMap[topic] || topic.split('.')[1]}`,
        body: data?.speciesId || data?.name || '',
      });
      break;
    }

    // ═══════════════════════════════════════════════
    // ABC 角色 / ABC Role
    // ═══════════════════════════════════════════════
    case 'abc.role_changed':
      if (data?.agentId) {
        s.updateAgent(data.agentId, { abc: data.newRole });
      }
      // V7.2 B2.8: ABC 角色切换通知 / Notify on ABC role change
      s.addNotification({
        type: 'info',
        title: 'ABC Role Changed',
        titleZh: 'ABC角色切换',
        body: `${data?.agentId}: ${data?.oldRole || '?'} → ${data?.newRole || '?'}`,
        agentId: data?.agentId,
      });
      break;

    // ═══════════════════════════════════════════════
    // 通信/网络 / Communication/Network
    // ═══════════════════════════════════════════════
    case 'communication.sensed':
      if (data?.source && data?.target) {
        s.upsertEdge({
          source: data.source, target: data.target,
          weight: data.weight || 0.5, type: data.type || 'communication',
        });
      }
      break;

    case 'cross_agent.knowledge.transferred':
    case 'knowledge.transferred':
      s.addKnowledgeTransfer({
        from: data?.from, to: data?.to,
        content: data?.content || data?.summary,
      });
      s.addNotification({
        type: 'info',
        title: 'Knowledge Transfer',
        titleZh: '知识转移',
        body: `${data?.from} → ${data?.to}`,
      });
      break;

    // SNA 网络指标更新 / SNA metrics updated
    case 'sna.metrics.updated':
    case 'SNA_METRICS_UPDATED':
      // V7.2: 只在非空时更新边（防止空数组覆盖已有边）/ Only update if non-empty
      if (Array.isArray(data?.edges) && data.edges.length > 0) {
        s.updateEdges(data.edges);
      }
      break;

    // ═══════════════════════════════════════════════
    // V7.2: Shapley 信用实时更新 / Shapley Credits Real-time
    // ═══════════════════════════════════════════════
    case 'shapley.computed':
    case 'shapley.calculated':
    case 'shapley.credit.computed': // EventTopics.SHAPLEY_CREDIT_COMPUTED
      if (data?.credits) s.updateShapley(data.credits);
      break;

    // V7.2: 信号权重实时更新 / Signal Weights Real-time
    case 'signal.calibrated':
    case 'signal.weights.updated':
    case 'signal.weights.calibrated': { // EventTopics.SIGNAL_WEIGHTS_CALIBRATED
      // 后端可能用 wrapEvent 包装, weights 在 data.payload.weights 或 data.weights
      const payload = data?.payload || data;
      if (payload?.weights) s.updateSignals(payload.weights);
      break;
    }

    // V7.2: 双过程路由实时更新 / Dual-Process Router Real-time
    case 'dual_process.routed': {
      // 后端 publish: { system, mode, s1Score, s2Score, routeCount }
      const curDual = s.dual || {};
      const newS1 = (data?.system === 1 || data?.mode === 'FAST') ? (curDual.s1 || 0) + 1 : (curDual.s1 || 0);
      const newS2 = (data?.system === 2 || data?.mode === 'SLOW') ? (curDual.s2 || 0) + 1 : (curDual.s2 || 0);
      s.updateDual({
        s1: data?.system1 ?? newS1,
        s2: data?.system2 ?? newS2,
        total: data?.routeCount ?? data?.total ?? newS1 + newS2,
      });
      break;
    }

    // V7.2: 合同完成/失败 / Contract Completed/Failed
    case 'contract.completed':
      s.addNotification({ type: 'success', title: 'Contract Completed', titleZh: '合同完成', body: data?.taskId || '' });
      break;
    case 'contract.failed':
      s.addNotification({ type: 'error', title: 'Contract Failed', titleZh: '合同失败', body: data?.reason || data?.taskId || '' });
      break;
    case 'contract.cfp.expired':
      s.addNotification({ type: 'warning', title: 'CFP Expired', titleZh: 'CFP已过期', body: data?.cfpId || '' });
      break;
    case 'contract.bids.evaluated':
      if (data?.winnerId) {
        s.addNotification({ type: 'success', title: 'Bid Awarded', titleZh: '投标授予', body: `${data.winnerId} → ${data?.taskId || ''}` });
      }
      break;

    // ═══════════════════════════════════════════════
    // PI 控制器 / PI Controller
    // ═══════════════════════════════════════════════
    case 'pi.controller.actuated':
    case 'pi_controller.actuated':
      if (data?.kp !== undefined || data?.output !== undefined) {
        s.updatePIController({
          kp: data.kp ?? s.piController?.kp ?? 0,
          ki: data.ki ?? s.piController?.ki ?? 0,
          output: data.output ?? 0,
          integral: data.integral ?? 0,
        });
      }
      s.addNotification({
        type: 'info',
        title: 'PI Controller Actuated',
        titleZh: 'PI 控制器触发',
        body: `output=${typeof data?.output === 'number' ? data.output.toFixed(3) : '?'}`,
      });
      break;

    // ═══════════════════════════════════════════════
    // Swarm 工具事件 / Swarm Tool Events
    // ═══════════════════════════════════════════════
    case 'swarm.agent.spawned':
      if (data?.agentId) {
        s.addSubAgent({
          id: data.agentId, parentId: data.parentId,
          role: data.role || 'worker', state: 'ACTIVE',
          task: data.taskId || '',
        });
      }
      s.addNotification({
        type: 'spawn',
        title: 'Sub-agent Spawned',
        titleZh: '子代理孵化',
        body: `${data?.role || 'worker'} → ${data?.taskId || ''}`,
        agentId: data?.agentId,
        taskId: data?.taskId,
      });
      break;

    case 'swarm.agent.cancelled':
      if (data?.agentId) s.removeSubAgent(data.agentId);
      s.addNotification({
        type: 'warning',
        title: 'Sub-agent Cancelled',
        titleZh: '子代理已取消',
        body: data?.agentName || data?.agentId || '',
        agentId: data?.agentId,
      });
      break;

    // ═══════════════════════════════════════════════
    // 子代理 / Sub-agents (Sessions)
    // ═══════════════════════════════════════════════
    case 'session.spawned':
      if (data?.sessionKey) {
        s.addSubAgent({
          id: data.sessionKey, parentId: data.parentId,
          role: data.role || 'worker', state: 'ACTIVE',
          task: data.taskDescription || '',
        });
      }
      s.addNotification({
        type: 'info',
        title: 'Sub-agent Spawned',
        titleZh: '子代理孵化',
        body: data?.sessionKey || '',
        agentId: data?.parentId,
      });
      break;

    case 'session.patched':
      if (data?.sessionKey) {
        s.updateSubAgent(data.sessionKey, { state: data.state, progress: data.progress });
      }
      break;

    case 'session.ended':
      if (data?.sessionKey) {
        s.removeSubAgent(data.sessionKey);
      }
      break;

    // ═══════════════════════════════════════════════
    // 阴性选择 / Negative Selection
    // ═══════════════════════════════════════════════
    case 'negative.selection.triggered':
    case 'negative_selection.triggered':
      s.addNotification({
        type: 'error',
        title: 'Anomaly Detected',
        titleZh: '异常检测触发',
        body: data?.agentId || data?.reason || '',
        agentId: data?.agentId,
      });
      break;

    // ═══════════════════════════════════════════════
    // 梦境巩固 / Dream Consolidation
    // ═══════════════════════════════════════════════
    case 'dream.consolidation.completed':
      s.addNotification({
        type: 'info',
        title: 'Dream Consolidation',
        titleZh: '梦境巩固完成',
        body: `Consolidated ${data?.count || '?'} memories`,
      });
      break;

    default:
      break;
  }

  // 更新最后事件时间 / Update last event time
  s.batchUpdate({ lastEventTime: Date.now() });
}

/**
 * 辅助: 从 API 获取数据并更新 store
 * Helper: Fetch from API and update store
 */
async function fetchAndUpdate(path, updater) {
  try {
    const basePath = import.meta.env?.VITE_API_BASE || '';
    const resp = await fetch(`${basePath}${path}`);
    if (!resp.ok) return false;
    const data = await resp.json();
    if (typeof updater === 'string') {
      // 确保传给 store 更新器的是数组 / Ensure arrays for store updaters
      const payload = Array.isArray(data)
        ? data
        : Array.isArray(data?.data) ? data.data
        : Array.isArray(data?.entries) ? data.entries
        : data;
      useStore.getState()[updater]?.(payload);
    } else if (typeof updater === 'function') {
      updater(data);
    }
    return true;
  } catch { return false; }
}

/**
 * 连接 SSE / Connect SSE
 * @param {string} [basePath=''] - API base path
 */
export function connectSSE(basePath = '') {
  if (eventSource) {
    eventSource.close();
    eventSource = null;
  }

  const url = `${basePath}/events`;
  useStore.getState().setConnecting();
  eventSource = new EventSource(url);

  eventSource.onopen = () => {
    retryDelay = 1000;
    useStore.getState().setConnected(true);

    // O3: 重连计数 + 日志 / Reconnect counter + logging
    _reconnectCount++;
    if (_reconnectCount > 1) {
      console.info('[SSE] Reconnected (#' + _reconnectCount + '), reloading state...');
      // O3: 过度重连警告 / Excessive reconnection warning
      if (_reconnectCount > 10) {
        console.warn('[SSE] Excessive reconnections:', _reconnectCount);
      }
      // O3: 陈旧数据检测 / Stale data detection
      if (_lastDataLoadTime > 0) {
        const gapMs = Date.now() - _lastDataLoadTime;
        if (gapMs > 5 * 60 * 1000) {
          console.warn('[SSE] Stale data detected, gap:', Math.round(gapMs / 1000), 's');
        }
      }
    }
    // O3: 暴露 reconnectCount 到 store / Expose reconnectCount to store
    useStore.getState().batchUpdate({ reconnectCount: _reconnectCount });

    // V7.2 B5.1: 重连后重新加载全量数据 / Reload all data after reconnect
    loadInitialData(basePath).then(() => {
      // O3: 记录成功加载时间 / Record successful data load time
      _lastDataLoadTime = Date.now();
    }).catch(() => {});
  };

  eventSource.onmessage = (e) => {
    try {
      const msg = JSON.parse(e.data);
      if ((msg.topic === 'batch' || msg.event === 'batch') && Array.isArray(msg.data)) {
        for (const item of msg.data) {
          dispatchToStore(item.event || item.topic, item.data || item);
        }
      } else {
        dispatchToStore(msg.topic || msg.event, msg.data || msg);
      }
    } catch {
      // V7.2 B5.2: 解析失败计数 / Parse failure counter
      const st = useStore.getState();
      const fails = (st._sseParseErrors || 0) + 1;
      st.batchUpdate({ _sseParseErrors: fails });
      if (fails % 10 === 0) console.warn(`[SSE] ${fails} parse errors`);
    }
  };

  eventSource.onerror = () => {
    useStore.getState().setConnected(false);
    eventSource?.close();
    eventSource = null;
    // 指数退避重连 / Exponential backoff reconnect
    setTimeout(() => connectSSE(basePath), retryDelay);
    retryDelay = Math.min(retryDelay * 2, MAX_RETRY_DELAY);
  };
}

/**
 * 断开 SSE / Disconnect SSE
 */
export function disconnectSSE() {
  if (eventSource) {
    eventSource.close();
    eventSource = null;
  }
  useStore.getState().setConnected(false);
}

/**
 * 初始加载所有数据 / Initial load of all data
 *
 * 批量拉取所有端点填充 store。
 * Bulk-fetch all endpoints to populate store.
 *
 * @param {string} [basePath=''] - API base path
 */
export async function loadInitialData(basePath = '') {
  const s = useStore.getState();

  const fetches = [
    // ── 核心数据 / Core data ──
    fetchAndUpdate(`${basePath}/api/v1/agent-states`, (d) => {
      const states = d?.states || {};
      const arr = Array.isArray(states)
        ? states
        : Object.entries(states).map(([id, info]) => ({
            id,
            ...(typeof info === 'object' && info !== null ? info : { state: info }),
          }));
      s.updateAgents(arr);
    }),
    fetchAndUpdate(`${basePath}/api/v1/dag-status`, (d) => {
      const nodes = [];
      if (Array.isArray(d?.dags)) {
        for (const dag of d.dags) {
          if (Array.isArray(dag?.nodes)) nodes.push(...dag.nodes);
        }
      } else if (Array.isArray(d?.nodes)) {
        nodes.push(...d.nodes);
      }
      if (nodes.length > 0) s.updateTasks(nodes);
    }),
    fetchAndUpdate(`${basePath}/api/metrics`, (d) => {
      // pheromonesByType 是事件计数, 需要归一化为 0-1 浓度
      // pheromonesByType is event counts, normalize to 0-1 concentration
      if (d?.pheromonesByType) {
        const counts = d.pheromonesByType;
        const maxCount = Math.max(1, ...Object.values(counts));
        const normalized = {};
        for (const [type, count] of Object.entries(counts)) {
          if (type !== 'unknown') normalized[type] = count / maxCount;
        }
        s.updatePheromones({ ...s.pheromones, ...normalized });
      }
      // V7.2 B3.5: 映射后端 avgDuration → 前端 duration / Map backend avgDuration → frontend duration
      if (d?.red) s.updateRed({
        rate: d.red.rate ?? 0,
        errorRate: d.red.errorRate ?? 0,
        duration: d.red.avgDuration ?? d.red.duration ?? 0,
      });
    }),
    fetchAndUpdate(`${basePath}/api/v1/modulator`, (d) => {
      if (d?.mode) s.updateMode({ m: d.mode, turns: d.turns || 0, f: d.factors || {} });
    }),
    fetchAndUpdate(`${basePath}/api/v1/breaker-status`, (d) => {
      if (d) s.updateBreaker(d);
    }),

    // ── V5.6 指标 / V5.6 metrics ──
    fetchAndUpdate(`${basePath}/api/v1/shapley`, (d) => {
      s.updateShapley(d?.credits ?? d ?? {});
    }),
    fetchAndUpdate(`${basePath}/api/v1/budget-forecast`, (d) => {
      const f = d?.forecast || d || {};
      s.updateBudget({
        consumed: f.consumed ?? d?.consumed ?? 0,
        total: f.total ?? d?.total ?? 1,
        remaining: f.estimatedRemaining ?? f.remaining ?? 0,
        risk: f.exhaustionRisk ?? f.risk ?? 'low',
      });
    }),
    fetchAndUpdate(`${basePath}/api/v1/dual-process`, (d) => {
      const st = d?.stats || d || {};
      s.updateDual({
        s1: st.system1 ?? st.s1 ?? 0,
        s2: st.system2 ?? st.s2 ?? 0,
        total: st.total ?? 0,
      });
    }),
    fetchAndUpdate(`${basePath}/api/v1/quality-audit`, (d) => {
      s.updateQuality({
        passRate: d?.passRate ?? 0,
        total: d?.totalEvaluations ?? d?.total ?? 0,
        entries: d?.entries ?? [],
      });
    }),

    // ── V7.0 新端点 / V7.0 new endpoints ──
    fetchAndUpdate(`${basePath}/api/v1/signal-weights`, (d) => {
      if (d?.weights) s.updateSignals(d.weights);
    }),
    fetchAndUpdate(`${basePath}/api/v1/pi-controller`, (d) => {
      if (d?.stats) s.updatePIController({
        kp: d.stats.kp || 0, ki: d.stats.ki || 0,
        output: d.stats.output || 0, integral: d.stats.integral || 0,
      });
    }),
    fetchAndUpdate(`${basePath}/api/v1/cold-start`, (d) => {
      if (d?.coldStart) s.updateColdStart(d.coldStart);
    }),
    fetchAndUpdate(`${basePath}/api/v1/bid-history`, (d) => {
      if (d?.cfpsCreated !== undefined) {
        s.batchUpdate({ bidStats: d });
      }
    }),
    fetchAndUpdate(`${basePath}/api/v1/active-sessions`, (d) => {
      if (d?.sessions && Array.isArray(d.sessions)) {
        for (const sess of d.sessions) {
          s.addSubAgent({
            id: sess.key || sess.id, parentId: sess.parentId,
            role: sess.role || 'worker', state: sess.state || 'ACTIVE',
            task: sess.task || '',
          });
        }
      }
    }),
    // ── SNA 网络边 / SNA network edges ──
    fetchAndUpdate(`${basePath}/api/v1/sna`, (d) => {
      if (Array.isArray(d?.edges) && d.edges.length > 0) {
        s.updateEdges(d.edges);
      }
    }),
  ];

  const results = await Promise.allSettled(fetches);

  // 检测所有 fetch 是否都失败 — 如果全部失败则抛错,
  // 触发 App.jsx 中的 .catch() 降级到 mock 模式。
  // Detect total failure to trigger mock mode fallback.
  const anySucceeded = results.some(
    (r) => r.status === 'fulfilled' && r.value !== false,
  );
  if (!anySucceeded) {
    throw new Error('All API endpoints unreachable — switching to mock mode');
  }

  // O3: 记录初始加载时间 / Record initial data load time
  _lastDataLoadTime = Date.now();

  // V7.2 B1.5: RED 定时轮询 (10s) / RED polling timer (10s)
  if (_redPollTimer) clearInterval(_redPollTimer);
  _redPollTimer = setInterval(() => {
    fetchAndUpdate(`${basePath}/api/metrics`, (d) => {
      if (d?.red) useStore.getState().updateRed({
        rate: d.red.rate ?? 0,
        errorRate: d.red.errorRate ?? 0,
        duration: d.red.avgDuration ?? d.red.duration ?? 0,
      });
    });
  }, 10000);

  // 从已知代理关系构建网络边 (补充 SNA 边) / Build edges from known agent relationships
  const st = useStore.getState();
  const builtEdges = [];
  const agentIds = (st.agents || []).map((a) => a.id).filter(Boolean);

  // 1) 从 subAgents 列表构建委托边 / Delegate edges from subAgents
  for (const sub of st.subAgents || []) {
    if (sub.parentId && sub.id) {
      builtEdges.push({ source: sub.parentId, target: sub.id, weight: 1, type: 'delegate' });
    }
  }

  // 2) 从 agent ID 模式检测 parent-child 关系 / Detect hierarchy from agent ID patterns
  //    e.g. "agent:mpu-d1:subagent:uuid" → parent is "main"
  for (const id of agentIds) {
    if (id !== 'main' && id.includes('subagent')) {
      const alreadyLinked = builtEdges.some((e) => e.target === id && e.source === 'main');
      if (!alreadyLinked && agentIds.includes('main')) {
        builtEdges.push({ source: 'main', target: id, weight: 1, type: 'delegate' });
      }
    }
  }

  // 3) 为所有代理对构建通信边 / Communication edges between all agent pairs
  for (let i = 0; i < agentIds.length; i++) {
    for (let j = i + 1; j < agentIds.length; j++) {
      const hasDirectEdge = builtEdges.some(
        (e) => (e.source === agentIds[i] && e.target === agentIds[j]) ||
               (e.source === agentIds[j] && e.target === agentIds[i]),
      );
      if (!hasDirectEdge) {
        builtEdges.push({ source: agentIds[i], target: agentIds[j], weight: 0.5, type: 'communication' });
      }
    }
  }

  // 合并: SNA 边优先，fallback 补充 / Merge: SNA edges take priority
  if (builtEdges.length > 0) {
    const existing = st.edges || [];
    if (existing.length === 0) {
      st.updateEdges(builtEdges);
    } else {
      // 合并不重复的边 / Merge unique edges
      const edgeKeys = new Set(existing.map((e) => `${e.source}|${e.target}`));
      const merged = [...existing];
      for (const e of builtEdges) {
        if (!edgeKeys.has(`${e.source}|${e.target}`) && !edgeKeys.has(`${e.target}|${e.source}`)) {
          merged.push(e);
        }
      }
      if (merged.length > existing.length) st.updateEdges(merged);
    }
  }
}
