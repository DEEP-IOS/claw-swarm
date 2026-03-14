/**
 * 能力柱状图 / Capability Bar Chart
 *
 * 8 维能力水平柱状图 + 团队平均对比线。
 *
 * @module panels/agent/CapabilityBars
 * @author DEEP-IOS
 */
import React from 'react';
import useStore from '../../store.js';
import { hexToRgba } from '../../bridge/colors.js';

const CAPABILITY_DIMS = [
  { key: 'coding',    en: 'Coding',    zh: '编码',   color: '#10B981' },
  { key: 'review',    en: 'Review',    zh: '审查',   color: '#F5A623' },
  { key: 'design',    en: 'Design',    zh: '设计',   color: '#EC4899' },
  { key: 'planning',  en: 'Planning',  zh: '规划',   color: '#8B5CF6' },
  { key: 'testing',   en: 'Testing',   zh: '测试',   color: '#3B82F6' },
  { key: 'debug',     en: 'Debug',     zh: '调试',   color: '#EF4444' },
  { key: 'research',  en: 'Research',  zh: '研究',   color: '#06B6D4' },
  { key: 'comms',     en: 'Comms',     zh: '沟通',   color: '#F5A623' },
];

/**
 * @param {{ capabilities: Object, agentColor?: string }} props
 */
export default function CapabilityBars({ capabilities = {}, agentColor = '#F5A623' }) {
  const agents = useStore((s) => s.agents);

  // 计算团队平均 / Calculate team average
  const teamAvg = {};
  CAPABILITY_DIMS.forEach((dim) => {
    let sum = 0, count = 0;
    agents.forEach((a) => {
      const v = a.capabilities?.[dim.key];
      if (typeof v === 'number') { sum += v; count++; }
    });
    teamAvg[dim.key] = count > 0 ? sum / count : 0;
  });

  return (
    <div style={{ padding: '4px 12px' }}>
      {/* 图例 / Legend */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginBottom: 6, fontSize: 8 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
          <span style={{ width: 10, height: 3, borderRadius: 1, background: agentColor, display: 'inline-block' }} />
          <span style={{ color: '#9CA3AF' }}>Agent</span>
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
          <span style={{ width: 10, height: 1, borderRadius: 0, borderTop: '1px dashed #6B7280', display: 'inline-block' }} />
          <span style={{ color: '#6B7280' }}>Team Avg / 团队均值</span>
        </span>
      </div>

      {/* 柱状图 / Bar chart */}
      {CAPABILITY_DIMS.map((dim) => {
        const val = Math.max(0, Math.min(1, capabilities[dim.key] || 0));
        const avg = teamAvg[dim.key] || 0;
        const pct = (val * 100).toFixed(0);
        const avgPct = (avg * 100).toFixed(0);

        return (
          <div key={dim.key} style={{ marginBottom: 5 }}>
            {/* 标签行 / Label row */}
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ fontSize: 9, color: dim.color, fontWeight: 600 }}>{dim.en}</span>
                <span style={{ fontSize: 8, color: '#4B5563', fontFamily: 'var(--font-zh)' }}>{dim.zh}</span>
              </div>
              <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: '#9CA3AF' }}>
                {pct}%
              </span>
            </div>

            {/* 条形轨道 / Bar track */}
            <div style={{ position: 'relative', height: 8, background: '#1F2937', borderRadius: 4, overflow: 'visible' }}>
              {/* Agent 值 / Agent value */}
              <div style={{
                position: 'absolute', top: 0, left: 0, height: '100%',
                width: `${val * 100}%`,
                background: `linear-gradient(90deg, ${hexToRgba(dim.color, 0.6)}, ${dim.color})`,
                borderRadius: 4, transition: 'width 0.4s ease',
              }} />

              {/* 团队平均标线 / Team average marker */}
              {avg > 0 && (
                <div style={{
                  position: 'absolute', top: -1, left: `${avg * 100}%`,
                  width: 1, height: 10,
                  borderLeft: '1px dashed #6B7280',
                  transform: 'translateX(-0.5px)',
                }} />
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
