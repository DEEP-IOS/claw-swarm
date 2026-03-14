/**
 * 语义缩放系统 / Semantic Zoom System
 *
 * 4 级语义缩放:
 *   Level 0 - Overview  (0.5x): 仅光点 + 运动方向 + 角色颜色
 *   Level 1 - Standard  (1.0x): 完整蜜蜂 + ID 标签 + 信息素轨迹 + 交互线
 *   Level 2 - Close-up  (2.0x): 大蜜蜂 + 实时属性条 + 子代理详情 + 任务进度
 *   Level 3 - Inspect   (3.0x): 单 Agent 全屏 — 雷达图 + 能力图 + 历史
 *
 * 鼠标滚轮或捏合缩放。
 *
 * @module canvas/SemanticZoom
 * @author DEEP-IOS
 */

// ── 缩放级别配置 / Zoom Level Configurations ──
export const ZOOM_LEVELS = [
  {
    level: 0,
    name: 'Overview',
    zh: '概览',
    minScale: 0.3,
    maxScale: 0.7,
    defaultScale: 0.5,
    features: {
      showDots: true,
      showBees: false,
      showLabels: false,
      showTrails: false,
      showBeams: false,
      showSubAgents: false,
      showPheromones: false,
      showParticles: false,
      labelDetail: 'none',
    },
  },
  {
    level: 1,
    name: 'Standard',
    zh: '标准',
    minScale: 0.7,
    maxScale: 1.4,
    defaultScale: 1.0,
    features: {
      showDots: false,
      showBees: true,
      showLabels: true,
      showTrails: true,
      showBeams: true,
      showSubAgents: true,
      showPheromones: true,
      showParticles: true,
      labelDetail: 'id',
    },
  },
  {
    level: 2,
    name: 'Close-up',
    zh: '特写',
    minScale: 1.4,
    maxScale: 2.5,
    defaultScale: 2.0,
    features: {
      showDots: false,
      showBees: true,
      showLabels: true,
      showTrails: true,
      showBeams: true,
      showSubAgents: true,
      showPheromones: true,
      showParticles: true,
      labelDetail: 'full',
      showHealthBar: true,
      showTaskProgress: true,
    },
  },
  {
    level: 3,
    name: 'Inspect',
    zh: '检查',
    minScale: 2.5,
    maxScale: 4.0,
    defaultScale: 3.0,
    features: {
      showDots: false,
      showBees: true,
      showLabels: true,
      showTrails: true,
      showBeams: true,
      showSubAgents: true,
      showPheromones: true,
      showParticles: true,
      labelDetail: 'inspect',
      showHealthBar: true,
      showTaskProgress: true,
      showRadar: true,
      showCapabilities: true,
      showHistory: true,
    },
  },
];

export default class SemanticZoom {
  constructor() {
    /** @type {number} 当前缩放比例 */
    this._scale = 1.0;
    /** @type {number} 目标缩放比例 */
    this._targetScale = 1.0;
    /** @type {number} 当前缩放级别 */
    this._level = 1;
    /** @type {{x: number, y: number}} 缩放中心 */
    this._center = { x: 0, y: 0 };
    /** @type {{x: number, y: number}} 平移偏移 */
    this._offset = { x: 0, y: 0 };
    /** @type {{x: number, y: number}} 目标偏移 */
    this._targetOffset = { x: 0, y: 0 };

    // 缩放阻尼 / Zoom damping
    this._zoomDamping = 0.12;
    this._panDamping = 0.1;
  }

  /**
   * 获取当前级别 / Get current level
   * @returns {number}
   */
  get level() { return this._level; }

  /**
   * 获取当前缩放比例 / Get current scale
   * @returns {number}
   */
  get scale() { return this._scale; }

  /**
   * 获取当前偏移 / Get current offset
   * @returns {{x: number, y: number}}
   */
  get offset() { return { ...this._offset }; }

