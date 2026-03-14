/**
 * Trail System / 轨迹系统
 *
 * 每个 Agent 维护 60 帧位置历史, 用 Bezier 曲线渲染方向性轨迹。
 * Each agent maintains 60-frame position history, rendered as Bezier trails.
 *
 * 轨迹颜色 = 角色颜色, 透明度随距离衰减。
 * 蜜蜂经过时轨迹变金色 (trail 信息素)。
 *
 * @module canvas/TrailSystem
 * @author DEEP-IOS
 */
import { ROLE_COLORS } from '../bridge/colors.js';

const MAX_POINTS = 60;
const MIN_DIST = 3;  // 最小记录距离 (避免静止时堆积)

export class TrailSystem {
  constructor() {
    /** @type {Map<string, {points: Array<{x:number,y:number}>, role: string}>} */
    this._trails = new Map();
  }

  /**
   * 记录 Agent 位置 / Record agent position
   * @param {string} id
   * @param {number} x
   * @param {number} y
   * @param {string} role
   */
  record(id, x, y, role) {
    let trail = this._trails.get(id);
    if (!trail) {
      trail = { points: [], role: role || 'coder' };
      this._trails.set(id, trail);
    }
    trail.role = role || trail.role;

    const pts = trail.points;
    const last = pts[pts.length - 1];

    // 只在移动足够距离时记录 / Only record if moved enough
    if (last) {
      const dx = x - last.x;
      const dy = y - last.y;
      if (dx * dx + dy * dy < MIN_DIST * MIN_DIST) return;
    }

    pts.push({ x, y });
    if (pts.length > MAX_POINTS) pts.shift();
  }

  /**
   * 移除 Agent 轨迹 / Remove agent trail
   * @param {string} id
   */
  remove(id) {
    this._trails.delete(id);
  }

  /**
   * 绘制所有轨迹 / Draw all trails
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} trailPheromone - trail 信息素浓度 (0-1)
   */
  draw(ctx, trailPheromone = 0) {
    for (const [, trail] of this._trails) {
      const pts = trail.points;
      if (pts.length < 3) continue;

      const baseColor = ROLE_COLORS[trail.role] || '#F5A623';
      const len = pts.length;

      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      // 从旧到新分段绘制, 透明度渐增 / Draw segments old→new with increasing opacity
      for (let i = 1; i < len; i++) {
        const t = i / len;
        const alpha = t * 0.4;         // 最新点 alpha=0.4
        const lineW = t * 2.5 + 0.5;   // 最新点 width=3

        // trail 信息素使轨迹变金色 / Trail pheromone makes trail golden
        const color = trailPheromone > 0.3
          ? `rgba(251,191,36,${alpha})`  // gold
          : hexToRgba(baseColor, alpha);

        ctx.strokeStyle = color;
        ctx.lineWidth = lineW;
        ctx.beginPath();
        ctx.moveTo(pts[i - 1].x, pts[i - 1].y);

        // 使用 quadratic curve 平滑 / Smooth with quadratic curve
        if (i < len - 1) {
          const mx = (pts[i].x + pts[i + 1].x) / 2;
          const my = (pts[i].y + pts[i + 1].y) / 2;
          ctx.quadraticCurveTo(pts[i].x, pts[i].y, mx, my);
        } else {
          ctx.lineTo(pts[i].x, pts[i].y);
        }
        ctx.stroke();
      }
    }
  }

  /**
   * 清除所有轨迹 / Clear all trails
   */
  clear() {
    this._trails.clear();
  }
}

/**
 * hex → rgba / Convert hex to rgba
 * @param {string} hex
 * @param {number} alpha
 * @returns {string}
 */
function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}
