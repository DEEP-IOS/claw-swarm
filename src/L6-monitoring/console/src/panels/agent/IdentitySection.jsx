/**
 * Agent 身份区 / Agent Identity Section
 *
 * 显示角色图标、Agent ID、角色标签、状态徽标。
 *
 * @module panels/agent/IdentitySection
 * @author DEEP-IOS
 */
import React from 'react';
import { ROLE_COLORS, ROLE_ICONS, ROLE_LABELS, shortId } from '../../bridge/colors.js';
import StatusBadge from '../../components/StatusBadge.jsx';

/**
 * @param {{ agent: Object }} props
 */
export default function IdentitySection({ agent }) {
  const role = agent.role || 'default';
  const roleColor = ROLE_COLORS[role] || ROLE_COLORS.default;
  const roleIcon = ROLE_ICONS[role] || ROLE_ICONS.default;
  const roleLabel = ROLE_LABELS[role] || ROLE_LABELS.default;
  const status = (agent.status || agent.state || 'idle').toLowerCase();

  return (
    <div style={{
      padding: '12px', borderBottom: '1px solid rgba(255,255,255,0.06)',
      display: 'flex', alignItems: 'center', gap: 10,
    }}>
      {/* 角色图标 / Role icon */}
      <div style={{
        width: 40, height: 40, borderRadius: 10,
        background: `${roleColor}15`, border: `1px solid ${roleColor}30`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 20,
      }}>
        {roleIcon}
      </div>

      {/* 名称 + 角色 / Name + Role */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 13, fontWeight: 600, color: '#E5E7EB',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          fontFamily: 'var(--font-mono)',
        }}>
          {shortId(agent.id)}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 2 }}>
          <span style={{
            fontSize: 9, padding: '1px 6px', borderRadius: 8,
            background: `${roleColor}20`, color: roleColor,
          }}>
            {roleLabel.en}
          </span>
          <span style={{ fontSize: 9, color: '#6B7280', fontFamily: 'var(--font-zh)' }}>
            {roleLabel.zh}
          </span>
        </div>
      </div>

      {/* 状态 / Status */}
      <StatusBadge status={status} label={status} />
    </div>
  );
}
