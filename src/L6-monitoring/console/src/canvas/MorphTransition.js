/**
 * 形变过渡系统 / Morph Transition System
 *
 * V7.0 完整实现:
 *   - 5 条形变路径 (Hive → Pipeline/Cognition/Ecology/Network/Control)
 *   - 时间线:
 *       T=0-200   旧视图 UI 淡出
 *       T=100-700 共享元素移动+形状变形
 *       T=400-800 新视图 UI 展开
 *   - Agent 元素沿弧线路径 (非直线)
 *   - Spring 物理插值 (morphing preset)
 *
 * @module canvas/MorphTransition
 * @author DEEP-IOS
 */

import { SPRING_PRESETS, springStep, hasConverged } from '../utils/spring.js';
import { MODE_COLORS } from '../bridge/colors.js';

// ── 过渡总时长 / Total transition duration ──
const MORPH_DURATION = 800; // ms

// ── 时间阶段 / Timeline phases ──
const PHASE_OLD_FADE   = { start: 0,   end: 200 }; // 旧视图淡出
const PHASE_MORPH      = { start: 100, end: 700 }; // 共享元素形变
const PHASE_NEW_REVEAL = { start: 400, end: 800 }; // 新视图展开

// ── 视图布局配置 / View layout configurations ──
const VIEW_LAYOUTS = {
  hive:      { cx: 0.5, cy: 0.5, agentSpread: 'scatter',  color: '#F5A623' },
  pipeline:  { cx: 0.5, cy: 0.4, agentSpread: 'columns',  color: '#3B82F6' },
  cognition: { cx: 0.5, cy: 0.5, agentSpread: 'layers',   color: '#8B5CF6' },
  ecology:   { cx: 0.5, cy: 0.4, agentSpread: 'columns3', color: '#10B981' },
  network:   { cx: 0.5, cy: 0.5, agentSpread: 'force',    color: '#06B6D4' },
  control:   { cx: 0.5, cy: 0.3, agentSpread: 'grid',     color: '#F5A623' },
};

/**
 * 计算弧线路径上的点 / Calculate point on arc path
 * Agent 沿弧线 (非直线) 从 A 移动到 B
 *
 * @param {number} x0 - 起点 X
 * @param {number} y0 - 起点 Y
 * @param {number} x1 - 终点 X
 * @param {number} y1 - 终点 Y
 * @param {number} t  - 插值因子 [0, 1]
 * @param {number} arcHeight - 弧线高度 (正=上弧, 负=下弧)
 * @returns {{ x: number, y: number }}
 */
function arcLerp(x0, y0, x1, y1, t, arcHeight = -40) {
  // 二次贝塞尔弧线 / Quadratic Bezier arc
  const mx = (x0 + x1) / 2;
  const my = (y0 + y1) / 2 + arcHeight;
  const u = 1 - t;
  return {
    x: u * u * x0 + 2 * u * t * mx + t * t * x1,
    y: u * u * y0 + 2 * u * t * my + t * t * y1,
  };
}

/**
 * 缓动函数: ease-in-out cubic / Easing function
 * @param {number} t - [0, 1]
 * @returns {number}
 */
function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/**
 * 计算视图中 Agent 的目标位置 / Calculate agent target position in view
 *
 * @param {string} view - 目标视图名
 * @param {number} index - Agent 索引
 * @param {number} total - Agent 总数
 * @param {number} w - Canvas 宽度
 * @param {number} h - Canvas 高度
 * @returns {{ x: number, y: number }}
 */
function getAgentPositionForView(view, index, total, w, h) {
  const layout = VIEW_LAYOUTS[view] || VIEW_LAYOUTS.hive;
  const cx = layout.cx * w;
  const cy = layout.cy * h;

  switch (layout.agentSpread) {
    case 'scatter': {
      // 蜂巢散布 (Boids 决定最终位置, 这里给初始散布)
      const angle = (index / Math.max(total, 1)) * Math.PI * 2;
      const radius = Math.min(w, h) * 0.25;
      return { x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius };
    }
    case 'columns': {
      // 5 列泳道 (Pipeline)
      const col = index % 5;
      const row = Math.floor(index / 5);
      const colW = w / 5;
      return { x: colW * col + colW / 2, y: 100 + row * 50 };
    }
    case 'layers': {
      // 3 层 (Cognition)
      const layer = index % 3;
      const layerH = h / 3;
      const layerIndex = Math.floor(index / 3);
      const perRow = Math.ceil(total / 3);
      return { x: 40 + (layerIndex / Math.max(perRow, 1)) * (w - 80), y: layerH * layer + layerH / 2 };
    }
    case 'columns3': {
      // 3 列 (Ecology ABC)
      const col3 = index % 3;
      const row3 = Math.floor(index / 3);
      const colW3 = w / 3;
      return { x: colW3 * col3 + colW3 / 2, y: 80 + row3 * 45 };
    }
    case 'force': {
      // 力导向布局近似 (Network)
      const angle2 = (index / Math.max(total, 1)) * Math.PI * 2 + Math.sin(index * 0.7) * 0.3;
      const r = Math.min(w, h) * 0.3 * (0.5 + Math.sin(index * 1.3) * 0.5);
      return { x: cx + Math.cos(angle2) * r, y: cy + Math.sin(angle2) * r };
    }
    case 'grid': {
      // 网格 (Control)
      const cols = Math.ceil(Math.sqrt(total));
      const gx = index % cols;
      const gy = Math.floor(index / cols);
      const cellW = (w - 60) / cols;
      const cellH = 40;
      return { x: 30 + gx * cellW + cellW / 2, y: h * 0.5 + gy * cellH };
    }
    default:
      return { x: cx, y: cy };
  }
}

