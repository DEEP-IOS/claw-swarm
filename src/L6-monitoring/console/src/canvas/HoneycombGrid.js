/**
 * 蜂巢六角网格渲染器 / Honeycomb Hexagonal Grid Renderer
 *
 * 在背景画布 (canvas-bg) 上绘制六角形网格底纹,
 * 营造蜂巢视觉氛围。使用尖顶 (pointy-top) 六角几何。
 *
 * V7.0 增强:
 *   - 活动密度热力图 (agent 高频经过区域变亮变暖)
 *   - 信息素沉积点额外高亮
 *   - 模式色中心径向渐变
 *   - 视图主题色调
 *
 * @module console/canvas/HoneycombGrid
 * @author DEEP-IOS
 */

import { hexToRgba } from '../bridge/colors.js';

// ── 六角形尺寸常量 / Hex size constants ──
const HEX_SIZE = 30;
const HEX_WIDTH = HEX_SIZE * 2;
const HEX_HEIGHT = HEX_SIZE * Math.sqrt(3);
const HEAT_DECAY = 0.995; // 热力衰减率 / Heat decay rate per frame
const MAX_HEAT = 1.0;

export class HoneycombGrid {
  /**
   * @param {CanvasRenderingContext2D} ctx - 背景画布上下文 / Background canvas context
   * @param {number} width - 画布宽度 / Canvas width
   * @param {number} height - 画布高度 / Canvas height
   */
  constructor(ctx, width, height) {
    this.ctx = ctx;
    this.w = width;
    this.h = height;

    // ── 热力图数据 / Heatmap data ──
    /** @type {Map<string, number>} 六角格 key → 热度值 / Hex key → heat value */
    this._heatmap = new Map();
    /** @type {Map<string, number>} 信息素沉积点 / Pheromone deposit points */
    this._pheromoneDeposits = new Map();
    /** @type {number} 动态时间相位 / Dynamic phase time */
    this._time = 0;
    /** @type {number} alarm 浓度缓存 / Cached alarm intensity */
    this._alarmLevel = 0;

    // 列间距和行间距 / Column and row spacing
    this._colSpacing = HEX_WIDTH * 0.75;
    this._rowSpacing = HEX_HEIGHT;
  }

  /**
   * 六角格坐标 → key / Hex coordinate to key
   * @private
   */
  _hexKey(col, row) {
    return `${col},${row}`;
  }

  /**
   * 世界坐标 → 六角格坐标 / World coords to hex coords
   * @param {number} wx
   * @param {number} wy
   * @returns {{col: number, row: number}}
   */
  worldToHex(wx, wy) {
    const col = Math.round(wx / this._colSpacing);
    const row = Math.round((wy - (col % 2 === 1 ? this._rowSpacing * 0.5 : 0)) / this._rowSpacing);
    return { col, row };
  }

  /**
   * 记录 Agent 活动 (增加热力) / Record agent activity (add heat)
   * @param {number} x
   * @param {number} y
   * @param {number} [intensity=0.02] - 热力增量 / Heat increment
   */
  addHeat(x, y, intensity = 0.02) {
    const { col, row } = this.worldToHex(x, y);
    const key = this._hexKey(col, row);
    const current = this._heatmap.get(key) || 0;
    this._heatmap.set(key, Math.min(MAX_HEAT, current + intensity));
  }

  /**
   * 记录信息素沉积 / Record pheromone deposit
   * @param {number} x
   * @param {number} y
   * @param {number} [intensity=0.05]
   */
  addPheromoneDeposit(x, y, intensity = 0.05) {
    const { col, row } = this.worldToHex(x, y);
    const key = this._hexKey(col, row);
    const current = this._pheromoneDeposits.get(key) || 0;
    this._pheromoneDeposits.set(key, Math.min(MAX_HEAT, current + intensity));
  }

  /**
   * 同步动态状态 / Sync dynamic visual state
   * @param {number} timeSec
   * @param {number} [alarmLevel=0]
   */
  setDynamicState(timeSec, alarmLevel = 0) {
    this._time = timeSec || 0;
    this._alarmLevel = Math.max(0, Math.min(1, alarmLevel || 0));
  }

  /**
   * 衰减热力 / Decay heat values
   */
  decayHeat() {
    for (const [key, value] of this._heatmap) {
      const newVal = value * HEAT_DECAY;
      if (newVal < 0.005) {
        this._heatmap.delete(key);
      } else {
        this._heatmap.set(key, newVal);
      }
    }
    for (const [key, value] of this._pheromoneDeposits) {
      const newVal = value * 0.99;
      if (newVal < 0.005) {
        this._pheromoneDeposits.delete(key);
      } else {
        this._pheromoneDeposits.set(key, newVal);
      }
    }
  }

