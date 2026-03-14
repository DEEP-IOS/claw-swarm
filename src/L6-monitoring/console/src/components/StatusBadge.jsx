/**
 * 状态徽标组件 / Status Badge Component
 *
 * 显示带有彩色圆点的状态指示器，可附带可选标签。
 * V7.0: 增加数据新鲜度指示器 (4 级)。
 *
 * @module console/components/StatusBadge
 * @author DEEP-IOS
 */

// ── 状态颜色映射 / Status Color Map ──
const STATUS_DOT_COLORS = Object.freeze({
  active:    '#10B981', // 活跃 — 翡翠绿 / Active — Emerald
  executing: '#F5A623', // 执行中 — 琥珀 / Executing — Amber
  idle:      '#6B7280', // 空闲 — 灰色 / Idle — Gray
  error:     '#EF4444', // 异常 — 红色 / Error — Red
  reporting: '#8B5CF6', // 上报中 — 紫色 / Reporting — Purple
});

// ── 新鲜度配置 / Freshness Config ──
const FRESHNESS_CONFIG = Object.freeze({
  live:         { color: '#10B981', ring: false, dashed: false, label: 'Live',         zh: '实时' },
  recent:       { color: '#F5A623', ring: false, dashed: false, label: 'Recent',       zh: '最近' },
  stale:        { color: '#6B7280', ring: true,  dashed: false, label: 'Stale',        zh: '陈旧' },
  disconnected: { color: '#EF4444', ring: true,  dashed: true,  label: 'Disconnected', zh: '断连' },
});

/**
 * 状态徽标 / Status Badge
 *
 * @param {object} props
 * @param {string} props.status - 状态名称 / Status name (active|executing|idle|error|reporting)
 * @param {string} [props.label] - 可选显示文本 / Optional display label
 * @param {string} [props.freshness] - 数据新鲜度 / Data freshness (live|recent|stale|disconnected)
 * @returns {JSX.Element}
 */
export default function StatusBadge({ status, label, freshness }) {
  // 取得颜色，默认回退灰色 / Resolve color, fallback to gray
  const color = STATUS_DOT_COLORS[status?.toLowerCase()] || STATUS_DOT_COLORS.idle;
  const freshConfig = freshness ? FRESHNESS_CONFIG[freshness] : null;

  return (
    <span className="status-badge" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
      {/* 彩色圆点 (含新鲜度指示) / Colored dot with freshness */}
      <span style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
        {/* 主圆点 / Main dot */}
        <span
          className="status-dot"
          style={{
            width: 8, height: 8, borderRadius: '50%',
            backgroundColor: freshConfig?.ring ? 'transparent' : color,
            border: freshConfig?.ring ? `1.5px ${freshConfig.dashed ? 'dashed' : 'solid'} ${color}` : 'none',
            flexShrink: 0,
            opacity: freshConfig && (freshness === 'stale' || freshness === 'disconnected') ? 0.6 : 1,
          }}
        />

        {/* 新鲜度外环 (实时时发光) / Freshness outer ring (glow when live) */}
        {freshness === 'live' && (
          <span style={{
            position: 'absolute', width: 12, height: 12, borderRadius: '50%',
            border: `1px solid ${color}`,
            opacity: 0.3,
            animation: 'pulse 2s ease-in-out infinite',
          }} />
        )}

        {/* 断连问号 / Disconnected question mark */}
        {freshness === 'disconnected' && (
          <span style={{
            position: 'absolute', fontSize: 6, color: '#EF4444',
            fontWeight: 700, lineHeight: 1,
          }}>?</span>
        )}
      </span>

      {/* 可选标签 / Optional label */}
      {label && (
        <span className="status-text" style={{
          fontSize: 11,
          color: 'var(--text-secondary)',
          opacity: freshness === 'stale' ? 0.6 : freshness === 'disconnected' ? 0.4 : 1,
        }}>
          {label}
        </span>
      )}
    </span>
  );
}