  /**
   * 获取当前级别的特征 / Get features for current level
   * @returns {Object}
   */
  get features() {
    return ZOOM_LEVELS[this._level]?.features || ZOOM_LEVELS[1].features;
  }

  /**
   * 获取级别配置 / Get level config
   * @param {number} level
   * @returns {Object}
   */
  getLevelConfig(level) {
    return ZOOM_LEVELS[level] || ZOOM_LEVELS[1];
  }

  /**
   * 确定缩放级别 / Determine zoom level from scale
   * @param {number} scale
   * @returns {number}
   */
  _scaleToLevel(scale) {
    for (let i = ZOOM_LEVELS.length - 1; i >= 0; i--) {
      if (scale >= ZOOM_LEVELS[i].minScale) return i;
    }
    return 0;
  }

  /**
   * 处理滚轮缩放 / Handle wheel zoom
   * @param {number} deltaY - 滚轮增量
   * @param {number} mouseX - 鼠标 X 位置
   * @param {number} mouseY - 鼠标 Y 位置
   */
  handleWheel(deltaY, mouseX, mouseY) {
    const zoomFactor = deltaY > 0 ? 0.9 : 1.1;
    const oldScale = this._targetScale;
    const newScale = Math.max(0.3, Math.min(4.0, oldScale * zoomFactor));
    this._center = { x: mouseX, y: mouseY };

    // 保持鼠标位置不变的偏移调整 / Offset adjustment to keep mouse position fixed
    const scaleDiff = newScale / oldScale;
    this._targetOffset.x = mouseX - (mouseX - this._targetOffset.x) * scaleDiff;
    this._targetOffset.y = mouseY - (mouseY - this._targetOffset.y) * scaleDiff;

    this._targetScale = newScale;
  }

  /**
   * 设置特定级别 / Set specific level
   * @param {number} level
   */
  setLevel(level) {
    const config = ZOOM_LEVELS[level];
    if (!config) return;
    this._targetScale = config.defaultScale;
    this._level = level;
  }

  /**
   * 每帧更新 / Update per frame
   * @param {number} dt - 帧间隔 (秒)
   */
  update(dt) {
    // 平滑缩放 / Smooth zoom
    this._scale += (this._targetScale - this._scale) * this._zoomDamping;
    this._offset.x += (this._targetOffset.x - this._offset.x) * this._panDamping;
    this._offset.y += (this._targetOffset.y - this._offset.y) * this._panDamping;

    // 更新级别 / Update level
    const newLevel = this._scaleToLevel(this._scale);
    if (newLevel !== this._level) {
      this._level = newLevel;
    }
  }

  /**
   * 将世界坐标转换为屏幕坐标 / World to screen coordinates
   * @param {number} wx
   * @param {number} wy
   * @returns {{x: number, y: number}}
   */
  worldToScreen(wx, wy) {
    return {
      x: wx * this._scale + this._offset.x,
      y: wy * this._scale + this._offset.y,
    };
  }

  /**
   * 将屏幕坐标转换为世界坐标 / Screen to world coordinates
   * @param {number} sx
   * @param {number} sy
   * @returns {{x: number, y: number}}
   */
  screenToWorld(sx, sy) {
    return {
      x: (sx - this._offset.x) / this._scale,
      y: (sy - this._offset.y) / this._scale,
    };
  }

  /**
   * 应用到 Canvas context / Apply to Canvas context
   * @param {CanvasRenderingContext2D} ctx
   */
  applyTransform(ctx) {
    ctx.setTransform(this._scale, 0, 0, this._scale, this._offset.x, this._offset.y);
  }

  /**
   * 重置缩放 / Reset zoom
   */
  reset() {
    this._scale = 1.0;
    this._targetScale = 1.0;
    this._level = 1;
    this._offset = { x: 0, y: 0 };
    this._targetOffset = { x: 0, y: 0 };
  }
}
