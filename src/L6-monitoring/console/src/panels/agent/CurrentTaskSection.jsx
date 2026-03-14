/**
 * 当前任务区 / Current Task Section
 *
 * 显示 Agent 正在处理的任务：名称、进度条、Evidence 等级。
 *
 * @module panels/agent/CurrentTaskSection
 * @author DEEP-IOS
 */
import React from 'react';
import useStore from '../../store.js';
import { hexToRgba } from '../../bridge/colors.js';

const EVIDENCE_COLORS = {
  PRIMARY:     '#10B981',
  SECONDARY:   '#3B82F6',
  ANECDOTAL:   '#F5A623',
  NONE:        '#6B7280',
};

/**
 * @param {{ agentId: string }} props
 */
export default function CurrentTaskSection({ agentId }) {
  const tasks = useStore((s) => s.tasks);
  const currentTask = tasks.find((t) => t.agent === agentId && t.phase !== 'DONE');

  if (!currentTask) {
    return (
      <div style={{ padding: '8px 12px', fontSize: 10, color: '#4B5563' }}>
        No active task / 无活跃任务
      </div>
    );
  }

  const progress = currentTask.progress || 0;
  const pct = Math.round(progress * 100);
  const evidence = currentTask.evidence || 'NONE';
  const evColor = EVIDENCE_COLORS[evidence] || EVIDENCE_COLORS.NONE;

  return (
    <div style={{ padding: '8px 12px' }}>
      {/* 任务名 / Task name */}
      <div style={{
        fontSize: 11, fontWeight: 600, color: '#E5E7EB',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        marginBottom: 6,
      }}>
        {currentTask.name || currentTask.description || currentTask.id}
      </div>

      {/* 阶段 + Evidence / Phase + Evidence */}
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
        <span style={{
          fontSize: 9, padding: '1px 5px', borderRadius: 3,
          background: 'rgba(59,130,246,0.1)', color: '#3B82F6',
        }}>
          {currentTask.phase || 'EXECUTE'}
        </span>
        <span style={{
          fontSize: 9, padding: '1px 5px', borderRadius: 3,
          background: hexToRgba(evColor, 0.1), color: evColor,
        }}>
          Evidence: {evidence}
        </span>
      </div>

      {/* 进度条 / Progress bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <div style={{
          flex: 1, height: 6, background: '#1F2937',
          borderRadius: 3, overflow: 'hidden',
        }}>
          <div style={{
            width: `${pct}%`, height: '100%',
            background: 'linear-gradient(90deg, #3B82F6, #10B981)',
            borderRadius: 3, transition: 'width 0.4s ease',
          }} />
        </div>
        <span style={{ fontSize: 10, color: '#9CA3AF', fontFamily: 'var(--font-mono)', width: 30, textAlign: 'right' }}>
          {pct}%
        </span>
      </div>

      {/* 依赖 / Dependencies */}
      {currentTask.dependencies && currentTask.dependencies.length > 0 && (
        <div style={{ marginTop: 4, fontSize: 8, color: '#6B7280' }}>
          Deps: {currentTask.dependencies.join(', ')}
        </div>
      )}
    </div>
  );
}
