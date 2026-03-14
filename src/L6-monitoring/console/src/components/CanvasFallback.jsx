/**
 * Canvas 降级组件 / Canvas Fallback Component
 *
 * 当 Canvas 不可用 (prefers-reduced-motion / 低性能) 时:
 *   - 蜜蜂替换为 DOM 元素 (CSS 动画模拟运动)
 *   - 禁用粒子和环境效果
 *   - 核心数据面板保留
 *   - 提供 aria-live 文本描述
 *
 * @module components/CanvasFallback
 * @author DEEP-IOS
 */
import React, { useMemo } from 'react';
import useStore from '../store.js';
import { ROLE_COLORS, ROLE_ICONS, shortId, hexToRgba } from '../bridge/colors.js';
import { srOnlyStyle, liveRegionProps } from '../utils/accessibility.js';

/**
 * 状态配置 / State configs
 */
const STATE_COLORS = {
  EXECUTING: '#F5A623',
  ACTIVE:    '#10B981',
  IDLE:      '#6B7280',
  REPORTING: '#8B5CF6',
  ERROR:     '#EF4444',
};

const STATE_LABELS = {
  EXECUTING: { en: 'Executing', zh: '执行中' },
  ACTIVE:    { en: 'Active',    zh: '活跃' },
  IDLE:      { en: 'Idle',      zh: '闲置' },
  REPORTING: { en: 'Reporting', zh: '报告中' },
  ERROR:     { en: 'Error',     zh: '错误' },
};

/**
 * 单个 Agent DOM 表示 / Single Agent DOM representation
 */
function AgentCard({ agent, isSelected, onClick }) {
  const role = agent.role || 'default';
  const color = ROLE_COLORS[role] || '#6B7280';
  const icon = ROLE_ICONS[role] || '🐝';
  const stateColor = STATE_COLORS[agent.state] || '#6B7280';
  const stateLabel = STATE_LABELS[agent.state] || { en: agent.state, zh: agent.state };

  return (
    <div
      onClick={() => onClick(agent.id)}
      role="button"
      tabIndex={0}
      aria-label={`Agent ${shortId(agent.id)}, role: ${role}, state: ${agent.state}`}
      aria-selected={isSelected}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onClick(agent.id); }}
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '8px 12px', borderRadius: 8,
        background: isSelected ? hexToRgba(color, 0.12) : 'rgba(255,255,255,0.02)',
        border: `1px solid ${isSelected ? hexToRgba(color, 0.4) : 'rgba(255,255,255,0.06)'}`,
        cursor: 'pointer',
        transition: 'background 150ms, border-color 150ms',
      }}
    >
      {/* 角色图标 / Role icon */}
      <span style={{
        fontSize: 18, width: 28, height: 28,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: hexToRgba(color, 0.15), borderRadius: 6,
      }}>
        {icon}
      </span>

      {/* 信息 / Info */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 11, fontWeight: 600, color: '#E5E7EB',
          fontFamily: 'var(--font-mono)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {shortId(agent.id)}
        </div>
        <div style={{ fontSize: 9, color, textTransform: 'capitalize' }}>
          {role}
        </div>
      </div>

      {/* 状态标签 / State badge */}
      <div style={{
        fontSize: 9, padding: '2px 8px', borderRadius: 10,
        background: hexToRgba(stateColor, 0.15),
        color: stateColor, fontWeight: 600,
        whiteSpace: 'nowrap',
      }}>
        {stateLabel.en}
      </div>
    </div>
  );
}

/**
 * 信息素摘要 / Pheromone summary
 */
