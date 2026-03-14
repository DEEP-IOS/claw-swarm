/**
 * Agent 详情面板 / Agent Detail Panel
 *
 * 5 个可折叠区:
 *   1. Identity   — 身份 (角色图标 + ID + 标签)
 *   2. Task       — 当前任务 (名称 + 进度 + Evidence)
 *   3. SubAgents  — 子代理列表 + 层级图
 *   4. Reputation — 6 维雷达图
 *   5. Capability — 8 维柱状图 + 团队平均对比
 *   6. History    — 最近 5 次结果 + 趋势
 *
 * @module panels/agent/AgentPanel
 * @author DEEP-IOS
 */
import React, { useState } from 'react';
import useStore from '../../store.js';
import { ROLE_COLORS, hexToRgba } from '../../bridge/colors.js';
import IdentitySection from './IdentitySection.jsx';
import CurrentTaskSection from './CurrentTaskSection.jsx';
import SubAgentSection from './SubAgentSection.jsx';
import ReputationRadar from './ReputationRadar.jsx';
import CapabilityBars from './CapabilityBars.jsx';
import HistorySection from './HistorySection.jsx';

/**
 * 可折叠区 / Collapsible Section
 */
function Section({ title, titleZh, defaultOpen = true, children }) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
      <div
        onClick={() => setOpen((v) => !v)}
        style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '8px 12px', cursor: 'pointer', userSelect: 'none',
        }}
      >
        <span style={{
          fontSize: 9, color: '#6B7280', transition: 'transform 150ms',
          transform: open ? 'rotate(90deg)' : 'rotate(0deg)',
        }}>▶</span>
        <span style={{ fontSize: 10, fontWeight: 600, color: '#9CA3AF', letterSpacing: 1 }}>{title}</span>
        {titleZh && (
          <span style={{ fontSize: 9, color: '#4B5563', fontFamily: 'var(--font-zh)' }}>/ {titleZh}</span>
        )}
      </div>
      {open && children}
    </div>
  );
}

/**
 * @param {{ agentId: string }} props
 */
export default function AgentPanel({ agentId }) {
  const agent = useStore((s) => s.agents.find((a) => a.id === agentId));

  if (!agent) {
    return (
      <div style={{ padding: 20, textAlign: 'center', color: '#4B5563', fontSize: 11 }}>
        Agent not found / 代理未找到
      </div>
    );
  }

  const roleColor = ROLE_COLORS[agent.role] || ROLE_COLORS.default;

  return (
    <div style={{
      height: '100%', overflow: 'auto',
      borderLeft: `2px solid ${hexToRgba(roleColor, 0.3)}`,
    }}>
      {/* 身份区 / Identity */}
      <IdentitySection agent={agent} />

      {/* 当前任务 / Current Task */}
      <Section title="CURRENT TASK" titleZh="当前任务">
        <CurrentTaskSection agentId={agentId} />
      </Section>

      {/* 子代理 / Sub-Agents */}
      <Section title="SUB-AGENTS" titleZh="子代理" defaultOpen={false}>
        <SubAgentSection agentId={agentId} />
      </Section>

      {/* 声誉雷达 / Reputation Radar */}
      <Section title="REPUTATION" titleZh="声誉">
        <ReputationRadar reputation={agent.reputation || {}} color={roleColor} />
      </Section>

      {/* 能力柱状图 / Capabilities */}
      <Section title="CAPABILITIES" titleZh="能力" defaultOpen={false}>
        <CapabilityBars capabilities={agent.capabilities || {}} agentColor={roleColor} />
      </Section>

      {/* 历史 / History */}
      <Section title="HISTORY" titleZh="历史">
        <HistorySection agentId={agentId} />
      </Section>
    </div>
  );
}
