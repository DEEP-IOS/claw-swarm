/**
 * ContractNet 序列动画 / ContractNet Sequence Animation
 *
 * 4 幕:
 *   Act 1 - CFP 广播: 六边形任务卡从中心弹出, 辐射光波
 *   Act 2 - BID 竞标: 多蜜蜂飞向任务卡, 竞标粒子
 *   Act 3 - AWARD 授予: 一蜜蜂留下, 其余散去, 授予光束
 *   Act 4 - PICKUP 携带: 蜜蜂带任务卡飞走
 *
 * 任务卡颜色: 灰 → 金 → 绿
 *
 * @module canvas/ContractNetAnimation
 * @author DEEP-IOS
 */

const ACT_DURATION = {
  CFP:    800,   // ms
  BID:    1200,
  AWARD:  600,
  PICKUP: 800,
};

const TOTAL_DURATION = Object.values(ACT_DURATION).reduce((a, b) => a + b, 0);

export default class ContractNetAnimation {
  constructor() {
    /** @type {boolean} */
    this._active = false;
    /** @type {number} */
    this._startTime = 0;
    /** @type {{x: number, y: number}} 任务卡位置 */
    this._taskPos = { x: 0, y: 0 };
    /** @type {Array<{x: number, y: number, id: string, awarded: boolean}>} 竞标 Agent */
    this._bidders = [];
    /** @type {string|null} 获胜 Agent ID */
    this._winnerId = null;
    /** @type {string} 当前幕 */
    this._currentAct = 'CFP';
    /** @type {number} 辐射波半径 */
    this._waveRadius = 0;
    /** @type {Array<{x, y, vx, vy, life, color}>} 粒子 */
    this._particles = [];
  }

  /** @returns {boolean} */
  get active() { return this._active; }

  /** @returns {string} */
  get currentAct() { return this._currentAct; }

  /**
   * 启动 ContractNet 动画 / Start ContractNet animation
   *
   * @param {number} taskX - 任务卡 X
   * @param {number} taskY - 任务卡 Y
   * @param {Array<{x: number, y: number, id: string}>} bidders - 竞标 Agent 位置
   * @param {string} winnerId - 获胜 Agent ID
   */
  start(taskX, taskY, bidders, winnerId) {
    this._active = true;
    this._startTime = performance.now();
    this._taskPos = { x: taskX, y: taskY };
    this._bidders = bidders.map((b) => ({
      ...b, awarded: b.id === winnerId,
      startX: b.x, startY: b.y,
    }));
    this._winnerId = winnerId;
    this._currentAct = 'CFP';
    this._waveRadius = 0;
    this._particles = [];
  }

