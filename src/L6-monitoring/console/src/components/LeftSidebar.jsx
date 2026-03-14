/**
 * 左侧边栏组件 / Left Sidebar Component
 *
 * 包含三个面板：代理列表、信息素浓度条、RED 指标卡片。
 * Contains three panels: Agent list, Pheromone concentration bars, RED metric cards.
 *
 * @module console/components/LeftSidebar
 * @author DEEP-IOS
 */
import useStore from '../store.js';
import {
  ROLE_COLORS,
  PHEROMONE_COLORS,
  PHEROMONE_LABELS,
  shortId,
  fmtPct,
  fmtDuration,
} from '../bridge/colors.js';

/**
 * 左侧边栏 / Left Sidebar
 * @returns {JSX.Element}
 */
export default function LeftSidebar() {
  // ── 全局状态 / Global State ──
  const agents = useStore((s) => s.agents);
  const selectedAgentId = useStore((s) => s.selectedAgentId);
  const selectAgent = useStore((s) => s.selectAgent);
  const pheromones = useStore((s) => s.pheromones);
  const red = useStore((s) => s.red);
  const health = useStore((s) => s.health);

  return (
    <aside className="left-sidebar">
      {/* ━━ 代理列表 / Agent List ━━ */}
      <section className="sidebar-section">
        <div className="sidebar-title">AGENTS / 代理</div>
        {agents.map((agent) => {
          // 角色颜色回退 / Role color with fallback
          const dotColor = ROLE_COLORS[agent.role] || ROLE_COLORS.default;
          const isSelected = agent.id === selectedAgentId;

          return (
            <div
              key={agent.id}
              className={`agent-item${isSelected ? ' selected' : ''}`}
              onClick={() => selectAgent(agent.id)}
            >
              {/* 彩色圆点 / Colored dot */}
              <span
                className="agent-dot"
                style={{ backgroundColor: dotColor }}
              />
              {/* 代理名称（短 ID）/ Agent name (short ID) */}
              <span className="agent-name" style={agent.state === 'ENDED' ? { opacity: 0.5 } : undefined}>
                {shortId(agent.id)}
              </span>
              {/* 角色/状态标签 / Role/state tag */}
              <span className="agent-role-tag">
                {agent.state === 'ENDED' ? '已完成' : (agent.role || 'bee')}
              </span>
            </div>
          );
        })}
        {/* 空状态 / Empty state */}
        {agents.length === 0 && (
          <div style={{ fontSize: 11, color: 'var(--text-dim)', padding: '8px 0' }}>
            无代理
          </div>
        )}
      </section>

      {/* ━━ 信息素浓度 / Pheromone Concentrations ━━ */}
      <section className="sidebar-section">
        <div className="sidebar-title">PHEROMONES / 信息素</div>
        {Object.entries(pheromones).map(([key, value]) => {
          const color = PHEROMONE_COLORS[key] || '#F5A623';
          const labels = PHEROMONE_LABELS[key];
          // 值范围 0-1 转为百分比宽度 / Value 0-1 mapped to percentage width
          const pct = Math.min(Math.max((value || 0) * 100, 0), 100);

          return (
            <div className="phero-bar-wrap" key={key}>
              {/* 信息素标签 / Pheromone label */}
              <span className="phero-label">
                {labels ? labels.zh : key}
              </span>
              {/* 进度条轨道 / Progress bar track */}
              <div className="phero-bar-track">
                <div
                  className="phero-bar-fill"
                  style={{
                    width: `${pct}%`,
                    backgroundColor: color,
                  }}
                />
              </div>
              {/* 数值 / Value */}
              <span className="phero-value">{fmtPct(value)}</span>
            </div>
          );
        })}
      </section>

      {/* ━━ RED 指标 / RED Metrics ━━ */}
      <section className="sidebar-section">
        <div className="sidebar-title">RED / 核心指标</div>
        <div className="red-metrics">
          <div className="red-card">
            <div className="label">速率</div>
            <div className="value">{typeof red.rate === 'number' ? red.rate.toFixed(1) : '0'}</div>
          </div>
          <div className="red-card">
            <div className="label">错误率</div>
            <div className="value">{fmtPct(red.errorRate)}</div>
          </div>
          <div className="red-card">
            <div className="label">耗时</div>
            <div className="value">{fmtDuration(red.duration)}</div>
          </div>
          <div className="red-card">
            <div className="label">健康度</div>
            <div className="value">{typeof health === 'number' ? health : 0}</div>
          </div>
        </div>
      </section>
    </aside>
  );
}
