/**
 * 数据新鲜度配置 / Data Freshness Configuration
 *
 * 4 级新鲜度阈值和视觉表现。
 *
 * @module constants/freshness
 * @author DEEP-IOS
 */

/**
 * @typedef {Object} FreshnessLevel
 * @property {string} id
 * @property {string} en
 * @property {string} zh
 * @property {number} maxAge - 最大年龄 (ms), Infinity 表示无上限
 * @property {string} dotColor - 指示点颜色
 * @property {number} opacity - 数据透明度
 * @property {string} borderStyle - 边框样式
 * @property {string} icon - 图标字符
 */

/** @type {FreshnessLevel[]} */
export const FRESHNESS_LEVELS = [
  {
    id: 'live', en: 'Real-time', zh: '实时',
    maxAge: 3000,
    dotColor: '#10B981', opacity: 1.0, borderStyle: 'solid', icon: '\u25CF',
  },
  {
    id: 'recent', en: 'Recent', zh: '最近',
    maxAge: 15000,
    dotColor: '#F5A623', opacity: 0.85, borderStyle: 'solid', icon: '\u25CB',
  },
  {
    id: 'stale', en: 'Stale', zh: '陈旧',
    maxAge: 60000,
    dotColor: '#6B7280', opacity: 0.6, borderStyle: 'dashed', icon: '\u25CB',
  },
  {
    id: 'disconnected', en: 'Disconnected', zh: '断连',
    maxAge: Infinity,
    dotColor: '#EF4444', opacity: 0.4, borderStyle: 'dashed', icon: '?',
  },
];

/**
 * 根据最后事件时间获取新鲜度 / Get freshness from last event time
 * @param {number|null} lastEventTime
 * @param {boolean} connected
 * @returns {FreshnessLevel}
 */
export function getFreshnessLevel(lastEventTime, connected) {
  if (!connected) return FRESHNESS_LEVELS[3];
  if (!lastEventTime) return FRESHNESS_LEVELS[2];
  const age = Date.now() - lastEventTime;
  for (const level of FRESHNESS_LEVELS) {
    if (age <= level.maxAge) return level;
  }
  return FRESHNESS_LEVELS[3];
}
