/**
 * Agent 对比视图 / Agent Compare View
 *
 * 双 Agent 对比:
 *   - 并排身份信息
 *   - 雷达图叠加
 *   - 能力柱状图双向对比
 *   - Shapley 信用对比
 *   - 状态/角色/ABC 对比
 *
 * @module panels/compare/CompareView
 * @author DEEP-IOS
 */
import React from 'react';
import useStore from '../../store.js';
import { ROLE_COLORS, ROLE_ICONS, ROLE_LABELS, shortId, hexToRgba } from '../../bridge/colors.js';
import ReputationRadar from '../agent/ReputationRadar.jsx';

const CAPABILITY_DIMS = [
  { key: 'coding',    en: 'Coding',    zh: '编码' },
  { key: 'review',    en: 'Review',    zh: '审查' },
  { key: 'design',    en: 'Design',    zh: '设计' },
  { key: 'planning',  en: 'Planning',  zh: '规划' },
  { key: 'testing',   en: 'Testing',   zh: '测试' },
  { key: 'debug',     en: 'Debug',     zh: '调试' },
  { key: 'research',  en: 'Research',  zh: '研究' },
  { key: 'comms',     en: 'Comms',     zh: '沟通' },
];

/**
 * Agent 标识卡 / Agent identity card
 */
function AgentCard({ agent, side }) {
  const role = agent?.role || 'default';
  const color = ROLE_COLORS[role] || ROLE_COLORS.default;
  const icon = ROLE_ICONS[role] || ROLE_ICONS.default;
  const label = ROLE_LABELS[role] || ROLE_LABELS.default;
  const status = (agent?.status || agent?.state || 'idle').toLowerCase();

  return (
    <div style={{
      flex: 1, padding: '8px', textAlign: 'center',
      borderRadius: 6, background: hexToRgba(color, 0.05),
      border: `1px solid ${hexToRgba(color, 0.2)}`,
    }}>
      <div style={{ fontSize: 9, color: '#4B5563', marginBottom: 2 }}>
        {side === 'A' ? 'Agent A' : 'Agent B'}
      </div>
      <div style={{ fontSize: 16, marginBottom: 2 }}>{icon}</div>
      <div style={{ fontSize: 11, fontWeight: 600, fontFamily: 'var(--font-mono)', color: '#E5E7EB' }}>
        {shortId(agent?.id)}
      </div>
      <div style={{ display: 'flex', justifyContent: 'center', gap: 4, marginTop: 2 }}>
        <span style={{ fontSize: 8, padding: '1px 4px', borderRadius: 3, background: `${color}20`, color }}>
          {label.en}
        </span>
        <span style={{
          fontSize: 8, padding: '1px 4px', borderRadius: 3,
          background: status === 'executing' ? 'rgba(245,166,35,0.15)' : 'rgba(107,114,128,0.1)',
          color: status === 'executing' ? '#F5A623' : '#6B7280',
        }}>
          {status}
        </span>
      </div>
    </div>
  );
}

/**
 * @param {{ agentAId: string, agentBId: string }} props
 */
