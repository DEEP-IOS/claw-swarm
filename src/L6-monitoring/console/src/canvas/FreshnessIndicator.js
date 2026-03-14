/**
 * 数据新鲜度指示器 / Data Freshness Indicator
 *
 * 4 级视觉:
 *   live         — 正常 + 绿色脉冲点
 *   recent       — 微暗 (opacity 0.8)
 *   stale        — 明显暗 + 灰色空心点 (opacity 0.5)
 *   disconnected — 虚线边框 + "?" + (opacity 0.3)
 *
 * 信息素蒸发可视化: trail 衰减时金色粒子上浮消失。
 *
 * @module canvas/FreshnessIndicator
 * @author DEEP-IOS
 */

// ── 新鲜度级别 / Freshness levels ──
export const FRESHNESS_LEVELS = {
  live:         { opacity: 1.0, dotFilled: true,  dotColor: '#10B981', pulse: true,  label: 'Live / 实时' },
  recent:       { opacity: 0.8, dotFilled: true,  dotColor: '#F5A623', pulse: false, label: 'Recent / 最近' },
  stale:        { opacity: 0.5, dotFilled: false, dotColor: '#6B7280', pulse: false, label: 'Stale / 陈旧' },
  disconnected: { opacity: 0.3, dotFilled: false, dotColor: '#EF4444', pulse: false, label: 'Disconnected / 断连', dashed: true, question: true },
};

/**
 * 计算数据新鲜度 / Calculate data freshness
 *
 * @param {boolean} sseConnected - SSE 连接状态
 * @param {number|null} lastEventTime - 最后事件时间
 * @returns {'live'|'recent'|'stale'|'disconnected'}
 */
export function calcFreshness(sseConnected, lastEventTime) {
  if (!sseConnected) return 'disconnected';
  if (!lastEventTime) return 'stale';
  const age = Date.now() - lastEventTime;
  if (age < 3000)  return 'live';    // < 3s
  if (age < 15000) return 'recent';  // < 15s
  return 'stale';                     // > 15s
}

export default class FreshnessIndicator {
  constructor() {
    this._level = 'live';
    this._pulsePhase = 0;
  }

  /**
   * 设置新鲜度级别 / Set freshness level
   * @param {'live'|'recent'|'stale'|'disconnected'} level
   */
  setLevel(level) {
    this._level = level;
  }

  /**
   * 获取当前级别 / Get current level
   * @returns {string}
   */
  get level() { return this._level; }

  /**
   * 获取不透明度 / Get opacity
   * @returns {number}
   */
  get opacity() {
    return FRESHNESS_LEVELS[this._level]?.opacity || 1.0;
  }

  /**
   * 更新 (每帧) / Update per frame
   * @param {number} dt - 帧间隔 (秒)
   */
  update(dt) {
    this._pulsePhase = (this._pulsePhase + dt * 2) % (Math.PI * 2);
  }

  /**
   * 绘制新鲜度指示器 / Draw freshness indicator
   *
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} x - 位置 X
   * @param {number} y - 位置 Y
   * @param {number} [size=6] - 点大小
   */
  draw(ctx, x, y, size = 6) {
    const config = FRESHNESS_LEVELS[this._level];
    if (!config) return;

    ctx.save();

    // 脉冲缩放 (live 级别) / Pulse scale (live level)
    if (config.pulse) {
      const pulse = 1 + Math.sin(this._pulsePhase) * 0.15;
      const outerR = size * pulse;
      ctx.beginPath();
      ctx.arc(x, y, outerR, 0, Math.PI * 2);
      ctx.strokeStyle = config.dotColor;
      ctx.globalAlpha = 0.3 + Math.sin(this._pulsePhase) * 0.2;
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // 主点 / Main dot
    ctx.globalAlpha = config.opacity;
    ctx.beginPath();
    ctx.arc(x, y, size / 2, 0, Math.PI * 2);
    if (config.dotFilled) {
      ctx.fillStyle = config.dotColor;
      ctx.fill();
    } else {
      ctx.strokeStyle = config.dotColor;
      ctx.lineWidth = 1;
      if (config.dashed) {
        ctx.setLineDash([2, 2]);
      }
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // 问号 (disconnected) / Question mark
    if (config.question) {
      ctx.fillStyle = config.dotColor;
      ctx.font = `${size * 0.7}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('?', x, y);
    }

    ctx.restore();
  }

  /**
   * 应用全局不透明度 / Apply global opacity to canvas
   * @param {CanvasRenderingContext2D} ctx
   */
  applyOpacity(ctx) {
    ctx.globalAlpha = this.opacity;
  }
}
