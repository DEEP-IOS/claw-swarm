/**
 * 流水线视图覆盖层 / Pipeline View Overlay
 *
 * V7.0 完整实现:
 *   - 5 阶段泳道 (CFP/BID/EXECUTE/QUALITY/DONE) + 任务卡片
 *   - ContractNet 状态指示
 *   - QUALITY 三层勾选标记 (self/peer/lead)
 *   - S1/S2 双过程分叉指示
 *   - Evidence Gate 指示器
 *   - 底部: 流水线统计
 *
 * @module console/views/PipelineOverlay
 * @author DEEP-IOS
 */
import React from 'react';
import useStore from '../store.js';
import { ROLE_COLORS, hexToRgba, shortId } from '../bridge/colors.js';

const LANES = [
  { key: 'CFP',     color: '#3B82F6', zh: '征集提案', icon: '📢' },
  { key: 'BID',     color: '#F5A623', zh: '竞标',     icon: '🏷️' },
  { key: 'EXECUTE', color: '#10B981', zh: '执行',     icon: '⚙️' },
  { key: 'QUALITY', color: '#8B5CF6', zh: '质检',     icon: '✓' },
  { key: 'DONE',    color: '#6B7280', zh: '完成',     icon: '✅' },
];

const QUALITY_LAYERS = ['self', 'peer', 'lead'];

function laneOf(task) {
  const p = (task.phase || task.status || '').toUpperCase();
  if (p.includes('CFP') || p.includes('PENDING'))   return 'CFP';
  if (p.includes('BID') || p.includes('AUCTION'))    return 'BID';
  if (p.includes('EXEC') || p.includes('RUNNING'))   return 'EXECUTE';
  if (p.includes('QUAL') || p.includes('REVIEW'))    return 'QUALITY';
  if (p.includes('DONE') || p.includes('COMPLETE'))  return 'DONE';
  return 'CFP';
}

