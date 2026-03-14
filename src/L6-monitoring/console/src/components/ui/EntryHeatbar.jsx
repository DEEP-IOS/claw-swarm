/**
 * 入口热力条 / Entry Heatbar
 *
 * 双向流量: 左进 (领取任务) / 右出 (完成返回)
 * 角色颜色分段。
 * 中心动态通道 (蜜蜂图标穿梭)。
 * 不平衡警告。
 *
 * @module components/ui/EntryHeatbar
 * @author DEEP-IOS
 */
import React, { useMemo } from 'react';
import useStore from '../../store.js';
import { ROLE_COLORS, hexToRgba } from '../../bridge/colors.js';

/**
 * @returns {JSX.Element}
 */
export default function EntryHeatbar() {
  const agents = useStore((s) => s.agents);
  const tasks = useStore((s) => s.tasks);

  // 计算进/出流量 / Calculate in/out flow
  const flow = useMemo(() => {
    const entering = agents.filter((a) =>
      a.state === 'EXECUTING' || a.state === 'ACTIVE'
    );
    const exiting = agents.filter((a) =>
      a.state === 'REPORTING' || a.state === 'IDLE'
    );

    // 按角色分组 / Group by role
    const inByRole = {};
    const outByRole = {};
    entering.forEach((a) => {
      const r = a.role || 'default';
      inByRole[r] = (inByRole[r] || 0) + 1;
    });
    exiting.forEach((a) => {
      const r = a.role || 'default';
      outByRole[r] = (outByRole[r] || 0) + 1;
    });

    return {
      entering: entering.length,
      exiting: exiting.length,
      inByRole,
      outByRole,
      total: agents.length || 1,
    };
  }, [agents]);

  const imbalance = Math.abs(flow.entering - flow.exiting) / flow.total;
  const isImbalanced = imbalance > 0.3;

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 4,
      height: 20, padding: '0 8px',
    }}>
      {/* 进入标签 / Entry label */}
      <span style={{ fontSize: 8, color: '#10B981', fontWeight: 600, width: 20, textAlign: 'right' }}>
        {flow.entering}
      </span>

      {/* 进入条 (右向) / Entry bar (rightward) */}
      <div style={{
        flex: 1, height: 8, background: '#1F2937', borderRadius: 4,
        overflow: 'hidden', display: 'flex', direction: 'rtl',
      }}>
        {Object.entries(flow.inByRole).map(([role, count]) => (
          <div key={role} style={{
            width: `${(count / flow.total) * 100}%`,
            height: '100%',
            background: ROLE_COLORS[role] || ROLE_COLORS.default,
            opacity: 0.7,
          }} />
        ))}
      </div>

      {/* 中心通道 / Center channel */}
      <div style={{
        width: 28, height: 14, borderRadius: 7,
        background: isImbalanced ? 'rgba(239,68,68,0.1)' : 'rgba(107,114,128,0.1)',
        border: `1px solid ${isImbalanced ? 'rgba(239,68,68,0.3)' : 'rgba(107,114,128,0.15)'}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 8,
      }}>
        {isImbalanced ? '⚠' : '⇄'}
      </div>

      {/* 退出条 (左向) / Exit bar (leftward) */}
      <div style={{
        flex: 1, height: 8, background: '#1F2937', borderRadius: 4,
        overflow: 'hidden', display: 'flex',
      }}>
        {Object.entries(flow.outByRole).map(([role, count]) => (
          <div key={role} style={{
            width: `${(count / flow.total) * 100}%`,
            height: '100%',
            background: ROLE_COLORS[role] || ROLE_COLORS.default,
            opacity: 0.5,
          }} />
        ))}
      </div>

      {/* 退出标签 / Exit label */}
      <span style={{ fontSize: 8, color: '#F5A623', fontWeight: 600, width: 20 }}>
        {flow.exiting}
      </span>
    </div>
  );
}
