/**
 * 顶栏组件 / Header Bar Component
 *
 * 包含蜂群标志、视图标签页切换、全局模式徽标和连接状态指示器。
 * Contains swarm logo, view tab switcher, global mode badge, and connection status indicator.
 *
 * @module console/components/Header
 * @author DEEP-IOS
 */
import useStore from '../store.js';
import { MODE_COLORS, hexToRgba } from '../bridge/colors.js';
import BilingualLabel from './BilingualLabel.jsx';

// ── 视图标签定义 / View Tab Definitions ──
const VIEW_TABS = [
  { key: 'hive',      icon: '⊞',  en: 'Hive',      zh: '蜂巢' },
  { key: 'pipeline',  icon: '→',  en: 'Pipeline',  zh: '流水线' },
  { key: 'cognition', icon: '🧠', en: 'Cognition', zh: '认知' },
  { key: 'ecology',   icon: '🌿', en: 'Ecology',   zh: '生态' },
  { key: 'network',   icon: '🕸️', en: 'Network',   zh: '网络' },
  { key: 'control',   icon: '🎛️', en: 'Control',   zh: '控制' },
];

/**
 * 顶栏 / Header
 * @returns {JSX.Element}
 */
export default function Header() {
  // 从全局状态读取 / Read from global state
  const view = useStore((s) => s.view);
  const mode = useStore((s) => s.mode);
  const sseConnected = useStore((s) => s.sseConnected);
  const replayActive = useStore((s) => s.replayActive);
  const setView = useStore((s) => s.setView);
  const toggleSettings = useStore((s) => s.toggleSettings);
  const setExportDialogOpen = useStore((s) => s.setExportDialogOpen);

  // 模式颜色 / Mode color
  const modeKey = mode?.m || 'EXPLOIT';
  const modeColor = MODE_COLORS[modeKey] || MODE_COLORS.EXPLOIT;

  return (
    <header className="app-header">
      {/* ── 标志 / Logo ── */}
      <div className="logo">
        <span className="bee-icon">🐝</span>
        Claw-Swarm V7.0
      </div>

      {/* ── 视图标签页 / View Tabs ── */}
      <nav className="view-tabs" style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch', flexShrink: 1, minWidth: 0 }}>
        {VIEW_TABS.map((tab) => (
          <button
            key={tab.key}
            className={`view-tab${view === tab.key ? ' active' : ''}`}
            onClick={() => setView(tab.key)}
            title={`${tab.en} / ${tab.zh}`}
          >
            <span className="tab-icon">{tab.icon}</span>
            {' '}
            <BilingualLabel en={tab.en} zh={tab.zh} />
          </button>
        ))}
      </nav>

      {/* ── 右侧集群 / Right Cluster ── */}
      <div className="header-right">
        {replayActive && (
          <span
            className="mode-badge"
            style={{
              backgroundColor: 'rgba(245,166,35,0.2)',
              color: '#F5A623',
              borderColor: 'rgba(245,166,35,0.4)',
            }}
          >
            REPLAY
          </span>
        )}

        <button
          type="button"
          onClick={() => setExportDialogOpen(true)}
          title="Export / 导出"
          style={{
            background: 'rgba(255,255,255,0.06)',
            border: '1px solid rgba(255,255,255,0.12)',
            color: '#D1D5DB',
            borderRadius: 6,
            padding: '4px 8px',
            fontSize: 11,
            cursor: 'pointer',
          }}
        >
          EXP
        </button>

        <button
          type="button"
          onClick={toggleSettings}
          title="Settings / 设置"
          style={{
            background: 'rgba(255,255,255,0.06)',
            border: '1px solid rgba(255,255,255,0.12)',
            color: '#D1D5DB',
            borderRadius: 6,
            padding: '4px 8px',
            fontSize: 11,
            cursor: 'pointer',
          }}
        >
          SET
        </button>

        {/* 模式徽标 / Mode Badge */}
        <span
          className="mode-badge"
          style={{
            backgroundColor: hexToRgba(modeColor, 0.2),
            color: modeColor,
            borderColor: hexToRgba(modeColor, 0.4),
          }}
        >
          {modeKey}
        </span>

        {/* 连接状态指示灯 / Live Connection Badge */}
        <span className="live-badge">
          <span className={`live-dot ${replayActive ? 'replay' : (sseConnected ? 'connected' : 'disconnected')}`} />
          {replayActive ? 'REPLAY' : (sseConnected ? 'LIVE' : 'OFF')}
        </span>
      </div>
    </header>
  );
}