export default class MorphTransition {
  constructor() {
    /** @type {string|null} 起始视图 */
    this._fromView = null;
    /** @type {string|null} 目标视图 */
    this._toView = null;
    /** @type {number} 过渡开始时间 */
    this._startTime = 0;
    /** @type {boolean} 是否正在过渡中 */
    this._active = false;

    // Spring 物理状态 (每个 agent 一组)
    /** @type {Map<string, {pos:{x,y}, vel:{x,y}, target:{x,y}, startPos:{x,y}}>} */
    this._springs = new Map();

    // 不透明度 spring
    this._oldOpacity = { pos: 1, vel: 0 };
    this._newOpacity = { pos: 0, vel: 0 };

    // Spring 配置
    const preset = SPRING_PRESETS.morphing;
    this._stiffness = preset.stiffness;
    this._damping = preset.damping;
    this._mass = preset.mass;
  }

  /**
   * 是否正在过渡中 / Is transition active
   * @returns {boolean}
   */
  get active() { return this._active; }

  /**
   * 获取当前过渡进度 / Get current transition progress [0, 1]
   * @param {number} now - 当前时间 (performance.now())
   * @returns {number}
   */
  getProgress(now) {
    if (!this._active) return 1;
    return Math.min(1, (now - this._startTime) / MORPH_DURATION);
  }

  /**
   * 启动形变过渡 / Start morph transition
   *
   * @param {string} fromView - 当前视图 (hive/pipeline/cognition/ecology/network/control)
   * @param {string} toView   - 目标视图
   * @param {Array<{id: string, x: number, y: number}>} agentPositions - 当前 Agent 位置
   * @param {number} canvasW  - Canvas 宽度
   * @param {number} canvasH  - Canvas 高度
   */
  start(fromView, toView, agentPositions, canvasW, canvasH) {
    if (fromView === toView) return;

    this._fromView = fromView;
    this._toView = toView;
    this._startTime = performance.now();
    this._active = true;

    // 重置不透明度 spring
    this._oldOpacity = { pos: 1, vel: 0 };
    this._newOpacity = { pos: 0, vel: 0 };

    // 初始化每个 Agent 的 spring 状态
    this._springs.clear();
    const total = agentPositions.length;

    agentPositions.forEach((agent, i) => {
      const target = getAgentPositionForView(toView, i, total, canvasW, canvasH);
      this._springs.set(agent.id, {
        pos: { x: agent.x, y: agent.y },
        vel: { x: 0, y: 0 },
        target,
        startPos: { x: agent.x, y: agent.y },
      });
    });
  }

