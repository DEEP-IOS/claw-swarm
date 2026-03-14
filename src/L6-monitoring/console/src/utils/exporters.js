/**
 * Export helpers for Console V7.
 * 控制台 V7 导出工具集。
 * - PNG (merged canvas layers / 合并 Canvas 图层)
 * - JSON (state snapshot / 状态快照)
 * - CSV (timeline events / 时间线事件)
 */

function stamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function exportCanvasPNG({ canvasBg, canvasFx, canvasFg, prefix = 'swarm-console' }) {
  if (!canvasBg || !canvasFx || !canvasFg) return false;
  const w = canvasFg.width;
  const h = canvasFg.height;
  if (!w || !h) return false;

  const merged = document.createElement('canvas');
  merged.width = w;
  merged.height = h;
  const ctx = merged.getContext('2d');
  ctx.drawImage(canvasBg, 0, 0);
  ctx.drawImage(canvasFx, 0, 0);
  ctx.drawImage(canvasFg, 0, 0);

  merged.toBlob((blob) => {
    if (!blob) return;
    downloadBlob(blob, `${prefix}-${stamp()}.png`);
  }, 'image/png');
  return true;
}

export function exportStateJSON(state, { prefix = 'swarm-state' } = {}) {
  const snapshot = {
    ts: Date.now(),
    view: state.view,
    mode: state.mode,
    health: state.health,
    agents: state.agents,
    subAgents: state.subAgents,
    tasks: state.tasks,
    pheromones: state.pheromones,
    edges: state.edges,
    shapley: state.shapley,
    red: state.red,
    budget: state.budget,
    breaker: state.breaker,
    dual: state.dual,
    quality: state.quality,
    signals: state.signals,
    piController: state.piController,
    coldStart: state.coldStart,
    bidHistory: state.bidHistory,
    timelineEvents: state.timelineEvents,
  };
  const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json;charset=utf-8' });
  downloadBlob(blob, `${prefix}-${stamp()}.json`);
  return true;
}

function escapeCsv(v) {
  const s = String(v ?? '');
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function exportTimelineCSV(events = [], { prefix = 'swarm-events' } = {}) {
  const header = ['ts_iso', 'type', 'title', 'body', 'agent_id', 'task_id'];
  const rows = events.map((e) => [
    new Date(e.ts || Date.now()).toISOString(),
    e.type || '',
    e.title || e.message || '',
    e.body || '',
    e.agentId || '',
    e.taskId || '',
  ]);
  const csv = [header, ...rows].map((r) => r.map(escapeCsv).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  downloadBlob(blob, `${prefix}-${stamp()}.csv`);
  return true;
}