  /**
   * 绘制完整六角网格 / Draw the full hex grid
   * @param {string} [viewTint='#F5A623'] - 视图色调 / View tint color
   * @param {string} [modeColor] - 模式颜色 (可选中心渐变) / Mode color for center gradient
   */
  draw(viewTint = '#F5A623', modeColor) {
    const { ctx, w, h } = this;

    // ── 中心径向渐变 (模式色) / Center radial gradient (mode color) ──
    if (modeColor) {
      const cx = w / 2;
      const cy = h / 2;
      const maxR = Math.max(w, h) * 0.6;
      const centerGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, maxR);
      centerGrad.addColorStop(0, hexToRgba(modeColor, 0.04));
      centerGrad.addColorStop(0.5, hexToRgba(modeColor, 0.015));
      centerGrad.addColorStop(1, 'transparent');
      ctx.fillStyle = centerGrad;
      ctx.fillRect(0, 0, w, h);
    }

    // 计算列数和行数 / Calculate columns and rows
    const cols = Math.ceil(w / this._colSpacing) + 2;
    const rows = Math.ceil(h / this._rowSpacing) + 2;

    const pulse = 0.5 + 0.5 * Math.sin(this._time * 0.85);
    const alertBoost = this._alarmLevel * 0.03;
    const baseStrokeAlpha = 0.055 + pulse * 0.01 + alertBoost;
    const baseFillAlpha = 0.016 + pulse * 0.008 + alertBoost * 0.5;

    // 衰减热力 / Decay heat
    this.decayHeat();

    for (let col = -1; col < cols; col++) {
      for (let row = -1; row < rows; row++) {
        // 中心坐标 / Center coordinates
        const cx = col * this._colSpacing;
        const cy = row * this._rowSpacing + (col % 2 === 1 ? this._rowSpacing * 0.5 : 0);

        // 热力值 / Heat value
        const key = this._hexKey(col, row);
        const heat = this._heatmap.get(key) || 0;
        const pherDeposit = this._pheromoneDeposits.get(key) || 0;

        // 计算中心距离衰减 / Center distance falloff
        const distFromCenter = Math.sqrt((cx - w / 2) ** 2 + (cy - h / 2) ** 2);
        const maxDist = Math.max(w, h) * 0.6;
        const centerFade = Math.max(0, 1 - distFromCenter / maxDist) * 0.02;

        // 绘制尖顶六角形路径 / Draw pointy-top hex path
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
          const angle = (Math.PI / 180) * (60 * i - 30);
          const vx = cx + HEX_SIZE * Math.cos(angle);
          const vy = cy + HEX_SIZE * Math.sin(angle);
          if (i === 0) ctx.moveTo(vx, vy);
          else ctx.lineTo(vx, vy);
        }
        ctx.closePath();

        // ── 填充: 基色 + 热力 + 信息素 + 中心渐变 / Fill: base + heat + pheromone + center ──
        const fillAlpha = baseFillAlpha + heat * 0.08 + pherDeposit * 0.06 + centerFade;

        if (heat > 0.05) {
          // 热力区域: 暖色 (冷→暖→热) / Heat zone: warm colors
          const heatR = Math.floor(245 + heat * 10);
          const heatG = Math.floor(166 - heat * 80);
          const heatB = Math.floor(35 - heat * 35);
          ctx.fillStyle = `rgba(${heatR},${heatG},${heatB},${fillAlpha})`;
        } else if (pherDeposit > 0.05) {
          // 信息素沉积: 更亮的视图色 / Pheromone deposit: brighter tint
          ctx.fillStyle = hexToRgba(viewTint, fillAlpha + 0.02);
        } else {
          ctx.fillStyle = hexToRgba(viewTint, fillAlpha);
        }
        ctx.fill();

        // ── 描边: 基色 + 热力额外亮度 / Stroke: base + heat brightness ──
        const strokeAlpha = baseStrokeAlpha + heat * 0.05 + pherDeposit * 0.04;
        ctx.strokeStyle = hexToRgba(viewTint, strokeAlpha);
        ctx.lineWidth = heat > 0.3 ? 1.5 : 1;
        ctx.stroke();

        // ── 信息素沉积额外高亮环 / Pheromone deposit highlight ring ──
        if (pherDeposit > 0.1) {
          ctx.strokeStyle = hexToRgba(viewTint, pherDeposit * 0.12);
          ctx.lineWidth = 0.5;
          ctx.beginPath();
          ctx.arc(cx, cy, HEX_SIZE * 0.6, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
    }

    // 报警时绘制中心同心脉冲 / Concentric alert pulses at center
    if (this._alarmLevel > 0.25) {
      const cx = w * 0.5;
      const cy = h * 0.5;
      const pulseCount = 3;
      const t = this._time * (1.4 + this._alarmLevel * 2.2);
      for (let i = 0; i < pulseCount; i++) {
        const phase = (t + i * 0.4) % 1;
        const radius = 80 + phase * Math.min(w, h) * 0.45;
        const alpha = (1 - phase) * (0.09 + this._alarmLevel * 0.12);
        ctx.strokeStyle = `rgba(239,68,68,${alpha.toFixed(4)})`;
        ctx.lineWidth = 1.5 - phase * 0.8;
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }

  /**
   * 调整尺寸 / Resize dimensions
   * @param {number} w - 新宽度 / New width
   * @param {number} h - 新高度 / New height
   */
  resize(w, h) {
    this.w = w;
    this.h = h;
  }

  /**
   * 清除热力数据 / Clear heat data
   */
  clearHeat() {
    this._heatmap.clear();
    this._pheromoneDeposits.clear();
  }
}
