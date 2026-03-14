/**
 * 颜色与图标常量桥接 / Color & Icon Constants Bridge
 *
 * 从 dashboard/core.js 复用颜色定义,
 * 扩展蜂群控制台所需的完整色彩体系。
 *
 * @module console/bridge/colors
 * @author DEEP-IOS
 */

// ── 角色颜色 / Role Colors ──
export const ROLE_COLORS = Object.freeze({
  architect: '#8B5CF6',   // 架构蜂 — 紫色 / Purple
  coder:     '#10B981',   // 工蜂 — 翡翠绿 / Emerald
  reviewer:  '#F5A623',   // 审查蜂 — 金色 / Gold
  scout:     '#06B6D4',   // 侦察蜂 — 青色 / Cyan
  designer:  '#EC4899',   // 设计蜂 — 粉色 / Pink
  guard:     '#EF4444',   // 守卫蜂 — 红色 / Red
  default:   '#F5A623',   // 默认 — 琥珀 / Amber
});

// ── 角色图标 / Role Icons ──
export const ROLE_ICONS = Object.freeze({
  architect: '👑',
  coder:     '{ }',
  reviewer:  '🛡️',
  scout:     '🔭',
  designer:  '🎨',
  guard:     '⚔️',
  default:   '🐝',
});

// ── 角色标签 / Role Labels ──
export const ROLE_LABELS = Object.freeze({
  architect: { en: 'Architect', zh: '架构蜂' },
  coder:     { en: 'Coder', zh: '工蜂' },
  reviewer:  { en: 'Reviewer', zh: '审查蜂' },
  scout:     { en: 'Scout', zh: '侦察蜂' },
  designer:  { en: 'Designer', zh: '设计蜂' },
  guard:     { en: 'Guard', zh: '守卫蜂' },
  default:   { en: 'Bee', zh: '蜜蜂' },
});

// ── 蜜蜂尺寸 / Bee Sizes (px) ──
export const ROLE_SIZES = Object.freeze({
  architect: 26,
  coder:     20,
  reviewer:  21,
  scout:     18,
  designer:  19,
  guard:     22,
  default:   20,
});

// ── 翅膀频率 / Wing Frequencies (Hz) ──
export const ROLE_WING_FREQ = Object.freeze({
  architect: 8,
  coder:     14,
  reviewer:  9,
  scout:     20,
  designer:  12,
  guard:     7,
  default:   12,
});

// ── 状态颜色 / State Colors ──
export const STATE_COLORS = Object.freeze({
  EXECUTING:  '#F5A623',  // 琥珀金 / Amber gold
  ACTIVE:     '#10B981',  // 翡翠绿 / Emerald
  IDLE:       '#6B7280',  // 灰色 / Gray
  REPORTING:  '#8B5CF6',  // 紫色 / Purple
  ERROR:      '#EF4444',  // 红色 / Red
});

// ── 信息素颜色 / Pheromone Colors ──
export const PHEROMONE_COLORS = Object.freeze({
  trail:   '#F5A623',  // 琥珀金 / Amber gold
  alarm:   '#EF4444',  // 红色 / Red
  recruit: '#3B82F6',  // 蓝色 / Blue
  dance:   '#10B981',  // 翡翠绿 / Emerald
  queen:   '#8B5CF6',  // 深紫 / Deep purple
  food:    '#22C55E',  // 亮绿 / Bright green
  danger:  '#EC4899',  // 品红 / Magenta
});

// ── 信息素标签 / Pheromone Labels ──
export const PHEROMONE_LABELS = Object.freeze({
  trail:   { en: 'Trail', zh: '路径' },
  alarm:   { en: 'Alarm', zh: '警报' },
  recruit: { en: 'Recruit', zh: '招募' },
  dance:   { en: 'Dance', zh: '舞蹈' },
  queen:   { en: 'Queen', zh: '蜂王' },
  food:    { en: 'Food', zh: '食物' },
  danger:  { en: 'Danger', zh: '危险' },
});

// ── 模式颜色 / Mode Colors ──
export const MODE_COLORS = Object.freeze({
  EXPLORE:  '#3B82F6',  // 蓝色 / Blue
  EXPLOIT:  '#10B981',  // 绿色 / Green
  URGENT:   '#EF4444',  // 红色 / Red
  RELIABLE: '#F5A623',  // 琥珀 / Amber
  CONSERVE: '#6B7280',  // 灰色 / Gray
});

// ── 视图色调 / View Tint Colors ──
export const VIEW_TINTS = Object.freeze({
  hive:      '#F5A623',  // 暖琥珀 / Warm amber
  pipeline:  '#3B82F6',  // 冷蓝 / Cold blue
  cognition: '#8B5CF6',  // 紫色 / Purple
  ecology:   '#10B981',  // 绿色 / Green
  network:   '#06B6D4',  // 青色 / Cyan
  control:   '#EF4444',  // 红色 / Red
});

// ── 工具函数 / Utility Functions ──

/**
 * Hex 转 RGBA / Hex to RGBA
 * @param {string} hex
 * @param {number} [alpha=1]
 * @returns {string}
 */
export function hexToRgba(hex, alpha = 1) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

/**
 * 线性插值 / Linear interpolation
 */
export function lerp(a, b, t) {
  return a + (b - a) * t;
}

/**
 * 值裁剪 / Clamp value
 */
export function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * 短 ID / Short ID
 */
export function shortId(id) {
  if (!id) return '—';
  return id.length > 14 ? id.substring(0, 14) + '…' : id;
}

/**
 * 格式化时间 / Format timestamp
 */
export function fmtTime(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  return d.toTimeString().substring(0, 8);
}

/**
 * 格式化持续时间 / Format duration
 */
export function fmtDuration(ms) {
  if (!ms && ms !== 0) return '—';
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`;
}

/**
 * 格式化百分比 / Format percentage
 */
export function fmtPct(v) {
  if (v === undefined || v === null) return '—';
  return `${(v * 100).toFixed(1)}%`;
}
