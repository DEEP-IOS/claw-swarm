/**
 * Quality Timeline Panel — quality audit chain + failure modes + budget
 * 质量时间线面板 — 质量审计链 + 失败模式 + 预算可视化
 */
let _container, _dataBus, _state, _fetchAPI, _unsubs = [];

export function init(container, dataBus, state, fetchAPI) {
  _container = container; _dataBus = dataBus; _state = state; _fetchAPI = fetchAPI;
  render();
  _unsubs.push(dataBus.on('v6.qualityAudit', () => render()));
  _unsubs.push(dataBus.on('v6.failureModes', () => render()));
  _unsubs.push(dataBus.on('v6.budgetForecast', () => render()));
  setInterval(refresh, 12000);
  refresh();
}

async function refresh() {
  const [qa, fm, bf] = await Promise.all([
    _fetchAPI('/api/v1/quality-audit'),
    _fetchAPI('/api/v1/failure-modes'),
    _fetchAPI('/api/v1/budget-forecast'),
  ]);
  if (qa) { _state.v6.qualityAudit = qa; }
  if (fm) { _state.v6.failureModes = fm; }
  if (bf) { _state.v6.budgetForecast = bf; }
  render();
}

function render() {
  let html = '<div class="v6-panel">';

  // ── Quality Audit ──
  html += '<h4>Quality Audit Trail</h4>';
  const qa = _state.v6?.qualityAudit;
  if (qa && qa.entries && qa.entries.length > 0) {
    const passRate = qa.passRate != null ? (qa.passRate * 100).toFixed(1) : '--';
    html += `<div class="v6-stat"><span class="label">Pass Rate</span><span class="value" style="color:var(--emerald)">${passRate}%</span></div>`;
    html += `<div class="v6-stat"><span class="label">Total Evaluations</span><span class="value">${qa.totalEvaluations || qa.entries.length}</span></div>`;
    html += '<div style="margin-top:8px">';
    for (const entry of (qa.entries || []).slice(0, 10)) {
      const icon = entry.verdict === 'PASS' ? '\u2705' : entry.verdict === 'FAIL' ? '\u274C' : '\u26A0\uFE0F';
      const color = entry.verdict === 'PASS' ? 'var(--emerald)' : entry.verdict === 'FAIL' ? 'var(--red)' : 'var(--amber)';
      html += `<div class="v6-stat"><span class="label">${icon} ${(entry.task_id || '?').slice(0, 16)} (${entry.tier || '?'})</span><span class="value" style="color:${color}">${entry.overall_score != null ? entry.overall_score.toFixed(2) : '--'}</span></div>`;
    }
    html += '</div>';
  } else {
    html += '<div class="empty-state" style="padding:16px">No quality audit records yet</div>';
  }

  // ── Failure Modes ──
  html += '<h4 style="margin-top:20px">Failure Mode Analysis</h4>';
  const fm = _state.v6?.failureModes;
  if (fm && fm.categories) {
    const cats = fm.categories;
    const total = Object.values(cats).reduce((s, v) => s + v, 0) || 1;
    const catColors = { INPUT_ERROR: 'var(--amber)', TIMEOUT: 'var(--blue)', LLM_REFUSAL: 'var(--purple)', NETWORK: 'var(--red)', RESOURCE_EXHAUSTION: 'var(--cyan)' };
    for (const [cat, count] of Object.entries(cats).sort((a, b) => b[1] - a[1])) {
      const pct = Math.round((count / total) * 100);
      html += `<div class="v6-chart-bar"><span class="bar-label">${cat.replace(/_/g, ' ')}</span><div class="bar-track"><div class="bar-fill" style="width:${pct}%;background:${catColors[cat] || 'var(--text-dim)'}"></div></div><span class="bar-value">${count}</span></div>`;
    }
    if (fm.trends) {
      html += '<div style="margin-top:8px;font-size:11px;color:var(--text-dim)">';
      for (const [cat, trend] of Object.entries(fm.trends)) {
        const arrow = trend === 'rising' ? '\u2191' : trend === 'falling' ? '\u2193' : '\u2192';
        const color = trend === 'rising' ? 'var(--red)' : trend === 'falling' ? 'var(--emerald)' : 'var(--text-dim)';
        html += `<span style="margin-right:12px;color:${color}">${arrow} ${cat.replace(/_/g, ' ')}</span>`;
      }
      html += '</div>';
    }
  } else {
    html += '<div class="empty-state" style="padding:16px">No failure data available</div>';
  }

  // ── Budget Forecast ──
  html += '<h4 style="margin-top:20px">Budget Forecast</h4>';
  const bf = _state.v6?.budgetForecast;
  if (bf && bf.forecast) {
    const f = bf.forecast;
    const riskColor = f.exhaustionRisk === 'high' ? 'var(--red)' : f.exhaustionRisk === 'medium' ? 'var(--amber)' : 'var(--emerald)';
    html += `<div class="v6-stat"><span class="label">Est. Remaining</span><span class="value">${f.estimatedRemaining != null ? f.estimatedRemaining.toFixed(0) + ' tokens' : '--'}</span></div>`;
    html += `<div class="v6-stat"><span class="label">Confidence</span><span class="value">${f.confidence != null ? (f.confidence * 100).toFixed(0) + '%' : '--'}</span></div>`;
    html += `<div class="v6-stat"><span class="label">Exhaustion Risk</span><span class="value" style="color:${riskColor}">${(f.exhaustionRisk || 'unknown').toUpperCase()}</span></div>`;

    if (f.exhaustionRisk === 'high') {
      html += '<div class="v6-alert warn" style="margin-top:8px">Budget exhaustion warning — remaining tokens may be insufficient</div>';
    }
  } else {
    html += '<div class="empty-state" style="padding:16px">No budget forecast available</div>';
  }

  html += '</div>';
  _container.innerHTML = html;
}

export function update(data) { render(); }
export function destroy() { _unsubs.forEach(u => u()); _unsubs = []; }
