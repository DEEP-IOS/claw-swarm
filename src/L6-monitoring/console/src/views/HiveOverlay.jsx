/**
 * 蜂巢视图覆盖层 / Hive View Overlay
 *
 * V7.0 完整实现:
 *   - 中心模式指示器 (模式名 + 健康分数)
 *   - Agent 角色统计
 *   - 信息素强度条
 *   - 底部任务航班条 (CFP/BID/EXECUTE/QUALITY/DONE)
 *
 * @module console/views/HiveOverlay
 * @author DEEP-IOS
 */
import React from 'react';
import useStore from '../store.js';
import { VIEW_TINTS, MODE_COLORS, ROLE_COLORS, hexToRgba } from '../bridge/colors.js';

const TINT = VIEW_TINTS.hive;

const PHASES = [
  { key: 'CFP',     color: '#3B82F6', zh: '征集' },
  { key: 'BID',     color: '#F5A623', zh: '竞标' },
  { key: 'EXECUTE', color: '#10B981', zh: '执行' },
  { key: 'QUALITY', color: '#8B5CF6', zh: '质检' },
  { key: 'DONE',    color: '#6B7280', zh: '完成' },
];

const PHER_KEYS = [
  { key: 'trail',   color: '#F5A623', label: 'T' },
  { key: 'alarm',   color: '#EF4444', label: 'A' },
  { key: 'recruit', color: '#3B82F6', label: 'R' },
  { key: 'dance',   color: '#10B981', label: 'D' },
  { key: 'queen',   color: '#8B5CF6', label: 'Q' },
  { key: 'food',    color: '#22C55E', label: 'F' },
  { key: 'danger',  color: '#EC4899', label: '!' },
];

function phaseOf(task) {
  const p = (task.phase || task.status || '').toUpperCase();
  if (p.includes('CFP') || p.includes('PENDING')) return 'CFP';
  if (p.includes('BID') || p.includes('AUCTION')) return 'BID';
  if (p.includes('EXEC') || p.includes('RUNNING')) return 'EXECUTE';
  if (p.includes('QUAL') || p.includes('REVIEW')) return 'QUALITY';
  if (p.includes('DONE') || p.includes('COMPLETE')) return 'DONE';
  return 'CFP';
}

export default function HiveOverlay() {
  const mode = useStore((s) => s.mode);
  const health = useStore((s) => s.health);
  const agents = useStore((s) => s.agents);
  const tasks = useStore((s) => s.tasks);
  const pheromones = useStore((s) => s.pheromones);

  const modeColor = MODE_COLORS[mode.m] || MODE_COLORS.EXPLOIT;
  const healthColor = health > 80 ? '#10B981' : health > 50 ? '#F5A623' : '#EF4444';

  const roleCounts = {};
  agents.forEach((a) => { const r = a.role || 'default'; roleCounts[r] = (roleCounts[r] || 0) + 1; });

  const phaseCounts = {};
  PHASES.forEach((p) => { phaseCounts[p.key] = 0; });
  tasks.forEach((t) => { const k = phaseOf(t); phaseCounts[k] = (phaseCounts[k] || 0) + 1; });

  const activeCount = agents.filter((a) => a.state !== 'IDLE').length;

  return (
    <div style={{ pointerEvents: 'none', padding: 12, height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>

      {/* 顶部: 模式 + 健康度 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: modeColor, boxShadow: `0 0 8px ${modeColor}` }} />
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: modeColor, letterSpacing: 1 }}>{mode.m || 'EXPLORE'}</div>
            <div style={{ fontSize: 9, color: '#6B7280' }}>Turn {mode.turns || 0}</div>
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 20, fontWeight: 700, color: healthColor, fontFamily: 'var(--font-mono)' }}>
            {typeof health === 'number' ? health : '—'}
          </div>
          <div style={{ fontSize: 9, color: '#6B7280' }}>Health / 健康度</div>
        </div>
      </div>

      {/* 中间: Agent 角色统计 */}
      <div style={{ display: 'flex', justifyContent: 'center', gap: 12, opacity: 0.5 }}>
        {Object.entries(roleCounts).length === 0 && (
          <div style={{ fontSize: 9, color: '#4B5563', fontFamily: 'var(--font-zh)' }}>等待代理...</div>
        )}
        {Object.entries(roleCounts).map(([role, count]) => (
          <div key={role} style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: ROLE_COLORS[role] || TINT }}>{count}</div>
            <div style={{ fontSize: 8, color: '#6B7280', textTransform: 'uppercase' }}>{role}</div>
          </div>
        ))}
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: '#F5A623' }}>{activeCount}</div>
          <div style={{ fontSize: 8, color: '#6B7280' }}>ACTIVE</div>
        </div>
      </div>

      {/* 底部: 信息素条 + 任务航班条 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {/* 信息素强度条 */}
        <div style={{ display: 'flex', gap: 3, justifyContent: 'center' }}>
          {PHER_KEYS.map((p) => {
            const val = pheromones[p.key] || 0;
            return (
              <div key={p.key} style={{ textAlign: 'center', width: 28 }}>
                <div style={{ height: 16, background: hexToRgba(p.color, 0.15), borderRadius: 2, overflow: 'hidden', position: 'relative' }}>
                  <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: `${val * 100}%`, background: hexToRgba(p.color, 0.6), borderRadius: 2, transition: 'height 0.3s ease' }} />
                </div>
                <div style={{ fontSize: 7, color: p.color, marginTop: 1, fontWeight: 600 }}>{p.label}</div>
              </div>
            );
          })}
        </div>

        {/* 任务航班条 */}
        <div style={{ display: 'flex', gap: 2, background: 'rgba(17,24,39,0.6)', borderRadius: 6, padding: '4px 6px' }}>
          {PHASES.map((phase) => {
            const count = phaseCounts[phase.key];
            return (
              <div key={phase.key} style={{ flex: 1, textAlign: 'center', padding: '3px 0', borderRadius: 4, background: count > 0 ? hexToRgba(phase.color, 0.15) : 'transparent' }}>
                <div style={{ fontSize: 9, fontWeight: 600, color: phase.color }}>{phase.key}</div>
                <div style={{ fontSize: 11, fontWeight: 700, color: count > 0 ? '#E5E7EB' : '#4B5563', fontFamily: 'var(--font-mono)' }}>{count}</div>
                <div style={{ fontSize: 7, color: '#6B7280', fontFamily: 'var(--font-zh)' }}>{phase.zh}</div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
