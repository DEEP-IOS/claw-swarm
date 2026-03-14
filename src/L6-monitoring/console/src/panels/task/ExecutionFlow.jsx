/**
 * 执行流程图 / Execution Flow Diagram
 *
 * CFP → BID → AWARD → EXECUTE → QUALITY → DONE 线性流程图。
 * 当前阶段高亮, 已完成阶段有勾选标记。
 *
 * @module panels/task/ExecutionFlow
 * @author DEEP-IOS
 */
import React from 'react';
import { hexToRgba } from '../../bridge/colors.js';

const FLOW_STAGES = [
  { key: 'CFP',     icon: '📢', color: '#3B82F6', zh: '征集' },
  { key: 'BID',     icon: '🏷️', color: '#F5A623', zh: '竞标' },
  { key: 'EXECUTE', icon: '⚙️', color: '#10B981', zh: '执行' },
  { key: 'QUALITY', icon: '✓',  color: '#8B5CF6', zh: '质检' },
  { key: 'DONE',    icon: '✅', color: '#6B7280', zh: '完成' },
];

const PHASE_ORDER = { CFP: 0, BID: 1, EXECUTE: 2, QUALITY: 3, DONE: 4 };

/**
 * @param {{ task: Object }} props
 */
export default function ExecutionFlow({ task }) {
  const currentPhase = task.phase || 'CFP';
  const currentIdx = PHASE_ORDER[currentPhase] ?? 0;

  return (
    <div style={{ padding: '8px 12px' }}>
      {/* 流程图 / Flow diagram */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
        {FLOW_STAGES.map((stage, i) => {
          const isPast = i < currentIdx;
          const isCurrent = i === currentIdx;
          const isFuture = i > currentIdx;
          const opacity = isFuture ? 0.3 : 1;

          return (
            <React.Fragment key={stage.key}>
              {/* 节点 / Node */}
              <div style={{
                flex: 1, textAlign: 'center', opacity,
                padding: '6px 4px', borderRadius: 6,
                background: isCurrent ? hexToRgba(stage.color, 0.15) : 'transparent',
                border: isCurrent ? `1px solid ${hexToRgba(stage.color, 0.4)}` : '1px solid transparent',
                position: 'relative',
              }}>
                {/* 完成勾选 / Completion check */}
                {isPast && (
                  <div style={{
                    position: 'absolute', top: -2, right: -2,
                    width: 12, height: 12, borderRadius: '50%',
                    background: '#10B981', color: '#fff',
                    fontSize: 8, lineHeight: '12px', textAlign: 'center',
                  }}>✓</div>
                )}

                <div style={{ fontSize: 14 }}>{stage.icon}</div>
                <div style={{ fontSize: 9, fontWeight: 600, color: stage.color, marginTop: 2 }}>{stage.key}</div>
                <div style={{ fontSize: 7, color: '#6B7280', fontFamily: 'var(--font-zh)' }}>{stage.zh}</div>

                {/* 当前阶段脉冲 / Current stage pulse */}
                {isCurrent && (
                  <div style={{
                    position: 'absolute', bottom: -4, left: '50%', transform: 'translateX(-50%)',
                    width: 4, height: 4, borderRadius: '50%',
                    background: stage.color,
                    boxShadow: `0 0 6px ${stage.color}`,
                  }} />
                )}
              </div>

              {/* 连接箭头 / Connection arrow */}
              {i < FLOW_STAGES.length - 1 && (
                <span style={{
                  fontSize: 10, color: isPast ? '#10B981' : '#374151',
                  flexShrink: 0,
                }}>→</span>
              )}
            </React.Fragment>
          );
        })}
      </div>

      {/* 元数据 / Metadata */}
      <div style={{ display: 'flex', justifyContent: 'center', gap: 12, marginTop: 8, fontSize: 8, color: '#4B5563' }}>
        {task.startedAt && (
          <span>Started: {new Date(task.startedAt).toLocaleTimeString()}</span>
        )}
        {task.completedAt && (
          <span>Completed: {new Date(task.completedAt).toLocaleTimeString()}</span>
        )}
      </div>
    </div>
  );
}
