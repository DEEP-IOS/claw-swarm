/**
 * 信息素面板 / Pheromone Panel
 *
 * 7 种信息素详情:
 *   - 浓度柱状图 (当前值 + 阈值标线)
 *   - 衰减曲线公式
 *   - 浓度热力描述
 *   - 公式说明
 *
 * @module panels/pheromone/PheromonePanel
 * @author DEEP-IOS
 */
import React from 'react';
import useStore from '../../store.js';
import { PHEROMONE_COLORS, PHEROMONE_LABELS, hexToRgba, fmtPct } from '../../bridge/colors.js';

const PHEROMONE_KEYS = ['trail', 'alarm', 'recruit', 'dance', 'queen', 'food', 'danger'];

const PHEROMONE_DESC = {
  trail:   { en: 'Path reinforcement for successful routes',     zh: '成功路径的增强信号' },
  alarm:   { en: 'Danger warning signal, triggers avoidance',    zh: '危险警告信号, 触发回避' },
  recruit: { en: 'Recruitment for complex tasks',                zh: '复杂任务的招募信号' },
  dance:   { en: 'Resource quality communication',               zh: '资源质量沟通信号' },
  queen:   { en: 'Coordination and colony regulation',           zh: '协调和蜂群调节' },
  food:    { en: 'Food source discovery announcement',           zh: '食物源发现公告' },
  danger:  { en: 'Persistent threat zone marker',                zh: '持续威胁区域标记' },
};

const DECAY_FORMULA = 'τ(t+1) = ρ · τ(t) + Δτ';

/**
 * @returns {JSX.Element}
 */
export default function PheromonePanel() {
  const pheromones = useStore((s) => s.pheromones);

  // 总强度 / Total intensity
  const total = PHEROMONE_KEYS.reduce((s, k) => s + (pheromones[k] || 0), 0);

  return (
    <div style={{ height: '100%', overflow: 'auto', borderLeft: '2px solid rgba(245,166,35,0.3)' }}>
      {/* 标题 / Title */}
      <div style={{
        padding: '12px', borderBottom: '1px solid rgba(255,255,255,0.06)',
      }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: '#F5A623' }}>
          Pheromone Analysis
        </div>
        <div style={{ fontSize: 11, color: '#6B7280', fontFamily: 'var(--font-zh)' }}>
          信息素分析
        </div>
        <div style={{ fontSize: 9, color: '#4B5563', fontFamily: 'var(--font-mono)', marginTop: 4 }}>
          Total intensity / 总强度: {total.toFixed(2)}
        </div>
      </div>

      {/* 7 种信息素详情 / 7 pheromone details */}
      {PHEROMONE_KEYS.map((key) => {
        const intensity = pheromones[key] || 0;
        const color = PHEROMONE_COLORS[key];
        const label = PHEROMONE_LABELS[key];
        const desc = PHEROMONE_DESC[key];
        const pct = (intensity * 100).toFixed(1);
        const isHigh = intensity > 0.7;
        const isMid = intensity > 0.3;

        return (
          <div key={key} style={{
            padding: '8px 12px',
            borderBottom: '1px solid rgba(255,255,255,0.03)',
          }}>
            {/* 头部 / Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{
                  width: 8, height: 8, borderRadius: '50%',
                  background: color, boxShadow: isHigh ? `0 0 6px ${color}` : 'none',
                }} />
                <span style={{ fontSize: 11, fontWeight: 600, color }}>{label.en}</span>
                <span style={{ fontSize: 9, color: '#6B7280', fontFamily: 'var(--font-zh)' }}>/ {label.zh}</span>
              </div>
              <span style={{
                fontSize: 12, fontFamily: 'var(--font-mono)', fontWeight: 600,
                color: isHigh ? color : isMid ? '#9CA3AF' : '#4B5563',
              }}>
                {pct}%
              </span>
            </div>

            {/* 浓度条 / Intensity bar */}
            <div style={{
              position: 'relative', height: 10, background: '#1F2937',
              borderRadius: 5, overflow: 'hidden', marginBottom: 4,
            }}>
              <div style={{
                width: `${intensity * 100}%`, height: '100%',
                background: `linear-gradient(90deg, ${hexToRgba(color, 0.5)}, ${color})`,
                borderRadius: 5, transition: 'width 0.5s ease',
              }} />
              {/* 阈值标线 (30% 和 70%) / Threshold markers */}
              <div style={{
                position: 'absolute', top: 0, left: '30%',
                width: 1, height: '100%', borderLeft: '1px dashed rgba(255,255,255,0.1)',
              }} />
              <div style={{
                position: 'absolute', top: 0, left: '70%',
                width: 1, height: '100%', borderLeft: '1px dashed rgba(255,255,255,0.15)',
              }} />
            </div>

            {/* 描述 / Description */}
            <div style={{ fontSize: 8, color: '#6B7280', lineHeight: 1.4 }}>
              {desc.en}
            </div>
            <div style={{ fontSize: 8, color: '#4B5563', fontFamily: 'var(--font-zh)', lineHeight: 1.4 }}>
              {desc.zh}
            </div>
          </div>
        );
      })}

      {/* 衰减公式 / Decay formula */}
      <div style={{
        padding: '10px 12px', textAlign: 'center',
        borderTop: '1px solid rgba(255,255,255,0.05)',
      }}>
        <div style={{ fontSize: 9, color: '#6B7280', marginBottom: 4 }}>
          Decay Formula / 衰减公式
        </div>
        <div style={{
          fontSize: 12, fontFamily: 'var(--font-mono)', color: '#F5A623',
          padding: '6px 12px', background: 'rgba(245,166,35,0.06)',
          borderRadius: 6, display: 'inline-block',
        }}>
          {DECAY_FORMULA}
        </div>
        <div style={{ fontSize: 8, color: '#4B5563', marginTop: 4 }}>
          ρ = evaporation rate / 蒸发率 · Δτ = deposit / 沉积
        </div>
      </div>
    </div>
  );
}
