/**
 * 声誉雷达图 / Reputation Radar Chart
 *
 * 6 维雷达图: quality/speed/reliability/creativity/cost/collaboration
 * 纯 SVG 实现, 无外部依赖。
 *
 * @module panels/agent/ReputationRadar
 * @author DEEP-IOS
 */
import React from 'react';
import { hexToRgba } from '../../bridge/colors.js';

const DIMS = [
  { key: 'quality',       en: 'Quality',       zh: '质量',   color: '#10B981' },
  { key: 'speed',         en: 'Speed',         zh: '速度',   color: '#3B82F6' },
  { key: 'reliability',   en: 'Reliability',   zh: '可靠性', color: '#F5A623' },
  { key: 'creativity',    en: 'Creativity',    zh: '创造力', color: '#8B5CF6' },
  { key: 'cost',          en: 'Cost Efficiency',zh: '成本',  color: '#EC4899' },
  { key: 'collaboration', en: 'Collaboration', zh: '协作',   color: '#06B6D4' },
];

const CX = 80;
const CY = 80;
const RADIUS = 60;
const RINGS = 4;

/**
 * 极坐标 → 笛卡尔 / Polar to Cartesian
 */
function polar(angle, r) {
  return {
    x: CX + Math.cos(angle - Math.PI / 2) * r,
    y: CY + Math.sin(angle - Math.PI / 2) * r,
  };
}

/**
 * @param {{ reputation: Object, color?: string, label?: string }} props
 */
export default function ReputationRadar({ reputation = {}, color = '#F5A623', label = '' }) {
  const n = DIMS.length;
  const step = (Math.PI * 2) / n;

  // 数据点 / Data points
  const points = DIMS.map((dim, i) => {
    const val = Math.max(0, Math.min(1, reputation[dim.key] || 0));
    return polar(step * i, val * RADIUS);
  });

  const dataPath = points.map((p, i) =>
    `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`
  ).join(' ') + ' Z';

  return (
    <div style={{ padding: '4px 12px' }}>
      <svg width="160" height="160" viewBox="0 0 160 160" style={{ display: 'block', margin: '0 auto' }}>
        {/* 同心环 / Concentric rings */}
        {Array.from({ length: RINGS }, (_, i) => {
          const r = (RADIUS / RINGS) * (i + 1);
          const ringPoints = Array.from({ length: n }, (_, j) => polar(step * j, r));
          const d = ringPoints.map((p, j) =>
            `${j === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`
          ).join(' ') + ' Z';
          return <path key={i} d={d} fill="none" stroke="#374151" strokeWidth="0.5" opacity="0.5" />;
        })}

        {/* 轴线 / Axis lines */}
        {DIMS.map((dim, i) => {
          const p = polar(step * i, RADIUS);
          return <line key={dim.key} x1={CX} y1={CY} x2={p.x} y2={p.y} stroke="#374151" strokeWidth="0.5" opacity="0.3" />;
        })}

        {/* 数据区域 / Data area */}
        <path d={dataPath} fill={hexToRgba(color, 0.15)} stroke={color} strokeWidth="1.5" />

        {/* 数据点 / Data dots */}
        {points.map((p, i) => (
          <circle key={DIMS[i].key} cx={p.x} cy={p.y} r="3" fill={color} stroke="#111827" strokeWidth="1" />
        ))}

        {/* 轴标签 / Axis labels */}
        {DIMS.map((dim, i) => {
          const lp = polar(step * i, RADIUS + 14);
          const val = reputation[dim.key];
          return (
            <g key={dim.key + '-label'}>
              <text x={lp.x} y={lp.y} textAnchor="middle" dominantBaseline="middle"
                fill={dim.color} fontSize="7" fontWeight="600">{dim.en}</text>
              <text x={lp.x} y={lp.y + 9} textAnchor="middle" dominantBaseline="middle"
                fill="#6B7280" fontSize="6" fontFamily="var(--font-zh)">{dim.zh}</text>
              {typeof val === 'number' && (
                <text x={lp.x} y={lp.y + 17} textAnchor="middle" dominantBaseline="middle"
                  fill="#9CA3AF" fontSize="7" fontFamily="var(--font-mono)">{(val * 100).toFixed(0)}%</text>
              )}
            </g>
          );
        })}

        {/* 标签 / Label */}
        {label && (
          <text x={CX} y={CY} textAnchor="middle" dominantBaseline="middle"
            fill={hexToRgba(color, 0.4)} fontSize="8" fontWeight="600">{label}</text>
        )}
      </svg>
    </div>
  );
}
