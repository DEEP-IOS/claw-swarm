/**
 * 生态视图覆盖层 / Ecology View Overlay
 *
 * V7.0 完整实现:
 *   - ABC 三列: 适应度 + Agent 列表 + 种群比例
 *   - GEP 进化环: 4 阶段 (检测→突变→A/B→晋升)
 *   - 底部: LV 公式 + 竞争排斥 + 互补性
 *
 * @module console/views/EcologyOverlay
 * @author DEEP-IOS
 */
import React from 'react';
import useStore from '../store.js';
import { ROLE_COLORS, hexToRgba, shortId } from '../bridge/colors.js';

const ABC_COLS = [
  { key: 'employed',  color: '#F5A623', icon: '⛏',  en: 'Employed',  zh: '雇佣蜂', desc: 'Exploit known' },
  { key: 'onlooker',  color: '#8B5CF6', icon: '👁',  en: 'Onlooker',  zh: '旁观蜂', desc: 'Evaluate & recruit' },
  { key: 'scout',     color: '#06B6D4', icon: '🔭', en: 'Scout',     zh: '侦察蜂', desc: 'Explore new' },
];

const GEP_STAGES = [
  { name: 'Detect',  zh: '检测', color: '#3B82F6' },
  { name: 'Mutate',  zh: '突变', color: '#F5A623' },
  { name: 'A/B Test', zh: 'A/B', color: '#8B5CF6' },
  { name: 'Promote', zh: '晋升', color: '#10B981' },
];

export default function EcologyOverlay() {
  const agents = useStore((s) => s.agents);
  const shapley = useStore((s) => s.shapley);

  const groups = {};
  ABC_COLS.forEach((c) => { groups[c.key] = []; });
  agents.forEach((a) => {
    const k = (a.abc || 'employed').toLowerCase();
    if (groups[k]) groups[k].push(a);
    else groups.employed.push(a);
  });

  const getFitness = (id) => {
    const credit = (shapley || {})[id];
    return typeof credit === 'number' ? credit.toFixed(2) : '—';
  };

  const total = agents.length || 1;
  const ratios = ABC_COLS.map((c) => ({
    ...c, count: groups[c.key].length, pct: ((groups[c.key].length / total) * 100).toFixed(0),
  }));

  return (
    <div style={{ pointerEvents: 'none', padding: 12, height: '100%', display: 'flex', flexDirection: 'column', gap: 8 }}>

      {/* ABC 三列 */}
      <div style={{ display: 'flex', gap: 6, flex: 1 }}>
        {ratios.map((col) => (
          <div key={col.key} style={{
            flex: 1, background: hexToRgba(col.color, 0.05),
            border: `1px solid ${hexToRgba(col.color, 0.2)}`, borderRadius: 8,
            padding: 8, display: 'flex', flexDirection: 'column',
          }}>
            <div style={{ textAlign: 'center', marginBottom: 6 }}>
              <div style={{ fontSize: 16 }}>{col.icon}</div>
              <div style={{ fontSize: 11, fontWeight: 600, color: col.color }}>{col.en}</div>
              <div style={{ fontSize: 9, fontFamily: 'var(--font-zh)', color: col.color, opacity: 0.6 }}>{col.zh}</div>
              <div style={{ fontSize: 8, color: '#6B7280', marginTop: 1 }}>{col.desc}</div>
            </div>
            <div style={{ textAlign: 'center', marginBottom: 4 }}>
              <span style={{ fontSize: 18, fontWeight: 700, color: col.color, fontFamily: 'var(--font-mono)' }}>{col.count}</span>
              <span style={{ fontSize: 10, color: '#6B7280', marginLeft: 3 }}>({col.pct}%)</span>
            </div>
            <div style={{ height: 3, background: '#374151', borderRadius: 2, marginBottom: 6, overflow: 'hidden' }}>
              <div style={{ width: `${col.pct}%`, height: '100%', background: col.color, borderRadius: 2, transition: 'width 0.5s ease' }} />
            </div>
            <div style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 2 }}>
              {groups[col.key].length === 0 && (
                <div style={{ fontSize: 9, color: '#4B5563', textAlign: 'center', marginTop: 8, fontFamily: 'var(--font-zh)' }}>
                  等待代理分配...
                </div>
              )}
              {groups[col.key].map((a) => (
                <div key={a.id} style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  fontSize: 9, padding: '2px 5px', borderRadius: 4,
                  background: hexToRgba(col.color, 0.08), color: '#D1D5DB',
                }}>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{shortId(a.id)}</span>
                  <span style={{ fontSize: 8, fontFamily: 'var(--font-mono)', color: ROLE_COLORS[a.role] || '#6B7280', marginLeft: 4 }}>{getFitness(a.id)}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* GEP 进化环 */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12,
        background: hexToRgba('#10B981', 0.04), border: `1px solid ${hexToRgba('#10B981', 0.15)}`,
        borderRadius: 6, padding: '6px 12px',
      }}>
        <svg width="56" height="56" viewBox="0 0 56 56" style={{ flexShrink: 0 }}>
          <circle cx="28" cy="28" r="24" fill="none" stroke="#10B981" strokeWidth="1.5" strokeDasharray="6 4" opacity="0.4" />
          <circle cx="28" cy="28" r="16" fill="none" stroke="#10B981" strokeWidth="1" strokeDasharray="3 3" opacity="0.25" />
          {GEP_STAGES.map((stage, i) => {
            const angle = (i / GEP_STAGES.length) * Math.PI * 2 - Math.PI / 2;
            const sx = 28 + Math.cos(angle) * 20;
            const sy = 28 + Math.sin(angle) * 20;
            return <circle key={stage.name} cx={sx} cy={sy} r="4" fill={stage.color} opacity="0.7" />;
          })}
        </svg>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {GEP_STAGES.map((stage, i) => (
            <div key={stage.name} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <div style={{ width: 6, height: 6, borderRadius: '50%', background: stage.color }} />
              <span style={{ fontSize: 9, color: stage.color, fontWeight: 600 }}>{stage.name}</span>
              <span style={{ fontSize: 8, color: '#6B7280', fontFamily: 'var(--font-zh)' }}>{stage.zh}</span>
              {i < GEP_STAGES.length - 1 && <span style={{ fontSize: 8, color: '#4B5563', marginLeft: 2 }}>→</span>}
            </div>
          ))}
        </div>
      </div>

      {/* 底部公式 */}
      <div style={{ display: 'flex', gap: 6, justifyContent: 'center', fontSize: 8, color: '#4B5563', fontFamily: 'var(--font-mono)', padding: '2px 0' }}>
        <span>dN/dt = rN(1-N/K)</span>
        <span>|</span>
        <span>overlap &gt; 0.9 → exclusion</span>
        <span>|</span>
        <span>comp = 1 - overlap</span>
      </div>
    </div>
  );
}
