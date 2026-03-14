/**
 * 右侧检查器面板组件 / Right Inspector Panel Component
 *
 * 选中代理时显示详细检查信息：身份、声誉、能力维度。
 * 未选中时显示空占位提示。
 * Shows detailed inspection info when an agent is selected: identity, reputation, capabilities.
 * Shows an empty placeholder when no agent is selected.
 *
 * @module console/components/RightSidebar
 * @author DEEP-IOS
 */
import { useState } from 'react';
import useStore from '../store.js';
import {
  ROLE_COLORS,
  ROLE_ICONS,
  ROLE_LABELS,
  shortId,
} from '../bridge/colors.js';
import StatusBadge from './StatusBadge.jsx';

// ── 声誉维度定义 / Reputation Dimension Definitions ──
const REPUTATION_DIMS = [
  { key: 'quality',       en: 'Quality',       zh: '质量',   color: '#10B981' },
  { key: 'speed',         en: 'Speed',         zh: '速度',   color: '#3B82F6' },
  { key: 'reliability',   en: 'Reliability',   zh: '可靠性', color: '#F5A623' },
  { key: 'creativity',    en: 'Creativity',    zh: '创造力', color: '#8B5CF6' },
  { key: 'cost',          en: 'Cost',          zh: '成本',   color: '#EC4899' },
  { key: 'collaboration', en: 'Collaboration', zh: '协作',   color: '#06B6D4' },
];

// ── 能力维度定义 / Capability Dimension Definitions ──
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
 * 可折叠面板 / Collapsible Section
 *
 * @param {object} props
 * @param {string} props.title - 面板标题 / Section title
 * @param {boolean} [props.defaultOpen=true] - 默认展开 / Default open state
 * @param {React.ReactNode} props.children
 */
function CollapsibleSection({ title, defaultOpen = true, children }) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="inspector-section" style={{ borderBottom: '1px solid var(--border)' }}>
      {/* 标题行 / Title row */}
      <div
        className="sidebar-title"
        style={{ cursor: 'pointer', userSelect: 'none', display: 'flex', alignItems: 'center', gap: 6, padding: '10px 12px 6px' }}
        onClick={() => setOpen((v) => !v)}
      >
        <span style={{ fontSize: 10, transition: 'transform 150ms', transform: open ? 'rotate(90deg)' : 'rotate(0deg)' }}>
          ▶
        </span>
        {title}
      </div>
      {/* 内容区 / Content area */}
      {open && (
        <div style={{ padding: '0 12px 10px' }}>
          {children}
        </div>
      )}
    </div>
  );
}

/**
 * 水平进度条 / Horizontal Progress Bar
 *
 * @param {object} props
 * @param {string} props.label - 标签文本 / Label text
 * @param {number} props.value - 0-1 范围的值 / Value in 0-1 range
 * @param {string} [props.color='#F5A623'] - 条形颜色 / Bar color
 */
function ProgressBar({ label, value, color = '#F5A623' }) {
  const pct = Math.min(Math.max((value || 0) * 100, 0), 100);

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
      {/* 标签 / Label */}
      <span style={{ fontSize: 10, color: 'var(--text-dim)', width: 64, textAlign: 'right', flexShrink: 0 }}>
        {label}
      </span>
      {/* 轨道 / Track */}
      <div style={{ flex: 1, height: 4, background: 'var(--bg-primary)', borderRadius: 2, overflow: 'hidden' }}>
        <div
          style={{
            height: '100%',
            width: `${pct}%`,
            backgroundColor: color,
            borderRadius: 2,
            transition: 'width 0.4s ease',
          }}
        />
      </div>
      {/* 数值 / Value */}
      <span style={{ fontSize: 10, color: 'var(--text-dim)', width: 28, fontFamily: 'var(--font-mono)' }}>
        {pct.toFixed(0)}%
      </span>
    </div>
  );
}

/**
 * 键值行 / Key-Value Row
 *
 * @param {object} props
 * @param {string} props.k - 键名 / Key name
 * @param {*} props.v - 值 / Value
 */
function KVRow({ k, v }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '2px 0' }}>
      <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>{k}</span>
      <span style={{ fontSize: 11, color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>
        {v ?? '—'}
      </span>
    </div>
  );
}

/**
 * 右侧检查器面板 / Right Inspector Panel
 * @returns {JSX.Element}
 */
export default function RightSidebar() {
  const selectedAgentId = useStore((s) => s.selectedAgentId);
  const agents = useStore((s) => s.agents);

  // 查找选中代理 / Find selected agent
  const agent = selectedAgentId
    ? agents.find((a) => a.id === selectedAgentId)
    : null;

  // ── 空状态 / Empty State ──
  if (!agent) {
    return (
      <aside className="right-sidebar">
        <div className="inspector-empty">
          <div className="icon">🔍</div>
          <div>Click an agent to inspect</div>
          <div style={{ fontFamily: 'var(--font-zh)', color: 'var(--text-zh)' }}>
            点击代理查看详情
          </div>
        </div>
      </aside>
    );
  }

  // ── 代理数据提取 / Agent Data Extraction ──
  const role = agent.role || 'default';
  const roleColor = ROLE_COLORS[role] || ROLE_COLORS.default;
  const roleIcon = ROLE_ICONS[role] || ROLE_ICONS.default;
  const roleLabel = ROLE_LABELS[role] || ROLE_LABELS.default;
  const status = (agent.status || agent.state || 'idle').toLowerCase();

  // 声誉数据（如有）/ Reputation data (if available)
  const reputation = agent.reputation || {};
  // 能力数据（如有）/ Capabilities data (if available)
  const capabilities = agent.capabilities || {};

  return (
    <aside className="right-sidebar">
      {/* ━━ 代理头部 / Agent Header ━━ */}
      <div style={{
        padding: '14px 12px',
        borderBottom: '1px solid var(--border)',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
      }}>
        {/* 角色图标 / Role icon */}
        <span style={{ fontSize: 22 }}>{roleIcon}</span>
        {/* 名称与标签 / Name and label */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {shortId(agent.id)}
          </div>
          <span style={{
            fontSize: 10,
            padding: '1px 6px',
            borderRadius: 8,
            backgroundColor: `${roleColor}22`,
            color: roleColor,
          }}>
            {roleLabel.en} / {roleLabel.zh}
          </span>
        </div>
        {/* 状态徽标 / Status badge */}
        <StatusBadge status={status} label={status} />
      </div>

      {/* ━━ 身份信息 / Identity ━━ */}
      <CollapsibleSection title="IDENTITY / 身份">
        <KVRow k="ID" v={shortId(agent.id)} />
        <KVRow k="Role" v={role} />
        <KVRow k="Tier" v={agent.tier} />
        <KVRow k="Status" v={status} />
        <KVRow k="ABC Role" v={agent.abcRole || agent.abc} />
      </CollapsibleSection>

      {/* ━━ 声誉 / Reputation ━━ */}
      <CollapsibleSection title="REPUTATION / 声誉">
        {REPUTATION_DIMS.map((dim) => (
          <ProgressBar
            key={dim.key}
            label={`${dim.en}`}
            value={reputation[dim.key]}
            color={dim.color}
          />
        ))}
      </CollapsibleSection>

      {/* ━━ 能力 / Capabilities ━━ */}
      <CollapsibleSection title="CAPABILITIES / 能力">
        {CAPABILITY_DIMS.map((dim) => (
          <ProgressBar
            key={dim.key}
            label={`${dim.en}`}
            value={capabilities[dim.key]}
            color="var(--amber)"
          />
        ))}
      </CollapsibleSection>
    </aside>
  );
}