export default function PipelineOverlay() {
  const tasks = useStore((s) => s.tasks);
  const dual  = useStore((s) => s.dual);
  const agents = useStore((s) => s.agents);
  const selectTask = useStore((s) => s.selectTask);
  const setCompareAgent = useStore((s) => s.setCompareAgent);

  // 按泳道分组 / Group tasks by lane
  const buckets = {};
  LANES.forEach((l) => { buckets[l.key] = []; });
  tasks.forEach((t) => {
    const k = laneOf(t);
    if (buckets[k]) buckets[k].push(t);
  });

  // 双过程比例 / Dual-process ratio
  const s1 = dual?.s1 || dual?.system1 || 0;
  const s2 = dual?.s2 || dual?.system2 || 0;
  const total = s1 + s2 || 1;
  const s1Pct = ((s1 / total) * 100).toFixed(0);

  // 流水线统计 / Pipeline stats
  const totalTasks = tasks.length;
  const doneTasks = buckets.DONE.length;
  const activeTasks = buckets.EXECUTE.length;

  return (
    <div style={{ pointerEvents: 'none', padding: 12, height: '100%', display: 'flex', flexDirection: 'column', gap: 6 }}>

      {/* 连接箭头指示 / Connection arrows */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 2 }}>
        {LANES.map((lane, i) => (
          <React.Fragment key={lane.key}>
            <span style={{ fontSize: 11, color: lane.color, fontWeight: 600 }}>{lane.icon}</span>
            {i < LANES.length - 1 && (
              <span style={{ fontSize: 10, color: '#4B5563' }}>→</span>
            )}
          </React.Fragment>
        ))}
      </div>

      {/* 泳道头部 / Swimlane Headers */}
      <div style={{ display: 'flex', gap: 4 }}>
        {LANES.map((lane) => (
          <div key={lane.key} style={{
            flex: 1, textAlign: 'center', paddingBottom: 4,
            borderBottom: `2px solid ${lane.color}`, fontSize: 11, fontWeight: 600, color: lane.color,
          }}>
            <div>{lane.key}</div>
            <div style={{ fontSize: 9, opacity: 0.6, fontFamily: 'var(--font-zh)' }}>{lane.zh}</div>
            <div style={{ fontSize: 9, color: '#6B7280', fontFamily: 'var(--font-mono)' }}>
              ({buckets[lane.key].length})
            </div>
          </div>
        ))}
      </div>

      {/* 泳道内容 / Swimlane Content */}
      <div style={{ display: 'flex', gap: 4, flex: 1, overflow: 'hidden' }}>
        {LANES.map((lane) => (
          <div key={lane.key} style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4, overflow: 'auto' }}>
            {buckets[lane.key].map((task, i) => {
              const taskId = task.id || task.taskId || `task-${i}`;
              const assignee = task.agent || task.assigneeId || task.agentId || null;
              const agent = assignee ? agents.find((a) => a.id === assignee) : null;
              const roleColor = agent ? (ROLE_COLORS[agent.role] || '#6B7280') : '#6B7280';
              return (
                <div
                  key={taskId}
                  onClick={(e) => {
                    e.stopPropagation();
                    selectTask(taskId);
                    setCompareAgent(null);
                  }}
                  style={{
                  background: hexToRgba(lane.color, 0.08),
                  border: `1px solid ${hexToRgba(lane.color, 0.25)}`,
                  borderRadius: 6, padding: '5px 7px', fontSize: 10, color: '#E5E7EB',
                  pointerEvents: 'auto', cursor: 'pointer',
                  }}
                >
                  {/* 状态点 + 名称 */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: lane.color, flexShrink: 0 }} />
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                      {task.name || task.description || taskId || `Task ${i + 1}`}
                    </span>
                  </div>

                  {/* 进度条 (仅 EXECUTE) */}
                  {lane.key === 'EXECUTE' && task.progress !== undefined && (
                    <div style={{ height: 3, background: '#374151', borderRadius: 2, marginTop: 3, overflow: 'hidden' }}>
                      <div style={{ width: `${(task.progress || 0) * 100}%`, height: '100%', background: lane.color, borderRadius: 2 }} />
                    </div>
                  )}

                  {/* QUALITY 三层勾选 */}
                  {lane.key === 'QUALITY' && (
                    <div style={{ display: 'flex', gap: 4, marginTop: 3, fontSize: 8 }}>
                      {QUALITY_LAYERS.map((ql) => (
                        <span key={ql} style={{ color: task[ql + 'Pass'] ? '#10B981' : '#4B5563' }}>
                          {task[ql + 'Pass'] ? '✓' : '○'} {ql}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Agent 标签 */}
                  {assignee && (
                    <div style={{ marginTop: 3, fontSize: 8, color: roleColor }}>
                      {shortId(assignee)}
                    </div>
                  )}

                  {/* Evidence 标签 */}
                  {task.evidence && (
                    <div style={{ marginTop: 2, fontSize: 7, padding: '1px 4px', borderRadius: 3, display: 'inline-block', background: hexToRgba(lane.color, 0.2), color: lane.color }}>
                      {typeof task.evidence === 'object' ? JSON.stringify(task.evidence) : task.evidence}
                    </div>
                  )}
                </div>
              );
            })}
            {buckets[lane.key].length === 0 && (
              <div style={{ fontSize: 10, opacity: 0.2, textAlign: 'center', marginTop: 12 }}>--</div>
            )}
          </div>
        ))}
      </div>

      {/* 底部: S1/S2 + 统计 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {/* S1/S2 双过程指示器 */}
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, color: '#9CA3AF' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ color: '#3B82F6', fontWeight: 600 }}>S1</span>
            <div style={{ width: 60, height: 6, background: '#374151', borderRadius: 3, overflow: 'hidden' }}>
              <div style={{ width: `${s1Pct}%`, height: '100%', background: '#3B82F6', borderRadius: 3 }} />
            </div>
            <span style={{ color: '#8B5CF6', fontWeight: 600 }}>S2</span>
          </div>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9 }}>{s1}:{s2}</span>
        </div>

        {/* 统计 */}
        <div style={{ fontSize: 9, color: '#6B7280', textAlign: 'right' }}>
          <span>{activeTasks} active</span> · <span>{doneTasks}/{totalTasks} done</span>
        </div>
      </div>
    </div>
  );
}
