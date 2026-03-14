/**
 * 质量审计面板 / Quality Audit Panel
 *
 * Evidence 等级 + 三层审查结果 (self/peer/lead)。
 *
 * @module panels/task/QualityAudit
 * @author DEEP-IOS
 */
import React from 'react';
import { hexToRgba } from '../../bridge/colors.js';

const EVIDENCE_LEVELS = [
  { key: 'PRIMARY',   color: '#10B981', zh: '主要',   desc: 'Direct verification' },
  { key: 'SECONDARY', color: '#3B82F6', zh: '次要',   desc: 'Indirect evidence' },
  { key: 'ANECDOTAL', color: '#F5A623', zh: '轶事',   desc: 'Circumstantial' },
  { key: 'NONE',      color: '#6B7280', zh: '无',     desc: 'No evidence' },
];

const REVIEW_LAYERS = [
  { key: 'self', en: 'Self Review',  zh: '自审', icon: '①', color: '#3B82F6' },
  { key: 'peer', en: 'Peer Review',  zh: '同审', icon: '②', color: '#8B5CF6' },
  { key: 'lead', en: 'Lead Review',  zh: '主审', icon: '③', color: '#10B981' },
];

/**
 * @param {{ task: Object }} props
 */
export default function QualityAudit({ task }) {
  const evidence = task.evidence || 'NONE';
  const evLevel = EVIDENCE_LEVELS.find((e) => e.key === evidence) || EVIDENCE_LEVELS[3];

  return (
    <div style={{ padding: '8px 12px' }}>
      {/* Evidence 等级 / Evidence Level */}
      <div style={{ marginBottom: 8 }}>
        <div style={{ fontSize: 9, color: '#6B7280', marginBottom: 4 }}>
          Evidence Level / 证据等级
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          {EVIDENCE_LEVELS.map((ev) => {
            const isActive = ev.key === evidence;
            return (
              <div key={ev.key} style={{
                flex: 1, textAlign: 'center', padding: '4px 2px',
                borderRadius: 4,
                background: isActive ? hexToRgba(ev.color, 0.15) : 'transparent',
                border: `1px solid ${hexToRgba(ev.color, isActive ? 0.4 : 0.1)}`,
                opacity: isActive ? 1 : 0.4,
              }}>
                <div style={{ fontSize: 10, fontWeight: 600, color: ev.color }}>{ev.key}</div>
                <div style={{ fontSize: 7, color: '#6B7280', fontFamily: 'var(--font-zh)' }}>{ev.zh}</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 三层审查 / Three-layer review */}
      <div style={{ marginBottom: 6 }}>
        <div style={{ fontSize: 9, color: '#6B7280', marginBottom: 4 }}>
          Review Layers / 审查层级
        </div>
        {REVIEW_LAYERS.map((layer) => {
          const passed = task[layer.key + 'Pass'];
          const reviewer = task[layer.key + 'Reviewer'];
          const score = task[layer.key + 'Score'];

          return (
            <div key={layer.key} style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '4px 6px', marginBottom: 3,
              borderRadius: 4,
              background: hexToRgba(layer.color, passed ? 0.08 : 0.02),
              border: `1px solid ${hexToRgba(layer.color, passed ? 0.2 : 0.05)}`,
            }}>
              {/* 状态指示 / Status indicator */}
              <span style={{
                width: 18, height: 18, borderRadius: '50%',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: passed ? hexToRgba(layer.color, 0.2) : 'rgba(107,114,128,0.1)',
                color: passed ? layer.color : '#4B5563',
                fontSize: 10, fontWeight: 700, flexShrink: 0,
              }}>
                {passed ? '✓' : layer.icon}
              </span>

              {/* 层名 / Layer name */}
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 10, color: passed ? layer.color : '#6B7280', fontWeight: 600 }}>
                  {layer.en}
                </div>
                <div style={{ fontSize: 8, color: '#4B5563', fontFamily: 'var(--font-zh)' }}>
                  {layer.zh}
                </div>
              </div>

              {/* 分数 / Score */}
              {typeof score === 'number' && (
                <span style={{
                  fontSize: 10, fontFamily: 'var(--font-mono)',
                  color: score >= 0.7 ? '#10B981' : score >= 0.5 ? '#F5A623' : '#EF4444',
                }}>
                  {(score * 100).toFixed(0)}%
                </span>
              )}

              {/* 审查者 / Reviewer */}
              {reviewer && (
                <span style={{ fontSize: 8, color: '#4B5563', fontFamily: 'var(--font-mono)' }}>
                  by {reviewer.substring(0, 8)}
                </span>
              )}

              {/* 通过/未通过 / Pass/Fail */}
              <span style={{
                fontSize: 9, fontWeight: 600,
                color: passed === true ? '#10B981' : passed === false ? '#EF4444' : '#4B5563',
              }}>
                {passed === true ? 'PASS' : passed === false ? 'FAIL' : '—'}
              </span>
            </div>
          );
        })}
      </div>

      {/* 备注 / Notes */}
      {task.qualityNotes && (
        <div style={{
          fontSize: 9, color: '#6B7280', padding: '4px 6px',
          background: 'rgba(107,114,128,0.05)', borderRadius: 4,
          fontStyle: 'italic',
        }}>
          {typeof task.qualityNotes === 'object' ? JSON.stringify(task.qualityNotes) : task.qualityNotes}
        </div>
      )}
    </div>
  );
}
