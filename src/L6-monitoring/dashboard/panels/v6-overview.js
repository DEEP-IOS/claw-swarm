/**
 * Overview Panel — Shapley credits, dual-process routing, agent states,
 * 总览面板 — Shapley 信用、双过程路由、代理状态、
 * vector stats, IPC latency, DLQ status
 * 向量统计、IPC 延迟、死信队列状态
 */
let _container, _dataBus, _state, _fetchAPI, _unsubs = [];

export function init(container, dataBus, state, fetchAPI) {
  _container = container; _dataBus = dataBus; _state = state; _fetchAPI = fetchAPI;
  render();
  _unsubs.push(dataBus.on('v6.shapley', () => render()));
  _unsubs.push(dataBus.on('v6.dualProcess', () => render()));
  _unsubs.push(dataBus.on('v6.agentStates', () => render()));
  _unsubs.push(dataBus.on('v6.vectorStats', () => render()));
  _unsubs.push(dataBus.on('v6.ipcStats', () => render()));
  setInterval(refresh, 10000);
  refresh();
}

async function refresh() {
  const [sh, dp, as, vs, ip, dl] = await Promise.all([
    _fetchAPI('/api/v1/shapley'),
    _fetchAPI('/api/v1/dual-process'),
    _fetchAPI('/api/v1/agent-states'),
    _fetchAPI('/api/v1/vectors'),
    _fetchAPI('/api/v1/ipc-stats'),
    _fetchAPI('/api/v1/dead-letters'),
  ]);
  if (sh) _state.v6.shapley = sh;
  if (dp) _state.v6.dualProcess = dp;
  if (as) _state.v6.agentStates = as;
  if (vs) _state.v6.vectorStats = vs;
  if (ip) _state.v6.ipcStats = ip;
  render();
}

