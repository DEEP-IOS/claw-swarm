/**
 * 任务详情面板 / Task Detail Panel
 *
 * 显示任务的完整信息:
 *   - 基本信息 (名称/阶段/优先级/Agent)
 *   - 执行流程图 (CFP→BID→AWARD→EXECUTE→QUALITY→DONE)
 *   - DAG 上下游依赖
 *   - 质量审计结果
 *
 * @module panels/task/TaskPanel
 * @author DEEP-IOS
 */
import React, { useState } from 'react';
import useStore from '../../store.js';
import { ROLE_COLORS, hexToRgba, shortId, fmtTime } from '../../bridge/colors.js';
import ExecutionFlow from './ExecutionFlow.jsx';
import DAGDependencies from './DAGDependencies.jsx';
import QualityAudit from './QualityAudit.jsx';

/**
 * 可折叠区 / Collapsible Section
 */
function Section({ title, titleZh, defaultOpen = true, children }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
      <div onClick={() => setOpen((v) => !v)} style={{
        display: 'flex', alignItems: 'center', gap: 6,
        padding: '8px 12px', cursor: 'pointer', userSelect: 'none',
      }}>
        <span style={{ fontSize: 9, color: '#6B7280', transition: 'transform 150ms', transform: open ? 'rotate(90deg)' : 'rotate(0deg)' }}>▶</span>
        <span style={{ fontSize: 10, fontWeight: 600, color: '#9CA3AF', letterSpacing: 1 }}>{title}</span>
        {titleZh && <span style={{ fontSize: 9, color: '#4B5563', fontFamily: 'var(--font-zh)' }}>/ {titleZh}</span>}
      </div>
      {open && children}
    </div>
  );
}

const PHASE_COLORS = {
  CFP:     '#3B82F6',
  BID:     '#F5A623',
  EXECUTE: '#10B981',
  QUALITY: '#8B5CF6',
  DONE:    '#6B7280',
};

/**
 * @param {{ taskId: string }} props
 */
export default function TaskPanel({ taskId }) {
  const task = useStore((s) => s.tasks.find((t) => (t.id || t.taskId) === taskId));
  const agents = useStore((s) => s.agents);

  if (!task) {
    return (
      <div style={{ padding: 20, textAlign: 'center', color: '#4B5563', fontSize: 11 }}>
        Task not found / 任务未找到
      </div>
    );
  }

  const phase = task.phase || 'CFP';
  const phaseColor = PHASE_COLORS[phase] || '#6B7280';
  const assignee = task.agent || task.assigneeId || task.agentId || null;
  const assignedAgent = assignee ? agents.find((a) => a.id === assignee) : null;
  const agentRole = assignedAgent?.role || 'default';
  const agentColor = ROLE_COLORS[agentRole] || ROLE_COLORS.default;

  return (
    <div style={{
      height: '100%', overflow: 'auto',
      borderLeft: `2px solid ${hexToRgba(phaseColor, 0.3)}`,
    }}>
      {/* 头部 / Header */}
      <div style={{
        padding: '12px', borderBottom: '1px solid rgba(255,255,255,0.06)',
      }}>
        {/* 任务名 / Task name */}
        <div style={{ fontSize: 13, fontWeight: 600, color: '#E5E7EB', marginBottom: 6 }}>
          {task.name || task.description || task.id}
        </div>

        {/* 阶段 + 优先级 / Phase + Priority */}
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{
            fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 4,
            background: hexToRgba(phaseColor, 0.15), color: phaseColor,
          }}>
            {phase}
          </span>
          {task.priority !== undefined && (
            <span style={{
              fontSize: 9, padding: '1px 6px', borderRadius: 3,
              background: 'rgba(107,114,128,0.1)', color: '#9CA3AF',
            }}>
              P{task.priority}
            </span>
          )}
          {task.evidence && (
            <span style={{
              fontSize: 9, padding: '1px 6px', borderRadius: 3,
              background: hexToRgba('#10B981', 0.1), color: '#10B981',
            }}>
              {typeof task.evidence === 'object' ? JSON.stringify(task.evidence) : task.evidence}
            </span>
          )}
        </div>

        {/* 分配 Agent / Assigned Agent */}
        {assignedAgent && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 6 }}>
            <span style={{ fontSize: 9, color: '#6B7280' }}>Assigned to / 分配给:</span>
            <span style={{
              fontSize: 10, fontFamily: 'var(--font-mono)', color: agentColor, fontWeight: 600,
            }}>
              {shortId(assignedAgent.id)}
            </span>
            <span style={{ fontSize: 8, color: '#4B5563' }}>({agentRole})</span>
          </div>
        )}

        {/* 进度条 (仅 EXECUTE 阶段) / Progress bar */}
        {phase === 'EXECUTE' && task.progress !== undefined && (
          <div style={{ marginTop: 6 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: '#6B7280', marginBottom: 2 }}>
              <span>Progress / 进度</span>
              <span style={{ fontFamily: 'var(--font-mono)' }}>{Math.round(task.progress * 100)}%</span>
            </div>
            <div style={{ height: 6, background: '#1F2937', borderRadius: 3, overflow: 'hidden' }}>
              <div style={{
                width: `${task.progress * 100}%`, height: '100%',
                background: `linear-gradient(90deg, ${phaseColor}, #10B981)`,
                borderRadius: 3, transition: 'width 0.4s ease',
              }} />
            </div>
          </div>
        )}
      </div>

      {/* 执行流程 / Execution Flow */}
      <Section title="EXECUTION FLOW" titleZh="执行流程">
        <ExecutionFlow task={task} />
      </Section>

      {/* DAG 依赖 / DAG Dependencies */}
      <Section title="DEPENDENCIES" titleZh="依赖关系">
        <DAGDependencies taskId={taskId} />
      </Section>

      {/* 质量审计 / Quality Audit */}
      <Section title="QUALITY AUDIT" titleZh="质量审计">
        <QualityAudit task={task} />
      </Section>
    </div>
  );
}
