/**
 * 历史记录区 / History Section
 *
 * 显示 Agent 最近 5 次任务结果 + 趋势箭头。
 *
 * @module panels/agent/HistorySection
 * @author DEEP-IOS
 */
import React from 'react';
import useStore from '../../store.js';
import { shortId, hexToRgba, fmtTime } from '../../bridge/colors.js';

const RESULT_ICONS = {
  success: { icon: '✓', color: '#10B981' },
  failure: { icon: '✗', color: '#EF4444' },
  partial: { icon: '◐', color: '#F5A623' },
  pending: { icon: '◌', color: '#6B7280' },
};

/**
 * 趋势计算 / Calculate trend
 * @param {Array} results
 * @returns {'up'|'down'|'flat'}
 */
function calcTrend(results) {
  if (results.length < 2) return 'flat';
  const recent = results.slice(0, 3);
  const older = results.slice(3);
  const recentRate = recent.filter((r) => r.result === 'success').length / recent.length;
  const olderRate = older.length > 0
    ? older.filter((r) => r.result === 'success').length / older.length
    : 0.5;
  if (recentRate > olderRate + 0.1) return 'up';
  if (recentRate < olderRate - 0.1) return 'down';
  return 'flat';
}

const TREND_DISPLAY = {
  up:   { arrow: '↗', color: '#10B981', zh: '上升' },
  down: { arrow: '↘', color: '#EF4444', zh: '下降' },
  flat: { arrow: '→', color: '#6B7280', zh: '持平' },
};

/**
 * @param {{ agentId: string }} props
 */
export default function HistorySection({ agentId }) {
  const tasks = useStore((s) => s.tasks);
  const shapley = useStore((s) => s.shapley);

  // 已完成任务作为历史 / Completed tasks as history
  const completedTasks = tasks
    .filter((t) => t.agent === agentId && t.phase === 'DONE')
    .slice(0, 5)
    .map((t) => ({
      taskId: t.id,
      name: t.name || t.description || t.id,
      result: t.selfPass && t.peerPass && t.leadPass ? 'success' :
        t.selfPass ? 'partial' : t.result || 'success',
      ts: t.completedAt || t.ts,
    }));

  const trend = calcTrend(completedTasks);
  const td = TREND_DISPLAY[trend];
  const credit = shapley[agentId];

  return (
    <div style={{ padding: '6px 12px' }}>
      {/* 趋势 + Shapley / Trend + Shapley */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ fontSize: 14, color: td.color }}>{td.arrow}</span>
          <span style={{ fontSize: 9, color: td.color, fontWeight: 600 }}>Trend</span>
          <span style={{ fontSize: 8, color: '#6B7280', fontFamily: 'var(--font-zh)' }}>{td.zh}</span>
        </div>
        {typeof credit === 'number' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
            <span style={{ fontSize: 8, color: '#6B7280' }}>Shapley</span>
            <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: '#06B6D4', fontWeight: 600 }}>
              {credit.toFixed(2)}
            </span>
          </div>
        )}
      </div>

      {/* 结果列表 / Result list */}
      {completedTasks.length === 0 ? (
        <div style={{ fontSize: 10, color: '#4B5563', textAlign: 'center' }}>
          No history / 暂无历史
        </div>
      ) : (
        completedTasks.map((r, i) => {
          const ri = RESULT_ICONS[r.result] || RESULT_ICONS.pending;
          return (
            <div key={r.taskId || i} style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '3px 4px', marginBottom: 2,
              borderRadius: 3, background: hexToRgba(ri.color, 0.06),
            }}>
              <span style={{ fontSize: 12, color: ri.color, width: 16, textAlign: 'center' }}>{ri.icon}</span>
              <span style={{
                flex: 1, fontSize: 9, color: '#D1D5DB',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {shortId(r.name)}
              </span>
              {r.ts && (
                <span style={{ fontSize: 8, color: '#4B5563', fontFamily: 'var(--font-mono)' }}>
                  {fmtTime(r.ts)}
                </span>
              )}
            </div>
          );
        })
      )}

      {/* 成功率 / Success rate */}
      {completedTasks.length > 0 && (
        <div style={{ textAlign: 'center', marginTop: 4, fontSize: 8, color: '#6B7280' }}>
          Success rate / 成功率:&nbsp;
          <span style={{ color: '#10B981', fontWeight: 600, fontFamily: 'var(--font-mono)' }}>
            {Math.round((completedTasks.filter((r) => r.result === 'success').length / completedTasks.length) * 100)}%
          </span>
        </div>
      )}
    </div>
  );
}
