/**
 * 面板路由器 / Panel Router
 *
 * 根据选中的实体类型 (Agent / Task / Pheromone / Compare)
 * 渲染对应的详情面板。
 *
 * @module panels/PanelRouter
 * @author DEEP-IOS
 */
import React from 'react';
import useStore from '../store.js';
import AgentPanel from './agent/AgentPanel.jsx';
import TaskPanel from './task/TaskPanel.jsx';
import PheromonePanel from './pheromone/PheromonePanel.jsx';
import CompareView from './compare/CompareView.jsx';
import FormulaPanel from './formula/FormulaPanel.jsx';

/**
 * 面板路由 / Panel Router
 *
 * 优先级:
 *   1. compareAgentId 存在 → CompareView
 *   2. selectedTaskId 存在 → TaskPanel
 *   3. selectedAgentId 存在 → AgentPanel
 *   4. 无选中 → 空状态提示
 *
 * @returns {JSX.Element}
 */
export default function PanelRouter() {
  const selectedAgentId = useStore((s) => s.selectedAgentId);
  const selectedTaskId  = useStore((s) => s.selectedTaskId);
  const compareAgentId  = useStore((s) => s.compareAgentId);
  const formulaPanelOpen = useStore((s) => s.formulaPanelOpen);

  // 公式面板
  if (formulaPanelOpen) {
    return <FormulaPanel />;
  }

  // 对比模式
  if (compareAgentId && selectedAgentId) {
    return <CompareView agentAId={selectedAgentId} agentBId={compareAgentId} />;
  }

  // 任务面板
  if (selectedTaskId) {
    return <TaskPanel taskId={selectedTaskId} />;
  }

  // Agent 面板
  if (selectedAgentId) {
    return <AgentPanel agentId={selectedAgentId} />;
  }

  // 空状态 / Empty state
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', height: '100%', gap: 8, color: '#6B7280',
    }}>
      <div style={{ fontSize: 28, opacity: 0.3 }}>🔍</div>
      <div style={{ fontSize: 12, fontFamily: 'var(--font-zh)' }}>点击代理或任务查看详情</div>
      <div style={{ fontSize: 9, color: '#374151', marginTop: 8, fontFamily: 'var(--font-zh)' }}>
        Shift+点击对比代理
      </div>
    </div>
  );
}
