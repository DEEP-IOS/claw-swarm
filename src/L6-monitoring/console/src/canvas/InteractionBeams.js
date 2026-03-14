/**
 * Interaction Beams / 交互光束
 *
 * Agent-to-Agent 方向箭头虚线:
 *   delegate / handoff / review / feedback / report
 *
 * ContractNet 4 幕:
 *   CFP→BID→AWARD→PICKUP 光束动画
 *
 * Gossip 知识传递:
 *   触角接触 + 光点流
 *
 * 边颜色 = 关系类型, 粗细 = 协作权重
 *
 * @module canvas/InteractionBeams
 * @author DEEP-IOS
 */

/** 关系类型颜色 / Edge type colors */
const EDGE_COLORS = {
  delegate:      '#F5A623',
  handoff:       '#3B82F6',
  review:        '#8B5CF6',
  feedback:      '#10B981',
  report:        '#06B6D4',
  communication: '#6B7280',
};

export class InteractionBeams {
  constructor() {
    /** @type {Array<{source: {x,y}, target: {x,y}, type: string, weight: number, age: number}>} */
    this._beams = [];
    this._time = 0;
  }

  /**
   * 设置活跃边 / Set active edges
   * @param {Array<{source: string, target: string, type: string, weight: number}>} edges
   * @param {Map<string, {x: number, y: number}>} positions - agentId → position
   */
  setEdges(edges, positions) {
    this._beams = [];
    for (const e of edges) {
      const src = positions.get(e.source);
      const tgt = positions.get(e.target);
      if (!src || !tgt) continue;
      this._beams.push({
        source: { x: src.x, y: src.y },
        target: { x: tgt.x, y: tgt.y },
        type: e.type || 'communication',
        weight: e.weight || 0.5,
        age: 0,
      });
    }
  }

  /**
   * 更新 / Tick
   * @param {number} dt
   */
  tick(dt) {
    this._time += dt;
    for (const b of this._beams) {
      b.age += dt;
    }
  }

  /**
   * 绘制所有光束 / Draw all beams
   * @param {CanvasRenderingContext2D} ctx
   */
  draw(ctx) {
    const t = this._time;

    for (const beam of this._beams) {
      const { source: s, target: e, type, weight } = beam;
      const color = EDGE_COLORS[type] || EDGE_COLORS.communication;
      const lineW = 0.5 + weight * 2;

      // 虚线方向箭头 / Dashed directional arrow
      ctx.save();
      ctx.strokeStyle = color;
      ctx.globalAlpha = 0.4 + weight * 0.3;
      ctx.lineWidth = lineW;
      ctx.setLineDash([6, 4]);

      // 虚线偏移实现流动效果 / Dash offset for flow animation
      ctx.lineDashOffset = -t * 30;

      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(e.x, e.y);
      ctx.stroke();

      // 箭头头部 / Arrow head
      const angle = Math.atan2(e.y - s.y, e.x - s.x);
      const headSize = 5 + weight * 3;
      const tipX = e.x - Math.cos(angle) * 15; // 箭头停在目标前
      const tipY = e.y - Math.sin(angle) * 15;

      ctx.setLineDash([]);
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(tipX, tipY);
      ctx.lineTo(
        tipX - headSize * Math.cos(angle - Math.PI / 6),
        tipY - headSize * Math.sin(angle - Math.PI / 6),
      );
      ctx.lineTo(
        tipX - headSize * Math.cos(angle + Math.PI / 6),
        tipY - headSize * Math.sin(angle + Math.PI / 6),
      );
      ctx.closePath();
      ctx.fill();

      // 流动光点 / Flowing light dot
      const flowT = (t * 0.5 + beam.age * 0.1) % 1;
      const dotX = s.x + (e.x - s.x) * flowT;
      const dotY = s.y + (e.y - s.y) * flowT;
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.8;
      ctx.beginPath();
      ctx.arc(dotX, dotY, 2.5, 0, Math.PI * 2);
      ctx.fill();

      ctx.restore();
    }
  }

  /**
   * 清空 / Clear
   */
  clear() {
    this._beams = [];
  }
}
