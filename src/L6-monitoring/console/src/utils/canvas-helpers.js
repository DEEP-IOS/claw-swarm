/**
 * Canvas 绘图辅助函数 / Canvas Drawing Helpers
 *
 * 通用 Canvas 2D 绘图工具集。
 *
 * @module utils/canvas-helpers
 * @author DEEP-IOS
 */

/**
 * 绘制圆角矩形 / Draw rounded rectangle
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} x
 * @param {number} y
 * @param {number} w - 宽度
 * @param {number} h - 高度
 * @param {number} r - 圆角半径
 */
export function drawRoundedRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

/**
 * 绘制弧线段 / Draw arc
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} cx - 圆心 X
 * @param {number} cy - 圆心 Y
 * @param {number} radius - 半径
 * @param {number} startAngle - 起始角 (弧度)
 * @param {number} endAngle - 终止角 (弧度)
 */
export function drawArc(ctx, cx, cy, radius, startAngle, endAngle) {
  ctx.beginPath();
  ctx.arc(cx, cy, radius, startAngle, endAngle);
  ctx.stroke();
}

/**
 * 绘制贝塞尔曲线 / Draw Bezier curve
 * @param {CanvasRenderingContext2D} ctx
 * @param {{x,y}} p0 - 起点
 * @param {{x,y}} cp1 - 控制点1
 * @param {{x,y}} cp2 - 控制点2
 * @param {{x,y}} p1 - 终点
 */
export function drawBezier(ctx, p0, cp1, cp2, p1) {
  ctx.beginPath();
  ctx.moveTo(p0.x, p0.y);
  ctx.bezierCurveTo(cp1.x, cp1.y, cp2.x, cp2.y, p1.x, p1.y);
  ctx.stroke();
}

/**
 * 绘制方向箭头 / Draw directional arrow
 * @param {CanvasRenderingContext2D} ctx
 * @param {{x,y}} from
 * @param {{x,y}} to
 * @param {number} [headSize=8]
 */
export function drawArrow(ctx, from, to, headSize = 8) {
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.stroke();
  // 箭头头部
  ctx.beginPath();
  ctx.moveTo(to.x, to.y);
  ctx.lineTo(
    to.x - headSize * Math.cos(angle - Math.PI / 6),
    to.y - headSize * Math.sin(angle - Math.PI / 6),
  );
  ctx.lineTo(
    to.x - headSize * Math.cos(angle + Math.PI / 6),
    to.y - headSize * Math.sin(angle + Math.PI / 6),
  );
  ctx.closePath();
  ctx.fill();
}

/**
 * 绘制虚线 / Draw dashed line
 * @param {CanvasRenderingContext2D} ctx
 * @param {{x,y}} from
 * @param {{x,y}} to
 * @param {number[]} [pattern=[6,4]]
 */
export function drawDashedLine(ctx, from, to, pattern = [6, 4]) {
  ctx.setLineDash(pattern);
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.stroke();
  ctx.setLineDash([]);
}

/**
 * 绘制发光效果 / Draw glow effect
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} cx
 * @param {number} cy
 * @param {number} radius
 * @param {string} color - CSS 颜色
 * @param {number} [intensity=0.6]
 */
export function drawGlow(ctx, cx, cy, radius, color, intensity = 0.6) {
  const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
  grad.addColorStop(0, color.replace(')', `, ${intensity})`).replace('rgb(', 'rgba('));
  grad.addColorStop(1, 'transparent');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fill();
}

/**
 * 绘制文本标签 (带背景) / Draw text label with background
 * @param {CanvasRenderingContext2D} ctx
 * @param {string} text
 * @param {number} x
 * @param {number} y
 * @param {Object} [opts]
 */
export function drawLabel(ctx, text, x, y, opts = {}) {
  const { font = '10px sans-serif', color = '#fff', bg = 'rgba(0,0,0,0.7)', padding = 4 } = opts;
  ctx.font = font;
  const metrics = ctx.measureText(text);
  const w = metrics.width + padding * 2;
  const h = 14 + padding * 2;

  ctx.fillStyle = bg;
  drawRoundedRect(ctx, x - w / 2, y - h / 2, w, h, 3);
  ctx.fill();

  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y);
}

/**
 * 计算两点距离 / Distance between two points
 * @param {{x,y}} a
 * @param {{x,y}} b
 * @returns {number}
 */
export function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * 线性插值 / Linear interpolation
 * @param {number} a - 起点
 * @param {number} b - 终点
 * @param {number} t - 插值因子 [0,1]
 * @returns {number}
 */
export function lerp(a, b, t) {
  return a + (b - a) * t;
}

/**
 * 角度线性插值 (最短路径) / Angle lerp (shortest path)
 * @param {number} a - 起始角度 (弧度)
 * @param {number} b - 目标角度 (弧度)
 * @param {number} t - 插值因子
 * @returns {number}
 */
export function lerpAngle(a, b, t) {
  let diff = b - a;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return a + diff * t;
}
