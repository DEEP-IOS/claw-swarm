/**
 * SNA Topology Panel — Social Network Analysis visualization
 * SNA 拓扑面板 — 社交网络分析可视化
 */
let _container, _dataBus, _state, _fetchAPI, _unsubs = [];

export function init(container, dataBus, state, fetchAPI) {
  _container = container; _dataBus = dataBus; _state = state; _fetchAPI = fetchAPI;
  render();
  _unsubs.push(dataBus.on('v6.sna', () => render()));
  setInterval(refresh, 15000);
  refresh();
}

async function refresh() {
  const data = await _fetchAPI('/api/v1/sna');
  if (data) { _state.v6.sna = data; render(); }
}

function render() {
  const sna = _state.v6?.sna;
  if (!sna || !sna.metrics) {
    _container.innerHTML = '<div class="v6-panel"><h4>SNA Network Topology</h4><div class="empty-state"><div class="es-icon">&#x1f310;</div>No SNA data available yet.<br>SNA metrics are computed every 50 turns.</div></div>';
    return;
  }

  const metrics = sna.metrics || {};
  const agents = Object.keys(metrics);
  const edgeCount = sna.edgeCount || 0;

  let html = '<div class="v6-panel"><h4>SNA Network Topology</h4>';

  // Summary cards
  html += '<div class="v6-grid-2" style="margin-bottom:16px">';
  html += `<div class="v6-mini-card"><div class="mc-val">${agents.length}</div><div class="mc-label">Agents</div></div>`;
  html += `<div class="v6-mini-card"><div class="mc-val">${edgeCount}</div><div class="mc-label">Edges</div></div>`;
  html += '</div>';

  // Degree centrality bars
  html += '<h4 style="margin-top:12px">Degree Centrality</h4>';
  const sortedByDegree = agents.map(a => ({ id: a, ...metrics[a] })).sort((a, b) => (b.degreeCentrality || 0) - (a.degreeCentrality || 0));
  for (const agent of sortedByDegree.slice(0, 10)) {
    const pct = Math.round((agent.degreeCentrality || 0) * 100);
    html += `<div class="v6-chart-bar"><span class="bar-label">${agent.id.slice(0, 12)}</span><div class="bar-track"><div class="bar-fill" style="width:${pct}%;background:var(--blue)"></div></div><span class="bar-value">${(agent.degreeCentrality || 0).toFixed(2)}</span></div>`;
  }

  // Betweenness centrality bars
  html += '<h4 style="margin-top:16px">Betweenness Centrality</h4>';
  const sortedByBetween = agents.map(a => ({ id: a, ...metrics[a] })).sort((a, b) => (b.betweennessCentrality || 0) - (a.betweennessCentrality || 0));
  for (const agent of sortedByBetween.slice(0, 10)) {
    const pct = Math.round(Math.min(1, agent.betweennessCentrality || 0) * 100);
    html += `<div class="v6-chart-bar"><span class="bar-label">${agent.id.slice(0, 12)}</span><div class="bar-track"><div class="bar-fill" style="width:${pct}%;background:var(--purple)"></div></div><span class="bar-value">${(agent.betweennessCentrality || 0).toFixed(3)}</span></div>`;
  }

  // Clustering coefficient bars
  html += '<h4 style="margin-top:16px">Clustering Coefficient</h4>';
  const sortedByCluster = agents.map(a => ({ id: a, ...metrics[a] })).sort((a, b) => (b.clusteringCoefficient || 0) - (a.clusteringCoefficient || 0));
  for (const agent of sortedByCluster.slice(0, 10)) {
    const pct = Math.round((agent.clusteringCoefficient || 0) * 100);
    html += `<div class="v6-chart-bar"><span class="bar-label">${agent.id.slice(0, 12)}</span><div class="bar-track"><div class="bar-fill" style="width:${pct}%;background:var(--emerald)"></div></div><span class="bar-value">${(agent.clusteringCoefficient || 0).toFixed(3)}</span></div>`;
  }

  html += '</div>';
  _container.innerHTML = html;
}

export function update(data) { render(); }
export function destroy() { _unsubs.forEach(u => u()); _unsubs = []; }