export default function CompareView({ agentAId, agentBId }) {
  const agents = useStore((s) => s.agents);
  const shapley = useStore((s) => s.shapley);
  const setCompareAgentId = useStore((s) => s.setCompareAgentId);

  const agentA = agents.find((a) => a.id === agentAId);
  const agentB = agents.find((a) => a.id === agentBId);

  if (!agentA || !agentB) {
    return (
      <div style={{ padding: 20, textAlign: 'center', color: '#4B5563', fontSize: 11 }}>
        Agent not found / 代理未找到
      </div>
    );
  }

  const colorA = ROLE_COLORS[agentA.role] || ROLE_COLORS.default;
  const colorB = ROLE_COLORS[agentB.role] || ROLE_COLORS.default;
  const creditA = shapley[agentAId] || 0;
  const creditB = shapley[agentBId] || 0;

  const capsA = agentA.capabilities || {};
  const capsB = agentB.capabilities || {};

  return (
    <div style={{
      height: '100%', overflow: 'auto',
      borderLeft: '2px solid rgba(139,92,246,0.3)',
    }}>
      {/* 标题 + 关闭 / Title + Close */}
      <div style={{
        padding: '10px 12px', borderBottom: '1px solid rgba(255,255,255,0.06)',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#8B5CF6' }}>Compare / 对比</div>
          <div style={{ fontSize: 9, color: '#4B5563' }}>Shift+Click another agent / Shift+点击其他代理</div>
        </div>
        <button
          onClick={() => setCompareAgentId?.(null)}
          style={{
            background: 'rgba(107,114,128,0.1)', border: '1px solid rgba(107,114,128,0.2)',
            borderRadius: 4, color: '#9CA3AF', fontSize: 10, padding: '2px 8px', cursor: 'pointer',
          }}
        >
          ✕ Close
        </button>
      </div>

      {/* 身份卡对比 / Identity cards */}
      <div style={{ display: 'flex', gap: 6, padding: '8px 12px' }}>
        <AgentCard agent={agentA} side="A" />
        <AgentCard agent={agentB} side="B" />
      </div>

      {/* 叠加雷达图 / Overlaid Radar Chart */}
      <div style={{ padding: '6px 12px', borderTop: '1px solid rgba(255,255,255,0.04)' }}>
        <div style={{ fontSize: 9, color: '#6B7280', marginBottom: 4 }}>Reputation / 声誉对比</div>
        <div style={{ position: 'relative' }}>
          {/* Agent A 雷达 (实线) / Agent A radar (solid) */}
          <div style={{ position: 'relative', zIndex: 1 }}>
            <ReputationRadar reputation={agentA.reputation || {}} color={colorA} label={shortId(agentAId)} />
          </div>
          {/* Agent B 雷达 (叠加半透明) / Agent B radar (overlaid translucent) */}
          <div style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 2, opacity: 0.7 }}>
            <ReputationRadar reputation={agentB.reputation || {}} color={colorB} label={shortId(agentBId)} />
          </div>
        </div>
      </div>

      {/* Shapley 对比 / Shapley comparison */}
      <div style={{ padding: '6px 12px' }}>
        <div style={{ fontSize: 9, color: '#6B7280', marginBottom: 4 }}>Shapley Credit / 信用分配</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: colorA, fontWeight: 700, width: 40, textAlign: 'right' }}>
            {creditA.toFixed(2)}
          </span>
          <div style={{ flex: 1, height: 8, background: '#1F2937', borderRadius: 4, overflow: 'hidden', display: 'flex' }}>
            <div style={{
              width: `${creditA + creditB > 0 ? (creditA / (creditA + creditB)) * 100 : 50}%`,
              height: '100%', background: colorA, borderRadius: '4px 0 0 4px',
            }} />
            <div style={{
              flex: 1, height: '100%', background: colorB, borderRadius: '0 4px 4px 0',
            }} />
          </div>
          <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: colorB, fontWeight: 700, width: 40 }}>
            {creditB.toFixed(2)}
          </span>
        </div>
      </div>

      {/* 能力对比柱状图 / Capability comparison bars */}
      <div style={{ padding: '8px 12px', borderTop: '1px solid rgba(255,255,255,0.04)' }}>
        <div style={{ fontSize: 9, color: '#6B7280', marginBottom: 6 }}>Capabilities / 能力对比</div>
        {CAPABILITY_DIMS.map((dim) => {
          const valA = Math.max(0, Math.min(1, capsA[dim.key] || 0));
          const valB = Math.max(0, Math.min(1, capsB[dim.key] || 0));

          return (
            <div key={dim.key} style={{ marginBottom: 6 }}>
              <div style={{ textAlign: 'center', fontSize: 8, color: '#9CA3AF', marginBottom: 2 }}>
                {dim.en} <span style={{ color: '#4B5563', fontFamily: 'var(--font-zh)' }}>{dim.zh}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 3, height: 8 }}>
                {/* A 条 (右对齐) / A bar (right-aligned) */}
                <span style={{ fontSize: 7, color: colorA, fontFamily: 'var(--font-mono)', width: 22, textAlign: 'right' }}>
                  {(valA * 100).toFixed(0)}
                </span>
                <div style={{ flex: 1, height: 6, background: '#1F2937', borderRadius: 3, overflow: 'hidden', direction: 'rtl' }}>
                  <div style={{
                    width: `${valA * 100}%`, height: '100%',
                    background: colorA, borderRadius: 3,
                  }} />
                </div>
                {/* 分隔 / Divider */}
                <div style={{ width: 1, height: 10, background: '#374151' }} />
                {/* B 条 (左对齐) / B bar (left-aligned) */}
                <div style={{ flex: 1, height: 6, background: '#1F2937', borderRadius: 3, overflow: 'hidden' }}>
                  <div style={{
                    width: `${valB * 100}%`, height: '100%',
                    background: colorB, borderRadius: 3,
                  }} />
                </div>
                <span style={{ fontSize: 7, color: colorB, fontFamily: 'var(--font-mono)', width: 22 }}>
                  {(valB * 100).toFixed(0)}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* 图例 / Legend */}
      <div style={{
        display: 'flex', justifyContent: 'center', gap: 16, padding: '6px 12px',
        borderTop: '1px solid rgba(255,255,255,0.04)', fontSize: 8,
      }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: colorA }} />
          <span style={{ color: '#9CA3AF' }}>{shortId(agentAId)}</span>
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: colorB }} />
          <span style={{ color: '#9CA3AF' }}>{shortId(agentBId)}</span>
        </span>
      </div>
    </div>
  );
}
