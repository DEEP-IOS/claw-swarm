/**
 * Sub-Agent Orbit / 子代理轨道
 *
 * 子代理围绕父代理轨道运动,
 * 半透明连接线表示层级关系。
 * 最大 3 层嵌套 (MAX_DEPTH=3)。
 *
 * 孵化动画: 父体膨胀 → 光球分裂 → 光球成形 → 开始轨道
 *
 * @module canvas/SubAgentOrbit
 * @author DEEP-IOS
 */

const MAX_DEPTH = 3;
const ORBIT_RADIUS = 25;
const ORBIT_SPEED = 0.8;  // rad/s

export class SubAgentOrbit {
  constructor() {
    /** @type {Array<{id: string, parentId: string, angle: number, radius: number, size: number, color: string, birthTime: number}>} */
    this._orbiters = [];
    this._time = 0;
  }

  /**
   * 同步子代理列表 / Sync sub-agent list
   * @param {Array<{id: string, parentId: string, role: string, state: string}>} subAgents
   * @param {Object<string, string>} roleColors - role → color map
   */
  sync(subAgents, roleColors = {}) {
    const existing = new Map(this._orbiters.map((o) => [o.id, o]));
    const newOrbiters = [];

    for (let i = 0; i < subAgents.length; i++) {
      const sub = subAgents[i];
      const prev = existing.get(sub.id);
      if (prev) {
        newOrbiters.push(prev);
      } else {
        // 新子代理 — 从 0 度开始, 带孵化时间
        newOrbiters.push({
          id: sub.id,
          parentId: sub.parentId,
          angle: (i / Math.max(1, subAgents.length)) * Math.PI * 2,
          radius: ORBIT_RADIUS + i * 8,
          size: 4,
          color: roleColors[sub.role] || '#6B7280',
          birthTime: this._time,
        });
      }
    }

    this._orbiters = newOrbiters;
  }

  /**
   * 更新 / Tick
   * @param {number} dt
   */
  tick(dt) {
    this._time += dt;
    for (const o of this._orbiters) {
      o.angle += ORBIT_SPEED * dt;
      if (o.angle > Math.PI * 2) o.angle -= Math.PI * 2;
    }
  }

  /**
   * 绘制子代理轨道 / Draw sub-agent orbits
   * @param {CanvasRenderingContext2D} ctx
   * @param {Map<string, {x: number, y: number}>} parentPositions - parentId → position
   */
  draw(ctx, parentPositions) {
    for (const o of this._orbiters) {
      const parent = parentPositions.get(o.parentId);
      if (!parent) continue;

      // 孵化渐入 (前 500ms) / Birth fade-in
      const age = this._time - o.birthTime;
      const birthAlpha = Math.min(1, age / 0.5);
      const birthScale = Math.min(1, age / 0.3);

      const ox = parent.x + Math.cos(o.angle) * o.radius;
      const oy = parent.y + Math.sin(o.angle) * o.radius;

      // 轨道虚线 / Orbit dashed circle
      ctx.save();
      ctx.globalAlpha = 0.15 * birthAlpha;
      ctx.strokeStyle = o.color;
      ctx.lineWidth = 0.5;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.arc(parent.x, parent.y, o.radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);

      // 连接线 / Connection line
      ctx.globalAlpha = 0.25 * birthAlpha;
      ctx.strokeStyle = o.color;
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.moveTo(parent.x, parent.y);
      ctx.lineTo(ox, oy);
      ctx.stroke();

      // 子代理光点 / Sub-agent dot
      ctx.globalAlpha = 0.8 * birthAlpha;
      const sz = o.size * birthScale;

      // 外发光 / Outer glow
      const glow = ctx.createRadialGradient(ox, oy, 0, ox, oy, sz * 3);
      glow.addColorStop(0, o.color + '40');
      glow.addColorStop(1, 'transparent');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(ox, oy, sz * 3, 0, Math.PI * 2);
      ctx.fill();

      // 核心点 / Core dot
      ctx.fillStyle = o.color;
      ctx.beginPath();
      ctx.arc(ox, oy, sz, 0, Math.PI * 2);
      ctx.fill();

      // 边框 / Border
      ctx.strokeStyle = '#fff';
      ctx.globalAlpha = 0.5 * birthAlpha;
      ctx.lineWidth = 0.5;
      ctx.stroke();

      ctx.restore();
    }
  }

  /**
   * 获取子代理位置 / Get sub-agent positions
   * @param {Map<string, {x,y}>} parentPositions
   * @returns {Map<string, {x,y}>}
   */
  getPositions(parentPositions) {
    const positions = new Map();
    for (const o of this._orbiters) {
      const parent = parentPositions.get(o.parentId);
      if (!parent) continue;
      positions.set(o.id, {
        x: parent.x + Math.cos(o.angle) * o.radius,
        y: parent.y + Math.sin(o.angle) * o.radius,
      });
    }
    return positions;
  }

  /**
   * 清空 / Clear
   */
  clear() {
    this._orbiters = [];
  }
}