  /**
   * 更新动画 / Update animation
   * @param {number} now - performance.now()
   * @returns {boolean} 是否仍在播放
   */
  update(now) {
    if (!this._active) return false;

    const elapsed = now - this._startTime;

    // 确定当前幕 / Determine current act
    if (elapsed < ACT_DURATION.CFP) {
      this._currentAct = 'CFP';
    } else if (elapsed < ACT_DURATION.CFP + ACT_DURATION.BID) {
      this._currentAct = 'BID';
    } else if (elapsed < ACT_DURATION.CFP + ACT_DURATION.BID + ACT_DURATION.AWARD) {
      this._currentAct = 'AWARD';
    } else if (elapsed < TOTAL_DURATION) {
      this._currentAct = 'PICKUP';
    } else {
      this._active = false;
      return false;
    }

    // 更新粒子 / Update particles
    this._particles = this._particles.filter((p) => {
      p.x += p.vx;
      p.y += p.vy;
      p.life -= 0.02;
      return p.life > 0;
    });

    // Act 1: CFP 辐射波 / CFP radiation wave
    if (this._currentAct === 'CFP') {
      const t = elapsed / ACT_DURATION.CFP;
      this._waveRadius = t * 200;

      // 生成辐射粒子
      if (Math.random() < 0.3) {
        const angle = Math.random() * Math.PI * 2;
        this._particles.push({
          x: this._taskPos.x, y: this._taskPos.y,
          vx: Math.cos(angle) * 2, vy: Math.sin(angle) * 2,
          life: 1, color: '#F5A623',
        });
      }
    }

    // Act 2: BID 竞标蜜蜂飞向 / BID bidders fly toward
    if (this._currentAct === 'BID') {
      const actElapsed = elapsed - ACT_DURATION.CFP;
      const t = Math.min(1, actElapsed / ACT_DURATION.BID);

      this._bidders.forEach((b) => {
        b.x = b.startX + (this._taskPos.x - b.startX) * t * 0.8;
        b.y = b.startY + (this._taskPos.y - b.startY) * t * 0.8;
      });

      // 竞标粒子
      if (Math.random() < 0.2) {
        const b = this._bidders[Math.floor(Math.random() * this._bidders.length)];
        if (b) {
          this._particles.push({
            x: b.x, y: b.y,
            vx: (Math.random() - 0.5) * 2, vy: (Math.random() - 0.5) * 2,
            life: 0.5, color: '#3B82F6',
          });
        }
      }
    }

    // Act 3: AWARD 授予 / AWARD
    if (this._currentAct === 'AWARD') {
      const actElapsed = elapsed - ACT_DURATION.CFP - ACT_DURATION.BID;
      const t = Math.min(1, actElapsed / ACT_DURATION.AWARD);

      // 未获胜者散去 / Losers disperse
      this._bidders.forEach((b) => {
        if (!b.awarded) {
          b.x += (b.startX - this._taskPos.x) * t * 0.05;
          b.y += (b.startY - this._taskPos.y) * t * 0.05;
        }
      });

      // 授予光束粒子
      if (Math.random() < 0.4) {
        this._particles.push({
          x: this._taskPos.x + (Math.random() - 0.5) * 20,
          y: this._taskPos.y + (Math.random() - 0.5) * 20,
          vx: 0, vy: -1.5,
          life: 0.6, color: '#10B981',
        });
      }
    }

    // Act 4: PICKUP 携带 / PICKUP
    if (this._currentAct === 'PICKUP') {
      const winner = this._bidders.find((b) => b.awarded);
      if (winner) {
        const actElapsed = elapsed - ACT_DURATION.CFP - ACT_DURATION.BID - ACT_DURATION.AWARD;
        const t = Math.min(1, actElapsed / ACT_DURATION.PICKUP);
        // 任务卡跟随获胜者 / Task card follows winner
        this._taskPos.x += (winner.startX - this._taskPos.x) * t * 0.03;
        this._taskPos.y += (winner.startY - this._taskPos.y) * t * 0.03;
      }
    }

    return true;
  }

  /**
   * 绘制动画 / Draw animation
   * @param {CanvasRenderingContext2D} ctx
   */
  draw(ctx) {
    if (!this._active) return;

    ctx.save();

    // ── 任务卡 / Task card ──
    const cardColor = this._currentAct === 'CFP' ? '#6B7280' :
      this._currentAct === 'BID' ? '#F5A623' : '#10B981';

    ctx.fillStyle = cardColor;
    ctx.globalAlpha = 0.8;

    // 六边形任务卡 / Hexagonal task card
    const r = 12;
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const angle = (Math.PI / 3) * i - Math.PI / 6;
      const px = this._taskPos.x + r * Math.cos(angle);
      const py = this._taskPos.y + r * Math.sin(angle);
      i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = cardColor;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // ── CFP 辐射波 / CFP radiation wave ──
    if (this._currentAct === 'CFP' && this._waveRadius > 0) {
      ctx.beginPath();
      ctx.arc(this._taskPos.x, this._taskPos.y, this._waveRadius, 0, Math.PI * 2);
      ctx.strokeStyle = '#F5A623';
      ctx.globalAlpha = Math.max(0, 0.4 - this._waveRadius / 500);
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    // ── 竞标连接线 / Bid connection lines ──
    if (this._currentAct === 'BID' || this._currentAct === 'AWARD') {
      this._bidders.forEach((b) => {
        ctx.beginPath();
        ctx.moveTo(b.x, b.y);
        ctx.lineTo(this._taskPos.x, this._taskPos.y);
        ctx.strokeStyle = b.awarded ? '#10B981' : '#3B82F6';
        ctx.globalAlpha = b.awarded ? 0.5 : 0.15;
        ctx.lineWidth = b.awarded ? 2 : 0.5;
        ctx.setLineDash(b.awarded ? [] : [3, 3]);
        ctx.stroke();
        ctx.setLineDash([]);
      });
    }

    // ── 粒子 / Particles ──
    this._particles.forEach((p) => {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 2, 0, Math.PI * 2);
      ctx.fillStyle = p.color;
      ctx.globalAlpha = p.life;
      ctx.fill();
    });

    ctx.restore();
  }

  /**
   * 取消动画 / Cancel animation
   */
  cancel() {
    this._active = false;
    this._particles = [];
  }
}
