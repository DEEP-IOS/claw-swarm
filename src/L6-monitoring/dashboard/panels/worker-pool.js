/**
 * Worker Pool Monitor Panel — worker thread pool visualization
 * 工作线程池监控面板 — 线程池运行状态可视化
 */
let _container, _dataBus, _state, _fetchAPI, _unsubs = [];

export function init(container, dataBus, state, fetchAPI) {
  _container = container; _dataBus = dataBus; _state = state; _fetchAPI = fetchAPI;
  render();
  _unsubs.push(dataBus.on('v6.workers', () => render()));
  setInterval(refresh, 8000);
  refresh();
}

async function refresh() {
  const data = await _fetchAPI('/api/v1/workers');
  if (data) { _state.v6.workerPool = data; render(); }
}

function render() {
  const wp = _state.v6?.workerPool;
  if (!wp) {
    _container.innerHTML = '<div class="v6-panel"><h4>Worker Thread Pool</h4><div class="empty-state"><div class="es-icon">&#x2699;</div>Worker pool data not available.<br>Workers are created when SwarmCore initializes.</div></div>';
    return;
  }

  const stats = wp.stats || wp;
  const active = stats.active || 0;
  const idle = stats.idle || 0;
  const queued = stats.queued || 0;
  const completed = stats.completed || 0;
  const errors = stats.errors || 0;
  const total = active + idle;
  const utilization = total > 0 ? Math.round((active / total) * 100) : 0;

  let html = '<div class="v6-panel"><h4>Worker Thread Pool</h4>';

  // Summary cards
  html += '<div class="v6-grid-2" style="margin-bottom:16px">';
  html += `<div class="v6-mini-card"><div class="mc-val" style="color:var(--emerald)">${active}</div><div class="mc-label">Active</div></div>`;
  html += `<div class="v6-mini-card"><div class="mc-val" style="color:var(--text-dim)">${idle}</div><div class="mc-label">Idle</div></div>`;
  html += `<div class="v6-mini-card"><div class="mc-val" style="color:var(--amber)">${queued}</div><div class="mc-label">Queued</div></div>`;
  html += `<div class="v6-mini-card"><div class="mc-val" style="color:var(--blue)">${completed}</div><div class="mc-label">Completed</div></div>`;
  html += '</div>';

  // Utilization bar
  html += '<h4>Utilization</h4>';
  html += `<div class="v6-chart-bar"><span class="bar-label">CPU Usage</span><div class="bar-track"><div class="bar-fill" style="width:${utilization}%;background:${utilization>80?'var(--red)':utilization>50?'var(--amber)':'var(--emerald)'}"></div></div><span class="bar-value">${utilization}%</span></div>`;

  // Stats
  html += '<h4 style="margin-top:16px">Statistics</h4>';
  html += `<div class="v6-stat"><span class="label">Total Workers</span><span class="value">${total}</span></div>`;
  html += `<div class="v6-stat"><span class="label">Tasks Completed</span><span class="value" style="color:var(--emerald)">${completed}</span></div>`;
  html += `<div class="v6-stat"><span class="label">Errors</span><span class="value" style="color:var(--red)">${errors}</span></div>`;
  html += `<div class="v6-stat"><span class="label">Queue Depth</span><span class="value">${queued}</span></div>`;

  // Worker types
  if (stats.workerTypes) {
    html += '<h4 style="margin-top:16px">Worker Types</h4>';
    for (const [type, count] of Object.entries(stats.workerTypes)) {
      html += `<div class="v6-stat"><span class="label">${type}</span><span class="value">${count}</span></div>`;
    }
  }

  html += '</div>';
  _container.innerHTML = html;
}

export function update(data) { render(); }
export function destroy() { _unsubs.forEach(u => u()); _unsubs = []; }
