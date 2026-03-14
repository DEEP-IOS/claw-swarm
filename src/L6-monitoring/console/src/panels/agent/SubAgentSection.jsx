/**
 * 子代理区 / Sub-Agent Section
 *
 * 显示 Agent 的子代理列表和层级关系图。
 *
 * @module panels/agent/SubAgentSection
 * @author DEEP-IOS
 */
import React from 'react';
import useStore from '../../store.js';
import { ROLE_COLORS, shortId, hexToRgba } from '../../bridge/colors.js';

/**
 * 子代理节点 / Sub-agent node
 * @param {{ sub: Object, depth: number }} props
 */
function SubAgentNode({ sub, depth }) {
  const roleColor = ROLE_COLORS[sub.role] || ROLE_COLORS.default;
  const stateColor = sub.state === 'EXECUTING' ? '#F5A623' :
    sub.state === 'ACTIVE' ? '#10B981' : '#6B7280';

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 6,
      padding: '3px 6px', marginLeft: depth * 16,
      borderRadius: 4, background: hexToRgba(roleColor, 0.06),
      marginBottom: 2,
    }}>
      {/* 层级连接线 / Hierarchy connector */}
      {depth > 0 && (
        <span style={{ fontSize: 10, color: '#374151' }}>└</span>
      )}

      {/* 状态点 / Status dot */}
      <span style={{
        width: 6, height: 6, borderRadius: '50%',
        background: stateColor, flexShrink: 0,
      }} />

      {/* ID + 角色 / ID + Role */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 10, color: '#D1D5DB', fontFamily: 'var(--font-mono)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {shortId(sub.id)}
        </div>
        <div style={{ fontSize: 8, color: roleColor }}>
          {sub.role || 'default'}
        </div>
      </div>

      {/* 当前任务 / Current task */}
      {sub.task && (
        <span style={{
          fontSize: 8, color: '#6B7280', maxWidth: 80,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {sub.task}
        </span>
      )}

      {/* 状态 / State */}
      <span style={{ fontSize: 8, color: stateColor, fontWeight: 600, flexShrink: 0 }}>
        {sub.state || 'IDLE'}
      </span>
    </div>
  );
}

/**
 * @param {{ agentId: string }} props
 */
export default function SubAgentSection({ agentId }) {
  const subAgents = useStore((s) => s.subAgents);

  // 直接子代理 / Direct children
  const directChildren = subAgents.filter((s) => s.parentId === agentId);

  // 递归获取所有后代 (最大 3 层) / Get all descendants (max 3 levels)
  const getDescendants = (parentId, depth = 0) => {
    if (depth >= 3) return [];
    const children = subAgents.filter((s) => s.parentId === parentId);
    const result = [];
    for (const child of children) {
      result.push({ ...child, _depth: depth });
      result.push(...getDescendants(child.id, depth + 1));
    }
    return result;
  };

  const allDescendants = getDescendants(agentId);

  if (allDescendants.length === 0) {
    return (
      <div style={{ padding: '6px 12px', fontSize: 10, color: '#4B5563' }}>
        No sub-agents / 无子代理
      </div>
    );
  }

  return (
    <div style={{ padding: '6px 12px' }}>
      {/* 统计 / Stats */}
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
        <span style={{ fontSize: 9, color: '#6B7280' }}>
          {directChildren.length} direct / {allDescendants.length} total
        </span>
        <span style={{ fontSize: 9, color: '#4B5563' }}>
          Max depth: 3
        </span>
      </div>

      {/* 层级树 / Hierarchy tree */}
      {allDescendants.map((sub) => (
        <SubAgentNode key={sub.id} sub={sub} depth={sub._depth} />
      ))}
    </div>
  );
}
