import React, { useMemo } from 'react';
import useStore from '../store.js';
import { ROLE_COLORS, hexToRgba, shortId } from '../bridge/colors.js';

const SNA_METRICS = [
  { key: 'centrality', en: 'Centrality', zh: '中心性', icon: '◎' },
  { key: 'clustering', en: 'Clustering', zh: '聚类系数', icon: '◈' },
  { key: 'modularity', en: 'Modularity', zh: '模块度', icon: '⬡' },
];

const EDGE_TYPES = [
  { key: 'delegate', color: '#F5A623', zh: '委托' },
  { key: 'review', color: '#8B5CF6', zh: '审查' },
  { key: 'report', color: '#06B6D4', zh: '报告' },
  { key: 'communication', color: '#6B7280', zh: '通信' },
];

function normalizeUndirectedEdges(edges = []) {
  const seen = new Set();
  const out = [];
  for (const e of edges) {
    const a = e.source;
    const b = e.target;
    if (!a || !b || a === b) continue;
    const k = a < b ? `${a}|${b}` : `${b}|${a}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ source: a, target: b, weight: Number(e.weight) || 1 });
  }
  return out;
}

function buildAdjacency(agentIds, undirectedEdges) {
  const adj = new Map(agentIds.map((id) => [id, new Set()]));
  for (const e of undirectedEdges) {
    if (!adj.has(e.source)) adj.set(e.source, new Set());
    if (!adj.has(e.target)) adj.set(e.target, new Set());
    adj.get(e.source).add(e.target);
    adj.get(e.target).add(e.source);
  }
  return adj;
}

function calcSNAMetrics(agents, edges) {
  const ids = agents.map((a) => a.id).filter(Boolean);
  const n = ids.length;
  if (n < 2) return { centrality: '0.000', clustering: '0.000', modularity: '0.000', density: '0.000' };

  const undirected = normalizeUndirectedEdges(edges);
  const m = undirected.length;
  const density = (2 * m) / (n * (n - 1));

  const adj = buildAdjacency(ids, undirected);
  const deg = new Map(ids.map((id) => [id, adj.get(id)?.size || 0]));
  const centrality = ids.reduce((acc, id) => acc + (deg.get(id) / (n - 1)), 0) / n;

  // Average local clustering coefficient.
  let clusteringSum = 0;
  for (const id of ids) {
    const neighbors = [...(adj.get(id) || [])];
    const k = neighbors.length;
    if (k < 2) continue;
    let links = 0;
    for (let i = 0; i < k; i++) {
      for (let j = i + 1; j < k; j++) {
        if (adj.get(neighbors[i])?.has(neighbors[j])) links += 1;
      }
    }
    clusteringSum += (2 * links) / (k * (k - 1));
  }
  const clustering = clusteringSum / n;

  // Role-based modularity approximation.
  const roleMap = new Map(agents.map((a) => [a.id, a.role || 'default']));
  let modularityNum = 0;
  const twoM = 2 * Math.max(m, 1);
  const hasEdge = new Set(undirected.map((e) => (e.source < e.target ? `${e.source}|${e.target}` : `${e.target}|${e.source}`)));
  for (let i = 0; i < ids.length; i++) {
    for (let j = 0; j < ids.length; j++) {
      const idA = ids[i];
      const idB = ids[j];
      if (roleMap.get(idA) !== roleMap.get(idB)) continue;
      const key = idA < idB ? `${idA}|${idB}` : `${idB}|${idA}`;
      const aij = hasEdge.has(key) ? 1 : 0;
      modularityNum += aij - ((deg.get(idA) * deg.get(idB)) / twoM);
    }
  }
  const modularity = modularityNum / twoM;

  return {
    centrality: centrality.toFixed(3),
    clustering: clustering.toFixed(3),
    modularity: modularity.toFixed(3),
    density: density.toFixed(3),
  };
}

export default function NetworkOverlay() {
  const shapley = useStore((s) => s.shapley);
  const agents = useStore((s) => s.agents);
  const edges = useStore((s) => s.edges);

  // 只取数值型 credit，过滤非 agent 数据 / Filter to numeric credits only
  const ranked = Object.entries(shapley || {})
    .filter(([, v]) => typeof v === 'number')
    .sort(([, a], [, b]) => b - a);
  const maxCredit = ranked.length > 0 ? ranked[0][1] : 1;

  const edgeCounts = {};
  (edges || []).forEach((e) => {
    const t = e.type || 'communication';
    edgeCounts[t] = (edgeCounts[t] || 0) + 1;
  });

  const sna = useMemo(() => calcSNAMetrics(agents || [], edges || []), [agents, edges]);
  const nodeCount = agents.length;
  const edgeCount = (edges || []).length;

  return (
    <div style={{ pointerEvents: 'none', padding: 14, height: '100%', display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ color: '#06B6D4', fontSize: 14, fontWeight: 700 }}>
            网络拓扑
          </div>
        </div>
        <div style={{ fontSize: 9, color: '#6B7280', textAlign: 'right' }}>
          <div>{nodeCount} 节点 · {edgeCount} 连线</div>
          <div>密度: {sna.density}</div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 6 }}>
        {SNA_METRICS.map((m) => (
          <div key={m.key} style={{
            flex: 1,
            background: hexToRgba('#06B6D4', 0.06),
            border: `1px solid ${hexToRgba('#06B6D4', 0.15)}`,
            borderRadius: 6,
            padding: '6px 8px',
            textAlign: 'center',
          }}>
            <div style={{ fontSize: 14, color: '#06B6D4', marginBottom: 2 }}>{m.icon}</div>
            <div style={{ fontSize: 10, color: '#06B6D4', fontWeight: 600, fontFamily: 'var(--font-zh)' }}>{m.zh}</div>
            <div style={{ fontSize: 14, fontFamily: 'var(--font-mono)', color: '#E5E7EB', marginTop: 4 }}>
              {sna[m.key]}
            </div>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 4 }}>
        {EDGE_TYPES.map((et) => (
          <div key={et.key} style={{
            flex: 1, textAlign: 'center', padding: '3px 0',
            background: hexToRgba(et.color, 0.08), borderRadius: 4,
          }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: et.color, fontFamily: 'var(--font-mono)' }}>
              {edgeCounts[et.key] || 0}
            </div>
            <div style={{ fontSize: 7, color: et.color }}>{et.key}</div>
            <div style={{ fontSize: 7, color: '#6B7280', fontFamily: 'var(--font-zh)' }}>{et.zh}</div>
          </div>
        ))}
      </div>

      <div style={{
        flex: 1,
        background: hexToRgba('#06B6D4', 0.04),
        border: `1px solid ${hexToRgba('#06B6D4', 0.12)}`,
        borderRadius: 6,
        padding: '8px 10px',
        overflow: 'auto',
      }}>
        <div style={{ fontSize: 10, color: '#06B6D4', fontWeight: 600, marginBottom: 6 }}>
          信用分配 (Shapley)
        </div>
        {ranked.length === 0 && (
          <div style={{ fontSize: 10, color: '#4B5563', textAlign: 'center', marginTop: 8 }}>
            暂无数据
          </div>
        )}
        {ranked.map(([agentId, credit]) => {
          const agent = agents.find((a) => a.id === agentId);
          const role = agent?.role || 'default';
          const barWidth = maxCredit > 0 ? (credit / maxCredit) * 100 : 0;
          return (
            <div key={agentId} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 0' }}>
              <span style={{
                width: 60,
                fontSize: 9,
                color: '#D1D5DB',
                fontFamily: 'var(--font-mono)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}>
                {shortId(agentId)}
              </span>
              <div style={{ flex: 1, height: 8, background: '#1F2937', borderRadius: 4, overflow: 'hidden' }}>
                <div style={{
                  width: `${barWidth}%`,
                  height: '100%',
                  background: ROLE_COLORS[role] || '#06B6D4',
                  borderRadius: 4,
                  transition: 'width 0.3s ease',
                }} />
              </div>
              <span style={{ width: 36, fontSize: 9, color: '#06B6D4', fontFamily: 'var(--font-mono)', textAlign: 'right' }}>
                {typeof credit === 'number' ? credit.toFixed(2) : String(credit ?? '—')}
              </span>
            </div>
          );
        })}
      </div>

      <div style={{ display: 'flex', justifyContent: 'center', gap: 4, fontSize: 8, color: '#4B5563', fontFamily: 'var(--font-zh)' }}>
        <span style={{ color: '#06B6D4' }}>信任</span> →
        <span style={{ color: '#8B5CF6' }}>声誉</span> →
        <span style={{ color: '#F5A623' }}>分配</span> →
        <span style={{ color: '#10B981' }}>成功</span> →
        <span style={{ color: '#06B6D4' }}>信任</span>
      </div>
    </div>
  );
}
