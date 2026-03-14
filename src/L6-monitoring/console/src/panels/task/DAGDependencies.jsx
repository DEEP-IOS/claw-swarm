/**
 * DAG 依赖视图 / DAG Dependencies View
 *
 * 显示任务的上游和下游依赖列表 + 关键路径标记。
 *
 * @module panels/task/DAGDependencies
 * @author DEEP-IOS
 */
import React from 'react';
import useStore from '../../store.js';
import { hexToRgba, shortId } from '../../bridge/colors.js';

const PHASE_COLORS = {
  CFP: '#3B82F6', BID: '#F5A623', EXECUTE: '#10B981',
  QUALITY: '#8B5CF6', DONE: '#6B7280',
};

/**
 * 依赖节点 / Dependency node
 */
function DepNode({ task, direction, onClick }) {
  const phase = task.phase || 'CFP';
  const color = PHASE_COLORS[phase] || '#6B7280';

  return (
    <div
      onClick={() => onClick?.(task.id)}
      style={{
        display: 'flex', alignItems: 'center', gap: 6,
        padding: '4px 8px', marginBottom: 3, borderRadius: 4,
        background: hexToRgba(color, 0.06),
        border: `1px solid ${hexToRgba(color, 0.15)}`,
        cursor: onClick ? 'pointer' : 'default',
      }}
    >
      {/* 方向箭头 / Direction arrow */}
      <span style={{ fontSize: 10, color: direction === 'upstream' ? '#3B82F6' : '#10B981' }}>
        {direction === 'upstream' ? '↑' : '↓'}
      </span>

      {/* 任务信息 / Task info */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 10, color: '#D1D5DB',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {task.name || task.description || shortId(task.id)}
        </div>
      </div>

      {/* 阶段标签 / Phase tag */}
      <span style={{
        fontSize: 8, padding: '1px 5px', borderRadius: 3,
        background: hexToRgba(color, 0.15), color,
        fontWeight: 600,
      }}>
        {phase}
      </span>
    </div>
  );
}

/**
 * @param {{ taskId: string }} props
 */
export default function DAGDependencies({ taskId }) {
  const dag = useStore((s) => s.dag);
  const tasks = useStore((s) => s.tasks);
  const selectTask = useStore((s) => s.setSelectedTaskId);

  const dagEdges = dag?.edges || [];

  // 上游 (指向当前任务的边) / Upstream (edges targeting this task)
  const upstreamIds = dagEdges
    .filter((e) => e.target === taskId)
    .map((e) => e.source);

  // 下游 (从当前任务出发的边) / Downstream (edges from this task)
  const downstreamIds = dagEdges
    .filter((e) => e.source === taskId)
    .map((e) => e.target);

  const upstreamTasks = upstreamIds
    .map((id) => tasks.find((t) => t.id === id))
    .filter(Boolean);

  const downstreamTasks = downstreamIds
    .map((id) => tasks.find((t) => t.id === id))
    .filter(Boolean);

  const handleClick = (id) => {
    if (selectTask) selectTask(id);
  };

  if (upstreamTasks.length === 0 && downstreamTasks.length === 0) {
    return (
      <div style={{ padding: '8px 12px', fontSize: 10, color: '#4B5563', textAlign: 'center' }}>
        No dependencies / 无依赖关系
      </div>
    );
  }

  return (
    <div style={{ padding: '8px 12px' }}>
      {/* 上游 / Upstream */}
      {upstreamTasks.length > 0 && (
        <>
          <div style={{ fontSize: 9, color: '#3B82F6', fontWeight: 600, marginBottom: 4 }}>
            ↑ Upstream / 上游 ({upstreamTasks.length})
          </div>
          {upstreamTasks.map((t) => (
            <DepNode key={t.id} task={t} direction="upstream" onClick={handleClick} />
          ))}
        </>
      )}

      {/* 当前任务标记 / Current task marker */}
      <div style={{
        textAlign: 'center', padding: '4px 0', margin: '4px 0',
        fontSize: 9, color: '#9CA3AF', borderTop: '1px dashed #374151', borderBottom: '1px dashed #374151',
      }}>
        ● Current Task / 当前任务
      </div>

      {/* 下游 / Downstream */}
      {downstreamTasks.length > 0 && (
        <>
          <div style={{ fontSize: 9, color: '#10B981', fontWeight: 600, marginBottom: 4 }}>
            ↓ Downstream / 下游 ({downstreamTasks.length})
          </div>
          {downstreamTasks.map((t) => (
            <DepNode key={t.id} task={t} direction="downstream" onClick={handleClick} />
          ))}
        </>
      )}

      {/* 关键路径提示 / Critical path hint */}
      {dagEdges.length > 0 && (
        <div style={{ marginTop: 6, fontSize: 8, color: '#4B5563', textAlign: 'center' }}>
          DAG: {dagEdges.length} edges / {tasks.length} tasks
        </div>
      )}
    </div>
  );
}
