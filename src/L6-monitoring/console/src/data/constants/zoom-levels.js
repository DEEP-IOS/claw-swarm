/**
 * 语义缩放配置 / Semantic Zoom Configuration
 *
 * 4 级语义缩放, 每级显示不同信息密度。
 *
 * @module constants/zoom-levels
 * @author DEEP-IOS
 */

/**
 * @typedef {Object} ZoomLevel
 * @property {string} id
 * @property {string} en
 * @property {string} zh
 * @property {number} scale - 缩放比例
 * @property {boolean} showLabels - 显示标签
 * @property {boolean} showTrails - 显示轨迹
 * @property {boolean} showEdges - 显示交互线
 * @property {boolean} showSubAgents - 显示子代理
 * @property {boolean} showAttributes - 显示属性条
 * @property {boolean} showFormulas - 显示公式
 * @property {number} beeSize - 蜜蜂大小倍率
 */

/** @type {ZoomLevel[]} */
export const ZOOM_LEVELS = [
  {
    id: 'overview', en: 'Overview', zh: '总览',
    scale: 0.5,
    showLabels: false, showTrails: false, showEdges: false,
    showSubAgents: false, showAttributes: false, showFormulas: false,
    beeSize: 0.6,
  },
  {
    id: 'standard', en: 'Standard', zh: '标准',
    scale: 1.0,
    showLabels: true, showTrails: true, showEdges: true,
    showSubAgents: true, showAttributes: false, showFormulas: false,
    beeSize: 1.0,
  },
  {
    id: 'closeup', en: 'Close-up', zh: '特写',
    scale: 2.0,
    showLabels: true, showTrails: true, showEdges: true,
    showSubAgents: true, showAttributes: true, showFormulas: false,
    beeSize: 1.5,
  },
  {
    id: 'inspect', en: 'Inspect', zh: '检视',
    scale: 3.0,
    showLabels: true, showTrails: true, showEdges: true,
    showSubAgents: true, showAttributes: true, showFormulas: true,
    beeSize: 2.0,
  },
];

/**
 * 根据缩放值获取当前缩放级别 / Get zoom level from scale value
 * @param {number} scale
 * @returns {ZoomLevel}
 */
export function getZoomLevel(scale) {
  if (scale <= 0.75) return ZOOM_LEVELS[0];
  if (scale <= 1.5) return ZOOM_LEVELS[1];
  if (scale <= 2.5) return ZOOM_LEVELS[2];
  return ZOOM_LEVELS[3];
}