  /**
   * 更新过渡状态 (每帧调用) / Update transition state (call per frame)
   *
   * @param {number} now - performance.now()
   * @param {number} dt  - 帧间隔 (秒)
   * @returns {{
   *   active: boolean,
   *   oldOpacity: number,
   *   newOpacity: number,
   *   agentPositions: Map<string, {x: number, y: number}>,
   *   morphProgress: number,
   *   fromView: string|null,
   *   toView: string|null,
   *   fromColor: string,
   *   toColor: string,
   * }}
   */
  update(now, dt) {
    if (!this._active) {
      return {
        active: false,
        oldOpacity: 0,
        newOpacity: 1,
        agentPositions: new Map(),
        morphProgress: 1,
        fromView: null,
        toView: null,
        fromColor: '#F5A623',
        toColor: '#F5A623',
      };
    }

    const elapsed = now - this._startTime;
    const progress = Math.min(1, elapsed / MORPH_DURATION);

    // ── 阶段1: 旧视图淡出 / Phase 1: Old view fade out ──
    const oldFadeT = Math.max(0, Math.min(1,
      (elapsed - PHASE_OLD_FADE.start) / (PHASE_OLD_FADE.end - PHASE_OLD_FADE.start)
    ));
    const oldTargetOpacity = 1 - easeInOutCubic(oldFadeT);

    // ── 阶段3: 新视图展开 / Phase 3: New view reveal ──
    const newRevealT = Math.max(0, Math.min(1,
      (elapsed - PHASE_NEW_REVEAL.start) / (PHASE_NEW_REVEAL.end - PHASE_NEW_REVEAL.start)
    ));
    const newTargetOpacity = easeInOutCubic(newRevealT);

    // Spring 驱动不透明度
    const oldSpring = springStep(this._oldOpacity.pos, this._oldOpacity.vel, oldTargetOpacity,
      this._stiffness * 1.5, this._damping * 1.2, this._mass * 0.8, dt);
    this._oldOpacity.pos = Math.max(0, Math.min(1, oldSpring.pos));
    this._oldOpacity.vel = oldSpring.vel;

    const newSpring = springStep(this._newOpacity.pos, this._newOpacity.vel, newTargetOpacity,
      this._stiffness * 1.5, this._damping * 1.2, this._mass * 0.8, dt);
    this._newOpacity.pos = Math.max(0, Math.min(1, newSpring.pos));
    this._newOpacity.vel = newSpring.vel;

    // ── 阶段2: Agent 位置形变 / Phase 2: Agent position morph ──
    const morphT = Math.max(0, Math.min(1,
      (elapsed - PHASE_MORPH.start) / (PHASE_MORPH.end - PHASE_MORPH.start)
    ));
    const easedMorphT = easeInOutCubic(morphT);

    const agentPositions = new Map();
    let allConverged = true;

    for (const [id, state] of this._springs) {
      if (morphT < 1) {
        // 弧线插值 (不用 spring, 用弧线 + easing)
        // Spring 用于微调最终位置
        const arcPos = arcLerp(
          state.startPos.x, state.startPos.y,
          state.target.x, state.target.y,
          easedMorphT,
          -30 - Math.sin(parseInt(id, 36) || 0) * 20 // 每个 agent 不同弧高
        );
        state.pos.x = arcPos.x;
        state.pos.y = arcPos.y;
        allConverged = false;
      } else {
        // 过渡接近结束, 用 spring 精确收敛到目标
        const sx = springStep(state.pos.x, state.vel.x, state.target.x, this._stiffness, this._damping, this._mass, dt);
        const sy = springStep(state.pos.y, state.vel.y, state.target.y, this._stiffness, this._damping, this._mass, dt);
        state.pos.x = sx.pos; state.vel.x = sx.vel;
        state.pos.y = sy.pos; state.vel.y = sy.vel;

        if (!hasConverged(state.pos.x, state.vel.x, state.target.x, 0.5) ||
            !hasConverged(state.pos.y, state.vel.y, state.target.y, 0.5)) {
          allConverged = false;
        }
      }
      agentPositions.set(id, { x: state.pos.x, y: state.pos.y });
    }

    // 检查是否完成
    if (progress >= 1 && allConverged) {
      this._active = false;
    }

    const fromLayout = VIEW_LAYOUTS[this._fromView] || VIEW_LAYOUTS.hive;
    const toLayout = VIEW_LAYOUTS[this._toView] || VIEW_LAYOUTS.hive;

    return {
      active: this._active,
      oldOpacity: this._oldOpacity.pos,
      newOpacity: this._newOpacity.pos,
      agentPositions,
      morphProgress: progress,
      fromView: this._fromView,
      toView: this._toView,
      fromColor: fromLayout.color,
      toColor: toLayout.color,
    };
  }

  /**
   * 取消过渡 / Cancel transition
   */
  cancel() {
    this._active = false;
    this._springs.clear();
  }

  /**
   * 获取 Agent 过渡位置 / Get single agent transition position
   * @param {string} agentId
   * @returns {{ x: number, y: number }|null}
   */
  getAgentPosition(agentId) {
    const state = this._springs.get(agentId);
    return state ? { x: state.pos.x, y: state.pos.y } : null;
  }

  /**
   * 获取全局缩放因子 / Get global scale factor during transition
   * 过渡中间阶段略微缩小 (呼吸感)
   * @param {number} now
   * @returns {number}
   */
  getScale(now) {
    if (!this._active) return 1;
    const progress = this.getProgress(now);
    // 中间缩到 0.95, 两端为 1.0
    return 1 - 0.05 * Math.sin(progress * Math.PI);
  }

  /**
   * 获取背景色混合 / Get blended background color
   * @param {number} now
   * @returns {{ r: number, g: number, b: number, a: number }}
   */
  getBackgroundBlend(now) {
    if (!this._active) return { r: 0, g: 0, b: 0, a: 0 };
    const progress = this.getProgress(now);
    const fromLayout = VIEW_LAYOUTS[this._fromView] || VIEW_LAYOUTS.hive;
    const toLayout = VIEW_LAYOUTS[this._toView] || VIEW_LAYOUTS.hive;

    // 解析颜色
    const fc = hexToRGB(fromLayout.color);
    const tc = hexToRGB(toLayout.color);
    const t = easeInOutCubic(progress);

    return {
      r: fc.r + (tc.r - fc.r) * t,
      g: fc.g + (tc.g - fc.g) * t,
      b: fc.b + (tc.b - fc.b) * t,
      a: 0.05 * Math.sin(progress * Math.PI), // 中间最浓, 两端透明
    };
  }
}

/**
 * Hex 颜色转 RGB / Hex color to RGB
 * @param {string} hex
 * @returns {{ r: number, g: number, b: number }}
 */
function hexToRGB(hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return { r, g, b };
}