function render() {
  let html = '<div class="v6-panel" style="display:grid;grid-template-columns:1fr 1fr;gap:20px">';

  // ── Dual-Process Router ──
  html += '<div>';
  html += '<h4>System 1/2 Dual-Process Router</h4>';
  const dp = _state.v6?.dualProcess;
  if (dp && dp.stats) {
    const s1 = dp.stats.system1 || 0, s2 = dp.stats.system2 || 0, total = s1 + s2 || 1;
    const s1pct = Math.round(s1 / total * 100), s2pct = 100 - s1pct;
    html += '<div class="v6-grid-2" style="margin-bottom:12px">';
    html += `<div class="v6-mini-card"><div class="mc-val" style="color:var(--emerald)">${s1}</div><div class="mc-label">System 1 (Fast)</div></div>`;
    html += `<div class="v6-mini-card"><div class="mc-val" style="color:var(--blue)">${s2}</div><div class="mc-label">System 2 (Slow)</div></div>`;
    html += '</div>';
    html += `<div class="v6-chart-bar"><span class="bar-label">S1 DIRECT</span><div class="bar-track"><div class="bar-fill" style="width:${s1pct}%;background:var(--emerald)"></div></div><span class="bar-value">${s1pct}%</span></div>`;
    html += `<div class="v6-chart-bar"><span class="bar-label">S2 PREPLAN</span><div class="bar-track"><div class="bar-fill" style="width:${s2pct}%;background:var(--blue)"></div></div><span class="bar-value">${s2pct}%</span></div>`;
    html += `<div class="v6-stat" style="margin-top:8px"><span class="label">S1 Ratio</span><span class="value">${dp.stats.s1Ratio != null ? (dp.stats.s1Ratio * 100).toFixed(0) + '%' : '--'}</span></div>`;
    html += `<div class="v6-stat"><span class="label">Seen Task Types</span><span class="value">${dp.stats.seenTaskTypes || 0}</span></div>`;
  } else {
    html += '<div class="empty-state" style="padding:16px">No routing data</div>';
  }
  html += '</div>';

  // ── Shapley Credits ──
  html += '<div>';
  html += '<h4>Shapley Credit Attribution</h4>';
  const sh = _state.v6?.shapley;
  if (sh && sh.credits) {
    const entries = Object.entries(sh.credits).sort((a, b) => b[1] - a[1]);
    const maxCredit = Math.max(0.01, ...entries.map(e => e[1]));
    for (const [agentId, credit] of entries.slice(0, 10)) {
      const pct = Math.round((credit / maxCredit) * 100);
      html += `<div class="v6-chart-bar"><span class="bar-label">${agentId.slice(0, 12)}</span><div class="bar-track"><div class="bar-fill" style="width:${pct}%;background:var(--amber)"></div></div><span class="bar-value">${credit.toFixed(3)}</span></div>`;
    }
    if (sh.dagId) html += `<div style="font-size:10px;color:var(--text-dim);margin-top:6px">DAG: ${sh.dagId.slice(0, 20)}</div>`;
  } else {
    html += '<div class="empty-state" style="padding:16px">No Shapley data yet</div>';
  }
  html += '</div>';

  // ── Agent States ──
  html += '<div>';
  html += '<h4>Agent State Machine</h4>';
  const as = _state.v6?.agentStates;
  if (as && as.states) {
    const stateColors = { IDLE: 'var(--text-dim)', ASSIGNED: 'var(--blue)', EXECUTING: 'var(--amber)', REPORTING: 'var(--purple)' };
    const entries = Object.entries(as.states);
    if (entries.length > 0) {
      html += '<div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:12px">';
      for (const [agentId, st] of entries) {
        const color = stateColors[st] || 'var(--text-dim)';
        html += `<div style="background:var(--bg-primary);padding:4px 8px;border-radius:6px;font-size:10px;border-left:3px solid ${color}"><span style="color:var(--text-dim)">${agentId.slice(0, 10)}</span> <span style="font-weight:700;color:${color}">${st}</span></div>`;
      }
      html += '</div>';
    } else {
      html += '<div class="empty-state" style="padding:12px">No active agents</div>';
    }
  } else {
    html += '<div class="empty-state" style="padding:16px">No agent state data</div>';
  }
  html += '</div>';

  // ── Vector Index Stats ──
  html += '<div>';
  html += '<h4>Vector Index</h4>';
  const vs = _state.v6?.vectorStats;
  if (vs) {
    html += `<div class="v6-stat"><span class="label">Index Size</span><span class="value">${vs.indexSize || vs.size || 0}</span></div>`;
    html += `<div class="v6-stat"><span class="label">Dimensions</span><span class="value">${vs.dimensions || '--'}</span></div>`;
    html += `<div class="v6-stat"><span class="label">Mode</span><span class="value">${vs.mode || 'local'}</span></div>`;
    html += `<div class="v6-stat"><span class="label">HNSW Active</span><span class="value">${vs.useHNSW ? 'Yes' : 'Fallback'}</span></div>`;
    if (vs.queryCount != null) html += `<div class="v6-stat"><span class="label">Total Queries</span><span class="value">${vs.queryCount}</span></div>`;
  } else {
    html += '<div class="empty-state" style="padding:16px">No vector index data</div>';
  }
  html += '</div>';

  // ── IPC Latency ──
  html += '<div>';
  html += '<h4>IPC Latency</h4>';
  const ip = _state.v6?.ipcStats;
  if (ip && ip.latency) {
    const l = ip.latency;
    html += `<div class="v6-stat"><span class="label">p50</span><span class="value">${l.p50 != null ? l.p50.toFixed(1) + 'ms' : '--'}</span></div>`;
    html += `<div class="v6-stat"><span class="label">p95</span><span class="value" style="color:${(l.p95||0)>2?'var(--amber)':'var(--emerald)'}">${l.p95 != null ? l.p95.toFixed(1) + 'ms' : '--'}</span></div>`;
    html += `<div class="v6-stat"><span class="label">p99</span><span class="value" style="color:${(l.p99||0)>5?'var(--red)':'var(--emerald)'}">${l.p99 != null ? l.p99.toFixed(1) + 'ms' : '--'}</span></div>`;
    html += `<div class="v6-stat"><span class="label">Total Calls</span><span class="value">${ip.totalCalls || 0}</span></div>`;
  } else {
    html += '<div class="empty-state" style="padding:16px">No IPC stats</div>';
  }
  html += '</div>';

  // ── DLQ Status ──
  html += '<div>';
  html += '<h4>Dead Letter Queue</h4>';
  const dl = _state.v6?.dlqStatus;
  if (dl) {
    const pending = dl.pending || 0, retrying = dl.retrying || 0, exhausted = dl.exhausted || 0;
    html += `<div class="v6-stat"><span class="label">Pending</span><span class="value" style="color:${pending>5?'var(--amber)':'var(--text-primary)'}">${pending}</span></div>`;
    html += `<div class="v6-stat"><span class="label">Retrying</span><span class="value" style="color:var(--blue)">${retrying}</span></div>`;
    html += `<div class="v6-stat"><span class="label">Exhausted</span><span class="value" style="color:var(--red)">${exhausted}</span></div>`;
    html += `<div class="v6-stat"><span class="label">Total</span><span class="value">${dl.total || 0}</span></div>`;
    if (pending > 10) html += '<div class="v6-alert warn" style="margin-top:6px">DLQ backlog is growing</div>';
  } else {
    html += '<div class="empty-state" style="padding:16px">No DLQ data</div>';
  }
  html += '</div>';

  html += '</div>';
  _container.innerHTML = html;
}

export function update(data) { render(); }
export function destroy() { _unsubs.forEach(u => u()); _unsubs = []; }