function PheromoneSummary({ pheromones }) {
  const types = [
    { key: 'trail',   label: 'Trail',   zh: '路径',   color: '#F5A623' },
    { key: 'alarm',   label: 'Alarm',   zh: '警报',   color: '#EF4444' },
    { key: 'recruit', label: 'Recruit', zh: '招募',   color: '#3B82F6' },
    { key: 'dance',   label: 'Dance',   zh: '舞蹈',   color: '#10B981' },
    { key: 'queen',   label: 'Queen',   zh: '蜂王',   color: '#8B5CF6' },
    { key: 'food',    label: 'Food',    zh: '食物',   color: '#22C55E' },
    { key: 'danger',  label: 'Danger',  zh: '危险',   color: '#EC4899' },
  ];

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 6 }}>
      {types.map((t) => {
        const val = pheromones?.[t.key] ?? 0;
        return (
          <div key={t.key} style={{
            padding: '6px 8px', borderRadius: 6,
            background: hexToRgba(t.color, 0.06),
            border: `1px solid ${hexToRgba(t.color, 0.15)}`,
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 9, color: t.color, fontWeight: 600 }}>{t.label}</span>
              <span style={{ fontSize: 9, color: '#6B7280', fontFamily: 'var(--font-zh)' }}>{t.zh}</span>
            </div>
            <div style={{ fontSize: 14, fontFamily: 'var(--font-mono)', color: t.color, marginTop: 2 }}>
              {typeof val === 'number' ? val.toFixed(2) : val}
            </div>
            {/* 简单条形图 / Simple bar */}
            <div style={{ height: 3, background: '#1F2937', borderRadius: 2, marginTop: 4, overflow: 'hidden' }}>
              <div style={{
                width: `${Math.min(val * 100, 100)}%`,
                height: '100%', background: t.color, borderRadius: 2,
              }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Canvas 降级主组件 / Canvas Fallback main component
 * 替代 Canvas 渲染, 用纯 DOM 展示蜂群状态
 */
export default function CanvasFallback() {
  const agents = useStore((s) => s.agents);
  const tasks = useStore((s) => s.tasks);
  const pheromones = useStore((s) => s.pheromones);
  const mode = useStore((s) => s.mode);
  const health = useStore((s) => s.health);
  const selectedAgentId = useStore((s) => s.selectedAgentId);
  const selectAgent = useStore((s) => s.selectAgent);

  // 按角色分组 / Group by role
  const grouped = useMemo(() => {
    const groups = {};
    agents.forEach((a) => {
      const r = a.role || 'default';
      if (!groups[r]) groups[r] = [];
      groups[r].push(a);
    });
    return groups;
  }, [agents]);

  // 屏幕阅读器摘要 / Screen reader summary
  const srSummary = useMemo(() => {
    const executing = agents.filter((a) => a.state === 'EXECUTING').length;
    const idle = agents.filter((a) => a.state === 'IDLE').length;
    return `Swarm status: ${agents.length} agents, ${executing} executing, ${idle} idle. Mode: ${mode}. Health: ${health}%.`;
  }, [agents, mode, health]);

  return (
    <div
      role="region"
      aria-label="Swarm Status (Accessible View)"
      style={{
        height: '100%', overflow: 'auto', padding: 16,
        background: 'var(--bg-canvas)',
      }}
    >
      {/* 屏幕阅读器摘要 / SR summary */}
      <div {...liveRegionProps('polite')} style={srOnlyStyle()}>
        {srSummary}
      </div>

      {/* 标题 / Header */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        marginBottom: 16, padding: '12px 16px',
        background: 'rgba(255,255,255,0.02)', borderRadius: 8,
        border: '1px solid rgba(255,255,255,0.06)',
      }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#F5A623' }}>
            🐝 Accessible Mode
            <span style={{ fontSize: 10, fontFamily: 'var(--font-zh)', color: '#6B7280', marginLeft: 8 }}>
              / 无障碍模式
            </span>
          </div>
          <div style={{ fontSize: 10, color: '#6B7280', marginTop: 2 }}>
            Canvas rendering disabled · DOM fallback active
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: '#E5E7EB' }}>
            Mode: <span style={{ color: '#F5A623' }}>{mode}</span>
          </div>
          <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: health > 80 ? '#10B981' : health > 50 ? '#F5A623' : '#EF4444' }}>
            Health: {health}%
          </div>
        </div>
      </div>

      {/* 统计行 / Stats row */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {[
          { label: 'Total', zh: '总计', value: agents.length, color: '#E5E7EB' },
          { label: 'Executing', zh: '执行', value: agents.filter((a) => a.state === 'EXECUTING').length, color: '#F5A623' },
          { label: 'Active', zh: '活跃', value: agents.filter((a) => a.state === 'ACTIVE').length, color: '#10B981' },
          { label: 'Idle', zh: '闲置', value: agents.filter((a) => a.state === 'IDLE').length, color: '#6B7280' },
          { label: 'Tasks', zh: '任务', value: tasks.length, color: '#3B82F6' },
        ].map((s) => (
          <div key={s.label} style={{
            flex: 1, textAlign: 'center', padding: '8px',
            background: hexToRgba(s.color, 0.06), borderRadius: 6,
            border: `1px solid ${hexToRgba(s.color, 0.15)}`,
          }}>
            <div style={{ fontSize: 18, fontWeight: 700, fontFamily: 'var(--font-mono)', color: s.color }}>
              {s.value}
            </div>
            <div style={{ fontSize: 9, color: s.color, fontWeight: 600 }}>{s.label}</div>
            <div style={{ fontSize: 8, color: '#6B7280', fontFamily: 'var(--font-zh)' }}>{s.zh}</div>
          </div>
        ))}
      </div>

      {/* 信息素摘要 / Pheromone summary */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 10, fontWeight: 600, color: '#6B7280', letterSpacing: 1, marginBottom: 6 }}>
          PHEROMONES / 信息素
        </div>
        <PheromoneSummary pheromones={pheromones} />
      </div>

      {/* 按角色分组的 Agent 列表 / Agent list grouped by role */}
      <div role="list" aria-label="Agent list">
        {Object.entries(grouped).map(([role, roleAgents]) => (
          <div key={role} style={{ marginBottom: 12 }}>
            <div style={{
              fontSize: 10, fontWeight: 600, letterSpacing: 1,
              color: ROLE_COLORS[role] || '#6B7280', marginBottom: 4,
              textTransform: 'uppercase',
            }}>
              {ROLE_ICONS[role] || '🐝'} {role} ({roleAgents.length})
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {roleAgents.map((a) => (
                <AgentCard
                  key={a.id}
                  agent={a}
                  isSelected={a.id === selectedAgentId}
                  onClick={selectAgent}
                />
              ))}
            </div>
          </div>
        ))}
      </div>

      {agents.length === 0 && (
        <div style={{ textAlign: 'center', padding: 40, color: '#4B5563', fontSize: 12 }}>
          No agents active / 暂无活跃代理
        </div>
      )}
    </div>
  );
}
